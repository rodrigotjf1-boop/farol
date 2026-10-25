'use client';

// =====================================================================
// Planta › Movimento (A26, P4)
// =====================================================================
// Do protótipo aprovado em 25/10/2026 (`mockups/farol-planta-viva-e-saude.html`).
// As pessoas na planta, SEM nome e sem rosto (`GET /v1/lojas/:id/planta-viva`):
// onde a loja trabalha (o calor por quadrado de 25 cm), o tempo em cada posto
// (o móvel com 70 cm de folga), as pessoas por hora e o replay de até 60
// minutos — só para quem configura a loja (a API não manda o caminho de cada
// um para os outros). A guarda é curta: o caminho some em 7 dias.
// =====================================================================

import { Crosshair, Footprints, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { abasDaPlanta } from '@/componentes/planta-viva/abas-da-planta';
import { PlantaDeCima } from '@/componentes/planta-viva/planta-de-cima';
import { usePlantaViva } from '@/componentes/planta-viva/use-planta-viva';
import { abasDeCanais } from '@/componentes/pontos/abas-de-canais';
import { Abas } from '@/componentes/ui/abas';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Segmentado, Titulo, Vazio } from '@/componentes/ui/pecas';
import { ErroDaApi, plantaVivaApi } from '@/lib/api';
import { corDoCalor, duracao, noInstante, type LeituraDaPlantaViva } from '@/lib/planta-viva';

type Periodo = '1h' | '12h' | '24h' | '7d';
const PERIODOS: ReadonlyArray<{ valor: Periodo; rotulo: string; ms: number }> = [
  { valor: '1h', rotulo: 'Última hora', ms: 3_600_000 },
  { valor: '12h', rotulo: '12 horas', ms: 12 * 3_600_000 },
  { valor: '24h', rotulo: '24 horas', ms: 24 * 3_600_000 },
  { valor: '7d', rotulo: '7 dias', ms: 7 * 86_400_000 },
];
const VELOCIDADES = [1, 4, 16] as const;

const horaNaLoja = (iso: string, fuso: string) => {
  try {
    return `${new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso))}h`;
  } catch {
    return `${new Date(iso).getHours()}h`;
  }
};
const relogioNaLoja = (ms: number, fuso: string) => {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString('pt-BR');
  }
};

export default function MovimentoNaPlanta() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura } = useConsole();
  const fuso = loja?.timezone ?? 'America/Sao_Paulo';
  const { dados, erro: erroDaPlanta, nomeDaCamera, corDe } = usePlantaViva(id);
  const [periodo, setPeriodo] = useState<Periodo>('1h');
  const [leitura, setLeitura] = useState<LeituraDaPlantaViva | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const pedido = useRef(0);

  const carregar = useCallback(() => {
    const meu = ++pedido.current;
    const ate = new Date();
    const de = new Date(ate.getTime() - PERIODOS.find((p) => p.valor === periodo)!.ms);
    setLeitura(null);
    plantaVivaApi
      .ler(id, de.toISOString(), ate.toISOString())
      .then((l) => { if (meu === pedido.current) { setLeitura(l); setErro(null); setSemAcesso(false); } })
      .catch((e) => {
        if (meu !== pedido.current) return;
        if (e instanceof ErroDaApi && e.status === 403) setSemAcesso(true);
        else setErro(e instanceof ErroDaApi ? e.message : 'não consegui ler o movimento');
      });
  }, [id, periodo]);
  useEffect(() => carregar(), [carregar]);

  // o replay
  const caminhos = leitura?.caminhos ?? null;
  const [inicio, fim] = useMemo(() => {
    if (!caminhos?.length) return [0, 0];
    let a = Infinity;
    let b = -Infinity;
    for (const c of caminhos) for (const [iso] of c.pontos) { const ms = Date.parse(iso); a = Math.min(a, ms); b = Math.max(b, ms); }
    return [a, b];
  }, [caminhos]);
  const [t, setT] = useState(0);
  const [tocando, setTocando] = useState(false);
  const [velocidade, setVelocidade] = useState<(typeof VELOCIDADES)[number]>(4);
  useEffect(() => { setT(inicio); setTocando(false); }, [inicio]);
  useEffect(() => {
    if (!tocando) return;
    let antes = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      setT((x) => {
        const novo = x + (agora - antes) * velocidade;
        if (novo >= fim) { setTocando(false); return fim; }
        return novo;
      });
      antes = agora;
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [tocando, velocidade, fim]);
  const figuras = useMemo(() => (caminhos ? noInstante(caminhos, t) : []), [caminhos, t]);

  const cabecalho = (
    <>
      <Cabecalho sobre={loja?.nome} titulo="Planta viva">
        Cada câmera no mapa pelos pontos marcados no chão: o que ela cobre de verdade, e as pessoas no mapa — sem nome e sem
        rosto.
      </Cabecalho>
      <Abas rotulo="Vistas dos canais" abas={abasDeCanais(id)} />
      <Abas rotulo="Vistas da planta" abas={abasDaPlanta(id)} />
    </>
  );
  if (semAcesso) return (<>{cabecalho}<Alerta papel="status">O movimento na planta é de quem acompanha a loja (supervisão para cima).</Alerta></>);
  if (erroDaPlanta || erro) return (<>{cabecalho}<Alerta tom="critico" papel="alert">{erroDaPlanta ?? erro}</Alerta></>);
  if (!dados) return (<>{cabecalho}<Ossos alturas={[[420, 200]]} /></>);
  const planta = dados.planta;
  if (!planta || !planta.ambientes.length || !dados.calibracoes.size) {
    return (
      <>
        {cabecalho}
        <Vazio
          icone={Footprints}
          titulo="A planta viva ainda não liga"
          acao={configura ? <Link href={`/lojas/${id}/canais/planta/calibrar`} className={classesDoBotao({ variante: 'primario' })}><Crosshair className="h-4 w-4" aria-hidden />Calibrar câmera</Link> : undefined}
        >
          Ela precisa da planta desenhada e de pelo menos uma câmera calibrada pelos pontos do piso. Depois de calibrar, o
          agente passa a pôr as pessoas no mapa — sem imagem, sem nome e sem rosto.
        </Vazio>
      </>
    );
  }

  const max = leitura ? Math.max(1, ...leitura.calor.map((c) => c[2])) : 1;
  const maiorPosto = leitura?.postos[0]?.segundos ?? 1;
  const maiorMedia = leitura ? Math.max(1, ...leitura.porHora.map((h) => h.pico)) : 1;
  return (
    <>
      {cabecalho}
      <div className="flex flex-wrap items-center gap-2">
        <Segmentado rotulo="Período" opcoes={PERIODOS.map(({ valor, rotulo }) => ({ valor, rotulo }))} valor={periodo} aoMudar={setPeriodo} />
        <Chip quebra>sem nome · sem rosto · o caminho de cada um some em 7 dias</Chip>
      </div>

      {!leitura ? (
        <Ossos alturas={[[420, 200]]} />
      ) : leitura.minutos === 0 ? (
        <Vazio icone={Footprints} titulo="Sem movimento no período">
          Nenhum minuto chegou do computador da loja neste período. A planta viva mede só com a loja aberta, e liga no agente
          depois que as câmeras são calibradas.
        </Vazio>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className={`${CARTAO} flex flex-col gap-3 p-[14px] md:p-[18px]`} aria-labelledby="t-calor" data-calor>
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <Titulo id="t-calor">Onde a loja trabalha</Titulo>
                <span className="font-mono text-[11px] text-farol-suave">segundos-pessoa por quadrado de 25 cm · {leitura.minutos} min</span>
              </header>
              <PlantaDeCima
                planta={planta}
                descricao={`Onde a loja trabalhou no período: ${leitura.calor.length} quadrados com gente; o mais usado com ${duracao(max)}`}
                nomeDaCamera={nomeDaCamera}
                corDe={corDe}
                fundo={({ p, escala }) => (
                  <g>
                    {leitura.calor.map(([i, j, s]) => {
                      const [x, y] = p(i * leitura.celulaM, j * leitura.celulaM);
                      const c = corDoCalor(s / max);
                      return <rect key={`${i},${j}`} x={x} y={y} width={leitura.celulaM * escala} height={leitura.celulaM * escala} fill={`rgb(var(--${c.cor}))`} fillOpacity={c.opacidade} />;
                    })}
                  </g>
                )}
              />
              <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                <span>pouco</span>
                <span className="h-3 w-[min(220px,50%)] rounded-md bg-[linear-gradient(90deg,rgb(var(--mostarda)/.3),rgb(var(--mostarda)),rgb(var(--pao)),rgb(var(--ketchup)))]" aria-hidden />
                <span>muito</span>
              </div>
            </section>
            <div className="flex flex-col gap-4">
              <section className={`${CARTAO} flex flex-col gap-2.5 p-[18px]`} aria-labelledby="t-postos" data-postos>
                <Titulo id="t-postos">Tempo em cada posto</Titulo>
                {leitura.postos.length ? (
                  <ul className="flex flex-col gap-2">
                    {leitura.postos.map((m) => (
                      <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                        <b className="truncate font-display text-[17px] font-extrabold uppercase leading-[1.25]">{m.nome}</b>
                        <span className="font-mono text-[12px]">{duracao(m.segundos)}</span>
                        <span className="col-span-2 h-2.5 overflow-hidden rounded-md bg-farol-painel-2">
                          <i className="block h-full rounded-md bg-farol-ketchup" style={{ width: `${Math.round((100 * m.segundos) / maiorPosto)}%` }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-farol-suave">Ninguém parou na frente de um móvel da planta no período.</p>
                )}
                <p className="text-[12.5px] text-farol-suave">Pessoa-tempo na frente de cada móvel (com 70 cm de folga), somado no período.</p>
              </section>
              <section className="flex flex-col gap-2 rounded-[22px] bg-farol-palco p-[18px] text-farol-palco-tinta" aria-labelledby="t-hora" data-por-hora>
                <h2 id="t-hora" className="font-display text-[19px] font-extrabold uppercase tracking-[.04em]">Pessoas por hora</h2>
                <ol className="grid items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, leitura.porHora.length)}, minmax(0, 1fr))` }}>
                  {leitura.porHora.map((h) => (
                    <li key={h.hora} className="flex flex-col items-stretch gap-1" title={`${horaNaLoja(h.hora, fuso)}: média ${h.mediaDePessoas.toLocaleString('pt-BR')}, pico ${h.pico}`}>
                      <span className="text-center font-mono text-[10.5px] text-farol-palco-suave">{h.mediaDePessoas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>
                      <i className="block rounded-t-md bg-farol-mostarda" style={{ height: `${Math.max(3, Math.round((h.mediaDePessoas / maiorMedia) * 96))}px` }} />
                      <span className="text-center font-mono text-[10.5px] text-farol-palco-suave">{horaNaLoja(h.hora, fuso)}</span>
                    </li>
                  ))}
                </ol>
                <span className="font-mono text-[11.5px] text-farol-palco-suave">a barra é a média; o pico do período foi {leitura.pico} pessoa(s)</span>
              </section>
            </div>
          </div>

          <section className={`${CARTAO} flex flex-col gap-3 p-[14px] md:p-[18px]`} aria-labelledby="t-replay" data-replay>
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <Titulo id="t-replay">Replay</Titulo>
              <span className="font-mono text-[11px] text-farol-suave">até 60 minutos de cada vez · só quem configura a loja</span>
            </header>
            {periodo !== '1h' ? (
              <p className="text-[13.5px] text-farol-suave">O replay mostra o caminho de cada um em até 60 minutos: escolha “Última hora”.</p>
            ) : !caminhos ? (
              <Alerta papel="status">
                <b className="font-semibold">O replay mostra o caminho de cada um: só para quem configura a loja (gerente para cima).</b> Você vê
                o calor, os postos e as pessoas por hora.
              </Alerta>
            ) : !caminhos.length ? (
              <p className="text-[13.5px] text-farol-suave">Nenhum caminho guardado nesta hora.</p>
            ) : (
              <>
                <div className="mx-auto w-full max-w-[820px]">
                  <PlantaDeCima planta={planta} descricao={`O replay às ${relogioNaLoja(t, fuso)}: ${figuras.length} pessoa(s) na planta`} nomeDaCamera={nomeDaCamera} corDe={corDe}>
                    {({ p }) => (
                      <>
                        {figuras.map((f) => (
                          <g key={f.numero}>
                            <polyline points={f.rastro.map(([x, y]) => p(x, y).map((v) => v.toFixed(1)).join(',')).join(' ')} fill="none" stroke="rgb(var(--tinta))" strokeOpacity={0.3} strokeWidth={3} strokeLinecap="round" />
                            {(() => {
                              const [x, y] = p(f.agora[0], f.agora[1]);
                              return (
                                <g>
                                  <circle cx={x} cy={y} r={12} fill="rgb(var(--palco))" />
                                  <text x={x} y={y + 5} textAnchor="middle" className="font-display text-[14px] font-extrabold" fill="rgb(var(--palco-tinta))">{f.numero}</text>
                                </g>
                              );
                            })()}
                          </g>
                        ))}
                      </>
                    )}
                  </PlantaDeCima>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Botao variante="primario" onClick={() => { if (t >= fim) setT(inicio); setTocando((x) => !x); }} aria-label={tocando ? 'Pausar o replay' : 'Tocar o replay'}>
                    {tocando ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                    {tocando ? 'Pausar' : 'Tocar'}
                  </Botao>
                  <input
                    type="range"
                    min={inicio}
                    max={fim}
                    step={1000}
                    value={Math.round(t)}
                    onChange={(e) => { setTocando(false); setT(Number(e.target.value)); }}
                    aria-label="O instante do replay"
                    className="min-w-[160px] flex-1 accent-farol-ketchup"
                  />
                  <span className="font-mono text-[13px]" aria-live="off">{relogioNaLoja(t, fuso)}</span>
                  <Segmentado
                    rotulo="Velocidade"
                    opcoes={VELOCIDADES.map((v) => ({ valor: String(v) as '1' | '4' | '16', rotulo: `${v}×` }))}
                    valor={String(velocidade) as '1' | '4' | '16'}
                    aoMudar={(v) => setVelocidade(Number(v) as (typeof VELOCIDADES)[number])}
                  />
                </div>
                <p className="text-[12.5px] text-farol-suave">
                  Cada número é um caminho do dia, não uma pessoa com nome: quem sai das câmeras por mais de 3 s volta com outro
                  número.
                </p>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
