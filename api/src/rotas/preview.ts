// =====================================================================
// O quadro de preview do canal — para desenhar a área de análise
// =====================================================================
// O usuário abre o canal, vê o que a câmera enquadra e desenha em cima
// a região que importa. Não há modelo envolvido: é caminho de dados.
//
// O fluxo atravessa o NAT da loja pelo único caminho que existe — a
// resposta do heartbeat:
//
//   console  POST /v1/pontos/:id/preview  →  comando pendente
//   agente   heartbeat                    ←  "capture o ponto X"
//   agente   POST .../resultado           →  o JPEG
//   console  GET /v1/pontos/:id/preview   →  a imagem, para desenhar
//
// O preview fica guardado NO PONTO: é imagem fixa do que o canal
// enquadra, e a bancada não muda de lugar. Reabrir a tela mostra o que
// já existe, sem esperar a loja. Capturar a cada abertura seria lentidão
// gratuita num dado que praticamente não muda.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import {
  ehAImagemInteira,
  lerOrdem,
  lerPapel,
  NOME_DA_IMAGEM_COMPLETA,
  SQL_NUMERO_DO_QUADRO,
  TIPOS_QUE_DEPENDEM_DA_CENA,
} from '../cena.js';
import { DIAS_DO_FUNIL, montarFunil, SOMA_ZERO, somarAoFunil, SQL_SOMAS_DO_FUNIL } from '../estudo.js';
import { sqlFamilia } from '../familia.js';
import { exigirConfigurar, peloMenos } from '../rbac.js';
import { validarPoligono } from '../poligono.js';
import { registrarDescricao } from './inventario.js';
import { sessaoDe } from './sessao.js';

// 1280 px de largura basta de sobra para desenhar um retângulo, e segura
// o JPEG em poucas centenas de kB. Mandar 1920 aqui seria pagar banda da
// loja por pixel que ninguém vai olhar.
const LIMITE_BYTES = 6 * 1024 * 1024;

const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function rotasDePreview(app: FastifyInstance, pool: pg.Pool): void {
  // ───────────── console: pede um quadro novo ao canal ─────────────

  app.post('/v1/pontos/:id/preview', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }

    const { id } = req.params as { id: string };

    // O tenant entra na MESMA consulta: ponto de outra empresa tem que
    // ser indistinguível de ponto inexistente, senão a resposta vira
    // oráculo de quais ids existem.
    const p = await pool.query(
      `select p.id, st.loja_id
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null and p.ativo`,
      [id, s.tenantId],
    );
    if (p.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }

    // Quem captura é um agente ATIVO da loja. Sem agente, o pedido falha
    // na hora com o motivo — melhor que uma tela girando para sempre
    // enquanto alguém espera por uma loja que está desligada.
    const a = await pool.query(
      `select id from agente
        where loja_id = $1 and estado = 'ativo'
        order by ultimo_heartbeat desc nulls last
        limit 1`,
      [p.rows[0].loja_id],
    );
    if (a.rowCount === 0) {
      return resposta.status(409).send({
        erro: 'sem_agente',
        mensagem:
          'nenhum agente ativo nesta loja. O preview é capturado pelo agente ' +
          'instalado na loja — sem ele não há como puxar um quadro.',
      });
    }

    // Pedido repetido não empilha comando: se já há um pendente para este
    // ponto, devolve o mesmo. Clicar duas vezes em "atualizar" não pode
    // virar duas capturas.
    const pendente = await pool.query(
      `select id from comando_agente
        where ponto_id = $1 and tipo = 'capturar_quadro'
          and estado = 'pendente' and expira_em > now()
        limit 1`,
      [id],
    );
    if ((pendente.rowCount ?? 0) > 0) {
      return resposta.status(202).send({ comandoId: pendente.rows[0].id, jaPedido: true });
    }

    const c = await pool.query(
      `insert into comando_agente (agente_id, tipo, ponto_id, criado_por)
       values ($1, 'capturar_quadro', $2, $3)
       returning id, expira_em`,
      [a.rows[0].id, id, s.usuarioId],
    );

    return resposta.status(202).send({
      comandoId: c.rows[0].id,
      expiraEm: c.rows[0].expira_em,
      jaPedido: false,
    });
  });

  // ───────────── console: a imagem, e o estado do pedido ─────────────

  app.get('/v1/pontos/:id/preview', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    const { id } = req.params as { id: string };

    const r = await pool.query(
      `select p.preview, p.preview_tipo
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0 || !r.rows[0].preview) {
      return resposta.status(404).send({
        erro: 'sem_preview',
        mensagem: 'este canal ainda não tem quadro. Peça um em POST /v1/pontos/:id/preview',
      });
    }

    return resposta
      .header('content-type', r.rows[0].preview_tipo || 'image/jpeg')
      // Sem cache: o usuário clica em atualizar para ver a cena de agora,
      // e um 304 do navegador mostraria a de antes — parecendo que o
      // botão não funciona.
      .header('cache-control', 'no-store')
      .send(r.rows[0].preview);
  });

  app.get('/v1/pontos/:id/preview/estado', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    const { id } = req.params as { id: string };

    const r = await pool.query(
      `select p.preview_em, p.preview_largura, p.preview_altura, p.preview_pessoas,
              (p.preview is not null) as tem_preview
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }

    // O último comando diz em que pé está o pedido: esperando a loja,
    // entregue, concluído ou falhado. É o que a tela mostra enquanto
    // espera, para não ser um spinner mudo.
    const c = await pool.query(
      `select id, estado, erro, criado_em, concluido_em, expira_em
         from comando_agente
        where ponto_id = $1 and tipo = 'capturar_quadro'
        order by criado_em desc
        limit 1`,
      [id],
    );

    const cmd = c.rows[0];
    return {
      temPreview: r.rows[0].tem_preview,
      capturadoEm: r.rows[0].preview_em,
      largura: r.rows[0].preview_largura,
      altura: r.rows[0].preview_altura,
      // Quantas pessoas o detector da loja viu neste quadro. Nulo = a loja
      // não mediu (agente antigo, ou sem detector): não é zero.
      pessoas: r.rows[0].preview_pessoas as number | null,
      pedido: cmd
        ? {
            id: cmd.id,
            // `pendente` com `expira_em` no passado é pedido que a loja
            // nunca buscou — e dizer "esperando" para sempre esconderia
            // um agente offline.
            estado:
              cmd.estado === 'pendente' && new Date(cmd.expira_em) < new Date()
                ? 'expirado'
                : cmd.estado,
            erro: cmd.erro,
            criadoEm: cmd.criado_em,
            concluidoEm: cmd.concluido_em,
          }
        : null,
    };
  });

  // ───────────── console: o canal, com as áreas que já tem ─────────────

  app.get('/v1/pontos/:id', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    const { id } = req.params as { id: string };

    // Sem `p.preview`: os bytes têm rota própria. Trazê-los aqui mandaria
    // algumas centenas de kB junto de um JSON de texto, em toda abertura
    // da tela.
    const p = await pool.query(
      `select p.id, p.nome, p.canal, p.host, p.porta, p.usuario,
              p.fabricante, p.origem, p.ativo, p.mac, p.mac_visto_em,
              p.sensor_pol, p.focal_mm, p.distancia_cm, p.resolucao_h,
              p.largura_cena_cm, p.preview_largura, p.preview_altura, p.preview_em,
              (p.preview is not null) as tem_preview,
              -- A cena, com quem a escreveu. O tipo de negócio é da loja, e a
              -- tela do canal mostra os dois juntos.
              p.cena, p.cena_escrita_em,
              (select u.nome from usuario u where u.id = p.cena_escrita_por) as cena_escrita_por_nome,
              l.tipo_negocio as loja_tipo_negocio,
              -- Não sai daqui como veio: é a chave interna. Dela só se tira
              -- o que ESTÁ ACONTECENDO com este canal (abaixo).
              l.pedido_com_contexto as com_contexto,
              -- O "hoje" no relógio DA LOJA: é por ele que o funil conta os dias.
              l.timezone as fuso_da_loja,
              to_char(now() at time zone l.timezone, 'YYYY-MM-DD') as hoje_na_loja,
              st.id as setor_id, st.nome as setor_nome, st.loja_id
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (p.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }
    const { com_contexto: comContexto, fuso_da_loja: fuso, hoje_na_loja: hoje, ...ponto } = p.rows[0];

    // A cena faz falta AGORA neste canal? Só quando a loja já pergunta com
    // contexto e o canal está sem a cena escrita: aí o critério que depende
    // de entender a imagem não é analisado. É resultado, não configuração —
    // a tela mostra "falta descrever a cena" só onde isso é verdade.
    const cenaEmFalta = comContexto === true && String(ponto.cena ?? '').trim() === '';

    // A imagem completa vem primeiro; depois os quadros, na ordem do número.
    // Cada um com os SEUS critérios: o critério vale só onde foi posto. Uma
    // consulta para o canal inteiro — nunca uma por quadro.
    const z = await pool.query(
      `select z.id, z.nome, z.poligono, z.principal, z.largura_cena_cm,
              z.papel, z.ordem, ${SQL_NUMERO_DO_QUADRO} as numero,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                         'id', r.id, 'nome', r.nome, 'tipo', r.tipo, 'ativa', r.ativa, 'estado', r.estado,
                         'familia', ${sqlFamilia()},
                         'quando', r.quando, 'parametros', r.parametros,
                         -- O estudo só vale (e só desce para a loja) depois de confirmado.
                         'tem_estudo', exists (select 1 from regra_estudo e
                                                where e.regra_id = r.id and e.confirmado_em is not null),
                         -- Em quantos canais este critério vale, e em quantos
                         -- quadros (fora as imagens completas): é o que a
                         -- tela diz antes de alguém editar o cadastro, que
                         -- é um só.
                         'canais', (select count(distinct zo.ponto_id)::int
                                      from regra_alvo o join zona zo on zo.id = o.zona_id
                                     where o.regra_id = r.id),
                         'quadros', (select count(*)::int
                                       from regra_alvo o join zona zo on zo.id = o.zona_id
                                      where o.regra_id = r.id and not zo.principal))
                       order by r.nome)
                  from regra_alvo ra
                  join regra r on r.id = ra.regra_id
                 where ra.zona_id = z.id and r.excluida_em is null
              ), '[]'::jsonb) as criterios
         from zona z
        where z.ponto_id = $1 and z.excluida_em is null
        order by z.principal desc, z.ordem, z.criado_em, z.id`,
      [id],
    );

    // Os números do funil de cada critério NESTE lugar, nos últimos dias —
    // a mesma conta e a mesma permissão de `GET /v1/regras/:id/funil`
    // (supervisão para cima, e o suporte). Uma consulta para o canal
    // inteiro. Quem não pode ver recebe `null`: a tela não mostra número.
    //
    // A loja entra no filtro para a consulta andar pelo índice da tabela
    // (`resumo_hora_loja_idx`: loja e hora): sem ela, cada abertura desta
    // tela leria os resumos de todas as lojas.
    const veOFunil = s.nivel === 'suporte' || peloMenos(s, 'supervisao');
    const somas = new Map<string, ReturnType<typeof somarAoFunil>>();
    if (veOFunil) {
      const h = await pool.query(
        `select h.regra_id, h.zona_id, ${SQL_SOMAS_DO_FUNIL}
           from resumo_hora h
           join zona z on z.id = h.zona_id
          where z.ponto_id = $1
            and h.loja_id = $5
            and h.hora >= (($3::date - ($4::integer - 1))::timestamp at time zone $2)
            and h.hora <  (($3::date + 1)::timestamp at time zone $2)
          group by h.regra_id, h.zona_id`,
        [id, fuso, hoje, DIAS_DO_FUNIL, ponto.loja_id],
      );
      for (const l of h.rows) somas.set(`${l.regra_id}:${l.zona_id}`, somarAoFunil(SOMA_ZERO, l));
    }
    const funilDe = (regraId: string, zonaId: string) => {
      if (!veOFunil) return null;
      const f = montarFunil(somas.get(`${regraId}:${zonaId}`) ?? SOMA_ZERO, { naLoja: 0, naNuvem: 0 });
      return { olhadas: f.olhadas, comGatilho: f.comGatilho, julgadas: f.julgadas, foraDoCriterio: f.foraDoCriterio };
    };

    type CriterioDaZona = { id: string; tipo: string; ativa: boolean; estado: string } & Record<string, unknown>;
    return {
      ponto: { ...ponto, cena_em_falta: cenaEmFalta, funil_dias: veOFunil ? DIAS_DO_FUNIL : null },
      zonas: z.rows.map((zona) => ({
        ...zona,
        criterios: (zona.criterios as CriterioDaZona[]).map((k) => ({
          ...k,
          funil: funilDe(k.id, zona.id as string),
          // Critério desligado não é conferido de jeito nenhum, e o que só
          // observa conta as olhadas sem precisar entender a imagem.
          falta_a_cena:
            cenaEmFalta && k.ativa && k.estado !== 'observando' && TIPOS_QUE_DEPENDEM_DA_CENA.includes(k.tipo),
        })),
      })),
    };
  });

  // ───────────── console: salva o quadro (nome, papel, ordem, contorno) ─────────────
  //
  // A IMAGEM COMPLETA do canal é fixa: sempre o canal inteiro, com o nome
  // dela, sem papel. Daqui só se muda nela a largura real da cena. O resto
  // é recusado com o motivo — quem quer conferir só uma parte marca um quadro.

  app.patch('/v1/zonas/:id', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }

    // O quadro decide o que o critério enxerga: mexer nele é configurar.
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const corpo = (req.body ?? {}) as {
      nome?: string;
      poligono?: unknown;
      larguraCenaCm?: number | null;
      principal?: unknown;
      papel?: unknown;
      ordem?: unknown;
    };
    if (corpo.nome !== undefined) {
      const problema = nomeDeQuadroInvalido(corpo.nome);
      if (problema) return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }
    // O papel (o que o quadro é) e a ordem dele no canal. Ausentes, ficam.
    let papel: string | null = null;
    if (corpo.papel !== undefined) {
      const lido = lerPapel(corpo.papel);
      if (lido.problema !== undefined) return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
      papel = lido.valor;
    }
    let ordem: number | null = null;
    if (corpo.ordem !== undefined) {
      const lida = lerOrdem(corpo.ordem);
      if (lida.problema !== undefined) return resposta.status(422).send({ erro: 'validacao', mensagem: lida.problema });
      ordem = lida.valor;
    }

    const z = await pool.query(
      `select z.id, z.ponto_id, z.principal, z.nome
         from zona z
         join ponto p on p.id = z.ponto_id
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where z.id = $1 and l.tenant_id = $2 and p.excluido_em is null
          and z.excluida_em is null`,
      [id, s.tenantId],
    );
    if (z.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'quadro não encontrado' });
    }
    const atual = z.rows[0] as { principal: boolean; nome: string };
    const nome = corpo.nome === undefined ? null : String(corpo.nome).trim();

    if (atual.principal) {
      // Mandar de volta o que ela já é não muda nada, e passa: é o que uma
      // tela manda ao salvar sem mexer.
      const mexe =
        (corpo.poligono !== undefined && !ehAImagemInteira(corpo.poligono)) ||
        (nome !== null && nome !== atual.nome) ||
        (papel !== null && papel !== 'livre') ||
        (ordem !== null && ordem !== 0) ||
        (corpo.principal !== undefined && corpo.principal !== true);
      if (mexe) return resposta.status(409).send(IMAGEM_COMPLETA_FIXA);
    } else {
      if (corpo.principal !== undefined && corpo.principal !== false) {
        return resposta.status(409).send({
          erro: 'imagem_completa_fixa',
          mensagem: 'a imagem completa do canal é fixa: um quadro não toma o lugar dela',
        });
      }
      if (nome !== null && nome.toLowerCase() === NOME_DA_IMAGEM_COMPLETA.toLowerCase()) {
        return resposta.status(422).send(NOME_RESERVADO);
      }
    }

    if (corpo.poligono !== undefined) {
      const erro = validarPoligono(corpo.poligono);
      if (erro) {
        return resposta.status(422).send({ erro: 'poligono_invalido', mensagem: erro });
      }
    }
    if (
      corpo.larguraCenaCm !== undefined &&
      corpo.larguraCenaCm !== null &&
      !(Number(corpo.larguraCenaCm) > 0)
    ) {
      return resposta.status(422).send({
        erro: 'largura_invalida',
        mensagem: 'largura_cena_cm tem que ser maior que zero, ou nulo',
      });
    }

    try {
      // `principal` não entra: quem é a imagem completa do canal não muda
      // por aqui. A condição repete a conferência de cima dentro da própria
      // instrução — se a área virou outra coisa entre a leitura e a
      // gravação, nada é gravado.
      const r = await pool.query(
        `update zona
            set nome = coalesce($2, nome),
                poligono = coalesce($3::jsonb, poligono),
                largura_cena_cm = case when $4::boolean then $5::numeric else largura_cena_cm end,
                papel = coalesce($6::text, papel),
                ordem = coalesce($7::integer, ordem),
                atualizado_em = now()
          where id = $1 and excluida_em is null and principal = $8
        returning id, ponto_id, nome, poligono, principal, largura_cena_cm, papel, ordem`,
        [
          id,
          nome,
          // Na imagem completa o desenho que chegou é o dela mesma: não regrava.
          corpo.poligono === undefined || atual.principal ? null : JSON.stringify(corpo.poligono),
          // `largura` separada do valor: sem isto não há como gravar NULL
          // de propósito — `coalesce` trataria "apagar" como "não mexer".
          corpo.larguraCenaCm !== undefined,
          corpo.larguraCenaCm ?? null,
          papel,
          ordem,
          atual.principal,
        ],
      );
      if (r.rowCount === 0) {
        return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'quadro não encontrado' });
      }
      return r.rows[0];
    } catch (e) {
      if (ehNomeRepetido(e)) return resposta.status(409).send(NOME_REPETIDO);
      throw e;
    }
  });

  // ───────────── console: mais um quadro no mesmo canal ─────────────
  //
  // A mesma câmera do caixa confere presença DENTRO do balcão e fila do
  // lado do cliente: dois quadros, cada um com os seus critérios.

  app.post('/v1/pontos/:id/zonas', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    if (!UUID.test(id)) return naoAchei();

    const corpo = (req.body ?? {}) as { nome?: unknown; poligono?: unknown; papel?: unknown };
    const problema = nomeDeQuadroInvalido(corpo.nome);
    if (problema) return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    const nome = String(corpo.nome).trim();
    if (nome.toLowerCase() === NOME_DA_IMAGEM_COMPLETA.toLowerCase()) {
      return resposta.status(422).send(NOME_RESERVADO);
    }
    // Sem papel informado, nasce "livre": um recorte como os de sempre.
    let papelNovo = 'livre';
    if (corpo.papel !== undefined) {
      const lido = lerPapel(corpo.papel);
      if (lido.problema !== undefined) return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
      papelNovo = lido.valor;
    }
    // Sem desenho, o quadro nasce no meio da imagem: dá para ver e arrastar.
    const poligono = corpo.poligono ?? QUADRO_DO_MEIO;
    const erro = validarPoligono(poligono);
    if (erro) return resposta.status(422).send({ erro: 'poligono_invalido', mensagem: erro });

    // O canal é desta conta e existe? E quantos quadros já tem (a imagem
    // completa não é quadro)? Numa consulta.
    const canal = await pool.query(
      `select p.id,
              (select count(*)::int from zona z
                where z.ponto_id = p.id and z.excluida_em is null and not z.principal) as quadros
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (canal.rowCount === 0) return naoAchei();
    if (canal.rows[0].quadros >= MAX_QUADROS_POR_CANAL) {
      return resposta.status(409).send({
        erro: 'areas_demais',
        mensagem: `um canal tem no máximo ${MAX_QUADROS_POR_CANAL} quadros`,
      });
    }

    try {
      // Nunca principal: a imagem completa do canal é a que já existe.
      const r = await pool.query(
        `insert into zona (ponto_id, nome, poligono, principal, papel)
         values ($1, $2, $3::jsonb, false, $4)
         returning id, ponto_id, nome, poligono, principal, largura_cena_cm, papel, ordem`,
        [id, nome, JSON.stringify(poligono), papelNovo],
      );
      return resposta.status(201).send({ ...r.rows[0], criterios: [] });
    } catch (e) {
      if (ehNomeRepetido(e)) return resposta.status(409).send(NOME_REPETIDO);
      throw e;
    }
  });

  // ───────────── console: excluir um quadro do canal ─────────────
  //
  // Excluir é MARCAR. O resumo por hora aponta para o quadro, e apagar a
  // linha levaria junto tudo o que foi contado nele. O que deixa de existir
  // é o vínculo: os critérios dele saem deste canal.
  //
  // A imagem completa não se exclui: ela é o canal. Por isso o canal nunca
  // fica sem área — e não há mais "a principal passa para outra".

  app.delete('/v1/zonas/:id', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'quadro não encontrado' });
    if (!UUID.test(id)) return naoAchei();

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      // Trava a linha do quadro: duas exclusões ao mesmo tempo passam uma
      // depois da outra, e a segunda já não o encontra.
      const z = await cliente.query(
        `select z.id, z.nome, z.ponto_id, z.principal
           from zona z
           join ponto p  on p.id  = z.ponto_id
           join setor st on st.id = p.setor_id
           join loja  l  on l.id  = st.loja_id
          where z.id = $1 and l.tenant_id = $2
            and p.excluido_em is null and z.excluida_em is null
            for update of z`,
        [id, s.tenantId],
      );
      if (z.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei();
      }
      const quadro = z.rows[0];
      if (quadro.principal) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'imagem_completa_fixa',
          mensagem:
            'a imagem completa não se exclui: ela é o canal inteiro. Para parar de verificar, pause ou exclua o canal',
        });
      }

      // Os critérios deste quadro, travados antes de mexer: "sobrou algum
      // lugar?" decide se o critério é desligado.
      const afetados = await cliente.query(
        `select r.id
           from regra r
          where r.id in (select ra.regra_id from regra_alvo ra where ra.zona_id = $1)
          order by r.id
            for update of r`,
        [id],
      );
      const ids: string[] = afetados.rows.map((r) => r.id);

      await cliente.query(`delete from regra_alvo where zona_id = $1`, [id]);

      // Uma instrução para todos, nunca um laço por critério.
      const desligados = await cliente.query(
        `update regra r
            set ativa = false, atualizado_em = now()
          where r.id = any($1::uuid[])
            and r.ativa
            and not exists (select 1 from regra_alvo ra where ra.regra_id = r.id)
        returning r.nome`,
        [ids],
      );

      await cliente.query(
        `update zona
            set excluida_em = now(), excluida_por = $2, atualizado_em = now()
          where id = $1`,
        [id, s.usuarioId],
      );

      await cliente.query('commit');

      req.log.info(
        { zona: id, ponto: quadro.ponto_id, por: s.usuarioId, criterios: ids.length, desligados: desligados.rowCount },
        'quadro EXCLUÍDO',
      );
      return {
        excluida: true,
        criteriosTirados: ids.length,
        criteriosDesligados: desligados.rows.map((r) => r.nome as string),
        aviso: 'quadro excluído; o que ele registrou continua no histórico',
      };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────── agente: entrega o que capturou ─────────────────

  app.post('/v1/agentes/comandos/:id/resultado', async (req, resposta) => {
    let quem;
    try {
      quem = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const { id } = req.params as { id: string };
    const corpo = (req.body ?? {}) as {
      imagemBase64?: string;
      tipo?: string;
      largura?: number;
      altura?: number;
      mac?: string;
      erro?: string;
      /** Pessoas que o detector da loja viu no quadro. Agente sem detector não manda. */
      pessoas?: number;
    };

    // O comando tem que ser DESTE agente. Sem isso, um token de loja
    // qualquer poderia gravar imagem no ponto de outra.
    const c = await pool.query(
      `select id, ponto_id, estado, tipo from comando_agente
        where id = $1 and agente_id = $2`,
      [id, quem.agenteId],
    );
    if (c.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'comando não é deste agente' });
    }
    if (c.rows[0].estado === 'concluido') {
      // Reenvio por retentativa do agente. Não é erro: responder 409
      // faria o agente tratar como falha e tentar de novo para sempre.
      return { ok: true, jaConcluido: true };
    }

    // Falha também responde. Comando que fracassa em silêncio deixa a
    // tela girando, e quem está lá não sabe se a câmera caiu ou se o
    // agente nem recebeu.
    if (corpo.erro) {
      await pool.query(
        `update comando_agente set estado='falhou', erro=$2, concluido_em=now() where id=$1`,
        [id, String(corpo.erro).slice(0, 500)],
      );
      return { ok: true, registrado: 'falha' };
    }

    // O comando de descrever equipamento devolve TEXTO, não imagem: a
    // sugestão fica guardada no comando, e quem a lê é o inventário.
    if (c.rows[0].tipo === 'descrever_item') {
      const r = await registrarDescricao(pool, id, req.body);
      return resposta.status(r.status).send(r.corpo);
    }

    if (!corpo.imagemBase64) {
      return resposta.status(422).send({
        erro: 'sem_imagem',
        mensagem: 'mande imagemBase64 ou erro',
      });
    }
    const tipo = corpo.tipo || 'image/jpeg';
    if (!TIPOS.has(tipo)) {
      return resposta.status(422).send({
        erro: 'tipo_invalido',
        mensagem: `tipo ${tipo} não aceito. Use ${[...TIPOS].join(', ')}`,
      });
    }

    // Opcional: agente antigo, ou sem detector, não manda. Valor torto não
    // derruba a entrega do quadro — fica como "não medido".
    const pessoas =
      typeof corpo.pessoas === 'number' && Number.isInteger(corpo.pessoas) && corpo.pessoas >= 0 && corpo.pessoas <= 1000
        ? corpo.pessoas
        : null;

    const bytes = Buffer.from(corpo.imagemBase64, 'base64');
    if (bytes.length === 0) {
      return resposta.status(422).send({ erro: 'imagem_vazia', mensagem: 'base64 não decodificou' });
    }
    if (bytes.length > LIMITE_BYTES) {
      return resposta.status(413).send({
        erro: 'imagem_grande',
        mensagem: `${Math.round(bytes.length / 1024)} kB acima do limite de ${LIMITE_BYTES / 1024 / 1024} MB`,
      });
    }

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // O MAC só é gravado quando vem: `coalesce` mantém o anterior em
      // vez de apagá-lo quando o agente não conseguiu ler. Perder o MAC
      // conhecido por causa de uma leitura falha seria trocar
      // informação boa por nenhuma.
      await cliente.query(
        `update ponto
            set preview = $2, preview_tipo = $3,
                preview_largura = $4, preview_altura = $5, preview_em = now(),
                -- É deste quadro, não do anterior: sem medida, fica nulo.
                preview_pessoas = $7,
                mac = coalesce($6, mac),
                mac_visto_em = case when $6 is not null then now() else mac_visto_em end,
                -- O quadro SABE a largura dele. Preenche resolucao_h
                -- quando ninguém informou: medir vence perguntar, e o
                -- diagnóstico deixa de pedir um número que o sistema
                -- tinha como descobrir sozinho.
                resolucao_h = coalesce(resolucao_h, $4)
          where id = $1`,
        [
          c.rows[0].ponto_id, bytes, tipo,
          corpo.largura ?? null, corpo.altura ?? null,
          corpo.mac ? String(corpo.mac).toLowerCase().slice(0, 32) : null,
          pessoas,
        ],
      );
      await cliente.query(
        `update comando_agente set estado='concluido', concluido_em=now(), erro=null where id=$1`,
        [id],
      );
      await cliente.query('commit');
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }

    return { ok: true, bytes: bytes.length };
  });
}

/**
 * O polígono é usado pelo agente para recortar antes de qualquer análise.
 * Polígono inválido não dá erro visível: dá recorte errado, e aí o modelo
 * responde com confiança sobre o lugar errado — a pior falha possível,
 * porque parece que funciona.
 *
 * Por isso recusa aqui, onde ainda há um humano na frente da tela para
 * ler a mensagem.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Uma câmera tem duas, três regiões que importam. O teto existe para um
// laço descontrolado não encher o canal de quadros. A imagem completa não
// entra na conta: ela não é quadro.
const MAX_QUADROS_POR_CANAL = 8;

/** Onde o quadro novo nasce quando ninguém o desenhou: o meio da imagem. */
const QUADRO_DO_MEIO = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];

const NOME_REPETIDO = {
  erro: 'nome_repetido',
  mensagem: 'já existe um quadro com esse nome neste canal',
};

/** O nome da imagem completa é dela: quadro com esse nome confundiria os dois. */
const NOME_RESERVADO = {
  erro: 'validacao',
  mensagem: `“${NOME_DA_IMAGEM_COMPLETA}” é o nome do canal inteiro: dê outro nome ao quadro`,
};

const IMAGEM_COMPLETA_FIXA = {
  erro: 'imagem_completa_fixa',
  mensagem:
    'a imagem completa é sempre o canal inteiro: não muda de contorno, de nome nem de papel. ' +
    'Para conferir só uma parte, marque um quadro',
};

/** O índice `zona_nome_por_ponto_uk` recusou: o nome já está em uso no canal. */
function ehNomeRepetido(e: unknown): boolean {
  const erro = e as { code?: string; constraint?: string };
  return erro?.code === '23505' && erro.constraint === 'zona_nome_por_ponto_uk';
}

function nomeDeQuadroInvalido(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor.trim()) return 'diga o nome do quadro';
  if (valor.trim().length > 60) return 'o nome do quadro tem no máximo 60 caracteres';
  return null;
}
