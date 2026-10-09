// =====================================================================
// POST /v1/resumos — o que o agente olhou, por hora
// =====================================================================
// O evento conta o que deu errado. O resumo conta TUDO o que foi olhado:
// quantas vezes cada critério foi verificado em cada canal, e no que deu.
// É o que permite ao console distinguir loja em ordem de sistema parado.
//
// **O agente manda o acumulado da hora, e a nuvem substitui.** A mesma
// linha sobe várias vezes enquanto a hora corre, e um pedido repetido
// depois de uma queda de rede tem que dar no mesmo. Somar diferenças
// dobraria a contagem a cada retentativa.
//
// **Uma instrução para N linhas**, como em `/v1/eventos`: a internet que
// volta depois do fim de semana traz centenas de horas de uma vez.
//
// **Duas respostas por linha:** entrou, ou não entra nunca (critério ou
// canal que não é desta loja). A segunda volta em `recusados`, pela
// posição na lista, para a fila do agente poder andar.
//
// O corpo de exemplo, completo, está em `contratos/resumo-do-agente.json`.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import type { Autor } from '../db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Termina em `Z` ou em deslocamento (`-03:00`, `+0530`).
const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i;
// Hora cheia: minuto e segundo zerados, antes do fuso.
const HORA_CHEIA = /T\d{2}:00:00(\.0+)?(Z|[+-]\d{2}:?\d{2})$/i;
const RESULTADOS = new Set(['conforme', 'nao_conforme', 'nao_avaliavel']);

// Teto por requisição, o mesmo dos eventos.
const MAX_POR_LOTE = 500;
// Nenhum contador de uma hora chega perto disto: 3.600 segundos, uma
// olhada por segundo. Acima é defeito, e número absurdo no painel é pior
// que linha recusada.
const TETO_DO_CONTADOR = 100_000;
const TETO_DO_TEXTO = 500;

/** Os inteiros do contrato, na ordem em que aparecem nele. */
const CONTADORES = [
  'capturas',
  'semJuiz',
  'semQuadro',
  'semCena',
  'emSilencio',
  'repetidas',
  'jaJulgadas',
  'enfileiradas',
  'conformes',
  'naoConformes',
  'naoAvaliaveis',
  'falhas',
  'alertas',
  'comConfianca',
  'comLatencia',
] as const;

export type ResumoEntrada = {
  regraId: string;
  zonaId: string;
  hora: string;
  somaConfianca: number;
  somaLatenciaMs: number;
  custoCentavos: number;
  ultimoResultado: string | null;
  ultimoMotivo: string | null;
  ultimoImpedimento: string | null;
  ultimaEm: string | null;
  /** Olhadas que o porteiro segurou. Agente anterior à migration 023 não manda. */
  semCondicao?: number;
  /** Olhadas de critério em "observando": contadas, sem julgar. Agente
   *  anterior à migration 031 não manda. */
  observadas?: number;
  /** Onde foi julgado. Agente anterior à migration 020 não manda. */
  julgadasLoja?: number;
  julgadasNuvem?: number;
  /** O que o juiz mediu nas cenas da hora (o detector: quantos viu). Agente
   *  anterior à migration 022 não manda. */
  somaMedida?: number;
  comMedida?: number;
  maxMedida?: number | null;
  /** As olhadas extras do vigia, que já estão dentro dos resultados.
   *  Agente anterior à migration 027 não manda. */
  extras?: number;
  extrasFora?: number;
} & Record<(typeof CONTADORES)[number], number>;

export function validarResumo(r: unknown, i: number): string | null {
  const onde = `resumos[${i}]`;
  if (typeof r !== 'object' || r === null) return `${onde}: não é objeto`;
  const v = r as Record<string, unknown>;

  if (typeof v.regraId !== 'string' || !UUID.test(v.regraId)) {
    return `${onde}.regraId: uuid obrigatório`;
  }
  if (typeof v.zonaId !== 'string' || !UUID.test(v.zonaId)) {
    return `${onde}.zonaId: uuid obrigatório`;
  }
  if (typeof v.hora !== 'string' || Number.isNaN(Date.parse(v.hora))) {
    return `${onde}.hora: data ISO obrigatória`;
  }
  // Sem fuso o banco leria como UTC e a hora inteira cairia três casas
  // fora — no gráfico, o almoço apareceria às 15h. Recusar faz o defeito
  // aparecer no agente, onde ele nasce.
  if (!COM_FUSO.test(v.hora.trim())) {
    return `${onde}.hora: precisa do fuso (ex.: 2026-10-07T12:00:00-03:00)`;
  }
  if (!HORA_CHEIA.test(v.hora.trim())) {
    return `${onde}.hora: tem que ser hora cheia (minuto e segundo zerados)`;
  }

  for (const campo of CONTADORES) {
    const n = v[campo];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > TETO_DO_CONTADOR) {
      return `${onde}.${campo}: inteiro de 0 a ${TETO_DO_CONTADOR}`;
    }
  }
  for (const campo of ['somaConfianca', 'somaLatenciaMs', 'custoCentavos'] as const) {
    const n = v[campo];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return `${onde}.${campo}: número a partir de 0`;
    }
  }
  // A confiança de cada veredito vai de 0 a 1: a soma não passa da
  // quantidade. Pegar isto aqui evita uma média de 3,7 na tela.
  if ((v.somaConfianca as number) > (v.comConfianca as number) + 1e-6) {
    return `${onde}.somaConfianca: maior que comConfianca`;
  }

  // As olhadas que o porteiro segurou, e as do critério que só observa.
  // Opcionais: agente antigo não manda.
  for (const campo of ['semCondicao', 'observadas'] as const) {
    const n = v[campo];
    if (n == null) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > TETO_DO_CONTADOR) {
      return `${onde}.${campo}: inteiro de 0 a ${TETO_DO_CONTADOR}`;
    }
  }

  // Onde foi julgado: na loja ou na nuvem. Os dois são opcionais — o
  // agente de antes da migration 020 não manda, e não pode passar a ser
  // recusado por isso. Quando vêm, não passam do que foi julgado: cada
  // julgamento concluído aconteceu em UM lugar.
  let julgadasComLugar = 0;
  for (const campo of ['julgadasLoja', 'julgadasNuvem'] as const) {
    const n = v[campo];
    if (n == null) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > TETO_DO_CONTADOR) {
      return `${onde}.${campo}: inteiro de 0 a ${TETO_DO_CONTADOR}`;
    }
    julgadasComLugar += n;
  }
  const julgadas = (v.conformes as number) + (v.naoConformes as number) + (v.naoAvaliaveis as number);
  if (julgadasComLugar > julgadas) {
    return `${onde}.julgadasLoja + julgadasNuvem: maior que o que foi julgado (${julgadas})`;
  }

  // A medida da cena (o detector: quantos objetos viu). Opcional, como
  // "onde foi julgado": agente antigo não manda. Quando vem, a conta tem
  // de fechar — sem medida não há maior valor, com medida há, e a média
  // não passa dele. Pegar isto aqui evita "3,7 pessoas no pico de 2".
  const comMedida = v.comMedida ?? 0;
  if (typeof comMedida !== 'number' || !Number.isInteger(comMedida) || comMedida < 0 || comMedida > julgadas) {
    return `${onde}.comMedida: inteiro de 0 ao que foi julgado (${julgadas})`;
  }
  const somaMedida = v.somaMedida ?? 0;
  if (typeof somaMedida !== 'number' || !Number.isFinite(somaMedida) || somaMedida < 0) {
    return `${onde}.somaMedida: número a partir de 0`;
  }
  const maxMedida = v.maxMedida ?? null;
  if (maxMedida !== null && (typeof maxMedida !== 'number' || !Number.isFinite(maxMedida) || maxMedida < 0)) {
    return `${onde}.maxMedida: número a partir de 0, ou nulo`;
  }
  if (comMedida === 0 && (maxMedida !== null || somaMedida > 0)) {
    return `${onde}.comMedida: sem medida não há soma nem maior valor`;
  }
  if (comMedida > 0 && maxMedida === null) return `${onde}.maxMedida: com medida, o maior valor é obrigatório`;
  if (comMedida > 0 && maxMedida !== null && somaMedida / comMedida > maxMedida + 0.01) {
    return `${onde}.somaMedida: média maior que o maior valor`;
  }

  // As olhadas extras do vigia (o agente olhou fora da rotina porque a
  // contagem mudou). Opcionais: agente antigo não manda, e não fazia.
  // Elas são PARTE do que foi julgado — nunca mais que ele —, e as que
  // deram fora do critério são parte das fora do critério. Sem esta
  // conta, "rotina = julgadas − extras" daria número negativo na leitura.
  const extras = v.extras ?? 0;
  if (typeof extras !== 'number' || !Number.isInteger(extras) || extras < 0 || extras > julgadas) {
    return `${onde}.extras: inteiro de 0 ao que foi julgado (${julgadas})`;
  }
  const extrasFora = v.extrasFora ?? 0;
  if (
    typeof extrasFora !== 'number' || !Number.isInteger(extrasFora) || extrasFora < 0 ||
    extrasFora > extras || extrasFora > (v.naoConformes as number)
  ) {
    return `${onde}.extrasFora: inteiro de 0 a extras (${extras}), sem passar de naoConformes`;
  }

  if (v.ultimoResultado != null) {
    if (typeof v.ultimoResultado !== 'string' || !RESULTADOS.has(v.ultimoResultado)) {
      return `${onde}.ultimoResultado: um de ${[...RESULTADOS].join(', ')}`;
    }
  }
  for (const campo of ['ultimoMotivo', 'ultimoImpedimento'] as const) {
    if (v[campo] != null && typeof v[campo] !== 'string') return `${onde}.${campo}: texto`;
  }
  if (v.ultimaEm != null) {
    if (typeof v.ultimaEm !== 'string' || Number.isNaN(Date.parse(v.ultimaEm))) {
      return `${onde}.ultimaEm: data ISO`;
    }
    if (!COM_FUSO.test(v.ultimaEm.trim())) return `${onde}.ultimaEm: precisa do fuso`;
  }
  return null;
}

const cortar = (t: string | null | undefined): string | null =>
  t ? t.slice(0, TETO_DO_TEXTO) : null;

/** A linha, do jeito que o banco identifica: critério, canal e instante. */
const chaveDe = (regraId: string, zonaId: string, hora: string | Date): string =>
  `${regraId.toLowerCase()}|${zonaId.toLowerCase()}|${new Date(hora).getTime()}`;

export async function gravarResumos(
  pool: pg.Pool,
  autor: Autor,
  resumos: ResumoEntrada[],
): Promise<{ aceitos: number; recusados: number[] }> {
  if (resumos.length === 0) return { aceitos: 0, recusados: [] };

  const carga = resumos.map((r, i) => ({
    i,
    regra_id: r.regraId,
    zona_id: r.zonaId,
    hora: r.hora,
    capturas: r.capturas,
    sem_juiz: r.semJuiz,
    sem_quadro: r.semQuadro,
    sem_cena: r.semCena,
    sem_condicao: r.semCondicao ?? 0,
    observadas: r.observadas ?? 0,
    em_silencio: r.emSilencio,
    repetidas: r.repetidas,
    ja_julgadas: r.jaJulgadas,
    enfileiradas: r.enfileiradas,
    conformes: r.conformes,
    nao_conformes: r.naoConformes,
    nao_avaliaveis: r.naoAvaliaveis,
    falhas: r.falhas,
    alertas: r.alertas,
    soma_confianca: r.somaConfianca,
    com_confianca: r.comConfianca,
    soma_latencia_ms: Math.round(r.somaLatenciaMs),
    com_latencia: r.comLatencia,
    custo_centavos: r.custoCentavos,
    julgadas_loja: r.julgadasLoja ?? 0,
    julgadas_nuvem: r.julgadasNuvem ?? 0,
    soma_medida: r.somaMedida ?? 0,
    com_medida: r.comMedida ?? 0,
    max_medida: r.maxMedida ?? null,
    extras: r.extras ?? 0,
    extras_fora: r.extrasFora ?? 0,
    ultimo_resultado: r.ultimoResultado ?? null,
    ultimo_motivo: cortar(r.ultimoMotivo),
    ultimo_impedimento: cortar(r.ultimoImpedimento),
    ultima_em: r.ultimaEm ?? null,
  }));

  // UMA instrução. As junções são a checagem de dono, e moram DENTRO da
  // consulta: o critério tem que ser desta loja, e o canal também. Sem a
  // segunda, um agente poderia gravar o resumo de um critério seu contra
  // a zona de outra loja.
  //
  // Não se exige que o critério AINDA valha naquele canal (`regra_alvo`):
  // tirar o critério do canal às 15h não apaga o que foi olhado às 14h.
  //
  // `distinct on` protege contra o mesmo (critério, canal, hora) duas
  // vezes no lote — sem ele o Postgres recusa a instrução inteira, e uma
  // linha repetida derrubaria quinhentas boas. Vale a última.
  const gravadas = await pool.query<{ regra_id: string; zona_id: string; hora: Date }>(
    `insert into resumo_hora (
        tenant_id, loja_id, agente_id, regra_id, zona_id, hora,
        capturas, sem_juiz, sem_quadro, sem_cena, sem_condicao, observadas, em_silencio, repetidas,
        ja_julgadas, enfileiradas, conformes, nao_conformes, nao_avaliaveis,
        falhas, alertas, soma_confianca, com_confianca, soma_latencia_ms,
        com_latencia, custo_centavos, julgadas_loja, julgadas_nuvem,
        soma_medida, com_medida, max_medida, extras, extras_fora,
        ultimo_resultado, ultimo_motivo, ultimo_impedimento, ultima_em)
     select distinct on (e.regra_id, e.zona_id, e.hora)
            $1, $2, $3, e.regra_id, e.zona_id, e.hora,
            e.capturas, e.sem_juiz, e.sem_quadro, e.sem_cena, e.sem_condicao, e.observadas, e.em_silencio, e.repetidas,
            e.ja_julgadas, e.enfileiradas, e.conformes, e.nao_conformes, e.nao_avaliaveis,
            e.falhas, e.alertas, e.soma_confianca, e.com_confianca, e.soma_latencia_ms,
            e.com_latencia, e.custo_centavos, e.julgadas_loja, e.julgadas_nuvem,
            e.soma_medida, e.com_medida, e.max_medida, e.extras, e.extras_fora,
            e.ultimo_resultado, e.ultimo_motivo, e.ultimo_impedimento, e.ultima_em
       from jsonb_to_recordset($4::jsonb) as e(
            i integer, regra_id uuid, zona_id uuid, hora timestamptz,
            capturas integer, sem_juiz integer, sem_quadro integer, sem_cena integer,
            sem_condicao integer, observadas integer,
            em_silencio integer, repetidas integer, ja_julgadas integer,
            enfileiradas integer, conformes integer, nao_conformes integer,
            nao_avaliaveis integer, falhas integer, alertas integer,
            soma_confianca numeric, com_confianca integer, soma_latencia_ms bigint,
            com_latencia integer, custo_centavos numeric,
            julgadas_loja integer, julgadas_nuvem integer,
            soma_medida numeric, com_medida integer, max_medida numeric,
            extras integer, extras_fora integer, ultimo_resultado text,
            ultimo_motivo text, ultimo_impedimento text, ultima_em timestamptz)
       join regra r on r.id = e.regra_id and r.loja_id = $2
       join zona  z on z.id = e.zona_id
       join ponto p on p.id = z.ponto_id
       join setor s on s.id = p.setor_id and s.loja_id = $2
      order by e.regra_id, e.zona_id, e.hora, e.i desc
     on conflict (agente_id, regra_id, zona_id, hora) do update set
        capturas = excluded.capturas,
        sem_juiz = excluded.sem_juiz,
        sem_quadro = excluded.sem_quadro,
        sem_cena = excluded.sem_cena,
        sem_condicao = excluded.sem_condicao,
        observadas = excluded.observadas,
        em_silencio = excluded.em_silencio,
        repetidas = excluded.repetidas,
        ja_julgadas = excluded.ja_julgadas,
        enfileiradas = excluded.enfileiradas,
        conformes = excluded.conformes,
        nao_conformes = excluded.nao_conformes,
        nao_avaliaveis = excluded.nao_avaliaveis,
        falhas = excluded.falhas,
        alertas = excluded.alertas,
        soma_confianca = excluded.soma_confianca,
        com_confianca = excluded.com_confianca,
        soma_latencia_ms = excluded.soma_latencia_ms,
        com_latencia = excluded.com_latencia,
        custo_centavos = excluded.custo_centavos,
        julgadas_loja = excluded.julgadas_loja,
        julgadas_nuvem = excluded.julgadas_nuvem,
        soma_medida = excluded.soma_medida,
        com_medida = excluded.com_medida,
        max_medida = excluded.max_medida,
        extras = excluded.extras,
        extras_fora = excluded.extras_fora,
        ultimo_resultado = excluded.ultimo_resultado,
        ultimo_motivo = excluded.ultimo_motivo,
        ultimo_impedimento = excluded.ultimo_impedimento,
        ultima_em = excluded.ultima_em,
        atualizado_em = now()
     returning regra_id, zona_id, hora`,
    [autor.tenantId, autor.lojaId, autor.agenteId, JSON.stringify(carga)],
  );

  const entraram = new Set(gravadas.rows.map((g) => chaveDe(g.regra_id, g.zona_id, g.hora)));
  const recusados = resumos
    .map((r, i) => (entraram.has(chaveDe(r.regraId, r.zonaId, r.hora)) ? -1 : i))
    .filter((i) => i >= 0);

  return { aceitos: resumos.length - recusados.length, recusados };
}

export function rotasDeResumos(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/v1/resumos', async (req, resposta) => {
    let autor: Autor;
    try {
      autor = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'agente recusado');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const corpo = req.body as { resumos?: unknown };
    if (!Array.isArray(corpo?.resumos)) {
      return resposta.status(400).send({
        erro: 'corpo_invalido',
        mensagem: 'esperado { resumos: [...] }',
      });
    }
    if (corpo.resumos.length > MAX_POR_LOTE) {
      return resposta.status(413).send({
        erro: 'lote_grande',
        mensagem: `máximo ${MAX_POR_LOTE} linhas por requisição`,
      });
    }

    const problemas = corpo.resumos
      .map((r, i) => validarResumo(r, i))
      .filter((p): p is string => p !== null);
    if (problemas.length > 0) {
      return resposta.status(422).send({ erro: 'validacao', problemas });
    }

    const r = await gravarResumos(pool, autor, corpo.resumos as ResumoEntrada[]);
    if (r.recusados.length > 0) {
      // Diz QUANTAS e de que loja: recusa sem contexto não se diagnostica
      // à distância.
      req.log.warn(
        { loja: autor.lojaId, recusadas: r.recusados.length },
        'linhas de resumo com critério ou canal que não é desta loja',
      );
    }
    return r;
  });
}
