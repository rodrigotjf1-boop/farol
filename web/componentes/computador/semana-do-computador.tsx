// =====================================================================
// A semana do computador da loja, em barras de 24 horas (A22)
// =====================================================================
// Do protótipo aprovado em 16/10/2026: cada dia é uma barra; o fundo verde
// é acordado, o listrado é dormindo, a faixa âmbar em cima é a loja aberta
// e o listrado vermelho é ele dormindo com a loja aberta. Quem calcula é a
// API (`semana`): aqui só se desenha.
// =====================================================================

import type { DiaDesenhado, DiaDoComputador } from '@/lib/api';

export const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const DIAS_LONGOS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

const hora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const trechos = (lista: [number, number][]) => lista.map(([i, f]) => `das ${hora(i)} às ${hora(f)}`).join(' e ');
const pct = (m: number) => `${(m / 14.4).toFixed(3)}%`;

/** O que a linha do dia diz, com o horário salvo (ou o rascunho). */
function textoDoDia(d: DiaDoComputador | undefined) {
  if (!d || (!d.dorme && !d.acorda)) return <>sem troca</>;
  return (
    <span>
      {d.dorme && (
        <>
          dorme <strong className="font-mono font-semibold text-farol-tinta">{d.dorme}</strong>
        </>
      )}
      {d.dorme && d.acorda && ' · '}
      {d.acorda && (
        <>
          acorda <strong className="font-mono font-semibold text-farol-tinta">{d.acorda}</strong>
        </>
      )}
    </span>
  );
}

/** A descrição da barra para o leitor de tela: o que está desenhado, em palavras. */
function descricao(d: DiaDesenhado): string {
  const partes = [d.dormindo.length ? `dormindo ${trechos(d.dormindo)}` : 'acordado o dia todo'];
  if (d.aberta.length) partes.push(`loja aberta ${trechos(d.aberta)}`);
  if (d.choques.length) partes.push(`dormindo com a loja aberta ${trechos(d.choques)}`);
  return partes.join('; ');
}

export function SemanaDoComputador({
  semana,
  dias,
  agora,
}: {
  semana: DiaDesenhado[];
  /** O horário de cada dia (o salvo ou o rascunho), para a frase ao lado da barra. */
  dias: DiaDoComputador[] | null;
  /** O minuto de agora no relógio da loja e o dia (1 = segunda), para a marca na barra de hoje. */
  agora?: { dia: number; minuto: number } | null;
}) {
  return (
    <div className="flex flex-col gap-3" data-semana-do-computador>
      <div className="flex flex-col gap-2.5" role="list" aria-label="A semana do computador">
        <div aria-hidden className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-x-3.5 font-mono text-[11.5px] text-farol-suave sm:grid-cols-[42px_minmax(0,1fr)_minmax(0,210px)]">
          <span />
          <span className="relative h-3">
            <span className="absolute left-0">0h</span>
            <span className="absolute left-1/4 -translate-x-1/2">6h</span>
            <span className="absolute left-1/2 -translate-x-1/2">12h</span>
            <span className="absolute left-3/4 -translate-x-1/2">18h</span>
            <span className="absolute right-0">24h</span>
          </span>
          <span className="hidden sm:block" />
        </div>
        {semana.map((d) => (
          <div
            key={d.dia}
            role="listitem"
            data-dia={d.dia}
            className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1.5 sm:grid-cols-[42px_minmax(0,1fr)_minmax(0,210px)]"
          >
            <b className="text-[13.5px] font-semibold">{DIAS_CURTOS[d.dia - 1]}</b>
            <span
              role="img"
              aria-label={descricao(d)}
              className="relative h-[26px] overflow-hidden rounded-md bg-farol-ok-leve shadow-[inset_0_0_0_1px_rgb(var(--borda))]"
            >
              {d.dormindo.map(([i, f]) => (
                <i
                  key={`d${i}`}
                  className="absolute bottom-0 top-2 block bg-farol-painel-2 bg-[image:repeating-linear-gradient(135deg,rgb(var(--borda-forte))_0_4px,transparent_4px_8px)]"
                  style={{ left: pct(i), width: pct(f - i) }}
                />
              ))}
              {d.choques.map(([i, f]) => (
                <i
                  key={`c${i}`}
                  data-choque
                  className="absolute bottom-0 top-2 block bg-farol-critico-leve bg-[image:repeating-linear-gradient(135deg,rgb(var(--critico))_0_4px,transparent_4px_8px)]"
                  style={{ left: pct(i), width: pct(f - i) }}
                />
              ))}
              {d.aberta.map(([i, f]) => (
                <i key={`a${i}`} className="absolute top-0 block h-1.5 bg-farol-facho" style={{ left: pct(i), width: pct(f - i) }} />
              ))}
              {agora && agora.dia === d.dia && (
                <i className="absolute -bottom-0.5 -top-0.5 block w-0.5 bg-farol-tinta" style={{ left: `calc(${pct(agora.minuto)} - 1px)` }} />
              )}
            </span>
            <span className="col-span-full min-w-0 text-[13px] text-farol-suave sm:col-span-1">
              {textoDoDia(dias?.find((x) => x.dia === d.dia))}
              {d.choques.length > 0 && (
                <span className="block text-farol-critico">dormindo com a loja aberta {trechos(d.choques)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-farol-suave">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-[18px] rounded-[3px] bg-farol-ok-leve shadow-[inset_0_0_0_1px_rgb(var(--borda))]" />
          acordado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-[18px] rounded-[3px] bg-farol-painel-2 bg-[image:repeating-linear-gradient(135deg,rgb(var(--borda-forte))_0_4px,transparent_4px_8px)] shadow-[inset_0_0_0_1px_rgb(var(--borda))]" />
          dormindo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-[5px] w-[18px] rounded-[3px] bg-farol-facho" />
          loja aberta
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-[18px] rounded-[3px] bg-farol-critico-leve bg-[image:repeating-linear-gradient(135deg,rgb(var(--critico))_0_4px,transparent_4px_8px)]" />
          dormindo com a loja aberta
        </span>
      </div>
    </div>
  );
}
