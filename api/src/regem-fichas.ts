// =====================================================================
// Do Regem para a base de fichas do Farol
// =====================================================================
// O adaptador: recebe o que o Regem responde em `GET /integracao/catalogo`
// e `GET /integracao/fichas` (o contrato é o de lá, `docs/integracao-farol.md`;
// uma resposta de verdade está em `contratos/regem-catalogo-e-fichas.json`)
// e devolve o documento no formato do Farol (`fichas.ts`).
//
// O que NÃO vem para cá, de propósito:
//
//   • o produto, a variação e a opção inativos — não são vendidos;
//   • a ficha inativa — a loja a desligou;
//   • a linha da ficha que é só EMBALAGEM: a de viagem (`so_delivery`) e a do
//     balcão (`so_balcao`, que o Regem manda desde 12/10/2026). Não é do que
//     o lanche é feito. A chave `mesma_embalagem`, da empresa, só diz qual
//     das duas vale em cada venda — aqui as duas ficam de fora, com ela
//     ligada ou desligada;
//   • os ids que o Regem troca a cada salvamento (variação, grupo, opção do
//     produto): guardá-los faria a base "mudar" sem nada ter mudado, e o
//     agente baixaria a cópia de novo à toa.
//
// Resposta fora do contrato vira `ErroDoRegem('resposta_torta')` — e a
// base que a loja já tinha fica como estava. Meia base é pior que a de ontem.
// =====================================================================

import { FORMATO_DA_BASE, type Base, type Efeito, type Ficha, type GrupoDeAdicionais, type Opcao, type Produto } from './fichas.js';
import { ErroDoRegem } from './regem.js';

type Obj = Record<string, unknown>;

/** Tetos do que uma loja pode ter. Acima disso a resposta não é a de uma loja. */
const MAX_PRODUTOS = 5000;
const MAX_FICHAS = 5000;
const MAX_INGREDIENTES = 300;
const MAX_OPCOES = 300;

const torta = (): never => {
  throw new ErroDoRegem('resposta_torta', 200);
};
const lista = (v: unknown, max: number): Obj[] => {
  if (!Array.isArray(v) || v.length > max) return torta();
  for (const x of v) if (!x || typeof x !== 'object' || Array.isArray(x)) return torta();
  return v as Obj[];
};
const texto = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ativo = (o: Obj): boolean => o.ativo !== false;
/** A linha que só entra numa das vendas — a embalagem de viagem ou a do balcão. Só o `true` conta. */
const soEmbalagem = (i: Obj): boolean => i.so_delivery === true || i.so_balcao === true;
const ordem = (o: Obj): number => numero(o.ordem) ?? 0;

/** Sem acento e sem caixa: a ordem dos produtos não depende da máquina. */
const chave = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const comparar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * O que a opção muda na montagem. Serve também à fila da cozinha
 * (`fila-da-cozinha.ts`): a escolha feita no pedido tem o mesmo `acrescenta`
 * e `retira` da opção do catálogo.
 */
export function efeitoDe(grupoTipo: 'adicionar' | 'remover', o: Obj, nomeDaFicha: Map<string, string>, nomeDoProduto: Map<string, string>): Efeito {
  if (o.informativa === true) return { tipo: 'observacao' };
  if (grupoTipo === 'remover') {
    const r = o.retira as Obj | null | undefined;
    const nome = r ? texto(r.nome) : null;
    return nome ? { tipo: 'retira', nome, insumoId: texto(r!.insumo_id), fichaId: texto(r!.sub_ficha_id) } : { tipo: 'nada' };
  }
  const a = o.acrescenta as Obj | null | undefined;
  if (!a || typeof a !== 'object') return { tipo: 'nada' };
  if (a.tipo === 'insumo') {
    const nome = texto(a.nome);
    return nome
      ? { tipo: 'insumo', nome, quantidade: numero(a.quantidade_estoque), unidade: texto(a.unidade_estoque, 40), insumoId: texto(a.insumo_id) }
      : { tipo: 'nada' };
  }
  if (a.tipo === 'ficha') {
    const fichaId = texto(a.ficha_id);
    return fichaId ? { tipo: 'preparo', fichaId, nome: nomeDaFicha.get(fichaId) ?? null } : { tipo: 'nada' };
  }
  if (a.tipo === 'produto') {
    const produtoId = texto(a.produto_id);
    return produtoId ? { tipo: 'produto', produtoId, nome: nomeDoProduto.get(produtoId) ?? null } : { tipo: 'nada' };
  }
  return { tipo: 'nada' };
}

export function baseDoRegem(catalogo: unknown, fichas: unknown): Base {
  const c = catalogo as Obj | null;
  const f = fichas as Obj | null;
  if (!c || typeof c !== 'object' || !f || typeof f !== 'object') return torta();

  const produtosDeLa = lista(c.produtos, MAX_PRODUTOS);
  const fichasDeLa = lista(f.fichas, MAX_FICHAS);
  const categorias = new Map(lista(c.categorias ?? [], 2000).map((x) => [String(x.id), { nome: texto(x.nome), ordem: ordem(x) }]));
  const setores = new Map(lista(c.setores ?? [], 2000).map((x) => [String(x.id), texto(x.nome)]));

  // O nome de TODA ficha e de todo produto que veio, mesmo o inativo: é
  // para dizer "acrescenta o preparo «Ovo frito»", e o preparo pode estar
  // desligado para venda e continuar sendo o que a opção acrescenta.
  const nomeDaFicha = new Map<string, string>();
  for (const x of fichasDeLa) {
    const id = texto(x.id);
    const nome = texto(x.nome);
    if (!id || !nome) return torta();
    nomeDaFicha.set(id, nome);
  }
  const nomeDoProduto = new Map<string, string>();
  for (const x of produtosDeLa) {
    const id = texto(x.id);
    const nome = texto(x.nome);
    if (!id || !nome) return torta();
    nomeDoProduto.set(id, nome);
  }

  const fichaPorId = new Map<string, Ficha>();
  for (const x of fichasDeLa) {
    if (!ativo(x)) continue;
    const ingredientes = lista(x.ingredientes ?? [], MAX_INGREDIENTES)
      .filter((i) => !soEmbalagem(i))
      .sort((a, b) => ordem(a) - ordem(b))
      .map((i) => {
        const nome = texto(i.nome);
        if (!nome) return torta();
        const fichaId = texto(i.sub_ficha_id);
        return { nome, quantidade: numero(i.quantidade), unidade: texto(i.unidade, 40), preparo: fichaId !== null, insumoId: texto(i.insumo_id), fichaId };
      });
    const id = texto(x.id)!;
    fichaPorId.set(id, { id, nome: nomeDaFicha.get(id)!, ingredientes });
  }

  const produtos: Array<Produto & { ordemDaCategoria: number }> = [];
  for (const x of produtosDeLa) {
    if (!ativo(x)) continue;
    const id = texto(x.id)!;
    const tipo = x.tipo === 'variavel' || x.tipo === 'combo' ? x.tipo : 'simples';
    const categoria = categorias.get(String(x.categoria_id)) ?? null;

    const variacoes = lista(x.variacoes ?? [], 500)
      .filter(ativo)
      .map((v) => {
        const nome = texto(v.nome);
        if (!nome) return torta();
        return { nome, codigo: texto(v.codigo, 60), fator: numero(v.fator_ficha) ?? 1 };
      })
      .sort((a, b) => a.fator - b.fator || comparar(chave(a.nome), chave(b.nome)));

    const combo = lista(x.combo ?? [], 200).map((i) => {
      const produtoId = texto(i.produto_id);
      if (!produtoId) return torta();
      return { produtoId, nome: nomeDoProduto.get(produtoId) ?? null, quantidade: numero(i.quantidade) ?? 1 };
    });

    const adicionais: GrupoDeAdicionais[] = lista(x.adicionais ?? [], 200)
      .sort((a, b) => ordem(a) - ordem(b))
      .map((g) => {
        const tipoDoGrupo = g.tipo === 'remover' ? 'remover' : 'adicionar';
        const opcoes: Opcao[] = lista(g.opcoes ?? [], MAX_OPCOES)
          .filter(ativo)
          .sort((a, b) => ordem(a) - ordem(b))
          .map((o) => {
            const nome = texto(o.nome);
            if (!nome) return torta();
            return { id: texto(o.opcao_id), nome, codigo: texto(o.codigo, 60), efeito: efeitoDe(tipoDoGrupo, o, nomeDaFicha, nomeDoProduto) };
          });
        return { nome: texto(g.nome) ?? (tipoDoGrupo === 'remover' ? 'Retirar' : 'Adicionais'), tipo: tipoDoGrupo, opcoes } satisfies GrupoDeAdicionais;
      })
      // grupo sem opção ativa não é nada que o cliente possa pedir
      .filter((g) => g.opcoes.length > 0);

    produtos.push({
      id,
      nome: nomeDoProduto.get(id)!,
      codigo: texto(x.codigo, 60),
      categoria: categoria?.nome ?? null,
      tipo,
      cozinha: x.vai_para_producao === true,
      setor: setores.get(String(x.setor_producao_id)) ?? null,
      preparoMin: numero(x.tempo_preparo_min),
      ficha: fichaPorId.get(String(x.ficha_id)) ?? null,
      variacoes,
      combo,
      adicionais,
      ordemDaCategoria: categoria ? categoria.ordem : Number.MAX_SAFE_INTEGER,
    });
  }

  // Pela categoria (na ordem do cardápio; sem categoria por último) e, dentro
  // dela, pelo nome. O id desempata: a ordem tem de ser sempre a mesma.
  produtos.sort(
    (a, b) =>
      a.ordemDaCategoria - b.ordemDaCategoria ||
      comparar(chave(a.categoria ?? ''), chave(b.categoria ?? '')) ||
      comparar(chave(a.nome), chave(b.nome)) ||
      comparar(a.id, b.id),
  );

  return {
    formato: FORMATO_DA_BASE,
    produtos: produtos.map(({ ordemDaCategoria: _fora, ...p }) => p),
  };
}
