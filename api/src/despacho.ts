// =====================================================================
// Despacho — do veredito ao aviso
// =====================================================================
// Pega os eventos que acabaram de entrar e cria as linhas de `envio`.
// Quem entrega é o Regem ou o n8n, puxando os pendentes; aqui só se
// decide e se registra.
//
// ## Só `nao_conforme` alerta
//
// O veredito tem três valores e cada um tem destino diferente:
//
//   conforme       → métrica. É a maioria esmagadora dos vereditos.
//   nao_conforme   → alerta. Alguém precisa saber.
//   nao_avaliavel  → fila de revisão. A cena não dava para julgar, e
//                    insistir com humano é desperdício de atenção.
//
// Sem este filtro, uma loja com oito regras conformando o dia inteiro
// mandaria centenas de mensagens dizendo "está tudo bem" — e no terceiro
// dia ninguém abriria mais nenhuma. O alerta que todos ignoram é pior que
// alerta nenhum, porque dá a impressão de que a vigilância existe.
//
// ## Uma consulta de configuração, um insert
//
// A política é configuração: punhado de linhas por loja. Busca-se uma vez
// por lote e resolve-se em memória. Os envios entram em UMA instrução para
// N eventos × M destinos — nunca um insert por par, que num lote de volta
// de internet seria centenas de idas ao banco.
// =====================================================================

import type pg from 'pg';

import {
  resolverDestinos,
  chaveDeEnvio,
  faixaDeRepeticao,
  type LinhaPolitica,
  type DestinoAtivo,
  type Severidade,
  type Prioridade,
} from './alertas.js';
import { silencioDoAgente, type HorarioDoComputador } from './computador.js';

export interface EventoParaAvisar {
  id: string;
  severidade: Severidade;
  prioridade: Prioridade;
}

/** O que a loja tem configurado. Pequeno e estável — cabe em memória. */
export async function carregarPolitica(
  pool: pg.Pool,
  tenantId: string,
  lojaId: string,
): Promise<{ politicas: LinhaPolitica[]; destinos: DestinoAtivo[] }> {
  // `loja_id is null` traz o padrão da rede junto: a resolução decide qual
  // escopo vale, e decidir isso em SQL exigiria duas consultas ou um
  // `not exists` que esconde a regra.
  const [p, d] = await Promise.all([
    pool.query<LinhaPolitica>(
      `select id, loja_id, severidade, prioridade, enviar, destino_id
         from politica_alerta
        where tenant_id = $1 and (loja_id = $2 or loja_id is null)`,
      [tenantId, lojaId],
    ),
    pool.query<DestinoAtivo>(
      `select id, tipo, loja_id, papel
         from destino
        where tenant_id = $1 and (loja_id = $2 or loja_id is null) and ativo`,
      [tenantId, lojaId],
    ),
  ]);
  return { politicas: p.rows, destinos: d.rows };
}

/**
 * Quais eventos recém-gravados merecem aviso, com a severidade da regra.
 *
 * A severidade vem da REGRA, não do agente: é decisão de quem configurou a
 * auditoria, e deixar o agente mandá-la abriria caminho para um agente
 * desatualizado rebaixar um alerta crítico sem ninguém notar.
 *
 * Pelo mesmo motivo, o ESTADO também vem da regra: só o critério que está
 * valendo avisa. O agente que sabe de estados já não manda evento do que
 * está em ensaio; isto é para o que chegar mesmo assim — o evento que
 * estava a caminho quando o critério desceu, o agente com a configuração
 * velha. O evento fica gravado (é o fato); o aviso é que não sai.
 */
export async function eventosParaAvisar(
  pool: pg.Pool,
  chaves: string[],
): Promise<EventoParaAvisar[]> {
  if (chaves.length === 0) return [];
  const r = await pool.query<EventoParaAvisar>(
    `select e.id,
            r.severidade,
            -- A prioridade pode variar por ocorrência (o agente sabe se
            -- aquela cena era urgente); a severidade, não.
            coalesce(e.prioridade, r.prioridade) as prioridade
       from evento e
       join regra r on r.id = e.regra_id
      where e.idempotencia_key = any($1::text[])
        and e.veredito = 'nao_conforme'
        and r.estado = 'valendo'`,
    [chaves],
  );
  return r.rows;
}

export interface ResultadoDoDespacho {
  criados: number;
  sem_destino: number;
  /** Para o log: o que a política decidiu e por quê. */
  motivos: string[];
}

/**
 * Cria os envios pendentes. Idempotente por `(motivo, evento, destino)`.
 *
 * Reentrar com o mesmo lote não duplica aviso: o índice único em
 * `envio.chave` absorve, e o `do nothing` deixa o resto do lote passar.
 */
export async function despacharEventos(
  pool: pg.Pool,
  tenantId: string,
  lojaId: string,
  chavesAceitas: string[],
): Promise<ResultadoDoDespacho> {
  const eventos = await eventosParaAvisar(pool, chavesAceitas);
  if (eventos.length === 0) return { criados: 0, sem_destino: 0, motivos: [] };

  const { politicas, destinos } = await carregarPolitica(pool, tenantId, lojaId);

  const linhas: { evento_id: string; destino_id: string; chave: string }[] = [];
  const motivos: string[] = [];
  let semDestino = 0;

  for (const ev of eventos) {
    const d = resolverDestinos(politicas, destinos, ev.severidade, ev.prioridade);
    motivos.push(d.motivo);
    if (d.destinos.length === 0) {
      semDestino += 1;
      continue;
    }
    for (const destinoId of d.destinos) {
      linhas.push({
        evento_id: ev.id,
        destino_id: destinoId,
        chave: chaveDeEnvio('evento', ev.id, destinoId),
      });
    }
  }

  if (linhas.length === 0) return { criados: 0, sem_destino: semDestino, motivos };

  const r = await pool.query<{ id: string }>(
    `insert into envio (tenant_id, loja_id, evento_id, destino_id, motivo, chave)
     select $1, $2, x.evento_id, x.destino_id, 'evento', x.chave
       from jsonb_to_recordset($3::jsonb)
            as x(evento_id uuid, destino_id uuid, chave text)
     on conflict (chave) do nothing
      returning id`,
    [tenantId, lojaId, JSON.stringify(linhas)],
  );

  return { criados: r.rowCount ?? 0, sem_destino: semDestino, motivos };
}

// ───────────────────── o agente que caiu ─────────────────────

/** Quanto tempo a API precisa estar ACEITANDO sinal de vida antes de o
 *  vigia poder acusar alguém. Igual ao limite de silêncio do agente. */
export const CARENCIA_DO_VIGIA_MS = 5 * 60_000;

/**
 * O vigia pode acusar agora?
 *
 * Ele conclui "o agente caiu" a partir de UM fato: faz tempo que o agente
 * não bate. Mas há duas situações em que quem impediu a batida foi a
 * própria API:
 *
 *   · a guarda de esquema está respondendo 503 a tudo — inclusive ao
 *     sinal de vida — enquanto alguém não roda a migration;
 *   · a API acabou de voltar de uma parada longa, e nenhum agente teve
 *     tempo de bater de novo.
 *
 * Nas duas, acusar seria mandar "esta loja não está sendo auditada" para o
 * celular do dono por causa de um deploy. É o alerta mais grave que o
 * produto tem; um falso ensina a ignorar o verdadeiro.
 *
 * Então: nada de acusar enquanto a porta está fechada, nem antes de ela
 * estar aberta há pelo menos o tempo que um agente vivo leva para aparecer.
 */
export function vigiaPodeAcusar(
  porta: { recusando: boolean; aceitaDesde: number },
  agora: number,
  carenciaMs: number = CARENCIA_DO_VIGIA_MS,
): boolean {
  if (porta.recusando) return false;
  return agora - porta.aceitaDesde >= carenciaMs;
}

/**
 * Agente sem bater há tempo demais é o alerta mais urgente que existe.
 *
 * Não porque uma máquina parou, mas por causa do que o silêncio significa:
 * **nada está sendo auditado naquela loja**, e o console continua
 * mostrando a última tela verde. Um produto de auditoria que fica cego sem
 * avisar é pior que não ter produto — porque alguém confiou.
 *
 * O aviso REPETE por faixa contada desde a queda (ver `faixaDeRepeticao`),
 * não a cada passagem do job: senão um agente fora do ar por um fim de
 * semana geraria milhares de linhas de envio e afogaria todo o resto.
 */
export async function despacharAgentesCaidos(
  pool: pg.Pool,
  minutos = 5,
  agora = new Date(),
): Promise<{ criados: number; agentes: number }> {
  // `ultimo_heartbeat is null` NÃO entra: agente recém-criado e nunca
  // ativado não é agente caído — é agente que ninguém instalou ainda, e
  // avisar disso como emergência treinaria o dono a ignorar o aviso.
  const todos = await pool.query<{
    id: string; nome: string; tenant_id: string; loja_id: string;
    ultimo_heartbeat: Date;
    horario_computador: HorarioDoComputador | null; timezone: string; sabe: string[] | null;
  }>(
    `select a.id, a.nome, l.tenant_id, a.loja_id, a.ultimo_heartbeat,
            l.horario_computador, l.timezone, a.sabe
       from agente a
       join loja l on l.id = a.loja_id
      where a.estado = 'ativo'
        and a.ultimo_heartbeat is not null
        and a.ultimo_heartbeat < now() - ($1 || ' minutes')::interval`,
    [String(minutos)],
  );
  // O computador que DORME NO HORÁRIO não caiu (A22): calou na hora de dormir, sabe dormir, e o horário dele está
  // ligado. Passou do "acorda" (com a folga) sem voltar, o aviso volta — com a hora desde a última batida.
  const caidos = {
    rows: todos.rows.filter((a) => !silencioDoAgente({
      horario: a.horario_computador, fuso: a.timezone, sabe: a.sabe, ultimaBatida: a.ultimo_heartbeat, agora,
    }).dormindo),
  };
  if (caidos.rows.length === 0) return { criados: 0, agentes: 0 };

  // DUAS consultas de configuração para N agentes, não duas por agente.
  // O caso que decide este desenho é o pior: queda do provedor derruba a
  // rede inteira de uma vez, e é exatamente aí que a API não pode
  // multiplicar consultas pelo número de lojas afetadas.
  const lojas = [...new Set(caidos.rows.map((a) => a.loja_id))];
  const tenants = [...new Set(caidos.rows.map((a) => a.tenant_id))];

  const [pol, dest] = await Promise.all([
    pool.query<LinhaPolitica & { tenant_id: string }>(
      `select id, tenant_id, loja_id, severidade, prioridade, enviar, destino_id
         from politica_alerta
        where tenant_id = any($1::uuid[])
          and (loja_id = any($2::uuid[]) or loja_id is null)`,
      [tenants, lojas],
    ),
    pool.query<DestinoAtivo & { tenant_id: string }>(
      `select id, tenant_id, tipo, loja_id, papel
         from destino
        where tenant_id = any($1::uuid[])
          and (loja_id = any($2::uuid[]) or loja_id is null)
          and ativo`,
      [tenants, lojas],
    ),
  ]);

  /** As linhas que valem para esta loja: as dela mais as da rede dela. */
  const doEscopo = <T extends { tenant_id: string; loja_id: string | null }>(
    linhas: T[], tenantId: string, lojaId: string,
  ) => linhas.filter(
    (l) => l.tenant_id === tenantId && (l.loja_id === lojaId || l.loja_id === null),
  );

  const linhas: Record<string, unknown>[] = [];
  for (const ag of caidos.rows) {
    // Agente caído é sempre emergência/urgente: é a combinação que a
    // política só silencia se alguém disser explicitamente que quer ficar
    // sem saber.
    const d = resolverDestinos(
      doEscopo(pol.rows, ag.tenant_id, ag.loja_id),
      doEscopo(dest.rows, ag.tenant_id, ag.loja_id),
      'emergencia', 'urgente',
    );
    if (d.destinos.length === 0) continue;

    const faixa = faixaDeRepeticao(new Date(ag.ultimo_heartbeat), agora);
    for (const destinoId of d.destinos) {
      linhas.push({
        tenant_id: ag.tenant_id,
        loja_id: ag.loja_id,
        destino_id: destinoId,
        chave: chaveDeEnvio('agente_caiu', ag.id, destinoId, faixa),
        payload: {
          agente: ag.nome,
          desde: ag.ultimo_heartbeat,
          consequencia: 'esta loja não está sendo auditada',
        },
      });
    }
  }

  if (linhas.length === 0) return { criados: 0, agentes: caidos.rows.length };

  // E UM insert para todos os avisos de todas as lojas.
  const r = await pool.query(
    `insert into envio (tenant_id, loja_id, destino_id, motivo, chave, payload)
     select x.tenant_id, x.loja_id, x.destino_id, 'agente_caiu', x.chave, x.payload
       from jsonb_to_recordset($1::jsonb)
            as x(tenant_id uuid, loja_id uuid, destino_id uuid,
                 chave text, payload jsonb)
     on conflict (chave) do nothing`,
    [JSON.stringify(linhas)],
  );

  return { criados: r.rowCount ?? 0, agentes: caidos.rows.length };
}
