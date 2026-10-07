// Uma solução: marca, modelo, por que é deste nível, e quanto custa.

import type { Opcao } from '@/lib/api';

import { faixa, NOME_DO_NIVEL, origemDoPreco } from './rotulos';

export function CartaoDaOpcao({ opcao }: { opcao: Opcao }) {
  return (
    <div className="rounded-lg border border-farol-borda/70 bg-farol-fundo/60 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded bg-farol-borda/60 px-1.5 py-0.5 text-xs text-farol-suave">
          {NOME_DO_NIVEL[opcao.nivel]}
        </span>
        {opcao.recomendado && (
          <span className="rounded bg-farol-ok/15 px-1.5 py-0.5 text-xs text-farol-ok">
            recomendado
          </span>
        )}
      </div>
      <p className="mt-2 break-words text-sm font-medium">
        {opcao.fabricante} {opcao.modelo}
      </p>
      <p className="mt-1 text-xs text-farol-suave">{opcao.porque}</p>
      <p className="mt-2 text-sm">
        {opcao.preco ? (
          <>
            {faixa(opcao.preco)}{' '}
            <span className="text-xs text-farol-suave">· {origemDoPreco(opcao.preco)}</span>
          </>
        ) : (
          <span className="text-xs text-farol-suave">sem preço no catálogo</span>
        )}
      </p>
    </div>
  );
}
