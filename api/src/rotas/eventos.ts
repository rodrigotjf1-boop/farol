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
import { despacharEventos } from '../despacho.js';

const VEREDITOS = new Set(['conforme', 'nao_conforme', 'nao_avaliavel']);
const VIAS = new Set(['nuvem', 'local', 'comparacao', 'detector']);
const PRIORIDADES = new Set(['urgente', 'intermediaria', 'leve']);
const DIM_EMBEDDING = 768;

// Teto por requisição. Protege a memória da API contra um agente com
// defeito (ou malicioso) que mande a fila inteira de uma vez.
const MAX_POR_LOTE = 500;

// O corpo de exemplo, completo, está em `contratos/evento-do-agente.json`.
// O teste do agente exige que ele gere exatamente aquele arquivo, e o teste
// daqui manda aquele arquivo e confere o que foi gravado. Os dois lados já
// divergiram uma vez sem ninguém ver — o agente mandava `idempotencia_key`.
export type EventoEntrada = {
  idempotenciaKey: string;
  regraId: string;
  // Em qual canal o critério foi verificado. O critério pode valer em
  // vários, e aí só o agente sabe de qual veio o quadro. Não é aceito às
  // cegas: tem que ser um dos canais onde o critério vale AGORA.
  zonaId?: string | null;
  // Qual redação do critério produziu o veredito, e qual cena foi julgada.
  criterioVersao?: number | null;
  imagemHash?: string | null;
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

// Termina em `Z` ou em deslocamento (`-03:00`, `+0530`).
const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i;

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
  // Hora sem fuso seria lida como UTC pelo banco. A loja está em outro
  // fuso, então o evento ficaria gravado horas fora do lugar — e sem
  // nenhum erro, que é o pior jeito. Recusar aqui faz o defeito aparecer
  // no agente, onde ele nasce.
  if (!COM_FUSO.test(v.ocorridoEm.trim())) {
    return `${onde}.ocorridoEm: precisa do fuso (ex.: 2026-10-06T12:00:00-03:00)`;
  }
  if (v.zonaId != null && (typeof v.zonaId !== 'string' || !UUID.test(v.zonaId))) {
    return `${onde}.zonaId: uuid`;
  }
  if (v.criterioVersao != null) {
    if (!Number.isInteger(v.criterioVersao) || (v.criterioVersao as number) < 1) {
      return `${onde}.criterioVersao: inteiro a partir de 1`;
    }
  }
  if (v.imagemHash != null) {
    if (typeof v.imagemHash !== 'string' || !/^[0-9a-f]{1,64}$/i.test(v.imagemHash)) {
      return `${onde}.imagemHash: hexadecimal`;
    }
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
    zona_id: e.zonaId ?? null,
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
    // A consulta abaixo já declarava estas duas colunas e este objeto não
    // as preenchia: o banco recebia nulo, a versão caía sempre na da regra
    // de HOJE e o hash da cena nunca era gravado. A migration 010 existia e
    // nada chegava a ela.
    criterio_versao: e.criterioVersao ?? null,
    imagem_hash: e.imagemHash ? e.imagemHash.toLowerCase() : null,
  }));

  // UMA instrução para N eventos. A junção com a regra é o que impede um
  // agente de gravar evento contra critério de outra loja, e a checagem
  // mora DENTRO da consulta — não numa validação que alguém pode esquecer
  // de chamar antes.
  //
  // ## De que canal é o evento
  //
  // Enquanto cada critério valia numa área só, a zona vinha da regra e a
  // do agente nem era lida. Com um critério valendo em vários canais, só o
  // agente sabe de qual veio o quadro — mas aceitar o que ele manda sem
  // conferir faria de um critério geral um passe para gravar evento em
  // qualquer área da loja. Então:
  //
  //   · mandou a zona e ela é um dos canais do critério → vale;
  //   · mandou a zona e ela NÃO é (o critério saiu daquele canal enquanto
  //     o evento esperava, ou é invenção) → o evento não entra, e volta em
  //     `recusados` para a fila do agente andar;
  //   · não mandou, e o critério vale num canal só → é aquele;
  //   · não mandou, e o critério vale em vários → entra SEM zona. É agente
  //     de versão anterior: o veredito é verdadeiro e não se recupera, só
  //     falta dizer onde. Recusar aqui jogaria fora o que dá para guardar.
  const inseridos = await pool.query<{ idempotencia_key: string }>(
    `insert into evento (
        tenant_id, loja_id, agente_id, regra_id, zona_id, ocorrido_em,
        veredito, confianca, motivo, midia_url, modelo, via,
        tokens_entrada, tokens_saida, custo_centavos, latencia_ms,
        prioridade, em_lote, embedding, idempotencia_key,
        criterio_versao, imagem_hash)
     select $1, $2, $3, e.regra_id, alvo.zona_id, e.ocorrido_em,
            e.veredito, e.confianca, e.motivo, e.midia_url, e.modelo, e.via,
            e.tokens_entrada, e.tokens_saida, e.custo_centavos, e.latencia_ms,
            e.prioridade, e.em_lote,
            case when e.embedding is null then null
                 else (e.embedding #>> '{}')::vector end,
            e.idempotencia_key,
            -- A regra e mutavel: sem a versao gravada NO EVENTO, um
            -- veredito de ontem aponta para a redacao de hoje, e
            -- "a versao 2 acerta mais que a 1?" fica sem resposta.
            -- O coalesce com a regra cobre agente antigo que ainda nao
            -- manda o campo.
            coalesce(e.criterio_versao, r.criterio_versao),
            e.imagem_hash
       from jsonb_to_recordset($4::jsonb) as e(
            idempotencia_key text, regra_id uuid, zona_id uuid,
            ocorrido_em timestamptz, veredito text, confianca numeric,
            motivo text, midia_url text, modelo text, via text,
            tokens_entrada integer, tokens_saida integer,
            custo_centavos numeric, latencia_ms integer,
            prioridade text, em_lote boolean, embedding jsonb,
            criterio_versao integer, imagem_hash text)
       join regra r on r.id = e.regra_id and r.loja_id = $2
       left join lateral (
         select a.zona_id
           from regra_alvo a
          where a.regra_id = r.id
            and (a.zona_id = e.zona_id
                 or (e.zona_id is null
                     and (select count(*) from regra_alvo u
                           where u.regra_id = r.id) = 1))
          limit 1
       ) alvo on true
      where alvo.zona_id is not null or e.zona_id is null
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

    // O aviso nasce aqui, DEPOIS de o evento estar gravado — e nunca
    // dentro da mesma transação. O evento é o fato; o aviso é consequência
    // dele. Se o despacho falhar, o fato continua registrado e um job
    // posterior ainda pode avisar. Se fossem a mesma transação, uma falha
    // na política apagaria o veredito — e o veredito não se recupera,
    // porque a cena já passou.
    let avisos = { criados: 0, sem_destino: 0 };
    if (r.aceitos.length > 0) {
      try {
        const d = await despacharEventos(
          pool, autor.tenantId, autor.lojaId, r.aceitos,
        );
        avisos = { criados: d.criados, sem_destino: d.sem_destino };
        if (d.sem_destino > 0) {
          // Loga o MOTIVO, não só a contagem: "não saiu" por veto e "não
          // saiu" por falta de cadastro pedem ações opostas de quem lê.
          req.log.info(
            { loja: autor.lojaId, motivos: [...new Set(d.motivos)] },
            'eventos sem destino de alerta',
          );
        }
      } catch (e) {
        req.log.error(
          { erro: e instanceof Error ? e.message : String(e), loja: autor.lojaId },
          'eventos gravados, mas o despacho do alerta falhou',
        );
      }
    }

    return {
      avisos: avisos.criados,
      aceitos: r.aceitos.length,
      repetidos: r.repetidos.length,
      recusados: r.recusados,
    };
  });
}
