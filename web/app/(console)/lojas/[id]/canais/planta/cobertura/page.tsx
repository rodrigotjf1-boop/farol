'use client';

// =====================================================================
// Planta › O que cada câmera cobre (A26, P4)
// =====================================================================
// Do protótipo aprovado em 25/10/2026 (`mockups/farol-planta-viva-e-saude.html`).
// O piso que cada câmera CALIBRADA vê de verdade (a área que a calibração
// pelos pontos do piso calculou, `api/src/calibracao.ts`), o que nenhuma vê
// (hachurado), o piso coberto em % e cada câmera com a régua. A câmera ainda
// não calibrada aparece com o cone estimado da planta, tracejado.
// =====================================================================

import { Crosshair, Map as IconeDeMapa, ScanEye } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { abasDaPlanta } from '@/componentes/planta-viva/abas-da-planta';
import { PlantaDeCima, PoligonoNoChao } from '@/componentes/planta-viva/planta-de-cima';
import { usePlantaViva } from '@/componentes/planta-viva/use-planta-viva';
import { abasDeCanais } from '@/componentes/pontos/abas-de-canais';
import { Abas } from '@/componentes/ui/abas';
import { classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Ossos, Titulo, Vazio } from '@/componentes/ui/pecas';
import { coneDaCamera } from '@/lib/planta';
import { coberturaDoPiso, reguaEmCm } from '@/lib/planta-viva';

export default function CoberturaDasCameras() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura } = useConsole();
  const { dados, erro, nomeDaCamera, nomeLongo, corDe } = usePlantaViva(id);
  const [escondidas, setEscondidas] = useState<Set<string>>(new Set());

  const planta = dados?.planta ?? null;
  const calibradas = useMemo(
    () => (planta && dados ? planta.cameras.filter((c) => dados.calibracoes.has(c.pontoId)).map((c) => c.pontoId) : []),
    [planta, dados],
  );
  const visiveis = useMemo(() => new Set(calibradas.filter((k) => !escondidas.has(k))), [calibradas, escondidas]);
  const cobertura = useMemo(
    () => (planta && dados ? coberturaDoPiso(planta.ambientes, [...visiveis].map((k) => dados.calibracoes.get(k)!.area)) : null),
    [planta, dados, visiveis],
  );

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
  if (erro) return (<>{cabecalho}<Alerta tom="critico" papel="alert">{erro}</Alerta></>);
  if (!dados) return (<>{cabecalho}<Ossos alturas={[[420, 200]]} /></>);
  if (!planta || !planta.ambientes.length) {
    return (
      <>
        {cabecalho}
        <Vazio
          icone={IconeDeMapa}
          titulo="Falta a planta da loja"
          acao={<Link href={`/lojas/${id}/canais/planta`} className={classesDoBotao({ variante: 'primario' })}>Desenhar a planta</Link>}
        >
          O que cada câmera cobre é medido no chão da planta. Desenhe os ambientes e ponha as câmeras no lugar primeiro.
        </Vazio>
      </>
    );
  }
  if (!calibradas.length) {
    return (
      <>
        {cabecalho}
        <Vazio
          icone={ScanEye}
          titulo="Nenhuma câmera calibrada ainda"
          acao={configura ? <Link href={`/lojas/${id}/canais/planta/calibrar`} className={classesDoBotao({ variante: 'primario' })}><Crosshair className="h-4 w-4" aria-hidden />Calibrar a primeira câmera</Link> : undefined}
        >
          Marque de 8 a 15 pontos do chão em cada câmera (aba “Calibrar câmera”). Até lá, a planta mostra só o cone estimado
          de cada uma, no Desenho.
        </Vazio>
      </>
    );
  }

  const naoCalibradas = planta.cameras.filter((c) => !dados.calibracoes.has(c.pontoId));
  const parte = Math.round((cobertura?.parte ?? 0) * 100);
  return (
    <>
      {cabecalho}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className={`${CARTAO} flex flex-col gap-3 p-[14px] md:p-[18px]`} aria-labelledby="t-piso" data-cobertura>
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <Titulo id="t-piso">O piso que cada câmera vê</Titulo>
            <span className="font-mono text-[11px] text-farol-suave">pelos pontos marcados · hachurado = nenhuma câmera vê</span>
          </header>
          <PlantaDeCima
            planta={planta}
            descricao={`A planta com o piso de ${visiveis.size} câmera(s) calibrada(s); ${100 - parte}% do chão sem câmera`}
            nomeDaCamera={nomeDaCamera}
            corDe={corDe}
            fundo={({ p, escala }) => (
              <g data-sem-ver>
                {cobertura?.semVer.map(([x, y]) => {
                  const [sx, sy] = p(x, y);
                  return <rect key={`${x},${y}`} x={sx} y={sy} width={0.25 * escala} height={0.25 * escala} fill="rgb(var(--critico))" fillOpacity={0.12} />;
                })}
              </g>
            )}
          >
            {({ p, recorte }) => (
              <>
                {[...visiveis].map((k) => (
                  <PoligonoNoChao key={k} pts={dados.calibracoes.get(k)!.area} p={p} cor={corDe(k)} recorte={recorte} />
                ))}
                {naoCalibradas.map((c) => (
                  <PoligonoNoChao key={c.pontoId} pts={coneDaCamera(planta, c)} p={p} cor={corDe(c.pontoId)} tracejado opacidade={0.04} recorte={recorte} />
                ))}
              </>
            )}
          </PlantaDeCima>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] font-semibold">
            <legend className="sr-only">Mostrar o piso de cada câmera</legend>
            {calibradas.map((k) => (
              <label key={k} className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!escondidas.has(k)}
                  onChange={() => setEscondidas((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                />
                <i className="h-3.5 w-3.5 rounded" style={{ background: corDe(k) }} aria-hidden />
                {nomeLongo(k)}
              </label>
            ))}
            {naoCalibradas.length > 0 && <span className="font-normal text-farol-suave">tracejado: o cone estimado de quem ainda não foi calibrada</span>}
          </fieldset>
        </section>

        <div className="flex flex-col gap-4">
          <section className={`flex flex-col gap-2 rounded-[26px] p-5 text-white ${parte >= 80 ? 'bg-farol-picles' : 'bg-farol-ketchup'}`} aria-label={`O piso coberto: ${parte}%`} data-piso-coberto>
            <h2 className="font-display text-[19px] font-extrabold uppercase tracking-[.04em]">O piso coberto</h2>
            <span className="font-display text-[64px] font-black leading-[.86]">{parte}%</span>
            <p className="rounded-xl bg-farol-painel px-3 py-2 text-[13px] font-medium text-farol-tinta">
              do chão da loja, por pelo menos uma câmera calibrada{escondidas.size ? ' (das marcadas ao lado)' : ''}
            </p>
          </section>
          <section className="flex flex-col rounded-md bg-farol-painel px-[18px] pb-7 pt-[18px] font-mono shadow-farol-1 [mask:radial-gradient(circle_7px_at_50%_100%,transparent_98%,#000)_bottom/18px_100%_repeat-x]" aria-labelledby="t-cada" data-cada-camera>
            <h2 id="t-cada" className="mb-1.5 font-display text-[20px] font-extrabold uppercase tracking-[.04em]">Cada câmera</h2>
            <ul>
              {planta.cameras.map((c) => {
                const cal = dados.calibracoes.get(c.pontoId);
                const cm = cal ? reguaEmCm(cal) : null;
                return (
                  <li key={c.pontoId} className="flex justify-between gap-3 border-t border-dashed border-farol-borda-forte py-2.5 text-[12.5px]">
                    <span className="min-w-0">
                      {nomeLongo(c.pontoId)}
                      <br />
                      <span className="text-farol-suave">{cal ? `${cal.quantosPontos ?? 0} ponto(s) marcados` : 'sem pontos marcados'}</span>
                    </span>
                    <span className={`shrink-0 text-right font-semibold ${cal ? 'text-farol-ok' : 'text-farol-critico'}`}>
                      {cal ? (cm != null ? `acerta a ~${cm} cm` : 'calibrada') : 'sem calibração'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          {configura && naoCalibradas.length > 0 && (
            <Link href={`/lojas/${id}/canais/planta/calibrar?canal=${naoCalibradas[0]!.pontoId}`} className={classesDoBotao({ variante: 'primario' })}>
              <Crosshair className="h-4 w-4" aria-hidden />
              Calibrar {nomeDaCamera(naoCalibradas[0]!.pontoId).toLowerCase()}
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
