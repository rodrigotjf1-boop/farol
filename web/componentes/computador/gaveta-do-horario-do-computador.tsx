'use client';

// =====================================================================
// A gaveta do horário do computador da loja (A22)
// =====================================================================
// Do protótipo aprovado em 16/10/2026: o liga/desliga "Dormir e acordar
// sozinho", "Sugerir pelo horário da loja" (1 hora depois de fechar e 1 hora
// antes de abrir — a decisão do dono), a hora de dormir e a de acordar de
// cada dia, e a semana desenhada. Não salva com ele dormindo com a loja
// aberta.
//
// A conta é da API: a cada mudança, a gaveta pede a semana do rascunho
// (`conferir`) e desenha o que veio. Quem salva confere de novo.
// =====================================================================

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { Alerta, Liga } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import {
  consoleApi,
  ErroDaApi,
  type ChoqueDoDia,
  type DiaDesenhado,
  type DiaDoComputador,
  type HorarioDoComputador,
  type TelaDoComputador,
} from '@/lib/api';

import { DIAS_CURTOS, DIAS_LONGOS, SemanaDoComputador } from './semana-do-computador';

const VAZIO: DiaDoComputador[] = [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, dorme: null, acorda: null }));

/** O rascunho com que a gaveta abre: o salvo; sem ele, a sugestão; sem horário da loja, os dias vazios. */
function rascunhoInicial(tela: TelaDoComputador): HorarioDoComputador {
  if (tela.horario) return { ligado: tela.horario.ligado, dias: tela.horario.dias.map((d) => ({ ...d })) };
  if (tela.sugestao) return { ligado: true, dias: tela.sugestao.dias.map((d) => ({ ...d })) };
  return { ligado: true, dias: VAZIO.map((d) => ({ ...d })) };
}

export function GavetaDoHorarioDoComputador({
  lojaId,
  tela,
  aoSalvar,
  aoFechar,
}: {
  lojaId: string;
  tela: TelaDoComputador;
  aoSalvar: (nova: TelaDoComputador, mensagem: string) => void;
  aoFechar: () => void;
}) {
  const p = useId();
  const avisar = useAvisar();
  const [rascunho, setRascunho] = useState<HorarioDoComputador>(() => rascunhoInicial(tela));
  const [semana, setSemana] = useState<DiaDesenhado[]>(tela.semana);
  const [choques, setChoques] = useState<ChoqueDoDia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const pedido = useRef(0);

  // A semana do rascunho, pela API, um instante depois da última mudança (a resposta velha não sobrescreve a nova).
  useEffect(() => {
    const meu = ++pedido.current;
    const t = window.setTimeout(() => {
      consoleApi
        .conferirHorarioDoComputador(lojaId, rascunho)
        .then((r) => {
          if (meu !== pedido.current) return;
          setSemana(r.semana);
          setChoques(r.choques);
        })
        .catch(() => {
          /* o rascunho torto (hora pela metade) fica sem redesenho até a próxima mudança */
        });
    }, 250);
    return () => window.clearTimeout(t);
  }, [lojaId, rascunho]);

  const mudarDia = (dia: number, campo: 'dorme' | 'acorda', valor: string) =>
    setRascunho((r) => ({ ...r, dias: r.dias.map((d) => (d.dia === dia ? { ...d, [campo]: valor || null } : d)) }));

  function sugerir() {
    if (!tela.sugestao) return;
    setRascunho((r) => ({ ...r, dias: tela.sugestao!.dias.map((d) => ({ ...d })) }));
    avisar('Sugerido pelo horário da loja: acorda 1 hora antes de abrir e dorme 1 hora depois de fechar.');
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const nova = await consoleApi.salvarHorarioDoComputador(lojaId, rascunho);
      const sabe = nova.agente?.sabeDormir === true;
      aoSalvar(
        nova,
        !rascunho.ligado
          ? 'Horário desligado: o computador fica ligado o tempo todo.'
          : sabe
            ? 'Horário salvo. O computador recebe na próxima batida.'
            : 'Horário salvo. Ele vale quando o pacote novo for instalado no computador da loja.',
      );
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  const ruins = rascunho.ligado ? new Set(choques.map((c) => c.dia)).size : 0;
  const sabeDormir = tela.agente?.sabeDormir === true;

  return (
    <Gaveta
      titulo="Horário do computador"
      descricao="Quando ele dorme e quando acorda, no relógio da loja."
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <p className="mr-auto min-w-0 flex-[1_1_220px] text-[12.5px] text-farol-suave" data-pe-do-horario>
            {rascunho.ligado && ruins > 0
              ? `Em ${ruins === 1 ? '1 dia' : `${ruins} dias`} ele dormiria com a loja aberta: ajuste para salvar.`
              : sabeDormir
                ? 'Ele recebe o horário na próxima batida (em até 30 segundos).'
                : 'O horário fica guardado e vale quando o pacote novo for instalado.'}
          </p>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando} disabled={rascunho.ligado && ruins > 0}>
            {salvando ? 'Salvando…' : 'Salvar o horário'}
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={salvar} className="flex flex-col gap-4" aria-label="Horário do computador">
        {!sabeDormir && (
          <Alerta tom="atencao">
            O computador da loja ainda não sabe dormir e acordar sozinho: o horário fica guardado e vale quando o pacote
            novo for instalado nele.
          </Alerta>
        )}
        {!tela.temHorarioDaLoja && (
          <Alerta tom="critico">
            Informe antes o horário de funcionamento da loja, em{' '}
            <Link href={`/lojas/${lojaId}/regras`} className="elo">
              Critérios
            </Link>
            : sem ele, a loja vale como sempre aberta, e ele não pode dormir.
          </Alerta>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2" data-liga-do-horario>
          <span className="min-w-0">
            <b className="block font-semibold">Dormir e acordar sozinho</b>
            <small className="text-[12.5px] text-farol-suave">
              {rascunho.ligado ? 'Ele dorme e acorda nos horários abaixo.' : 'Desligado: o computador fica ligado o tempo todo.'}
            </small>
          </span>
          <Liga
            ligado={rascunho.ligado}
            aoMudar={(ligado) => setRascunho((r) => ({ ...r, ligado }))}
            descricao="Dormir e acordar sozinho"
            rotulo={rascunho.ligado ? 'Ligado' : 'Desligado'}
          />
        </div>

        {rascunho.ligado && (
          <>
            {tela.sugestao && (
              <Botao mini onClick={sugerir} className="self-start" data-sugerir>
                Sugerir pelo horário da loja
              </Botao>
            )}
            <div role="group" aria-label="Os horários de cada dia" className="flex flex-col gap-2">
              <div aria-hidden className="grid grid-cols-[52px_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[12.5px] font-medium text-farol-suave max-[380px]:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)]">
                <span />
                <span>Dorme às</span>
                <span>Acorda às</span>
              </div>
              {rascunho.dias.map((d) => {
                const doDia = choques.filter((c) => c.dia === d.dia);
                const nome = DIAS_LONGOS[d.dia - 1];
                return (
                  <div
                    key={d.dia}
                    data-dia-do-horario={d.dia}
                    className="grid grid-cols-[52px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 max-[380px]:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <b className="font-semibold">{DIAS_CURTOS[d.dia - 1]}</b>
                    <input
                      type="time"
                      value={d.dorme ?? ''}
                      onChange={(e) => mudarDia(d.dia, 'dorme', e.target.value)}
                      aria-label={`${nome}: dorme às`}
                      aria-invalid={doDia.length > 0 || undefined}
                      aria-describedby={doDia.length ? `${p}-erro-${d.dia}` : undefined}
                      className={`entrada !min-h-10 min-w-0 !px-2 font-mono ${doDia.length ? '!border-farol-critico' : ''}`}
                    />
                    <input
                      type="time"
                      value={d.acorda ?? ''}
                      onChange={(e) => mudarDia(d.dia, 'acorda', e.target.value)}
                      aria-label={`${nome}: acorda às`}
                      className={`entrada !min-h-10 min-w-0 !px-2 font-mono ${doDia.length ? '!border-farol-critico' : ''}`}
                    />
                    {doDia.length > 0 && (
                      <span id={`${p}-erro-${d.dia}`} className="col-start-2 col-end-4 text-[12.5px] text-farol-critico">
                        Dormiria com a loja aberta {doDia.map((c) => `das ${c.de} às ${c.ate}`).join(' e ')}.
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[12.5px] text-farol-suave">
              Deixe em branco o que não acontece naquele dia: sem a hora de acordar, ele dorme até a próxima hora de
              acordar.
            </p>
            <div className="flex flex-col gap-2">
              <span className="text-[12.5px] font-medium text-farol-suave">A semana, desenhada</span>
              <SemanaDoComputador semana={semana} dias={rascunho.dias} />
            </div>
          </>
        )}

        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}
