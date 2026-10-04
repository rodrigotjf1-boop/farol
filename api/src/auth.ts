// =====================================================================
// Autenticação do agente
// =====================================================================
// O agente manda `Authorization: Bearer <token>`. O banco guarda só o
// **hash** do token — vazamento do banco não entrega escrita em loja
// nenhuma, e nem quem administra consegue ler o token de um agente já
// instalado.
//
// `tenant_id` e `loja_id` saem DAQUI, do agente autenticado, e nunca do
// corpo da requisição. É a diferença entre multi-tenant e uma promessa de
// multi-tenant: se o cliente pudesse informar a loja, bastaria trocar um
// campo para escrever na loja do vizinho.
// =====================================================================

import { createHash, timingSafeEqual } from 'node:crypto';

import type pg from 'pg';
import type { Autor } from './db.js';

export class ErroDeAuth extends Error {
  constructor(
    readonly status: number,
    readonly motivo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Comparação em tempo constante, para o erro não vazar o prefixo certo. */
export function hashesIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function extrairToken(cabecalho: string | undefined): string {
  if (!cabecalho) {
    throw new ErroDeAuth(401, 'sem_credencial', 'Authorization ausente');
  }
  const [esquema, valor] = cabecalho.split(' ');
  if (esquema?.toLowerCase() !== 'bearer' || !valor) {
    throw new ErroDeAuth(401, 'formato', 'use Authorization: Bearer <token>');
  }
  return valor.trim();
}

export async function autenticarAgente(
  pool: pg.Pool,
  cabecalho: string | undefined,
): Promise<Autor> {
  const token = extrairToken(cabecalho);
  const hash = hashDoToken(token);

  const { rows } = await pool.query(
    `select a.id, a.loja_id, a.estado, a.token_hash, l.tenant_id
       from agente a
       join loja l on l.id = a.loja_id
      where a.token_hash = $1`,
    [hash],
  );

  const agente = rows[0];
  // Mensagem idêntica para token inexistente e token errado: dizer qual dos
  // dois é confirmaria ao atacante que um token existe.
  if (!agente || !hashesIguais(agente.token_hash, hash)) {
    throw new ErroDeAuth(401, 'credencial_invalida', 'token inválido');
  }

  if (agente.estado !== 'ativo') {
    // Esta, sim, é específica: quem recebe é o dono do agente, e saber que
    // falta aprovar (e não que o token está errado) é a diferença entre
    // resolver em um minuto e abrir um chamado.
    throw new ErroDeAuth(
      403,
      `agente_${agente.estado}`,
      `agente está '${agente.estado}', não 'ativo'`,
    );
  }

  // Registra o uso sem segurar a resposta: é telemetria, não parte do
  // contrato. Se falhar, o evento ainda tem que entrar.
  void pool
    .query('update agente set token_usado_em = now() where id = $1', [agente.id])
    .catch(() => {});

  return {
    agenteId: agente.id,
    lojaId: agente.loja_id,
    tenantId: agente.tenant_id,
  };
}
