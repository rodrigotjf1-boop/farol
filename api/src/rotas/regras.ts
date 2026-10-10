// =====================================================================
// Regras — os critérios de análise
// =====================================================================
// É aqui que o produto ganha forma: uma regra diz, em português, o que
// é "conforme" naquela zona daquela câmera. O agente lê esse texto e o
// usa como pergunta ao juiz.
//
// Duas invariantes do projeto moram nestas rotas:
//
// **1 · Regra nasce sem avisar ninguém.** Criar já avisando seria começar
// a alertar a cozinha com base em critério que ninguém conferiu — e a loja
// aprende rápido a ignorar quem erra. Há dois jeitos de nascer:
//
//   - **observando** (o da tela nova): nasce LIGADA, porque observar é só
//     contar — as olhadas, o contexto, o gatilho. Não julga, não gasta e
//     não avisa. Desligada, não contaria nada;
//   - **em qualquer outro estado** (o cadastro de antes, que não fala em
//     estado e cria "valendo"): nasce DESLIGADA, como sempre. Ligar é outra
//     ação, consciente.
//
// **2 · Mudar o critério SOBE a versão.** A chave de idempotência do
// agente inclui `criterio_versao`; sem subir, um critério reescrito
// reaproveitaria o veredito do critério antigo. A pergunta mudou, a
// resposta tem que ser nova.
//
// **3 · Um critério, vários canais.** O critério é cadastrado uma vez e
// vale num CONJUNTO de áreas (`regra_alvo`) — o que está marcado na árvore
// de canais. Três cadastros iguais em três câmeras são três edições quando
// a redação muda, e esquecer uma deixa a loja auditando por duas redações
// sem ninguém saber qual.
//
// O conjunto é explícito, linha por linha. Não existe "o setor inteiro"
// guardado como vínculo vivo: câmera nova no setor aparece na árvore
// DESMARCADA. Herdar ligaria um critério num enquadramento que ninguém
// conferiu.
//
// O conjunto pode ficar vazio (tirou-se o critério do último canal). Aí
// ele não é auditado em lugar nenhum, e por isso é desligado junto: voltar
// a um canal e ligar de novo é decisão consciente, como na criação.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import {
  lerParametrosDoDetector,
  OBJETOS_DO_DETECTOR,
  TIPOS_DO_DETECTOR,
} from '../detector.js';
import { estadoNaoCabe } from '../estado.js';
import { familiaNaoCabe, familiaNatural, familiaSoObserva, sqlFamilia } from '../familia.js';
import { lerHorario, QUANDOS } from '../horario.js';
import { exigirConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

const TIPOS = ['estado', 'acao', 'presenca', 'contagem', 'comparacao'];
const PRIORIDADES = ['urgente', 'intermediaria', 'leve'];
const SEVERIDADES = ['info', 'atencao', 'critico', 'emergencia'];
const RESOLUCOES = ['r384', 'r640', 'r1mp', 'r1080'];
const ACOES = ['registro', 'kds', 'whatsapp', 'tarefa_regem', 'tv_regemboard'];
// Quando vale a pena conferir (migration 023). Quem responde é o detector,
// na loja, antes de a imagem ir para a nuvem.
export const PORTEIROS = ['sempre', 'pessoa', 'livre', 'movimento'];
const MAX_CONFIRMAR_EM = 10;

/**
 * O porteiro cabe naquele tipo de critério? Devolve a frase do problema.
 *
 * É a mesma regra da tela: presença e contagem já são julgadas na loja em
 * toda olhada (não há pergunta a segurar), e "quando algo se mexe" é de
 * critério de ação.
 */
export function porteiroNaoCabe(tipo: string, porteiro: string): string | null {
  if (porteiro === 'sempre') return null;
  if (TIPOS_DO_DETECTOR.includes(tipo)) {
    return 'porteiro: presença e contagem são julgadas na loja em toda olhada; use "sempre"';
  }
  if (porteiro === 'movimento' && tipo !== 'acao') {
    return 'porteiro: "movimento" vale só para critério de ação';
  }
  return null;
}

type Corpo = Record<string, unknown>;

function validar(c: Corpo, criando: boolean): string | null {
  if (criando) {
    if (!String(c.nome ?? '').trim()) return 'nome é obrigatório';
    if (!String(c.criterio ?? '').trim()) return 'criterio é obrigatório';
    if (!TIPOS.includes(String(c.tipo))) return `tipo: um de ${TIPOS.join(', ')}`;
  }
  if (c.tipo != null && !TIPOS.includes(String(c.tipo))) {
    return `tipo: um de ${TIPOS.join(', ')}`;
  }
  if (c.prioridade != null && !PRIORIDADES.includes(String(c.prioridade))) {
    return `prioridade: um de ${PRIORIDADES.join(', ')}`;
  }
  if (c.severidade != null && !SEVERIDADES.includes(String(c.severidade))) {
    return `severidade: um de ${SEVERIDADES.join(', ')}`;
  }
  if (c.resolucao != null && !RESOLUCOES.includes(String(c.resolucao))) {
    return `resolucao: um de ${RESOLUCOES.join(', ')}`;
  }
  if (c.confiancaMinima != null) {
    const v = Number(c.confiancaMinima);
    if (!Number.isFinite(v) || v < 0 || v > 1) return 'confiancaMinima: entre 0 e 1';
  }
  if (c.cooldownMin != null) {
    const v = Number(c.cooldownMin);
    if (!Number.isInteger(v) || v < 0) return 'cooldownMin: inteiro não negativo';
  }
  if (c.acoes != null) {
    if (!Array.isArray(c.acoes) || c.acoes.length === 0) {
      return 'acoes: ao menos uma';
    }
    const ruim = c.acoes.find((a) => !ACOES.includes(String(a)));
    if (ruim) return `acao desconhecida: ${ruim}. Válidas: ${ACOES.join(', ')}`;
  }
  // A faixa de horas do critério tem o MESMO formato do horário da loja, e
  // passa pela mesma conferência: dia de 1 a 7, hora HH:MM. Antes bastava
  // ser uma lista — e uma faixa torta descia para o agente como estava.
  if (c.janelas != null) {
    const lido = lerHorario(c.janelas);
    if (lido.problema) return lido.problema.replace(/^horario/, 'janelas');
  }
  if (c.porteiro != null && !PORTEIROS.includes(String(c.porteiro))) {
    return `porteiro: um de ${PORTEIROS.join(', ')}`;
  }
  // Liga e desliga: só `true` ou `false`. "sim", 1 ou "false" não são.
  if (c.comPadrao != null && typeof c.comPadrao !== 'boolean') {
    return 'comPadrao: verdadeiro ou falso';
  }
  if (c.confirmarEm != null) {
    const v = Number(c.confirmarEm);
    if (!Number.isInteger(v) || v < 1 || v > MAX_CONFIRMAR_EM) {
      return `confirmarEm: inteiro de 1 a ${MAX_CONFIRMAR_EM}`;
    }
  }
  // Em que horário conferir, em relação ao horário DA LOJA.
  if (c.quando != null && !(QUANDOS as readonly string[]).includes(String(c.quando))) {
    return `quando: um de ${QUANDOS.join(', ')}`;
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Teto de canais por critério. Uma loja tem dezenas de câmeras, não
// milhares; o teto existe para um corpo malformado não virar um `any()` de
// cem mil elementos.
const MAX_CANAIS = 500;

/**
 * Lê `zonaIds` do corpo: as áreas onde o critério vale.
 *
 * Devolve `undefined` quando o campo não veio (na edição, ausente mantém —
 * quem só trocou o nome não quis mexer nos canais), a lista sem repetição
 * quando veio, ou a mensagem do problema.
 */
export function lerZonaIds(c: Corpo): { ids?: string[]; problema?: string } {
  if (c.zonaIds === undefined) return {};
  if (!Array.isArray(c.zonaIds)) return { problema: 'zonaIds: lista de canais' };
  if (c.zonaIds.length > MAX_CANAIS) {
    return { problema: `zonaIds: no máximo ${MAX_CANAIS} canais por critério` };
  }
  const ids = new Set<string>();
  for (const z of c.zonaIds) {
    if (typeof z !== 'string' || !UUID.test(z)) return { problema: 'zonaIds: cada item é um uuid' };
    ids.add(z.toLowerCase());
  }
  return { ids: [...ids] };
}

// Onde cada critério vale, já com os nomes que a árvore mostra. Uma
// consulta para a loja inteira — nunca uma por critério.
const ALVOS_DO_CRITERIO = `
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'zona_id', z.id, 'zona_nome', z.nome, 'principal', z.principal,
             'ponto_id', p.id, 'ponto_nome', p.nome, 'canal', p.canal,
             'ponto_ativo', p.ativo,
             'ponto_padroes', (select count(*)::int from foto_padrao f where f.ponto_id = p.id),
             'setor_id', st.id, 'setor_nome', st.nome)
           order by st.ordem, st.nome, p.canal nulls last, p.nome, z.principal desc, z.nome)
      from regra_alvo ra
      join zona  z  on z.id  = ra.zona_id
      join ponto p  on p.id  = z.ponto_id
      join setor st on st.id = p.setor_id
     where ra.regra_id = r.id
  ), '[]'::jsonb)`;

/**
 * Cria o critério e o liga às áreas, numa instrução só.
 *
 * A checagem de dono mora DENTRO da consulta: só entra se TODAS as áreas
 * pedidas forem da mesma loja, e essa loja for da conta de quem pede. Uma
 * área de outra conta no meio da lista não é ignorada em silêncio — o
 * critério inteiro não nasce, porque "criei em 2 dos 3 canais que você
 * marcou" é pior que recusar.
 */
/**
 * Os campos do detector para um critério que está nascendo.
 *
 * Presença e contagem EXIGEM os campos: sem eles o critério nasceria sem
 * ter como ser julgado, e a tela mostraria um critério cadastrado que
 * nunca verifica nada. Os outros tipos usam só o texto, e não guardam
 * campo nenhum — mesmo que o corpo traga.
 */
function parametrosParaCriar(c: Corpo): { ok: Record<string, unknown> } | { problema: string } {
  // O porteiro tem de caber no tipo: é conferido aqui porque é aqui que as
  // duas rotas de criação passam, com o tipo já validado.
  const naoCabe = porteiroNaoCabe(String(c.tipo), String(c.porteiro ?? 'sempre'));
  if (naoCabe) return { problema: naoCabe };
  if (!TIPOS_DO_DETECTOR.includes(String(c.tipo))) return { ok: {} };
  return lerParametrosDoDetector(c.parametros);
}

async function criarRegra(
  pool: pg.Pool,
  tenantId: string,
  lojaId: string | null,
  zonaIds: string[],
  c: Corpo,
  parametros: Record<string, unknown>,
  familia: string,
): Promise<Record<string, unknown> | null> {
  // `ativa` não vem do corpo: quem decide é o estado com que o critério
  // nasce. Observando nasce ligado (só conta); o resto nasce desligado, e
  // ligar é outra ação, consciente.
  const { rows } = await pool.query(
    `with alvo as (
       select z.id as zona_id, st.loja_id
         from zona z
         join ponto p  on p.id  = z.ponto_id
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where z.id = any($1::uuid[])
          and l.tenant_id = $2
          and p.excluido_em is null
          -- Área excluída não recebe critério: ela não existe mais na tela.
          and z.excluida_em is null
          and ($3::uuid is null or l.id = $3)
     ),
     dono as (
       select min(loja_id::text)::uuid as loja_id
         from alvo
       having count(*) = $4 and count(distinct loja_id) = 1
     ),
     nova as (
       insert into regra (loja_id, nome, tipo, criterio, processo_descricao,
                          prioridade, severidade, confianca_minima, cooldown_min,
                          resolucao, janelas, acoes, retencao_midia_dias, parametros,
                          quando, porteiro, confirmar_em, com_padrao, estado, familia, ativa)
       select dono.loja_id, $5, $6, $7, $8,
              coalesce($9,'intermediaria'), coalesce($10,'atencao'),
              coalesce($11, 0.700), coalesce($12, 15), $13,
              coalesce($14,'[]'::jsonb), coalesce($15,'["registro"]'::jsonb),
              coalesce($16, 90), $17::jsonb,
              -- O comum é critério de operação: nasce "no horário".
              coalesce($18, 'no_horario'),
              -- E nasce perguntando em toda olhada e avisando na primeira.
              coalesce($19, 'sempre'), coalesce($20, 1), coalesce($21, false),
              -- Sem estado pedido, nasce como o cadastro de antes sempre
              -- criou: valendo. A tela nova é que pede "observando".
              coalesce($22, 'valendo'),
              $23,
              -- Observando nasce LIGADO: só conta, não julga e não avisa.
              coalesce($22, 'valendo') = 'observando'
         from dono
       returning id, nome, tipo, criterio, criterio_versao, prioridade,
                 severidade, confianca_minima, cooldown_min, resolucao,
                 janelas, acoes, ativa, parametros, quando, porteiro, confirmar_em, com_padrao,
                 estado, ${sqlFamilia('')} as familia
     ),
     ligados as (
       insert into regra_alvo (regra_id, zona_id)
       select nova.id, alvo.zona_id from nova cross join alvo
       returning zona_id
     )
     select nova.*, (select count(*)::int from ligados) as canais from nova`,
    [
      zonaIds, tenantId, lojaId, zonaIds.length,
      String(c.nome).trim(), String(c.tipo), String(c.criterio).trim(),
      c.processoDescricao ?? null,
      c.prioridade ?? null, c.severidade ?? null,
      c.confiancaMinima ?? null, c.cooldownMin ?? null, c.resolucao ?? null,
      c.janelas ? JSON.stringify(c.janelas) : null,
      c.acoes ? JSON.stringify(c.acoes) : null,
      c.retencaoMidiaDias ?? null,
      JSON.stringify(parametros),
      c.quando ?? null,
      c.porteiro ?? null,
      c.confirmarEm ?? null,
      typeof c.comPadrao === 'boolean' ? c.comPadrao : null,
      c.estado ?? null,
      familia,
    ],
  );
  return rows[0] ?? null;
}

const AVISO_NASCE_DESLIGADA =
  'a regra nasce desligada; ligue só depois de conferir a acurácia';
const AVISO_NASCE_OBSERVANDO =
  'o critério nasce observando e ligado: conta as olhadas, o contexto e o gatilho, sem julgar e sem avisar';

const avisoDeNascimento = (criada: Record<string, unknown>): string =>
  criada.ativa === true ? AVISO_NASCE_OBSERVANDO : AVISO_NASCE_DESLIGADA;

/**
 * A família com que o critério nasce, já conferida contra o tipo e o
 * estado pedidos. Devolve a família, ou a recusa (com o código HTTP).
 *
 * Família que ainda não tem juiz só nasce observando — ou pelo cadastro de
 * antes, que não fala em estado e cria desligado.
 */
function familiaParaCriar(c: Corpo): { familia: string } | { recusa: { erro: string; mensagem: string } } {
  const tipo = String(c.tipo);
  const naoCabe = familiaNaoCabe(c.familia, tipo);
  if (naoCabe) return { recusa: { erro: 'validacao', mensagem: naoCabe } };
  const dita = typeof c.familia === 'string';
  const familia = dita ? String(c.familia) : familiaNatural(tipo);
  // Quem DIZ a família (a tela nova) só cria o que ainda não tem juiz em
  // "observando". Quem não diz é o cadastro de antes: o critério de ação
  // dele nasce como sempre nasceu — só não nasce "em ensaio".
  if (c.estado === 'ensaio' || (dita && c.estado !== 'observando')) {
    const soObserva = familiaSoObserva(familia);
    if (soObserva) return { recusa: soObserva };
  }
  return { familia };
}

export function rotasDeRegras(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: Parameters<typeof sessaoDe>[1], resposta: {
    status: (n: number) => { send: (o: unknown) => unknown };
  }): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }

  // ───────────────────── listar os critérios da loja ─────────────────────

  app.get('/v1/lojas/:id/regras', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };

    // Um critério aparece UMA vez, com a lista de onde vale. Critério sem
    // canal nenhum também vem: senão ele ficaria guardado e invisível, sem
    // jeito de devolvê-lo a um canal.
    const { rows } = await pool.query(
      `select r.id, r.nome, r.tipo, r.criterio, r.criterio_versao,
              r.processo_descricao, r.prioridade, r.severidade,
              r.confianca_minima, r.cooldown_min, r.resolucao,
              r.janelas, r.acoes, r.ativa, r.retencao_midia_dias, r.parametros,
              r.quando, r.porteiro, r.confirmar_em, r.com_padrao, r.estado,
              ${sqlFamilia()} as familia,
              ${ALVOS_DO_CRITERIO} as alvos
         from regra r
         join loja l on l.id = r.loja_id
        where l.id = $1 and l.tenant_id = $2 and r.excluida_em is null
        order by r.nome, r.criado_em`,
      [id, s.tenantId],
    );
    // O vocabulário do detector vai junto: a tela monta a lista de "o que
    // procurar" a partir daqui, em vez de ter uma terceira cópia dela.
    return { regras: rows, detector: { objetos: OBJETOS_DO_DETECTOR } };
  });

  // ─────────────── criar um critério, em um ou vários canais ───────────────

  app.post('/v1/lojas/:id/regras', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const c = (req.body ?? {}) as Corpo;

    const problema = validar(c, true);
    if (problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }
    const z = lerZonaIds(c);
    if (z.problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: z.problema });
    }
    if (!z.ids || z.ids.length === 0) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: 'marque ao menos um canal: critério sem canal não é verificado em lugar nenhum',
      });
    }
    // O estado com que ele nasce: só os que uma pessoa escolhe.
    const estado = estadoNaoCabe(c.estado, null);
    if (estado) return resposta.status(422).send(estado);
    const f = familiaParaCriar(c);
    if ('recusa' in f) return resposta.status(422).send(f.recusa);

    const campos = parametrosParaCriar(c);
    if ('problema' in campos) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: campos.problema });
    }

    const criada = await criarRegra(pool, s.tenantId, id, z.ids, c, campos.ok, f.familia);
    if (!criada) {
      return resposta.status(404).send({
        erro: 'nao_encontrada',
        mensagem: 'loja ou canal não encontrado. Nenhum critério foi criado.',
      });
    }
    return resposta.status(201).send({ ...criada, aviso: avisoDeNascimento(criada) });
  });

  // Atalho de um canal só: o critério nasce valendo naquela área. Mantido
  // porque é o caso mais comum ("+ critério" em cima de um canal).
  app.post('/v1/zonas/:id/regras', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const c = (req.body ?? {}) as Corpo;

    const problema = validar(c, true);
    if (problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }
    if (!UUID.test(id)) {
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'zona não encontrada' });
    }
    const estado = estadoNaoCabe(c.estado, null);
    if (estado) return resposta.status(422).send(estado);
    const f = familiaParaCriar(c);
    if ('recusa' in f) return resposta.status(422).send(f.recusa);

    const campos = parametrosParaCriar(c);
    if ('problema' in campos) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: campos.problema });
    }

    const criada = await criarRegra(pool, s.tenantId, null, [id.toLowerCase()], c, campos.ok, f.familia);
    if (!criada) {
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'zona não encontrada' });
    }
    return resposta.status(201).send({ ...criada, aviso: avisoDeNascimento(criada) });
  });

  // ──────────────────────── editar um critério ──────────────────────────

  app.patch('/v1/regras/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const c = (req.body ?? {}) as Corpo;

    const problema = validar(c, false);
    if (problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }
    const z = lerZonaIds(c);
    if (z.problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: z.problema });
    }

    const novoCriterio = c.criterio != null ? String(c.criterio).trim() : null;
    if (c.criterio != null && !novoCriterio) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'criterio vazio' });
    }

    // Transação: os campos e os canais mudam JUNTOS ou não mudam. Trocar a
    // redação e falhar na lista de canais deixaria o critério novo valendo
    // nos canais antigos — exatamente o que quem editou não pediu.
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      // Os campos do detector dependem do TIPO final do critério, e o tipo
      // pode não vir no corpo. Lê-se o atual com a linha já travada, para
      // decidir antes de gravar — e para duas edições simultâneas passarem
      // uma depois da outra.
      const antes = await cliente.query(
        `select r.tipo, r.parametros, r.porteiro, r.estado, ${sqlFamilia()} as familia
           from regra r
           join loja l on l.id = r.loja_id
          where r.id = $1 and l.tenant_id = $2 and r.excluida_em is null
            for update of r`,
        [id, s.tenantId],
      );
      if (antes.rowCount === 0) {
        await cliente.query('rollback');
        return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'regra não encontrada' });
      }

      // O estado: uma pessoa leva a "observando" e a "ensaio"; a "medido" e
      // a "valendo" só se chega com o acerto medido. Pedir o estado em que o
      // critério já está não muda nada, e passa.
      const estadoAntes = String(antes.rows[0].estado);
      const estadoRuim = estadoNaoCabe(c.estado, estadoAntes);
      if (estadoRuim) {
        await cliente.query('rollback');
        return resposta.status(422).send(estadoRuim);
      }

      const tipoFinal = String(c.tipo ?? antes.rows[0].tipo);

      // A família: a pedida tem de caber no tipo FINAL. Quem troca o tipo sem
      // dizer a família fica com a natural do tipo novo — a que estava
      // guardada podia não caber mais (o banco recusaria).
      const familiaRuim = familiaNaoCabe(c.familia, tipoFinal);
      if (familiaRuim) {
        await cliente.query('rollback');
        return resposta.status(422).send({ erro: 'validacao', mensagem: familiaRuim });
      }
      const familiaAntes = String(antes.rows[0].familia);
      const familiaFinal =
        typeof c.familia === 'string'
          ? c.familia
          : c.tipo !== undefined && familiaNaoCabe(familiaAntes, tipoFinal)
            ? familiaNatural(tipoFinal)
            : familiaAntes;
      // Família que ainda não tem juiz só observa. São recusados: levar um
      // critério dela a "em ensaio", e levar a ela um critério que está
      // sendo julgado sem descê-lo a "observando" no mesmo pedido. O
      // critério de ação de ANTES das famílias, que já julgava, fica como
      // está: quem não muda de estado nem de família não passa por aqui.
      const estadoFinal = String(c.estado ?? estadoAntes);
      const passaAEnsaio = estadoFinal === 'ensaio' && estadoAntes !== 'ensaio';
      const trocaDeFamilia = familiaFinal !== familiaAntes;
      if (passaAEnsaio || (trocaDeFamilia && estadoFinal !== 'observando')) {
        const soObserva = familiaSoObserva(familiaFinal);
        if (soObserva) {
          await cliente.query('rollback');
          return resposta.status(422).send(soObserva);
        }
      }

      // O porteiro tem de caber no tipo FINAL. Mudar o tipo para presença
      // com "só com pessoa na área" guardado deixaria na tela uma opção
      // que o agente ignora; quem muda o tipo manda o porteiro junto.
      const naoCabe = porteiroNaoCabe(tipoFinal, String(c.porteiro ?? antes.rows[0].porteiro));
      if (naoCabe && (c.porteiro !== undefined || c.tipo !== undefined)) {
        await cliente.query('rollback');
        return resposta.status(422).send({ erro: 'validacao', mensagem: naoCabe });
      }
      let novosParametros: Record<string, unknown> | null = null;   // null = mantém
      if (TIPOS_DO_DETECTOR.includes(tipoFinal)) {
        const lido = lerParametrosDoDetector(
          c.parametros !== undefined ? c.parametros : antes.rows[0].parametros,
        );
        if ('problema' in lido) {
          // Critério de presença antigo, ainda sem os campos, pode ter o
          // nome corrigido sem ser barrado. Mas mexer nos campos, mudar o
          // tipo ou LIGAR exige que eles estejam certos: ligado sem dizer
          // o que procurar seria "Ligado" na tela com nada sendo verificado.
          const precisaEstarCerto =
            c.parametros !== undefined || c.tipo !== undefined || c.ativa === true;
          if (precisaEstarCerto) {
            await cliente.query('rollback');
            return resposta.status(422).send({
              erro: c.ativa === true && c.parametros === undefined ? 'sem_campos' : 'validacao',
              mensagem:
                c.ativa === true && c.parametros === undefined
                  ? `este critério ainda não diz o que procurar. Edite-o e escolha o objeto antes de ligar. (${lido.problema})`
                  : lido.problema,
            });
          }
        } else if (c.parametros !== undefined) {
          novosParametros = lido.ok;
        }
      } else if (c.parametros !== undefined || c.tipo !== undefined) {
        // Tipos que usam só o texto não guardam campo de detector.
        novosParametros = {};
      }

      // A versão sobe QUANDO E SÓ QUANDO o texto do critério muda. A chave
      // de idempotência do agente inclui essa versão: sem subir, o critério
      // reescrito reaproveitaria o veredito do critério antigo — a pergunta
      // mudou e a resposta seria a de antes.
      //
      // Este UPDATE também TRAVA a linha do critério até o fim da
      // transação. Duas pessoas mexendo nos canais do mesmo critério ao
      // mesmo tempo passam uma depois da outra, e vale a última inteira —
      // sem isso o resultado seria uma mistura das duas marcações.
      const { rows } = await cliente.query(
        `update regra r
            set nome               = coalesce($2, r.nome),
                tipo               = coalesce($3, r.tipo),
                criterio           = coalesce($4, r.criterio),
                criterio_versao    = r.criterio_versao
                                     + case when $4 is not null and $4 <> r.criterio
                                            then 1 else 0 end,
                processo_descricao = coalesce($5, r.processo_descricao),
                prioridade         = coalesce($6, r.prioridade),
                severidade         = coalesce($7, r.severidade),
                confianca_minima   = coalesce($8, r.confianca_minima),
                cooldown_min       = coalesce($9, r.cooldown_min),
                resolucao          = coalesce($10, r.resolucao),
                janelas            = coalesce($11::jsonb, r.janelas),
                acoes              = coalesce($12::jsonb, r.acoes),
                ativa              = coalesce($13, r.ativa),
                retencao_midia_dias = coalesce($14, r.retencao_midia_dias),
                parametros         = coalesce($16::jsonb, r.parametros),
                quando             = coalesce($17, r.quando),
                porteiro           = coalesce($18, r.porteiro),
                confirmar_em       = coalesce($19, r.confirmar_em),
                com_padrao         = coalesce($20, r.com_padrao),
                estado             = coalesce($21, r.estado),
                familia            = $22,
                atualizado_em      = now()
           from loja l
          where r.id = $1
            and l.id = r.loja_id
            and l.tenant_id = $15
         returning r.id, r.nome, r.tipo, r.criterio, r.criterio_versao,
                   r.prioridade, r.severidade, r.confianca_minima,
                   r.cooldown_min, r.resolucao, r.janelas, r.acoes, r.ativa,
                   r.parametros, r.quando, r.porteiro, r.confirmar_em, r.com_padrao, r.estado,
                   ${sqlFamilia()} as familia,
                   r.loja_id`,
        [
          id,
          c.nome != null ? String(c.nome).trim() : null,
          c.tipo ?? null,
          novoCriterio,
          c.processoDescricao ?? null,
          c.prioridade ?? null, c.severidade ?? null,
          c.confiancaMinima ?? null, c.cooldownMin ?? null, c.resolucao ?? null,
          c.janelas ? JSON.stringify(c.janelas) : null,
          c.acoes ? JSON.stringify(c.acoes) : null,
          typeof c.ativa === 'boolean' ? c.ativa : null,
          c.retencaoMidiaDias ?? null,
          s.tenantId,
          novosParametros === null ? null : JSON.stringify(novosParametros),
          c.quando ?? null,
          c.porteiro ?? null,
          c.confirmarEm ?? null,
          typeof c.comPadrao === 'boolean' ? c.comPadrao : null,
          c.estado ?? null,
          familiaFinal,
        ],
      );
      if (rows.length === 0) {
        await cliente.query('rollback');
        return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'regra não encontrada' });
      }
      const { loja_id: lojaId, ...regra } = rows[0];

      if (z.ids !== undefined) {
        // Todos os canais pedidos têm que ser DESTA loja. Um de fora não é
        // ignorado: nada muda, e a resposta diz por quê.
        const validas = await cliente.query(
          `select z.id
             from zona z
             join ponto p  on p.id  = z.ponto_id
             join setor st on st.id = p.setor_id
            where st.loja_id = $1 and z.id = any($2::uuid[])
              and p.excluido_em is null and z.excluida_em is null`,
          [lojaId, z.ids],
        );
        if (validas.rowCount !== z.ids.length) {
          await cliente.query('rollback');
          return resposta.status(422).send({
            erro: 'validacao',
            mensagem: 'há canal marcado que não é desta loja. Nada foi alterado.',
          });
        }
        // O conjunto marcado SUBSTITUI o anterior, em duas instruções —
        // nunca um laço de um insert por canal.
        await cliente.query(
          'delete from regra_alvo where regra_id = $1 and zona_id <> all($2::uuid[])',
          [id, z.ids],
        );
        await cliente.query(
          `insert into regra_alvo (regra_id, zona_id)
           select $1, unnest($2::uuid[])
           on conflict do nothing`,
          [id, z.ids],
        );
      }

      const n = await cliente.query(
        'select count(*)::int as canais from regra_alvo where regra_id = $1',
        [id],
      );
      const canais: number = n.rows[0].canais;

      let desligada = false;
      if (canais === 0 && regra.ativa) {
        if (c.ativa === true) {
          // Ligar o que não vale em canal nenhum mostraria "Ligada" na tela
          // com nada sendo verificado — a pior mentira que este produto
          // pode contar.
          await cliente.query('rollback');
          return resposta.status(422).send({
            erro: 'sem_canal',
            mensagem: 'este critério não está em nenhum canal. Marque ao menos um antes de ligar.',
          });
        }
        await cliente.query('update regra set ativa = false where id = $1', [id]);
        regra.ativa = false;
        desligada = true;
      }

      await cliente.query('commit');

      if (typeof c.ativa === 'boolean' || desligada) {
        // Ligar e desligar regra muda o que a loja recebe. Fica no log com
        // quem fez — é o mínimo até a auditoria em tabela existir.
        req.log.info(
          { regra: id, por: s.usuarioId, ativa: regra.ativa, canais },
          regra.ativa ? 'regra LIGADA' : 'regra desligada',
        );
      }
      if (z.ids !== undefined) {
        req.log.info({ regra: id, por: s.usuarioId, canais }, 'canais do critério alterados');
      }
      if (regra.estado !== estadoAntes) {
        // Mudar o estado muda se a loja é avisada ou não: fica no log com quem fez.
        req.log.info({ regra: id, por: s.usuarioId, de: estadoAntes, para: regra.estado }, 'estado do critério alterado');
      }
      return { ...regra, canais, desligada };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ─────────────── tirar o critério de UM canal ───────────────
  // É o "apagar" da árvore: o critério some daquele canal e continua nos
  // outros. O critério em si nunca é apagado por aqui — o histórico de
  // vereditos aponta para ele.

  app.delete('/v1/regras/:id/canais/:zonaId', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id, zonaId } = req.params as { id: string; zonaId: string };
    if (!UUID.test(id) || !UUID.test(zonaId)) {
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'critério não encontrado' });
    }

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      // `for update`: a contagem de "quantos canais sobraram" decide se o
      // critério é desligado, e duas remoções simultâneas dos dois últimos
      // canais não podem ver, cada uma, "ainda sobra um".
      //
      // Hoje o gatilho que sobe `loja.config_versao` já faria as duas
      // passarem uma depois da outra (ele atualiza a linha da loja). Medi:
      // sem esta trava o teste de corrida continua passando. Ela fica
      // mesmo assim, porque a garantia não deve depender do efeito
      // colateral de um gatilho que existe por outro motivo.
      const r = await cliente.query(
        `select r.id, r.ativa
           from regra r
           join loja l on l.id = r.loja_id
          where r.id = $1 and l.tenant_id = $2 and r.excluida_em is null
            for update of r`,
        [id, s.tenantId],
      );
      if (r.rowCount === 0) {
        await cliente.query('rollback');
        return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'critério não encontrado' });
      }

      const tirado = await cliente.query(
        'delete from regra_alvo where regra_id = $1 and zona_id = $2',
        [id, zonaId],
      );
      if (tirado.rowCount === 0) {
        await cliente.query('rollback');
        return resposta.status(404).send({
          erro: 'nao_esta_no_canal',
          mensagem: 'este critério já não está neste canal',
        });
      }

      const n = await cliente.query(
        'select count(*)::int as restantes from regra_alvo where regra_id = $1',
        [id],
      );
      const restantes: number = n.rows[0].restantes;

      const desligada = restantes === 0 && r.rows[0].ativa === true;
      if (desligada) {
        await cliente.query('update regra set ativa = false where id = $1', [id]);
      }

      await cliente.query('commit');

      // Tirar um critério de um canal muda o que a loja audita. Fica no
      // log com quem fez.
      req.log.info(
        { regra: id, zona: zonaId, por: s.usuarioId, restantes, desligada },
        'critério removido de um canal',
      );
      return { removido: true, restantes, desligada };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ─────────────────────── excluir o critério ───────────────────────
  // Pedido do dono (07/10/2026). "Tirar do canal" continua existindo e é
  // outra coisa: tira de UM canal e o critério segue nos outros.
  //
  // Excluir tira de todos e some da tela. A LINHA fica (migration 014): os
  // vereditos que este critério já produziu apontam para ela, e é com ela
  // que o histórico continua tendo nome.

  app.delete('/v1/regras/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'critério não encontrado' });
    if (!UUID.test(id)) return naoAchei();

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      const r = await cliente.query(
        `select r.id, r.nome
           from regra r
           join loja l on l.id = r.loja_id
          where r.id = $1 and l.tenant_id = $2 and r.excluida_em is null
            for update of r`,
        [id, s.tenantId],
      );
      if (r.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei();
      }

      const tirados = await cliente.query('delete from regra_alvo where regra_id = $1', [id]);
      await cliente.query(
        `update regra
            set excluida_em = now(), excluida_por = $2, ativa = false, atualizado_em = now()
          where id = $1`,
        [id, s.usuarioId],
      );

      await cliente.query('commit');

      // Excluir um critério muda o que a loja audita. Fica no log com quem fez.
      req.log.info(
        { regra: id, nome: r.rows[0].nome, por: s.usuarioId, canais: tirados.rowCount },
        'critério EXCLUÍDO',
      );
      return { excluido: true, canais: tirados.rowCount ?? 0 };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });
}
