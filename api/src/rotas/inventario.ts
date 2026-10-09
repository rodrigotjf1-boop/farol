// =====================================================================
// O inventário de equipamentos da loja
// =====================================================================
// A chapa, a bancada, o caixa: cada equipamento com o setor, o tipo, até
// quatro fotos dele limpo e no lugar, a descrição e o que vale conferir.
//
// **Não é o catálogo `equipamento`** (o que o Farol indica comprar): aquele
// é da distribuição e nenhuma rota do console o devolve. Aqui tudo é da
// loja, e por isso tudo é filtrado pelo tenant de quem pede.
//
// **Duas origens de foto.**
//   `canal`  copia o quadro que o canal tem (como a foto padrão: dentro do
//            banco, sem os bytes passarem por aqui) e guarda o desenho da
//            área naquele instante. É a foto que diz ONDE o equipamento
//            aparece.
//   `envio`  uma foto mandada pelo console. Chega reduzida pelo navegador;
//            aqui se confere que é JPEG, o tamanho, e se lê a largura e a
//            altura do próprio arquivo.
//
// **A listagem nunca traz os bytes.**
//
// **A descrição pode ser feita pela análise das fotos** — um comando para
// o agente da loja (é ele que tem a chave do modelo; a API não tem
// nenhuma). O que volta é uma SUGESTÃO, guardada no comando: só vira a
// descrição do equipamento quando alguém lê e salva.
//
// **"Compara na loja"** é dito pela mesma regra do agente: critério de
// comparação é julgado na loja quando o CANAL tem foto padrão
// (`JuizDoPadrao.atende`). Então o equipamento "compara na loja" quando
// aparece num canal que tem foto padrão — não por ter foto própria.
// =====================================================================

import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import { exigirConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

export const MAX_FOTOS_POR_ITEM = 4;
export const TIPOS_DE_ITEM = [
  'chapa', 'fritadeira', 'bancada', 'geladeira', 'balcao', 'caixa', 'prateleira', 'pia', 'outro',
] as const;
/** A foto enviada, depois de decodificada. O navegador já a reduz antes. */
export const MAX_BYTES_DA_FOTO = 1_500_000;
const MAX_NOME = 80;
const MAX_DESCRICAO = 2000;
export const MAX_CONFERIR = 8;
const MAX_FRASE = 160;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O que a análise das fotos devolve: a descrição e o que vale conferir. */
export type DescricaoSugerida = {
  descricao: string;
  conferir: string[];
  modelo: string | null;
  custoCentavos: number | null;
};

/**
 * Lê o que o agente devolveu. É texto escrito por um modelo: o que passa do
 * tamanho é CORTADO, não recusado — a pessoa vai ler e corrigir antes de
 * salvar, e recusar a resposta inteira por uma frase comprida jogaria fora
 * uma análise já paga. Sem descrição, aí sim, não há o que guardar.
 */
export function lerDescricaoDoAgente(corpo: unknown): { sugestao?: DescricaoSugerida; problema?: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (typeof c.descricao !== 'string' || !c.descricao.trim()) {
    return { problema: 'mande descricao (texto) ou erro' };
  }
  const conferir: string[] = [];
  if (Array.isArray(c.conferir)) {
    for (const f of c.conferir) {
      if (typeof f !== 'string') continue;
      const limpa = f.trim().slice(0, MAX_FRASE).trim();
      if (limpa && !conferir.includes(limpa) && conferir.length < MAX_CONFERIR) conferir.push(limpa);
    }
  }
  return {
    sugestao: {
      descricao: c.descricao.trim().slice(0, MAX_DESCRICAO).trim(),
      conferir,
      modelo: typeof c.modelo === 'string' && c.modelo.trim() ? c.modelo.trim().slice(0, 80) : null,
      custoCentavos:
        typeof c.custoCentavos === 'number' && Number.isFinite(c.custoCentavos) && c.custoCentavos >= 0
          ? Math.round(c.custoCentavos * 1000) / 1000
          : null,
    },
  };
}

/**
 * O agente respondeu um comando `descrever_item`: guarda a sugestão NO
 * COMANDO. O cadastro do equipamento não muda aqui.
 */
export async function registrarDescricao(
  pool: pg.Pool,
  comandoId: string,
  corpo: unknown,
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const lido = lerDescricaoDoAgente(corpo);
  if (lido.problema) return { status: 422, corpo: { erro: 'validacao', mensagem: lido.problema } };
  await pool.query(
    `update comando_agente set estado = 'concluido', concluido_em = now(), erro = null, resultado = $2::jsonb where id = $1`,
    [comandoId, JSON.stringify(lido.sugestao)],
  );
  return { status: 200, corpo: { ok: true, pontosAConferir: lido.sugestao!.conferir.length } };
}

// ───────────────────────── o que entra ─────────────────────────

type Campos = {
  nome?: string;
  tipo?: string;
  setorId?: string;
  descricao?: string;
  conferir?: string[];
};

/**
 * Lê o que veio no corpo. `criando` exige nome e setor; na edição, campo
 * ausente mantém o que está guardado.
 */
export function lerItem(corpo: unknown, criando: boolean): { campos?: Campos; problema?: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const campos: Campos = {};

  if (c.nome !== undefined || criando) {
    if (typeof c.nome !== 'string' || !c.nome.trim()) return { problema: 'dê um nome ao equipamento (ex.: "Chapa")' };
    if (c.nome.trim().length > MAX_NOME) return { problema: `o nome tem no máximo ${MAX_NOME} caracteres` };
    campos.nome = c.nome.trim();
  }
  if (c.tipo !== undefined) {
    if (typeof c.tipo !== 'string' || !(TIPOS_DE_ITEM as readonly string[]).includes(c.tipo)) {
      return { problema: `tipo: um de ${TIPOS_DE_ITEM.join(', ')}` };
    }
    campos.tipo = c.tipo;
  }
  if (c.setorId !== undefined || criando) {
    if (typeof c.setorId !== 'string' || !UUID.test(c.setorId)) return { problema: 'escolha o setor do equipamento' };
    campos.setorId = c.setorId;
  }
  if (c.descricao !== undefined) {
    if (typeof c.descricao !== 'string') return { problema: 'descricao: texto' };
    if (c.descricao.trim().length > MAX_DESCRICAO) return { problema: `a descrição tem no máximo ${MAX_DESCRICAO} caracteres` };
    campos.descricao = c.descricao.trim();
  }
  if (c.conferir !== undefined) {
    if (!Array.isArray(c.conferir)) return { problema: 'conferir: lista de frases' };
    const frases: string[] = [];
    for (const f of c.conferir) {
      if (typeof f !== 'string') return { problema: 'conferir: lista de frases' };
      const limpa = f.trim();
      if (!limpa) continue;
      if (limpa.length > MAX_FRASE) return { problema: `cada ponto a conferir tem no máximo ${MAX_FRASE} caracteres` };
      if (!frases.includes(limpa)) frases.push(limpa);
    }
    if (frases.length > MAX_CONFERIR) return { problema: `no máximo ${MAX_CONFERIR} pontos a conferir por equipamento` };
    campos.conferir = frases;
  }
  return { campos };
}

/**
 * A largura e a altura de um JPEG, lidas do próprio arquivo — ou `null` se
 * não for um JPEG inteiro. É a única conferência de imagem que a API faz: o
 * que chega aqui já foi reduzido e regravado pelo navegador.
 */
export function tamanhoDoJpeg(b: Buffer): { largura: number; altura: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marca = b[i + 1]!;
    // preenchimento entre segmentos
    if (marca === 0xff) {
      i += 1;
      continue;
    }
    // marcas sem tamanho
    if (marca === 0xd8 || (marca >= 0xd0 && marca <= 0xd7) || marca === 0x01) {
      i += 2;
      continue;
    }
    if (marca === 0xd9 || marca === 0xda) return null; // fim, ou começo dos dados, sem ter visto o tamanho
    const tamanho = b.readUInt16BE(i + 2);
    if (tamanho < 2) return null;
    // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC): é onde mora o tamanho
    if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
      if (i + 9 > b.length) return null;
      const altura = b.readUInt16BE(i + 5);
      const largura = b.readUInt16BE(i + 7);
      return largura > 0 && altura > 0 ? { largura, altura } : null;
    }
    i += 2 + tamanho;
  }
  return null;
}

// ───────────────────────── o que sai ─────────────────────────

const FOTOS_DO_ITEM = `
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'origem', f.origem, 'pontoId', f.ponto_id, 'zonaId', f.zona_id,
             'recorte', f.recorte, 'largura', f.largura, 'altura', f.altura)
           order by f.criada_em, f.id)
      from inventario_foto f where f.item_id = i.id
  ), '[]'::jsonb)`;

// Onde o equipamento aparece: o canal e a área das fotos de origem `canal`
// que ainda existem. `fotosPadrao` é o que decide "compara na loja".
const LUGARES_DO_ITEM = `
  coalesce((
    select jsonb_agg(x.lugar order by x.lugar->>'pontoNome', x.lugar->>'zonaNome')
      from (
        select distinct jsonb_build_object(
                 'pontoId', p.id, 'pontoNome', p.nome, 'canal', p.canal,
                 'zonaId', z.id, 'zonaNome', z.nome,
                 'variasAreas', (select count(*) from zona z2 where z2.ponto_id = p.id and z2.excluida_em is null) > 1,
                 'fotosPadrao', (select count(*)::int from foto_padrao fp where fp.ponto_id = p.id)) as lugar
          from inventario_foto f
          join zona  z on z.id = f.zona_id  and z.excluida_em is null
          join ponto p on p.id = z.ponto_id and p.excluido_em is null
         where f.item_id = i.id and f.origem = 'canal'
      ) x
  ), '[]'::jsonb)`;

const CAMPOS_DO_ITEM = `i.id, i.loja_id, i.setor_id, st.nome as setor_nome, i.nome, i.tipo, i.descricao, i.conferir,
                        i.descrito_em, i.descrito_por, i.atualizado_em,
                        ${FOTOS_DO_ITEM} as fotos, ${LUGARES_DO_ITEM} as aparece`;

type Lugar = { pontoId: string; pontoNome: string; canal: number | null; zonaId: string; zonaNome: string; variasAreas: boolean; fotosPadrao: number };
type LinhaDoItem = {
  id: string;
  loja_id: string;
  setor_id: string;
  setor_nome: string;
  nome: string;
  tipo: string;
  descricao: string;
  conferir: string[];
  descrito_em: Date | null;
  descrito_por: string | null;
  atualizado_em: Date;
  fotos: unknown[];
  aparece: Lugar[];
};

const paraTela = (i: LinhaDoItem) => ({
  id: i.id,
  lojaId: i.loja_id,
  setorId: i.setor_id,
  setorNome: i.setor_nome,
  nome: i.nome,
  tipo: i.tipo,
  descricao: i.descricao,
  conferir: i.conferir,
  descritoEm: i.descrito_em,
  descritoPor: i.descrito_por,
  atualizadoEm: i.atualizado_em,
  fotos: i.fotos,
  aparece: i.aparece,
  // A mesma regra do agente: comparação é julgada na loja quando o canal
  // tem foto padrão.
  comparaNaLoja: i.aparece.some((l) => l.fotosPadrao > 0),
});

export function rotasDeInventario(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }
  const naoAchei = (resposta: FastifyReply, oQue = 'equipamento não encontrado') =>
    resposta.status(404).send({ erro: 'nao_encontrado', mensagem: oQue });

  const umItem = async (cliente: pg.Pool | pg.PoolClient, id: string, tenantId: string) =>
    (
      await cliente.query<LinhaDoItem>(
        `select ${CAMPOS_DO_ITEM}
           from inventario_item i
           join setor st on st.id = i.setor_id
           join loja  l  on l.id  = i.loja_id
          where i.id = $1 and l.tenant_id = $2`,
        [id, tenantId],
      )
    ).rows[0];

  // ───────────────────── a lista da loja ─────────────────────

  app.get('/v1/lojas/:id/inventario', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'loja não encontrada');

    const loja = await pool.query('select 1 from loja where id = $1 and tenant_id = $2', [id, s.tenantId]);
    if (loja.rowCount === 0) return naoAchei(resposta, 'loja não encontrada');

    const { rows } = await pool.query<LinhaDoItem>(
      `select ${CAMPOS_DO_ITEM}
         from inventario_item i
         join setor st on st.id = i.setor_id
        where i.loja_id = $1
        order by st.ordem, st.nome, lower(i.nome)`,
      [id],
    );
    return { itens: rows.map(paraTela), tipos: TIPOS_DE_ITEM, maximoDeFotos: MAX_FOTOS_POR_ITEM, maximoAConferir: MAX_CONFERIR };
  });

  // ───────────────────── cadastrar ─────────────────────

  app.post('/v1/lojas/:id/inventario', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'loja não encontrada');

    const lido = lerItem(req.body, true);
    if (lido.problema) return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
    const c = lido.campos!;

    // O setor tem de ser DESTA loja, e a loja de quem pede: as duas coisas
    // saem do mesmo `select`, senão um id adivinhado cadastraria o
    // equipamento no setor de outra conta.
    let novo;
    try {
      novo = await pool.query<{ id: string }>(
        `insert into inventario_item (loja_id, setor_id, nome, tipo, descricao, conferir, criado_por)
         select l.id, st.id, $3, coalesce($4, 'outro'), coalesce($5, ''), coalesce($6::jsonb, '[]'::jsonb), $7
           from loja l
           join setor st on st.loja_id = l.id
          where l.id = $1 and l.tenant_id = $8 and st.id = $2
         returning id`,
        [id, c.setorId, c.nome, c.tipo ?? null, c.descricao ?? null, c.conferir ? JSON.stringify(c.conferir) : null, s.usuarioId, s.tenantId],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        return resposta.status(409).send({
          erro: 'nome_repetido',
          mensagem: `esta loja já tem um equipamento chamado “${c.nome}”. Dê outro nome.`,
        });
      }
      throw e;
    }
    if (novo.rowCount === 0) return naoAchei(resposta, 'loja ou setor não encontrado');
    req.log.info({ loja: id, item: novo.rows[0]!.id, por: s.usuarioId }, 'equipamento CADASTRADO no inventário');
    return resposta.status(201).send(paraTela((await umItem(pool, novo.rows[0]!.id, s.tenantId))!));
  });

  // ───────────────────── editar ─────────────────────

  app.patch('/v1/inventario/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const lido = lerItem(req.body, false);
    if (lido.problema) return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
    const c = lido.campos!;

    let r;
    try {
      // O setor novo, se veio, tem de ser da MESMA loja do equipamento.
      r = await pool.query(
        `update inventario_item i
            set nome      = coalesce($3, i.nome),
                tipo      = coalesce($4, i.tipo),
                setor_id  = coalesce($5, i.setor_id),
                descricao = coalesce($6, i.descricao),
                conferir  = coalesce($7::jsonb, i.conferir),
                atualizado_em = now()
           from loja l
          where i.id = $1 and l.id = i.loja_id and l.tenant_id = $2
            and ($5::uuid is null or exists (select 1 from setor st where st.id = $5 and st.loja_id = i.loja_id))
        returning i.id`,
        [id, s.tenantId, c.nome ?? null, c.tipo ?? null, c.setorId ?? null, c.descricao ?? null, c.conferir ? JSON.stringify(c.conferir) : null],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        return resposta.status(409).send({
          erro: 'nome_repetido',
          mensagem: `esta loja já tem um equipamento chamado “${c.nome}”. Dê outro nome.`,
        });
      }
      throw e;
    }
    if (r.rowCount === 0) {
      // Ou o equipamento não é desta conta, ou o setor não é da loja dele.
      const existe = await umItem(pool, id, s.tenantId);
      if (!existe) return naoAchei(resposta);
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'o setor escolhido não é desta loja' });
    }

    // Salvar a descrição é a pessoa dizendo qual ela é: as sugestões da
    // análise que estavam esperando ficam resolvidas. Se o texto salvo
    // veio de uma delas (`daAnalise`), o cadastro guarda quando e por qual
    // modelo foi escrita.
    if (c.descricao !== undefined) {
      const daAnalise = (req.body as { daAnalise?: unknown } | null)?.daAnalise;
      const resolvidas = await pool.query<{ id: string; resultado: DescricaoSugerida | null }>(
        `update comando_agente
            set aplicado_em = now()
          where item_id = $1 and tipo = 'descrever_item' and estado = 'concluido' and aplicado_em is null
        returning id, resultado`,
        [id],
      );
      const usada = typeof daAnalise === 'string' ? resolvidas.rows.find((x) => x.id === daAnalise) : undefined;
      if (usada) {
        await pool.query('update inventario_item set descrito_em = now(), descrito_por = $2 where id = $1', [
          id,
          usada.resultado?.modelo ?? null,
        ]);
      }
    }
    return paraTela((await umItem(pool, id, s.tenantId))!);
  });

  // ───────────────────── excluir ─────────────────────

  app.delete('/v1/inventario/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    // Some de verdade, com as fotos: nada do histórico aponta para o
    // equipamento, e as fotos são imagens de dentro da loja.
    const r = await pool.query(
      `delete from inventario_item i
        using loja l
        where i.id = $1 and l.id = i.loja_id and l.tenant_id = $2
       returning i.nome`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta);
    req.log.info({ item: id, por: s.usuarioId }, 'equipamento EXCLUÍDO do inventário');
    return { excluido: true, nome: r.rows[0].nome as string };
  });

  // ───────────────── a análise das fotos (a descrição) ─────────────────

  app.post('/v1/inventario/:id/descricao', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // A linha do equipamento fica travada: dois cliques ao mesmo tempo
      // não viram duas análises pagas.
      const item = await cliente.query(
        `select i.id, i.loja_id, i.nome, i.tipo, st.nome as setor, l.modo_julgamento
           from inventario_item i
           join loja  l  on l.id  = i.loja_id
           join setor st on st.id = i.setor_id
          where i.id = $1 and l.tenant_id = $2
            for update of i`,
        [id, s.tenantId],
      );
      const recusar = async (status: number, erro: string, mensagem: string) => {
        await cliente.query('rollback');
        return resposta.status(status).send({ erro, mensagem });
      };
      if (item.rowCount === 0) return await recusar(404, 'nao_encontrado', 'equipamento não encontrado');
      const i = item.rows[0];

      const fotos = await cliente.query(
        `select f.id, f.origem, f.recorte, f.sha256 from inventario_foto f where f.item_id = $1 order by f.criada_em, f.id`,
        [id],
      );
      if (fotos.rowCount === 0) {
        return await recusar(409, 'sem_foto', 'ponha pelo menos uma foto: é dela que a descrição sai');
      }
      // Loja em modo local: nenhuma imagem sai dela. A descrição continua
      // podendo ser escrita à mão.
      if (i.modo_julgamento === 'local') {
        return await recusar(
          409,
          'modo_local',
          'esta loja julga tudo dentro dela: nenhuma imagem sai, nem para descrever um equipamento. Escreva a descrição à mão.',
        );
      }

      // Pedido repetido não empilha: enquanto um estiver a caminho, é ele.
      const pendente = await cliente.query(
        `select id, expira_em from comando_agente
          where item_id = $1 and tipo = 'descrever_item'
            and estado in ('pendente', 'entregue') and expira_em > now()
          order by criado_em desc limit 1`,
        [id],
      );
      if ((pendente.rowCount ?? 0) > 0) {
        await cliente.query('commit');
        return resposta.status(202).send({ comandoId: pendente.rows[0].id, expiraEm: pendente.rows[0].expira_em, jaPedido: true });
      }

      // Quem analisa é um agente ATIVO da loja — o que bateu por último.
      const a = await cliente.query(
        `select id from agente where loja_id = $1 and estado = 'ativo' order by ultimo_heartbeat desc nulls last limit 1`,
        [i.loja_id],
      );
      if (a.rowCount === 0) {
        return await recusar(
          409,
          'sem_agente',
          'nenhum agente ativo nesta loja. Quem analisa as fotos é o computador da loja — sem ele não há como descrever.',
        );
      }

      // O agente recebe o que precisa para trabalhar: o que é o
      // equipamento e quais fotos baixar (com o resumo de cada uma, para
      // conferir o que desceu).
      const parametros = {
        itemId: id,
        nome: i.nome,
        tipo: i.tipo,
        setor: i.setor,
        fotos: fotos.rows.map((f) => ({ id: f.id, origem: f.origem, recorte: f.recorte, sha256: f.sha256 })),
      };
      const c = await cliente.query(
        `insert into comando_agente (agente_id, tipo, item_id, parametros, criado_por, expira_em)
         values ($1, 'descrever_item', $2, $3::jsonb, $4, now() + interval '3 minutes')
         returning id, expira_em`,
        [a.rows[0].id, id, JSON.stringify(parametros), s.usuarioId],
      );
      await cliente.query('commit');
      req.log.info({ item: id, comando: c.rows[0].id, fotos: fotos.rowCount, por: s.usuarioId }, 'análise das fotos PEDIDA');
      return resposta.status(202).send({ comandoId: c.rows[0].id, expiraEm: c.rows[0].expira_em, jaPedido: false });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  /** Em que pé está a análise, e a sugestão que ainda espera alguém ler. */
  app.get('/v1/inventario/:id/descricao', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const dono = await pool.query(
      'select 1 from inventario_item i join loja l on l.id = i.loja_id where i.id = $1 and l.tenant_id = $2',
      [id, s.tenantId],
    );
    if (dono.rowCount === 0) return naoAchei(resposta);

    const ultimo = await pool.query(
      `select id, estado, erro, criado_em, concluido_em, (expira_em < now()) as vencido
         from comando_agente
        where item_id = $1 and tipo = 'descrever_item'
        order by criado_em desc limit 1`,
      [id],
    );
    const pendente = await pool.query<{ id: string; resultado: DescricaoSugerida; concluido_em: Date }>(
      `select id, resultado, concluido_em
         from comando_agente
        where item_id = $1 and tipo = 'descrever_item' and estado = 'concluido'
          and aplicado_em is null and resultado is not null
        order by concluido_em desc limit 1`,
      [id],
    );

    const cmd = ultimo.rows[0];
    const sug = pendente.rows[0];
    return {
      pedido: cmd
        ? {
            id: cmd.id as string,
            // Pedido que passou do prazo sem resposta é pedido perdido — a
            // loja não buscou, ou o agente caiu no meio. Dizer "esperando"
            // para sempre esconderia isso.
            estado: (cmd.estado === 'pendente' || cmd.estado === 'entregue') && cmd.vencido ? 'expirado' : (cmd.estado as string),
            erro: cmd.erro as string | null,
            criadoEm: cmd.criado_em as Date,
            concluidoEm: cmd.concluido_em as Date | null,
          }
        : null,
      sugestao: sug ? { comandoId: sug.id, ...sug.resultado, feitaEm: sug.concluido_em } : null,
    };
  });

  // ───────────────── agente: baixa a foto para analisar ─────────────────

  app.get('/v1/agentes/inventario/fotos/:id', async (req, resposta) => {
    let agente;
    try {
      agente = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      throw e;
    }
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'foto não encontrada');

    // A foto tem de ser de um equipamento DESTA loja: o token de uma loja
    // não baixa a imagem de outra.
    const r = await pool.query(
      `select f.imagem, f.tipo, f.sha256
         from inventario_foto f
         join inventario_item i on i.id = f.item_id
        where f.id = $1 and i.loja_id = $2`,
      [id, agente.lojaId],
    );
    if (r.rowCount === 0) return naoAchei(resposta, 'foto não encontrada');
    return resposta
      .header('content-type', r.rows[0].tipo || 'image/jpeg')
      .header('x-farol-sha256', r.rows[0].sha256)
      .header('cache-control', 'no-store')
      .send(r.rows[0].imagem);
  });

  // ───────────────────── fotos ─────────────────────

  app.post('/v1/inventario/:id/fotos', { bodyLimit: 3 * 1024 * 1024 }, async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const corpo = (req.body ?? {}) as { origem?: unknown; zonaId?: unknown; imagemBase64?: unknown };
    if (corpo.origem !== 'canal' && corpo.origem !== 'envio') {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'origem: "canal" ou "envio"' });
    }

    // A foto enviada é conferida ANTES de abrir a transação: recusar um
    // arquivo torto não precisa travar linha nenhuma.
    let enviada: { bytes: Buffer; largura: number; altura: number } | null = null;
    if (corpo.origem === 'envio') {
      if (typeof corpo.imagemBase64 !== 'string' || !corpo.imagemBase64) {
        return resposta.status(422).send({ erro: 'validacao', mensagem: 'faltou a imagem' });
      }
      const bytes = Buffer.from(corpo.imagemBase64, 'base64');
      if (bytes.length > MAX_BYTES_DA_FOTO) {
        return resposta.status(413).send({ erro: 'grande_demais', mensagem: 'a foto ficou grande demais. Envie uma imagem menor.' });
      }
      const tamanho = tamanhoDoJpeg(bytes);
      if (!tamanho) {
        return resposta.status(422).send({ erro: 'validacao', mensagem: 'a imagem enviada não é um JPEG que dê para abrir' });
      }
      enviada = { bytes, ...tamanho };
    } else if (typeof corpo.zonaId !== 'string' || !UUID.test(corpo.zonaId)) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'escolha o canal (e a área) de onde vem o quadro' });
    }

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // A linha do equipamento fica travada até o fim: dois envios ao mesmo
      // tempo passam um depois do outro, e a conta do máximo vale.
      const item = await cliente.query(
        `select i.id, i.loja_id
           from inventario_item i
           join loja l on l.id = i.loja_id
          where i.id = $1 and l.tenant_id = $2
            for update of i`,
        [id, s.tenantId],
      );
      if (item.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei(resposta);
      }
      const ja = await cliente.query('select count(*)::int as n from inventario_foto where item_id = $1', [id]);
      if (ja.rows[0].n >= MAX_FOTOS_POR_ITEM) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'limite',
          mensagem: `este equipamento já tem ${MAX_FOTOS_POR_ITEM} fotos, que é o máximo. Tire uma para pôr outra.`,
        });
      }

      let nova;
      if (enviada) {
        nova = await cliente.query(
          `insert into inventario_foto (item_id, origem, imagem, tipo, largura, altura, sha256, criada_por)
           values ($1, 'envio', $2, 'image/jpeg', $3, $4, $5, $6)
           returning id`,
          [id, enviada.bytes, enviada.largura, enviada.altura, createHash('sha256').update(enviada.bytes).digest('hex'), s.usuarioId],
        );
      } else {
        // A área tem de ser de um canal DA MESMA loja do equipamento.
        const zona = await cliente.query(
          `select (p.preview is not null) as tem_quadro
             from zona z
             join ponto p  on p.id  = z.ponto_id
             join setor st on st.id = p.setor_id
            where z.id = $1 and st.loja_id = $2 and z.excluida_em is null and p.excluido_em is null`,
          [corpo.zonaId, item.rows[0].loja_id],
        );
        if (zona.rowCount === 0) {
          await cliente.query('rollback');
          return naoAchei(resposta, 'canal ou área não encontrados nesta loja');
        }
        if (!zona.rows[0].tem_quadro) {
          await cliente.query('rollback');
          return resposta.status(409).send({
            erro: 'sem_quadro',
            mensagem: 'este canal ainda não tem imagem. Abra o canal, use “Atualizar quadro” e volte aqui.',
          });
        }
        // O quadro é copiado DENTRO do banco, com o desenho da área como
        // está agora: os bytes não passam por este processo.
        nova = await cliente.query(
          `insert into inventario_foto (item_id, origem, ponto_id, zona_id, recorte, imagem, tipo, largura, altura, sha256, criada_por)
           select $1, 'canal', p.id, z.id, z.poligono, p.preview, coalesce(p.preview_tipo, 'image/jpeg'),
                  p.preview_largura, p.preview_altura, encode(sha256(p.preview), 'hex'), $3
             from zona z
             join ponto p on p.id = z.ponto_id
            where z.id = $2
           returning id`,
          [id, corpo.zonaId, s.usuarioId],
        );
      }
      await cliente.query('update inventario_item set atualizado_em = now() where id = $1', [id]);
      await cliente.query('commit');
      req.log.info({ item: id, foto: nova.rows[0].id, origem: corpo.origem, por: s.usuarioId }, 'foto de equipamento GUARDADA');
      return resposta.status(201).send({ fotoId: nova.rows[0].id as string, item: paraTela((await umItem(pool, id, s.tenantId))!) });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  app.get('/v1/inventario/fotos/:id/imagem', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'foto não encontrada');

    const r = await pool.query(
      `select f.imagem, f.tipo
         from inventario_foto f
         join inventario_item i on i.id = f.item_id
         join loja l on l.id = i.loja_id
        where f.id = $1 and l.tenant_id = $2`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta, 'foto não encontrada');
    return resposta
      .header('content-type', r.rows[0].tipo || 'image/jpeg')
      // É arquivo que veio de fora: o navegador não tenta adivinhar o tipo.
      .header('x-content-type-options', 'nosniff')
      // A foto de um id nunca muda. `private`: é imagem de dentro da loja.
      .header('cache-control', 'private, max-age=86400, immutable')
      .send(r.rows[0].imagem);
  });

  app.delete('/v1/inventario/fotos/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'foto não encontrada');

    const r = await pool.query(
      `delete from inventario_foto f
        using inventario_item i, loja l
        where f.id = $1 and i.id = f.item_id and l.id = i.loja_id and l.tenant_id = $2
       returning f.item_id`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta, 'foto não encontrada');
    const itemId = r.rows[0].item_id as string;
    await pool.query('update inventario_item set atualizado_em = now() where id = $1', [itemId]);
    return { excluida: true, item: paraTela((await umItem(pool, itemId, s.tenantId))!) };
  });
}
