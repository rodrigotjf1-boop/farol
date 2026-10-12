// =====================================================================
// A porta para outro sistema — o acesso, e o envio das fichas
// =====================================================================
// Pedido do dono em 11/10/2026: a operação que não usa o Regem manda as
// fichas dela ao Farol por uma porta documentada, e o acesso é criado PELO
// PRÓPRIO USUÁRIO, no console — ninguém da distribuição cola credencial por
// cliente. Protótipo aprovado no mesmo dia.
//
// Dois lados moram aqui:
//
//   O CONSOLE (com sessão)
//     GET    /v1/acessos       os acessos da conta, e as lojas com a origem
//                              das fichas de cada uma (quem configura vê);
//     POST   /v1/acessos       cria o acesso de uma loja (só a diretoria): a
//                              resposta traz o CÓDIGO, e é a única vez;
//     DELETE /v1/acessos/:id   revoga (só a diretoria): o sistema deixa de
//                              conseguir enviar na hora, e as fichas que ele
//                              mandou são apagadas.
//
//   A PORTA (sem sessão; `Authorization: Bearer <código de acesso>`)
//     PUT    /v1/integracao/fichas   o sistema envia as fichas da loja. O
//                                    envio é a base INTEIRA: troca o que
//                                    havia;
//     GET    /v1/integracao/fichas   o que o Farol tem desse sistema — para
//                                    quem integra conferir o código e o envio.
//
// O CÓDIGO É SEGREDO. O banco guarda só a impressão dele: quem lê o banco
// não envia nada, e nem a distribuição vê o código de um acesso já criado.
// Ele não entra em registro. A loja e a conta saem DO ACESSO, nunca do corpo
// do envio — trocar um campo não escreve na loja do vizinho.
//
// UMA LOJA RECEBE AS FICHAS DE UM LUGAR SÓ. A loja ligada ao Regem não ganha
// acesso, e a loja com acesso não é ligada ao Regem nem importa planilha. As
// duas pontas travam a linha da loja antes de conferir, para duas pessoas ao
// mesmo tempo não deixarem a loja com as duas origens. A loja com fichas de
// PLANILHA pode ganhar acesso: as da planilha ficam até o sistema enviar as
// dele, e aí as do sistema entram no lugar.
//
// O QUE ENTRA. A forma errada recusa o envio inteiro (422, com o caminho do
// campo). O conteúdo errado deixa aquele produto de fora, e os outros entram
// — a mesma regra da planilha (decisão do dono: "entra o que está certo e a
// tela lista o que ficou de fora"). A resposta diz o que ficou de fora.
// =====================================================================

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { hashDoToken } from '../auth.js';
import { impressaoDaBase } from '../fichas.js';
import { lerEnvio, type Envio } from '../porta-fichas.js';
import { ehDiretoria, exigirDiretoria, podeConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O maior envio que a porta aceita: as fichas de uma loja cabem com folga. */
const MAX_DO_ENVIO = 8 * 1024 * 1024;
/** O tamanho do nome que a conta dá ao sistema (a mesma regra está no banco). */
const MAX_DO_NOME = 40;
/** Como todo código de acesso começa: é por aqui que um caça-segredos o reconhece num arquivo. */
export const PREFIXO_DO_CODIGO = 'farol_';

/** De onde vêm as fichas de uma loja, para a tela dizer por que ela pode (ou não) ganhar um acesso. */
export type OrigemDaLoja = 'livre' | 'planilha' | 'regem' | 'sistema';

/** O registro do último envio, como fica guardado junto da base (`fichas_da_loja.importacao`). */
export type UltimoEnvio = {
  arquivo: '';
  em: string;
  por: { id: string; nome: string };
  contas: Envio['contas'];
  semFicha: Envio['semFicha'];
  deFora: Envio['deFora'];
  soltos: Envio['soltos'];
  problemas: number;
};

type AcessoQueEnvia = { id: string; tenant_id: string; loja_id: string; nome: string; loja_nome: string };

/** O nome do sistema, como a conta o escreveu: sem espaço sobrando e sem caractere de controle. Nulo = não serve. */
function nomeDoSistema(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const limpo = [...v]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.length >= 1 && limpo.length <= MAX_DO_NOME ? limpo : null;
}

export function rotasDeAcessos(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }

  // ───────────────────────── o console: os acessos da conta ─────────────────────────

  app.get('/v1/acessos', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!podeConfigurar(s)) {
      return resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não vê as conexões da conta' });
    }

    const [acessos, lojas] = await Promise.all([
      // A impressão do código NÃO entra nesta consulta: o que a tela não mostra, a rota nem busca.
      pool.query<{ id: string; nome: string; loja_id: string; loja_nome: string; fuso: string | null; criado_em: Date; recebido_em: Date | null; produtos: number | null; com_ficha: number | null }>(
        `select a.id, a.nome, a.loja_id, l.nome as loja_nome, l.timezone as fuso, a.criado_em, a.recebido_em,
                f.produtos, f.com_ficha
           from acesso_externo a
           join loja l on l.id = a.loja_id
           left join fichas_da_loja f on f.loja_id = a.loja_id and f.fonte = 'sistema'
          where a.tenant_id = $1 and a.revogado_em is null
          order by l.nome, a.id`,
        [s.tenantId],
      ),
      pool.query<{ id: string; nome: string; do_regem: boolean; com_acesso: boolean; fonte: string | null }>(
        `select l.id, l.nome,
                exists (select 1 from regem_loja r where r.loja_id = l.id) as do_regem,
                exists (select 1 from acesso_externo a where a.loja_id = l.id and a.revogado_em is null) as com_acesso,
                (select f.fonte from fichas_da_loja f where f.loja_id = l.id) as fonte
           from loja l
          where l.tenant_id = $1
          order by l.nome, l.id`,
        [s.tenantId],
      ),
    ]);

    return {
      /** Só a diretoria cria e revoga: a tela mostra o botão ou a frase. */
      podeCriar: ehDiretoria(s),
      acessos: acessos.rows.map((a) => ({
        id: a.id,
        nome: a.nome,
        lojaId: a.loja_id,
        lojaNome: a.loja_nome,
        /** O relógio da loja: é nele que a tela diz "hoje, 14:02". */
        fuso: a.fuso,
        criadoEm: a.criado_em,
        /** O último envio que o Farol aceitou. Nulo = o sistema ainda não enviou nada. */
        recebidoEm: a.recebido_em,
        /** O que a base da loja tem DESTE sistema. Nulo = ainda não há (a loja pode ter fichas de planilha). */
        produtos: a.produtos,
        comFicha: a.com_ficha,
      })),
      /** As lojas da conta e de onde cada uma recebe as fichas: só a livre e a de planilha podem ganhar acesso. */
      lojas: lojas.rows.map((l) => ({
        id: l.id,
        nome: l.nome,
        origem: (l.do_regem ? 'regem' : l.com_acesso ? 'sistema' : l.fonte === 'planilha' ? 'planilha' : 'livre') satisfies OrigemDaLoja,
      })),
    };
  });

  // ───────────────────────── o console: criar ─────────────────────────

  app.post('/v1/acessos', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;

    const corpo = (req.body ?? {}) as { nome?: unknown; lojaId?: unknown };
    const nome = nomeDoSistema(corpo.nome);
    if (nome === null) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: `diga o nome do sistema, com até ${MAX_DO_NOME} letras` });
    }
    if (typeof corpo.lojaId !== 'string' || !UUID.test(corpo.lojaId)) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'escolha a loja que vai receber' });
    }
    const lojaId = corpo.lojaId.toLowerCase();

    const codigo = PREFIXO_DO_CODIGO + randomBytes(32).toString('base64url');
    // Client dedicado: a trava da loja e as conferências só valem na MESMA conexão.
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // A linha da loja fica travada até o fim: quem estiver ligando esta loja ao Regem espera aqui (e vice-versa).
      // A trava é a que NÃO barra quem só aponta para a loja (`no key update`): gravar um evento dela continua passando.
      const loja = await cliente.query<{ nome: string }>('select nome from loja where id = $1 and tenant_id = $2 for no key update', [lojaId, s.tenantId]);
      if (loja.rows.length === 0) {
        await cliente.query('rollback');
        return resposta.status(404).send({ erro: 'loja_nao_encontrada', mensagem: 'não existe essa loja' });
      }
      const [doRegem, jaTem, base] = [
        await cliente.query('select 1 from regem_loja where loja_id = $1', [lojaId]),
        await cliente.query<{ nome: string }>('select nome from acesso_externo where loja_id = $1 and revogado_em is null', [lojaId]),
        await cliente.query<{ fonte: string }>('select fonte from fichas_da_loja where loja_id = $1', [lojaId]),
      ];
      if (doRegem.rows.length > 0) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'origem_ocupada',
          mensagem: 'esta loja recebe as fichas do Regem. Uma loja recebe de um lugar só: para outro sistema enviar, desconecte a loja do Regem antes',
        });
      }
      if (jaTem.rows.length > 0) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'ja_tem_acesso',
          mensagem: `esta loja já tem um acesso (${jaTem.rows[0]!.nome}). O acesso vale para uma loja: para trocar de sistema, revogue o que existe e crie outro`,
        });
      }
      const criado = await cliente.query<{ id: string; criado_em: Date }>(
        `insert into acesso_externo (tenant_id, loja_id, nome, token_hash, criado_por)
         values ($1, $2, $3, $4, $5)
         returning id, criado_em`,
        [s.tenantId, lojaId, nome, hashDoToken(codigo), s.usuarioId],
      );
      await cliente.query('commit');

      // Sem o código: ele não entra em registro nenhum.
      req.log.info({ acesso: criado.rows[0]!.id, loja: lojaId, usuario: s.usuarioId }, 'porta: acesso criado');
      return resposta
        .status(201)
        .header('cache-control', 'no-store')
        .send({
          id: criado.rows[0]!.id,
          nome,
          lojaId,
          lojaNome: loja.rows[0]!.nome,
          criadoEm: criado.rows[0]!.criado_em,
          /** O código de acesso. Aparece AQUI, uma vez: o Farol não o guarda, e não o mostra de novo. */
          codigo,
          /** A loja tem fichas de planilha: elas ficam até o sistema enviar as dele. */
          temPlanilha: base.rows[0]?.fonte === 'planilha',
        });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────────────── o console: revogar ─────────────────────────

  app.delete('/v1/acessos/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });

    // Uma instrução só: o acesso deixa de valer e as fichas que ele mandou saem juntos. As de planilha (a loja
    // que ganhou o acesso e o sistema ainda não enviou nada) ficam: não foi ele que as mandou.
    const { rows } = await pool.query<{ loja_id: string; apagadas: number }>(
      `with revogado as (
         update acesso_externo
            set revogado_em = now(), revogado_por = $3
          where id = $1 and tenant_id = $2 and revogado_em is null
          returning loja_id
       ), apagadas as (
         delete from fichas_da_loja f using revogado r
          where f.loja_id = r.loja_id and f.fonte = 'sistema'
          returning f.loja_id
       )
       select r.loja_id, (select count(*)::int from apagadas) as apagadas from revogado r`,
      [id.toLowerCase(), s.tenantId, s.usuarioId],
    );
    if (rows.length === 0) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'não existe esse acesso' });

    req.log.info({ acesso: id, loja: rows[0]!.loja_id, usuario: s.usuarioId, fichasApagadas: rows[0]!.apagadas > 0 }, 'porta: acesso revogado');
    return { revogado: true, /** As fichas que o sistema tinha mandado foram apagadas. */ fichasApagadas: rows[0]!.apagadas > 0 };
  });

  // ───────────────────────── a porta: quem está enviando ─────────────────────────

  async function quemEnvia(req: FastifyRequest, resposta: FastifyReply): Promise<AcessoQueEnvia | null> {
    const cabecalho = req.headers.authorization;
    const [esquema, valor] = (cabecalho ?? '').split(' ');
    if (!cabecalho || esquema?.toLowerCase() !== 'bearer' || !valor?.trim()) {
      resposta.status(401).send({ erro: 'sem_credencial', mensagem: 'envie o código de acesso no cabeçalho Authorization: Bearer <código>' });
      return null;
    }
    const hash = hashDoToken(valor.trim());
    const { rows } = await pool.query<AcessoQueEnvia & { revogado_em: Date | null }>(
      `select a.id, a.tenant_id, a.loja_id, a.nome, a.revogado_em, l.nome as loja_nome
         from acesso_externo a
         join loja l on l.id = a.loja_id
        where a.token_hash = $1`,
      [hash],
    );
    const a = rows[0];
    // A mesma resposta para o código que nunca existiu e para o digitado errado: não há o que distinguir.
    if (!a) {
      resposta.status(401).send({ erro: 'credencial_invalida', mensagem: 'código de acesso inválido' });
      return null;
    }
    if (a.revogado_em !== null) {
      // Esta é específica: só quem TEM o código chega aqui, e saber que ele foi revogado (e não digitado errado)
      // é a diferença entre pedir outro em um minuto e procurar defeito no próprio sistema.
      resposta.status(401).send({ erro: 'acesso_revogado', mensagem: 'este acesso foi revogado. Peça outro a quem cuida da conta no Farol' });
      return null;
    }
    return { id: a.id, tenant_id: a.tenant_id, loja_id: a.loja_id, nome: a.nome, loja_nome: a.loja_nome };
  }

  // ───────────────────────── a porta: o envio ─────────────────────────

  app.put('/v1/integracao/fichas', { bodyLimit: MAX_DO_ENVIO }, async (req, resposta) => {
    const acesso = await quemEnvia(req, resposta);
    if (!acesso) return;

    const envio = lerEnvio(req.body);
    if (envio.impede !== null) return resposta.status(422).send({ erro: 'envio_invalido', mensagem: envio.impede });

    const relatorio = { produtos: envio.contas.produtos, comFicha: envio.contas.comFicha, semFicha: envio.semFicha, deFora: envio.deFora, soltos: envio.soltos, problemas: envio.problemas };
    if (envio.contas.produtos === 0) {
      return resposta.status(422).send({
        erro: 'nada_a_receber',
        mensagem: 'nenhum produto do envio está certo, e nada foi recebido. As fichas que a loja tem continuam como estavam',
        ...relatorio,
      });
    }

    const impressao = impressaoDaBase(envio.base);
    const antes = await pool.query<{ impressao: string }>('select impressao from fichas_da_loja where loja_id = $1', [acesso.loja_id]);
    const registro: UltimoEnvio = {
      arquivo: '',
      em: new Date().toISOString(),
      por: { id: acesso.id, nome: acesso.nome },
      contas: envio.contas,
      semFicha: envio.semFicha,
      deFora: envio.deFora,
      soltos: envio.soltos,
      problemas: envio.problemas,
    };
    // A base é trocada INTEIRA, numa instrução só — e só se o acesso continua valendo (alguém pode tê-lo
    // revogado entre a conferência do código e agora). A data da base só anda se o documento mudou.
    const gravou = await pool.query(
      `with valendo as (
         update acesso_externo set recebido_em = now()
          where id = $1 and revogado_em is null
          returning loja_id, tenant_id
       )
       insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha, atualizada_em, importacao)
       select v.loja_id, v.tenant_id, 'sistema', $2::jsonb, $3, $4, $5, now(), $6::jsonb
         from valendo v
       on conflict (loja_id) do update
          set tenant_id = excluded.tenant_id, fonte = excluded.fonte, conteudo = excluded.conteudo, impressao = excluded.impressao,
              produtos = excluded.produtos, com_ficha = excluded.com_ficha, importacao = excluded.importacao,
              atualizada_em = case when fichas_da_loja.impressao is distinct from excluded.impressao then now() else fichas_da_loja.atualizada_em end`,
      [acesso.id, JSON.stringify(envio.base), impressao, envio.contas.produtos, envio.contas.comFicha, JSON.stringify(registro)],
    );
    if ((gravou.rowCount ?? 0) === 0) {
      return resposta.status(401).send({ erro: 'acesso_revogado', mensagem: 'este acesso foi revogado. Peça outro a quem cuida da conta no Farol' });
    }

    req.log.info({ acesso: acesso.id, loja: acesso.loja_id, ...envio.contas, deFora: envio.deFora.length, problemas: envio.problemas }, 'porta: fichas recebidas');
    return {
      /** `atualizada`: as fichas da loja mudaram. `nada_mudou`: o envio traz o que a loja já tinha. */
      resultado: antes.rows[0]?.impressao === impressao ? 'nada_mudou' : 'atualizada',
      ...relatorio,
    };
  });

  // O que o Farol tem deste sistema: para quem integra conferir o código e o último envio.
  app.get('/v1/integracao/fichas', async (req, resposta) => {
    const acesso = await quemEnvia(req, resposta);
    if (!acesso) return;
    const { rows } = await pool.query<{ recebido_em: Date | null; produtos: number | null; com_ficha: number | null }>(
      `select a.recebido_em, f.produtos, f.com_ficha
         from acesso_externo a
         left join fichas_da_loja f on f.loja_id = a.loja_id and f.fonte = 'sistema'
        where a.id = $1`,
      [acesso.id],
    );
    return resposta.header('cache-control', 'no-store').send({
      /** O nome que a conta deu a este sistema. */
      sistema: acesso.nome,
      /** A loja para a qual este código envia. */
      loja: acesso.loja_nome,
      /** O último envio aceito. Nulo = ainda não houve. */
      recebidoEm: rows[0]?.recebido_em ?? null,
      produtos: rows[0]?.produtos ?? null,
      comFicha: rows[0]?.com_ficha ?? null,
    });
  });
}
