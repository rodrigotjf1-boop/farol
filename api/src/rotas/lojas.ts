// =====================================================================
// POST /v1/distribuicao/lojas — nasce uma loja inteira
// =====================================================================
// Cria tenant (ou usa um existente), loja, setores e pontos numa
// transação só. Ou nasce tudo, ou não nasce nada: meia loja — com setor e
// sem ponto, ou com ponto apontando para setor de outra — é pior do que
// nenhuma, porque alguém vai tentar consertar à mão depois.
//
// **Senha de câmera não passa por aqui.** A 001 dá a `ponto` um campo
// `usuario` e um `segredo_ref`, e nenhum campo de senha: o segredo mora no
// cofre do agente, na loja. A rota recusa explicitamente um corpo que
// traga `senha`, em vez de ignorar o campo em silêncio — ignorar deixaria
// o operador achando que mandou e que está guardado.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { ErroDeAuth, exigirAdmin } from '../auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLANOS = ['trial', 'essencial', 'completo', 'local'];
const MODOS = ['nuvem', 'local', 'hibrido'];
const RESOLUCOES = ['r384', 'r640', 'r1mp', 'r1080'];
const ORIGENS = ['dvr', 'ip'];

// Nomes que, se aparecerem em qualquer nível do corpo, significam que
// alguém tentou mandar segredo pela API de cadastro.
const PROIBIDOS = new Set(['senha', 'password', 'segredo', 'secret', 'pwd', 'pass']);

export function acharCampoProibido(valor: unknown, caminho = ''): string | null {
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i += 1) {
      const achado = acharCampoProibido(valor[i], `${caminho}[${i}]`);
      if (achado) return achado;
    }
    return null;
  }
  if (typeof valor !== 'object' || valor === null) return null;

  for (const [chave, v] of Object.entries(valor)) {
    const aqui = caminho ? `${caminho}.${chave}` : chave;
    if (PROIBIDOS.has(chave.toLowerCase())) return aqui;
    const achado = acharCampoProibido(v, aqui);
    if (achado) return achado;
  }
  return null;
}

type Corpo = {
  tenantId?: string;
  tenant?: { nome?: string; documento?: string; plano?: string };
  loja?: {
    nome?: string;
    timezone?: string;
    modoJulgamento?: string;
    resolucaoPadrao?: string;
  };
  setores?: Array<{
    nome?: string;
    ordem?: number;
    pontos?: Array<{
      nome?: string;
      origem?: string;
      fabricante?: string;
      canal?: number;
      host?: string;
      porta?: number;
      usuario?: string;
    }>;
  }>;
};

export function validarCorpo(c: Corpo): string | null {
  if (!c?.loja?.nome?.trim()) return 'loja.nome é obrigatório';

  if (c.tenantId) {
    if (!UUID.test(c.tenantId)) return 'tenantId: uuid inválido';
  } else if (!c.tenant?.nome?.trim()) {
    return 'informe tenantId (empresa existente) ou tenant.nome (empresa nova)';
  }

  if (c.tenant?.plano && !PLANOS.includes(c.tenant.plano)) {
    return `tenant.plano: um de ${PLANOS.join(', ')}`;
  }
  if (c.loja.modoJulgamento && !MODOS.includes(c.loja.modoJulgamento)) {
    return `loja.modoJulgamento: um de ${MODOS.join(', ')}`;
  }
  if (c.loja.resolucaoPadrao && !RESOLUCOES.includes(c.loja.resolucaoPadrao)) {
    return `loja.resolucaoPadrao: um de ${RESOLUCOES.join(', ')}`;
  }

  for (const [i, s] of (c.setores ?? []).entries()) {
    if (!s?.nome?.trim()) return `setores[${i}].nome é obrigatório`;
    for (const [j, p] of (s.pontos ?? []).entries()) {
      const onde = `setores[${i}].pontos[${j}]`;
      if (!p?.nome?.trim()) return `${onde}.nome é obrigatório`;
      if (p.origem && !ORIGENS.includes(p.origem)) {
        return `${onde}.origem: um de ${ORIGENS.join(', ')}`;
      }
      if (p.origem === 'dvr' && p.canal == null) {
        // Ponto de DVR sem canal não resolve URL nenhuma. Melhor dizer
        // agora do que o agente descobrir na loja, na segunda-feira.
        return `${onde}.canal é obrigatório quando origem = dvr`;
      }
    }
  }
  return null;
}

export function rotasDeLojas(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/v1/distribuicao/lojas', async (req, resposta) => {
    try {
      exigirAdmin(req.headers['x-farol-admin'] as string | undefined);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial de distribuição recusada');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const corpo = (req.body ?? {}) as Corpo;

    const proibido = acharCampoProibido(corpo);
    if (proibido) {
      return resposta.status(422).send({
        erro: 'segredo_no_cadastro',
        mensagem:
          `o campo '${proibido}' não entra por aqui. Senha de câmera ou gravador fica ` +
          'no cofre do agente, na loja — o cadastro guarda só o usuário.',
      });
    }

    const problema = validarCorpo(corpo);
    if (problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }

    // Client dedicado, nunca o pool: transação só vale na MESMA conexão, e
    // o pool pode devolver outra no meio do caminho.
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      let tenantId = corpo.tenantId;
      if (!tenantId) {
        const t = await cliente.query(
          // 'trial' repetido aqui e no DEFAULT da coluna porque `default`
          // não é expressão: não entra em `coalesce`.
          "insert into tenant (nome, documento, plano) values ($1,$2,coalesce($3,'trial')) returning id",
          [corpo.tenant!.nome!.trim(), corpo.tenant!.documento ?? null, corpo.tenant!.plano ?? null],
        );
        tenantId = t.rows[0].id as string;
      }

      const l = await cliente.query(
        `insert into loja (tenant_id, nome, timezone, modo_julgamento, resolucao_padrao)
         values ($1, $2, coalesce($3,'America/Sao_Paulo'),
                 coalesce($4,'nuvem'), coalesce($5,'r640'))
         returning id, nome, timezone, modo_julgamento, resolucao_padrao`,
        [
          tenantId,
          corpo.loja!.nome!.trim(),
          corpo.loja!.timezone ?? null,
          corpo.loja!.modoJulgamento ?? null,
          corpo.loja!.resolucaoPadrao ?? null,
        ],
      );
      const loja = l.rows[0];

      const setoresCriados = [];
      for (const [i, s] of (corpo.setores ?? []).entries()) {
        const r = await cliente.query(
          'insert into setor (loja_id, nome, ordem) values ($1,$2,$3) returning id, nome',
          [loja.id, s.nome!.trim(), s.ordem ?? i],
        );
        const setor = r.rows[0];

        const pontos = [];
        for (const p of s.pontos ?? []) {
          const rp = await cliente.query(
            `insert into ponto (setor_id, nome, origem, fabricante, canal, host, porta, usuario)
             values ($1,$2,coalesce($3,'dvr'),$4,$5,$6,coalesce($7,554),$8)
             returning id, nome, origem, canal`,
            [
              setor.id,
              p.nome!.trim(),
              p.origem ?? null,
              p.fabricante ?? null,
              p.canal ?? null,
              p.host ?? null,
              p.porta ?? null,
              p.usuario ?? null,
            ],
          );
          pontos.push(rp.rows[0]);
        }
        setoresCriados.push({ ...setor, pontos });
      }

      await cliente.query('commit');

      return resposta.status(201).send({
        tenantId,
        loja: {
          id: loja.id,
          nome: loja.nome,
          timezone: loja.timezone,
          modoJulgamento: loja.modo_julgamento,
          resolucaoPadrao: loja.resolucao_padrao,
        },
        setores: setoresCriados,
        proximoPasso:
          'provisione o agente desta loja em POST /v1/distribuicao/agentes com este lojaId',
      });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      const erro = e as { code?: string; message?: string };
      if (erro.code === '23503') {
        return resposta.status(422).send({
          erro: 'tenant_inexistente',
          mensagem: 'tenantId não existe',
        });
      }
      req.log.error({ err: e, codigo: erro.code }, 'falha ao criar loja');
      throw e;
    } finally {
      // Sem isto a conexão nunca volta para o pool e, depois de algumas
      // falhas, a API para de responder sem erro nenhum no log.
      cliente.release();
    }
  });
}
