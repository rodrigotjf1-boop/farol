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
        where p.id = $1 and l.tenant_id = $2 and p.ativo`,
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
        where p.id = $1 and l.tenant_id = $2`,
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
      `select p.preview_em, p.preview_largura, p.preview_altura,
              (p.preview is not null) as tem_preview
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2`,
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
      erro?: string;
    };

    // O comando tem que ser DESTE agente. Sem isso, um token de loja
    // qualquer poderia gravar imagem no ponto de outra.
    const c = await pool.query(
      `select id, ponto_id, estado from comando_agente
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
      await cliente.query(
        `update ponto
            set preview = $2, preview_tipo = $3,
                preview_largura = $4, preview_altura = $5, preview_em = now(),
                -- O quadro SABE a largura dele. Preenche resolucao_h
                -- quando ninguém informou: medir vence perguntar, e o
                -- diagnóstico deixa de pedir um número que o sistema
                -- tinha como descobrir sozinho.
                resolucao_h = coalesce(resolucao_h, $4)
          where id = $1`,
        [c.rows[0].ponto_id, bytes, tipo, corpo.largura ?? null, corpo.altura ?? null],
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
