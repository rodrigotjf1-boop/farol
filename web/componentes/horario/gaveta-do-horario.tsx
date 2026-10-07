'use client';

// =====================================================================
// A gaveta do horário de funcionamento
// =====================================================================
// Sete dias, cada um com a sua hora de abrir e de fechar. O horário é da
// LOJA: cada critério só diz se é conferido com ela aberta, fechada ou
// sempre — mudou aqui, mudou para todos.
// =====================================================================

import { useId, useState } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { Alerta } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { consoleApi, ErroDaApi, type FaixaDeHorario } from '@/lib/api';

import { DIAS, fechaNoDiaSeguinte, paraFaixas, paraSemana, problemaDaSemana, type Dia } from './semana';

type Props = {
  lojaId: string;
  horario: FaixaDeHorario[];
  aoSalvar: (mensagem: string) => Promise<void>;
  aoFechar: () => void;
};

export function GavetaDoHorario({ lojaId, horario, aoSalvar, aoFechar }: Props) {
  const p = useId();
  const [semana, setSemana] = useState<Dia[]>(() => paraSemana(horario));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const mudar = (i: number, novo: Partial<Dia>) =>
    setSemana((s) => s.map((d, j) => (j === i ? { ...d, ...novo } : d)));

  function copiar() {
    const molde = semana.find((d) => d.abre);
    if (!molde) {
      setErro('Marque um dia e ponha as horas dele primeiro.');
      return;
    }
    setErro(null);
    setSemana((s) => s.map(() => ({ ...molde })));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const problema = problemaDaSemana(semana);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const faixas = paraFaixas(semana);
      await consoleApi.salvarHorario(lojaId, faixas);
      await aoSalvar(
        faixas.length === 0
          ? 'Horário apagado. A loja volta a valer como sempre aberta.'
          : 'Horário salvo. O agente passa a segui-lo na próxima batida.',
      );
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  const nenhumDia = semana.every((d) => !d.abre);

  return (
    <Gaveta
      titulo="Horário de funcionamento"
      descricao="Quando a loja está aberta. É por ele que cada critério sabe se é hora de conferir."
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando}>
            {salvando ? 'Salvando…' : 'Salvar horário'}
          </Botao>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={enviar} className="flex flex-col gap-4" aria-label="Horário de funcionamento">
        <ul className="flex flex-col">
          {semana.map((d, i) => {
            const dia = DIAS[i]!;
            const nota = !d.abre ? 'fechada' : fechaNoDiaSeguinte(d) ? 'fecha no dia seguinte' : null;
            return (
              <li
                key={dia.curto}
                className="grid min-h-12 grid-cols-[minmax(0,1fr)_112px_auto_112px] items-center gap-x-2 gap-y-1 border-b border-farol-borda py-1.5 last:border-b-0 max-[420px]:grid-cols-[minmax(0,1fr)_98px_auto_98px]"
              >
                <label
                  htmlFor={`${p}-abre-${i}`}
                  className={`flex min-w-0 cursor-pointer items-center gap-2.5 ${d.abre ? 'font-semibold' : 'text-farol-suave'}`}
                >
                  <input
                    id={`${p}-abre-${i}`}
                    type="checkbox"
                    checked={d.abre}
                    onChange={(e) => mudar(i, { abre: e.target.checked })}
                    className="h-[17px] w-[17px] shrink-0 accent-farol-marca"
                  />
                  {dia.nome}
                </label>
                <input
                  type="time"
                  value={d.ini}
                  disabled={!d.abre}
                  onChange={(e) => mudar(i, { ini: e.target.value })}
                  aria-label={`${dia.nome}: abre às`}
                  className="entrada !min-h-10 !px-2 font-mono"
                />
                <span className="text-[13px] text-farol-suave">às</span>
                <input
                  type="time"
                  value={d.fim}
                  disabled={!d.abre}
                  onChange={(e) => mudar(i, { fim: e.target.value })}
                  aria-label={`${dia.nome}: fecha às`}
                  className="entrada !min-h-10 !px-2 font-mono"
                />
                {nota && <small className="col-span-full -mt-0.5 pl-[27px] text-xs text-farol-suave">{nota}</small>}
              </li>
            );
          })}
        </ul>

        <button type="button" onClick={copiar} className="elo self-start text-[13px]">
          Copiar o primeiro dia aberto para os outros
        </button>

        <p className="text-[12.5px] text-farol-suave">
          Se a loja fecha depois da meia-noite, ponha a hora de fechar normalmente (01:00): o Farol entende que é no
          dia seguinte.
        </p>
        <p className="text-[12.5px] text-farol-suave">
          Sem nenhum dia marcado, a loja é tratada como{' '}
          <strong className="font-semibold text-farol-tinta">sempre aberta</strong>
          {nenhumDia
            ? ': critério “no horário” é conferido o tempo todo, e “fora do horário” não é conferido nunca.'
            : ' — é como funcionava antes de haver horário.'}
        </p>

        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}
