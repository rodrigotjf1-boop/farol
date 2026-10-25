// As quedas do computador (A26, M2): o desligamento inesperado, como o Windows registrou (eventos 41 e 6008) — quando
// apagou, quando voltou, quanto tempo ficou fora e a causa. Dos últimos 30 dias, a mais nova primeiro. Duas ou mais de
// energia: a linha do nobreak.

import type { Queda } from '@/lib/saude';
import { causaDaQueda, dataHoraNaLoja, tempoFora } from '@/lib/saude';

export function Quedas({ quedas, fuso, comSensores }: { quedas: readonly Queda[]; fuso: string; comSensores: boolean }) {
  const deEnergia = quedas.filter((q) => q.causa === 'energia').length;
  return (
    <section
      className="flex min-w-0 flex-col gap-0 self-start rounded-md bg-farol-painel px-[18px] pb-7 pt-[18px] font-mono shadow-farol-1 [mask:radial-gradient(circle_7px_at_50%_100%,transparent_98%,#000)_bottom/18px_100%_repeat-x]"
      aria-labelledby="t-quedas"
      data-quedas
    >
      <h2 id="t-quedas" className="mb-1.5 font-display text-[20px] font-extrabold uppercase tracking-[.04em]">Quedas do computador</h2>
      {quedas.length === 0 ? (
        <p className="border-t border-dashed border-farol-borda-forte py-2.5 text-[12.5px]">
          {comSensores ? 'Nenhuma queda nos últimos 30 dias.' : 'O pacote do agente desta loja ainda não lê o registro do Windows.'}
        </p>
      ) : (
        <ul>
          {quedas.map((q) => (
            <li key={q.ligou} className="flex justify-between gap-3.5 border-t border-dashed border-farol-borda-forte py-2.5 text-[12.5px] leading-normal">
              <span>
                apagou {q.desligou ? dataHoraNaLoja(q.desligou, fuso) : '—'}
                <br />
                voltou {dataHoraNaLoja(q.ligou, fuso)}
              </span>
              <span className="text-right font-semibold text-farol-critico">
                {tempoFora(q.foraMin)}
                <br />
                {causaDaQueda(q.causa)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {deEnergia >= 2 && (
        <p className="flex justify-between gap-3 border-t border-dashed border-farol-borda-forte py-2.5 text-[12.5px]">
          <span>{deEnergia} quedas de energia em 30 dias</span>
          <span className="font-semibold">um nobreak resolve</span>
        </p>
      )}
      <p className="border-t border-dashed border-farol-borda-forte pt-2.5 text-[11.5px] text-farol-suave">
        A causa sai do registro do Windows (eventos 41 e 6008).
      </p>
    </section>
  );
}
