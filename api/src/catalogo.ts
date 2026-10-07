// =====================================================================
// O catálogo de equipamentos: dos arquivos para o banco
// =====================================================================
// A fonte da verdade é `catalogo/` — um JSON por modelo, no repositório.
// O banco guarda uma CÓPIA, porque o orçamento cruza equipamento com loja
// e isso é junção.
//
// A cópia é refeita a cada subida da API. Modelo novo é arquivo novo: o
// deploy leva, a subida carrega, ninguém roda nada.
//
// ## De quem é
//
// Da distribuição. Este arquivo não registra rota nenhuma, e nenhuma rota
// do console deve devolver o catálogo: ao usuário chegam soluções e opções
// montadas a partir dele.
//
// ## O que a carga nunca faz
//
// - **Não apaga.** Linha que saiu do catálogo fica: levantamento e
//   diagnóstico apontam para ela. A carga só avisa quantas são.
// - **Não derruba o serviço.** Catálogo com defeito é orçamento
//   desatualizado; API fora do ar é loja sem auditoria. A carga falha
//   inteira (nada é gravado pela metade), registra o motivo e a API segue.
// =====================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';

export type ItemDoCatalogo = {
  id: string;
  categoria: string;
  fabricante: string;
  modelo: string;
  nivel: string | null;
  nivel_motivo: string | null;
  status: string;
  observacao: string;
  serve_para?: string[];
  specs: Record<string, unknown>;
  medido: unknown[];
  precos: unknown[];
  fontes: string[];
};

export type UsoDoCatalogo = {
  id: string;
  tipo_regra: string;
  variante: string | null;
  descricao: string;
  px_por_cm_min: number | null;
  fps_min: number | null;
  exige_cor: boolean;
  exige_wdr_db: number | null;
  exige_local: boolean;
  quadros_por_analise: number;
  observacao: string | null;
};

export type Catalogo = { equipamentos: ItemDoCatalogo[]; usos: UsoDoCatalogo[] };

export type ResultadoDaCarga =
  | {
      ok: true;
      equipamentos: { novos: number; alterados: number; iguais: number };
      usos: { novos: number; alterados: number; iguais: number };
      /** Linhas do banco que não estão no catálogo. Nunca são apagadas. */
      foraDoCatalogo: number;
    }
  | { ok: false; motivo: string };

/** Sobe a árvore procurando `catalogo/equipamentos`, como se faz com as migrations. */
export function acharCatalogo(partida?: string): string | null {
  let dir = partida ?? dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const alvo = join(dir, 'catalogo');
    if (existsSync(join(alvo, 'equipamentos'))) return alvo;
    const acima = dirname(dir);
    if (acima === dir) break;
    dir = acima;
  }
  return null;
}

function arquivosJson(pasta: string): string[] {
  return readdirSync(pasta).flatMap((n) => {
    const caminho = join(pasta, n);
    if (statSync(caminho).isDirectory()) return arquivosJson(caminho);
    return n.endsWith('.json') ? [caminho] : [];
  });
}

/**
 * Lê o catálogo do disco. Levanta se algum arquivo não for JSON ou não
 * tiver o mínimo — um arquivo ruim não pode virar uma linha ruim.
 *
 * A conferência fina (níveis, datas, preço com fonte) é do teste que roda
 * a cada envio. Aqui fica só o que impediria gravar.
 */
export function lerCatalogo(pasta: string): Catalogo {
  const equipamentos = arquivosJson(join(pasta, 'equipamentos')).map((caminho) => {
    let item: ItemDoCatalogo;
    try {
      item = JSON.parse(readFileSync(caminho, 'utf8')) as ItemDoCatalogo;
    } catch (e) {
      throw new Error(`${caminho}: não é JSON válido (${(e as Error).message})`);
    }
    for (const campo of ['id', 'categoria', 'fabricante', 'modelo', 'status'] as const) {
      if (typeof item[campo] !== 'string' || !item[campo].trim()) {
        throw new Error(`${caminho}: falta "${campo}"`);
      }
    }
    return item;
  });

  const arquivoDeUsos = join(pasta, 'usos.json');
  const usos = existsSync(arquivoDeUsos)
    ? ((JSON.parse(readFileSync(arquivoDeUsos, 'utf8')) as { usos: UsoDoCatalogo[] }).usos ?? [])
    : [];

  return { equipamentos, usos };
}

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** O nome do arquivo de um modelo: minúsculas, sem acento, só letra e número. */
export function slugDe(fabricante: string, modelo: string): string {
  const s = (t: string) =>
    t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${s(fabricante)}--${s(modelo)}`;
}

/**
 * Copia o catálogo para o banco. Uma instrução por tabela, numa transação:
 * ou entra tudo, ou não entra nada.
 *
 * Só toca na linha que MUDOU — rodar duas vezes seguidas não altera nada,
 * e `atualizado_em` continua dizendo quando o dado mudou de verdade, não
 * quando a API reiniciou.
 */
export async function carregarCatalogo(pool: pg.Pool, pasta?: string | null): Promise<ResultadoDaCarga> {
  const onde = pasta ?? acharCatalogo();
  if (!onde) return { ok: false, motivo: 'não achei a pasta catalogo/ nesta instalação' };

  let catalogo: Catalogo;
  try {
    catalogo = lerCatalogo(onde);
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
  if (catalogo.equipamentos.length === 0) {
    // Pasta vazia quase sempre é imagem montada errada. Carregar "zero
    // modelos" não apagaria nada, mas diria "ok" sobre um catálogo ausente.
    return { ok: false, motivo: `a pasta ${onde} não tem nenhum modelo` };
  }

  const linhas = catalogo.equipamentos.map((e) => ({
    slug: e.id,
    categoria: e.categoria,
    fabricante: e.fabricante,
    modelo: e.modelo,
    status: e.status,
    observacao: e.observacao ?? null,
    nivel: e.nivel ?? null,
    nivel_motivo: e.nivel_motivo ?? null,
    serve_para: lista(e.serve_para),
    specs: e.specs ?? {},
    medido: lista(e.medido),
    precos: lista(e.precos),
    fontes: lista(e.fontes),
  }));

  const cliente = await pool.connect();
  try {
    await cliente.query('begin');

    // ─── adoção: linha que existe e ainda não sabe de que arquivo é ───
    // A migration 002 semeou 21 modelos sem `slug`. Num banco recém-criado
    // eles estão lá, e a cópia tem que reconhecê-los em vez de inserir uma
    // segunda linha. O reconhecimento é pelo nome do ARQUIVO, calculado do
    // fabricante e do modelo — assim "i7 10a geracao" (como foi semeado) e
    // "i7 10ª geração" (como o catálogo escreve hoje) são a mesma linha.
    const semArquivo = await cliente.query(
      'select id, fabricante, modelo from equipamento where slug is null',
    );
    const doCatalogo = new Set(linhas.map((l) => l.slug));
    const adotar = semArquivo.rows
      .map((r) => ({ id: r.id as string, slug: slugDe(r.fabricante, r.modelo) }))
      .filter((r) => doCatalogo.has(r.slug));
    if (adotar.length > 0) {
      await cliente.query(
        `update equipamento q set slug = x.slug
           from jsonb_to_recordset($1::jsonb) as x(id uuid, slug text)
          where q.id = x.id and q.slug is null`,
        [JSON.stringify(adotar)],
      );
    }

    const eq = await cliente.query(
      `with entrada as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           slug text, categoria text, fabricante text, modelo text, status text,
           observacao text, nivel text, nivel_motivo text, serve_para jsonb,
           specs jsonb, medido jsonb, precos jsonb, fontes jsonb)
       ),
       gravado as (
         insert into equipamento as q
                (slug, categoria, fabricante, modelo, status, observacao, nivel,
                 nivel_motivo, serve_para, specs, medido, precos, fontes)
         select slug, categoria, fabricante, modelo, status, observacao, nivel,
                nivel_motivo, serve_para, specs, medido, precos, fontes
           from entrada
         -- A chave é o ARQUIVO (slug), não o par fabricante/modelo: corrigir
         -- a grafia do nome no catálogo atualiza a linha em vez de criar outra.
         on conflict (slug) where slug is not null do update
            set fabricante = excluded.fabricante, modelo = excluded.modelo,
                categoria = excluded.categoria,
                status = excluded.status, observacao = excluded.observacao,
                nivel = excluded.nivel, nivel_motivo = excluded.nivel_motivo,
                serve_para = excluded.serve_para, specs = excluded.specs,
                medido = excluded.medido, precos = excluded.precos,
                fontes = excluded.fontes, atualizado_em = now()
          where (q.fabricante, q.modelo, q.categoria, q.status, q.observacao, q.nivel, q.nivel_motivo,
                 q.serve_para, q.specs, q.medido, q.precos, q.fontes)
                is distinct from
                (excluded.fabricante, excluded.modelo, excluded.categoria, excluded.status, excluded.observacao,
                 excluded.nivel, excluded.nivel_motivo, excluded.serve_para, excluded.specs,
                 excluded.medido, excluded.precos, excluded.fontes)
         returning (xmax = 0) as novo
       )
       select count(*) filter (where novo)::int     as novos,
              count(*) filter (where not novo)::int as alterados
         from gravado`,
      [JSON.stringify(linhas)],
    );

    const us = await cliente.query(
      `with entrada as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           tipo_regra text, variante text, descricao text, px_por_cm_min numeric,
           fps_min numeric, exige_cor boolean, exige_wdr_db integer,
           exige_local boolean, quadros_por_analise integer, observacao text)
       ),
       gravado as (
         insert into requisito_uso as r
                (tipo_regra, variante, descricao, px_por_cm_min, fps_min, exige_cor,
                 exige_wdr_db, exige_local, quadros_por_analise, observacao)
         select tipo_regra, variante, descricao, px_por_cm_min, fps_min, exige_cor,
                exige_wdr_db, exige_local, quadros_por_analise, observacao
           from entrada
         on conflict (tipo_regra, coalesce(variante, '')) do update
            set descricao = excluded.descricao, px_por_cm_min = excluded.px_por_cm_min,
                fps_min = excluded.fps_min, exige_cor = excluded.exige_cor,
                exige_wdr_db = excluded.exige_wdr_db, exige_local = excluded.exige_local,
                quadros_por_analise = excluded.quadros_por_analise,
                observacao = excluded.observacao
          where (r.descricao, r.px_por_cm_min, r.fps_min, r.exige_cor, r.exige_wdr_db,
                 r.exige_local, r.quadros_por_analise, r.observacao)
                is distinct from
                (excluded.descricao, excluded.px_por_cm_min, excluded.fps_min,
                 excluded.exige_cor, excluded.exige_wdr_db, excluded.exige_local,
                 excluded.quadros_por_analise, excluded.observacao)
         returning (xmax = 0) as novo
       )
       select count(*) filter (where novo)::int     as novos,
              count(*) filter (where not novo)::int as alterados
         from gravado`,
      [JSON.stringify(catalogo.usos)],
    );

    const fora = await cliente.query(
      `select count(*)::int as n from equipamento
        where slug is null or slug <> all($1::text[])`,
      [linhas.map((l) => l.slug)],
    );

    await cliente.query('commit');

    const conta = (r: { novos: number; alterados: number }, total: number) => ({
      novos: r.novos,
      alterados: r.alterados,
      iguais: total - r.novos - r.alterados,
    });
    return {
      ok: true,
      equipamentos: conta(eq.rows[0], linhas.length),
      usos: conta(us.rows[0], catalogo.usos.length),
      foraDoCatalogo: fora.rows[0].n,
    };
  } catch (erro) {
    await cliente.query('rollback').catch(() => {});
    const e = erro as { code?: string; message: string };
    // 42703 = coluna não existe; 42P01 = tabela não existe. É o banco antes
    // da migration 015 (ou novo). Não é defeito: a carga espera a migration.
    if (e.code === '42703' || e.code === '42P01') {
      return { ok: false, motivo: 'o banco ainda não tem a migration 015 — rode: npm run migrar' };
    }
    return { ok: false, motivo: `${e.code ?? 'erro'}: ${e.message}` };
  } finally {
    cliente.release();
  }
}
