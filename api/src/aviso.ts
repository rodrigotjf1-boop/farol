// =====================================================================
// O aviso do Regem — "algo mudou nesta loja"
// =====================================================================
// Pedido do dono em 11/10/2026: quando a ficha muda no Regem, o Farol fica
// sabendo na hora, em vez de só buscar uma vez por dia.
//
// O Regem manda um POST assinado (padrão Standard Webhooks). O aviso NÃO
// leva dado: é só o gatilho. Quem recebe confere a assinatura e lê pela
// leitura de sempre — por isso aviso repetido não custa, e aviso perdido
// não perde nada (a leitura diária e o "Buscar agora" continuam).
//
// Duas metades moram aqui:
//
//   • REGISTRAR: dizer ao Regem para onde avisar e com que segredo assinar.
//     O endereço e o segredo são sorteados por este servidor — ninguém
//     digita nada. Acontece depois de uma leitura que deu certo (ao ligar a
//     loja, uma vez por dia, a pedido): nunca de minutos em minutos;
//   • CONFERIR: a assinatura do aviso que chega.
//
// O SEGREDO DO AVISO É SEGREDO: fica cifrado com a chave do ambiente, não
// sai por rota, tela nem registro, e não desce para o computador da loja.
// =====================================================================

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type pg from 'pg';

import { cifrar, decifrar } from './cifra.js';
import { AVISO_URL_DE_PRODUCAO, contextoDoAcesso, ErroDoRegem, registrarAviso, type ConfigDoRegem } from './regem.js';

type Registro = {
  info: (dados: object, mensagem: string) => void;
  warn: (dados: object, mensagem: string) => void;
  error: (dados: object, mensagem: string) => void;
};

/** O prefixo do segredo no padrão Standard Webhooks. */
const PREFIXO = 'whsec_';
/** Aviso com o relógio mais longe do que isto do nosso não vale (segundos) — o padrão pede 5 minutos. */
export const TOLERANCIA_S = 300;
/** Depois de aceito, o registro é refeito a cada tanto: religa o que o Regem tiver pausado. */
export const REGISTRAR_DE_NOVO_H = 20;
/** Entre uma tentativa de registrar e a seguinte, da mesma loja. */
export const ESPERA_ENTRE_TENTATIVAS_MIN = 30;

/** O contexto da cifra do segredo do aviso: o da loja A, na linha da loja B, não abre. */
export const contextoDoAviso = (tenantId: string, regemLojaId: string): string => `aviso:${tenantId}:${regemLojaId}`;

/** Um segredo novo, no formato que o Regem aceita: `whsec_` + 32 bytes em base64. */
export function novoSegredo(): string {
  return PREFIXO + randomBytes(32).toString('base64');
}

/** A chave (os bytes) de um segredo `whsec_…`; `null` se o formato não serve. */
export function chaveDoSegredo(segredo: string): Buffer | null {
  if (!segredo.startsWith(PREFIXO) || segredo.length > 200) return null;
  const b64 = segredo.slice(PREFIXO.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const chave = Buffer.from(b64, 'base64');
  return chave.length >= 24 && chave.length <= 64 ? chave : null;
}

export type Conferencia = 'ok' | 'sem_cabecalho' | 'fora_do_prazo' | 'assinatura';

/**
 * Confere um aviso: os três cabeçalhos, o relógio e a assinatura — o
 * HMAC-SHA256 de `id.timestamp.corpo`, sobre o texto EXATO que chegou.
 *
 * O cabeçalho da assinatura pode trazer mais de uma (`v1,… v1,…`, na troca
 * de segredo): basta uma conferir. A comparação é em tempo constante.
 */
export function conferirAviso(p: { id: unknown; timestamp: unknown; assinatura: unknown; corpo: string; chave: Buffer; agora: Date }): Conferencia {
  const { id, timestamp, assinatura } = p;
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return 'sem_cabecalho';
  if (typeof timestamp !== 'string' || !/^[0-9]{1,12}$/.test(timestamp)) return 'sem_cabecalho';
  if (typeof assinatura !== 'string' || assinatura.length === 0 || assinatura.length > 1024) return 'sem_cabecalho';
  if (Math.abs(p.agora.getTime() / 1000 - Number(timestamp)) > TOLERANCIA_S) return 'fora_do_prazo';

  const esperada = createHmac('sha256', p.chave).update(`${id}.${timestamp}.${p.corpo}`, 'utf8').digest();
  for (const parte of assinatura.split(' ')) {
    const virgula = parte.indexOf(',');
    if (virgula < 0 || parte.slice(0, virgula) !== 'v1') continue;
    const dada = Buffer.from(parte.slice(virgula + 1), 'base64');
    if (dada.length === esperada.length && timingSafeEqual(dada, esperada)) return 'ok';
  }
  return 'assinatura';
}

export type DesfechoDoRegistro =
  /** O Regem aceitou (de novo, ou pela primeira vez). */
  | 'registrado'
  /** Não era a hora: já registrado há pouco, tentado há pouco, ou a loja não está ligada. */
  | 'nada_a_fazer'
  /** O Regem (ainda) não aceita aviso para o Farol: vale só a leitura diária. */
  | 'nao_habilitado'
  /** Não deu desta vez; a leitura seguinte tenta de novo. */
  | 'falhou';

type Linha = {
  id: string;
  tenant_id: string;
  regem_loja_id: string;
  acesso_cifrado: string;
  aviso_segredo_cifrado: string | null;
};

/**
 * Registra (ou refaz o registro de) o aviso de UMA loja ligada. Nunca
 * rejeita: é chamada em segundo plano, depois de uma leitura.
 *
 * Só uma tentativa por vez e por loja: quem pega a vez é uma instrução só.
 * O segredo é guardado ANTES de ir ao Regem — se o Regem aceitar e a
 * resposta se perder, o aviso que chegar já pode ser conferido.
 */
export async function garantirAviso(pool: pg.Pool, cfg: ConfigDoRegem, conexaoId: string, log: Registro): Promise<DesfechoDoRegistro> {
  if (cfg.chave === null) return 'nada_a_fazer';
  try {
    const pego = await pool.query<Linha>(
      `update regem_loja
          set aviso_tentado_em = now()
        where id = $1 and loja_id is not null and acesso_tirado_em is null
          and (aviso_registrado_em is null or aviso_registrado_em < now() - make_interval(hours => $2))
          and (aviso_tentado_em is null or aviso_tentado_em < now() - make_interval(mins => $3))
        returning id, tenant_id, regem_loja_id, acesso_cifrado, aviso_segredo_cifrado`,
      [conexaoId, REGISTRAR_DE_NOVO_H, ESPERA_ENTRE_TENTATIVAS_MIN],
    );
    const l = pego.rows[0];
    if (!l) return 'nada_a_fazer';

    const acesso = decifrar(l.acesso_cifrado, cfg.chave, contextoDoAcesso(l.tenant_id, l.regem_loja_id));
    // Acesso que não abre é assunto da LEITURA, que já o registra: aqui só não há o que fazer.
    if (!acesso) return 'falhou';

    const contexto = contextoDoAviso(l.tenant_id, l.regem_loja_id);
    let segredo = l.aviso_segredo_cifrado ? decifrar(l.aviso_segredo_cifrado, cfg.chave, contexto) : null;
    if (!segredo || !chaveDoSegredo(segredo)) {
      // Primeiro registro, ou o guardado não abre mais: um segredo novo, guardado antes de sair daqui.
      segredo = novoSegredo();
      await pool.query('update regem_loja set aviso_segredo_cifrado = $2, aviso_registrado_em = null where id = $1', [
        l.id,
        cifrar(segredo, cfg.chave, contexto),
      ]);
    }

    let resposta: 'registrado' | 'nao_habilitado';
    try {
      resposta = await registrarAviso(cfg, acesso, { url: `${cfg.avisoUrl ?? AVISO_URL_DE_PRODUCAO}${l.id}`, segredo });
    } catch (e) {
      if (!(e instanceof ErroDoRegem)) throw e;
      // O MOTIVO, sem o conteúdo. O acesso tirado quem trata é a leitura seguinte.
      log.warn({ regemLoja: l.id, motivo: e.motivo, status: e.status }, 'regem: o aviso não foi registrado; a leitura diária segue valendo');
      return 'falhou';
    }
    if (resposta === 'nao_habilitado') {
      await pool.query('update regem_loja set aviso_registrado_em = null where id = $1', [l.id]);
      log.info({ regemLoja: l.id }, 'regem: o Regem ainda não aceita aviso para esta loja; a leitura diária segue valendo');
      return 'nao_habilitado';
    }
    await pool.query('update regem_loja set aviso_registrado_em = now() where id = $1 and acesso_tirado_em is null', [l.id]);
    return 'registrado';
  } catch (e) {
    // 42703 = a coluna não existe: o banco está atrás do código. A rotina de leitura já diz isso, uma vez.
    if ((e as { code?: string }).code !== '42703') log.error({ err: e, regemLoja: conexaoId }, 'regem: o registro do aviso quebrou');
    return 'falhou';
  }
}
