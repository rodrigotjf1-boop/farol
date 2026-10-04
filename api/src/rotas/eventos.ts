// =====================================================================
// POST /v1/eventos — recebe o que o agente julgou
// =====================================================================
// **Em lote, sempre.** O agente acumula fila quando a internet cai, e
// volta com uma pilha. Mandar um request por evento transformaria a volta
// da internet num ataque contra a própria API, logo quando ela já está
// recebendo a volta de todas as outras lojas.
//
// A gravação é UMA instrução para N eventos (`jsonb_to_recordset`), nunca
// um laço de inserts.
//
// **Três respostas por evento, não duas:**
//   aceito    — entrou agora
//   repetido  — já estava lá (a chave de idempotência pegou o retry)
//   recusado  — não entra nunca: regra de outra loja, ou apagada
//
// A terceira existe para a fila do agente poder DRENAR. Se um evento
// inválido fosse só rejeitado, o agente tentaria para sempre e a fila
// nunca andaria — e o evento bom atrás dele nunca chegaria.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import type { Autor } from '../db.js';

const VEREDITOS = new Set(['conforme', 'nao_conforme', 'nao_avaliavel']);
const VIAS = new Set(['nuvem', 'local', 'comparacao', 'detector']);
const PRIORIDADES = new Set(['urgente', 'intermediaria', 'leve']);
const DIM_EMBEDDING = 768;

// Teto por requisição. Protege a memória da API contra um agente com
// defeito (ou malicioso) que mande a fila inteira de uma vez.
const MAX_POR_LOTE = 500;

export type EventoEntrada = {
  idempotenciaKey: string;
  regraId: string;
  ocorridoEm: string;
  veredito: string;
  confianca?: number | null;
  motivo?: string | null;
  midiaUrl?: string | null;
  modelo?: string | null;
  via?: string | null;
  tokensEntrada?: number | null;
  tokensSaida?: number | null;
  custoCentavos?: number | null;
  latenciaMs?: number | null;
  prioridade?: string | null;
  emLote?: boolean;
  embedding?: number[] | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarEvento(e: unknown, i: number): string | null {
  const onde = `eventos[${i}]`;
  if (typeof e !== 'object' || e === null) return `${onde}: não é objeto`;
  const v = e as Record<string, unknown>;

  if (typeof v.idempotenciaKey !== 'string' || !v.idempotenciaKey.trim()) {
    return `${onde}.idempotenciaKey: obrigatória`;
  }
  if (typeof v.regraId !== 'string' || !UUID.test(v.regraId)) {
    return `${onde}.regraId: uuid obrigatório`;
  }
  if (typeof v.ocorridoEm !== 'string' || Number.isNaN(Date.parse(v.ocorridoEm))) {
    return `${onde}.ocorridoEm: data ISO obrigatória`;
  }
  if (typeof v.veredito !== 'string' || !VEREDITOS.has(v.veredito)) {
    return `${onde}.veredito: um de ${[...VEREDITOS].join(', ')}`;
  }
  if (v.confianca != null) {
    if (typeof v.confianca !== 'number' || v.confianca < 0 || v.confianca > 1) {
      return `${onde}.confianca: número entre 0 e 1`;
    }
  }
  if (v.via != null && (typeof v.via !== 'string' || !VIAS.has(v.via))) {
    return `${onde}.via: um de ${[...VIAS].join(', ')}`;
  }
  if (
    v.prioridade != null &&
    (typeof v.prioridade !== 'string' || !PRIORIDADES.has(v.prioridade))
  ) {
    return `${onde}.prioridade: um de ${[...PRIORIDADES].join(', ')}`;
  }
  if (v.embedding != null) {
    if (!Array.isArray(v.embedding) || v.embedding.length !== DIM_EMBEDDING) {
      return `${onde}.embedding: array de ${DIM_EMBEDDING} números`;
    }
    if (!v.embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return `${onde}.embedding: todos os valores têm que ser números finitos`;
    }
  }
  return null;
}

export async function gravarEventos(
  pool: pg.Pool,
  autor: Autor,
  eventos: EventoEntrada[],
): Promise<{ aceitos: string[]; repetidos: string[]; recusados: string[] }> {
  if (eventos.length === 0) {
    return { aceitos: [], repetidos: [], recusados: [] };
  }

  // O embedding viaja como array JSON e vira `vector` no banco. A dimensão
  // declarada na coluna recusa tamanho errado — guarda de graça contra
  // trocar o modelo de embedding sem perceber.
  const carga = eventos.map((e) => ({
    idempotencia_key: e.idempotenciaKey,
    regra_id: e.regraId,
    ocorrido_em: e.ocorridoEm,
    veredito: e.veredito,
    confianca: e.confianca ?? null,
    motivo: e.motivo ?? null,
    midia_url: e.midiaUrl ?? null,
    modelo: e.modelo ?? null,
    via: e.via ?? null,
    tokens_entrada: e.tokensEntrada ?? null,
    tokens_saida: e.tokensSaida ?? null,
    custo_centavos: e.custoCentavos ?? null,
    latencia_ms: e.latenciaMs ?? null,
    prioridade: e.prioridade ?? null,
    em_lote: e.emLote ?? false,
    embedding: e.embedding ?? null,
  }));

  // UMA instrução para N eventos. A corrente de joins é o que impede um
  // agente de gravar evento contra regra de outra loja, e a checagem mora
  // DENTRO da consulta — não numa validação que alguém pode esquecer de
  // chamar antes.
  //
  // São quatro tabelas porque a regra não guarda a loja: a cadeia real é
  // regra → zona → ponto → setor → loja. São todas junções por chave
  // primária, sobre tabelas de configuração (dezenas de linhas por loja),
  // então o custo é desprezível perto do insert.
  //
  // `zona_id` vem da REGRA, nunca do cliente: a regra já sabe a zona dela,
  // e aceitar a do agente só criaria uma forma de divergirem.
  const inseridos = await pool.query<{ idempotencia_key: string }>(
    `insert into evento (
        tenant_id, loja_id, agente_id, regra_id, zona_id, ocorrido_em,
        veredito, confianca, motivo, midia_url, modelo, via,
        tokens_entrada, tokens_saida, custo_centavos, latencia_ms,
        prioridade, em_lote, embedding, idempotencia_key)
     select $1, $2, $3, e.regra_id, r.zona_id, e.ocorrido_em,
            e.veredito, e.confianca, e.motivo, e.midia_url, e.modelo, e.via,
            e.tokens_entrada, e.tokens_saida, e.custo_centavos, e.latencia_ms,
            e.prioridade, e.em_lote,
            case when e.embedding is null then null
                 else (e.embedding #>> '{}')::vector end,
            e.idempotencia_key
       from jsonb_to_recordset($4::jsonb) as e(
            idempotencia_key text, regra_id uuid,
            ocorrido_em timestamptz, veredito text, confianca numeric,
            motivo text, midia_url text, modelo text, via text,
            tokens_entrada integer, tokens_saida integer,
            custo_centavos numeric, latencia_ms integer,
            prioridade text, em_lote boolean, embedding jsonb)
       join regra r  on r.id = e.regra_id
       join zona  z  on z.id = r.zona_id
       join ponto p  on p.id = z.ponto_id
       join setor s  on s.id = p.setor_id and s.loja_id = $2
    on conflict (idempotencia_key) do nothing
      returning idempotencia_key`,
    [autor.tenantId, autor.lojaId, autor.agenteId, JSON.stringify(carga)],
  );

  const aceitos = new Set(inseridos.rows.map((r) => r.idempotencia_key));
  const sobraram = eventos
    .map((e) => e.idempotenciaKey)
    .filter((k) => !aceitos.has(k));

  if (sobraram.length === 0) {
    return { aceitos: [...aceitos], repetidos: [], recusados: [] };
  }

  // O que não entrou: ou já existia (repetido), ou a regra não é desta
  // loja (recusado). Uma consulta decide, sem laço.
  const existentes = await pool.query<{ idempotencia_key: string }>(
    'select idempotencia_key from evento where idempotencia_key = any($1::text[])',
    [sobraram],
  );
  const repetidos = new Set(existentes.rows.map((r) => r.idempotencia_key));

  return {
    aceitos: [...aceitos],
    repetidos: [...repetidos],
    recusados: sobraram.filter((k) => !repetidos.has(k)),
  };
}

export function rotasDeEventos(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/v1/eventos', async (req, resposta) => {
    let autor: Autor;
    try {
      autor = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        // Loga o MOTIVO: 401 sem causa é impossível de diagnosticar à
        // distância, e à distância é como toda loja é diagnosticada.
        req.log.warn({ motivo: e.motivo }, 'agente recusado');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const corpo = req.body as { eventos?: unknown };
    if (!Array.isArray(corpo?.eventos)) {
      return resposta.status(400).send({
        erro: 'corpo_invalido',
        mensagem: 'esperado { eventos: [...] }',
      });
    }
    if (corpo.eventos.length > MAX_POR_LOTE) {
      return resposta.status(413).send({
        erro: 'lote_grande',
        mensagem: `máximo ${MAX_POR_LOTE} eventos por requisição`,
      });
    }

    const problemas = corpo.eventos
      .map((e, i) => validarEvento(e, i))
      .filter((p): p is string => p !== null);
    if (problemas.length > 0) {
      return resposta.status(422).send({ erro: 'validacao', problemas });
    }

    const r = await gravarEventos(pool, autor, corpo.eventos as EventoEntrada[]);

    if (r.recusados.length > 0) {
      req.log.warn(
        { loja: autor.lojaId, recusados: r.recusados.length },
        'eventos com regra de outra loja ou inexistente',
      );
    }

    return {
      aceitos: r.aceitos.length,
      repetidos: r.repetidos.length,
      recusados: r.recusados,
    };
  });
}
