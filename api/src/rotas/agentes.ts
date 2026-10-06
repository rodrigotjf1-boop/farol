// =====================================================================
// Agentes — provisionamento, ativação e sinal de vida
// =====================================================================
// Provisionar é operação da **distribuição**, não do lojista: o usuário
// nunca manuseia credencial de integração. Quem cria o agente e vê o
// token uma vez é a Regem; o lojista só instala.
//
// A ativação **amarra o token a uma máquina**. O token sozinho não basta
// para sempre: na primeira ativação ele registra o fingerprint, e a
// partir daí o mesmo token numa máquina diferente é recusado. É o que
// impede que um token copiado de uma loja vire um segundo agente em
// outro lugar, mandando evento em nome dela.
//
// Reativação com o MESMO fingerprint é aceita de propósito: o agente
// reinicia, o contêiner sobe de novo, a loja reinstala na mesma máquina.
// Tratar isso como ataque criaria chamado onde não há problema.
// =====================================================================

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import {
  autenticarAgente,
  ErroDeAuth,
  exigirAdmin,
  gerarToken,
  hashDoToken,
} from '../auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function responderErro(e: unknown, req: { log: { warn: (o: unknown, m: string) => void } }, resposta: {
  status: (n: number) => { send: (o: unknown) => unknown };
}) {
  if (e instanceof ErroDeAuth) {
    req.log.warn({ motivo: e.motivo }, 'credencial recusada');
    return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
  }
  throw e;
}

export function rotasDeAgentes(app: FastifyInstance, pool: pg.Pool): void {
  // ─────────────── distribuição: cria e mostra o token UMA vez ───────────────

  app.post('/v1/distribuicao/agentes', async (req, resposta) => {
    try {
      exigirAdmin(req.headers['x-farol-admin'] as string | undefined);
    } catch (e) {
      return responderErro(e, req, resposta);
    }

    const corpo = req.body as { lojaId?: string; nome?: string };
    if (!corpo?.lojaId || !UUID.test(corpo.lojaId)) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'lojaId: uuid obrigatório' });
    }
    if (!corpo?.nome?.trim()) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'nome obrigatório' });
    }

    const token = gerarToken();
    // `fingerprint` é NOT NULL e único na 001, mas a máquina só se
    // apresenta na ativação. O marcador provisório satisfaz a restrição
    // sem fingir conhecer um hardware que ainda não existe.
    const provisorio = `pendente:${randomUUID()}`;

    try {
      const { rows } = await pool.query(
        `insert into agente (loja_id, nome, fingerprint, estado, token_hash, token_emitido_em)
         values ($1, $2, $3, 'novo', $4, now())
         returning id, nome, estado`,
        [corpo.lojaId, corpo.nome.trim(), provisorio, hashDoToken(token)],
      );
      return resposta.status(201).send({
        ...rows[0],
        lojaId: corpo.lojaId,
        // Aparece UMA vez. O banco guarda só o hash — nem quem administra
        // consegue recuperá-lo depois.
        token,
        aviso: 'guarde o token agora: ele não pode ser recuperado',
      });
    } catch (e) {
      const erro = e as { code?: string };
      if (erro.code === '23503') {
        return resposta.status(422).send({ erro: 'loja_inexistente', mensagem: 'lojaId não existe' });
      }
      throw e;
    }
  });

  // ───────────────────────── agente: ativação ─────────────────────────

  app.post('/v1/agentes/ativar', async (req, resposta) => {
    let quem;
    try {
      quem = await autenticarAgente(pool, req.headers.authorization, ['novo', 'ativo']);
    } catch (e) {
      return responderErro(e, req, resposta);
    }

    const corpo = req.body as { fingerprint?: string; versao?: string };
    const fingerprint = corpo?.fingerprint?.trim();
    if (!fingerprint) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'fingerprint obrigatório' });
    }

    if (quem.estado === 'ativo') {
      if (quem.fingerprint !== fingerprint) {
        // Token válido numa máquina que não é a dele. Pode ser clone, pode
        // ser troca legítima de PC — mas quem decide é uma pessoa, não a API.
        req.log.warn(
          { agente: quem.agenteId, loja: quem.lojaId },
          'token de agente usado em máquina diferente',
        );
        return resposta.status(409).send({
          erro: 'token_vinculado',
          mensagem:
            'este token já está vinculado a outra máquina. Trocar de equipamento exige emitir um token novo.',
        });
      }
      await pool.query(
        'update agente set versao = coalesce($2, versao), ultimo_heartbeat = now() where id = $1',
        [quem.agenteId, corpo.versao ?? null],
      );
      return { id: quem.agenteId, estado: 'ativo', jaEstavaAtivo: true };
    }

    try {
      const { rows } = await pool.query(
        `update agente
            set fingerprint = $2, versao = $3, estado = 'ativo',
                ultimo_heartbeat = now(), atualizado_em = now()
          where id = $1
         returning id, estado`,
        [quem.agenteId, fingerprint, corpo.versao ?? null],
      );
      return resposta.status(200).send({ ...rows[0], jaEstavaAtivo: false });
    } catch (e) {
      const erro = e as { code?: string };
      if (erro.code === '23505') {
        // Outro agente já registrou esta máquina. Acontece quando se
        // reinstala sem revogar o anterior — e seguir em frente deixaria
        // dois agentes mandando evento pela mesma câmera.
        return resposta.status(409).send({
          erro: 'maquina_ja_registrada',
          mensagem: 'já existe um agente com este fingerprint. Revogue o anterior antes.',
        });
      }
      throw e;
    }
  });

  // ──────────────────────── agente: sinal de vida ────────────────────────

  app.post('/v1/agentes/heartbeat', async (req, resposta) => {
    let quem;
    try {
      quem = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      return responderErro(e, req, resposta);
    }

    const corpo = (req.body ?? {}) as { versao?: string };
    await pool.query(
      `update agente
          set ultimo_heartbeat = now(), versao = coalesce($2, versao)
        where id = $1`,
      [quem.agenteId, corpo.versao ?? null],
    );
    const l = await pool.query(`select config_versao from loja where id = $1`, [
      quem.lojaId,
    ]);

    // Os comandos pendentes saem JÁ MARCADOS como entregues, na mesma
    // instrução, com `skip locked`. Entregar e marcar em dois tempos faria
    // dois heartbeats simultâneos — o agente reiniciando enquanto o antigo
    // ainda responde — levarem o mesmo comando e capturarem duas vezes.
    //
    // Expirado nunca sai: um agente que ficou offline acorda horas depois,
    // e a tela que pediu o quadro já foi fechada. Capturar ali seria
    // produzir imagem de cena real que ninguém está esperando.
    const comandos = await pool.query(
      `update comando_agente
          set estado = 'entregue', entregue_em = now()
        where id in (
          select id from comando_agente
           where agente_id = $1 and estado = 'pendente' and expira_em > now()
           order by criado_em
           for update skip locked
        )
      returning id, tipo, ponto_id, parametros, expira_em`,
      [quem.agenteId],
    );

    // Devolve o relógio do servidor: é como o agente percebe que o PC da
    // loja está com a hora errada, que é a causa silenciosa de evento
    // chegando com horário impossível.
    return {
      ok: true,
      agora: new Date().toISOString(),
      // Um inteiro, não a configuração. O agente compara com o que tem e
      // só puxa `/v1/agentes/configuracao` quando difere — assim a
      // configuração inteira não trafega a cada batida.
      configVersao: l.rows[0]?.config_versao ?? null,
      comandos: comandos.rows.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        pontoId: c.ponto_id,
        parametros: c.parametros,
        expiraEm: c.expira_em,
      })),
    };
  });
}
