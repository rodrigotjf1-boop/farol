'use client';

// =====================================================================
// Planta › Ao vivo (A26, P7)
// =====================================================================
// Do protótipo aprovado pelo dono em 27/10/2026 ("ter uma forma de
// acompanhar a movimentação ao vivo, no modo planta e modo 3d"): quem está
// na cozinha agora, em que posto e por onde passou — sem nome e sem rosto,
// o rótulo é o posto. Três modos na barra de baixo: Planta (de cima), 3D
// (gira) e Câmeras (a cena do lugar de cada câmera, simulada: a imagem de
// verdade não sai da loja).
//
// A tela lê a última posição de cada pessoa a cada segundo
// (`GET /v1/lojas/:id/planta-viva/agora`) e, entre uma leitura e outra, a
// figura anda suave até lá. Ler também diz ao computador da loja que alguém
// olha: só então ele manda a cada meio segundo. Com a aba escondida, para
// de ler. Só para quem configura a loja (é o caminho de cada um).
// =====================================================================

import { Box, Crosshair, Footprints, Map as MapaIcone, Video } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { abasDaPlanta } from '@/componentes/planta-viva/abas-da-planta';
import { AoVivo3D, type PosicaoNaCena } from '@/componentes/planta-viva/ao-vivo-3d';
import { AoVivoPlanta, type FiguraAoVivo } from '@/componentes/planta-viva/ao-vivo-planta';
import { usePlantaViva } from '@/componentes/planta-viva/use-planta-viva';
import { abasDeCanais } from '@/componentes/pontos/abas-de-canais';
import { Abas } from '@/componentes/ui/abas';
import { classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Ossos, Ponto, Titulo, Vazio } from '@/componentes/ui/pecas';
import { ErroDaApi, plantaVivaApi } from '@/lib/api';
import type { Pt } from '@/lib/planta';
import { aproximar, duracao, lembrar, type AgoraDaPlanta, type MemoriaAoVivo } from '@/lib/planta-viva';

type Modo = 'planta' | '3d' | 'cams';
const MODOS: ReadonlyArray<{ valor: Modo; rotulo: string; icone: typeof MapaIcone }> = [
  { valor: 'planta', rotulo: 'Planta', icone: MapaIcone },
  { valor: '3d', rotulo: '3D', icone: Box },
  { valor: 'cams', rotulo: 'Câmeras', icone: Video },
];
const LER_A_CADA_MS = 1000;
const PASSANDO = 'Passando';

const relogioNaLoja = (ms: number, fuso: string) => {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString('pt-BR');
  }
};

export default function AoVivoNaPlanta() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura } = useConsole();
  const fuso = loja?.timezone ?? 'America/Sao_Paulo';
  const { dados, erro: erroDaPlanta, nomeDaCamera } = usePlantaViva(id);
  const planta = dados?.planta ?? null;
  const [agora, setAgora] = useState<AgoraDaPlanta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [modo, setModo] = useState<Modo>('planta');
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const [figuras, setFiguras] = useState<FiguraAoVivo[]>([]);
  const [relogio, setRelogio] = useState(0);
  const memoria = useRef<MemoriaAoVivo>(new Map());
  const alvos = useRef(new Map<number, Pt>());
  const mostradas = useRef(new Map<number, PosicaoNaCena>());

  const nomeDoPosto = useMemo(() => new Map((planta?.moveis ?? []).map((m) => [m.id, m.nome])), [planta]);
  const numeroDoCanal = useCallback(
    (pontoId: string) => {
      const c = dados?.canais.find((x) => x.id === pontoId);
      return c?.canal != null ? String(c.canal) : '·';
    },
    [dados],
  );

  // ───────────── a leitura, a cada segundo, com a aba à vista ─────────────
  useEffect(() => {
    if (!planta) return;
    let parado = false;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const ler = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const a = await plantaVivaApi.agora(id);
          if (parado) return;
          const t = Date.now();
          memoria.current = lembrar(memoria.current, a.pessoas, t, planta.moveis);
          alvos.current = new Map(a.pessoas.map((p) => [p.n, [p.x, p.y] as Pt]));
          setAgora(a);
          setErro(null);
        } catch (e) {
          if (parado) return;
          if (e instanceof ErroDaApi && e.status === 403) {
            setSemAcesso(true);
            return;
          }
          setErro(e instanceof ErroDaApi ? e.message : 'não consegui ler o movimento agora');
        }
      }
      if (!parado) espera = setTimeout(ler, LER_A_CADA_MS);
    };
    void ler();
    return () => {
      parado = true;
      if (espera) clearTimeout(espera);
    };
  }, [id, planta]);

  // ───────────── o movimento suave entre as leituras ─────────────
  useEffect(() => {
    let quadro = 0;
    let antes = performance.now();
    let desenhadoEm = 0;
    const passo = (t: number) => {
      const dt = t - antes;
      antes = t;
      const novas = new Map<number, PosicaoNaCena>();
      for (const [n, alvo] of alvos.current) {
        const era = mostradas.current.get(n);
        const [x, y] = era ? aproximar([era.x, era.y], alvo, dt) : alvo;
        const posto = memoria.current.get(n)?.posto;
        novas.set(n, { x, y, rotulo: (posto && nomeDoPosto.get(posto)) || PASSANDO });
      }
      mostradas.current = novas;
      // a vista de cima e a lista pelo React, ~20 vezes por segundo; o 3D lê o ref a cada quadro
      if (t - desenhadoEm > 50) {
        desenhadoEm = t;
        setFiguras(
          [...novas].map(([n, p]) => ({
            n,
            x: p.x,
            y: p.y,
            rotulo: p.rotulo,
            rastro: [...(memoria.current.get(n)?.rastro ?? []).map(([rx, ry]) => [rx, ry] as Pt), [p.x, p.y] as Pt],
          })),
        );
        setRelogio(Date.now());
      }
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [nomeDoPosto]);

  const escolher = useCallback((n: number) => setEscolhida((x) => (x === n ? null : n)), []);
  useEffect(() => {
    if (escolhida !== null && agora && !agora.pessoas.some((p) => p.n === escolhida)) setEscolhida(null);
  }, [agora, escolhida]);

  const porPosto = useMemo(() => {
    const c = new Map<string, number>();
    for (const f of figuras) c.set(f.rotulo, (c.get(f.rotulo) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [figuras]);

  const cabecalho = (
    <>
      <Cabecalho sobre={loja?.nome} titulo="Planta viva">
        Quem está na loja agora, em que posto e por onde passou — cada ponto é uma pessoa, sem nome e sem rosto: o rótulo é o
        posto em que ela está.
      </Cabecalho>
      <Abas rotulo="Vistas dos canais" abas={abasDeCanais(id)} />
      <Abas rotulo="Vistas da planta" abas={abasDaPlanta(id)} />
    </>
  );
  if (semAcesso || (!configura && dados)) {
    return (
      <>
        {cabecalho}
        <Alerta papel="status">
          O movimento ao vivo mostra o caminho de cada pessoa: é só para quem configura a loja (gerente para cima). Em
          Movimento, você vê onde a loja trabalha e o tempo em cada posto.
        </Alerta>
      </>
    );
  }
  if (erroDaPlanta) return (<>{cabecalho}<Alerta tom="critico" papel="alert">{erroDaPlanta}</Alerta></>);
  if (!dados) return (<>{cabecalho}<Ossos alturas={[[420, 200]]} /></>);
  if (!planta || !planta.ambientes.length || !dados.calibracoes.size) {
    return (
      <>
        {cabecalho}
        <Vazio
          icone={Footprints}
          titulo="A planta viva ainda não liga"
          acao={<Link href={`/lojas/${id}/canais/planta/calibrar`} className={classesDoBotao({ variante: 'primario' })}><Crosshair className="h-4 w-4" aria-hidden />Calibrar câmera</Link>}
        >
          Ela precisa da planta desenhada e de pelo menos uma câmera calibrada pelos pontos do piso. Depois de calibrar, o
          agente passa a pôr as pessoas no mapa — sem imagem, sem nome e sem rosto.
        </Vazio>
      </>
    );
  }

  const situacao = agora?.situacao ?? 'sem_sinal';
  const total = figuras.length;
  return (
    <div className="flex flex-col gap-3 pb-24" data-ao-vivo>
      {cabecalho}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-live="polite">
        <span className="inline-flex items-center gap-2 font-display text-[18px] font-extrabold uppercase tracking-[.06em]" data-situacao={situacao}>
          <Ponto tom={situacao === 'ao_vivo' ? 'critico' : situacao === 'parado' ? 'atencao' : 'neutro'} pulsa={situacao === 'ao_vivo'} />
          {situacao === 'ao_vivo' ? 'Ao vivo' : situacao === 'parado' ? 'Parado' : 'Sem sinal'}
        </span>
        {agora?.idadeS != null ? (
          <span className="whitespace-nowrap rounded-full bg-farol-painel px-3 py-1.5 font-mono text-[12px] font-semibold shadow-farol-1">
            atraso {agora.idadeS.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s
          </span>
        ) : null}
        <span className="whitespace-nowrap rounded-full bg-farol-painel px-3 py-1.5 font-mono text-[12px] font-semibold shadow-farol-1" aria-live="off">
          {relogio ? relogioNaLoja(relogio, fuso) : '--:--:--'}
        </span>
        <span className="whitespace-nowrap rounded-full bg-farol-painel px-3 py-1.5 font-mono text-[12px] font-semibold shadow-farol-1">
          {agora?.canais.length ?? 0} câmera(s) com imagem
        </span>
      </div>
      {erro ? <Alerta tom="atencao" papel="status">{erro} — tentando de novo.</Alerta> : null}

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="relative min-w-0 overflow-hidden rounded-[22px] bg-farol-cena shadow-farol-2" aria-label="A loja agora">
          {modo === 'planta' ? (
            <AoVivoPlanta planta={planta} figuras={figuras} escolhida={escolhida} aoEscolher={escolher} numeroDoCanal={numeroDoCanal} />
          ) : (
            <AoVivo3D planta={planta} modo={modo} posicoes={mostradas} escolhida={escolhida} nomeDaCamera={nomeDaCamera} />
          )}
          {situacao === 'sem_sinal' ? (
            <p className="absolute inset-x-3 bottom-3 rounded-xl bg-farol-cena/90 px-3 py-2 text-[13px] text-farol-cena-tinta" role="status">
              Sem sinal do computador da loja. A planta viva mede com a loja aberta e o agente ligado; fora do horário, a
              cozinha fica vazia aqui.
            </p>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-col gap-3">
          <section className={`${CARTAO} p-4`} aria-labelledby="t-agora">
            <Titulo id="t-agora">Na loja agora</Titulo>
            <div className="font-display text-[64px] font-black leading-[.85] tabular-nums" data-total>{total}</div>
            <p className="mt-2.5 text-[13px] text-farol-suave">
              {porPosto.length ? porPosto.map(([posto, n]) => `${posto}: ${n}`).join(' · ') : 'Ninguém nas câmeras calibradas.'}
            </p>
          </section>
          <section className={`${CARTAO} p-4`} aria-labelledby="t-quem">
            <Titulo id="t-quem">Quem está onde</Titulo>
            {figuras.length ? (
              <ul className="flex flex-col gap-1.5" aria-label="As pessoas agora" data-lista>
                {figuras.map((f) => {
                  const pessoa = agora?.pessoas.find((p) => p.n === f.n);
                  const desde = memoria.current.get(f.n)?.desde;
                  const vistos = (pessoa?.canais ?? []).map(numeroDoCanal);
                  return (
                    <li key={f.n}>
                      <button
                        type="button"
                        onClick={() => escolher(f.n)}
                        aria-pressed={escolhida === f.n}
                        className={`grid w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border-[1.5px] bg-farol-fundo px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-farol-mostarda ${escolhida === f.n ? 'border-farol-mostarda' : 'border-transparent'}`}
                      >
                        <i className="grid h-[22px] w-[22px] place-items-center rounded-full bg-farol-pessoa font-mono text-[11px] font-bold not-italic text-white">{f.n}</i>
                        <span className="min-w-0">
                          <b className="block truncate font-semibold">{f.rotulo}</b>
                          <small className="font-mono text-[11px] text-farol-suave">{vistos.length ? `canal ${vistos.join(', ')}` : 'fora das câmeras agora'}</small>
                        </span>
                        <span className="font-mono text-[12px] text-farol-suave">{desde ? duracao(Math.max(0, (relogio - desde) / 1000)) : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-farol-suave">Ninguém agora.</p>
            )}
            <p className="mt-2.5 text-[12.5px] text-farol-suave">
              Toque numa pessoa para seguir o rastro dela. O tempo é há quanto ela está nesse posto. O número é do dia, não
              diz quem é.
            </p>
          </section>
        </aside>
      </div>

      <nav
        className="fixed bottom-[calc(14px+env(safe-area-inset-bottom,0px))] left-1/2 z-10 flex max-w-[calc(100vw-24px)] -translate-x-1/2 gap-1 rounded-full border border-farol-cena-suave/30 bg-farol-cena/95 p-1.5 shadow-farol-2 backdrop-blur"
        aria-label="Modo de ver"
      >
        {MODOS.map(({ valor, rotulo, icone: Icone }) => (
          <button
            key={valor}
            type="button"
            aria-pressed={modo === valor}
            onClick={() => setModo(valor)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-[18px] py-3 text-[15px] font-semibold transition-colors focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-farol-mostarda max-[420px]:px-3 ${modo === valor ? 'bg-farol-rotulo text-farol-sobre-rotulo' : 'text-farol-cena-tinta'}`}
          >
            <Icone className="h-[18px] w-[18px]" aria-hidden />
            <span className="max-[420px]:sr-only">{rotulo}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
