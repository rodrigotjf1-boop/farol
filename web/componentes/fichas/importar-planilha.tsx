'use client';

// =====================================================================
// Importar fichas por planilha — o modelo, o envio, a conferência
// =====================================================================
// Do protótipo aprovado em 11/10/2026 (`mockups/farol-conexoes-e-fichas.html`),
// com o passo "Conferir" na regra que o dono escolheu: "entra o que está
// certo e a tela lista o que ficou de fora".
//
// Quem ABRE o arquivo é este navegador (`lib/planilha.ts`); para o servidor
// vão só as células, e é ele que diz o que entra e o que fica de fora. A
// conferência não grava nada; só o botão do passo 3 grava.
//
// O modelo (as colunas, as unidades e o exemplo) vem do servidor: o arquivo
// que a pessoa baixa é sempre o que o servidor sabe ler.
// =====================================================================

import { CircleCheck, Download, FileSpreadsheet, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { frase, numero, plural } from '@/componentes/formatos';
import { ListaDeFora } from '@/componentes/fichas/de-fora';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';
import { Alerta, Chip, Ossos } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, fichasApi, type ConferenciaDaPlanilha, type ModeloDaPlanilha } from '@/lib/api';
import { baixarArquivo, escreverXlsx, lerArquivo, PlanilhaIlegivel, type AbasDaPlanilha } from '@/lib/planilha';

const ABAS = ['fichas', 'variacoes', 'adicionais', 'combos'] as const;

/** O que dizer de cada coluna da aba Fichas. A lista das colunas é do servidor; a explicação é da tela. */
const SOBRE_A_COLUNA: Record<string, { preencher: string; oQueE: string }> = {
  Produto: { preencher: 'sempre', oQueE: 'O nome como aparece no pedido. Repete em cada linha do produto.' },
  Código: { preencher: 'se quiser', oQueE: 'O código do produto no sistema da loja, se houver.' },
  Categoria: { preencher: 'se quiser', oQueE: 'Só para achar o produto na lista.' },
  'Vai para a cozinha': { preencher: 'se quiser', oQueE: '“não” para o que sai pronto, como bebida em lata. Em branco vale “sim”.' },
  Ingrediente: { preencher: 'sempre', oQueE: 'Um por linha, na ordem da montagem. Em branco: o produto entra sem ficha.' },
  Quantidade: { preencher: 'com ingrediente', oQueE: 'Só o número. Vírgula para decimal.' },
};
const SOBRE_A_ABA: Record<(typeof ABAS)[number], string> = {
  fichas: '',
  variacoes: 'quando o mesmo produto sai em tamanhos',
  adicionais: 'o que o cliente pode pedir a mais ou tirar',
  combos: 'produto feito de outros produtos',
};

type Lida = { nome: string; abas: AbasDaPlanilha; conferencia: ConferenciaDaPlanilha };

function Passos({ atual }: { atual: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Passos da importação" className="flex flex-wrap gap-x-3 gap-y-1.5" data-passos>
      {['O modelo', 'Enviar', 'Conferir'].map((nome, i) => {
        const n = i + 1;
        const feito = n < atual;
        return (
          <li key={nome} aria-current={n === atual ? 'step' : undefined} className={`inline-flex items-center gap-1.5 text-[13px] ${n === atual ? 'font-semibold text-farol-tinta' : 'text-farol-suave'}`}>
            <span
              aria-hidden
              className={`grid h-[22px] w-[22px] place-items-center rounded-full font-mono text-xs ${
                n === atual ? 'bg-farol-facho-leve text-farol-facho-tinta' : feito ? 'bg-farol-ok-leve text-farol-ok' : 'bg-farol-realce text-farol-suave'
              }`}
            >
              {feito ? '✓' : n}
            </span>
            {nome}
          </li>
        );
      })}
    </ol>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-[13px] font-semibold">{titulo}</h3>
      {children}
    </section>
  );
}

/** O passo 1: as colunas, como o servidor as lê, e o arquivo para baixar. */
function OModelo({ m }: { m: ModeloDaPlanilha }) {
  const exemplo = m.abas.fichas[1] ?? [];
  return (
    <>
      <p className="text-[13.5px]">
        A planilha tem <b className="font-semibold">uma linha por ingrediente</b>, na ordem em que o produto é montado. O nome do produto se repete nas linhas dele.
      </p>
      <Bloco titulo={`A aba “${m.nomes.fichas}” — a única obrigatória`}>
        {/* Uma coluna da planilha por linha: no estreito, vira uma ficha por coluna — nada rola para o lado. */}
        <div role="table" aria-label={`As colunas da aba ${m.nomes.fichas}`} className="overflow-hidden rounded-[10px] border border-farol-borda" data-colunas>
          <div role="row" className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,2fr)] gap-x-3 border-b border-farol-borda bg-farol-painel-2 px-3 py-2 text-xs font-semibold text-farol-suave sm:grid">
            <span role="columnheader">Coluna</span>
            <span role="columnheader">Preencher</span>
            <span role="columnheader">Exemplo</span>
            <span role="columnheader">O que é</span>
          </div>
          {m.colunas.fichas.map((coluna, i) => {
            const sobre = coluna === 'Unidade' ? { preencher: 'com ingrediente', oQueE: `Uma da lista: ${m.unidades.join(', ')}.` } : SOBRE_A_COLUNA[coluna];
            return (
              <div
                key={coluna}
                role="row"
                data-coluna={coluna}
                className="grid grid-cols-1 gap-x-3 gap-y-0.5 border-b border-farol-borda px-3 py-2.5 text-[13.5px] last:border-b-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,2fr)]"
              >
                <b role="cell" className="break-words font-semibold">
                  {coluna}
                </b>
                <span role="cell" className="text-farol-suave">
                  <span className="sm:hidden">preencher: </span>
                  {sobre?.preencher ?? 'se quiser'}
                </span>
                <span role="cell" className="break-words font-mono text-[13px]">
                  <span className="font-sans text-farol-suave sm:hidden">exemplo: </span>
                  {String(exemplo[i] ?? '')}
                </span>
                <span role="cell" className="break-words text-[13px] text-farol-suave">
                  {sobre?.oQueE ?? ''}
                </span>
              </div>
            );
          })}
        </div>
      </Bloco>
      <Bloco titulo="As outras abas — só se a loja usar">
        <ul className="flex flex-col gap-2" data-outras-abas>
          {ABAS.filter((q) => q !== 'fichas').map((q) => (
            <li key={q} className="flex flex-col gap-0.5 rounded-[10px] border border-farol-borda px-3 py-2.5 text-[13.5px]">
              <span>
                <b className="font-semibold">{m.nomes[q]}</b> — {SOBRE_A_ABA[q]}
              </span>
              <small className="break-words font-mono text-xs text-farol-suave">{m.colunas[q].join(' · ')}</small>
            </li>
          ))}
        </ul>
      </Bloco>
      <p className={AJUDA}>
        O modelo já vem com as abas, os títulos das colunas e um exemplo pequeno para apagar. Coluna que não é do modelo é ignorada. Preço e custo não são pedidos: o
        Farol não usa.
      </p>
    </>
  );
}

/** As contas do que entra, em pastilhas. */
function OQueEntra({ c }: { c: ConferenciaDaPlanilha['contas'] }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-contas>
      <Chip>{plural(c.produtos, 'produto', 'produtos')}</Chip>
      <Chip tom="ok">{numero(c.comFicha)} com ficha</Chip>
      <Chip>{plural(c.ingredientes, 'ingrediente', 'ingredientes')}</Chip>
      {c.variacoes > 0 && <Chip>{plural(c.variacoes, 'variação', 'variações')}</Chip>}
      {c.adicionais > 0 && <Chip>{plural(c.adicionais, 'adicional', 'adicionais')}</Chip>}
      {c.combos > 0 && <Chip>{plural(c.combos, 'combo', 'combos')}</Chip>}
    </div>
  );
}

/** Os nomes, até seis, e quantos mais. */
function nomes(lista: string[]): string {
  const primeiros = lista.slice(0, 6).join(', ');
  return lista.length > 6 ? `${primeiros} e mais ${numero(lista.length - 6)}` : primeiros;
}

export function ImportarPlanilha({
  lojaId,
  lojaNome,
  aoFechar,
  aoImportar,
}: {
  lojaId: string;
  lojaNome: string;
  aoFechar: () => void;
  /** Depois de gravar: a tela recarrega as fichas e diz o que aconteceu. */
  aoImportar: (r: ConferenciaDaPlanilha) => void;
}) {
  const idArquivo = useId();
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [modelo, setModelo] = useState<ModeloDaPlanilha | null>(null);
  const [semModelo, setSemModelo] = useState(false);
  const [lida, setLida] = useState<Lida | null>(null);
  const [trabalhando, setTrabalhando] = useState<'conferindo' | 'importando' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fichasApi
      .modelo()
      .then((m) => vivo && setModelo(m))
      .catch(() => vivo && setSemModelo(true));
    return () => {
      vivo = false;
    };
  }, []);

  const irPara = (p: 1 | 2 | 3) => {
    setErro(null);
    setPasso(p);
  };
  const mensagem = (e: unknown, padrao: string): string => (e instanceof PlanilhaIlegivel ? e.message : e instanceof ErroDaApi ? frase(e.message) : padrao);

  function baixarModelo() {
    if (!modelo) return;
    baixarArquivo(escreverXlsx(ABAS.map((q) => ({ nome: modelo.nomes[q], linhas: modelo.abas[q] }))), 'modelo-de-fichas.xlsx');
  }

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const campo = e.currentTarget;
    const arquivo = campo.files?.[0];
    if (!arquivo) return;
    setErro(null);
    setTrabalhando('conferindo');
    try {
      const abas = await lerArquivo(arquivo);
      const conferencia = await fichasApi.conferir(lojaId, arquivo.name, abas);
      setLida({ nome: arquivo.name, abas, conferencia });
      setPasso(3);
    } catch (falha) {
      setErro(mensagem(falha, 'Não deu para abrir a planilha.'));
      // o mesmo arquivo, corrigido e escolhido de novo, tem de disparar a leitura outra vez
      campo.value = '';
    } finally {
      setTrabalhando(null);
    }
  }

  async function importar() {
    if (!lida) return;
    setErro(null);
    setTrabalhando('importando');
    try {
      aoImportar(await fichasApi.importar(lojaId, lida.nome, lida.abas));
    } catch (falha) {
      setErro(mensagem(falha, 'Não deu para importar agora. Nada foi gravado.'));
    } finally {
      setTrabalhando(null);
    }
  }

  const c = lida?.conferencia ?? null;
  const fora = c ? c.deFora.length : 0;
  const soltas = c ? c.soltos.length : 0;
  const entram = c ? c.contas.produtos : 0;
  const nadaCerto = c !== null && entram === 0;
  const emParte = c !== null && !nadaCerto && c.problemas > 0;

  const rodape =
    passo === 1 ? (
      <>
        <Botao onClick={baixarModelo} disabled={!modelo}>
          <Download className="h-4 w-4" aria-hidden />
          Baixar o modelo
        </Botao>
        <Botao variante="primario" onClick={() => irPara(2)}>
          Já tenho a planilha preenchida
        </Botao>
      </>
    ) : passo === 2 ? (
      <Botao onClick={() => irPara(1)} disabled={trabalhando !== null}>
        Voltar ao modelo
      </Botao>
    ) : nadaCerto ? (
      <>
        <Botao onClick={() => irPara(1)}>Voltar ao modelo</Botao>
        <Botao variante="primario" onClick={() => irPara(2)}>
          Enviar a planilha corrigida
        </Botao>
      </>
    ) : (
      <>
        <Botao onClick={() => irPara(2)} disabled={trabalhando !== null}>
          Enviar outra planilha
        </Botao>
        <Botao variante="primario" ocupado={trabalhando === 'importando'} onClick={importar} data-importar>
          {emParte ? (entram === 1 ? 'Importar o que está certo' : `Importar os ${numero(entram)} que estão certos`) : 'Importar'}
        </Botao>
      </>
    );

  return (
    <Gaveta titulo="Importar fichas por planilha" descricao={lojaNome} larga ocupado={trabalhando !== null} aoFechar={aoFechar} rodape={rodape}>
      <Passos atual={passo} />

      {erro && (
        <Alerta tom="critico" icone={TriangleAlert} papel="alert">
          {erro}
        </Alerta>
      )}

      {passo === 1 &&
        (modelo ? (
          <OModelo m={modelo} />
        ) : semModelo ? (
          <Alerta tom="critico" icone={TriangleAlert} papel="alert">
            Não deu para carregar o modelo agora. Se você já tem a planilha preenchida, pode seguir; para baixar o modelo, feche e abra de novo.
          </Alerta>
        ) : (
          <Ossos alturas={[40, 260, 120]} />
        ))}

      {passo === 2 && (
        <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-dashed border-farol-borda-forte px-4 py-7 text-center" data-enviar>
          <FileSpreadsheet className="h-7 w-7 text-farol-suave" aria-hidden />
          <label htmlFor={idArquivo} className="max-w-[46ch] text-[13.5px]">
            Escolha a planilha preenchida. O Farol confere tudo antes de gravar, e mostra <b className="font-semibold">o que entra e o que fica de fora</b>.
          </label>
          <input
            id={idArquivo}
            type="file"
            accept=".xlsx,.csv"
            disabled={trabalhando !== null}
            onChange={escolher}
            className="w-full min-w-0 max-w-[340px] text-[13px] text-farol-suave file:mr-3 file:cursor-pointer file:rounded-[9px] file:border file:border-farol-borda-forte file:bg-farol-painel file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-farol-tinta"
          />
          <p className={AJUDA}>Aceita .xlsx e .csv, até 2 MB.</p>
          {trabalhando === 'conferindo' && (
            <p role="status" className="text-[13px] text-farol-suave">
              Conferindo a planilha…
            </p>
          )}
        </div>
      )}

      {passo === 3 && c && (
        <>
          {nadaCerto ? (
            <Alerta tom="critico" icone={TriangleAlert} papel="alert">
              <b className="font-semibold">Nenhum produto da planilha está certo, e nada foi importado.</b> Corrija o que a lista aponta e envie de novo. As fichas que a
              loja tem continuam como estavam.
            </Alerta>
          ) : emParte ? (
            <Alerta tom="atencao" icone={Info} papel="status">
              <b className="font-semibold">
                {fora > 0
                  ? `${plural(fora, 'produto fica', 'produtos ficam')} de fora; ${entram === 1 ? 'o outro entra' : `os outros ${numero(entram)} entram`}.`
                  : `${plural(soltas, 'linha fica', 'linhas ficam')} de fora; ${plural(entram, 'produto entra', 'produtos entram')}.`}
              </b>{' '}
              O produto com uma linha errada fica inteiro de fora, para o Farol não conferir a montagem contra meia ficha. Nada foi gravado ainda.
            </Alerta>
          ) : (
            <Alerta tom="ok" icone={CircleCheck} papel="status">
              <b className="font-semibold">A planilha está certa.</b> Nada foi gravado ainda: confira os números e importe.
            </Alerta>
          )}

          {!nadaCerto && (
            <Bloco titulo="O que entra">
              <OQueEntra c={c.contas} />
              {c.semFicha.length > 0 && (
                <p className={AJUDA} data-sem-ficha>
                  {plural(c.semFicha.length, 'produto entra', 'produtos entram')} sem ficha, porque {c.semFicha.length === 1 ? 'não tem' : 'não têm'} ingrediente na
                  planilha: {nomes(c.semFicha)}. Para o que não passa pela cozinha, não faz falta.
                </p>
              )}
            </Bloco>
          )}

          {c.problemas > 0 && (
            <Bloco titulo="O que fica de fora, e por quê">
              <ListaDeFora deFora={c.deFora} soltos={c.soltos} problemas={c.problemas} />
              {!nadaCerto && <p className={AJUDA}>Esta lista continua à mão depois de importar, na tela Fichas.</p>}
            </Bloco>
          )}

          {!nadaCerto && c.troca && (
            <Alerta icone={Info} papel="status">
              <b className="font-semibold text-farol-tinta">Importar troca todas as fichas da {lojaNome}.</b>{' '}
              {c.troca.produtos === 1 ? 'O produto que ela tem hoje sai' : `Os ${numero(c.troca.produtos)} produtos que ela tem hoje saem`}, e{' '}
              {entram === 1 ? 'este entra' : 'estes entram'} no lugar.
            </Alerta>
          )}
        </>
      )}
    </Gaveta>
  );
}
