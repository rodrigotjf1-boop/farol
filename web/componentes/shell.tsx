'use client';

// =====================================================================
// A moldura do console: o caminho "Comanda" (23/10/2026)
// =====================================================================
// O dono escolheu, entre três caminhos, o da cozinha. As seções da loja
// são COMANDAS penduradas num trilho, no topo: a de agora desce e
// escurece; as outras balançam quando se troca de tela. O trilho mede
// quantas cabem — o que não cabe vai para o ESPETO, ao lado (o mesmo
// espeto onde a cozinha espeta a comanda pronta). Não há mais coluna à
// esquerda nem barra embaixo: a mesma moldura serve do celular ao monitor.
//
// A LOJA é o contexto: o nome dela, grande, é o botão de trocar de loja; a
// linha de baixo diz como vai o computador da loja e leva à tela dele.
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
  ChevronDown,
  ChartColumn,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Plug,
  Search,
  Store,
  Sun,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

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
import { IrPara } from './ir-para';
import { Selo } from './marca';
import { Alerta, Ossos, Ponto } from './ui/pecas';
import { DivisorDeMenu, ITEM_DE_MENU, Menu, RotuloDeMenu } from './ui/sobreposto';

const UUID_DA_LOJA = /^\/lojas\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const SECOES = ['analises', 'canais', 'regras', 'fichas', 'treinamento', 'alertas', 'orcamento', 'computador'] as const;
/** De quanto em quanto tempo a moldura pergunta como vai o agente. */
const BATIDA_MS = 30_000;
/** O espaço entre duas comandas no trilho, em px (o `gap-2.5` da fila). */
const VAO = 10;

type Item = {
  href: string;
  rotulo: string;
  /** A linha pequena da comanda: o que se resolve naquela tela, em poucas letras. */
  sobre: string;
  icone: LucideIcon;
  conta?: number | null;
};

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

// ───────────────────────── uma comanda ─────────────────────────

/** Quantos sinais pedem atenção: bolinha vermelha com o algarismo em letra mono — na letra estreita do título o "1"
 *  parecia um "I", e o vermelho solto sobre a comanda escura ficava com contraste de 2,85:1 (na bolinha: 5,6 e 6,6:1). */
function Sinais({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span
      className={`grid h-[18px] min-w-[18px] place-items-center rounded-full bg-farol-critico px-1 font-mono text-[11px] font-bold leading-none text-farol-sobre-critico ${className}`}
    >
      <span className="sr-only">sinais de atenção: </span>
      {n}
    </span>
  );
}

function Comanda({ item, aqui, medida }: { item: Item; aqui: boolean; medida?: boolean }) {
  const conteudo = (
    <>
      {!!item.conta && <Sinais n={item.conta} className="absolute right-[6px] top-[6px]" />}
      <b
        className={`block whitespace-nowrap font-display text-[18px] font-extrabold uppercase leading-none tracking-[.02em] ${item.conta ? 'pr-6' : 'pr-3'}`}
      >
        {item.rotulo}
      </b>
      {/* Na comanda de agora o fundo é a cor da marca, que é clara na chapa: o subtítulo usa o texto da própria marca,
          apagado (7,6:1 no papel, 6,4:1 na chapa). O cinza do palco dava 1,9:1 na chapa. */}
      <small className={`mt-1 block whitespace-nowrap font-mono text-[10px] leading-tight ${aqui ? 'text-farol-sobre-marca/70' : 'text-farol-suave'}`}>
        {item.sobre}
      </small>
    </>
  );
  // A cópia que só serve para MEDIR a largura (o trilho decide quantas cabem) não é link nem leva foco.
  if (medida) {
    return (
      <span className="cmd-pendurada">
        <span className="cmd-comanda">{conteudo}</span>
      </span>
    );
  }
  return (
    <span className="cmd-pendurada">
      <span className="cmd-grampo" aria-hidden />
      <Link href={item.href} aria-current={aqui ? 'page' : undefined} data-comanda={item.href} className="cmd-comanda">
        {conteudo}
      </Link>
    </span>
  );
}

// ───────────────────────── o trilho e o espeto ─────────────────────────

/**
 * As comandas que cabem no trilho, na ordem; a de agora sempre fica (se não coube, toma o lugar da última). O resto
 * vai para o espeto. A conta é feita com cópias invisíveis de TODAS as comandas, medidas a cada mudança de largura
 * e quando a fonte chega (ela muda o tamanho das letras).
 */
function useQuantasCabem(itens: Item[], atual: string | null, pronto: boolean) {
  const trilho = useRef<HTMLElement>(null);
  const medidas = useRef<HTMLDivElement>(null);
  const [cabem, setCabem] = useState(itens.length);

  const medir = useCallback(() => {
    const caixa = trilho.current;
    const copias = medidas.current ? [...medidas.current.children] : [];
    if (!caixa || copias.length !== itens.length) return;
    const livre = caixa.clientWidth - 8;
    let usado = 0;
    let n = 0;
    for (const c of copias) {
      const w = (c as HTMLElement).offsetWidth;
      if (usado + w > livre) break;
      usado += w + VAO;
      n += 1;
    }
    setCabem(Math.max(1, n));
  }, [itens.length]);

  // `pronto`: o trilho só existe depois que se sabe quem está logado — a conta e o observador esperam por ele.
  useLayoutEffect(medir, [medir, itens, pronto]);

  useEffect(() => {
    if (!pronto || !trilho.current) return;
    const o = new ResizeObserver(medir);
    o.observe(trilho.current);
    document.fonts?.ready.then(medir).catch(() => {});
    return () => o.disconnect();
  }, [medir, pronto]);

  const visiveis = useMemo(() => {
    const primeiras = itens.slice(0, cabem);
    if (!atual || primeiras.some((i) => i.href === atual)) return primeiras;
    const daVez = itens.find((i) => i.href === atual);
    return daVez ? [...primeiras.slice(0, Math.max(0, cabem - 1)), daVez] : primeiras;
  }, [itens, cabem, atual]);
  const sobra = useMemo(() => itens.filter((i) => !visiveis.includes(i)), [itens, visiveis]);

  return { trilho, medidas, visiveis, sobra };
}

function Espeto({ sobra, extras }: { sobra: Item[]; extras: Item[] }) {
  const tudo = [...sobra, ...extras];
  if (tudo.length === 0) return null;
  return (
    <Menu
      alinhar="fim"
      gatilho={(p) => (
        <button type="button" {...p} className="cmd-espeto mt-1 shrink-0" aria-label={`Mais telas (${tudo.length})`}>
          <span className="cmd-haste" aria-hidden />
          {/* Um papel espetado para cada tela que mora aqui (até seis), um pouco tortos, como na cozinha. */}
          {tudo.slice(0, 6).map((i, k) => (
            <span
              key={i.href}
              aria-hidden
              className="cmd-papel"
              style={{ bottom: 14 + k * 5, transform: `translateX(-50%) rotate(${(k % 2 ? 6 : -5) + k}deg)` }}
            />
          ))}
          <span className="cmd-base" aria-hidden />
          <span className="absolute -bottom-3.5 font-mono text-[9.5px] font-semibold tracking-[.08em] text-farol-suave">MAIS</span>
        </button>
      )}
    >
      {(fechar) => (
        <>
          <RotuloDeMenu>No espeto</RotuloDeMenu>
          {sobra.map((i) => {
            const Icone = i.icone;
            return (
              <Link key={i.href} href={i.href} role="menuitem" onClick={fechar} className={ITEM_DE_MENU}>
                <Icone className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[16px] font-extrabold uppercase leading-tight tracking-[.03em]">{i.rotulo}</span>
                  <small className="block text-xs text-farol-suave">{i.sobre}</small>
                </span>
                {/* `relative`: o texto só para leitor de tela fica preso à bolinha, dentro do menu (V36). */}
                {!!i.conta && <Sinais n={i.conta} className="relative" />}
              </Link>
            );
          })}
          {sobra.length > 0 && extras.length > 0 && <DivisorDeMenu />}
          {extras.map((i) => {
            const Icone = i.icone;
            return (
              <Link key={i.href} href={i.href} role="menuitem" onClick={fechar} className={ITEM_DE_MENU}>
                <Icone className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{i.rotulo}</span>
                  <small className="block text-xs text-farol-suave">{i.sobre}</small>
                </span>
              </Link>
            );
          })}
        </>
      )}
    </Menu>
  );
}

// ───────────────────────── trocar de loja ─────────────────────────

function TrocaDeLoja({ lojas, loja }: { lojas: LojaResumo[] | null; loja: LojaResumo | null }) {
  return (
    <Menu
      gatilho={(p) => (
        <button
          type="button"
          {...p}
          className="group flex min-w-0 max-w-full items-end gap-1.5 text-left"
          title={loja ? 'Trocar de loja' : 'Escolher uma loja'}
        >
          {/* O nome da loja, grande: é o contexto de todas as telas. */}
          <b className="min-w-0 truncate font-display text-[30px] font-black uppercase leading-[.86] tracking-[.005em] xl:text-[36px]">
            {loja?.nome ?? 'Todas as lojas'}
          </b>
          <ChevronDown
            className="mb-0.5 h-[18px] w-[18px] shrink-0 text-farol-suave transition-transform duration-300 ease-mola group-aria-expanded:rotate-180"
            aria-hidden
          />
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

function Conta({
  eu,
  escuro,
  conexoes,
  trocarTema,
  sair,
}: {
  eu: Eu;
  escuro: boolean;
  /** Quem configura a conta vê as conexões dela (também no espeto). */
  conexoes: boolean;
  trocarTema: () => void;
  sair: () => void;
}) {
  return (
    <Menu
      alinhar="fim"
      gatilho={(p) => (
        <button
          type="button"
          {...p}
          aria-label={`Conta de ${eu.nome}`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-farol-mostarda font-display text-[16px] font-extrabold text-farol-sobre-mostarda shadow-farol-1 transition-transform duration-300 ease-mola hover:scale-105"
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
          {conexoes && (
            <Link href="/conexoes" role="menuitem" onClick={fechar} className={ITEM_DE_MENU}>
              <Plug className="h-[18px] w-[18px] shrink-0" aria-hidden />
              Conexões
            </Link>
          )}
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
            {escuro ? 'Usar o papel (tema claro)' : 'Usar a chapa (tema escuro)'}
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

/** Os botões redondos da direita do topo: buscar e trocar o tema. */
const REDONDO =
  'grid h-11 w-11 shrink-0 place-items-center rounded-full bg-farol-painel text-farol-tinta shadow-farol-1 ' +
  'transition-transform duration-300 ease-mola hover:scale-105';

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
  /** A paleta "Ir para…" está aberta. */
  const [paleta, setPaleta] = useState(false);

  // Ctrl K (ou ⌘ K) abre a paleta de qualquer tela — e fecha, se ela já está aberta. Com uma gaveta ou um
  // diálogo aberto o atalho não faz nada: a tela de baixo está inerte, e a paleta não se empilha por cima.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      const aberto = document.querySelector('dialog[open]');
      if (aberto && !aberto.hasAttribute('data-paleta')) return;
      e.preventDefault();
      setPaleta((era) => !era);
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);

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

  // Quantos sinais de defeito a loja tem: o número na comanda do Painel.
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
    if (!lojaId) return [{ href: '/lojas', rotulo: 'Lojas', sobre: 'todas, ao vivo', icone: Building2 }];
    const base = `/lojas/${lojaId}`;
    return [
      { href: base, rotulo: 'Painel', sobre: 'o que o Farol viu', icone: LayoutDashboard, conta: sinais },
      { href: `${base}/alertas`, rotulo: 'Alertas', sobre: 'fora da regra', icone: BellRing },
      // O treinamento da bancada (A21): conferem a diretoria, a gerência e a supervisão — o mesmo grupo das fichas.
      ...(veResultados ? [{ href: `${base}/treinamento`, rotulo: 'Treinamento', sobre: 'conferir lanches', icone: GraduationCap }] : []),
      { href: `${base}/canais`, rotulo: 'Canais', sobre: 'as câmeras', icone: Cctv },
      { href: `${base}/regras`, rotulo: 'Critérios', sobre: 'o que observar', icone: ListChecks },
      // As fichas são de quem acompanha a loja — supervisão para cima e o suporte, o mesmo grupo
      // que vê os resultados (a API responde 403 aos outros).
      ...(veResultados ? [{ href: `${base}/fichas`, rotulo: 'Fichas', sobre: 'o cardápio', icone: ClipboardList }] : []),
      // As análises são números de gestão: só para quem vê os resultados.
      ...(veResultados ? [{ href: `${base}/analises`, rotulo: 'Análises', sobre: 'hora a hora', icone: ChartColumn }] : []),
      // Orçamento é decisão de compra: só para quem configura.
      ...(configura ? [{ href: `${base}/orcamento`, rotulo: 'Orçamento', sobre: 'o que falta', icone: Calculator }] : []),
    ];
  }, [lojaId, sinais, configura, veResultados]);

  // O que é da CONTA ou do computador, e não uma seção da loja: mora sempre no espeto, abaixo das comandas que
  // não couberam no trilho.
  const extras: Item[] = useMemo(
    () => [
      ...(lojaId && saude ? [{ href: `/lojas/${lojaId}/computador`, rotulo: 'Computador da loja', sobre: 'saúde e horário', icone: Monitor }] : []),
      ...(configura ? [{ href: '/conexoes', rotulo: 'Conexões', sobre: 'de onde vêm as fichas das lojas', icone: Plug }] : []),
    ],
    [lojaId, saude, configura],
  );

  const atual = useMemo(() => {
    if (!lojaId) return caminho.startsWith('/lojas') ? '/lojas' : null;
    const base = `/lojas/${lojaId}`;
    if (noCanal) return `${base}/canais`;
    for (const s of SECOES) if (caminho.startsWith(`${base}/${s}`)) return `${base}/${s}`;
    return caminho === base ? base : null;
  }, [caminho, lojaId, noCanal]);

  const { trilho, medidas, visiveis, sobra } = useQuantasCabem(itens, atual, eu !== null);

  // Trocou de tela: as outras comandas balançam no trilho (a de agora desce — ver `.cmd-comanda[aria-current]`).
  const antes = useRef(atual);
  useEffect(() => {
    if (antes.current === atual) return;
    antes.current = atual;
    trilho.current?.querySelectorAll<HTMLElement>('[data-comanda]').forEach((c) => {
      if (c.getAttribute('aria-current') === 'page') return;
      c.classList.remove('cmd-balanca');
      void c.offsetWidth;
      c.classList.add('cmd-balanca');
    });
  }, [atual, trilho]);

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
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]">
      <a
        href="#conteudo"
        className="absolute left-3 top-[-60px] z-[90] rounded-[10px] bg-farol-marca px-3 py-2 text-farol-sobre-marca transition-[top] focus:top-3"
      >
        Pular para o conteúdo
      </a>

      {/* ───────────── o topo: a loja, o trilho das comandas, o espeto e a conta ───────────── */}
      {/* Até 1024 px o trilho tem a linha de baixo inteira (na mesma linha da loja cabia uma comanda só, a 768). */}
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2 bg-farol-fundo px-[max(14px,env(safe-area-inset-left,0px))] pt-3 md:px-[clamp(16px,2.6vw,32px)] md:pt-3.5 lg:flex-nowrap">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 lg:max-w-[26%] lg:flex-none">
          <Link href={lojaId ? `/lojas/${lojaId}` : '/lojas'} className="mt-0.5 shrink-0 text-farol-tinta" aria-label="Farol — início">
            <Selo className="h-9 w-9" vivo={saude?.estado === 'ativo'} />
          </Link>
          <div className="min-w-0">
            <TrocaDeLoja lojas={lojas} loja={loja} />
            {/* O estado do computador da loja, numa linha de recibo: leva à tela dele (A22). */}
            {saude && lojaId ? (
              <Link
                href={`/lojas/${lojaId}/computador`}
                data-computador-da-loja
                aria-current={caminho === `/lojas/${lojaId}/computador` || caminho.startsWith(`/lojas/${lojaId}/computador/`) ? 'page' : undefined}
                title={`${saude.titulo} — ${saude.detalhe}`}
                className="mt-1.5 inline-flex max-w-full items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[.08em] text-farol-suave no-underline transition-colors hover:text-farol-tinta"
              >
                <Ponto tom={tom} pulsa={saude.estado === 'ativo'} />
                <span className="truncate">{saude.titulo}</span>
                <span className="sr-only">: {saude.detalhe}</span>
              </Link>
            ) : (
              <span className="mt-1.5 block font-mono text-[10.5px] uppercase tracking-[.08em] text-farol-suave">monitor da operação</span>
            )}
          </div>
        </div>

        {eu && (
          <div className="ml-auto flex shrink-0 items-start gap-2 pt-0.5 lg:order-last lg:ml-0">
            <button
              type="button"
              data-ir-para
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K"
              aria-label="Ir para… (Ctrl K)"
              title="Ir para… (Ctrl K)"
              onClick={() => setPaleta(true)}
              className={REDONDO}
            >
              <Search className="h-[19px] w-[19px]" aria-hidden />
            </button>
            <button type="button" onClick={trocarTema} aria-label={escuro ? 'Usar o papel (tema claro)' : 'Usar a chapa (tema escuro)'} className={`${REDONDO} max-sm:hidden`}>
              {escuro ? <Sun className="h-[19px] w-[19px]" aria-hidden /> : <Moon className="h-[19px] w-[19px]" aria-hidden />}
            </button>
            <Conta eu={eu} escuro={escuro} conexoes={configura} trocarTema={trocarTema} sair={sair} />
          </div>
        )}

        {/* O trilho ocupa o meio no computador e a linha de baixo inteira no tablet e no celular. */}
        <div className="flex min-w-0 basis-full items-start gap-1.5 lg:basis-auto lg:flex-1">
          {eu ? (
            <nav aria-label="Seções" ref={trilho} className="cmd-trilho relative min-w-0 flex-1">
              <div className="flex items-start gap-2.5 px-1 pb-4">
                {visiveis.map((i) => (
                  <Comanda key={i.href} item={i} aqui={i.href === atual} />
                ))}
              </div>
              {/* As cópias que medem: todas as comandas, fora de vista, para o trilho saber quantas cabem. Ficam numa
                  caixa de tamanho zero — soltas, a fila inteira passava da tela e a página rolava para o lado. */}
              <div aria-hidden className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
                <div ref={medidas} className="flex w-max gap-2.5">
                  {itens.map((i) => (
                    <Comanda key={i.href} item={i} aqui={false} medida />
                  ))}
                </div>
              </div>
            </nav>
          ) : (
            <div className="flex-1 pt-3">
              <Ossos alturas={[[56, 56, 56, 56]]} />
            </div>
          )}
          {eu && <Espeto sobra={sobra} extras={extras} />}
        </div>
      </header>

      {/* ───────────── o conteúdo: é ele que rola ───────────── */}
      <main id="conteudo" tabIndex={-1} className="min-h-0 min-w-0 overflow-y-auto focus:outline-none focus-visible:ring-0">
        {saude?.estado === 'fora' && loja && loja.segundos_sem_bater !== null && (
          <div className="mx-auto max-w-[1180px] px-4 pt-4 md:px-[clamp(16px,3.2vw,36px)]">
            <Alerta tom="critico" icone={Unplug} papel="alert">
              {loja.computador?.nao_acordou && loja.computador.acorda_as ? (
                <>
                  <b className="font-semibold">O computador da loja não acordou às {loja.computador.acorda_as}.</b>{' '}
                  Ele dormiu no horário e não voltou: pode ter faltado energia enquanto ele dormia, e aí ele só volta quando
                  alguém apertar o botão de ligar. Enquanto isso, nenhuma câmera é verificada.
                </>
              ) : (
                <>
                  <b className="font-semibold">
                    O agente desta loja está sem sinal {haQuanto(loja.segundos_sem_bater)}.
                  </b>{' '}
                  Enquanto ele estiver fora, nenhuma câmera é verificada. Confira se o computador da loja está ligado e
                  com internet.
                </>
              )}
            </Alerta>
          </div>
        )}
        {/* A chave refaz a entrada a cada tela: os blocos caem no lugar em sequência. */}
        <div
          key={caminho}
          className="entra mx-auto flex max-w-[1180px] flex-col gap-5 px-4 pb-14 pt-[14px] md:gap-6 md:px-[clamp(16px,3.2vw,36px)] md:pb-16 md:pt-5"
        >
          {contexto ? (
            <ContextoDoConsole.Provider value={contexto}>{children}</ContextoDoConsole.Provider>
          ) : (
            <Ossos alturas={[64, [96, 96, 96, 96], 220]} />
          )}
        </div>
      </main>

      {eu && paleta && <IrPara lojaId={lojaId} lojas={lojas} veResultados={veResultados} configura={configura} aoFechar={() => setPaleta(false)} />}
    </div>
  );
}
