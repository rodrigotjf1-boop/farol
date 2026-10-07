// Um dos três pacotes: o total primeiro, depois o que entra nele.

import { CARTAO, Chip } from '@/componentes/ui/pecas';
import type { Pacote } from '@/lib/api';

import { faixa, NOME_DO_NIVEL, NOME_DO_PAPEL } from './rotulos';

export function CartaoDoPacote({ pacote }: { pacote: Pacote }) {
  const vazio = pacote.itens.length === 0;
  const { total } = pacote;

  return (
    <section className={`${CARTAO} flex flex-col gap-1.5 p-[18px]`}>
      <div>
        <Chip>Pacote {NOME_DO_NIVEL[pacote.nivel].toLowerCase()}</Chip>
      </div>

      {vazio ? (
        <p className="text-farol-suave">Nenhum canal em uso: não há o que orçar.</p>
      ) : (
        <>
          {/* Soma incompleta não pode parecer total. Um pacote com gravador e
              computador sem preço mostrava "R$ 535" no topo — o preço de uma
              câmera — e o aviso vinha em letra pequena embaixo. */}
          <p className="font-display text-2xl font-semibold leading-tight tracking-tight tabular-nums">
            {faixa(total.geral)}
            {pacote.semPreco > 0 && (
              <span className="font-sans text-sm font-medium tracking-normal text-farol-facho-tinta">
                {' '}
                + {pacote.semPreco === 1 ? '1 item' : `${pacote.semPreco} itens`} sem preço
              </span>
            )}
          </p>
          <p className="text-[13px] text-farol-suave">
            câmeras {faixa(total.cameras)} · gravador e computador {faixa(total.infraestrutura)}
          </p>
          {pacote.semPreco > 0 && (
            <p className="text-xs text-farol-facho-tinta">
              A soma é parcial: o que não tem preço no catálogo não entrou nela.
            </p>
          )}

          <ul className="mt-2.5 flex flex-col gap-2.5 border-t border-farol-borda pt-3 text-[13px]">
            {pacote.itens.map((i, n) => (
              <li key={`${i.papel}-${i.para}-${n}`}>
                {i.opcao ? (
                  <span className="break-words">
                    {i.quantidade > 1 ? `${i.quantidade} × ` : ''}
                    {i.opcao.fabricante} {i.opcao.modelo}
                    <span className="text-farol-suave"> · {i.opcao.preco ? faixa(i.opcao.preco) : 'sem preço'}</span>
                  </span>
                ) : (
                  <span className="text-farol-facho-tinta">nenhuma opção no catálogo</span>
                )}
                <small className="block text-xs text-farol-suave">
                  {NOME_DO_PAPEL[i.papel] ?? i.papel} · {i.para}
                  {i.observacao ? ` · ${i.observacao}` : ''}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
