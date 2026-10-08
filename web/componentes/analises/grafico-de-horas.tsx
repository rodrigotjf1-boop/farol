'use client';

// O gráfico da tela de Análises: uma barra por hora (ou por dia), e três
// jeitos de olhar a mesma coisa — no que deu, onde foi julgado, quanto
// custou.
//
// **O gráfico também é filtro.** Cada barra é um botão: tocar numa hora
// mostra só ela (tocar de novo volta ao dia inteiro); num gráfico de dias,
// tocar num dia abre o dia. A coluna INTEIRA é o alvo do toque, não só a
// parte pintada — hora com pouca análise tem barra de três pontos de altura.
//
// As horas fora do intervalo escolhido ficam na tela, apagadas: é por elas
// que se sai de um recorte vazio.

import { useState } from 'react';

import { numero, plural } from '@/componentes/formatos';
import { CARTAO } from '@/componentes/ui/pecas';

import { dinheiro, dinheiroFino, pedacos, tamanho, tetoRedondo, type Balde, type Vista } from './conta';

const VISTAS: ReadonlyArray<{ valor: Vista; rotulo: string }> = [
  { valor: 'resultado', rotulo: 'Resultado' },
  { valor: 'onde', rotulo: 'Onde julgou' },
  { valor: 'custo', rotulo: 'Custo' },
];

const LEGENDA: Record<Vista, Array<{ cor: string; rotulo: string }>> = {
  resultado: [
    { cor: 'bg-farol-graf-ok', rotulo: 'conforme' },
    { cor: 'bg-farol-critico', rotulo: 'fora do critério' },
    { cor: 'bg-farol-graf-na', rotulo: 'não avaliou' },
  ],
  onde: [
    { cor: 'bg-farol-marca', rotulo: 'julgado na loja' },
    { cor: 'bg-farol-facho', rotulo: 'julgado na nuvem' },
  ],
  custo: [{ cor: 'bg-farol-facho', rotulo: 'custo estimado das análises na nuvem' }],
};

export function GraficoDeHoras({
  baldes,
  vista,
  aoMudarVista,
  de,
  ate,
  aoEscolher,
}: {
  baldes: Balde[];
  vista: Vista;
  aoMudarVista: (v: Vista) => void;
  /** O intervalo de horas escolhido; fora dele a barra fica apagada. */
  de: number;
  ate: number;
  /** Tocou numa barra: a hora, ou o dia. */
  aoEscolher: (b: Balde) => void;
}) {
  const [sobre, setSobre] = useState<number | null>(null);
  const porHora = baldes[0]?.hora !== undefined;
  const umaHora = porHora && ate - de === 1;
  const teto = tetoRedondo(Math.max(0, ...baldes.map((b) => tamanho(b.soma, vista))), vista === 'custo' ? 100 : 10);
  const eixo = (v: number) => (vista === 'custo' ? dinheiro(v) : numero(v));
  const vao = porHora ? 'gap-[3px]' : 'gap-[clamp(8px,3%,28px)]';
  const atual = sobre !== null ? baldes[sobre] : undefined;

  const leitura = (b: Balde, marcada: boolean) => {
    const s = b.soma;
    return (
      `${b.rotulo}: ${plural(s.analises, 'análise', 'análises')}, ${numero(s.conformes)} conforme, ` +
      `${numero(s.fora)} fora do critério, ${numero(s.naoAvaliou)} sem avaliar; ` +
      `${numero(s.naLoja)} na loja e ${numero(s.naNuvem)} na nuvem; custo ${dinheiro(s.custoCentavos)}. ` +
      (porHora
        ? marcada
          ? 'Hora selecionada: toque para voltar ao dia inteiro.'
          : 'Toque para ver só esta hora.'
        : 'Toque para abrir este dia.')
    );
  };

  return (
    <section aria-labelledby="t-an-grafico" className={`${CARTAO} flex flex-col gap-3.5 p-4`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="t-an-grafico" className="text-base font-semibold">
          {porHora ? 'Hora a hora' : 'Dia a dia'}
        </h2>
        <div role="group" aria-label="O que o gráfico mostra" className="ml-auto inline-flex gap-0.5 rounded-xl bg-farol-realce p-[3px]">
          {VISTAS.map((v) => (
            <button
              key={v.valor}
              type="button"
              aria-pressed={vista === v.valor}
              onClick={() => aoMudarVista(v.valor)}
              className={`min-h-8 rounded-[9px] px-3 text-[13px] font-semibold transition-all duration-200 max-md:min-h-9 max-md:px-2.5 ${
                vista === v.valor ? 'bg-farol-painel text-farol-tinta shadow-farol-1' : 'text-farol-suave hover:text-farol-tinta'
              }`}
            >
              {v.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div aria-hidden className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-farol-suave">
        {LEGENDA[vista].map((l) => (
          <span key={l.rotulo} className="inline-flex items-center gap-1.5">
            <i className={`h-2.5 w-2.5 rounded-[3px] ${l.cor}`} />
            {l.rotulo}
          </span>
        ))}
      </div>

      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-2" onPointerLeave={() => setSobre(null)}>
        <div aria-hidden className="flex h-[132px] flex-col justify-between text-right font-mono text-[11px] text-farol-suave md:h-[168px]">
          <span>{eixo(teto)}</span>
          <span>{eixo(teto / 2)}</span>
          <span>{eixo(0)}</span>
        </div>

        <div
          className={`relative flex h-[132px] items-end md:h-[168px] ${vao}`}
          style={{
            // Três linhas de referência: o teto, o meio e a base.
            background:
              'linear-gradient(rgb(var(--borda)), rgb(var(--borda))) 0 0 / 100% 1px no-repeat, ' +
              'linear-gradient(rgb(var(--borda)), rgb(var(--borda))) 0 50% / 100% 1px no-repeat, ' +
              'linear-gradient(rgb(var(--borda-forte)), rgb(var(--borda-forte))) 0 100% / 100% 1px no-repeat',
          }}
        >
          {baldes.map((b, i) => {
            const dentro = !porHora || (b.hora! >= de && b.hora! < ate);
            const marcada = umaHora && b.hora === de;
            const altura = (tamanho(b.soma, vista) / teto) * 100;
            return (
              <button
                key={`${vista}-${b.dia ?? ''}-${b.hora ?? ''}`}
                type="button"
                data-balde={i}
                disabled={b.futura}
                aria-pressed={porHora ? marcada : undefined}
                aria-label={b.futura ? `${b.rotulo}: ainda não chegou.` : leitura(b, marcada)}
                onClick={() => aoEscolher(b)}
                onPointerEnter={() => setSobre(i)}
                onFocus={() => setSobre(i)}
                onBlur={() => setSobre(null)}
                className={`relative flex h-full min-w-0 flex-1 items-end rounded-t-[5px] transition-colors hover:bg-farol-realce focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-farol-marca disabled:cursor-default disabled:hover:bg-transparent ${
                  marcada ? 'bg-farol-facho-leve shadow-[inset_0_-3px_0_rgb(var(--facho))]' : ''
                }`}
              >
                {b.soma.analises > 0 ? (
                  <span
                    className={`flex min-h-0 w-full origin-bottom animate-cresce flex-col-reverse overflow-hidden rounded-t ${dentro ? '' : 'opacity-30'}`}
                    style={{ height: `${altura}%`, animationDelay: `${i * 14}ms` }}
                  >
                    {pedacos(b.soma, vista).map((p) => (
                      <i key={p.cor} className={`block w-full ${p.cor}`} style={{ flex: `${p.valor} 1 0` }} />
                    ))}
                  </span>
                ) : (
                  // Hora que passou sem análise: um traço na base diz
                  // "olhei, não havia nada", em vez de um buraco.
                  !b.futura && <span className="absolute inset-x-[25%] bottom-0 h-0.5 rounded-sm bg-farol-borda-forte" />
                )}
              </button>
            );
          })}

          {atual && sobre !== null && !atual.futura && (
            <div
              role="presentation"
              className="pointer-events-none absolute -top-1 z-[5] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[10px] bg-farol-tinta px-2.5 py-2 text-xs leading-relaxed text-farol-fundo shadow-farol-2"
              style={{ left: `clamp(110px, ${((sobre + 0.5) / baldes.length) * 100}%, calc(100% - 110px))` }}
            >
              <b>{atual.rotulo}</b> · {plural(atual.soma.analises, 'análise', 'análises')}
              <br />
              {vista === 'onde'
                ? `${numero(atual.soma.naLoja)} na loja · ${numero(atual.soma.naNuvem)} na nuvem`
                : vista === 'custo'
                  ? `${dinheiro(atual.soma.custoCentavos)} · ${numero(atual.soma.naNuvem)} na nuvem` +
                    (atual.soma.naNuvem > 0 ? ` · ${dinheiroFino(atual.soma.custoCentavos / atual.soma.naNuvem)} cada` : '')
                  : `${numero(atual.soma.conformes)} conforme · ${numero(atual.soma.fora)} fora · ${numero(atual.soma.naoAvaliou)} sem avaliar`}
            </div>
          )}
        </div>

        <div aria-hidden className={`col-start-2 flex font-mono text-[11px] text-farol-suave ${vao}`}>
          {baldes.map((b, i) => (
            <span
              key={`${b.dia ?? ''}-${b.hora ?? ''}`}
              className={`min-w-0 flex-1 whitespace-nowrap text-center ${porHora && i % 6 !== 0 ? 'max-md:invisible' : ''}`}
            >
              {b.mostra ? b.rotulo : ''}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[12.5px] text-farol-suave">
        {porHora
          ? umaHora
            ? `Mostrando só das ${String(de).padStart(2, '0')}h às ${String(ate).padStart(2, '0')}h. Toque na mesma barra para voltar ao dia inteiro.`
            : 'Toque numa barra para ver só aquela hora.'
          : 'Toque num dia para abri-lo hora a hora.'}
      </p>
    </section>
  );
}
