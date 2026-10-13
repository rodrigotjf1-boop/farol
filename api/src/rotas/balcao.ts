// =====================================================================
// O balcão — o cadastro (só a distribuição)
// =====================================================================
// "A dúvida passa pelo nosso servidor" (dono, 12/10/2026; plano aprovado em
// 13/10): a loja entrega a imagem, e é o servidor que pergunta à
// plataforma. Para isso cada loja precisa de três coisas, que moram aqui:
//
//   • a CONTA DE IA dela — de que plataforma é, e a chave, guardada
//     cifrada ("só a conta do lojista, com a chave dele guardada cifrada no
//     nosso servidor");
//   • a CHAVE INTERNA `duvida_pelo_servidor` — desligada, o agente pergunta
//     como sempre perguntou;
//   • o TETO de gasto por dia, que o servidor corta antes de perguntar
//     (R$ 40,00 no piloto).
//
// Tudo isto é da distribuição (`x-farol-admin`), como a chave do pedido com
// contexto: como o Farol pergunta, e a quem, é lógica interna. Não há rota
// do console para nada daqui, de propósito — a tela "conectar a conta de
// IA" é outra entrega, com protótipo antes.
//
// **A chave da conta nunca sai.** Entra por UM lugar (o PUT daqui), é
// cifrada na hora, presa à loja, e nenhuma rota a devolve — nem inteira,
// nem um pedaço. Não vai para registro, nem em mensagem de erro. Quem a lê
// de volta é só `contaDeIaDaLoja`, para quem vai perguntar.
//
// Esta fatia é só o cadastro: ninguém pergunta nada a plataforma nenhuma.
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import pg from 'pg';

import { ErroDeAuth, exigirAdmin } from '../auth.js';
import { lerChaveDaConta } from '../balcao/plataformas.js';
import { cifrar, decifrar } from '../cifra.js';
import { sqlDoDiaDaOperacao } from './especialista.js';
import { acharCampoProibido } from './lojas.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O maior teto que se aceita: R$ 10.000,00 por dia. Acima disso é erro de digitação, não teto. */
export const TETO_MAXIMO_CENTAVOS = 1_000_000;

/**
 * O contexto que entra na cifra da chave: a chave da loja A, colada na
 * linha da loja B, não abre.
 */
export const contextoDaContaDeIa = (tenantId: string, lojaId: string): string => `conta-ia:${tenantId}:${lojaId}`;

export type ContaDeIa = { provedor: string; chave: string };

/**
 * A conta de IA da loja, com a chave em claro — só para QUEM VAI PERGUNTAR.
 * `null` quando a loja não tem conta, quando o cofre não está configurado
 * ou quando o que está guardado não abre (outra chave do cofre, linha
 * mexida): em todos os casos, não há com que perguntar.
 */
export async function contaDeIaDaLoja(pool: pg.Pool, cofre: Buffer | null, lojaId: string): Promise<ContaDeIa | null> {
  if (!cofre) return null;
  const { rows } = await pool.query<{ tenant_id: string; provedor: string; chave_cifrada: string }>(
    'select tenant_id, provedor, chave_cifrada from conta_ia where loja_id = $1',
    [lojaId],
  );
  const linha = rows[0];
  if (!linha) return null;
  const chave = decifrar(linha.chave_cifrada, cofre, contextoDaContaDeIa(linha.tenant_id, lojaId));
  return chave === null ? null : { provedor: linha.provedor, chave };
}

type Estado = {
  id: string;
  nome: string;
  tenant_id: string;
  duvida_pelo_servidor: boolean;
  teto_duvida_centavos_dia: number;
  pedido_com_contexto: boolean;
  config_versao: number;
  provedor: string | null;
  atualizada_em: Date | null;
};

const ESTADO = `
  select l.id, l.nome, l.tenant_id, l.duvida_pelo_servidor, l.teto_duvida_centavos_dia, l.pedido_com_contexto,
         l.config_versao, c.provedor, c.atualizada_em
    from loja l
    left join conta_ia c on c.loja_id = l.id
   where l.id = $1`;

/** O que a distribuição vê do balcão de uma loja. A chave da conta não está aqui, nem um pedaço dela. */
const apresentar = (e: Estado) => ({
  id: e.id,
  nome: e.nome,
  ligado: e.duvida_pelo_servidor,
  tetoCentavosDia: e.teto_duvida_centavos_dia,
  pedidoComContexto: e.pedido_com_contexto,
  configVersao: e.config_versao,
  contaDeIa: e.provedor ? { provedor: e.provedor, atualizadaEm: e.atualizada_em } : null,
});

export function rotasDoBalcao(app: FastifyInstance, pool: pg.Pool, opcoes: { cofre: Buffer | null }): void {
  /** Toda rota daqui começa por aqui. `false` = já respondeu. */
  function distribuicao(req: FastifyRequest, resposta: FastifyReply): boolean {
    try {
      exigirAdmin(req.headers['x-farol-admin'] as string | undefined);
      return true;
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial de distribuição recusada');
        resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
        return false;
      }
      throw e;
    }
  }

  const naoAchei = (resposta: FastifyReply) =>
    resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });

  /** Só as chaves esperadas: campo com o nome errado não pode passar por "não mudei nada". */
  function campoDesconhecido(corpo: Record<string, unknown>, aceitos: string[]): string | null {
    return Object.keys(corpo).find((k) => !aceitos.includes(k)) ?? null;
  }

  // ───────────────────────── como está ─────────────────────────

  app.get('/v1/distribuicao/lojas/:id/balcao', async (req, resposta) => {
    if (!distribuicao(req, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);
    const { rows } = await pool.query<Estado>(ESTADO, [id]);
    if (rows.length === 0) return naoAchei(resposta);

    // O dia de hoje, na conta da loja: quantas dúvidas o servidor fez por ela e quanto custaram. O dia é
    // o da operação — a madrugada pertence à noite anterior —, o mesmo por que o teto é somado.
    const DIA = sqlDoDiaDaOperacao('now()', 'l.timezone');
    const hoje = (
      await pool.query<{ dia: string; duvidas: number; respondidas: number; falharam: number; reconsultas: number; custo: number }>(
        `select ${DIA} as dia,
                count(d.id)::int as duvidas,
                count(d.id) filter (where d.estado = 'respondida')::int as respondidas,
                count(d.id) filter (where d.estado = 'falhou')::int as falharam,
                count(d.id) filter (where d.reconsultou)::int as reconsultas,
                coalesce(sum(d.custo_centavos), 0)::float8 as custo
           from loja l
           left join duvida d on d.loja_id = l.id and d.dia = (${DIA})::date
          where l.id = $1
          group by l.id`,
        [id],
      )
    ).rows[0]!;
    return {
      ...apresentar(rows[0]!),
      hoje: {
        dia: hoje.dia, duvidas: hoje.duvidas, respondidas: hoje.respondidas, falharam: hoje.falharam,
        reconsultas: hoje.reconsultas, custoCentavos: hoje.custo,
      },
    };
  });

  // ───────────────────── a chave interna e o teto ─────────────────────
  //
  // Ligar pede duas coisas da loja, e recusa dizendo qual falta:
  //   • a chave do pedido com contexto ligada — o balcão só fala o pedido
  //     com contexto (o de antes voltou sem resposta em 1.483 das 1.722
  //     análises pagas de 07 e 08/10/2026 — docs/decisoes.md, "O motor que
  //     aprende" — e não foi levado para o servidor);
  //   • a conta de IA cadastrada — sem ela não há com que perguntar.
  //
  // As duas valem enquanto ele estiver ligado: a conta não sai (o DELETE
  // abaixo recusa) e o pedido com contexto não desliga (a rota dele, em
  // `lojas.ts`, recusa) — as três rotas param na mesma trava da loja. No
  // banco, `loja_balcao_pede_contexto` é a segunda tranca.
  //
  // Só `true` e `false` movem a chave, e o teto é um inteiro de centavos:
  // valor parecido com o certo é recusado, não adivinhado.

  app.patch('/v1/distribuicao/lojas/:id/balcao', async (req, resposta) => {
    if (!distribuicao(req, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const invalido = (mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) return invalido('mande um objeto');
    const estranho = campoDesconhecido(corpo, ['ligado', 'tetoCentavosDia']);
    if (estranho) return invalido(`campo desconhecido: '${estranho}'. Os que existem: ligado, tetoCentavosDia`);
    const { ligado, tetoCentavosDia } = corpo;
    if (ligado === undefined && tetoCentavosDia === undefined) return invalido('nada para mudar: mande ligado ou tetoCentavosDia');
    if (ligado !== undefined && typeof ligado !== 'boolean') return invalido('ligado: true ou false');
    if (
      tetoCentavosDia !== undefined &&
      (typeof tetoCentavosDia !== 'number' || !Number.isInteger(tetoCentavosDia) || tetoCentavosDia < 0 || tetoCentavosDia > TETO_MAXIMO_CENTAVOS)
    ) {
      return invalido(`tetoCentavosDia: inteiro de 0 a ${TETO_MAXIMO_CENTAVOS} (centavos por dia)`);
    }

    // Client dedicado: a trava da loja e as conferências só valem na MESMA conexão.
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // A trava numa instrução, a conferência na seguinte: na mesma, quem esperou a trava
      // conferiria com o retrato de antes da espera (a conta sendo tirada ao mesmo tempo).
      const trava = await cliente.query('select id from loja where id = $1 for no key update', [id]);
      if (trava.rows.length === 0) {
        await cliente.query('rollback');
        return naoAchei(resposta);
      }
      const antes = (await cliente.query<Estado>(ESTADO, [id])).rows[0]!;
      if (ligado === true && !antes.pedido_com_contexto) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'sem_pedido_com_contexto',
          mensagem: 'esta loja não pergunta com contexto: ligue antes a chave do pedido com contexto. O balcão só fala esse pedido.',
        });
      }
      if (ligado === true && antes.provedor === null) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'sem_conta_de_ia',
          mensagem: 'esta loja não tem conta de IA cadastrada: sem ela o servidor não tem com que perguntar.',
        });
      }
      // A versão sobe na mesma instrução, e só quando a chave mudou de lado: é por ela que o
      // agente sabe que precisa puxar a configuração. O teto é só do servidor: não sobe versão.
      await cliente.query(
        `update loja
            set config_versao = config_versao + (duvida_pelo_servidor is distinct from coalesce($2, duvida_pelo_servidor))::int,
                atualizado_em = case
                  when duvida_pelo_servidor is distinct from coalesce($2, duvida_pelo_servidor)
                    or teto_duvida_centavos_dia is distinct from coalesce($3, teto_duvida_centavos_dia) then now()
                  else atualizado_em end,
                duvida_pelo_servidor = coalesce($2, duvida_pelo_servidor),
                teto_duvida_centavos_dia = coalesce($3, teto_duvida_centavos_dia)
          where id = $1`,
        [id, ligado ?? null, tetoCentavosDia ?? null],
      );
      const depois = (await cliente.query<Estado>(ESTADO, [id])).rows[0]!;
      await cliente.query('commit');

      // Muda o que sai da loja, e quanto se pode gastar: fica no log.
      req.log.info({ loja: id, ligado: depois.duvida_pelo_servidor, tetoCentavosDia: depois.teto_duvida_centavos_dia }, 'balcão da loja');
      return apresentar(depois);
    } catch (e) {
      await cliente.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────────────── a conta de IA ─────────────────────────
  //
  // A chave entra aqui e não sai mais. O corpo leva só `provedor` e
  // `chave`; qualquer outro campo é recusado — inclusive os que têm nome de
  // segredo (`senha`, `password`…), que não são deste cadastro.

  app.put('/v1/distribuicao/lojas/:id/conta-ia', async (req, resposta) => {
    if (!distribuicao(req, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const invalido = (mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) return invalido('mande um objeto');
    const corpo = req.body as Record<string, unknown>;
    const proibido = acharCampoProibido(corpo);
    if (proibido) {
      return resposta.status(422).send({
        erro: 'segredo_no_cadastro',
        mensagem: `o campo '${proibido}' não entra por aqui: a conta de IA leva só provedor e chave.`,
      });
    }
    const estranho = campoDesconhecido(corpo, ['provedor', 'chave']);
    if (estranho) return invalido(`campo desconhecido: '${estranho}'. Os que existem: provedor, chave`);
    const lida = lerChaveDaConta(corpo.provedor, corpo.chave);
    if ('problema' in lida) return invalido(lida.problema);

    if (!opcoes.cofre) {
      return resposta.status(503).send({
        erro: 'cofre_indisponivel',
        mensagem: 'o servidor não tem com que cifrar a chave: FAROL_CHAVE_DOS_ACESSOS ausente ou fora do formato.',
      });
    }

    const loja = await pool.query<{ tenant_id: string }>('select tenant_id from loja where id = $1', [id]);
    if (loja.rows.length === 0) return naoAchei(resposta);
    const tenantId = loja.rows[0]!.tenant_id;
    const { rows } = await pool.query<{ provedor: string; atualizada_em: Date }>(
      `insert into conta_ia (loja_id, tenant_id, provedor, chave_cifrada)
       values ($1, $2, $3, $4)
       on conflict (loja_id) do update
         set provedor = excluded.provedor, chave_cifrada = excluded.chave_cifrada, atualizada_em = now()
       returning provedor, atualizada_em`,
      [id, tenantId, lida.provedor, cifrar(lida.chave, opcoes.cofre, contextoDaContaDeIa(tenantId, id))],
    );

    // Quem, de que plataforma e quando — nunca a chave.
    req.log.info({ loja: id, provedor: lida.provedor }, 'conta de IA gravada');
    return { lojaId: id, provedor: rows[0]!.provedor, atualizadaEm: rows[0]!.atualizada_em };
  });

  app.delete('/v1/distribuicao/lojas/:id/conta-ia', async (req, resposta) => {
    if (!distribuicao(req, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // A mesma trava de quem liga o balcão: tirar a conta e ligar ao mesmo tempo não deixa
      // a loja ligada sem ter com que perguntar.
      const trava = await cliente.query('select id from loja where id = $1 for no key update', [id]);
      if (trava.rows.length === 0) {
        await cliente.query('rollback');
        return naoAchei(resposta);
      }
      const antes = (await cliente.query<Estado>(ESTADO, [id])).rows[0]!;
      if (antes.provedor === null) {
        await cliente.query('rollback');
        return resposta.status(404).send({ erro: 'sem_conta_de_ia', mensagem: 'esta loja não tem conta de IA cadastrada' });
      }
      if (antes.duvida_pelo_servidor) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'balcao_ligado',
          mensagem: 'o balcão desta loja está ligado: desligue antes de tirar a conta de IA.',
        });
      }
      await cliente.query('delete from conta_ia where loja_id = $1', [id]);
      await cliente.query('commit');
      req.log.info({ loja: id }, 'conta de IA tirada');
      return { lojaId: id, contaDeIa: null };
    } catch (e) {
      await cliente.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      cliente.release();
    }
  });
}
