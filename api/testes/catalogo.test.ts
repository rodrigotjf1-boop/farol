// O catálogo de equipamentos (`catalogo/`).
//
// Um arquivo JSON por modelo é a fonte da verdade do que o projeto sabe
// sobre equipamento. Arquivo editado à mão erra em silêncio: um nível
// escrito "intermediário" com acento, um preço sem data, um modelo
// cadastrado duas vezes. Este teste é o que impede esses erros de chegar
// ao orçamento de um cliente.
//
// Não usa banco. Lê os arquivos e a migration 002.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOGO = join(RAIZ, 'catalogo');

type Preco = {
  preco?: number; preco_min?: number; preco_max?: number;
  confianca: string; cotado_em: string; fonte: string;
};
type Medida = { em: string; onde: string; metrica: string; valor: number | string };
type Item = {
  id: string; categoria: string; fabricante: string; modelo: string;
  nivel: string | null; nivel_motivo: string | null; status: string; observacao: string;
  serve_para?: string[]; specs: Record<string, unknown>;
  medido: Medida[]; precos: Preco[]; fontes: string[];
};

const niveis = JSON.parse(readFileSync(join(CATALOGO, 'niveis.json'), 'utf8')) as {
  niveis: string[]; categorias_com_nivel: string[]; usos: string[];
  status: string[]; confianca_do_preco: string[];
  criterio: Record<string, Record<string, string>>;
};

/** A pasta em que cada categoria mora. */
const PASTA: Record<string, string> = {
  gravador_dvr: 'gravador', gravador_nvr: 'gravador',
  camera_ip: 'camera', camera_analogica: 'camera', camera_usb: 'camera',
  computador: 'computador', gpu: 'gpu', acelerador: 'acelerador',
  nobreak: 'nobreak', switch: 'rede', roteador: 'rede', disco: 'disco', iluminacao: 'iluminacao',
};

function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((n) => {
    const caminho = join(pasta, n);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return n.endsWith('.json') ? [caminho] : [];
  });
}

const lidos = arquivos(join(CATALOGO, 'equipamentos')).map((caminho) => ({
  caminho,
  item: JSON.parse(readFileSync(caminho, 'utf8')) as Item,
}));

const slug = (t: string) =>
  t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string) => DATA.test(d) && !Number.isNaN(Date.parse(d));

const migration002 = readFileSync(join(RAIZ, 'database', 'migrations', '002_base_tecnica.sql'), 'utf8');

describe('catálogo de equipamentos', () => {
  it('tem modelos — a pasta não está vazia nem foi movida', () => {
    assert.ok(lidos.length >= 30, `só achei ${lidos.length} arquivo(s) em catalogo/equipamentos`);
  });

  it('cada arquivo tem os campos, com os valores permitidos', () => {
    for (const { caminho, item: e } of lidos) {
      const onde = basename(caminho);
      for (const campo of ['id', 'categoria', 'fabricante', 'modelo', 'status', 'observacao'] as const) {
        assert.ok(typeof e[campo] === 'string' && e[campo].trim(), `${onde}: falta ${campo}`);
      }
      assert.ok(e.categoria in PASTA, `${onde}: categoria desconhecida: ${e.categoria}`);
      assert.ok(niveis.status.includes(e.status), `${onde}: status ${e.status}`);
      assert.ok(e.specs && typeof e.specs === 'object' && !Array.isArray(e.specs), `${onde}: specs`);
      assert.ok(Array.isArray(e.medido), `${onde}: medido tem que ser lista`);
      assert.ok(Array.isArray(e.precos), `${onde}: precos tem que ser lista`);
      assert.ok(Array.isArray(e.fontes) && e.fontes.length > 0, `${onde}: sem fonte — de onde veio isto?`);
    }
  });

  it('o nome do arquivo e a pasta dizem o que está dentro', () => {
    for (const { caminho, item: e } of lidos) {
      const esperado = `${slug(e.fabricante)}--${slug(e.modelo)}`;
      assert.equal(e.id, esperado, `${basename(caminho)}: id não bate com fabricante e modelo`);
      assert.equal(basename(caminho), `${esperado}.json`);
      assert.equal(basename(dirname(caminho)), PASTA[e.categoria], `${basename(caminho)}: pasta errada`);
    }
  });

  it('fabricante e modelo não se repetem', () => {
    const vistos = new Map<string, string>();
    for (const { caminho, item: e } of lidos) {
      const chave = `${e.fabricante}|${e.modelo}`.toLowerCase();
      assert.ok(!vistos.has(chave), `${basename(caminho)} repete ${vistos.get(chave)}`);
      vistos.set(chave, basename(caminho));
    }
  });

  it('as categorias são as que a tabela `equipamento` aceita', () => {
    const trecho = /categoria\s+text not null check \(categoria in \(([^;]+?)\)\)/s.exec(migration002);
    assert.ok(trecho, 'não achei a lista de categorias na migration 002');
    const doBanco = new Set([...trecho[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    for (const c of Object.keys(PASTA)) assert.ok(doBanco.has(c), `a tabela não aceita ${c}`);
    for (const c of doBanco) assert.ok(c! in PASTA, `categoria da tabela sem pasta no catálogo: ${c}`);
  });

  it('câmera, gravador, computador e placa têm nível — e o motivo', () => {
    for (const { caminho, item: e } of lidos) {
      const onde = basename(caminho);
      if (niveis.categorias_com_nivel.includes(e.categoria)) {
        assert.ok(niveis.niveis.includes(String(e.nivel)), `${onde}: nível "${e.nivel}"`);
        assert.ok(e.nivel_motivo && e.nivel_motivo.trim().length > 10, `${onde}: nível sem motivo`);
      } else {
        assert.equal(e.nivel, null, `${onde}: esta categoria não tem nível`);
      }
    }
  });

  it('todo nível usado tem critério escrito', () => {
    for (const grupo of ['camera', 'gravador', 'computador', 'gpu']) {
      for (const n of niveis.niveis) {
        assert.ok(niveis.criterio[grupo]?.[n], `falta o critério de ${grupo}/${n}`);
      }
    }
  });

  it('câmera que entra em proposta diz para que serve', () => {
    for (const { caminho, item: e } of lidos) {
      const onde = basename(caminho);
      for (const uso of e.serve_para ?? []) {
        assert.ok(niveis.usos.includes(uso), `${onde}: uso desconhecido "${uso}"`);
      }
      if (e.categoria.startsWith('camera_') && e.status !== 'descartado') {
        assert.ok((e.serve_para ?? []).length > 0, `${onde}: câmera sem serve_para`);
      }
    }
  });

  it('equipamento descartado diz por quê', () => {
    for (const { caminho, item: e } of lidos) {
      if (e.status === 'descartado') {
        assert.ok(e.observacao.trim().length > 20, `${basename(caminho)}: descartado sem explicação`);
      }
    }
  });

  it('toda medição tem data, lugar, o que foi medido e o valor', () => {
    let total = 0;
    for (const { caminho, item: e } of lidos) {
      for (const m of e.medido) {
        total += 1;
        const onde = `${basename(caminho)} / ${m.metrica}`;
        assert.ok(dataValida(m.em), `${onde}: data "${m.em}"`);
        assert.ok(m.onde?.trim(), `${onde}: sem lugar`);
        assert.match(m.metrica, /^[a-z0-9_]+$/, `${onde}: nome da medida`);
        assert.ok(typeof m.valor === 'number' || (typeof m.valor === 'string' && m.valor.trim()), `${onde}: valor`);
      }
    }
    assert.ok(total > 0, 'nenhuma medição de campo no catálogo — o campo `medido` perdeu o sentido');
  });

  it('todo preço tem data, fonte e confiança — e é um valor OU uma faixa', () => {
    for (const { caminho, item: e } of lidos) {
      for (const p of e.precos) {
        const onde = basename(caminho);
        assert.ok(dataValida(p.cotado_em), `${onde}: preço sem data válida`);
        assert.ok(p.fonte?.trim(), `${onde}: preço sem fonte`);
        assert.ok(niveis.confianca_do_preco.includes(p.confianca), `${onde}: confiança "${p.confianca}"`);
        const unico = typeof p.preco === 'number';
        const faixa = typeof p.preco_min === 'number' && typeof p.preco_max === 'number';
        assert.ok(unico !== faixa, `${onde}: preço tem que ser um valor OU uma faixa`);
        if (unico) assert.ok(p.preco! > 0, `${onde}: preço ${p.preco}`);
        if (faixa) assert.ok(p.preco_min! > 0 && p.preco_min! <= p.preco_max!, `${onde}: faixa invertida`);
      }
    }
  });

  it('nada do que a migration 002 cadastrou ficou de fora, nem mudou de status', () => {
    // O catálogo passa a ser a fonte. Se ele não contiver o que o banco já
    // tem, a carga futura apagaria conhecimento em vez de acrescentar.
    const doBanco = [...migration002.matchAll(
      /\('([a-z_]+)','([^']+)','([^']+)','(recomendado|aceitavel|descartado)'/g,
    )].map((m) => ({ categoria: m[1]!, fabricante: m[2]!, modelo: m[3]!, status: m[4]! }));
    assert.ok(doBanco.length >= 20, `só li ${doBanco.length} equipamentos da migration 002`);

    for (const b of doBanco) {
      const achado = lidos.find((l) => l.item.fabricante === b.fabricante && l.item.modelo === b.modelo);
      assert.ok(achado, `falta no catálogo: ${b.fabricante} ${b.modelo}`);
      assert.equal(achado.item.categoria, b.categoria, `${b.modelo}: categoria`);
      assert.equal(achado.item.status, b.status, `${b.modelo}: status`);
    }
  });
});
