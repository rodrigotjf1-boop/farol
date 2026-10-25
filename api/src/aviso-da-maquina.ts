// =====================================================================
// O aviso da máquina: o computador do agente esquentando ou no limite
// =====================================================================
// A26, parte M3 (pedido do dono em 25/10/2026: "para verificar se o pc está
// sobrecarregado, se sobreaquece"). A tela (M2) mostra o relatório; isto
// avisa, pelos destinos dos alertas, quando o problema está acontecendo.
//
// ## Quando
//
// A cada `POST /v1/uso` (o agente manda a hora em curso a cada 5 minutos,
// com o pico de cada minuto), a nuvem olha os minutos que já tem:
//
//   esquentando    — na última hora, a placa de vídeo passou de 83 °C ou a
//                    placa-mãe de 70 °C em pelo menos 10 minutos; ou o disco
//                    passou de 60 °C. Um pico de um minuto não é aviso: a
//                    tela mostra, o celular não toca.
//   sobrecarregado — nas últimas 12 horas, o processador ou a memória acima
//                    de 90%, ou a placa acima de 95%, em pelo menos 30
//                    minutos (a mesma régua da tela) — E um desses minutos
//                    nos últimos 15: o aviso é do que está acontecendo, não
//                    de ontem à noite.
//
// Os limites são os da tela (`LIMITES`, em `saude-da-maquina.ts`).
//
// ## Quantas vezes
//
// Um de cada tipo a cada 12 horas por computador, contadas DESDE O ÚLTIMO
// AVISO (V22: nunca por faixa do calendário). A marca fica em
// `computador_aviso` (migration 059) e é trocada na MESMA instrução que cria
// os envios: dois envios do agente juntos não avisam duas vezes.
//
// ## Para quem
//
// Pela política da loja, como os outros alertas (`resolverDestinos`).
// Esquentando é crítico/urgente; sobrecarregado, atenção/urgente — os dois
// alcançam os destinos da loja sem política nenhuma (o dono pediu para
// saber), e quem não quiser cala com uma linha de veto da combinação.
// Sem destino cadastrado, não se marca: o aviso sai quando houver para quem.
// =====================================================================

import type pg from 'pg';

import { resolverDestinos, type Prioridade, type Severidade } from './alertas.js';
import { carregarPolitica } from './despacho.js';
import { relogioDaLoja } from './horario.js';
import { LIMITES, type MinutoDaHora, type SensoresDaHora } from './saude-da-maquina.js';

export const TIPOS_DE_AVISO = ['esquentando', 'sobrecarregado'] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

export const REGUA_DO_AVISO = {
  /** A janela do calor e quantos minutos quentes nela viram aviso. */
  janelaDoCalorMin: 60,
  minutosQuentes: 10,
  /** A janela da sobrecarga; os minutos são os da tela (`LIMITES.minutosParaSobrecarga`). */
  janelaDaSobrecargaH: 12,
  /** A sobrecarga só avisa se ainda está acontecendo: um minuto acima nestes últimos. */
  agoraMin: 15,
  /** Um aviso de cada tipo a cada tantas horas, desde o último. */
  repetirH: 12,
} as const;

export const GRAVIDADE: Record<TipoDeAviso, { severidade: Severidade; prioridade: Prioridade }> = {
  esquentando: { severidade: 'critico', prioridade: 'urgente' },
  sobrecarregado: { severidade: 'atencao', prioridade: 'urgente' },
};

/** Uma hora de `uso_hora` como o aviso lê: o começo, os sensores e o pico de cada minuto. */
export type HoraDoAviso = { hora: Date; sensores: SensoresDaHora | null; minutos: MinutoDaHora[] | null };

export type Aviso = {
  tipo: TipoDeAviso;
  /** Frases curtas do porquê, na ordem (a mais grave primeiro). */
  porque: string[];
  /** O primeiro e o último minuto acima do limite que contaram (ISO, UTC). */
  desde: string;
  ate: string;
};

type Peca = { campo: string; limite: number; nome: string; unidade: string };
const QUENTES: Peca[] = [
  { campo: 'gpuTempC', limite: LIMITES.gpuTempC, nome: 'a placa de vídeo', unidade: ' °C' },
  { campo: 'tempPlacaMaeC', limite: LIMITES.tempPlacaMaeC, nome: 'a placa-mãe', unidade: ' °C' },
];
const CARGAS: Peca[] = [
  { campo: 'cpu', limite: LIMITES.cpuPct, nome: 'o processador', unidade: '%' },
  { campo: 'mem', limite: LIMITES.memPct, nome: 'a memória', unidade: '%' },
  { campo: 'gpu', limite: LIMITES.gpuPct, nome: 'a placa de vídeo', unidade: '%' },
];

const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Os minutos (com o instante) de todas as horas, do mais velho ao mais novo. */
function minutosDe(horas: HoraDoAviso[]): { t: number; picos: Record<string, number> }[] {
  const saida: { t: number; picos: Record<string, number> }[] = [];
  for (const h of horas) for (const [m, picos] of h.minutos ?? []) saida.push({ t: h.hora.getTime() + m * 60_000, picos });
  return saida.sort((a, b) => a.t - b.t);
}

type Contagem = { peca: Peca; minutos: number; pico: number; quandoPico: number; primeiro: number; ultimo: number };

function contar(minutos: { t: number; picos: Record<string, number> }[], pecas: Peca[]): Contagem[] {
  const saida: Contagem[] = [];
  for (const peca of pecas) {
    const acima = minutos.filter((m) => (m.picos[peca.campo] ?? -1) >= peca.limite);
    if (acima.length === 0) continue;
    let pico = acima[0]!;
    for (const m of acima) if (m.picos[peca.campo]! > pico.picos[peca.campo]!) pico = m;
    saida.push({
      peca, minutos: acima.length, pico: pico.picos[peca.campo]!, quandoPico: pico.t,
      primeiro: acima[0]!.t, ultimo: acima[acima.length - 1]!.t,
    });
  }
  return saida.sort((a, b) => b.minutos - a.minutos);
}

/**
 * Os avisos que valem agora, das horas que a nuvem tem (as últimas 13, em qualquer ordem). `fuso` é o da loja: a hora
 * do pico sai no relógio dela. Pura: sem banco, sem hora do sistema.
 */
export function avaliarAvisos(horas: HoraDoAviso[], agora: Date, fuso: string): Aviso[] {
  const t = agora.getTime();
  // o minuto conta pelo começo dele; o que ainda não acabou entra com o pico até aqui
  const todos = minutosDe(horas).filter((m) => m.t <= t);
  const hora = (ms: number) => relogioDaLoja(new Date(ms), fuso).hora;
  const avisos: Aviso[] = [];

  // ── esquentando ──
  const doCalor = todos.filter((m) => m.t > t - REGUA_DO_AVISO.janelaDoCalorMin * 60_000);
  const quentes = contar(doCalor, QUENTES).filter((c) => c.minutos >= REGUA_DO_AVISO.minutosQuentes);
  const porqueQuente = quentes.map(
    (c) => `${c.peca.nome} passou de ${c.peca.limite}${c.peca.unidade} em ${c.minutos} minutos da última hora `
      + `(chegou a ${num(c.pico)}${c.peca.unidade} às ${hora(c.quandoPico)})`,
  );
  // O disco não vem por minuto (a temperatura dele anda devagar): o pico da hora em curso ou da anterior.
  const recentes = horas.filter((h) => h.hora.getTime() > t - 2 * 3600_000 && h.hora.getTime() <= t);
  let disco: { max: number; hora: number } | null = null;
  for (const h of recentes) {
    const c = h.sensores?.discoTempC;
    if (c && typeof c === 'object' && c.max >= LIMITES.discoTempC && (!disco || c.max > disco.max)) disco = { max: c.max, hora: h.hora.getTime() };
  }
  if (disco) porqueQuente.push(`o disco chegou a ${num(disco.max)} °C (passa de ${LIMITES.discoTempC} °C)`);
  if (porqueQuente.length > 0) {
    const marcos = [...quentes.flatMap((c) => [c.primeiro, c.ultimo]), ...(disco ? [disco.hora] : [])];
    avisos.push({
      tipo: 'esquentando',
      porque: porqueQuente,
      desde: new Date(Math.min(...marcos)).toISOString(),
      ate: new Date(Math.max(...marcos)).toISOString(),
    });
  }

  // ── sobrecarregado ──
  const daCarga = todos.filter((m) => m.t > t - REGUA_DO_AVISO.janelaDaSobrecargaH * 3600_000);
  const cargas = contar(daCarga, CARGAS).filter(
    (c) => c.minutos >= LIMITES.minutosParaSobrecarga && c.ultimo > t - REGUA_DO_AVISO.agoraMin * 60_000,
  );
  if (cargas.length > 0) {
    avisos.push({
      tipo: 'sobrecarregado',
      porque: cargas.map(
        (c) => `${c.peca.nome} passou de ${c.peca.limite}${c.peca.unidade} em ${c.minutos} minutos das últimas `
          + `${REGUA_DO_AVISO.janelaDaSobrecargaH} horas (o mais recente às ${hora(c.ultimo)})`,
      ),
      desde: new Date(Math.min(...cargas.map((c) => c.primeiro))).toISOString(),
      ate: new Date(Math.max(...cargas.map((c) => c.ultimo))).toISOString(),
    });
  }
  return avisos;
}

const CONSEQUENCIA: Record<TipoDeAviso, string> = {
  esquentando: 'calor demais deixa a auditoria lenta e pode desligar o computador',
  sobrecarregado: 'com a máquina no limite, a auditoria atrasa',
};
const TITULO: Record<TipoDeAviso, string> = {
  esquentando: 'o computador do agente está esquentando',
  sobrecarregado: 'o computador do agente está sobrecarregado',
};

/** A mensagem pronta, para o transporte que só repassa texto. */
export function textoDoAviso(aviso: Aviso, loja: string): string {
  const porque = aviso.porque.join('; ');
  return `Farol · ${loja}: ${TITULO[aviso.tipo]}. ${porque.charAt(0).toUpperCase()}${porque.slice(1)}. `
    + `${CONSEQUENCIA[aviso.tipo].charAt(0).toUpperCase()}${CONSEQUENCIA[aviso.tipo].slice(1)}. `
    + 'No console: Computador da loja › Saúde.';
}

export type ResultadoDoAviso = { avisos: TipoDeAviso[]; criados: number; motivos: string[] };

/**
 * Depois de gravar o uso do agente: confere os avisos e cria os envios. Uma consulta das horas, uma da marca, a
 * política (duas, como no despacho) e, para cada aviso que vale, UMA instrução que troca a marca e cria os envios.
 */
export async function avisarDaMaquina(
  pool: pg.Pool,
  autor: { tenantId: string; lojaId: string; agenteId: string },
  agora: Date = new Date(),
): Promise<ResultadoDoAviso> {
  const [horasR, marcasR, lojaR] = await Promise.all([
    pool.query<HoraDoAviso>(
      `select hora, sensores, minutos from uso_hora
        where agente_id = $1 and hora > $2::timestamptz - interval '13 hours' and hora <= $2::timestamptz`,
      [autor.agenteId, agora],
    ),
    pool.query<{ tipo: TipoDeAviso }>(
      `select tipo from computador_aviso
        where agente_id = $1 and ultimo_em > $2::timestamptz - ($3 || ' hours')::interval`,
      [autor.agenteId, agora, String(REGUA_DO_AVISO.repetirH)],
    ),
    pool.query<{ nome: string; timezone: string; agente: string }>(
      `select l.nome, l.timezone, a.nome as agente
         from loja l join agente a on a.loja_id = l.id
        where l.id = $1 and l.tenant_id = $2 and a.id = $3`,
      [autor.lojaId, autor.tenantId, autor.agenteId],
    ),
  ]);
  const loja = lojaR.rows[0];
  if (!loja) return { avisos: [], criados: 0, motivos: [] };
  const recentes = new Set(marcasR.rows.map((m) => m.tipo));
  const avisos = avaliarAvisos(horasR.rows, agora, loja.timezone).filter((a) => !recentes.has(a.tipo));
  if (avisos.length === 0) return { avisos: [], criados: 0, motivos: [] };

  const { politicas, destinos } = await carregarPolitica(pool, autor.tenantId, autor.lojaId);
  let criados = 0;
  const motivos: string[] = [];
  const feitos: TipoDeAviso[] = [];
  for (const aviso of avisos) {
    const g = GRAVIDADE[aviso.tipo];
    const d = resolverDestinos(politicas, destinos, g.severidade, g.prioridade);
    motivos.push(`${aviso.tipo}: ${d.motivo}`);
    if (d.destinos.length === 0) continue; // sem para quem: não marca, o aviso sai quando houver
    const payload = {
      tipo: aviso.tipo,
      agente: loja.agente,
      loja: loja.nome,
      porque: aviso.porque,
      desde: aviso.desde,
      ate: aviso.ate,
      consequencia: CONSEQUENCIA[aviso.tipo],
      texto: textoDoAviso(aviso, loja.nome),
    };
    // A marca troca SÓ se o último aviso deste tipo tem 12 horas ou mais; sem a troca, nenhum envio sai. A chave leva a
    // hora da marca: o mesmo aviso não se repete, e o aviso de 12 horas depois é outro.
    const r = await pool.query(
      `with marca as (
         insert into computador_aviso (agente_id, tipo, tenant_id, loja_id, ultimo_em)
         values ($1, $2, $3, $4, $5)
         on conflict (agente_id, tipo) do update set ultimo_em = excluded.ultimo_em
          where computador_aviso.ultimo_em <= excluded.ultimo_em - ($8 || ' hours')::interval
         returning ultimo_em
       )
       insert into envio (tenant_id, loja_id, destino_id, motivo, chave, payload)
       select $3, $4, d.id, 'computador',
              $9 || to_char(m.ultimo_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || ':' || d.id::text,
              $6::jsonb
         from marca m cross join unnest($7::uuid[]) as d(id)
       on conflict (chave) do nothing`,
      [autor.agenteId, aviso.tipo, autor.tenantId, autor.lojaId, agora, JSON.stringify(payload), d.destinos,
        String(REGUA_DO_AVISO.repetirH), `computador:${autor.agenteId}:${aviso.tipo}:`],
    );
    criados += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) > 0) feitos.push(aviso.tipo);
  }
  return { avisos: feitos, criados, motivos };
}
