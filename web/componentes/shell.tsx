'use client';

// =====================================================================
// A moldura do console
// =====================================================================
// Uma navegação só, que muda de forma: coluna à esquerda no computador,
// trilho no tablet, barra embaixo no celular. A LOJA é o contexto — fica
// no topo, e as seções são dela: Painel, Canais, Critérios, Alertas e
// Orçamento.
//
// A moldura não rola; quem rola é o conteúdo. Assim a navegação e o
// estado do agente ficam sempre à vista.
//
// Ela também é quem descobre quem está logado — e é aqui que a sessão é
// de fato verificada: o middleware só viu que existe um cookie, a API é
// que diz se ele vale. Expirou ou foi revogado, cai num 401 e volta para
// a entrada.
// =====================================================================

import {
  BellRing,
  Building2,
  Calculator,
  Cctv,
  ChevronsUpDown,
  ChartColumn,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  Store,
  Sun,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { api, consoleApi, ErroDaApi, resultadosApi, type Eu, type LojaResumo } from '@/lib/api';

import {
  ContextoDoConsole,
  haQuanto,
  iniciais,
  nomeDoNivel,
  podeConfigurar,
  podeVerResultados,
  saudeDaLoja,
  type Console,
  type Saude,
} from './console';
import { Palavra, Selo } from './marca';
import { Alerta, Ossos, Ponto } from './ui/pecas';
import { DivisorDeMenu, ITEM_DE_MENU, Menu, RotuloDeMenu } from './ui/sobreposto';

const UUID_DA_LOJA = /^\/lojas\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const SECOES = ['analises', 'canais', 'regras', 'alertas', 'orcamento'] as const;
/** De quanto em quanto tempo a moldura pergunta como vai o agente. */
const BATIDA_MS = 30_000;

type Item = { href: string; rotulo: string; icone: LucideIcon; conta?: number | null };

// ───────────────────────── o tema ─────────────────────────

function useTema() {
  const [escuro, setEscuro] = useState(false);

  useEffect(() => {
    const sistema = matchMedia('(prefers-color-scheme: dark)');
    const ler = () => {
      const escolhido = document.documentElement.dataset.tema;
      setEscuro(escolhido ? escolhido === 'escuro' : sistema.matches);
    };
    ler();
    sistema.addEventListener('change', ler);
    return () => sistema.removeEventListener('change', ler);
  }, []);

  const trocar = useCallback(() => {
    setEscuro((era) => {
      const novo = era ? 'claro' : 'escuro';
      document.documentElement.dataset.tema = novo;
      // Preferência de quem olha, não dado da loja: fica no navegador.
      try {
        localStorage.setItem('farol-tema', novo);
      } catch {
        // Navegação privada, armazenamento bloqueado: o tema vale até fechar a aba.
      }
      return !era;
    });
  }, []);

  return { escuro, trocar };
}

// ───────────────────────── a navegação ─────────────────────────

/**
 * Os itens, com um realce que DESLIZA até o item atual. O movimento
 * mostra de onde se veio e para onde se foi — não é enfeite.
 */
function Navegacao({ itens, atual, deitada }: { itens: Item[]; atual: string | null; deitada: boolean }) {
  const caixa = useRef<HTMLElement>(null);
  const [realce, setRealce] = useState<CSSProperties>({ opacity: 0 });

  const medir = useCallback(() => {
    const el = caixa.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!el || el.offsetParent === null) {
      setRealce((r) => ({ ...r, opacity: 0 }));
      return;
    }
    setRealce(
      deitada
        ? { opacity: 1, width: el.offsetWidth, transform: `translateX(${el.offsetLeft}px)` }
        : { opacity: 1, height: el.offsetHeight, transform: `translateY(${el.offsetTop}px)` },
    );
  }, [deitada]);

  useLayoutEffect(medir, [medir, atual, itens.length]);

  useEffect(() => {
    if (!caixa.current) return;
    // A fonte chega depois do primeiro desenho e muda o tamanho dos itens.
    const o = new ResizeObserver(medir);
    o.observe(caixa.current);
    return () => o.disconnect();
  }, [medir]);

  return (
    <nav
      ref={caixa}
      aria-label="Seções"
      className={
        deitada
          ? 'relative grid auto-cols-fr grid-flow-col border-t border-farol-borda bg-farol-painel px-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] pt-1.5 md:hidden'
          : 'relative flex flex-col gap-0.5'
      }
    >
      <span
        aria-hidden
        style={realce}
        className={
          'pointer-events-none absolute transition-[transform,width,height,opacity] duration-300 ease-farol ' +
          (deitada
            ? 'left-0 top-1.5 h-[50px] rounded-xl bg-farol-realce'
            : 'inset-x-0 top-0 rounded-[10px] border border-farol-borda bg-farol-painel shadow-farol-1')
        }
      />
      {itens.map((i) => {
        const aqui = i.href === atual;
        const Icone = i.icone;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={aqui ? 'page' : undefined}
            className={
              'relative flex items-center no-underline transition-colors ' +
              (aqui ? 'font-semibold text-farol-tinta ' : 'font-medium text-farol-suave hover:text-farol-tinta ') +
              (deitada
                ? 'min-h-[50px] flex-col justify-center gap-0.5 rounded-xl text-[11px]'
                : 'h-14 flex-col justify-center gap-[3px] rounded-[10px] px-0.5 text-center text-[11px] ' +
                  'lg:h-10 lg:flex-row lg:justify-start lg:gap-[11px] lg:px-[11px] lg:text-left lg:text-sm')
            }
          >
            <Icone
              className={`shrink-0 ${deitada ? 'h-[22px] w-[22px]' : 'h-[18px] w-[18px]'} ${aqui ? 'text-farol-facho-icone' : ''}`}
              aria-hidden
            />
            <span>{i.rotulo}</span>
            {!!i.conta && (
              <span
                className={
                  'rounded-full text-center font-semibold ' +
                  (deitada
                    ? 'absolute left-[calc(50%+6px)] top-1 min-w-4 bg-farol-critico px-1 text-[10.5px] leading-4 text-farol-sobre-critico'
                    : 'absolute right-2.5 top-[5px] min-w-4 bg-farol-critico-leve px-1 text-[10.5px] leading-4 text-farol-critico ' +
                      'lg:static lg:ml-auto lg:min-w-5 lg:px-1.5 lg:text-[11.5px] lg:leading-5')
                }
              >
                <span className="sr-only">sinais de atenção: </span>
                {i.conta}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// ───────────────────────── trocar de loja ─────────────────────────

function TrocaDeLoja({
  lojas,
  loja,
  compacta,
}: {
  lojas: LojaResumo[] | null;
  loja: LojaResumo | null;
  /** No topo do celular: só o nome, sem a segunda linha. */
  compacta?: boolean;
}) {
  return (
    <Menu
      gatilho={(p) => (
        <button
          type="button"
          {...p}
          className={
            'flex min-w-0 items-center gap-2.5 rounded-[10px] border border-farol-borda bg-farol-painel text-left ' +
            'transition-colors hover:border-farol-borda-forte ' +
            (compacta ? 'flex-1 px-2.5 py-1.5' : 'w-full justify-center px-0 py-[9px] lg:justify-start lg:px-2.5 lg:py-2')
          }
        >
          <Store className="h-[18px] w-[18px] shrink-0 text-farol-suave" aria-hidden />
          <span className={`min-w-0 flex-1 ${compacta ? '' : 'hidden lg:block'}`}>
            <b className="block truncate font-semibold">{loja?.nome ?? 'Todas as lojas'}</b>
            {!compacta && (
              <small className="block text-xs leading-tight text-farol-suave">
                {loja ? 'trocar de loja' : 'escolha uma para entrar'}
              </small>
            )}
          </span>
          <ChevronsUpDown className={`h-[15px] w-[15px] shrink-0 text-farol-suave ${compacta ? '' : 'hidden lg:block'}`} aria-hidden />
          <span className="sr-only">Trocar de loja</span>
        </button>
      )}
    >
      {(fechar) => (
        <>
          <RotuloDeMenu>Lojas</RotuloDeMenu>
          {(lojas ?? []).map((l) => (
            <Link key={l.id} href={`/lojas/${l.id}`} role="menuitem" onClick={fechar} className={ITEM_DE_MENU}>
              <Store className="h-[18px] w-[18px] shrink-0" aria-hidden />
              <span className={`min-w-0 flex-1 truncate ${l.id === loja?.id ? 'font-semibold' : ''}`}>{l.nome}</span>
              {l.id === loja?.id && <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-farol-facho" />}
            </Link>
          ))}
          <DivisorDeMenu />
          <Link href="/lojas" role="menuitem" onClick={fechar} className={ITEM_DE_MENU}>
            <Building2 className="h-[18px] w-[18px] shrink-0" aria-hidden />
            Todas as lojas
          </Link>
        </>
      )}
    </Menu>
  );
}

// ───────────────────────── a conta ─────────────────────────

function Conta({ eu, escuro, trocarTema, sair }: { eu: Eu; escuro: boolean; trocarTema: () => void; sair: () => void }) {
  return (
    <Menu
      alinhar="fim"
      gatilho={(p) => (
        <button
          type="button"
          {...p}
          aria-label={`Conta de ${eu.nome}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-farol-marca text-[12.5px] font-semibold text-farol-sobre-marca"
        >
          {iniciais(eu.nome)}
        </button>
      )}
    >
      {(fechar) => (
        <>
          <RotuloDeMenu>
            {eu.nome} · {nomeDoNivel(eu.nivel)}
          </RotuloDeMenu>
          <button
            type="button"
            role="menuitem"
            className={ITEM_DE_MENU}
            onClick={() => {
              trocarTema();
              fechar();
            }}
          >
            {escuro ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
            {escuro ? 'Usar o tema claro' : 'Usar o tema escuro'}
          </button>
          <DivisorDeMenu />
          <button
            type="button"
            role="menuitem"
            className={ITEM_DE_MENU}
            onClick={() => {
              fechar();
              sair();
            }}
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
            Sair
          </button>
        </>
      )}
    </Menu>
  );
}

function tomDaSaude(s: Saude | null): 'ok' | 'critico' | 'neutro' {
  if (!s) return 'neutro';
  return s.estado === 'ativo' ? 'ok' : s.estado === 'fora' ? 'critico' : 'neutro';
}

// ───────────────────────── a moldura ─────────────────────────

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const { escuro, trocar: trocarTema } = useTema();

  const [eu, setEu] = useState<Eu | null>(null);
  const [lojas, setLojas] = useState<LojaResumo[] | null>(null);
  const [lojaDaPagina, setLojaDaPagina] = useState<string | null>(null);
  const [sinais, setSinais] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Em qual loja se está. O endereço diz na maior parte das telas; na de
  // um canal (`/pontos/…`) não diz, e a própria tela avisa.
  const noCanal = caminho.startsWith('/pontos/');
  const lojaId = UUID_DA_LOJA.exec(caminho)?.[1] ?? (noCanal ? lojaDaPagina : null);
  const loja = useMemo(() => lojas?.find((l) => l.id === lojaId) ?? null, [lojas, lojaId]);
  const saude = loja ? saudeDaLoja(loja) : null;

  const veResultados = eu ? podeVerResultados(eu) : false;
  const configura = eu ? podeConfigurar(eu) : false;

  useEffect(() => {
    api
      .eu()
      .then(setEu)
      .catch((e) => {
        if (e instanceof ErroDaApi && e.status === 401) router.replace('/entrar');
        else setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      });
  }, [router]);

  const buscarLojas = useCallback(() => {
    consoleApi
      .lojas()
      .then((r) => setLojas(r.lojas))
      .catch((e) => {
        if (e instanceof ErroDaApi && e.status === 401) router.replace('/entrar');
        // Falha de rede numa batida não derruba a tela: fica o que já se sabia.
      });
  }, [router]);

  // As lojas vêm com o estado do agente de cada uma. Perguntar de novo de
  // tempos em tempos é o que faz o ponto verde ser verdade — mas só com a
  // aba à vista: console esquecido aberto não fica batendo no servidor.
  useEffect(() => {
    if (!eu) return;
    buscarLojas();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') buscarLojas();
    }, BATIDA_MS);
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') buscarLojas();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [eu, buscarLojas]);

  // Quantos sinais de defeito a loja tem: o número ao lado de "Painel".
  // O mesmo pedido serve ao painel (ver `resultadosApi`).
  useEffect(() => {
    setSinais(null);
    if (!lojaId || !veResultados) return;
    let vivo = true;
    resultadosApi
      .obter(lojaId, '24h')
      .then((r) => vivo && setSinais(r.sinais.length))
      .catch(() => vivo && setSinais(null));
    return () => {
      vivo = false;
    };
  }, [lojaId, veResultados, caminho]);

  useEffect(() => {
    if (!noCanal) setLojaDaPagina(null);
  }, [noCanal]);

  const sair = useCallback(async () => {
    await api.sair().catch(() => {});
    router.replace('/entrar');
  }, [router]);

  const itens: Item[] = useMemo(() => {
    if (!lojaId) return [{ href: '/lojas', rotulo: 'Lojas', icone: Building2 }];
    const base = `/lojas/${lojaId}`;
    return [
      { href: base, rotulo: 'Painel', icone: LayoutDashboard, conta: sinais },
      // As análises são números de gestão: só para quem vê os resultados.
      ...(veResultados ? [{ href: `${base}/analises`, rotulo: 'Análises', icone: ChartColumn }] : []),
      { href: `${base}/canais`, rotulo: 'Canais', icone: Cctv },
      { href: `${base}/regras`, rotulo: 'Critérios', icone: ListChecks },
      { href: `${base}/alertas`, rotulo: 'Alertas', icone: BellRing },
      // Orçamento é decisão de compra: só para quem configura.
      ...(configura ? [{ href: `${base}/orcamento`, rotulo: 'Orçamento', icone: Calculator }] : []),
    ];
  }, [lojaId, sinais, configura, veResultados]);

  const atual = useMemo(() => {
    if (!lojaId) return caminho.startsWith('/lojas') ? '/lojas' : null;
    const base = `/lojas/${lojaId}`;
    if (noCanal) return `${base}/canais`;
    for (const s of SECOES) if (caminho.startsWith(`${base}/${s}`)) return `${base}/${s}`;
    return caminho === base ? base : null;
  }, [caminho, lojaId, noCanal]);

  const contexto: Console | null = useMemo(
    () =>
      eu
        ? {
            eu,
            configura,
            veResultados,
            lojas,
            lojaId,
            loja,
            saude,
            sinais,
            definirLoja: setLojaDaPagina,
            atualizar: buscarLojas,
          }
        : null,
    // `saude` sai de `loja`; não precisa entrar na lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eu, configura, veResultados, lojas, lojaId, loja, sinais, buscarLojas],
  );

  if (erro) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      </main>
    );
  }

  const tom = tomDaSaude(saude);

  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] md:grid-cols-[78px_minmax(0,1fr)] md:grid-rows-1 lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#conteudo"
        className="absolute left-3 top-[-60px] z-[90] rounded-[10px] bg-farol-marca px-3 py-2 text-farol-sobre-marca transition-[top] focus:top-3"
      >
        Pular para o conteúdo
      </a>

      {/* ───────────── computador e tablet: a coluna ───────────── */}
      <aside
        aria-label="Navegação"
        className="hidden min-h-0 flex-col gap-3 overflow-y-auto border-r border-farol-borda px-2 py-3.5 md:flex lg:gap-3.5 lg:px-3 lg:pb-3.5 lg:pt-[18px] [&>*]:shrink-0"
      >
        <Link href={lojaId ? `/lojas/${lojaId}` : '/lojas'} className="flex justify-center px-0 pb-1 pt-0.5 text-farol-marca lg:justify-start lg:px-2 lg:pb-1.5" aria-label="Farol — início">
          <Palavra className="hidden h-7 w-auto lg:block" vivo={saude?.estado === 'ativo'} />
          <Selo className="h-[30px] w-[30px] lg:hidden" vivo={saude?.estado === 'ativo'} />
        </Link>

        <TrocaDeLoja lojas={lojas} loja={loja} />

        {eu ? <Navegacao itens={itens} atual={atual} deitada={false} /> : <Ossos alturas={[40, 40, 40]} />}

        <div className="!shrink min-h-3 flex-1" />

        {saude && (
          <div
            className="flex items-start justify-center gap-2.5 rounded-[10px] border border-farol-borda bg-farol-painel-2 px-0 py-2.5 text-[12.5px] leading-snug lg:justify-start lg:px-2.5"
            title={`${saude.titulo} — ${saude.detalhe}`}
          >
            <span className="lg:mt-[5px]">
              <Ponto tom={tom} pulsa={saude.estado === 'ativo'} />
            </span>
            <div className="hidden min-w-0 lg:block">
              <b className="block text-[13px] font-semibold">{saude.titulo}</b>
              <span className="text-farol-suave">{saude.detalhe}</span>
            </div>
            <span className="sr-only lg:hidden">
              {saude.titulo}, {saude.detalhe}
            </span>
          </div>
        )}

        {eu && (
          <div className="flex items-center justify-center gap-2.5 lg:justify-start lg:px-1.5 lg:py-1">
            <Conta eu={eu} escuro={escuro} trocarTema={trocarTema} sair={sair} />
            <span className="hidden min-w-0 flex-1 leading-tight lg:block">
              <b className="block truncate font-semibold">{eu.nome}</b>
              <small className="text-xs text-farol-suave">{nomeDoNivel(eu.nivel)}</small>
            </span>
            <button
              type="button"
              onClick={trocarTema}
              aria-label={escuro ? 'Usar o tema claro' : 'Usar o tema escuro'}
              className="hidden h-8 w-8 place-items-center rounded-[10px] text-farol-suave transition-colors hover:bg-farol-realce hover:text-farol-tinta lg:grid"
            >
              {escuro ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
            </button>
          </div>
        )}
      </aside>

      {/* ───────────── celular: o topo ───────────── */}
      <header className="flex items-center gap-2.5 border-b border-farol-borda bg-farol-fundo px-3 py-2 md:hidden">
        <Link href={lojaId ? `/lojas/${lojaId}` : '/lojas'} className="shrink-0 text-farol-marca" aria-label="Farol — início">
          <Selo className="h-[30px] w-[30px]" vivo={saude?.estado === 'ativo'} />
        </Link>
        <TrocaDeLoja lojas={lojas} loja={loja} compacta />
        {saude && (
          <span role="img" aria-label={`${saude.titulo}, ${saude.detalhe}`} title={`${saude.titulo} — ${saude.detalhe}`}>
            <Ponto tom={tom} pulsa={saude.estado === 'ativo'} />
          </span>
        )}
        {eu && <Conta eu={eu} escuro={escuro} trocarTema={trocarTema} sair={sair} />}
      </header>

      {/* ───────────── o conteúdo: é ele que rola ───────────── */}
      <main id="conteudo" tabIndex={-1} className="min-h-0 min-w-0 overflow-y-auto focus:outline-none focus-visible:ring-0">
        {saude?.estado === 'fora' && loja && loja.segundos_sem_bater !== null && (
          <div className="mx-auto max-w-[1180px] px-4 pt-4 md:px-[clamp(16px,3.2vw,36px)]">
            <Alerta tom="critico" icone={Unplug} papel="alert">
              <b className="font-semibold">
                O agente desta loja está sem sinal {haQuanto(loja.segundos_sem_bater)}.
              </b>{' '}
              Enquanto ele estiver fora, nenhuma câmera é verificada. Confira se o computador da loja está ligado e
              com internet.
            </Alerta>
          </div>
        )}
        {/* A chave refaz a entrada a cada tela: os blocos sobem em sequência. */}
        <div
          key={caminho}
          className="entra mx-auto flex max-w-[1180px] flex-col gap-5 px-4 pb-10 pt-[18px] md:gap-6 md:px-[clamp(16px,3.2vw,36px)] md:pb-14 md:pt-7"
        >
          {contexto ? (
            <ContextoDoConsole.Provider value={contexto}>{children}</ContextoDoConsole.Provider>
          ) : (
            <Ossos alturas={[64, [96, 96, 96, 96], 220]} />
          )}
        </div>
      </main>

      {/* ───────────── celular: a barra de baixo ───────────── */}
      {eu && <Navegacao itens={itens} atual={atual} deitada />}
    </div>
  );
}
