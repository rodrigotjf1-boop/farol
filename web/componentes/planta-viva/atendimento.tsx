'use client';

// =====================================================================
// A aba Atendimento: os cartões de cada área e a linha do tempo (28/10/2026)
// =====================================================================
// Do protótipo aprovado em 29/10/2026 (`mockups/farol-planta-atendimento.html`):
// cada ÁREA DE ESPERA mostra a espera do meio (a mediana), quantas pessoas,
// a maior, quantas passaram de 5 min, quantas estão lá agora e a espera
// hora a hora; cada PORTA, quantos saíram (e a hora de cada um), quantos
// entraram e o tempo na loja. A linha do tempo põe o expediente inteiro numa
// faixa por área. Sem nome e sem rosto: são horas e durações.
// =====================================================================

import { CARTAO } from '@/componentes/ui/pecas';
import { ESPERA_LONGA_S, minSeg, type EsperaNaArea, type PortaNaArea } from '@/lib/planta-viva';

const hora = (iso: string, fuso: string): string => {
  try {
    return `${new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso))}h`;
  } catch {
    return `${new Date(iso).getHours()}h`;
  }
};
const relogio = (iso: string | number, fuso: string): string => {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString('pt-BR').slice(0, 5);
  }
};

function Miudo({ rotulo, valor, alerta = false }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-farol-painel-2 px-2.5 py-2">
      <dt className="truncate font-mono text-[10.5px] uppercase tracking-[.04em] text-farol-suave">{rotulo}</dt>
      <dd className={`mt-1 font-display text-[22px] font-extrabold leading-none tabular-nums ${alerta ? 'text-farol-critico' : ''}`}>{valor}</dd>
    </div>
  );
}

function Cabeca({ nome, tipo }: { nome: string; tipo: 'espera' | 'porta' }) {
  return (
    <header className="flex items-start justify-between gap-2.5">
      <h2 className="min-w-0 break-words font-display text-[22px] font-extrabold uppercase leading-[1.1] tracking-[.02em]">{nome}</h2>
      <span
        className={`shrink-0 rounded-full border-[1.5px] px-2 py-[5px] font-mono text-[10.5px] font-bold uppercase leading-none tracking-[.08em] ${
          tipo === 'porta' ? 'border-farol-ketchup text-farol-critico' : 'border-farol-mostarda text-farol-facho-tinta'
        }`}
      >
        {tipo}
      </span>
    </header>
  );
}

function Agora({ quantos, um, varios }: { quantos: number; um: string; varios: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold" data-agora>
      <i className="h-[9px] w-[9px] rounded-full bg-farol-ketchup motion-safe:animate-pulse" aria-hidden />
      agora: {quantos} {quantos === 1 ? um : varios}
    </span>
  );
}

/** Um aviso dentro do cartão: a área que nenhuma câmera calibrada vê não tem números. */
function SemCamera() {
  return (
    <p className="rounded-xl bg-farol-critico-leve px-3 py-2 text-[12.5px]" data-sem-camera>
      Nenhuma câmera calibrada vê esta área: os números dela podem faltar. Calibre a câmera que a enxerga em <b className="font-semibold">Calibrar câmera</b>.
    </p>
  );
}

export function CartaoDeEspera({ area, fuso, cameras }: { area: EsperaNaArea; fuso: string; cameras: number }) {
  const horas = [...area.porHora].sort((a, b) => a.hora.localeCompare(b.hora));
  const teto = Math.max(60, ...horas.map((h) => h.medianaS));
  return (
    <article className={`${CARTAO} relative flex min-w-0 flex-col gap-3 overflow-hidden p-[18px] pl-[24px]`} data-area={area.id} data-tipo="espera">
      <span className="absolute inset-y-0 left-0 w-1.5 bg-farol-mostarda" aria-hidden />
      <Cabeca nome={area.nome} tipo="espera" />
      <div className="flex flex-wrap items-baseline gap-2">
        <b className="font-display text-[clamp(52px,7vw,72px)] font-black leading-[.85] tabular-nums">{area.medianaS === null ? '—' : minSeg(area.medianaS)}</b>
        <span className="font-mono text-[12.5px] leading-[1.3] text-farol-suave">
          min de espera
          <br />
          (a do meio)
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-2 max-[380px]:grid-cols-2">
        <Miudo rotulo="pessoas" valor={String(area.pessoas)} />
        <Miudo rotulo="maior" valor={area.maiorS === null ? '—' : minSeg(area.maiorS)} />
        <Miudo rotulo="+ de 5 min" valor={String(area.acimaDe5Min)} alerta={area.acimaDe5Min > 0} />
      </dl>
      {area.agora !== null && <Agora quantos={area.agora} um="pessoa esperando" varios="pessoas esperando" />}
      {cameras === 0 && <SemCamera />}
      {horas.length > 0 && (
        <ol className="grid h-[92px] items-end gap-1" style={{ gridTemplateColumns: `repeat(${horas.length}, minmax(0, 1fr))` }} aria-label="A espera do meio, hora a hora">
          {horas.map((h) => (
            <li key={h.hora} className="flex h-full min-w-0 flex-col justify-end gap-[3px]" title={`${hora(h.hora, fuso)}: ${minSeg(h.medianaS)} min, ${h.pessoas} pessoa(s)`}>
              <i
                className={`block rounded-t-[5px] ${h.medianaS > ESPERA_LONGA_S ? 'bg-farol-ketchup' : 'bg-farol-mostarda'}`}
                style={{ height: `${Math.max(4, Math.round((h.medianaS / teto) * 70))}px` }}
              />
              <small className="truncate text-center font-mono text-[9.5px] text-farol-suave">{hora(h.hora, fuso)}</small>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export function CartaoDaPorta({ area, fuso, cameras }: { area: PortaNaArea; fuso: string; cameras: number }) {
  const porHora = new Map<string, string[]>();
  for (const s of area.saidas) {
    const h = hora(s, fuso);
    porHora.set(h, [...(porHora.get(h) ?? []), relogio(s, fuso)]);
  }
  const ultima = area.saidas[area.saidas.length - 1];
  return (
    <article className={`${CARTAO} relative flex min-w-0 flex-col gap-3 overflow-hidden p-[18px] pl-[24px]`} data-area={area.id} data-tipo="porta">
      <span className="absolute inset-y-0 left-0 w-1.5 bg-farol-ketchup" aria-hidden />
      <Cabeca nome={area.nome} tipo="porta" />
      <div className="flex flex-wrap items-baseline gap-2">
        <b className="font-display text-[clamp(52px,7vw,72px)] font-black leading-[.85] tabular-nums">{area.saidas.length}</b>
        <span className="font-mono text-[12.5px] text-farol-suave">{area.saidas.length === 1 ? 'saída' : 'saídas'}</span>
      </div>
      <dl className="grid grid-cols-3 gap-2 max-[380px]:grid-cols-2">
        <Miudo rotulo="entradas" valor={String(area.entradas.length)} />
        <Miudo rotulo="na loja" valor={area.naLoja.medianaS === null ? '—' : minSeg(area.naLoja.medianaS)} />
        <Miudo rotulo="a última" valor={ultima ? relogio(ultima, fuso) : '—'} />
      </dl>
      {area.agora !== null && area.agora > 0 && <Agora quantos={area.agora} um="pessoa na porta" varios="pessoas na porta" />}
      {cameras === 0 && <SemCamera />}
      {porHora.size > 0 ? (
        <ul className="flex max-h-[210px] flex-col gap-1.5 overflow-y-auto" aria-label="A hora de cada saída">
          {[...porHora.entries()].map(([h, lista]) => (
            <li key={h} className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-2">
              <b className="font-display text-[16px] font-extrabold leading-[1.5] text-farol-suave">{h}</b>
              <span className="flex flex-wrap gap-1">
                {lista.map((r, i) => (
                  <span key={`${r}-${i}`} className="rounded-lg bg-farol-painel-2 px-[7px] py-[5px] font-mono text-[12px] font-semibold leading-none">
                    {r}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-farol-suave">Ninguém saiu por esta porta no período.</p>
      )}
      <p className="text-[12.5px] text-farol-suave">
        &quot;Na loja&quot;: da entrada à saída, a do meio — de quem as câmeras seguiram o caminho inteiro ({area.naLoja.quantos} de {area.saidas.length}).
      </p>
    </article>
  );
}

/** O expediente numa faixa por área: cada espera uma barra (a vermelha passou de 5 min); na porta, ▽ entrou e ▲ saiu. */
export function LinhaDoTempo({ areas, de, ate, fuso }: { areas: Array<EsperaNaArea | PortaNaArea>; de: number; ate: number; fuso: string }) {
  const largura = Math.max(1, ate - de);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - de) / largura) * 100)).toFixed(2)}%`;
  const horas: number[] = [];
  const passo = largura > 10 * 3_600_000 ? 2 * 3_600_000 : 3_600_000;
  for (let h = Math.ceil(de / 3_600_000) * 3_600_000; h <= ate; h += passo) horas.push(h);
  const grade = horas.map((h) => <i key={h} className="absolute inset-y-0 w-px bg-farol-borda" style={{ left: pct(h) }} aria-hidden />);
  return (
    <div className="flex flex-col gap-3 px-1.5" role="img" aria-label={`O expediente, área por área: ${areas.map((a) => (a.tipo === 'porta' ? `${a.nome}, ${a.saidas.length} saídas` : `${a.nome}, ${a.pessoas} esperas`)).join('; ')}`}>
      {areas.map((a) => (
        <div key={a.id} data-faixa={a.id}>
          <h3 className="mb-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[14px] font-bold">
            {a.nome}
            <small className="font-mono text-[11px] font-medium text-farol-suave">
              {a.tipo === 'porta' ? `${a.saidas.length} saídas · ${a.entradas.length} entradas` : `${a.pessoas} esperas`}
            </small>
          </h3>
          <div className="relative h-[46px] overflow-hidden rounded-[10px] bg-farol-painel-2">
            {grade}
            {a.tipo === 'espera'
              ? (() => {
                  const fins: number[] = [];
                  return a.visitas.map(([ini, s], i) => {
                    const t = Date.parse(ini);
                    let k = fins.findIndex((f) => f < t);
                    if (k < 0) { k = fins.length; fins.push(0); }
                    fins[k] = t + s * 1000;
                    return (
                      <b
                        key={i}
                        className={`absolute h-1.5 rounded-[3px] ${s > ESPERA_LONGA_S ? 'bg-farol-ketchup' : 'bg-farol-mostarda'}`}
                        style={{ left: pct(t), width: `max(3px, ${(((s * 1000) / largura) * 100).toFixed(2)}%)`, top: `${4 + (k % 5) * 8}px` }}
                        title={`${relogio(t, fuso)} · ${minSeg(s)} min`}
                      />
                    );
                  });
                })()
              : (
                <>
                  {a.entradas.map((t, i) => (
                    <b key={`e${i}`} className="absolute top-1.5 h-0 w-0 -translate-x-1.5 border-x-[6px] border-t-[10px] border-x-transparent border-t-farol-picles" style={{ left: pct(Date.parse(t)) }} title={`entrou ${relogio(t, fuso)}`} />
                  ))}
                  {a.saidas.map((t, i) => (
                    <b key={`s${i}`} className="absolute bottom-1.5 h-0 w-0 -translate-x-1.5 border-x-[6px] border-b-[10px] border-x-transparent border-b-farol-ketchup" style={{ left: pct(Date.parse(t)) }} title={`saiu ${relogio(t, fuso)}`} />
                  ))}
                </>
              )}
          </div>
        </div>
      ))}
      <div className="relative mx-1.5 h-4" aria-hidden>
        {horas.map((h, i) => (
          <span
            key={h}
            className={`absolute -translate-x-1/2 font-mono text-[10.5px] text-farol-suave ${i % 2 === 1 ? 'max-sm:hidden' : ''}`}
            style={{ left: pct(h) }}
          >
            {hora(new Date(h).toISOString(), fuso)}
          </span>
        ))}
      </div>
    </div>
  );
}
