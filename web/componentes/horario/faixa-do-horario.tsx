// A faixa do horário de funcionamento, no topo da tela de critérios: quando
// a loja abre, se está aberta agora, e o botão para mudar.

import { Clock, Moon, Pencil } from 'lucide-react';

import { Botao } from '@/componentes/ui/botao';
import { CARTAO, Chip, Ponto } from '@/componentes/ui/pecas';
import type { LojaResumo } from '@/lib/api';

import { resumoDoHorario } from './semana';

type Props = {
  loja: Pick<LojaResumo, 'horario_funcionamento' | 'aberta_agora' | 'fecha_as'>;
  configura: boolean;
  aoEditar: () => void;
};

export function FaixaDoHorario({ loja, configura, aoEditar }: Props) {
  const resumo = resumoDoHorario(loja.horario_funcionamento);

  return (
    <>
      <section aria-labelledby="t-horario" className={`${CARTAO} flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4 py-3.5`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-farol-realce text-farol-marca">
          <Clock className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-[1_1_240px]">
          <h2 id="t-horario" className="text-[15px] font-semibold">
            Horário de funcionamento
          </h2>
          <p className="break-words text-[13px] text-farol-suave">
            {resumo ?? 'Não informado: a loja é tratada como sempre aberta.'}
          </p>
        </div>
        {loja.aberta_agora === true && (
          <Chip tom="ok">
            <Ponto tom="ok" pulsa />
            aberta agora{loja.fecha_as ? ` · fecha às ${loja.fecha_as}` : ''}
          </Chip>
        )}
        {loja.aberta_agora === false && <Chip icone={Moon}>fechada agora</Chip>}
        {loja.aberta_agora === null && <Chip tom="atencao">sem horário informado</Chip>}
        {configura && (
          <Botao mini onClick={aoEditar}>
            <Pencil className="h-[15px] w-[15px]" aria-hidden />
            {resumo ? 'Editar horário' : 'Informar horário'}
          </Botao>
        )}
      </section>
      <p className="max-w-[80ch] text-[12.5px] text-farol-suave">
        Cada critério diz em que horário é conferido: <strong className="font-semibold text-farol-tinta">no horário</strong>{' '}
        (só com a loja aberta), <strong className="font-semibold text-farol-tinta">fora do horário</strong> (só com ela
        fechada) ou <strong className="font-semibold text-farol-tinta">sempre</strong>. Fora da sua hora, o critério não
        é olhado e não avisa.
      </p>
    </>
  );
}
