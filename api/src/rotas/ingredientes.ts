// =====================================================================
// Os ingredientes da loja e as fotos de referência de cada um
// =====================================================================
// A21, fatia T1 (migration 047). Pedido do dono (15/10/2026): "já
// providencie a opção de agregar imagens nas fichas em cada ingrediente".
// A base de conhecimento da 001 passa a valer aqui:
//
//   • o ingrediente é um ITEM da loja (`base_conhecimento`, tipo `item`),
//     pelo nome — ver `../ingredientes.ts`. O item nasce na primeira foto
//     (ou no "não se vê de cima"); o nome que fica é o da ficha;
//   • a foto é um QUADRO dele (`base_frame`, origem `foto`), mandada pelo
//     console já reduzida, como no inventário: aqui se confere que é JPEG e
//     o tamanho, e se lê a largura e a altura do próprio arquivo;
//   • até 6 por ingrediente, contadas com o item travado: dois envios ao
//     mesmo tempo passam um depois do outro;
//   • o ingrediente que saiu das fichas e ainda tem fotos é ÓRFÃO: elas
//     esperam alguém juntá-las ao nome novo, ou apagá-las. Nada se apaga
//     sozinho, e juntar nunca descarta foto: se passar do máximo, recusa.
//
// Quem pode (decisão do dono, 15/10/2026): ver e mandar foto, quem
// acompanha a loja (supervisão para cima); tirar foto, "não se vê de
// cima", juntar e apagar órfão, quem configura (gerência para cima).
//
// A listagem nunca traz os bytes.
// =====================================================================

import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { lerBase } from '../fichas.js';
import { chaveDoIngrediente, ingredientesDaBase, MAX_FOTOS_POR_INGREDIENTE, MAX_LEGENDA, type IngredienteDaLoja } from '../ingredientes.js';
import { chaveQueConta, outrosNomesDaLoja } from '../outros-nomes.js';
import { podeAcompanhar, podeConfigurar } from '../rbac.js';
import { MAX_BYTES_DA_FOTO, tamanhoDoJpeg } from './inventario.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FotoNaLista = { id: string; largura: number | null; altura: number | null; legenda: string | null; criadoEm: string };
type ItemDoBanco = { id: string; nome: string; tipo: 'item' | 'fora'; visivel: boolean; fotos: FotoNaLista[]; exemplos: number };

// Os itens da loja, com as fotos (sem os bytes) e quantos exemplos da bancada cada um tem — e os exemplos dos nomes
// escritos à mão fora das fichas (tipo 'fora', migration 053), que só contam quando o nome vale.
const ITENS_DA_LOJA = `
  select b.id, b.nome, b.tipo, b.visivel,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', f.id, 'largura', f.largura, 'altura', f.altura,
                                               'legenda', f.legenda, 'criadoEm', f.criado_em)
                            order by f.criado_em, f.id)
             from base_frame f
            where f.base_id = b.id and f.origem = 'foto'
         ), '[]'::jsonb) as fotos,
         (select count(*)::int from base_frame f where f.base_id = b.id and f.origem = 'bancada') as exemplos
    from base_conhecimento b
   where b.loja_id = $1 and b.tipo in ('item', 'fora')`;

export function rotasDeIngredientes(app: FastifyInstance, pool: pg.Pool): void {
  /** Quem vê os ingredientes: quem acompanha a loja. `paraMexer` = tirar, esconder, juntar, apagar. */
  async function quem(req: FastifyRequest, resposta: FastifyReply, paraMexer?: string): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    if (!podeAcompanhar(s)) {
      resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não vê os ingredientes da loja' });
      return null;
    }
    if (paraMexer && !podeConfigurar(s)) {
      resposta.status(403).send({ erro: 'sem_permissao', mensagem: `quem ${paraMexer} é quem configura a loja (gerência ou diretoria)` });
      return null;
    }
    return s;
  }
  const invalido = (resposta: FastifyReply, mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });
  const naoAchei = (resposta: FastifyReply, mensagem: string) => resposta.status(404).send({ erro: 'nao_encontrado', mensagem });

  /** Os ingredientes das fichas da loja — ou nulo, se a loja não é da conta de quem pede. */
  async function ingredientesDaLoja(cliente: pg.Pool | pg.PoolClient, s: Sessao, lojaId: string): Promise<IngredienteDaLoja[] | null> {
    const r = await cliente.query(
      `select f.conteudo
         from loja l
         left join fichas_da_loja f on f.loja_id = l.id
        where l.id = $1 and l.tenant_id = $2`,
      [lojaId, s.tenantId],
    );
    if (r.rowCount === 0) return null;
    return ingredientesDaBase(lerBase(r.rows[0].conteudo));
  }
  const acharNaFichas = (ingredientes: IngredienteDaLoja[], nome: string) =>
    ingredientes.find((i) => chaveDoIngrediente(i.nome) === chaveDoIngrediente(nome));

  /** O item nasce, ou é o que já existe: nos dois casos a linha fica travada até o fim da transação. */
  const itemDoIngrediente = async (cliente: pg.PoolClient, lojaId: string, nome: string): Promise<string> =>
    (
      await cliente.query(
        `insert into base_conhecimento (loja_id, tipo, nome) values ($1, 'item', $2)
         on conflict (loja_id, tipo, lower(btrim(nome))) do update set atualizado_em = now()
         returning id`,
        [lojaId, nome],
      )
    ).rows[0].id as string;

  const contarFotos = async (cliente: pg.PoolClient, itemId: string): Promise<number> =>
    (await cliente.query(`select count(*)::int as n from base_frame where base_id = $1 and origem = 'foto'`, [itemId])).rows[0].n as number;

  /** Para sair de uma transação com uma resposta de recusa (desfaz o que houver). */
  class Recusa {
    constructor(readonly status: number, readonly corpo: { erro: string; mensagem: string }) {}
  }
  const recusar = (status: number, erro: string, mensagem: string) => new Recusa(status, { erro, mensagem });
  /** Abre a transação e roda: a recusa desfaz e responde; o resto confirma. A conexão volta ao pool aconteça o que acontecer. */
  async function responder<T>(resposta: FastifyReply, fazer: (cliente: pg.PoolClient) => Promise<T | Recusa>) {
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const r = await fazer(cliente);
      if (r instanceof Recusa) {
        await cliente.query('rollback');
        return resposta.status(r.status).send(r.corpo);
      }
      await cliente.query('commit');
      return r;
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  }

  // ───────────────────── a lista ─────────────────────

  app.get('/v1/lojas/:id/ingredientes', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return invalido(resposta, 'id inválido');

    const ingredientes = await ingredientesDaLoja(pool, s, id);
    if (!ingredientes) return naoAchei(resposta, 'não existe essa loja');
    const [itens, outros] = await Promise.all([pool.query<ItemDoBanco>(ITENS_DA_LOJA, [id]).then((r) => r.rows), outrosNomesDaLoja(pool, id)]);
    // O mesmo ingrediente escrito de dois jeitos ("Pão de Brioche" na conferência, "Pão Brioche" na ficha) são dois
    // registros com a mesma chave: na lista é um só, com as fotos e os exemplos somados. Quem manda (o id, o "não se vê
    // de cima") é o registro com o nome da ficha; sem ele, o que tem mais fotos e exemplos. O OUTRO NOME (migration
    // 053: "Hambúrguer", juntado ao "Blend da casa") soma no ingrediente das fichas do mesmo jeito. O exemplo do nome
    // escrito à mão (tipo 'fora') só entra quando o nome vale — e nunca vira órfão nem manda no ingrediente.
    const nasFichas = new Set(ingredientes.map((i) => chaveDoIngrediente(i.nome)));
    const porChave = new Map<string, ItemDoBanco[]>();
    for (const i of itens) {
      const k = chaveQueConta(i.nome, outros);
      if (i.tipo === 'fora' && !nasFichas.has(k)) continue;
      porChave.set(k, [...(porChave.get(k) ?? []), i]);
    }
    const juntos = (nome: string) => {
      const grupo = porChave.get(chaveDoIngrediente(nome));
      if (!grupo) return null;
      const doIngrediente = grupo.filter((i) => i.tipo === 'item');
      const exato = doIngrediente.find((i) => i.nome.trim().toLowerCase() === nome.trim().toLowerCase());
      const principal = exato ?? [...doIngrediente].sort((a, b) => b.fotos.length + b.exemplos - (a.fotos.length + a.exemplos))[0];
      return {
        id: principal?.id ?? null,
        visivel: principal?.visivel ?? true,
        fotos: grupo.flatMap((i) => i.fotos),
        exemplos: grupo.reduce((s, i) => s + i.exemplos, 0),
      };
    };

    return {
      limiteDeFotos: MAX_FOTOS_POR_INGREDIENTE,
      /** Tirar foto, "não se vê de cima", juntar e apagar órfão: a tela mostra o botão ou a frase. */
      podeConfigurar: podeConfigurar(s),
      ingredientes: ingredientes.map((i) => {
        const item = juntos(i.nome);
        return {
          nome: i.nome,
          produtos: i.produtos,
          itemId: item?.id ?? null,
          visivel: item?.visivel ?? true,
          fotos: item?.fotos ?? [],
          exemplos: item?.exemplos ?? 0,
        };
      }),
      /** O que saiu das fichas e ainda tem foto ou exemplo: espera alguém juntar ao nome novo, ou apagar. */
      orfaos: itens
        .filter((i) => i.tipo === 'item' && !nasFichas.has(chaveQueConta(i.nome, outros)) && (i.fotos.length > 0 || i.exemplos > 0))
        .map((i) => ({ itemId: i.id, nome: i.nome, fotos: i.fotos, exemplos: i.exemplos }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    };
  });

  // ───────────────────── mandar uma foto ─────────────────────

  app.post('/v1/lojas/:id/ingredientes/fotos', { bodyLimit: 3 * 1024 * 1024 }, async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return invalido(resposta, 'id inválido');

    // Tudo o que dá para recusar sem banco é recusado antes de abrir a transação.
    const corpo = (req.body ?? {}) as { nome?: unknown; imagemBase64?: unknown; legenda?: unknown };
    if (typeof corpo.nome !== 'string' || !corpo.nome.trim()) return invalido(resposta, 'diga de qual ingrediente é a foto');
    let legenda: string | null = null;
    if (corpo.legenda !== undefined && corpo.legenda !== null) {
      if (typeof corpo.legenda !== 'string') return invalido(resposta, 'a legenda é um texto');
      legenda = corpo.legenda.trim() || null;
      if (legenda && legenda.length > MAX_LEGENDA) return invalido(resposta, `a legenda passa de ${MAX_LEGENDA} letras`);
    }
    if (typeof corpo.imagemBase64 !== 'string' || !corpo.imagemBase64) return invalido(resposta, 'faltou a imagem');
    const bytes = Buffer.from(corpo.imagemBase64, 'base64');
    if (bytes.length > MAX_BYTES_DA_FOTO) {
      return resposta.status(413).send({ erro: 'grande_demais', mensagem: 'a foto ficou grande demais. Envie uma imagem menor.' });
    }
    const tamanho = tamanhoDoJpeg(bytes);
    if (!tamanho) return invalido(resposta, 'a imagem enviada não é um JPEG que dê para abrir');
    const nome = corpo.nome;

    const feito = await responder(resposta, async (cliente) => {
      const ingredientes = await ingredientesDaLoja(cliente, s, id);
      if (!ingredientes) return recusar(404, 'nao_encontrado', 'não existe essa loja');
      const ingrediente = acharNaFichas(ingredientes, nome);
      if (!ingrediente) return recusar(404, 'ingrediente_nao_encontrado', 'este ingrediente não está nas fichas da loja');
      const itemId = await itemDoIngrediente(cliente, id, ingrediente.nome);
      if ((await contarFotos(cliente, itemId)) >= MAX_FOTOS_POR_INGREDIENTE) {
        return recusar(409, 'limite', `${ingrediente.nome} já tem ${MAX_FOTOS_POR_INGREDIENTE} fotos, que é o máximo. Tire uma para pôr outra.`);
      }
      const nova = await cliente.query(
        `insert into base_frame (base_id, origem, imagem, tipo, largura, altura, sha256, legenda, criado_por)
         values ($1, 'foto', $2, 'image/jpeg', $3, $4, $5, $6, $7)
         returning id`,
        [itemId, bytes, tamanho.largura, tamanho.altura, createHash('sha256').update(bytes).digest('hex'), legenda, s.usuarioId],
      );
      return { fotoId: nova.rows[0].id as string, itemId, nome: ingrediente.nome };
    });
    if (resposta.sent) return;
    req.log.info({ loja: id, ...(feito as object), por: s.usuarioId }, 'foto de ingrediente GUARDADA');
    return resposta.status(201).send(feito);
  });

  // ───────────────────── ver e tirar uma foto ─────────────────────

  app.get('/v1/base/fotos/:id/imagem', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'foto não encontrada');

    const r = await pool.query(
      `select f.imagem, f.tipo
         from base_frame f
         join base_conhecimento b on b.id = f.base_id
         join loja l on l.id = b.loja_id
        where f.id = $1 and l.tenant_id = $2 and f.imagem is not null`,
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

  app.delete('/v1/base/fotos/:id', async (req, resposta) => {
    const s = await quem(req, resposta, 'tira foto');
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'foto não encontrada');

    // Só a foto de referência: o exemplo da bancada não se tira por aqui.
    const r = await pool.query(
      `delete from base_frame f
        using base_conhecimento b, loja l
        where f.id = $1 and f.origem = 'foto' and b.id = f.base_id and l.id = b.loja_id and l.tenant_id = $2
       returning f.base_id`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta, 'foto não encontrada');
    req.log.info({ foto: id, item: r.rows[0].base_id, por: s.usuarioId }, 'foto de ingrediente TIRADA');
    return { excluida: true, itemId: r.rows[0].base_id as string };
  });

  // ───────────────────── "não se vê de cima" ─────────────────────

  app.put('/v1/lojas/:id/ingredientes/visivel', async (req, resposta) => {
    const s = await quem(req, resposta, 'marca o que não se vê de cima');
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return invalido(resposta, 'id inválido');
    const corpo = (req.body ?? {}) as { nome?: unknown; visivel?: unknown };
    if (typeof corpo.nome !== 'string' || !corpo.nome.trim()) return invalido(resposta, 'diga qual é o ingrediente');
    // Só `true` e `false`: "1", "sim" ou vazio não viram uma decisão por engano.
    if (typeof corpo.visivel !== 'boolean') return invalido(resposta, 'visivel: true ou false');
    const nome = corpo.nome;
    const visivel = corpo.visivel;

    return responder(resposta, async (cliente) => {
      const ingredientes = await ingredientesDaLoja(cliente, s, id);
      if (!ingredientes) return recusar(404, 'nao_encontrado', 'não existe essa loja');
      const ingrediente = acharNaFichas(ingredientes, nome);
      if (!ingrediente) return recusar(404, 'ingrediente_nao_encontrado', 'este ingrediente não está nas fichas da loja');
      const r = await cliente.query(
        `insert into base_conhecimento (loja_id, tipo, nome, visivel) values ($1, 'item', $2, $3)
         on conflict (loja_id, tipo, lower(btrim(nome))) do update set visivel = excluded.visivel, atualizado_em = now()
         returning id, visivel`,
        [id, ingrediente.nome, visivel],
      );
      return { nome: ingrediente.nome, itemId: r.rows[0].id as string, visivel: r.rows[0].visivel as boolean };
    });
  });

  // ───────────────────── o ingrediente que saiu das fichas ─────────────────────

  /** O item travado, da conta de quem pede, e se ele ainda está nas fichas da loja. */
  async function itemTravado(cliente: pg.PoolClient, s: Sessao, itemId: string) {
    const r = await cliente.query(
      `select b.id, b.nome, b.loja_id
         from base_conhecimento b
         join loja l on l.id = b.loja_id
        where b.id = $1 and b.tipo = 'item' and l.tenant_id = $2
          for update of b`,
      [itemId, s.tenantId],
    );
    if (r.rowCount === 0) return null;
    const item = r.rows[0] as { id: string; nome: string; loja_id: string };
    const ingredientes = (await ingredientesDaLoja(cliente, s, item.loja_id)) ?? [];
    return { item, ingredientes, nasFichas: !!acharNaFichas(ingredientes, item.nome) };
  }

  app.post('/v1/base/itens/:id/juntar', async (req, resposta) => {
    const s = await quem(req, resposta, 'junta as fotos');
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'ingrediente não encontrado');
    const corpo = (req.body ?? {}) as { para?: unknown };
    if (typeof corpo.para !== 'string' || !corpo.para.trim()) return invalido(resposta, 'diga a qual ingrediente juntar');
    const para = corpo.para;

    const feito = await responder(resposta, async (cliente) => {
      const achado = await itemTravado(cliente, s, id);
      if (!achado) return recusar(404, 'nao_encontrado', 'ingrediente não encontrado');
      const { item, ingredientes, nasFichas } = achado;
      if (nasFichas) return recusar(409, 'nao_e_orfao', `${item.nome} ainda está nas fichas: as fotos dele já valem`);
      const destino = acharNaFichas(ingredientes, para);
      if (!destino) return recusar(404, 'ingrediente_nao_encontrado', 'este ingrediente não está nas fichas da loja');
      const destinoId = await itemDoIngrediente(cliente, item.loja_id, destino.nome);
      // Juntar nunca descarta foto: passando do máximo, recusa e diz quantas tirar.
      const juntas = (await contarFotos(cliente, item.id)) + (await contarFotos(cliente, destinoId));
      if (juntas > MAX_FOTOS_POR_INGREDIENTE) {
        return recusar(
          409,
          'limite',
          `juntas, ficariam ${juntas} fotos no ${destino.nome}, e o máximo é ${MAX_FOTOS_POR_INGREDIENTE}. Tire ${juntas - MAX_FOTOS_POR_INGREDIENTE} antes de juntar.`,
        );
      }
      const movidas = await cliente.query('update base_frame set base_id = $2 where base_id = $1', [item.id, destinoId]);
      await cliente.query('delete from base_conhecimento where id = $1', [item.id]);
      return { itemId: destinoId, nome: destino.nome, de: item.nome, movidas: movidas.rowCount ?? 0 };
    });
    if (resposta.sent) return;
    req.log.info({ ...(feito as object), por: s.usuarioId }, 'fotos de ingrediente JUNTADAS');
    return feito;
  });

  app.delete('/v1/base/itens/:id', async (req, resposta) => {
    const s = await quem(req, resposta, 'apaga as fotos');
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'ingrediente não encontrado');

    const feito = await responder(resposta, async (cliente) => {
      const achado = await itemTravado(cliente, s, id);
      if (!achado) return recusar(404, 'nao_encontrado', 'ingrediente não encontrado');
      if (achado.nasFichas) {
        return recusar(409, 'nao_e_orfao', `${achado.item.nome} ainda está nas fichas: tire as fotos uma a uma, se for o caso`);
      }
      const fotos = await cliente.query('select count(*)::int as n from base_frame where base_id = $1', [id]);
      await cliente.query('delete from base_conhecimento where id = $1', [id]);
      return { excluido: true, nome: achado.item.nome, quadros: fotos.rows[0].n as number };
    });
    if (resposta.sent) return;
    req.log.info({ item: id, ...(feito as object), por: s.usuarioId }, 'ingrediente órfão APAGADO');
    return feito;
  });
}
