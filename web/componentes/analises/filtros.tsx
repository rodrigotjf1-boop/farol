'use client';

// Os filtros da tela de Análises, numa faixa só que quebra de linha.
//
// Só o PERÍODO vai ao servidor. Horas, canal, critério e "onde foi julgado"
// recortam o que já chegou — por isso respondem na hora.
//
// Hora e dia são sempre seletor nativo: ninguém digita "19" num campo.

import { Cloud, Cpu } from 'lucide-react';

import type { Analises } from '@/lib/api';

import { hh, type Filtros, type Onde, type Periodo } from './conta';

const PERIODOS: ReadonlyArray<{ valor: Periodo; rotulo: string }> = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'ontem', rotulo: 'Ontem' },
  { valor: '7d', rotulo: '7 dias' },
  { valor: 'dia', rotulo: 'Outro dia' },
];

const ONDES: ReadonlyArray<{ valor: Onde; rotulo: string; icone?: typeof Cpu }> = [
  { valor: 'tudo', rotulo: 'Tudo' },
  { valor: 'loja', rotulo: 'Na loja', icone: Cpu },
  { valor: 'nuvem', rotulo: 'Na nuvem', icone: Cloud },
];

const ROTULO = 'text-[12.5px] font-semibold text-farol-tinta';
const GRUPO = 'inline-flex gap-0.5 rounded-xl bg-farol-realce p-[3px] max-md:flex';
const OPCAO =
  'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold transition-all duration-200 max-md:min-h-10 max-md:flex-1 max-md:px-1.5';
const opcao = (ligada: boolean) =>
  `${OPCAO} ${ligada ? 'bg-farol-painel text-farol-tinta shadow-farol-1' : 'text-farol-suave hover:text-farol-tinta'}`;

export function FiltrosDasAnalises({
  filtros,
  aoMudar,
  dados,
  hoje,
}: {
  filtros: Filtros;
  aoMudar: (parte: Partial<Filtros>) => void;
  /** O que já chegou: de onde saem os canais e os critérios dos seletores. */
  dados: Analises | null;
  /** O dia de hoje na loja: o último que se pode escolher. */
  hoje: string | null;
}) {
  const canais = dados?.canais ?? [];
  const criterios = dados?.criterios ?? [];

  return (
    <section
      aria-label="Filtros das análises"
      className="flex min-w-0 flex-wrap items-end gap-x-[18px] gap-y-3.5 rounded-[14px] border border-farol-borda bg-farol-painel px-4 py-3.5 max-md:gap-3"
    >
      <div className="flex min-w-0 flex-col gap-[5px] max-md:w-full">
        <span id="an-r-periodo" className={ROTULO}>
          Período
        </span>
        <div role="group" aria-labelledby="an-r-periodo" className={GRUPO}>
          {PERIODOS.map((p) => (
            <button
              key={p.valor}
              type="button"
              aria-pressed={filtros.periodo === p.valor}
              onClick={() => aoMudar({ periodo: p.valor })}
              className={opcao(filtros.periodo === p.valor)}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>

      {filtros.periodo === 'dia' && (
        <div className="flex min-w-0 flex-col gap-[5px] max-md:w-full">
          <label htmlFor="an-dia" className={ROTULO}>
            Dia
          </label>
          <input
            id="an-dia"
            type="date"
            className="entrada max-md:min-h-11"
            value={filtros.dia}
            max={hoje ?? undefined}
            onChange={(e) => {
              if (e.target.value) aoMudar({ dia: e.target.value });
            }}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-[5px] max-md:w-full">
        <span id="an-r-horas" className={ROTULO}>
          Horas
        </span>
        <div role="group" aria-labelledby="an-r-horas" className="flex items-center gap-2 text-[13px] text-farol-suave">
          {/* "das 20h às 18h" não existe: quem mexe numa ponta empurra a outra. */}
          <select
            id="an-de"
            aria-label="Da hora"
            className="entrada w-[86px] max-md:min-h-11 max-md:w-auto max-md:flex-1"
            value={filtros.de}
            onChange={(e) => {
              const de = Number(e.target.value);
              aoMudar({ de, ate: filtros.ate <= de ? de + 1 : filtros.ate });
            }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
          <span aria-hidden>às</span>
          <select
            id="an-ate"
            aria-label="Até a hora"
            className="entrada w-[86px] max-md:min-h-11 max-md:w-auto max-md:flex-1"
            value={filtros.ate}
            onChange={(e) => {
              const ate = Number(e.target.value);
              aoMudar({ ate, de: filtros.de >= ate ? ate - 1 : filtros.de });
            }}
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {hh(i + 1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex min-w-0 flex-[1_1_170px] flex-col gap-[5px] md:max-w-[280px] max-md:flex-[1_1_100%]">
        <label htmlFor="an-canal" className={ROTULO}>
          Canal
        </label>
        <select
          id="an-canal"
          className="entrada max-md:min-h-11"
          value={filtros.canal}
          onChange={(e) => aoMudar({ canal: e.target.value })}
        >
          <option value="">Todos os canais</option>
          {canais.map((c) => (
            <option key={c.id} value={c.id}>
              {c.canal != null ? `${String(c.canal).padStart(2, '0')} · ` : ''}
              {c.nome}
              {c.excluido ? ' (excluído)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-[1_1_170px] flex-col gap-[5px] md:max-w-[280px] max-md:flex-[1_1_100%]">
        <label htmlFor="an-criterio" className={ROTULO}>
          Critério
        </label>
        <select
          id="an-criterio"
          className="entrada max-md:min-h-11"
          value={filtros.criterio}
          onChange={(e) => aoMudar({ criterio: e.target.value })}
        >
          <option value="">Todos os critérios</option>
          {criterios.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
              {c.excluido ? ' (excluído)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-col gap-[5px] max-md:w-full">
        <span id="an-r-onde" className={ROTULO}>
          Onde foi julgado
        </span>
        <div role="group" aria-labelledby="an-r-onde" className={GRUPO}>
          {ONDES.map((o) => (
            <button
              key={o.valor}
              type="button"
              aria-pressed={filtros.onde === o.valor}
              onClick={() => aoMudar({ onde: o.valor })}
              className={opcao(filtros.onde === o.valor)}
            >
              {o.icone && <o.icone className="h-[15px] w-[15px]" aria-hidden />}
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
