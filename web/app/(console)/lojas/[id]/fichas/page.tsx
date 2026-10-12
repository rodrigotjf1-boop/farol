'use client';

// =====================================================================
// Fichas — o que a loja vende e do que cada produto é feito
// =====================================================================
// A tela mostra a BASE DE FICHAS que o Farol guarda da loja. Ela vem de UM
// de dois lugares (uma loja recebe as fichas de um lugar só):
//
//   • do Regem — lida quando a loja é ligada, uma vez por dia e a pedido
//     ("Buscar agora");
//   • de uma planilha, no modelo do Farol — importada por quem configura a
//     loja (`componentes/fichas/importar-planilha.tsx`). Decisão do dono em
//     11/10/2026: "entra o que está certo e a tela lista o que ficou de
//     fora" — por isso a tela diz quantos produtos ficaram de fora e abre a
//     lista.
//
// Não se edita por aqui: as fichas são da origem. Preço, custo e cliente não
// aparecem porque o Farol nem recebe.
//
// Quem vê: a supervisão para cima e o suporte (decisão do dono em
// 11/10/2026). "Buscar agora" é de quem configura a loja: para a supervisão
// o botão não aparece, e as frases não mandam usar o que ela não tem.
//
// Do protótipo aprovado em 11/10/2026 (`mockups/farol-conexoes-e-fichas.html`).
// Duas frases de lá ficaram de fora por enquanto: as que dizem que o Farol
// "confere pela câmera" pela ficha — isso chega quando um critério passar a
// usá-la. Frase de tela só vale com o serviço que a sustenta.
// =====================================================================

import { ChevronRight, ClipboardList, Download, FileSpreadsheet, Info, KeyRound, Lock, Minus, Plug, Plus, RefreshCw, Server, Store, TriangleAlert, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { GavetaDeFora } from '@/componentes/fichas/de-fora';
import { ImportarPlanilha } from '@/componentes/fichas/importar-planilha';
import { diaFaladoNaLoja, frase, numero, plural, quantidadeDaFicha } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Segmentado, Vazio } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, fichasApi, type ConferenciaDaPlanilha, type EfeitoDaOpcao, type FichasDaLoja, type ProdutoDaFicha, type ProdutoNaLista } from '@/lib/api';
import { baixarArquivo, escreverXlsx } from '@/lib/planilha';

type Filtro = 'todos' | 'com' | 'sem';

/** De quanto em quanto tempo a tela pergunta de novo enquanto a primeira busca não termina. */
const ESPERA_DA_BUSCA_MS = 3000;
/** Quantas vezes pergunta antes de parar (a rotina do servidor segue tentando). */
const MAX_PERGUNTAS = 20;

const semAcento = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const mensagemDe = (e: unknown): string => (e instanceof ErroDaApi ? e.message : 'não deu certo');

/** Quanto da ficha a variação usa, dito como se fala. */
function fatorFalado(fator: number): string {
  if (fator === 1) return 'a ficha inteira';
  if (fator === 0.5) return 'meia ficha';
  if (fator === 1.5) return 'uma vez e meia a ficha';
  if (fator === 2) return 'duas vezes a ficha';
  if (fator === 3) return 'três vezes a ficha';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(fator)} vezes a ficha`;
}

/** O que a opção muda na montagem, numa frase curta. */
function efeitoFalado(e: EfeitoDaOpcao): string {
  switch (e.tipo) {
    case 'observacao':
      return 'só uma observação para a cozinha';
    case 'insumo':
      return e.quantidade === null ? `acrescenta ${e.nome}` : `acrescenta ${quantidadeDaFicha(e.quantidade, e.unidade)} de ${e.nome}`;
    case 'preparo':
      return e.nome ? `acrescenta o preparo “${e.nome}”` : 'acrescenta um preparo da casa';
    case 'produto':
      return e.nome ? `acrescenta o produto “${e.nome}”` : 'acrescenta outro produto';
    case 'retira':
      return `tira: ${e.nome}`;
    default:
      return 'o Regem não diz o que muda na montagem';
  }
}

// ───────────────────────── a linha da lista ─────────────────────────

function Linha({ p, aoAbrir }: { p: ProdutoNaLista; aoAbrir: () => void }) {
  return (
    <li className="border-b border-farol-borda last:border-b-0">
      <button
        type="button"
        data-produto={p.id}
        onClick={aoAbrir}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-[18px] py-3 text-left transition-colors hover:bg-farol-painel-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_auto]"
      >
        <span className="min-w-0">
          <b className="block break-words font-semibold">{p.nome}</b>
          {p.categoria && <small className="block break-words text-xs text-farol-suave">{p.categoria}</small>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-farol-suave md:order-last" aria-hidden />
        <span className="col-span-full min-w-0 md:col-span-1">
          {p.cozinha ? <Chip tom="atencao">vai para a cozinha</Chip> : <span className="text-xs text-farol-suave">não passa pela cozinha</span>}
        </span>
        <span className="col-span-full flex min-w-0 flex-wrap gap-1.5 md:col-span-1">
          {p.ingredientes !== null ? (
            <Chip tom="ok">{plural(p.ingredientes, 'ingrediente', 'ingredientes')}</Chip>
          ) : p.combo !== null ? (
            <Chip>combo de {numero(p.combo)}</Chip>
          ) : (
            <Chip>sem ficha</Chip>
          )}
          {p.variacoes > 0 && <Chip>{plural(p.variacoes, 'variação', 'variações')}</Chip>}
          {p.adicionais > 0 && <Chip>{plural(p.adicionais, 'adicional', 'adicionais')}</Chip>}
        </span>
      </button>
    </li>
  );
}

// ───────────────────────── a gaveta do produto ─────────────────────────

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold">{titulo}</h3>
      {children}
    </section>
  );
}

/** De onde as fichas da loja vieram. */
type Origem = { de: 'regem' } | { de: 'planilha' } | { de: 'sistema'; nome: string };

function Folha({
  lojaId,
  resumo,
  podeBuscar,
  origem,
  espera,
  aoFechar,
}: {
  lojaId: string;
  resumo: ProdutoNaLista;
  podeBuscar: boolean;
  /** De onde as fichas da loja vieram: o que a gaveta diz sobre onde mudar depende disso. */
  origem: Origem;
  /**
   * A base ainda é a da planilha, e a loja já recebe de outro lugar (foi ligada ao Regem, ou ganhou o acesso de
   * um sistema): ninguém manda importar de novo. `regem`, ou o nome do sistema. Nulo = não é o caso.
   */
  espera: string | null;
  aoFechar: () => void;
}) {
  const daPlanilha = origem.de === 'planilha';
  const doSistema = origem.de === 'sistema' ? origem.nome : null;
  const [p, setP] = useState<ProdutoDaFicha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fichasApi
      .produto(lojaId, resumo.id)
      .then((r) => vivo && setP(r))
      .catch((e) => vivo && setErro(frase(mensagemDe(e))));
    return () => {
      vivo = false;
    };
  }, [lojaId, resumo.id]);

  return (
    <Gaveta
      titulo={resumo.nome}
      descricao={`${resumo.categoria ? `${resumo.categoria} · ` : ''}${resumo.cozinha ? 'vai para a cozinha' : 'não passa pela cozinha'}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <p className={`${AJUDA} min-w-0 flex-[1_1_220px]`}>
            {espera === 'regem'
              ? 'Esta ficha veio da planilha. Quando a busca no Regem der certo, as fichas de lá entram no lugar.'
              : espera
                ? `Esta ficha veio da planilha. Quando o ${espera} enviar as fichas dele, elas entram no lugar.`
                : daPlanilha
                  ? 'Para mudar, corrija a planilha e importe de novo.'
                  : doSistema
                    ? `Para mudar, mude no ${doSistema}: ele envia as fichas para cá.`
                    : `Para mudar, mude no Regem. O Farol busca as fichas uma vez por dia${podeBuscar ? '; para trazer já, use “Buscar agora”.' : '.'}`}
          </p>
          <Botao onClick={aoFechar}>Fechar</Botao>
        </>
      }
    >
      {erro && (
        <Alerta tom="critico" icone={TriangleAlert} papel="alert">
          {erro}
        </Alerta>
      )}
      {!p && !erro && <Ossos alturas={[120, 60]} />}
      {p && (
        <>
          {p.ficha ? (
            <Bloco titulo="A ficha, na ordem em que foi cadastrada">
              {p.ficha.ingredientes.length === 0 ? (
                <p className="text-[13px] text-farol-suave">A ficha está cadastrada, mas ainda sem ingredientes.</p>
              ) : (
                <ol className="flex flex-col" data-ingredientes>
                  {p.ficha.ingredientes.map((i, n) => (
                    // A ordem É a informação, e o ingrediente não tem id: a posição serve de chave.
                    <li key={n} className="flex items-baseline gap-3 border-b border-farol-borda py-2 last:border-b-0">
                      <span className="w-5 shrink-0 text-right font-mono text-xs text-farol-suave">{n + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="break-words">{i.nome}</span>
                        {i.preparo && <small className="block text-xs text-farol-suave">preparo da casa — entra como um ingrediente só</small>}
                      </span>
                      <span className="shrink-0 font-mono text-[13px] tabular-nums">{quantidadeDaFicha(i.quantidade, i.unidade)}</span>
                    </li>
                  ))}
                </ol>
              )}
              {origem.de === 'regem' && <p className={AJUDA}>A embalagem que só entra no pedido para viagem fica fora desta lista.</p>}
            </Bloco>
          ) : p.tipo === 'combo' ? (
            <Bloco titulo="O que vem no combo">
              <ul className="flex flex-col gap-1.5" data-combo>
                {p.combo.map((c) => (
                  <li key={c.produtoId} className="flex items-start gap-2 text-[13.5px]">
                    <Plus className="mt-0.5 h-[15px] w-[15px] shrink-0 text-farol-ok" aria-hidden />
                    <span className="min-w-0 break-words">
                      {numero(c.quantidade)} {c.nome ?? 'produto que não está nas fichas'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={AJUDA}>Cada produto do combo tem a ficha dele.</p>
            </Bloco>
          ) : (
            <Alerta icone={Info}>
              <b className="font-semibold text-farol-tinta">
                Este produto não tem ficha {daPlanilha ? 'na planilha' : doSistema ? `no que o ${doSistema} enviou` : 'no Regem'}.
              </b>{' '}
              {p.cozinha ? (
                espera ? (
                  'O Farol sabe que a loja o vende, mas não como é montado.'
                ) : daPlanilha ? (
                  'O Farol sabe que a loja o vende, mas não como é montado. Para ele ter ficha, preencha os ingredientes na planilha e importe de novo.'
                ) : doSistema ? (
                  `O Farol sabe que a loja o vende, mas não como é montado. A ficha se cadastra no ${doSistema}.`
                ) : (
                  <>
                    O Farol sabe que a loja o vende, mas não como é montado. A ficha se cadastra no Regem, em{' '}
                    <b className="font-semibold text-farol-tinta">Estoque › Fichas técnicas</b>.
                  </>
                )
              ) : (
                'Para o que não passa pela cozinha, não faz falta.'
              )}
            </Alerta>
          )}

          {p.variacoes.length > 0 && (
            <Bloco titulo="Variações">
              <div className="flex flex-wrap gap-1.5" data-variacoes>
                {p.variacoes.map((v) => (
                  <Chip key={`${v.nome}|${v.codigo ?? ''}`}>
                    {v.nome}
                    {p.ficha ? ` · ${fatorFalado(v.fator)}` : ''}
                  </Chip>
                ))}
              </div>
            </Bloco>
          )}

          {p.adicionais.length > 0 && (
            <Bloco titulo="O que o cliente pode pedir a mais ou tirar">
              <ul className="flex flex-col gap-2" data-adicionais>
                {p.adicionais.flatMap((g, ng) =>
                  g.opcoes.map((o, no) => {
                    const Icone = o.efeito.tipo === 'retira' ? Minus : o.efeito.tipo === 'observacao' || o.efeito.tipo === 'nada' ? Info : Plus;
                    return (
                      // O id fixo falta em parte das opções; o grupo e a posição não se repetem.
                      <li key={`${ng}-${no}`} className="flex items-start gap-2">
                        <Icone className="mt-0.5 h-[15px] w-[15px] shrink-0 text-farol-suave" aria-hidden />
                        <span className="min-w-0">
                          <span className="block break-words text-[13.5px]">{o.nome}</span>
                          <small className="block break-words text-xs text-farol-suave">{efeitoFalado(o.efeito)}</small>
                        </span>
                      </li>
                    );
                  }),
                )}
              </ul>
            </Bloco>
          )}
        </>
      )}
    </Gaveta>
  );
}

// ───────────────────────── a tela ─────────────────────────

export default function Fichas() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const avisar = useAvisar();
  const { loja } = useConsole();
  const idBusca = useId();

  const [d, setD] = useState<FichasDaLoja | null>(null);
  const [falha, setFalha] = useState<{ semPermissao: boolean; texto: string } | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [buscando, setBuscando] = useState(false);
  const [erroDaBusca, setErroDaBusca] = useState<string | null>(null);
  const [aberto, setAberto] = useState<ProdutoNaLista | null>(null);
  const [importando, setImportando] = useState(false);
  const [vendoDeFora, setVendoDeFora] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const perguntas = useRef(0);

  const fuso = loja?.timezone ?? 'America/Sao_Paulo';
  const nomeDaLoja = loja?.nome ?? 'esta loja';

  const carregar = useCallback(async (): Promise<FichasDaLoja | null> => {
    try {
      const r = await fichasApi.obter(id);
      setD(r);
      setFalha(null);
      return r;
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 401) {
        router.replace('/entrar');
        return null;
      }
      setFalha({ semPermissao: e instanceof ErroDaApi && e.status === 403, texto: mensagemDe(e) });
      return null;
    }
  }, [id, router]);

  useEffect(() => {
    setD(null);
    perguntas.current = 0;
    void carregar();
  }, [carregar]);

  // A loja acabou de ser ligada: a primeira busca corre no servidor. A tela
  // pergunta de novo de tempos em tempos, até as fichas chegarem (ou a
  // busca falhar) — e para sozinha: quem quiser, usa o "Buscar agora".
  // (Vale também para a loja que tinha fichas de planilha: até a busca dar certo, a base ainda é a da planilha.)
  const esperandoAPrimeira = d?.situacao === 'ligada' && d.fonte !== 'regem' && !d.leitura?.falhou;
  useEffect(() => {
    if (!esperandoAPrimeira) return;
    const t = setInterval(() => {
      perguntas.current += 1;
      if (perguntas.current > MAX_PERGUNTAS) return clearInterval(t);
      if (document.visibilityState === 'visible') void carregar();
    }, ESPERA_DA_BUSCA_MS);
    return () => clearInterval(t);
  }, [esperandoAPrimeira, carregar]);

  async function buscarAgora() {
    setBuscando(true);
    setErroDaBusca(null);
    try {
      const r = await fichasApi.buscar(id);
      await carregar();
      if (r.resultado === 'atualizada') avisar('Fichas atualizadas agora.');
      else if (r.comFicha === 0) avisar('Busquei agora: o Regem desta loja continua sem fichas técnicas.');
      else avisar('Busquei agora: nada mudou desde a última busca.');
    } catch (e) {
      // O que mudou de estado (o acesso foi tirado, a loja foi desconectada) a tela mostra ao recarregar.
      await carregar();
      setErroDaBusca(frase(mensagemDe(e)));
    } finally {
      setBuscando(false);
    }
  }

  const lista = useMemo(() => {
    const b = semAcento(busca.trim());
    return (d?.produtos ?? []).filter((p) => {
      const temFicha = p.ingredientes !== null;
      if (filtro === 'com' && !temFicha) return false;
      if (filtro === 'sem' && temFicha) return false;
      return !b || semAcento(`${p.nome} ${p.categoria ?? ''}`).includes(b);
    });
  }, [d, busca, filtro]);

  // A planilha foi importada: a tela recarrega e diz o que aconteceu.
  async function importou(r: ConferenciaDaPlanilha) {
    setImportando(false);
    await carregar();
    const entraram = r.contas.produtos;
    const fora = r.deFora.length;
    if (r.resultado === 'nada_mudou') avisar('A planilha traz as fichas que a loja já tinha: nada mudou.');
    else if (r.problemas > 0) {
      avisar(
        fora > 0
          ? `Fichas importadas: ${plural(entraram, 'produto entrou', 'produtos entraram')} e ${plural(fora, 'ficou de fora', 'ficaram de fora')}.`
          : `Fichas importadas: ${plural(entraram, 'produto entrou', 'produtos entraram')}. Algumas linhas da planilha ficaram de fora.`,
      );
    } else avisar(`Fichas importadas: ${plural(entraram, 'produto', 'produtos')}, ${numero(r.contas.comFicha)} com ficha.`);
  }

  // As fichas da loja de volta em planilha, no modelo: para corrigir e importar de novo.
  async function baixarPlanilha() {
    setBaixando(true);
    setErroDaBusca(null);
    try {
      const p = await fichasApi.planilha(id);
      const abas = (['fichas', 'variacoes', 'adicionais', 'combos'] as const).map((q) => ({ nome: p.nomes[q], linhas: p.abas[q] }));
      baixarArquivo(escreverXlsx(abas), 'fichas-da-loja.xlsx');
    } catch (e) {
      setErroDaBusca(frase(mensagemDe(e)));
    } finally {
      setBaixando(false);
    }
  }

  // De onde a base veio. Da planilha, a lista aparece sem ligação nenhuma com o Regem.
  const daPlanilha = d?.fonte === 'planilha';
  // A loja tinha fichas de planilha e foi ligada ao Regem: elas ficam até a primeira busca dar certo, e aí as do
  // Regem entram no lugar. Enquanto isso a tela não manda importar de novo — a loja já recebe de outro lugar, e o
  // servidor recusa a importação. (Vale igual se o Regem tirou o acesso antes de a primeira busca dar certo.)
  const esperaORegem = daPlanilha && (d?.situacao === 'ligada' || d?.situacao === 'acesso_tirado');
  // O sistema que tem acesso para enviar as fichas desta loja — pode ainda não ter enviado nada.
  const sistema = d?.sistema ?? null;
  const doSistema = d?.fonte === 'sistema' && sistema !== null;
  // A loja tinha fichas de planilha e ganhou o acesso de um sistema: elas ficam até ele enviar as dele.
  const esperaOSistema = daPlanilha && sistema !== null;
  const esperaOutra = esperaORegem || esperaOSistema;
  // Sem ligação com o Regem valendo: é onde cabem a planilha e o outro sistema.
  const semRegem = d?.situacao === 'sem_conexao' || d?.situacao === 'falta_ligar';
  const temBase = daPlanilha || doSistema || (d?.situacao === 'ligada' && d.fonte !== null);
  const origem: Origem = daPlanilha ? { de: 'planilha' } : doSistema && sistema ? { de: 'sistema', nome: sistema.nome } : { de: 'regem' };
  // Quem decide é a API (as rotas recusam quem só vê); aqui só se escolhe entre o botão e a frase.
  const podeBuscar = d?.podeBuscar === true;
  const podeImportar = d?.podeImportar === true;
  const n = d?.totais?.produtos ?? 0;
  const comFicha = d?.totais?.comFicha ?? 0;

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Store className="h-[15px] w-[15px]" aria-hidden />
            {loja?.nome ?? 'Loja'}
          </>
        }
        titulo={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            Fichas
            {daPlanilha && d?.importacao && (
              <span className="flex flex-wrap items-center gap-1.5 font-sans text-sm font-normal tracking-normal" data-leitura>
                <Chip tom="vazado">da planilha</Chip>
                <Chip tom="ok">importada {diaFaladoNaLoja(d.importacao.em, fuso)}</Chip>
              </span>
            )}
            {doSistema && sistema && (
              <span className="flex flex-wrap items-center gap-1.5 font-sans text-sm font-normal tracking-normal" data-leitura>
                <Chip tom="vazado">do {sistema.nome}</Chip>
                <Chip tom="ok">recebido {diaFaladoNaLoja(sistema.recebidoEm, fuso)}</Chip>
              </span>
            )}
            {!daPlanilha && !doSistema && temBase && d?.leitura && (
              <span className="flex flex-wrap items-center gap-1.5 font-sans text-sm font-normal tracking-normal" data-leitura>
                <Chip tom="vazado">do Regem</Chip>
                {d.leitura.falhou ? (
                  <Chip tom="critico">a última busca falhou</Chip>
                ) : (
                  <Chip tom="ok">atualizado {diaFaladoNaLoja(d.leitura.lidaEm, fuso)}</Chip>
                )}
              </span>
            )}
          </span>
        }
        acoes={
          sistema && semRegem
            ? // A loja recebe (ou vai receber) de outro sistema: o acesso dele se vê e se revoga em Conexões.
              d?.podeConectar && (
                <Link href="/conexoes" className={classesDoBotao()}>
                  <Plug className="h-4 w-4" aria-hidden />
                  Conexões
                </Link>
              )
            : daPlanilha && !esperaORegem
              ? podeImportar && (
                <>
                  <Botao onClick={() => setImportando(true)}>
                    <Upload className="h-4 w-4" aria-hidden />
                    Importar de novo
                  </Botao>
                  <Botao ocupado={baixando} onClick={baixarPlanilha}>
                    {!baixando && <Download className="h-4 w-4" aria-hidden />}
                    Baixar a planilha
                  </Botao>
                </>
              )
            : d?.situacao === 'ligada' &&
              (podeBuscar || d.podeConectar) && (
                <>
                  {podeBuscar && (
                    <Botao ocupado={buscando} onClick={buscarAgora}>
                      {!buscando && <RefreshCw className="h-4 w-4" aria-hidden />}
                      {buscando ? 'Buscando…' : 'Buscar agora'}
                    </Botao>
                  )}
                  {d.podeConectar && (
                    <Link href="/conexoes" className={classesDoBotao()}>
                      <Plug className="h-4 w-4" aria-hidden />
                      Conexões
                    </Link>
                  )}
                </>
              )
        }
      >
        O que a loja vende e do que cada produto é feito{!daPlanilha && d?.situacao === 'ligada' ? ', como está cadastrado no Regem' : ''}.
      </Cabecalho>

      {!d && !falha && <Ossos alturas={[44, 300]} />}

      {falha &&
        (falha.semPermissao ? (
          <Vazio icone={Lock} titulo="Seu perfil não vê as fichas da loja">
            As fichas aparecem para a supervisão, a gerência e a diretoria.
          </Vazio>
        ) : (
          <Vazio
            icone={TriangleAlert}
            titulo="O console não respondeu"
            acao={
              <Botao
                variante="primario"
                onClick={() => {
                  setFalha(null);
                  void carregar();
                }}
              >
                Tentar de novo
              </Botao>
            }
          >
            Não deu para carregar esta tela ({falha.texto}). Nada foi perdido: as fichas que a loja já tem continuam valendo.
          </Vazio>
        ))}

      {d && !falha && d.situacao === 'sem_conexao' && !daPlanilha && !sistema && (
        // Os três jeitos de a loja ter fichas. O Regem é um deles, não o único.
        <>
          <div className="flex flex-col gap-1.5" data-sem-fichas>
            <h2 className="font-display text-lg font-semibold">Esta loja ainda não tem fichas</h2>
            <p className="max-w-[64ch] text-farol-suave">
              Com as fichas, o Farol passa a saber como cada produto deve ser montado. Elas vêm de onde a loja já cadastra o cardápio — escolha um dos três jeitos.
              Uma loja recebe as fichas de um lugar só.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3" data-jeitos>
            <section className={`${CARTAO} flex flex-col gap-2 px-[18px] py-[18px]`} data-jeito="regem">
              <Plug className="h-[22px] w-[22px] text-farol-marca" aria-hidden />
              <p className="text-xs font-medium uppercase tracking-wide text-farol-suave">para quem usa o Regem</p>
              <h3 className="font-display text-base font-semibold">Conectar ao Regem</h3>
              <p className="flex-1 text-[13.5px] text-farol-suave">
                Você autoriza no Regem, com a sua conta de lá, e as fichas chegam sozinhas — e se atualizam sozinhas.
              </p>
              {d.podeConectar ? (
                <Link href="/conexoes" className={`${classesDoBotao({ variante: 'primario' })} mt-1 self-start`}>
                  <Plug className="h-4 w-4" aria-hidden />
                  Conectar ao Regem
                </Link>
              ) : (
                <span className={`${AJUDA} mt-1`}>Só a diretoria conecta o Regem.</span>
              )}
            </section>
            <section className={`${CARTAO} flex flex-col gap-2 px-[18px] py-[18px]`} data-jeito="planilha">
              <FileSpreadsheet className="h-[22px] w-[22px] text-farol-marca" aria-hidden />
              <p className="text-xs font-medium uppercase tracking-wide text-farol-suave">para quem tem as fichas no Excel</p>
              <h3 className="font-display text-base font-semibold">Importar planilha</h3>
              <p className="flex-1 text-[13.5px] text-farol-suave">
                Baixe o modelo, preencha uma linha por ingrediente e envie. Para mudar depois, é importar de novo.
              </p>
              {podeImportar ? (
                <Botao variante="primario" className="mt-1 self-start" onClick={() => setImportando(true)}>
                  <Upload className="h-4 w-4" aria-hidden />
                  Importar planilha
                </Botao>
              ) : (
                <span className={`${AJUDA} mt-1`}>Quem importa é quem configura a loja.</span>
              )}
            </section>
            <section className={`${CARTAO} flex flex-col gap-2 px-[18px] py-[18px]`} data-jeito="sistema">
              <Server className="h-[22px] w-[22px] text-farol-marca" aria-hidden />
              <p className="text-xs font-medium uppercase tracking-wide text-farol-suave">para quem usa outro sistema</p>
              <h3 className="font-display text-base font-semibold">Receber de outro sistema</h3>
              <p className="flex-1 text-[13.5px] text-farol-suave">
                O sistema da loja envia as fichas para o Farol. Você cria o acesso e entrega a quem cuida dele, com a documentação.
              </p>
              {d.podeConectar ? (
                <Link href="/conexoes" className={`${classesDoBotao({ variante: 'primario' })} mt-1 self-start`}>
                  <KeyRound className="h-4 w-4" aria-hidden />
                  Criar acesso em Conexões
                </Link>
              ) : (
                <span className={`${AJUDA} mt-1`}>Só a diretoria cria o acesso.</span>
              )}
            </section>
          </div>
        </>
      )}

      {d && !falha && semRegem && sistema && d.fonte === null && (
        // O acesso existe e o sistema ainda não enviou nada: não há o que fazer no Farol.
        <Vazio
          icone={Server}
          titulo={`O ${sistema.nome} ainda não enviou as fichas`}
          acao={
            d.podeConectar ? (
              <Link href="/conexoes" className={classesDoBotao()}>
                <Plug className="h-4 w-4" aria-hidden />
                Ver o acesso em Conexões
              </Link>
            ) : undefined
          }
        >
          O acesso dele a esta loja foi criado {diaFaladoNaLoja(sistema.criadoEm, fuso).replace(', ', ', às ')}. Assim que o sistema enviar, as fichas aparecem aqui —
          sem ninguém precisar fazer nada no Farol.
        </Vazio>
      )}

      {d && !falha && d.situacao === 'falta_ligar' && !daPlanilha && !sistema && (
        <Vazio
          icone={Plug}
          titulo="Falta ligar esta loja ao Regem"
          acao={
            d.podeConectar ? (
              <Link href="/conexoes" className={classesDoBotao({ variante: 'primario' })}>
                Ligar as lojas
              </Link>
            ) : (
              <span className={AJUDA}>Quem liga as lojas é a diretoria.</span>
            )
          }
        >
          O Regem já autorizou. Falta dizer qual loja de lá é a {nomeDaLoja}; feito isso, o Farol busca as fichas na hora.
        </Vazio>
      )}

      {d && !falha && d.situacao === 'acesso_tirado' && (
        <Vazio
          icone={TriangleAlert}
          titulo="O acesso desta loja foi tirado no Regem"
          acao={
            d.podeConectar ? (
              <Link href="/conexoes" className={classesDoBotao({ variante: 'primario' })}>
                <Plug className="h-4 w-4" aria-hidden />
                Conectar de novo
              </Link>
            ) : (
              <span className={AJUDA}>Só a diretoria conecta o Regem.</span>
            )
          }
        >
          Foi {diaFaladoNaLoja(d.leitura?.acessoTiradoEm ?? null, fuso).replace(', ', ', às ')}. Sem o acesso, o Farol apagou as
          fichas que tinha de lá. Para tê-las de volta, é conectar de novo.
        </Vazio>
      )}

      {d && !falha && (d.situacao === 'ligada' || daPlanilha || doSistema) && (
        <>
          {erroDaBusca && (
            <Alerta tom="critico" icone={TriangleAlert} papel="alert">
              {erroDaBusca}
            </Alerta>
          )}

          {esperaOSistema && sistema && (
            <Alerta icone={Info} papel="status">
              <span data-espera-o-sistema>
                <b className="font-semibold text-farol-tinta">Esta loja ganhou um acesso para o {sistema.nome}.</b> As fichas da planilha ficam até ele enviar as
                dele; aí as do sistema entram no lugar.
              </span>
            </Alerta>
          )}

          {doSistema && sistema && d.importacao && d.importacao.problemas > 0 && (
            // O que ficou de fora do último envio — a mesma regra da planilha: entra o que está certo.
            <Alerta tom="atencao" icone={Info} papel="status">
              <span data-ficaram-de-fora>
                <b className="font-semibold">
                  {d.importacao.deFora > 0
                    ? plural(d.importacao.deFora, `produto que o ${sistema.nome} enviou ficou de fora`, `produtos que o ${sistema.nome} enviou ficaram de fora`)
                    : plural(d.importacao.problemas, `item que o ${sistema.nome} enviou ficou de fora`, `itens que o ${sistema.nome} enviou ficaram de fora`)}
                </b>{' '}
                no envio de {diaFaladoNaLoja(d.importacao.em, fuso)}
                {d.importacao.quais.length > 0 &&
                  `: ${d.importacao.quais.join(', ')}${d.importacao.deFora > d.importacao.quais.length ? ` e mais ${numero(d.importacao.deFora - d.importacao.quais.length)}` : ''}`}
                .{!podeBuscar && ' Quem configura a loja vê o motivo de cada um.'}
              </span>
              {podeBuscar && (
                <div className="mt-2">
                  <Botao mini onClick={() => setVendoDeFora(true)}>
                    Ver o que ficou de fora
                  </Botao>
                </div>
              )}
            </Alerta>
          )}

          {esperaORegem &&
            d.situacao === 'ligada' &&
            (d.leitura?.falhou ? (
              <Alerta tom="critico" icone={TriangleAlert} papel="status">
                <span data-espera-o-regem="falhou">
                  <b className="font-semibold">O Farol ainda não conseguiu ler o Regem desta loja.</b> As fichas abaixo são as da planilha: elas ficam até a busca
                  no Regem dar certo. Ele tenta de novo sozinho{podeBuscar ? '; para tentar já, use “Buscar agora”.' : '.'}
                </span>
              </Alerta>
            ) : (
              <Alerta icone={Info} papel="status">
                <span data-espera-o-regem="buscando">
                  <b className="font-semibold text-farol-tinta">Esta loja foi ligada ao Regem.</b> As fichas da planilha ficam até a busca no Regem terminar; aí
                  as do Regem entram no lugar.
                </span>
              </Alerta>
            ))}

          {daPlanilha && !esperaOutra && d.importacao && d.importacao.problemas > 0 && (
            // O que ficou de fora continua à mão depois de importar — com o motivo, para quem importa.
            <Alerta tom="atencao" icone={Info} papel="status">
              <span data-ficaram-de-fora>
                <b className="font-semibold">
                  {d.importacao.deFora > 0
                    ? plural(d.importacao.deFora, 'produto da planilha ficou de fora', 'produtos da planilha ficaram de fora')
                    : plural(d.importacao.problemas, 'linha da planilha ficou de fora', 'linhas da planilha ficaram de fora')}
                </b>{' '}
                na importação de {diaFaladoNaLoja(d.importacao.em, fuso)}
                {d.importacao.quais.length > 0 &&
                  `: ${d.importacao.quais.join(', ')}${d.importacao.deFora > d.importacao.quais.length ? ` e mais ${numero(d.importacao.deFora - d.importacao.quais.length)}` : ''}`}
                .{!podeImportar && ' Quem importa a planilha vê o motivo de cada um.'}
              </span>
              {podeImportar && (
                // Em linha própria: ao lado da frase, o botão (mais alto) tira a frase da linha do ícone.
                <div className="mt-2">
                  <Botao mini onClick={() => setVendoDeFora(true)}>
                    Ver o que ficou de fora
                  </Botao>
                </div>
              )}
            </Alerta>
          )}

          {!temBase &&
            (d.leitura?.falhou ? (
              <Alerta tom="critico" icone={TriangleAlert} papel="status">
                <b className="font-semibold">O Farol ainda não conseguiu ler o Regem desta loja.</b> Ele tenta de novo sozinho
                {podeBuscar ? '; para tentar já, use “Buscar agora”.' : '.'}
              </Alerta>
            ) : (
              <div role="status" className={`${CARTAO} flex items-center gap-3 px-[18px] py-4`} data-buscando>
                <RefreshCw className="h-[18px] w-[18px] shrink-0 animate-spin text-farol-suave motion-reduce:animate-none" aria-hidden />
                <span>
                  <b className="font-semibold">Buscando as fichas no Regem…</b>{' '}
                  <span className="text-farol-suave">Costuma levar poucos segundos.</span>
                </span>
              </div>
            ))}

          {temBase && !daPlanilha && d.leitura?.falhou && (
            <Alerta tom="critico" icone={TriangleAlert} papel="status">
              <b className="font-semibold">O Farol não conseguiu ler o Regem na última busca.</b> As fichas abaixo são as da busca de{' '}
              {diaFaladoNaLoja(d.leitura.lidaEm, fuso)}. Ele tenta de novo sozinho{podeBuscar ? '; para tentar já, use “Buscar agora”.' : '.'}
            </Alerta>
          )}

          {temBase && d.fonte === 'regem' && n > 0 && comFicha === 0 && (
            <Alerta tom="atencao" icone={Info} papel="status">
              <b className="font-semibold">O Regem desta loja ainda não tem fichas técnicas.</b> Sem ficha, o Farol sabe o que a loja
              vende, mas não como cada produto é montado. As fichas se cadastram no Regem, em{' '}
              <b className="font-semibold">Estoque › Fichas técnicas</b>
              {podeBuscar ? '; depois, use “Buscar agora” para trazê-las.' : '; depois, elas chegam aqui na busca do dia seguinte.'}
            </Alerta>
          )}

          {temBase && d.fonte === 'regem' && n === 0 && (
            <Vazio icone={ClipboardList} titulo="O Regem desta loja ainda não tem produtos">
              Quando o cardápio for cadastrado no Regem, os produtos aparecem aqui na busca do dia seguinte
              {podeBuscar ? ' — ou na hora, com “Buscar agora”.' : '.'}
            </Vazio>
          )}

          {temBase && n > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <label htmlFor={idBusca} className="sr-only">
                  Buscar produto
                </label>
                <input
                  id={idBusca}
                  type="search"
                  className="entrada min-w-0 flex-[1_1_220px]"
                  placeholder="Buscar produto ou categoria"
                  autoComplete="off"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                <Segmentado
                  rotulo="Quais produtos"
                  valor={filtro}
                  aoMudar={setFiltro}
                  opcoes={[
                    { valor: 'todos', rotulo: `Todos ${numero(n)}` },
                    { valor: 'com', rotulo: `Com ficha ${numero(comFicha)}` },
                    { valor: 'sem', rotulo: `Sem ficha ${numero(n - comFicha)}` },
                  ]}
                />
              </div>

              {lista.length === 0 ? (
                <Vazio
                  icone={ClipboardList}
                  titulo="Nenhum produto com esse filtro"
                  acao={
                    <Botao
                      onClick={() => {
                        setBusca('');
                        setFiltro('todos');
                      }}
                    >
                      Ver todos
                    </Botao>
                  }
                >
                  Mude a busca ou volte a ver todos.
                </Vazio>
              ) : (
                <div className={CARTAO}>
                  <div
                    aria-hidden
                    className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_auto] gap-x-3 border-b border-farol-borda px-[18px] py-2.5 text-xs font-semibold text-farol-suave md:grid"
                  >
                    <span>Produto</span>
                    <span>Cozinha</span>
                    <span>O que o Farol sabe dele</span>
                    <span className="w-4" />
                  </div>
                  <ul aria-label="Produtos da loja" data-produtos>
                    {lista.map((p) => (
                      <Linha key={p.id} p={p} aoAbrir={() => setAberto(p)} />
                    ))}
                  </ul>
                </div>
              )}

              <p className={`${AJUDA} flex items-start gap-1.5`}>
                <Lock className="mt-px h-[13px] w-[13px] shrink-0" aria-hidden />
                {esperaORegem
                  ? 'Aqui não se edita: estas fichas vieram da planilha, e saem quando as do Regem chegarem.'
                  : esperaOSistema && sistema
                    ? `Aqui não se edita: estas fichas vieram da planilha, e saem quando as do ${sistema.nome} chegarem.`
                    : daPlanilha
                      ? 'Aqui não se edita: para mudar, corrija a planilha e importe de novo. A importação troca todas as fichas da loja.'
                      : doSistema && sistema
                        ? `Aqui não se edita: as fichas são do ${sistema.nome}, que as envia quando mudam. O Farol não recebe preço, custo, nem quem é o cliente.`
                        : 'Aqui não se edita: as fichas são do Regem. O Farol não recebe preço, custo, nem quem é o cliente.'}
              </p>
            </>
          )}
        </>
      )}

      {aberto && (
        <Folha
          lojaId={id}
          resumo={aberto}
          podeBuscar={podeBuscar}
          origem={origem}
          espera={esperaORegem ? 'regem' : esperaOSistema && sistema ? sistema.nome : null}
          aoFechar={() => setAberto(null)}
        />
      )}
      {importando && <ImportarPlanilha lojaId={id} lojaNome={nomeDaLoja} aoFechar={() => setImportando(false)} aoImportar={importou} />}
      {vendoDeFora && <GavetaDeFora lojaId={id} fuso={fuso} aoFechar={() => setVendoDeFora(false)} />}
    </>
  );
}
