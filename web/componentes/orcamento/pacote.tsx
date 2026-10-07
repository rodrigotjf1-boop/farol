// Um dos três pacotes: o total primeiro, depois o que entra nele.

import type { Pacote } from '@/lib/api';

import { faixa, NOME_DO_NIVEL, NOME_DO_PAPEL } from './rotulos';

export function CartaoDoPacote({ pacote }: { pacote: Pacote }) {
  const vazio = pacote.itens.length === 0;
  const { total } = pacote;

  return (
    <section className="flex flex-col rounded-xl border border-farol-borda bg-farol-painel p-4">
      <h3 className="text-sm font-medium text-farol-suave">Pacote {NOME_DO_NIVEL[pacote.nivel]}</h3>

      {vazio ? (
        <p className="mt-2 text-sm text-farol-suave">
          Nenhum canal em uso: não há o que orçar.
        </p>
      ) : (
        <>
          {/* Soma incompleta não pode parecer total. Um pacote com gravador e
              computador sem preço mostrava "R$ 535" no topo — o preço de uma
              câmera — e o aviso vinha em letra pequena embaixo. */}
          <p className="mt-1 font-mono text-xl">
            {faixa(total.geral)}
            {pacote.semPreco > 0 && (
              <span className="font-sans text-sm text-farol-atencao">
                {' '}
                + {pacote.semPreco === 1 ? '1 item' : `${pacote.semPreco} itens`} sem preço
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-farol-suave">
            câmeras {faixa(total.cameras)} · gravador e computador {faixa(total.infraestrutura)}
          </p>
          {pacote.semPreco > 0 && (
            <p className="mt-1 text-xs text-farol-atencao">
              A soma é parcial: o que não tem preço no catálogo não entrou nela.
            </p>
          )}

          <ul className="mt-4 space-y-3 border-t border-farol-borda pt-3 text-sm">
            {pacote.itens.map((i, n) => (
              <li key={`${i.papel}-${i.para}-${n}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs text-farol-suave">
                    {NOME_DO_PAPEL[i.papel] ?? i.papel}
                    {i.quantidade > 1 ? ` × ${i.quantidade}` : ''} · {i.para}
                  </span>
                </div>
                {i.opcao ? (
                  <p className="break-words">
                    {i.opcao.fabricante} {i.opcao.modelo}
                    <span className="text-farol-suave">
                      {' '}
                      · {i.opcao.preco ? faixa(i.opcao.preco) : 'sem preço'}
                    </span>
                  </p>
                ) : (
                  <p className="text-farol-atencao">nenhuma opção no catálogo</p>
                )}
                {i.observacao && <p className="text-xs text-farol-suave">{i.observacao}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
