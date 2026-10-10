'use client';

// =====================================================================
// O estado do critério — observando · em ensaio · medido · valendo
// =====================================================================
// Só "valendo" avisa. A tela oferece o que uma pessoa pode fazer hoje
// (`api/src/estado.ts` e `api/src/familia.ts`):
//
//   - observando ⇄ em ensaio, quantas vezes quiser — num critério de Estado;
//   - "medido" e "valendo" só com o acerto medido, pelo banco de provas, que
//     ainda não existe: não há botão para eles;
//   - descer de "valendo" NÃO é oferecido: não há caminho de volta antes do
//     banco de provas, e um toque errado deixaria a loja sem o aviso. Para
//     parar um aviso, o caminho é desligar o critério — aqui mesmo;
//   - família que ainda não tem juiz só observa.
//
// Ligado ou desligado é outra coisa: o estado diz o que o critério LIGADO
// faz. Nada aqui acontece na hora: a troca fica marcada e vale ao salvar.
// =====================================================================

import { Check, Info } from 'lucide-react';

import { Botao } from '@/componentes/ui/botao';
import { Alerta, Chip, Liga } from '@/componentes/ui/pecas';
import type { EstadoDoCriterio } from '@/lib/api';

import { quandoChegaOJulgamento } from './familias';

const PASSOS: ReadonlyArray<{ valor: EstadoDoCriterio; titulo: string; faz: string; sai: string }> = [
  {
    valor: 'observando',
    titulo: 'Observando',
    faz: 'Só conta o que acontece: as olhadas, o contexto e o gatilho. Não julga e não gasta.',
    sai: 'Sai daqui quando você decide que vale julgar — o funil mostra quantas vezes por dia isso aconteceria.',
  },
  {
    valor: 'ensaio',
    titulo: 'Em ensaio',
    faz: 'Julga e mostra o resultado nas análises. Não avisa ninguém.',
    sai: 'Daqui só sobe com o acerto medido — pelo banco de provas, que chega na onda seguinte.',
  },
  {
    valor: 'medido',
    titulo: 'Medido',
    faz: 'Como o ensaio, com o acerto medido à vista. Ainda não há critério aqui: depende do banco de provas.',
    sai: 'A meta combinada para passar a valer: no máximo 1 alarme falso em 10 avisos.',
  },
  { valor: 'valendo', titulo: 'Valendo', faz: 'Julga, e o que estiver fora do critério vira aviso.', sai: '' },
];

type Props = {
  /** O estado guardado (o de agora). */
  guardado: EstadoDoCriterio;
  /** O estado que vai ser salvo. Diferente do guardado = troca marcada. */
  pendente: EstadoDoCriterio;
  aoMudar: (novo: EstadoDoCriterio) => void;
  /** Ligado ou desligado: o guardado e o que vai ser salvo. */
  ligadoGuardado: boolean;
  ligado: boolean;
  aoLigar: (novo: boolean) => void;
  nome: string;
  familia: string;
  /** Dá para voltar ao estado guardado sem o servidor recusar (família sem juiz só julga se já julgava assim). */
  podeDesfazer: boolean;
  /** O critério ainda não existe: nasce observando e ligado. */
  novo: boolean;
  configura: boolean;
  /** Julgado só na loja (presença, contagem): passar a ensaio não custa nuvem. */
  soNaLoja: boolean;
};

export function AbaDoEstado({ guardado, pendente, aoMudar, ligadoGuardado, ligado, aoLigar, nome, familia, podeDesfazer, novo, configura, soNaLoja }: Props) {
  const i = PASSOS.findIndex((p) => p.valor === pendente);
  const chega = quandoChegaOJulgamento(familia);
  const mudou = pendente !== guardado;
  // A consequência da troca, com o que o servidor faz de fato. Família sem juiz: quem observa não passa a
  // ensaio; e o critério de antes das famílias, que já julgava, não VOLTA ao ensaio depois de descer.
  const nota =
    chega !== null && guardado === 'observando'
      ? `O julgamento desta família ${chega}. Até lá, ele observa.`
      : chega !== null && mudou
        ? `Vale ao salvar. Ele para de julgar — e não volta ao ensaio: o julgamento desta família ${chega}.`
        : chega !== null
          ? `Ele já era julgado antes de as famílias existirem, e continua. Se voltar a só observar, não retorna ao ensaio: o julgamento desta família ${chega}.`
          : mudou && pendente === 'ensaio'
            ? `Vale ao salvar. Em ensaio ele passa a julgar cada cena nova${
                soNaLoja ? ', no computador da loja, sem custo' : ' — o que for à nuvem é pago; o teto por dia está na aba “O funil”'
              }. Não avisa ninguém.`
            : mudou
              ? 'Vale ao salvar. Ele para de julgar e volta a só contar.'
              : 'A troca só vale depois de salvar o critério.';

  return (
    <div className="flex flex-col gap-3.5" data-estado-guardado={guardado} data-estado-pendente={pendente}>
      {!novo && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-farol-borda bg-farol-painel-2 px-3 py-2">
          <Liga
            ligado={ligado}
            aoMudar={aoLigar}
            desabilitado={!configura}
            descricao={`Critério ${nome}`}
            rotulo={ligado ? 'Ligado' : 'Desligado'}
          />
          <p className="flex-[1_1_200px] text-[12.5px] text-farol-suave" data-nota-do-ligado>
            {ligado !== ligadoGuardado
              ? ligado
                ? 'Vale ao salvar: ligado, ele passa a fazer o que o estado abaixo diz.'
                : 'Vale ao salvar: desligado, ele não é conferido em canal nenhum.'
              : ligado
                ? 'O estado abaixo diz o que ele faz enquanto está ligado.'
                : 'Desligado, ele não é conferido: nada do que está abaixo acontece.'}
          </p>
        </div>
      )}

      <ol className="flex flex-col gap-0">
        {PASSOS.map((p, j) => {
          const feito = j < i;
          const agora = j === i;
          return (
            <li key={p.valor} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-3.5 last:pb-0" data-passo={p.valor} aria-current={agora ? 'step' : undefined}>
              <span
                className={`grid h-7 w-7 place-items-center rounded-full border text-[12.5px] font-semibold ${
                  agora
                    ? 'border-farol-marca bg-farol-marca text-farol-sobre-marca'
                    : feito
                      ? 'border-farol-ok bg-farol-ok-leve text-farol-ok'
                      : 'border-farol-borda-forte bg-farol-painel text-farol-suave'
                }`}
                aria-hidden
              >
                {feito ? <Check className="h-[15px] w-[15px]" /> : j + 1}
              </span>
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-semibold">
                  {p.titulo}
                  {agora && <Chip tom="atencao">{novo ? 'é onde ele nasce' : mudou ? 'ao salvar' : 'é onde está'}</Chip>}
                  {!agora && mudou && p.valor === guardado && <Chip>é onde está hoje</Chip>}
                </h3>
                <p className="text-[13px] text-farol-suave">{p.faz}</p>
                {p.sai && <p className="text-[12.5px] text-farol-suave">{p.sai}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {guardado === 'valendo' && !novo && (
        <Alerta icone={Info}>
          Este critério já avisa: <b className="font-semibold">continua valendo</b>. Para parar o aviso, desligue-o no
          interruptor acima — ligar de novo volta a avisar. Descer de “valendo” não é oferecido: ainda não há como
          voltar a ele sem o acerto medido.
        </Alerta>
      )}
      {guardado === 'medido' && !novo && (
        <Alerta icone={Info}>
          Este critério está medido. Passar a “valendo” depende do banco de provas, que ainda não chegou à tela.
        </Alerta>
      )}

      {configura && !novo && (guardado === 'observando' || guardado === 'ensaio') && (
        <div className="flex flex-wrap items-center gap-2.5">
          {pendente === 'observando' && (
            <Botao variante="primario" disabled={chega !== null} onClick={() => aoMudar('ensaio')} data-para-ensaio>
              Passar para em ensaio
            </Botao>
          )}
          {pendente === 'ensaio' && (
            <Botao onClick={() => aoMudar('observando')} data-para-observando>
              Voltar a só observar
            </Botao>
          )}
          {mudou && podeDesfazer && (
            <button type="button" className="elo text-[13px]" onClick={() => aoMudar(guardado)} data-desfazer-estado>
              Desfazer
            </button>
          )}
          <p className="flex-[1_1_220px] text-[12.5px] text-farol-suave" data-nota-do-estado>
            {nota}
          </p>
        </div>
      )}
      {novo && (
        <p className="text-[12.5px] text-farol-suave">
          Critério novo nasce <b className="font-semibold text-farol-tinta">observando</b> e ligado: conta as olhadas,
          o contexto e o gatilho, sem julgar e sem avisar.
        </p>
      )}
      <p className="text-[12.5px] text-farol-suave">Só “valendo” avisa. Nenhum critério chega lá sem o acerto medido.</p>
    </div>
  );
}
