'use client';

// =====================================================================
// "Ir para…" — a paleta do console (Ctrl K)
// =====================================================================
// Um campo de busca e uma lista: as telas da loja, os canais e os
// critérios de cada canal. Escolher um critério abre o canal já com a
// gaveta dele (A19, onda 1, fatia 1.5 — do protótipo aprovado em 09/10).
//
// O que a lista mostra sai do servidor na hora em que a paleta abre: os
// canais e os critérios da loja em que se está. As telas não dependem de
// pedido nenhum e aparecem na hora. Se os critérios não chegarem, a paleta
// diz e segue servindo para as telas e os canais.
//
// É um `<dialog>` do navegador, aberto com `showModal()`: prende o foco,
// deixa o resto inerte e fecha no Esc. O campo é uma caixa de combinação
// (`combobox`) que comanda a lista: o foco não sai dele, e o leitor de
// tela ouve a opção ativa por `aria-activedescendant`.
// =====================================================================

import {
  BellRing,
  Boxes,
  Building2,
  Calculator,
  Cctv,
  ChartColumn,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Map as Mapa,
  Search,
  Shapes,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { consoleApi, ErroDaApi, regrasApi, type LojaResumo, type Regra, type Setor } from '@/lib/api';

import { rotuloDoCanal } from './criterios/canais';

type Tipo = 'tela' | 'canal' | 'criterio' | 'loja';

export type Destino = {
  chave: string;
  titulo: string;
  /** A segunda coluna: o que é, e de onde. */
  detalhe: string;
  href: string;
  tipo: Tipo;
  icone: LucideIcon;
};

/** Sem acento e em minúsculas: "criterio" acha "critério", "CHAPA" acha "Chapa". */
export const semAcento = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** As telas da loja — as mesmas do menu, na mesma ordem, e as abas que moram dentro delas. */
export function telasDaLoja(lojaId: string, pode: { veResultados: boolean; configura: boolean }): Destino[] {
  const base = `/lojas/${lojaId}`;
  const tela = (titulo: string, href: string, icone: LucideIcon): Destino => ({ chave: `tela:${href}`, titulo, detalhe: 'tela', href, tipo: 'tela', icone });
  return [
    tela('Painel', base, LayoutDashboard),
    ...(pode.veResultados ? [tela('Análises', `${base}/analises`, ChartColumn), tela('Padrões', `${base}/analises/padroes`, Shapes)] : []),
    tela('Canais', `${base}/canais`, Cctv),
    tela('Planta', `${base}/canais/planta`, Mapa),
    tela('Inventário', `${base}/canais/inventario`, Boxes),
    tela('Critérios', `${base}/regras`, ListChecks),
    // Quem vê os resultados vê as fichas (supervisão para cima e o suporte).
    ...(pode.veResultados ? [tela('Fichas', `${base}/fichas`, ClipboardList)] : []),
    tela('Alertas', `${base}/alertas`, BellRing),
    ...(pode.configura ? [tela('Orçamento', `${base}/orcamento`, Calculator)] : []),
  ];
}

/**
 * Os canais da loja e, debaixo de cada um, os critérios que valem nele. O
 * critério que vale em dois canais aparece nos dois: quem procura por ele
 * escolhe em qual quer abrir. O que não vale em canal nenhum leva à tela de
 * critérios, onde fica o "Sem canal".
 */
export function canaisECriterios(lojaId: string, setores: Setor[], regras: Regra[] | null): Destino[] {
  const lista: Destino[] = [];
  const comCanal = new Set<string>();
  for (const setor of setores) {
    for (const ponto of setor.pontos) {
      const nome = rotuloDoCanal(ponto);
      lista.push({ chave: `canal:${ponto.id}`, titulo: nome, detalhe: `canal · ${setor.nome}`, href: `/pontos/${ponto.id}`, tipo: 'canal', icone: Cctv });
      for (const r of regras ?? []) {
        if (!r.alvos.some((a) => a.ponto_id === ponto.id)) continue;
        comCanal.add(r.id);
        lista.push({
          chave: `criterio:${r.id}:${ponto.id}`,
          titulo: r.nome,
          detalhe: `critério · ${nome}`,
          href: `/pontos/${ponto.id}?criterio=${r.id}`,
          tipo: 'criterio',
          icone: ListChecks,
        });
      }
    }
  }
  for (const r of regras ?? []) {
    if (comCanal.has(r.id)) continue;
    lista.push({ chave: `criterio:${r.id}:sem`, titulo: r.nome, detalhe: 'critério · sem canal', href: `/lojas/${lojaId}/regras`, tipo: 'criterio', icone: ListChecks });
  }
  return lista;
}

type Props = {
  /** A loja em que se está. Nulo = na lista de lojas: a paleta oferece as lojas. */
  lojaId: string | null;
  lojas: LojaResumo[] | null;
  veResultados: boolean;
  configura: boolean;
  aoFechar: () => void;
};

type DaLoja = { lojaId: string; setores: Setor[]; regras: Regra[] | null };

export function IrPara({ lojaId, lojas, veResultados, configura, aoFechar }: Props) {
  const router = useRouter();
  const p = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);

  const [termo, setTermo] = useState('');
  const [pos, setPos] = useState(0);
  const [daLoja, setDaLoja] = useState<DaLoja | null>(null);
  const [buscando, setBuscando] = useState(Boolean(lojaId));
  const [recado, setRecado] = useState<string | null>(null);

  // Efeito de LAYOUT: ao fechar, o `close()` roda com o <dialog> ainda na página, e é ele que devolve o foco ao
  // botão que abriu a paleta (no efeito comum a limpeza chega depois de o elemento sair, e o foco se perde).
  useLayoutEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
    // O foco começa no campo. (`autoFocus` não serve: o diálogo abre depois de montado.)
    campo.current?.focus();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  // Os canais e os critérios da loja, na hora em que a paleta abre. Os dois pedidos são independentes: sem os
  // critérios, a paleta ainda leva aos canais.
  useEffect(() => {
    if (!lojaId) return;
    let vivo = true;
    setBuscando(true);
    setRecado(null);
    Promise.allSettled([consoleApi.loja(lojaId), regrasApi.listar(lojaId)]).then(([arvore, criterios]) => {
      if (!vivo) return;
      const setores = arvore.status === 'fulfilled' ? arvore.value.setores : [];
      const regras = criterios.status === 'fulfilled' ? criterios.value.regras : null;
      setDaLoja({ lojaId, setores, regras });
      const falhou = arvore.status === 'rejected' ? arvore.reason : criterios.status === 'rejected' ? criterios.reason : null;
      if (falhou) {
        const motivo = falhou instanceof ErroDaApi ? falhou.message : 'não deu certo';
        setRecado(
          arvore.status === 'rejected'
            ? `Não consegui buscar os canais e os critérios desta loja (${motivo}). As telas continuam aqui.`
            : `Não consegui buscar os critérios (${motivo}). As telas e os canais continuam aqui.`,
        );
      }
      setBuscando(false);
    });
    return () => {
      vivo = false;
    };
  }, [lojaId]);

  const destinos: Destino[] = useMemo(() => {
    if (!lojaId) {
      return (lojas ?? []).map((l) => ({ chave: `loja:${l.id}`, titulo: l.nome, detalhe: 'loja', href: `/lojas/${l.id}`, tipo: 'loja' as const, icone: Store }));
    }
    const doServidor = daLoja && daLoja.lojaId === lojaId ? canaisECriterios(lojaId, daLoja.setores, daLoja.regras) : [];
    return [...telasDaLoja(lojaId, { veResultados, configura }), ...doServidor];
  }, [lojaId, lojas, daLoja, veResultados, configura]);

  const visiveis = useMemo(() => {
    const t = semAcento(termo.trim());
    if (!t) return destinos;
    // Todas as palavras digitadas têm de aparecer, em qualquer ordem: "chapa limpa" acha "Limpeza · Chapa".
    const palavras = t.split(/\s+/);
    return destinos.filter((d) => {
      const onde = semAcento(`${d.titulo} ${d.detalhe}`);
      return palavras.every((w) => onde.includes(w));
    });
  }, [destinos, termo]);

  // A opção ativa nunca fica fora da lista (a busca encolhe a lista; os critérios chegam depois das telas).
  const ativa = Math.min(pos, Math.max(0, visiveis.length - 1));
  const idDaOpcao = (n: number) => `${p}-op-${n}`;

  useEffect(() => {
    lista.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [ativa, visiveis]);

  function ir(d: Destino) {
    aoFechar();
    router.push(d.href);
  }

  function tecla(e: React.KeyboardEvent) {
    const ultima = visiveis.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPos(ativa >= ultima ? 0 : ativa + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPos(ativa <= 0 ? Math.max(0, ultima) : ativa - 1);
    } else if (e.key === 'Home' && visiveis.length > 0) {
      e.preventDefault();
      setPos(0);
    } else if (e.key === 'End' && visiveis.length > 0) {
      e.preventDefault();
      setPos(ultima);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const d = visiveis[ativa];
      if (d) ir(d);
    }
  }

  const oQueBusca = lojaId ? 'Buscar tela, canal ou critério' : 'Buscar loja';

  return (
    <dialog
      ref={dialogo}
      aria-label="Ir para"
      data-paleta
      onCancel={(e) => {
        // O Esc fecharia o <dialog> por conta própria, e a moldura continuaria achando que ele está aberto.
        e.preventDefault();
        aoFechar();
      }}
      onClick={(e) => {
        // Clique no fundo escuro: o alvo é o próprio <dialog>.
        if (e.target === dialogo.current) aoFechar();
      }}
      className="fixed inset-x-0 bottom-auto top-[12vh] mx-auto my-0 w-[min(560px,calc(100%-2rem))] animate-surge overflow-hidden rounded-[14px] border border-farol-borda-forte bg-farol-painel p-0 text-farol-tinta shadow-farol-2 max-md:top-[6vh]"
    >
      <div className="flex items-center gap-2.5 border-b border-farol-borda px-4">
        <Search className="h-[18px] w-[18px] shrink-0 text-farol-suave" aria-hidden />
        <input
          ref={campo}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${p}-lista`}
          aria-activedescendant={visiveis.length > 0 ? idDaOpcao(ativa) : undefined}
          aria-autocomplete="list"
          aria-label={oQueBusca}
          placeholder={lojaId ? 'Tela, canal, critério…' : 'Loja…'}
          autoComplete="off"
          spellCheck={false}
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setPos(0);
          }}
          onKeyDown={tecla}
          // Sem o anel de foco do console: o campo é o único lugar em que o foco fica na paleta (o cursor de
          // texto e a opção realçada já dizem onde se está), e o anel ficaria aceso o tempo todo.
          className="h-[52px] min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-farol-suave/75 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>

      {recado && (
        <p role="status" className="border-b border-farol-borda bg-farol-painel-2 px-4 py-2 text-[12.5px] text-farol-suave" data-recado-da-paleta>
          {recado}
        </p>
      )}

      {/* `relative`: a opção ativa é levada à vista por `scrollIntoView`, e a lista é quem rola. */}
      <ul ref={lista} id={`${p}-lista`} role="listbox" aria-label="Destinos" className="relative flex max-h-[min(50vh,420px)] flex-col gap-0.5 overflow-y-auto p-1.5">
        {visiveis.map((d, n) => {
          const Icone = d.icone;
          const aqui = n === ativa;
          return (
            <li
              key={d.chave}
              id={idDaOpcao(n)}
              role="option"
              aria-selected={aqui}
              data-destino={d.tipo}
              // Só o movimento do mouse muda a opção ativa: a lista que rola pelo teclado não troca de dono sozinha.
              onMouseMove={() => n !== ativa && setPos(n)}
              onClick={() => ir(d)}
              className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 rounded-lg px-2.5 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${
                aqui ? 'bg-farol-realce' : ''
              }`}
            >
              <Icone className={`h-[17px] w-[17px] shrink-0 ${aqui ? 'text-farol-tinta' : 'text-farol-suave'}`} aria-hidden />
              <span className="min-w-0 break-words font-medium">{d.titulo}</span>
              <small className="col-start-2 min-w-0 break-words font-mono text-[12px] text-farol-suave sm:col-start-3 sm:max-w-[240px] sm:text-right">{d.detalhe}</small>
            </li>
          );
        })}
        {visiveis.length === 0 && !buscando && (
          <li role="presentation" className="px-2.5 py-3 text-farol-suave" data-nada>
            {termo.trim() ? 'Nada com esse nome.' : lojaId ? 'Nada para mostrar.' : 'Nenhuma loja.'}
          </li>
        )}
        {buscando && (
          <li role="presentation" className="px-2.5 py-2 text-[12.5px] text-farol-suave" data-buscando>
            Buscando os canais e os critérios…
          </li>
        )}
      </ul>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-farol-borda bg-farol-painel-2 px-4 py-2 text-[12px] text-farol-suave max-md:hidden" aria-hidden>
        <span>
          <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> escolhe
        </span>
        <span>
          <kbd className="font-mono">Enter</kbd> vai
        </span>
        <span>
          <kbd className="font-mono">Esc</kbd> fecha
        </span>
        {!lojaId && (
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Building2 className="h-[13px] w-[13px]" aria-hidden />
            entre numa loja para ver os canais e os critérios
          </span>
        )}
      </p>
    </dialog>
  );
}
