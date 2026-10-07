// Uma solução: marca, modelo, por que é deste nível, e quanto custa.

import { BadgeCheck } from 'lucide-react';

import { Chip } from '@/componentes/ui/pecas';
import type { Opcao } from '@/lib/api';

import { faixa, NOME_DO_NIVEL, origemDoPreco } from './rotulos';

export function CartaoDaOpcao({ opcao }: { opcao: Opcao }) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-xl border p-3 ${
        opcao.recomendado
          ? 'border-farol-marca bg-farol-painel shadow-[inset_0_0_0_1px_rgb(var(--marca))]'
          : 'border-farol-borda bg-farol-painel-2'
      }`}
    >
      <div className="flex flex-wrap gap-1.5">
        <Chip>{NOME_DO_NIVEL[opcao.nivel]}</Chip>
        {opcao.recomendado && (
          <Chip tom="ok" icone={BadgeCheck}>
            indicada
          </Chip>
        )}
      </div>
      <b className="break-words font-semibold">
        {opcao.fabricante} {opcao.modelo}
      </b>
      <p className="text-[12.5px] text-farol-suave">{opcao.porque}</p>
      <p className="mt-auto pt-1 text-[14.5px] font-semibold tabular-nums">
        {opcao.preco ? (
          <>
            {faixa(opcao.preco)}
            <small className="block text-[11.5px] font-normal text-farol-suave">{origemDoPreco(opcao.preco)}</small>
          </>
        ) : (
          <small className="text-xs font-normal text-farol-suave">sem preço no catálogo</small>
        )}
      </p>
    </div>
  );
}
