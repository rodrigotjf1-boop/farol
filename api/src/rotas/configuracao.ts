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
import { SQL_NUMERO_DO_QUADRO } from '../cena.js';
import { lerSabe, SABE_ESTADOS } from '../estado.js';
import { estudoParaOAgente, SABE_ESTUDO } from '../estudo.js';
import { lugaresDaLoja } from './planta.js';

/**
 * A configuração da loja, como ela desce para o agente — ou nulo, se a loja
 * não existe. `sabe` é o que o agente declara que sabe fazer: decide o que
 * desce para ele (critério que não está valendo, o estudo do critério).
 *
 * Quem usa: a rota daqui, e o balcão (`rotas/duvidas.ts`), que monta o
 * pedido com contexto com a MESMA configuração que a loja tem em mãos.
 */
export async function configuracaoDaLoja(pool: pg.Pool, lojaId: string, sabe: ReadonlySet<string>) {
  // A versão sai da MESMA consulta que os dados, não de uma anterior.
  // Lendo em dois tempos, uma mudança no meio faria o agente guardar uma
  // versão nova com configuração velha — e parar de puxar, porque para
  // ele já estaria em dia. O erro se esconderia até alguém conferir na
  // mão por que a loja analisa pela regra antiga.
  //
  // A marca da base de fichas vem na mesma consulta pelo mesmo motivo: a
  // base muda → a versão sobe (migration 038), e as duas têm de ser lidas
  // juntas.
  const l = await pool.query(
    `select l.id, l.nome, l.config_versao, l.modo_julgamento, l.resolucao_padrao,
            l.horario_funcionamento, l.tipo_negocio, l.pedido_com_contexto,
            f.impressao as fichas_impressao, f.produtos as fichas_produtos, f.com_ficha as fichas_com_ficha
       from loja l
       left join fichas_da_loja f on f.loja_id = l.id
      where l.id = $1`,
    [lojaId],
  );
  if (l.rowCount === 0) return null;

  const pontos = await pool.query(
    `select p.id, p.nome, p.origem, p.fabricante, p.canal, p.host, p.porta,
            p.usuario, p.segredo_ref, p.url_main, p.url_sub, p.gabarito,
            p.sensor_pol, p.focal_mm, p.distancia_cm, p.resolucao_h,
            p.largura_cena_cm, p.cena, st.nome as setor
       from ponto p
       join setor st on st.id = p.setor_id
      where st.loja_id = $1 and p.ativo
      order by st.nome, p.nome`,
    [lojaId],
  );

  const zonas = await pool.query(
    `select z.id, z.ponto_id, z.nome, z.poligono, z.principal, z.largura_cena_cm,
            z.papel, ${SQL_NUMERO_DO_QUADRO} as numero
       from zona z
       join ponto p on p.id = z.ponto_id
       join setor st on st.id = p.setor_id
      where st.loja_id = $1 and p.ativo and z.excluida_em is null
      order by z.principal desc, z.nome`,
    [lojaId],
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
            r.acoes, r.base_id, r.retencao_midia_dias, r.parametros, r.quando,
            r.porteiro, r.confirmar_em, r.com_padrao, r.estado,
            e.contexto as estudo_contexto, e.gatilho as estudo_gatilho,
            (e.confirmado_em is not null) as estudo_confirmado
       from regra r
       join regra_alvo a on a.regra_id = r.id
       left join regra_estudo e on e.regra_id = r.id
       join zona z on z.id = a.zona_id
       join ponto p on p.id = z.ponto_id
       join setor st on st.id = p.setor_id
      where r.loja_id = $1 and st.loja_id = $1 and p.ativo and r.ativa
        and p.excluido_em is null and r.excluida_em is null
      order by r.nome`,
    [lojaId],
  );

  const regrasPorZona = new Map<string, unknown[]>();
  for (const r of regras.rows) {
    // Critério que NÃO está valendo (observando, em ensaio, medido) só
    // desce para o agente que sabe o que é estado. O agente antigo ignora
    // o campo e avisaria da mesma forma — então, para ele, esse critério
    // não existe.
    if (r.estado !== 'valendo' && !sabe.has(SABE_ESTADOS)) continue;
    // O estudo CONFIRMADO do critério — o contexto e o gatilho que a loja
    // confere sozinha — desce para o agente que declara saber lidar com
    // ele. Para os outros o campo nem existe, e o critério segue com o
    // "quando vale a pena conferir" (`porteiro`), que continua descendo.
    const estudo = sabe.has(SABE_ESTUDO)
      ? estudoParaOAgente(r.tipo, {
          contexto: r.estudo_contexto, gatilho: r.estudo_gatilho, confirmado: r.estudo_confirmado === true,
        })
      : null;
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
      // Em que horário conferir, em relação ao horário da loja (que desce
      // em `loja.horarioFuncionamento`). O agente antigo ignora os dois.
      quando: r.quando,
      // Quando vale a pena conferir, e em quantas olhadas seguidas o
      // critério tem de ficar fora para avisar (migration 023). O agente
      // antigo ignora os dois e segue como era.
      porteiro: r.porteiro,
      confirmarEm: r.confirmar_em,
      // Quando a pergunta vai à nuvem, a foto padrão do canal vai junto.
      comPadrao: r.com_padrao,
      // O que o critério faz: observando (só conta), ensaio e medido
      // (julga, não avisa) ou valendo (avisa).
      estado: r.estado,
      ...(estudo ? { estudo } : {}),
    });
    regrasPorZona.set(r.zona_id, lista);
  }

  // As fotos padrão de cada canal: só o id, o nome e o resumo da imagem.
  // O agente guarda cada uma em disco pelo resumo e baixa (por
  // `GET /v1/agentes/padroes/:id`) só a que ainda não tem.
  const fotos = await pool.query(
    `select f.id, f.ponto_id, f.nome, f.sha256
       from foto_padrao f
       join ponto p on p.id = f.ponto_id
       join setor st on st.id = p.setor_id
      where st.loja_id = $1 and p.ativo and p.excluido_em is null
      order by f.criada_em desc`,
    [lojaId],
  );
  const fotosPorPonto = new Map<string, unknown[]>();
  for (const f of fotos.rows) {
    const lista = fotosPorPonto.get(f.ponto_id) ?? [];
    lista.push({ id: f.id, nome: f.nome, sha256: f.sha256 });
    fotosPorPonto.set(f.ponto_id, lista);
  }

  // Os equipamentos do inventário que aparecem em cada área, com a
  // descrição de como ficam limpos e no lugar. Só os DESCRITOS: é o
  // texto que vai junto com a pergunta feita à nuvem sobre aquela
  // área. "Aparece" = tem foto tirada do quadro daquele canal, com
  // aquela área.
  const equipamentos = await pool.query(
    `select distinct f.zona_id, i.id, i.nome, i.tipo, i.descricao
       from inventario_item i
       join inventario_foto f on f.item_id = i.id and f.origem = 'canal'
       join zona  z on z.id = f.zona_id  and z.excluida_em is null
       join ponto p on p.id = z.ponto_id and p.ativo and p.excluido_em is null
      where i.loja_id = $1 and i.descricao <> ''
      order by i.nome, i.id`,
    [lojaId],
  );
  const equipamentosPorZona = new Map<string, unknown[]>();
  for (const e of equipamentos.rows) {
    const lista = equipamentosPorZona.get(e.zona_id) ?? [];
    lista.push({ nome: e.nome, tipo: e.tipo, descricao: e.descricao });
    equipamentosPorZona.set(e.zona_id, lista);
  }

  // Onde cada câmera fica e o que tem na frente dela, tirado da planta
  // da loja. É a mesma frase que a tela da planta mostra.
  const lugares = await lugaresDaLoja(pool, lojaId);

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
      // O agente antigo ignora; o novo manda junto com a pergunta à nuvem.
      equipamentos: equipamentosPorZona.get(z.id) ?? [],
      // O que o quadro é, e o número dele no canal (nulo = é a imagem
      // completa). O número vem pronto: é o mesmo que a tela mostra, e o
      // agente o desenha no mapa do canal sem refazer a conta.
      papel: z.papel,
      numero: z.numero,
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
      // Quando a loja abre. Vazio = sempre aberta. Quem decide se é hora
      // de conferir é o agente, com o relógio do computador da loja.
      horarioFuncionamento: l.rows[0].horario_funcionamento ?? [],
      // O contexto que vai com a pergunta feita a um modelo: que negócio é
      // (a cena de cada canal desce no ponto). E a chave interna que diz se
      // o agente já pergunta com contexto — ligada, canal sem cena escrita
      // não manda imagem para fora. O agente antigo ignora os dois.
      tipoNegocio: l.rows[0].tipo_negocio,
      pedidoComContexto: l.rows[0].pedido_com_contexto === true,
    },
    versao: l.rows[0].config_versao,
    geradoEm: new Date().toISOString(),
    // A base de fichas que a loja tem de ter em disco (o que ela vende e
    // do que cada produto é feito): só a marca do documento. O agente
    // compara com a cópia dele e baixa (por `GET /v1/agentes/fichas`)
    // quando difere. Nulo = a loja não tem base, e a cópia de lá sai do
    // disco. O agente antigo ignora a entrada.
    fichas: l.rows[0].fichas_impressao
      ? {
          impressao: l.rows[0].fichas_impressao,
          produtos: l.rows[0].fichas_produtos,
          comFicha: l.rows[0].fichas_com_ficha,
        }
      : null,
    pontos: pontos.rows.map((p) => ({
      id: p.id,
      nome: p.nome,
      setor: p.setor,
      // Nulo = o canal não está na planta. Vai junto com a pergunta feita
      // a um modelo sobre este canal; o agente antigo ignora.
      lugar: lugares.get(p.id) ?? null,
      // O que esta câmera vê e de onde olha, escrito por quem configurou.
      // Vazio = ainda não descrita.
      cena: p.cena,
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
      // As fotos padrão deste canal, da mais nova para a mais antiga.
      padroes: fotosPorPonto.get(p.id) ?? [],
      zonas: zonasPorPonto.get(p.id) ?? [],
    })),
  };
}

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

    // O que este agente declara que sabe fazer. Agente que não declara
    // nada é o de antes dos estados: para ele, critério que desce avisa.
    const sabe = lerSabe((req.query as { sabe?: unknown }).sabe);

    const configuracao = await configuracaoDaLoja(pool, quem.lojaId, sabe);
    if (configuracao === null) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'loja não existe' });
    }

    // A declaração fica guardada (migration 033): é por ela que o console
    // diz se a loja já sabe lidar com o que foi configurado, e que se
    // confere, depois de trocar o pacote, que o agente novo pediu a
    // configuração de novo. A versão que o agente informa no sinal de vida
    // não serve para isso: é um texto fixo de quem o instalou, e não muda
    // com o pacote. Guarda-se a ÚLTIMA declaração, com a hora.
    //
    // Anotar não pode impedir a loja de receber a configuração: se falhar,
    // fica o aviso no log e a resposta segue.
    try {
      await pool.query('update agente set sabe = $2, sabe_em = now() where id = $1', [
        quem.agenteId,
        [...sabe].sort(),
      ]);
    } catch (e) {
      req.log.warn({ err: e }, 'não anotei o que o agente declarou saber');
    }

    return configuracao;
  });
}
