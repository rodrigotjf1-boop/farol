// =====================================================================
// A planilha, no navegador — abrir o arquivo e escrever o arquivo
// =====================================================================
// As fichas por planilha (pedido do dono em 11/10/2026). Quem ABRE o
// arquivo é o navegador de quem importa: daqui saem só as células, aba por
// aba, e TODA regra (títulos, obrigatórias, unidades, o que é problema) é
// do servidor (`api/src/planilha-fichas.ts`). O servidor nunca abre um
// .xlsx — um arquivo compactado vindo de fora é o tipo de coisa que derruba
// servidor, e assim ele nem chega lá.
//
// Daqui também sai o arquivo que a pessoa BAIXA (o modelo, e as fichas da
// loja de volta em planilha): as linhas vêm do servidor, e este módulo só
// as põe no formato do Excel.
//
// Um .xlsx é um arquivo compactado com XML dentro. O que se lê dele:
// a lista de abas, os textos (que ficam numa tabela à parte) e as células
// de cada aba. Fórmula não é calculada: vale o valor que o Excel guardou.
// Formatação, cor, largura e comentário são ignorados.
//
// Dois tetos, antes de qualquer trabalho: o arquivo (2 MB) e o que ele
// vira depois de aberto (30 MB) — um arquivo pequeno pode esconder um
// conteúdo enorme.
// =====================================================================

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type Celula = string | number | boolean | null;
export type Aba = Celula[][];
/** As abas que o servidor conhece. O que não é uma delas não sai daqui. */
export type AbasDaPlanilha = { fichas?: Aba; variacoes?: Aba; adicionais?: Aba; combos?: Aba };
type QualAba = keyof AbasDaPlanilha;

/** O maior arquivo que se abre. */
export const MAX_DO_ARQUIVO = 2 * 1024 * 1024;
/** O maior conteúdo, depois de aberto. */
const MAX_ABERTO = 30 * 1024 * 1024;
/** Uma linha a mais do que o servidor aceita: quem diz "grande demais" é ele. */
const MAX_LINHAS = 20_002;
const MAX_COLUNAS = 60;

/** O arquivo não é uma planilha que dê para abrir. A mensagem é para a tela. */
export class PlanilhaIlegivel extends Error {}

const semAcento = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const QUAL: Record<string, QualAba> = { fichas: 'fichas', ficha: 'fichas', variacoes: 'variacoes', variacao: 'variacoes', adicionais: 'adicionais', adicional: 'adicionais', combos: 'combos', combo: 'combos' };

// ───────────────────────── abrir ─────────────────────────

/** Abre o arquivo que a pessoa escolheu e devolve as células, aba por aba. */
export async function lerArquivo(arquivo: File): Promise<AbasDaPlanilha> {
  if (arquivo.size === 0) throw new PlanilhaIlegivel('O arquivo está vazio.');
  if (arquivo.size > MAX_DO_ARQUIVO) throw new PlanilhaIlegivel('O arquivo passa de 2 MB. Uma planilha de fichas é bem menor: confira se é o arquivo certo.');
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  // O .xlsx começa com "PK" (é um arquivo compactado); o resto é tratado como texto separado por vírgula.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return lerXlsx(bytes);
  if (/\.xls$/i.test(arquivo.name)) throw new PlanilhaIlegivel('Este é o formato antigo do Excel (.xls). Salve como “Pasta de Trabalho do Excel (.xlsx)” e envie de novo.');
  return { fichas: lerCsv(bytes) };
}

function xml(texto: string): Document {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new PlanilhaIlegivel('Não deu para abrir a planilha: o arquivo parece estar danificado.');
  return doc;
}
const todos = (no: Document | Element, nome: string): Element[] => Array.from(no.getElementsByTagNameNS('*', nome));

function lerXlsx(bytes: Uint8Array): AbasDaPlanilha {
  let aberto = 0;
  let partes: Record<string, Uint8Array>;
  try {
    partes = unzipSync(bytes, {
      filter: (f) => {
        if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name)) return false;
        aberto += f.originalSize;
        if (aberto > MAX_ABERTO) throw new PlanilhaIlegivel('A planilha é grande demais para abrir. Uma planilha de fichas tem só texto e números.');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PlanilhaIlegivel) throw e;
    throw new PlanilhaIlegivel('Não deu para abrir a planilha. Salve de novo como .xlsx e tente outra vez.');
  }
  const parte = (nome: string): string | null => (partes[nome] ? strFromU8(partes[nome]!) : null);
  const livro = parte('xl/workbook.xml');
  const ligacoes = parte('xl/_rels/workbook.xml.rels');
  if (!livro || !ligacoes) throw new PlanilhaIlegivel('O arquivo não é uma planilha do Excel (.xlsx).');

  // Os textos ficam numa tabela à parte; a célula guarda só a posição.
  const tabela = parte('xl/sharedStrings.xml');
  const textos = tabela ? todos(xml(tabela), 'si').map(textoDe) : [];

  // Cada aba aponta para o arquivo dela por um apelido.
  const alvo = new Map<string, string>();
  for (const r of todos(xml(ligacoes), 'Relationship')) {
    const destino = r.getAttribute('Target') ?? '';
    alvo.set(r.getAttribute('Id') ?? '', destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`);
  }
  const abas = todos(xml(livro), 'sheet').map((s) => ({
    nome: s.getAttribute('name') ?? '',
    arquivo: alvo.get(s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id') ?? '') ?? '',
  }));

  const saida: AbasDaPlanilha = {};
  for (const a of abas) {
    const qual = QUAL[semAcento(a.nome)];
    const conteudo = parte(a.arquivo);
    if (!qual || saida[qual] || conteudo === null) continue;
    saida[qual] = lerAba(conteudo, textos);
  }
  // Planilha de uma aba só, com outro nome: é a de fichas.
  if (!saida.fichas && abas.length === 1) {
    const conteudo = parte(abas[0]!.arquivo);
    if (conteudo !== null) saida.fichas = lerAba(conteudo, textos);
  }
  return saida;
}

/** O texto de um item: os pedaços `t`, juntos — menos a leitura fonética, que não é o texto. */
function textoDe(item: Element): string {
  return todos(item, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');
}

/** "C" → 2, "AA" → 26. */
function colunaDe(referencia: string): number {
  let n = 0;
  for (const c of referencia) {
    const v = c.charCodeAt(0);
    if (v < 65 || v > 90) break;
    n = n * 26 + (v - 64);
  }
  return n - 1;
}

function lerAba(conteudo: string, textos: string[]): Aba {
  const linhas: Aba = [];
  let seguinte = 0;
  for (const row of todos(xml(conteudo), 'row')) {
    // A linha fica NA POSIÇÃO dela: é pelo número da linha que a tela diz onde está o problema.
    const n = Number(row.getAttribute('r'));
    const indice = Number.isInteger(n) && n >= 1 ? n - 1 : seguinte;
    seguinte = indice + 1;
    if (indice >= MAX_LINHAS) break;
    const linha: Celula[] = [];
    let proxima = 0;
    for (const c of todos(row, 'c')) {
      const ref = c.getAttribute('r');
      const coluna = ref ? colunaDe(ref) : proxima;
      proxima = coluna + 1;
      if (coluna < 0 || coluna >= MAX_COLUNAS) continue;
      const tipo = c.getAttribute('t');
      const v = todos(c, 'v')[0]?.textContent ?? null;
      let valor: Celula = null;
      if (tipo === 's') valor = v === null ? null : (textos[Number(v)] ?? null);
      else if (tipo === 'inlineStr') valor = textoDe(c);
      else if (tipo === 'str') valor = v;
      else if (tipo === 'b') valor = v === '1';
      else if (tipo === 'e') valor = null;
      else if (v !== null && v !== '') valor = Number.isFinite(Number(v)) ? Number(v) : v;
      while (linha.length < coluna) linha.push(null);
      linha[coluna] = valor;
    }
    while (linhas.length < indice) linhas.push([]);
    linhas[indice] = linha;
  }
  return linhas;
}

/**
 * O texto separado por vírgula (ou ponto e vírgula, que é como o Excel em
 * português salva). Uma aba só: a de fichas. Tudo chega como texto — quem
 * entende "0,5" é o servidor.
 */
function lerCsv(bytes: Uint8Array): Aba {
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // O Excel em português salva o "CSV" comum na codificação antiga do Windows.
    texto = new TextDecoder('windows-1252').decode(bytes);
  }
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  if (texto.includes(String.fromCharCode(0))) throw new PlanilhaIlegivel('Este arquivo não é uma planilha. Envie um .xlsx ou um .csv.');

  const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
  const conta = (sinal: string) => primeira.split(sinal).length - 1;
  const separador = [';', ',', '\t'].sort((a, b) => conta(b) - conta(a))[0]!;

  const linhas: Aba = [];
  let linha: Celula[] = [];
  let celula = '';
  let entreAspas = false;
  const fecharCelula = () => {
    linha.push(celula === '' ? null : celula);
    celula = '';
  };
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]!;
    if (entreAspas) {
      if (c !== '"') celula += c;
      else if (texto[i + 1] === '"') {
        celula += '"';
        i += 1;
      } else entreAspas = false;
    } else if (c === '"' && celula === '') entreAspas = true;
    else if (c === separador) fecharCelula();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      fecharCelula();
      linhas.push(linha.slice(0, MAX_COLUNAS));
      linha = [];
      if (linhas.length >= MAX_LINHAS) return linhas;
    } else celula += c;
  }
  if (celula !== '' || linha.length > 0) {
    fecharCelula();
    linhas.push(linha.slice(0, MAX_COLUNAS));
  }
  return linhas;
}

// ───────────────────────── escrever ─────────────────────────

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** O texto, pronto para ir dentro do XML: sem o que o XML não aceita. */
function paraXml(s: string): string {
  let limpo = '';
  for (const c of s) {
    const v = c.codePointAt(0)!;
    if (v === 9 || v === 10 || v === 13 || (v >= 32 && v !== 0xfffe && v !== 0xffff)) limpo += c;
  }
  return limpo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 0 → "A", 26 → "AA". */
function letraDe(coluna: number): string {
  let s = '';
  for (let n = coluna + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Um .xlsx com as abas dadas. A primeira linha de cada aba é o título:
 * sai em negrito e fica presa no alto ao rolar. Texto é texto e número é
 * número — sem fórmula, sem macro, sem nada escondido.
 */
export function escreverXlsx(abas: Array<{ nome: string; linhas: Array<Array<string | number>> }>): Blob {
  const cabeca = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const principal = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const arquivos: Record<string, Uint8Array> = {};
  const por = (nome: string, conteudo: string) => void (arquivos[nome] = strToU8(cabeca + conteudo));

  abas.forEach((aba, i) => {
    const colunas = aba.linhas.reduce((n, l) => Math.max(n, l.length), 0);
    // A largura acompanha o texto mais comprido da coluna, com piso e teto.
    let larguras = '';
    for (let c = 0; c < colunas; c += 1) {
      const maior = aba.linhas.reduce((n, l) => Math.max(n, String(l[c] ?? '').length), 0);
      larguras += `<col min="${c + 1}" max="${c + 1}" width="${Math.min(Math.max(maior + 3, 12), 60)}" customWidth="1"/>`;
    }
    const linhas = aba.linhas
      .map((l, n) => {
        const celulas = l
          .map((v, c) => {
            const onde = `${letraDe(c)}${n + 1}`;
            const estilo = n === 0 ? ' s="1"' : '';
            if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${onde}"${estilo}><v>${v}</v></c>`;
            if (v === '' || v === null || v === undefined) return '';
            return `<c r="${onde}"${estilo} t="inlineStr"><is><t xml:space="preserve">${paraXml(String(v))}</t></is></c>`;
          })
          .join('');
        return `<row r="${n + 1}">${celulas}</row>`;
      })
      .join('');
    por(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="${principal}"><sheetViews><sheetView workbookViewId="0"${i === 0 ? ' tabSelected="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
        `${larguras ? `<cols>${larguras}</cols>` : ''}<sheetData>${linhas}</sheetData></worksheet>`,
    );
  });

  por(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>',
  );
  por(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  por(
    'xl/workbook.xml',
    `<workbook xmlns="${principal}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>` +
      // O nome da aba tem regra no Excel: até 31 letras e sem : \ / ? * [ ]
      abas.map((a, i) => `<sheet name="${paraXml(a.nome.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  );
  por(
    'xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  por(
    'xl/styles.xml',
    `<styleSheet xmlns="${principal}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
  );

  const zip = zipSync(arquivos, { level: 6 });
  return new Blob([zip.slice().buffer], { type: TIPO_XLSX });
}

/** Entrega um arquivo a quem está na tela, com o nome dado. */
export function baixarArquivo(conteudo: Blob, nome: string): void {
  const endereco = URL.createObjectURL(conteudo);
  const a = document.createElement('a');
  a.href = endereco;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Depois do clique o navegador já pegou o conteúdo; o endereço temporário pode sair.
  setTimeout(() => URL.revokeObjectURL(endereco), 1000);
}
