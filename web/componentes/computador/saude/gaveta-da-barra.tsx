// A gaveta de uma barra da Saúde do computador (A26, M2). Numa hora: a média, o pico, o pico de cada minuto (as barras
// vermelhas passaram do limite), os minutos acima do limite, se a placa segurou a frequência e se a loja estava aberta.
// Num dia: as horas do dia, cada uma com a média e o pico.

import { Botao } from '@/componentes/ui/botao';
import { Gaveta } from '@/componentes/ui/sobreposto';
import type { Barra, HoraDaSaude, Medida } from '@/lib/saude';
import { daHora, minutosDaHora, noRelogioDaLoja, num } from '@/lib/saude';

export function GavetaDaBarra({ barra, horas, medida, nome, unidade, limite, fuso, porDia, aoFechar }: {
  barra: Barra;
  horas: readonly HoraDaSaude[];
  medida: Medida;
  nome: string;
  unidade: string;
  limite: number;
  fuso: string;
  porDia: boolean;
  aoFechar: () => void;
}) {
  const daBarra = barra.indices.map((i) => horas[i]!);
  const rodape = <Botao onClick={aoFechar}>Fechar</Botao>;
  const resumo = (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-[14px] border border-farol-borda bg-farol-painel-2 px-3.5 py-3">
        <span className="font-mono text-[11.5px] text-farol-suave">{nome} · média</span>
        <b className="block font-display text-[30px] font-black leading-none">{num(barra.media)}<small className="text-[16px]">{unidade}</small></b>
      </div>
      <div className="rounded-[14px] border border-farol-borda bg-farol-painel-2 px-3.5 py-3">
        <span className="font-mono text-[11.5px] text-farol-suave">pico</span>
        <b className={`block font-display text-[30px] font-black leading-none ${barra.pico != null && barra.pico >= limite ? 'text-farol-critico' : ''}`}>
          {num(barra.pico)}<small className="text-[16px]">{unidade}</small>
        </b>
      </div>
    </div>
  );

  if (porDia) {
    return (
      <Gaveta titulo={`Dia ${barra.rotulo}`} descricao={`${nome}, hora a hora, no relógio da loja`} rodape={rodape} aoFechar={aoFechar}>
        {resumo}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[12.5px]">
            <caption className="sr-only">{nome} em cada hora do dia {barra.rotulo}</caption>
            <thead>
              <tr className="border-b-2 border-farol-tinta text-left font-display text-[14px] uppercase tracking-[.06em]">
                <th className="py-2 pr-2">Hora</th><th className="py-2 pr-2 text-right">Média</th><th className="py-2 text-right">Pico</th>
              </tr>
            </thead>
            <tbody>
              {daBarra.map((h) => {
                const v = daHora(h, medida);
                return (
                  <tr key={h.hora} className="border-b border-dashed border-farol-borda-forte">
                    <td className="py-2 pr-2">{noRelogioDaLoja(h.hora, fuso).hora}h</td>
                    <td className="py-2 pr-2 text-right">{num(v.media)}{unidade}</td>
                    <td className={`py-2 text-right ${v.max != null && v.max >= limite ? 'font-bold text-farol-critico' : ''}`}>{num(v.max)}{unidade}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Gaveta>
    );
  }

  const h = daBarra[0]!;
  const minutos = minutosDaHora(h, medida);
  const comMinutos = minutos.some((m) => m != null);
  const acima = minutos.filter((m) => m != null && m >= limite).length;
  const segurouTemp = typeof h.sensores?.gpuLimitaTemperatura === 'number' ? h.sensores.gpuLimitaTemperatura : null;
  const segurouEnergia = typeof h.sensores?.gpuLimitaEnergia === 'number' ? h.sensores.gpuLimitaEnergia : null;
  const hora = noRelogioDaLoja(h.hora, fuso).hora;
  return (
    <Gaveta titulo={`${hora}h às ${hora}h59`} descricao={`${nome}, no relógio da loja`} rodape={rodape} aoFechar={aoFechar}>
      {resumo}
      <section aria-labelledby="t-minutos" className="flex flex-col gap-2">
        <h3 id="t-minutos" className="font-display text-[17px] font-extrabold uppercase tracking-[.04em]">O pico de cada minuto</h3>
        {comMinutos ? (
          <>
            <div className="flex h-[120px] items-end gap-[2px]" role="img" aria-label={`${nome}: o pico de cada minuto da hora; ${acima} minuto(s) acima do limite`} data-minutos>
              {minutos.map((m, i) => (
                <i
                  key={i}
                  className={`block min-w-0 flex-1 rounded-t-[3px] ${m == null ? 'bg-farol-borda' : m >= limite ? 'bg-farol-critico' : 'bg-farol-tinta'}`}
                  style={{ height: `${m == null ? 2 : Math.max(3, Math.min(100, m))}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between font-mono text-[11px] text-farol-suave"><span>:00</span><span>:30</span><span>:59</span></div>
          </>
        ) : (
          <p className="text-[13px] text-farol-suave">O pacote do agente desta loja ainda não manda o pico de cada minuto.</p>
        )}
      </section>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-t border-dashed border-farol-borda-forte pt-3 font-mono text-[12.5px]">
        {comMinutos && (<><dt>minutos acima de {limite}{unidade}</dt><dd className="text-right font-semibold">{acima}</dd></>)}
        {segurouTemp != null && (<><dt>a placa segurou a frequência por calor</dt><dd className="text-right font-semibold">{segurouTemp ? `${segurouTemp} amostra(s)` : 'não'}</dd></>)}
        {segurouEnergia != null && (<><dt>a placa segurou por energia</dt><dd className="text-right font-semibold">{segurouEnergia ? `${segurouEnergia} amostra(s)` : 'não'}</dd></>)}
        <dt>a loja estava</dt>
        <dd className="text-right font-semibold">{barra.aberta === true ? 'aberta' : barra.aberta === false ? 'fechada' : 'sem horário cadastrado'}</dd>
        <dt>amostras na hora</dt><dd className="text-right font-semibold">{h.amostras}</dd>
      </dl>
    </Gaveta>
  );
}
