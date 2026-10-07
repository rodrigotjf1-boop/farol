// =====================================================================
// GET /v1/agentes/configuracao — a configuração desce para o agente
// =====================================================================
// A configuração é feita na nuvem, no app, e desce para o agente usar.
// Até aqui ela não descia: o agente lia as regras de um YAML no disco da
// loja, e desenhar uma área no console não mudava nada lá dentro.
//
// **Quem pede é o agente.** De dentro para fora, com o token dele — então
// o NAT da loja não atrapalha, e não é preciso canal de volta nenhum para
// isto. O `heartbeat` devolve só `configVersao`, um inteiro: igual ao que
// o agente tem, ele não faz nada; diferente, ele chama esta rota.
//
// ## O que NÃO desce
//
// **A senha da câmera.** O `ponto` guarda `usuario` e `segredo_ref` — uma
// referência ao cofre do agente, na loja. O segredo em si nunca esteve no
// banco da nuvem e não passa por aqui. Se um dia alguém puser a senha
// numa coluna, o teste `nenhum campo de segredo desce` quebra.
//
// **Regra desligada.** `ativa = false` não vai: regra que não deve ser
// avaliada não tem por que existir no agente, e mandá-la seria convidar
// alguém a ligá-la do lado errado.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';

export function rotasDeConfiguracao(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/v1/agentes/configuracao', async (req, resposta) => {
    let quem;
    try {
      quem = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial recusada na configuração');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    // A versão sai da MESMA consulta que os dados, não de uma anterior.
    // Lendo em dois tempos, uma mudança no meio faria o agente guardar uma
    // versão nova com configuração velha — e parar de puxar, porque para
    // ele já estaria em dia. O erro se esconderia até alguém conferir na
    // mão por que a loja analisa pela regra antiga.
    const l = await pool.query(
      `select id, nome, config_versao, modo_julgamento, resolucao_padrao
         from loja where id = $1`,
      [quem.lojaId],
    );
    if (l.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'loja não existe' });
    }

    const pontos = await pool.query(
      `select p.id, p.nome, p.origem, p.fabricante, p.canal, p.host, p.porta,
              p.usuario, p.segredo_ref, p.url_main, p.url_sub, p.gabarito,
              p.sensor_pol, p.focal_mm, p.distancia_cm, p.resolucao_h,
              p.largura_cena_cm, st.nome as setor
         from ponto p
         join setor st on st.id = p.setor_id
        where st.loja_id = $1 and p.ativo
        order by st.nome, p.nome`,
      [quem.lojaId],
    );

    const zonas = await pool.query(
      `select z.id, z.ponto_id, z.nome, z.poligono, z.principal, z.largura_cena_cm
         from zona z
         join ponto p on p.id = z.ponto_id
         join setor st on st.id = p.setor_id
        where st.loja_id = $1 and p.ativo
        order by z.principal desc, z.nome`,
      [quem.lojaId],
    );

    // Um critério que vale em três canais desce TRÊS vezes, uma debaixo de
    // cada área — com o mesmo id. A expansão é feita aqui, no servidor, de
    // propósito: o agente já indexa tudo por área, então para ele um
    // critério em vários canais é só "o mesmo critério aparecendo em mais de
    // uma zona". Ensinar o agente a resolver o conjunto poria a mesma regra
    // em dois lugares, em duas linguagens, e elas divergiriam na primeira
    // correção feita só de um lado.
    const regras = await pool.query(
      `select r.id, a.zona_id, r.nome, r.tipo, r.criterio, r.criterio_versao,
              r.processo_descricao, r.prioridade, r.severidade,
              r.confianca_minima, r.cooldown_min, r.resolucao, r.janelas,
              r.acoes, r.base_id, r.retencao_midia_dias, r.parametros
         from regra r
         join regra_alvo a on a.regra_id = r.id
         join zona z on z.id = a.zona_id
         join ponto p on p.id = z.ponto_id
         join setor st on st.id = p.setor_id
        where r.loja_id = $1 and st.loja_id = $1 and p.ativo and r.ativa
          and p.excluido_em is null and r.excluida_em is null
        order by r.nome`,
      [quem.lojaId],
    );

    const regrasPorZona = new Map<string, unknown[]>();
    for (const r of regras.rows) {
      const lista = regrasPorZona.get(r.zona_id) ?? [];
      lista.push({
        id: r.id,
        nome: r.nome,
        tipo: r.tipo,
        criterio: r.criterio,
        // O agente usa isto na chave de idempotência da fila: critério
        // mudou, veredito antigo não vale mais e a análise refaz.
        criterioVersao: r.criterio_versao,
        processoDescricao: r.processo_descricao,
        prioridade: r.prioridade,
        severidade: r.severidade,
        confiancaMinima: Number(r.confianca_minima),
        cooldownMin: r.cooldown_min,
        resolucao: r.resolucao,
        janelas: r.janelas,
        acoes: r.acoes,
        baseId: r.base_id,
        retencaoMidiaDias: r.retencao_midia_dias,
        // O que o detector local procura, nos critérios de presença e de
        // contagem. Vai como está: quem interpreta é o agente.
        parametros: r.parametros ?? {},
      });
      regrasPorZona.set(r.zona_id, lista);
    }

    const zonasPorPonto = new Map<string, unknown[]>();
    for (const z of zonas.rows) {
      const lista = zonasPorPonto.get(z.ponto_id) ?? [];
      lista.push({
        id: z.id,
        nome: z.nome,
        poligono: z.poligono,
        // O corte DO CANAL. O agente recorta por esta zona toda análise
        // que não mire uma zona específica.
        principal: z.principal,
        larguraCenaCm: z.largura_cena_cm ? Number(z.largura_cena_cm) : null,
        regras: regrasPorZona.get(z.id) ?? [],
      });
      zonasPorPonto.set(z.ponto_id, lista);
    }

    return {
      loja: {
        id: l.rows[0].id,
        nome: l.rows[0].nome,
        // Decide QUAL juiz atende cada regra na loja. Sem isto o agente
        // teria que supor, e supor aqui significa mandar para a nuvem o
        // que o desenho promete manter dentro da loja.
        modoJulgamento: l.rows[0].modo_julgamento,
        resolucaoPadrao: l.rows[0].resolucao_padrao,
      },
      versao: l.rows[0].config_versao,
      geradoEm: new Date().toISOString(),
      pontos: pontos.rows.map((p) => ({
        id: p.id,
        nome: p.nome,
        setor: p.setor,
        origem: p.origem,
        fabricante: p.fabricante,
        canal: p.canal,
        host: p.host,
        porta: p.porta,
        usuario: p.usuario,
        // Referência ao cofre DO AGENTE. Não é o segredo, e o segredo
        // nunca esteve neste banco.
        segredoRef: p.segredo_ref,
        urlMain: p.url_main,
        urlSub: p.url_sub,
        gabarito: p.gabarito,
        optica: {
          sensorPol: p.sensor_pol,
          focalMm: p.focal_mm ? Number(p.focal_mm) : null,
          distanciaCm: p.distancia_cm ? Number(p.distancia_cm) : null,
          resolucaoH: p.resolucao_h,
          larguraCenaCm: p.largura_cena_cm ? Number(p.largura_cena_cm) : null,
        },
        zonas: zonasPorPonto.get(p.id) ?? [],
      })),
    };
  });
}
