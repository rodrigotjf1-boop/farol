'use client';

// =====================================================================
// A imagem do canal para marcar os pontos do chão (A26, P4 — Calibrar câmera)
// =====================================================================
// A última imagem que o agente mandou do canal, com os pontos já marcados
// (numerados, na cor da câmera) e o que acabou de ser tocado (pulsando, à
// espera do mesmo ponto na planta). Tocar devolve o ponto NORMALIZADO
// ((0, 0) em cima à esquerda, (1, 1) embaixo à direita) — o mesmo para o
// fluxo cheio e o reduzido.
//
// Sem imagem: o botão pede uma ao agente (ele responde na próxima batida).
// =====================================================================

import { Camera, RefreshCw } from 'lucide-react';
import { useState, type MouseEvent } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { previewApi, ErroDaApi } from '@/lib/api';
import type { Pt } from '@/lib/planta-viva';

export function ImagemParaMarcar({
  pontoId,
  nome,
  cor,
  marcados,
  pendente,
  podeMarcar,
  aoTocar,
}: {
  pontoId: string;
  nome: string;
  cor: string;
  marcados: readonly Pt[];
  pendente: Pt | null;
  podeMarcar: boolean;
  aoTocar: (uv: Pt) => void;
}) {
  // O selo fura o cache do navegador: "recarregar" mostra a imagem nova.
  const [selo, setSelo] = useState(() => String(Date.now()));
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'sem'>('carregando');
  const [recado, setRecado] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);

  const tocar = (e: MouseEvent<HTMLDivElement>) => {
    if (!podeMarcar || estado !== 'ok') return;
    const r = e.currentTarget.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    aoTocar([Math.round(u * 100000) / 100000, Math.round(v * 100000) / 100000]);
  };

  async function pedirImagem() {
    setPedindo(true);
    setRecado(null);
    try {
      const r = await previewApi.pedir(pontoId);
      setRecado(r.jaPedido ? 'Já havia um pedido em andamento. Esperando a loja responder.' : 'Imagem pedida ao agente da loja. Ela chega na próxima batida; depois, toque em “Recarregar”.');
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'não consegui pedir a imagem');
    } finally {
      setPedindo(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-imagem-para-marcar>
      <div
        className={`relative w-full max-w-full overflow-hidden rounded-xl border border-farol-borda bg-farol-palco ${estado === 'ok' && podeMarcar ? 'cursor-crosshair' : ''} ${estado !== 'ok' ? 'aspect-video' : ''}`}
        onClick={tocar}
        role={estado === 'ok' && podeMarcar ? 'button' : undefined}
        aria-label={estado === 'ok' && podeMarcar ? `A imagem de ${nome}: toque num ponto do chão` : undefined}
        tabIndex={-1}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a imagem vem da API pelo proxy, com cookie; o otimizador do Next não passa o cookie */}
        <img
          src={previewApi.url(pontoId, selo)}
          alt={`A imagem de ${nome}`}
          className={`block h-auto w-full select-none ${estado === 'ok' ? '' : 'invisible absolute'}`}
          draggable={false}
          onLoad={() => setEstado('ok')}
          onError={() => setEstado('sem')}
        />
        {estado === 'ok' && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            {marcados.map(([u, v], i) => (
              <g key={i}>
                <ellipse cx={u * 100} cy={v * 100} rx={1.9} ry={3.3} fill={cor} stroke="white" strokeWidth={0.35} />
              </g>
            ))}
            {pendente && (
              <ellipse cx={pendente[0] * 100} cy={pendente[1] * 100} rx={2.4} ry={4.2} fill="none" stroke="rgb(var(--mostarda))" strokeWidth={0.8} className="animate-pulso" />
            )}
          </svg>
        )}
        {estado === 'ok' && (
          // os números por cima, em HTML: no SVG esticado (`preserveAspectRatio="none"`) a letra entortaria
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {marcados.map(([u, v], i) => (
              <span key={i} className="absolute -translate-x-1/2 -translate-y-1/2 font-display text-[12px] font-extrabold leading-none text-white" style={{ left: `${u * 100}%`, top: `${v * 100}%` }}>
                {i + 1}
              </span>
            ))}
          </div>
        )}
        {estado === 'carregando' && <div className="osso absolute inset-0" aria-hidden />}
        {estado === 'sem' && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-farol-palco-tinta">
            <div className="flex flex-col items-center gap-2">
              <Camera className="h-7 w-7" aria-hidden />
              <b className="font-display text-[20px] font-extrabold uppercase">Sem imagem deste canal</b>
              <span className="max-w-[40ch] text-[13px] text-farol-palco-suave">Os pontos do chão se marcam na imagem do canal. Peça uma ao agente da loja.</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Botao mini onClick={() => { setEstado('carregando'); setSelo(String(Date.now())); }}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Recarregar a imagem
        </Botao>
        {estado === 'sem' && (
          <Botao mini variante="primario" onClick={pedirImagem} ocupado={pedindo}>
            <Camera className="h-4 w-4" aria-hidden />
            Pedir imagem do canal
          </Botao>
        )}
        {recado && <span className="text-[12.5px] text-farol-suave" role="status">{recado}</span>}
      </div>
    </div>
  );
}
