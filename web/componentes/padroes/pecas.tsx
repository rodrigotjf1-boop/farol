// As peças pequenas da tela de Padrões: a frase com trechos em destaque e
// as datas ditas como a loja as conhece. Os números e as frases vêm
// prontos do servidor (`api/src/especialista.ts`); aqui só se escreve.

import type { Frase, SaidaDoPadrao } from '@/lib/api';

export const DIA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] as const;
const DIAS_PLURAL = ['segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados', 'domingos'];
const ARTIGO = ['das', 'das', 'das', 'das', 'das', 'dos', 'dos'];

/** "das sextas", "dos sábados" */
export const dosDias = (diaDaSemana: number): string => `${ARTIGO[diaDaSemana]} ${DIAS_PLURAL[diaDaSemana]}`;

const emDias = (dia: string): number => {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, d) / 86_400_000;
};
/** 0 = segunda … 6 = domingo. Pelo calendário, sem passar pelo fuso do navegador. */
export const diaDaSemana = (dia: string): number => (new Date(emDias(dia) * 86_400_000).getUTCDay() + 6) % 7;
/** "26/09" */
export const diaEMes = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export const hh = (h: number): string => `${String(((h % 24) + 24) % 24).padStart(2, '0')}h`;
/** "20h às 21h" */
export const horasDe = (h: number): string => `${hh(h)} às ${hh(h + 1)}`;
/** A ordem das horas num dia da operação, que vira às 6h: a madrugada vem depois da noite. */
export const ordemDaHora = (h: number): number => (h - 6 + 24) % 24;

/** "hoje", "ontem", ou "sex 02/10". */
export function quandoFoi(dia: string, hoje: string): { curto: string; data: string } {
  const n = emDias(hoje) - emDias(dia);
  const data = `${DIA[diaDaSemana(dia)]!.slice(0, 3)} ${diaEMes(dia)}`;
  return { curto: n === 0 ? 'hoje' : n === 1 ? 'ontem' : data, data: n <= 1 ? data : '' };
}

export const umaCasa = (v: number): string => v.toFixed(1).replace('.', ',');
/** O valor de um indicador, como a tela o escreve: "2,3" ou "37%". */
export const valorEmTexto = (tipo: 'medida' | 'fora' | 'na', v: number): string => (tipo === 'medida' ? umaCasa(v) : `${Math.round(v)}%`);

/** A frase que chegou do servidor, com os trechos em destaque. */
export function Texto({ frase }: { frase: Frase }) {
  return (
    <>
      {frase.map((t, i) =>
        typeof t === 'string' ? (
          <span key={i}>{t}</span>
        ) : (
          <b key={i} className="font-semibold text-farol-tinta">
            {t.forte}
          </b>
        ),
      )}
    </>
  );
}

/** A saída do padrão em duas linhas: é o que as duas gavetas da revisão mostram no alto. */
export function ResumoDaSaida({ a, hoje }: { a: SaidaDoPadrao; hoje: string }) {
  const q = quandoFoi(a.dia, hoje);
  return (
    <div className="rounded-[10px] border border-farol-borda bg-farol-painel-2 p-3 text-[13px]" data-resumo-da-saida>
      <b className="block text-sm font-semibold">{a.titulo}</b>
      <span className="text-farol-suave">
        {q.curto}, das {horasDe(a.hora)} · {a.onde} — {a.curto}.
      </span>
    </div>
  );
}

/** Do setor escolhido? O que é da loja inteira (o gasto, o disco) aparece em todos. */
export const doSetor = (item: { setorId: string }, setor: string): boolean => setor === 'todos' || item.setorId === setor || item.setorId === 'loja';
