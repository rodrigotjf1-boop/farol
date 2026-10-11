// =====================================================================
// Segredo que precisa ser lido de volta
// =====================================================================
// Até aqui nada no servidor precisava disto: senha, sessão e acesso do
// agente ficam só como impressão (não se desfaz), e senha de câmera nem
// sobe. O acesso de uma loja no Regem é diferente — o servidor tem de
// APRESENTÁ-LO ao Regem a cada leitura, então precisa guardá-lo de um
// jeito que dê para ler de volta.
//
// AES-256-GCM, com a chave que só o ambiente do servidor tem
// (`FAROL_CHAVE_DOS_ACESSOS`). Quem copiar o banco sem a chave não leva
// acesso nenhum.
//
// O `contexto` entra na conta (dado autenticado): o texto cifrado para a
// loja A não decifra se for colado na linha da loja B. Sem isso, trocar
// duas linhas de lugar no banco faria uma loja ler com o acesso da outra.
//
// Nada aqui registra, devolve em erro ou põe em mensagem o texto claro.
// =====================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';
const TAMANHO_DA_CHAVE = 32;
const TAMANHO_DA_MARCA = 16;

/**
 * A chave, como vem do ambiente: 32 bytes em base64 (o que
 * `openssl rand -base64 32` devolve). `null` = não configurada, ou não
 * tem a forma certa — e aí quem usa trata como "ainda não disponível", em
 * vez de cifrar com uma chave fraca.
 */
export function lerChave(valor: string | undefined): Buffer | null {
  const limpo = (valor ?? '').trim();
  // Duas conferências, cada uma com o seu papel: a FORMA (só o alfabeto do
  // base64, com o enchimento no fim — o decodificador ignora em silêncio o
  // que não entende, e "chave + resto" passaria) e o TAMANHO (32 bytes).
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(limpo)) return null;
  const chave = Buffer.from(limpo, 'base64');
  return chave.length === TAMANHO_DA_CHAVE ? chave : null;
}

export function cifrar(claro: string, chave: Buffer, contexto: string): string {
  // 12 bytes novos a cada vez: com GCM, repetir o par (chave, número)
  // entrega o texto.
  const numero = randomBytes(12);
  const c = createCipheriv(ALGORITMO, chave, numero, { authTagLength: TAMANHO_DA_MARCA });
  c.setAAD(Buffer.from(contexto, 'utf8'));
  const corpo = Buffer.concat([c.update(claro, 'utf8'), c.final()]);
  return [VERSAO, numero.toString('base64url'), c.getAuthTag().toString('base64url'), corpo.toString('base64url')].join('.');
}

/**
 * `null` quando não dá para ler: outra chave, outro contexto, texto
 * mexido ou formato desconhecido. Quem chama trata como "acesso perdido" —
 * nunca recebe um texto pela metade.
 */
export function decifrar(cifrado: string, chave: Buffer, contexto: string): string | null {
  const partes = String(cifrado ?? '').split('.');
  if (partes.length !== 4 || partes[0] !== VERSAO) return null;
  try {
    // `authTagLength` é o que recusa a marca curta: sem ele, uma marca de 4
    // bytes (o começo da verdadeira) confere, e forjar um texto passa de
    // 2^128 tentativas para 2^32.
    const d = createDecipheriv(ALGORITMO, chave, Buffer.from(partes[1]!, 'base64url'), { authTagLength: TAMANHO_DA_MARCA });
    d.setAAD(Buffer.from(contexto, 'utf8'));
    d.setAuthTag(Buffer.from(partes[2]!, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(partes[3]!, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
