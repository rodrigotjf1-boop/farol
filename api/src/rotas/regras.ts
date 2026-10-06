// =====================================================================
// Regras — os critérios de análise
// =====================================================================
// É aqui que o produto ganha forma: uma regra diz, em português, o que
// é "conforme" naquela zona daquela câmera. O agente lê esse texto e o
// usa como pergunta ao juiz.
//
// Duas invariantes do projeto moram nestas rotas:
//
// **1 · Regra nasce DESLIGADA.** Ligar exige acurácia medida contra o
// conjunto de avaliação. Criar já ligada seria começar a alertar a
// cozinha com base em critério que ninguém conferiu — e a loja aprende
// rápido a ignorar quem erra.
//
// **2 · Mudar o critério SOBE a versão.** A chave de idempotência do
// agente inclui `criterio_versao`; sem subir, um critério reescrito
// reaproveitaria o veredito do critério antigo. A pergunta mudou, a
// resposta tem que ser nova.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { exigirConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

const TIPOS = ['estado', 'acao', 'presenca', 'contagem', 'comparacao'];
const PRIORIDADES = ['urgente', 'intermediaria', 'leve'];
const SEVERIDADES = ['info', 'atencao', 'critico', 'emergencia'];
const RESOLUCOES = ['r384', 'r640', 'r1mp', 'r1080'];
const ACOES = ['registro', 'kds', 'whatsapp', 'tarefa_regem', 'tv_regemboard'];

type Corpo = Record<string, unknown>;

function validar(c: Corpo, criando: boolean): string | null {
  if (criando) {
    if (!String(c.nome ?? '').trim()) return 'nome é obrigatório';
    if (!String(c.criterio ?? '').trim()) return 'criterio é obrigatório';
    if (!TIPOS.includes(String(c.tipo))) return `tipo: um de ${TIPOS.join(', ')}`;
  }
  if (c.tipo != null && !TIPOS.includes(String(c.tipo))) {
    return `tipo: um de ${TIPOS.join(', ')}`;
  }
  if (c.prioridade != null && !PRIORIDADES.includes(String(c.prioridade))) {
    return `prioridade: um de ${PRIORIDADES.join(', ')}`;
  }
  if (c.severidade != null && !SEVERIDADES.includes(String(c.severidade))) {
    return `severidade: um de ${SEVERIDADES.join(', ')}`;
  }
  if (c.resolucao != null && !RESOLUCOES.includes(String(c.resolucao))) {
    return `resolucao: um de ${RESOLUCOES.join(', ')}`;
  }
  if (c.confiancaMinima != null) {
    const v = Number(c.confiancaMinima);
    if (!Number.isFinite(v) || v < 0 || v > 1) return 'confiancaMinima: entre 0 e 1';
  }
  if (c.cooldownMin != null) {
    const v = Number(c.cooldownMin);
    if (!Number.isInteger(v) || v < 0) return 'cooldownMin: inteiro não negativo';
  }
  if (c.acoes != null) {
    if (!Array.isArray(c.acoes) || c.acoes.length === 0) {
      return 'acoes: ao menos uma';
    }
    const ruim = c.acoes.find((a) => !ACOES.includes(String(a)));
    if (ruim) return `acao desconhecida: ${ruim}. Válidas: ${ACOES.join(', ')}`;
  }
  if (c.janelas != null && !Array.isArray(c.janelas)) {
    return 'janelas: lista de {dias, hora_ini, hora_fim}';
  }
  return null;
}

export function rotasDeRegras(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: Parameters<typeof sessaoDe>[1], resposta: {
    status: (n: number) => { send: (o: unknown) => unknown };
  }): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }

  // ───────────────────── listar as regras da loja ─────────────────────

  app.get('/v1/lojas/:id/regras', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };

    const { rows } = await pool.query(
      `select r.id, r.nome, r.tipo, r.criterio, r.criterio_versao,
              r.processo_descricao, r.prioridade, r.severidade,
              r.confianca_minima, r.cooldown_min, r.resolucao,
              r.janelas, r.acoes, r.ativa, r.retencao_midia_dias,
              z.id as zona_id, z.nome as zona_nome,
              p.id as ponto_id, p.nome as ponto_nome, p.canal,
              st.nome as setor_nome
         from regra r
         join zona  z  on z.id  = r.zona_id
         join ponto p  on p.id  = z.ponto_id
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where l.id = $1 and l.tenant_id = $2
        order by st.nome, p.nome, r.nome`,
      [id, s.tenantId],
    );
    return { regras: rows };
  });

  // ──────────────────────── criar uma regra ───────────────────────────

  app.post('/v1/zonas/:id/regras', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const c = (req.body ?? {}) as Corpo;

    const problema = validar(c, true);
    if (problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }

    // `ativa` NÃO entra: a regra nasce desligada, sempre. Ligar é outra
    // ação, consciente, depois de medir.
    const { rows } = await pool.query(
      `insert into regra (zona_id, nome, tipo, criterio, processo_descricao,
                          prioridade, severidade, confianca_minima, cooldown_min,
                          resolucao, janelas, acoes, retencao_midia_dias)
       select z.id, $2, $3, $4, $5,
              coalesce($6,'intermediaria'), coalesce($7,'atencao'),
              coalesce($8, 0.700), coalesce($9, 15), $10,
              coalesce($11,'[]'::jsonb), coalesce($12,'["registro"]'::jsonb),
              coalesce($13, 90)
         from zona z
         join ponto p  on p.id  = z.ponto_id
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where z.id = $1 and l.tenant_id = $14
       returning id, nome, tipo, criterio, criterio_versao, prioridade,
                 severidade, confianca_minima, cooldown_min, resolucao,
                 janelas, acoes, ativa`,
      [
        id,
        String(c.nome).trim(), String(c.tipo), String(c.criterio).trim(),
        c.processoDescricao ?? null,
        c.prioridade ?? null, c.severidade ?? null,
        c.confiancaMinima ?? null, c.cooldownMin ?? null, c.resolucao ?? null,
        c.janelas ? JSON.stringify(c.janelas) : null,
        c.acoes ? JSON.stringify(c.acoes) : null,
        c.retencaoMidiaDias ?? null,
        s.tenantId,
      ],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'zona não encontrada' });
    }
    return resposta.status(201).send({
      ...rows[0],
      aviso: 'a regra nasce desligada; ligue só depois de conferir a acurácia',
    });
  });

  // ──────────────────────── editar uma regra ──────────────────────────

  app.patch('/v1/regras/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const c = (req.body ?? {}) as Corpo;

    const problema = validar(c, false);
    if (problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }

    const novoCriterio = c.criterio != null ? String(c.criterio).trim() : null;
    if (c.criterio != null && !novoCriterio) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'criterio vazio' });
    }

    // A versão sobe QUANDO E SÓ QUANDO o texto do critério muda. A chave
    // de idempotência do agente inclui essa versão: sem subir, o critério
    // reescrito reaproveitaria o veredito do critério antigo — a pergunta
    // mudou e a resposta seria a de antes.
    const { rows } = await pool.query(
      `update regra r
          set nome               = coalesce($2, r.nome),
              tipo               = coalesce($3, r.tipo),
              criterio           = coalesce($4, r.criterio),
              criterio_versao    = r.criterio_versao
                                   + case when $4 is not null and $4 <> r.criterio
                                          then 1 else 0 end,
              processo_descricao = coalesce($5, r.processo_descricao),
              prioridade         = coalesce($6, r.prioridade),
              severidade         = coalesce($7, r.severidade),
              confianca_minima   = coalesce($8, r.confianca_minima),
              cooldown_min       = coalesce($9, r.cooldown_min),
              resolucao          = coalesce($10, r.resolucao),
              janelas            = coalesce($11::jsonb, r.janelas),
              acoes              = coalesce($12::jsonb, r.acoes),
              ativa              = coalesce($13, r.ativa),
              retencao_midia_dias = coalesce($14, r.retencao_midia_dias),
              atualizado_em      = now()
         from zona z, ponto p, setor st, loja l
        where r.id = $1
          and z.id = r.zona_id and p.id = z.ponto_id
          and st.id = p.setor_id and l.id = st.loja_id
          and l.tenant_id = $15
       returning r.id, r.nome, r.tipo, r.criterio, r.criterio_versao,
                 r.prioridade, r.severidade, r.confianca_minima,
                 r.cooldown_min, r.resolucao, r.janelas, r.acoes, r.ativa`,
      [
        id,
        c.nome != null ? String(c.nome).trim() : null,
        c.tipo ?? null,
        novoCriterio,
        c.processoDescricao ?? null,
        c.prioridade ?? null, c.severidade ?? null,
        c.confiancaMinima ?? null, c.cooldownMin ?? null, c.resolucao ?? null,
        c.janelas ? JSON.stringify(c.janelas) : null,
        c.acoes ? JSON.stringify(c.acoes) : null,
        typeof c.ativa === 'boolean' ? c.ativa : null,
        c.retencaoMidiaDias ?? null,
        s.tenantId,
      ],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'regra não encontrada' });
    }

    if (typeof c.ativa === 'boolean') {
      // Ligar e desligar regra muda o que a loja recebe. Fica no log com
      // quem fez — é o mínimo até a auditoria em tabela existir.
      req.log.info(
        { regra: id, por: s.usuarioId, ativa: c.ativa },
        c.ativa ? 'regra LIGADA' : 'regra desligada',
      );
    }
    return rows[0];
  });
}
