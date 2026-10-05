// =====================================================================
// Hash de senha — scrypt da biblioteca padrão
// =====================================================================
// scrypt em vez de bcrypt ou argon2 porque vem no Node, sem módulo
// nativo para compilar. Numa imagem Alpine, dependência nativa é a
// diferença entre um build de 20 segundos e um de cinco minutos que
// quebra quando a imagem base muda.
//
// Os parâmetros são os recomendados pelo OWASP para scrypt: N=2^17,
// r=8, p=1. Ficam GRAVADOS no hash, então subir o custo depois não
// invalida as senhas já guardadas — cada uma se verifica com os
// parâmetros com que nasceu.
// =====================================================================

import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

// Envolvido à mão, e não com `promisify`: a versão promisificada perde a
// sobrecarga que aceita opções, e sem opções o Node usa N=16384 — uma
// ordem de grandeza mais fraco do que se pretende aqui, em silêncio.
function scrypt(
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scryptCb(senha, sal, tamanho, opcoes, (erro, derivado) =>
      erro ? rejeitar(erro) : resolver(derivado),
    );
  });
}

const N = 2 ** 17;
const r = 8;
const p = 1;
const TAMANHO = 64;

// scrypt exige memória ~ 128 · N · r = 128 MB com estes parâmetros, e o
// Node recusa acima do limite padrão de 32 MB.
const MEMORIA = 160 * 1024 * 1024;

export async function gerarHash(senha: string): Promise<string> {
  if (!senha || senha.length < 10) {
    // Regra no servidor, não no formulário: front é sugestão, servidor é
    // garantia. Dez caracteres é o mínimo do NIST para senha escolhida
    // por pessoa.
    throw new Error('senha precisa de pelo menos 10 caracteres');
  }
  const sal = randomBytes(16);
  const derivado = await scrypt(senha.normalize('NFKC'), sal, TAMANHO, {
    N, r, p, maxmem: MEMORIA,
  });
  return ['scrypt', N, r, p, sal.toString('base64'), derivado.toString('base64')].join('$');
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const [, nTxt, rTxt, pTxt, salB64, hashB64] = partes;
  const n = Number(nTxt), rr = Number(rTxt), pp = Number(pTxt);
  if (!Number.isInteger(n) || !Number.isInteger(rr) || !Number.isInteger(pp)) return false;

  let derivado: Buffer;
  try {
    const esperado = Buffer.from(hashB64!, 'base64');
    derivado = await scrypt(
      senha.normalize('NFKC'),
      Buffer.from(salB64!, 'base64'),
      esperado.length,
      { N: n, r: rr, p: pp, maxmem: MEMORIA },
    );
    // Comparação em tempo constante: comparar com === vaza, pelo tempo,
    // quantos bytes iniciais estavam certos.
    return derivado.length === esperado.length && timingSafeEqual(derivado, esperado);
  } catch {
    return false;
  }
}

/** Token de sessão: 32 bytes de aleatoriedade real. */
export function gerarTokenSessao(): string {
  return randomBytes(32).toString('base64url');
}
