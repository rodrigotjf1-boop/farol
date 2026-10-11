// =====================================================================
// A leitura das fichas — quando, e o que acontece em cada desfecho
// =====================================================================
// O servidor lê do Regem o cardápio e as fichas de cada loja ligada e
// guarda a cópia no formato do Farol.
//
// QUANDO. Decisão do dono (11/10/2026): "o servidor não precisa perguntar
// ao Regem a cada 5 min; ficha técnica não é algo que se mude
// constantemente". A leitura acontece em três momentos, e só neles:
//
//   • quando a loja é ligada (ou conectada de novo);
//   • uma vez por dia, de madrugada no relógio DA LOJA — cada loja no seu
//     minuto, para mil lojas não baterem no Regem no mesmo instante;
//   • quando alguém aperta "Buscar agora".
//
// Uma falha não espera o dia seguinte: tenta de novo em meia hora.
//
// E um quarto momento, pedido pelo dono na noite de 11/10/2026: quando o
// REGEM AVISA que algo mudou (`aviso.ts`). O aviso não traz dado — só marca
// a loja como "tem aviso esperando", e é esta leitura que busca. Começar
// uma leitura limpa a marca; o aviso que chega no meio de uma leitura fica
// marcado, e a rotina lê a loja de novo na volta seguinte.
//
// O QUE ACONTECE:
//
//   atualizada     a base da loja foi trocada pela nova;
//   nada_mudou     o Regem disse que nada mudou (ou mudou algo que a base
//                  do Farol não guarda): a base fica, a hora da leitura anda;
//   acesso_tirado  o Regem recusou o acesso — a base é APAGADA na hora
//                  (a mesma regra do desconectar) e a loja espera alguém
//                  conectar de novo;
//   falhou         sem resposta, recusa ou resposta fora do contrato: a
//                  base de ontem continua valendo, e o motivo fica guardado;
//   ocupada        já há uma leitura desta loja em curso;
//   nao_ligada     não há o que ler (a conexão saiu, ou nunca foi ligada).
//
// Uma leitura por loja de cada vez — vale entre réplicas e entre a rotina
// e o botão. E a base só é gravada com a conexão ainda de pé, na mesma
// transação: quem desconecta no meio de uma leitura não vê a base voltar.
// =====================================================================

import { createHash } from 'node:crypto';

import type pg from 'pg';

import { garantirAviso } from './aviso.js';
import { decifrar } from './cifra.js';
import { contarBase, impressaoDaBase } from './fichas.js';
import { contextoDoAcesso, ErroDoRegem, lerRetrato, type ConfigDoRegem, type Retrato } from './regem.js';
import { baseDoRegem } from './regem-fichas.js';

export type Desfecho = 'atualizada' | 'nada_mudou' | 'acesso_tirado' | 'falhou' | 'ocupada' | 'nao_ligada';
export type Falha = 'sem_resposta' | 'recusado' | 'resposta_torta' | 'acesso_ilegivel';
export type Resultado = { desfecho: Desfecho; falha?: Falha };

type Registro = { warn: (o: object, m: string) => void; info: (o: object, m: string) => void; error: (o: object, m: string) => void };

/** A hora do relógio da loja em que a leitura do dia acontece. O minuto é de cada loja. */
export const HORA_DA_LEITURA = 4;
/** Depois de uma falha, quanto esperar para tentar de novo. */
export const ESPERA_DEPOIS_DA_FALHA_MIN = 30;
/** Leitura que não terminou neste tempo é dada por morta: outra pode começar. */
export const LEITURA_MORTA_MIN = 3;

/** O minuto da loja, entre 0 e 59 — sempre o mesmo para a mesma loja. */
export function minutoDaLoja(lojaId: string): number {
  return parseInt(createHash('sha256').update(lojaId, 'utf8').digest('hex').slice(0, 8), 16) % 60;
}

/** Quanto o relógio da loja está adiantado em relação ao UTC, naquele instante. */
function adiantoMs(instante: Date, fuso: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instante)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const relogio = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return relogio - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * A próxima leitura do dia: às 04:MM do relógio da loja, depois de `agora`.
 * Fuso que o sistema não conhece não derruba a agenda: vale daqui a 24 horas.
 */
export function proximaLeitura(agora: Date, fuso: string, lojaId: string): Date {
  try {
    const adianto = adiantoMs(agora, fuso);
    const local = new Date(agora.getTime() + adianto);
    const alvoLocal = (dias: number) =>
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dias, HORA_DA_LEITURA, minutoDaLoja(lojaId));
    for (const dias of [0, 1, 2]) {
      let alvo = new Date(alvoLocal(dias) - adianto);
      // O adianto pode ser outro no dia do alvo (horário de verão): uma correção basta.
      alvo = new Date(alvoLocal(dias) - adiantoMs(alvo, fuso));
      if (alvo.getTime() > agora.getTime()) return alvo;
    }
  } catch {
    // RangeError do Intl: fuso desconhecido.
  }
  return new Date(agora.getTime() + 24 * 3600_000);
}

type Linha = {
  id: string;
  tenant_id: string;
  loja_id: string;
  regem_loja_id: string;
  acesso_cifrado: string;
  versao_catalogo: string | null;
  versao_fichas: string | null;
  timezone: string;
  tem_base: boolean;
};

/**
 * Lê as fichas de UMA loja ligada. Nunca rejeita por causa do Regem: o
 * que der errado vira desfecho, guardado na linha da conexão.
 */
export async function lerFichasDaLoja(
  pool: pg.Pool,
  cfg: ConfigDoRegem,
  conexaoId: string,
  log: Registro,
  agora: () => Date = () => new Date(),
): Promise<Resultado> {
  // Pega a vez — uma instrução só: de duas leituras ao mesmo tempo, uma leva.
  // O aviso que esperava é atendido por ESTA leitura: a marca sai aqui, no
  // começo. O que chegar depois deste instante marca de novo.
  const pego = await pool.query<Linha>(
    `update regem_loja r
        set lendo_desde = now(), tentada_em = now(), aviso_pendente_desde = null
       from loja l
      where r.id = $1 and l.id = r.loja_id and r.acesso_tirado_em is null
        and (r.lendo_desde is null or r.lendo_desde < now() - make_interval(mins => $2))
      returning r.id, r.tenant_id, r.loja_id, r.regem_loja_id, r.acesso_cifrado, r.versao_catalogo, r.versao_fichas,
                l.timezone, exists (select 1 from fichas_da_loja f where f.loja_id = r.loja_id) as tem_base`,
    [conexaoId, LEITURA_MORTA_MIN],
  );
  const linha = pego.rows[0];
  if (!linha) {
    const { rows } = await pool.query(
      'select 1 from regem_loja where id = $1 and loja_id is not null and acesso_tirado_em is null',
      [conexaoId],
    );
    return { desfecho: rows.length > 0 ? 'ocupada' : 'nao_ligada' };
  }

  const falhar = async (falha: Falha, detalhe: object = {}): Promise<Resultado> => {
    await pool.query(
      `update regem_loja
          set lendo_desde = null, falha = $2, proxima_em = now() + make_interval(mins => $3)
        where id = $1`,
      [linha.id, falha, ESPERA_DEPOIS_DA_FALHA_MIN],
    );
    log.warn({ regemLoja: linha.id, falha, ...detalhe }, 'regem: a leitura das fichas falhou');
    return { desfecho: 'falhou', falha };
  };

  try {
    const acesso = cfg.chave ? decifrar(linha.acesso_cifrado, cfg.chave, contextoDoAcesso(linha.tenant_id, linha.regem_loja_id)) : null;
    if (!acesso) return await falhar('acesso_ilegivel');

    // Sem base guardada, a versão anotada não serve: "nada mudou" não traria nada.
    const tenho = linha.tem_base ? { catalogo: linha.versao_catalogo, fichas: linha.versao_fichas } : { catalogo: null, fichas: null };
    let catalogo: Retrato;
    let fichas: Retrato;
    try {
      [catalogo, fichas] = await Promise.all([lerRetrato(cfg, acesso, 'catalogo', tenho.catalogo), lerRetrato(cfg, acesso, 'fichas', tenho.fichas)]);
      // Um mudou e o outro não: a base se monta com os DOIS inteiros.
      if (catalogo.mudou !== fichas.mudou) {
        if (!catalogo.mudou) catalogo = await lerRetrato(cfg, acesso, 'catalogo', null);
        if (!fichas.mudou) fichas = await lerRetrato(cfg, acesso, 'fichas', null);
      }
    } catch (e) {
      if (!(e instanceof ErroDoRegem)) throw e;
      if (e.motivo === 'acesso_tirado') return await tirarOAcesso(pool, linha, log);
      // `cliente_invalido` não acontece numa leitura; cai em "recusado".
      const falha: Falha = e.motivo === 'sem_resposta' || e.motivo === 'resposta_torta' ? e.motivo : 'recusado';
      return await falhar(falha, { status: e.status });
    }

    const proxima = proximaLeitura(agora(), linha.timezone, linha.loja_id);
    if (!catalogo.mudou || !fichas.mudou) {
      await pool.query('update regem_loja set lendo_desde = null, lida_em = now(), falha = null, proxima_em = $2 where id = $1', [linha.id, proxima]);
      registrarOAvisoEmSegundoPlano(pool, cfg, linha.id, log);
      return { desfecho: 'nada_mudou' };
    }

    let base;
    try {
      base = baseDoRegem(catalogo.corpo, fichas.corpo);
    } catch (e) {
      if (!(e instanceof ErroDoRegem)) throw e;
      return await falhar('resposta_torta');
    }
    const total = contarBase(base);

    // A base e o estado da leitura, juntos — e só se a conexão ainda está de
    // pé: a linha é travada antes, e quem desconectou no meio já a levou.
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const viva = await cliente.query('select 1 from regem_loja where id = $1 and loja_id = $2 and acesso_tirado_em is null for update', [
        linha.id,
        linha.loja_id,
      ]);
      if (viva.rowCount === 0) {
        await cliente.query('rollback');
        return { desfecho: 'nao_ligada' };
      }
      const gravou = await cliente.query(
        `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha, atualizada_em)
         values ($1, $2, 'regem', $3::jsonb, $4, $5, $6, now())
         on conflict (loja_id) do update
            set tenant_id = excluded.tenant_id, fonte = excluded.fonte, conteudo = excluded.conteudo, impressao = excluded.impressao,
                produtos = excluded.produtos, com_ficha = excluded.com_ficha, atualizada_em = now()
          where fichas_da_loja.impressao is distinct from excluded.impressao`,
        [linha.loja_id, linha.tenant_id, JSON.stringify(base), impressaoDaBase(base), total.produtos, total.comFicha],
      );
      await cliente.query(
        `update regem_loja
            set lendo_desde = null, lida_em = now(), falha = null, versao_catalogo = $2, versao_fichas = $3, proxima_em = $4
          where id = $1`,
        [linha.id, catalogo.versao, fichas.versao, proxima],
      );
      await cliente.query('commit');
      const mudou = (gravou.rowCount ?? 0) > 0;
      if (mudou) log.info({ regemLoja: linha.id, ...total }, 'regem: a base de fichas da loja foi atualizada');
      registrarOAvisoEmSegundoPlano(pool, cfg, linha.id, log);
      return { desfecho: mudou ? 'atualizada' : 'nada_mudou' };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  } catch (e) {
    // Defeito NOSSO (banco, programação): solta a vez para a próxima tentativa
    // não esperar a leitura "morrer", e deixa o erro subir.
    await pool.query('update regem_loja set lendo_desde = null where id = $1', [linha.id]).catch(() => {});
    throw e;
  }
}

/** O Regem disse que o acesso não vale mais: sem acesso, sem fichas — na mesma transação. */
async function tirarOAcesso(pool: pg.Pool, linha: Linha, log: Registro): Promise<Resultado> {
  await pool.query(
    `with tirado as (
       update regem_loja
          set lendo_desde = null, acesso_tirado_em = now(), falha = null, proxima_em = null, versao_catalogo = null, versao_fichas = null,
              -- sem acesso não há aviso: o segredo sai, e a conexão passa a responder 404 a quem avisar
              aviso_segredo_cifrado = null, aviso_registrado_em = null
        where id = $1
        returning loja_id
     )
     delete from fichas_da_loja f using tirado where f.loja_id = tirado.loja_id and f.fonte = 'regem'`,
    [linha.id],
  );
  log.warn({ regemLoja: linha.id }, 'regem: o acesso da loja foi tirado no Regem; a base de fichas dela foi apagada');
  return { desfecho: 'acesso_tirado' };
}

/**
 * A volta da rotina: lê as lojas cuja hora chegou, poucas de cada vez.
 * Nunca rejeita — é chamada de um relógio, e uma rejeição ali derrubaria o
 * processo.
 */
export async function lerAsLojasDaVez(
  pool: pg.Pool,
  cfg: ConfigDoRegem,
  log: Registro,
  /** `contas`: só as lojas destas contas. Ausente = todas — é assim que o servidor chama. */
  opcoes: { limite?: number; contas?: string[] } = {},
): Promise<{ lidas: number; desfechos: Partial<Record<Desfecho, number>> }> {
  const desfechos: Partial<Record<Desfecho, number>> = {};
  const { rows } = await pool.query<{ id: string }>(
    `select id from regem_loja
      where loja_id is not null and acesso_tirado_em is null
        and (proxima_em is null or proxima_em <= now() or aviso_pendente_desde is not null)
        and (lendo_desde is null or lendo_desde < now() - make_interval(mins => $2))
        and ($3::uuid[] is null or tenant_id = any($3::uuid[]))
      order by proxima_em nulls first, id
      limit $1`,
    [opcoes.limite ?? 5, LEITURA_MORTA_MIN, opcoes.contas ?? null],
  );
  for (const { id } of rows) {
    try {
      const r = await lerFichasDaLoja(pool, cfg, id, log);
      desfechos[r.desfecho] = (desfechos[r.desfecho] ?? 0) + 1;
    } catch (e) {
      // Uma loja com defeito não segura as outras; o adiamento evita que ela
      // volte a toda volta da rotina.
      log.error({ err: e, regemLoja: id }, 'regem: a leitura das fichas quebrou');
      await pool
        .query('update regem_loja set proxima_em = now() + make_interval(mins => $2) where id = $1', [id, ESPERA_DEPOIS_DA_FALHA_MIN])
        .catch(() => {});
      desfechos.falhou = (desfechos.falhou ?? 0) + 1;
    }
  }
  return { lidas: rows.length, desfechos };
}

/** O que a rotina lembra de uma volta para a outra. */
export type MemoriaDaRotina = { avisouQueFaltaMigrar: boolean };

/**
 * O que o relógio do servidor chama a cada minuto. Nunca rejeita.
 *
 * Fica quieta em três casos: a porta do serviço está recusando (o banco
 * está atrás do código); a instalação não tem a chave dos acessos (não há
 * o que ler); e as tabelas ainda não existem — isso dito UMA vez, porque um
 * erro por minuto afoga o registro e esconde a falha de verdade.
 */
export async function voltaDaLeitura(
  pool: pg.Pool,
  cfg: ConfigDoRegem,
  log: Registro,
  podeRodar: () => boolean,
  memoria: MemoriaDaRotina,
  opcoes: { limite?: number; contas?: string[] } = {},
): Promise<void> {
  if (!podeRodar() || cfg.chave === null) return;
  try {
    const r = await lerAsLojasDaVez(pool, cfg, log, opcoes);
    memoria.avisouQueFaltaMigrar = false;
    if (r.lidas > 0) log.info({ lidas: r.lidas, ...r.desfechos }, 'regem: leitura das fichas das lojas da vez');
  } catch (e) {
    // 42P01 = a tabela não existe; 42703 = a coluna não existe. Pelo CÓDIGO,
    // nunca pela mensagem: o Postgres traduz o texto conforme o servidor.
    const codigo = (e as { code?: string }).code;
    if (codigo === '42P01' || codigo === '42703') {
      if (!memoria.avisouQueFaltaMigrar) {
        memoria.avisouQueFaltaMigrar = true;
        log.warn({}, 'a leitura das fichas está parada: falta aplicar as migrations. Enquanto isso, nenhuma loja é lida');
      }
      return;
    }
    log.error({ err: e }, 'regem: a rotina de leitura das fichas falhou');
  }
}

// As leituras disparadas em segundo plano que ainda não terminaram. Não é
// estado de negócio: é só a lista de promessas em curso, para quem precisa
// esperar por elas (os testes; o encerramento).
const emCurso = new Set<Promise<void>>();

/**
 * Depois de uma leitura que deu certo: garante que o Regem sabe para onde
 * avisar. Em segundo plano — o "Buscar agora" não espera por isso — e sem
 * rejeitar (`garantirAviso` trata por dentro o que der errado).
 */
function registrarOAvisoEmSegundoPlano(pool: pg.Pool, cfg: ConfigDoRegem, conexaoId: string, log: Registro): void {
  const registro = garantirAviso(pool, cfg, conexaoId, log).then(() => undefined);
  emCurso.add(registro);
  void registro.finally(() => emCurso.delete(registro));
}

/** Dispara a leitura de lojas recém-ligadas sem segurar quem pediu. Nunca rejeita. */
export function lerEmSegundoPlano(pool: pg.Pool, cfg: ConfigDoRegem, conexaoIds: string[], log: Registro): void {
  if (conexaoIds.length === 0) return;
  const leitura = (async () => {
    for (const id of conexaoIds) {
      try {
        await lerFichasDaLoja(pool, cfg, id, log);
      } catch (e) {
        // Fica para a rotina: a linha continua com a agenda vazia.
        log.error({ err: e, regemLoja: id }, 'regem: a primeira leitura das fichas quebrou');
      }
    }
  })();
  emCurso.add(leitura);
  void leitura.finally(() => emCurso.delete(leitura));
}

/** Devolve quando não houver mais leitura em segundo plano em curso. */
export async function semLeituraEmCurso(): Promise<void> {
  while (emCurso.size > 0) await Promise.allSettled([...emCurso]);
}
