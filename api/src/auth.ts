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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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

export type AutorAgente = Autor & { estado: string; fingerprint: string };

export async function autenticarAgente(
  pool: pg.Pool,
  cabecalho: string | undefined,
  // A ativação é o único caminho que aceita um agente ainda 'novo' — é
  // justamente onde ele deixa de ser novo. Todo o resto exige 'ativo'.
  estadosAceitos: readonly string[] = ['ativo'],
): Promise<AutorAgente> {
  const token = extrairToken(cabecalho);
  const hash = hashDoToken(token);

  const { rows } = await pool.query(
    `select a.id, a.loja_id, a.estado, a.token_hash, a.fingerprint, l.tenant_id
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

  if (!estadosAceitos.includes(agente.estado)) {
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
  // contrato. Se falhar, o evento ainda tem que entrar. No máximo uma
  // escrita por minuto: a loja pergunta a fila da cozinha a cada 15 s, e
  // cada pergunta reescreveria a linha do agente.
  void pool
    .query(
      `update agente set token_usado_em = now()
        where id = $1 and (token_usado_em is null or token_usado_em < now() - interval '1 minute')`,
      [agente.id],
    )
    .catch(() => {});

  return {
    agenteId: agente.id,
    lojaId: agente.loja_id,
    tenantId: agente.tenant_id,
    estado: agente.estado,
    fingerprint: agente.fingerprint,
  };
}

/** Credencial da DISTRIBUIÇÃO, não da loja.
 *
 * Provisionar agente é operação da Regem, não do lojista — o usuário
 * nunca manuseia credencial de integração. Enquanto o console não tem
 * login, a porta é um token de ambiente; quando tiver, esta função some e
 * a autorização passa pelo perfil do usuário.
 */
export function exigirAdmin(cabecalho: string | undefined): void {
  const esperado = process.env.FAROL_ADMIN_TOKEN;
  if (!esperado) {
    // Sem token configurado a rota fica FECHADA, não aberta. O padrão
    // inseguro é o que vira incidente quando alguém esquece a variável.
    throw new ErroDeAuth(503, 'admin_nao_configurado', 'FAROL_ADMIN_TOKEN ausente');
  }
  const recebido = (cabecalho ?? '').trim();
  if (!recebido || !hashesIguais(hashDoToken(recebido), hashDoToken(esperado))) {
    throw new ErroDeAuth(401, 'admin_invalido', 'credencial de distribuição inválida');
  }
}

/** Token novo: 32 bytes de aleatoriedade real, em base64url. */
export function gerarToken(): string {
  return randomBytes(32).toString('base64url');
}

// ───────────────────── quem ENTREGA os alertas ─────────────────────
// Pedido da sessão do Hub DMS, aprovado pelo dono em 14/10/2026 (migration
// 046): as rotas do transporte aceitavam a credencial geral da
// distribuição — quem entregasse os alertas carregaria a chave que emite
// agente e cadastra loja, de todas as lojas. Agora cada transporte (o n8n,
// o Regem) tem o token dele, que só reivindica e devolve envios dos tipos
// que lhe cabem, e a chave geral não vale ali.
//
// Continua de pé o motivo de o transporte ser da distribuição e não do
// agente (ERR-016): o aviso de "o agente caiu" não pode passar pelo agente.

/** O começo do token do transporte: quem o acha num log ou numa variável sabe o que ele é — e o que ele NÃO abre. */
export const PREFIXO_TRANSPORTE = 'fart_';

export function gerarTokenDeTransporte(): string {
  return `${PREFIXO_TRANSPORTE}${gerarToken()}`;
}

export type TransporteAutenticado = { transporteId: string; nome: string; tipos: string[] };

export async function autenticarTransporte(
  pool: pg.Pool,
  cabecalho: string | undefined,
): Promise<TransporteAutenticado> {
  const token = extrairToken(cabecalho);
  // Mensagem idêntica para formato errado, token inexistente, errado ou
  // revogado: dizer qual deles confirmaria ao atacante o que existe.
  const recusa = () => new ErroDeAuth(401, 'credencial_invalida', 'token inválido');
  if (!token.startsWith(PREFIXO_TRANSPORTE)) throw recusa();
  const hash = hashDoToken(token);

  const { rows } = await pool.query(
    `select id, nome, tipos, token_hash
       from transporte
      where token_hash = $1 and revogado_em is null`,
    [hash],
  );
  const t = rows[0];
  if (!t || !hashesIguais(t.token_hash, hash)) throw recusa();

  // O último uso, sem segurar a resposta: é telemetria, não parte do contrato.
  void pool.query('update transporte set usado_em = now() where id = $1', [t.id]).catch(() => {});

  return { transporteId: t.id, nome: t.nome, tipos: t.tipos };
}
