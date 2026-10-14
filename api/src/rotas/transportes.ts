// =====================================================================
// Quem entrega os alertas — emitir, listar e revogar (só a distribuição)
// =====================================================================
// O transporte (o n8n, o Regem) puxa os envios pendentes e devolve o
// resultado (`rotas/alertas.ts`). Desde 14/10/2026 (migration 046) ele tem
// credencial PRÓPRIA: um token por transporte, que só reivindica envios dos
// tipos da linha e só devolve o resultado do que ele mesmo reivindicou. A
// chave geral da distribuição (`x-farol-admin`) não vale mais naquelas
// rotas — quem entregasse os alertas carregaria a chave que emite agente e
// cadastra loja, de todas as lojas (pedido da sessão do Hub DMS, aprovado
// pelo dono no mesmo dia).
//
// Estas rotas são da DISTRIBUIÇÃO (a chave geral), como emitir agente:
//
//   POST /v1/distribuicao/transportes              emite; o token aparece UMA vez
//   GET  /v1/distribuicao/transportes              lista (sem token nem resumo)
//   POST /v1/distribuicao/transportes/:id/revogar  revoga um, sem derrubar os outros
//
// O banco guarda só o resumo (SHA-256) do token: nem quem administra o lê
// depois de emitido. Pela linha de comando: `npm run provisionar --
// transporte <nome> <tipos>`.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { ErroDeAuth, exigirAdmin, gerarTokenDeTransporte, hashDoToken } from '../auth.js';
import { acharCampoProibido } from './lojas.js';

export const TIPOS_DE_DESTINO = ['whatsapp', 'email', 'kds', 'webhook'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Resposta = { status: (n: number) => { send: (o: unknown) => unknown } };

function recusarSemAdmin(req: { headers: Record<string, unknown>; log: { warn: (o: unknown, m: string) => void } }, resposta: Resposta) {
  try {
    exigirAdmin(req.headers['x-farol-admin'] as string | undefined);
    return null;
  } catch (e) {
    if (e instanceof ErroDeAuth) {
      req.log.warn({ motivo: e.motivo }, 'credencial recusada');
      return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
    }
    throw e;
  }
}

export function rotasDeTransportes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/v1/distribuicao/transportes', async (req, resposta) => {
    const recusa = recusarSemAdmin(req, resposta);
    if (recusa) return recusa;

    const corpo = (req.body ?? {}) as { nome?: unknown; tipos?: unknown };
    // O token é a ÚNICA coisa secreta aqui, e quem o gera é o servidor: um corpo trazendo token ou senha é engano.
    // (A lista comum de campos proibidos não tem "token"; ela vale para rotas em que a palavra pode ser outra coisa.)
    const proibido =
      acharCampoProibido(corpo) ??
      Object.keys(corpo).find((k) => ['token', 'token_hash', 'tokenhash'].includes(k.toLowerCase())) ??
      null;
    if (proibido) {
      return resposta.status(400).send({
        erro: 'segredo_no_corpo',
        mensagem: `campo "${proibido}" não entra aqui: o token do transporte é gerado pelo servidor`,
      });
    }
    const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
    if (!nome || nome.length > 60) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'nome: de 1 a 60 caracteres (ex.: n8n, regem)' });
    }
    const tipos = Array.isArray(corpo.tipos) ? [...new Set(corpo.tipos)] : [];
    if (tipos.length === 0 || !tipos.every((x) => (TIPOS_DE_DESTINO as readonly unknown[]).includes(x))) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: `tipos: pelo menos um de ${TIPOS_DE_DESTINO.join(', ')} — o que este transporte entrega`,
      });
    }

    const token = gerarTokenDeTransporte();
    try {
      const { rows } = await pool.query(
        `insert into transporte (nome, tipos, token_hash)
         values ($1, $2, $3)
         returning id, nome, tipos, criado_em`,
        [nome, tipos, hashDoToken(token)],
      );
      return resposta.status(201).send({
        ...rows[0],
        // Aparece UMA vez. O banco guarda só o resumo.
        token,
        aviso: 'guarde o token agora: ele não pode ser recuperado',
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        return resposta.status(409).send({
          erro: 'nome_em_uso',
          mensagem: `já há um transporte valendo com o nome "${nome}": revogue o antigo ou use outro nome`,
        });
      }
      throw e;
    }
  });

  app.get('/v1/distribuicao/transportes', async (req, resposta) => {
    const recusa = recusarSemAdmin(req, resposta);
    if (recusa) return recusa;
    const { rows } = await pool.query(
      `select id, nome, tipos, criado_em, usado_em, revogado_em
         from transporte
        order by criado_em, id`,
    );
    return { transportes: rows };
  });

  app.post('/v1/distribuicao/transportes/:id/revogar', async (req, resposta) => {
    const recusa = recusarSemAdmin(req, resposta);
    if (recusa) return recusa;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(404).send({ erro: 'nao_encontrado' });
    // Revogar de novo não muda a hora da primeira revogação.
    const { rows } = await pool.query(
      `update transporte
          set revogado_em = coalesce(revogado_em, now())
        where id = $1
      returning id, nome, tipos, revogado_em`,
      [id],
    );
    if (rows.length === 0) return resposta.status(404).send({ erro: 'nao_encontrado' });
    return { transporte: rows[0] };
  });
}
