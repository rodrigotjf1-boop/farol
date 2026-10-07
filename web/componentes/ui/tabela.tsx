// Tabela que vira cartões no celular.
//
// No computador é tabela de verdade: cabeçalho, colunas alinhadas, número
// à direita. No celular oito colunas não cabem, e rolar de lado esconde
// justamente a coluna que importa — então cada linha vira um cartão, com
// o nome da coluna escrito em cima de cada valor.
//
// A caixa que rola leva `relative`: o texto só-para-leitor de tela é
// posicionado em absoluto, e sem um ancestral posicionado ele escapa do
// corte e alarga a página inteira (já aconteceu: 761 px num celular de 375).

import type { ReactNode } from 'react';

import { CARTAO } from './pecas';

export type Coluna = { rotulo: string; numero?: boolean; soLeitor?: boolean };

export function Tabela({
  legenda,
  colunas,
  children,
}: {
  /** O que a tabela mostra, para quem não a vê. */
  legenda: string;
  colunas: Coluna[];
  children: ReactNode;
}) {
  return (
    <div className={`${CARTAO} relative overflow-x-auto`}>
      <table className="w-full border-collapse text-[13.5px] max-md:block">
        <caption className="sr-only">{legenda}</caption>
        <thead className="max-md:sr-only">
          <tr>
            {colunas.map((c) => (
              <th
                key={c.rotulo}
                scope="col"
                className={`whitespace-nowrap border-b border-farol-borda px-3.5 py-2.5 text-xs font-semibold text-farol-suave ${
                  c.numero ? 'text-right' : 'text-left'
                }`}
              >
                {c.soLeitor ? <span className="sr-only">{c.rotulo}</span> : c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-md:block [&>tr:last-child>td]:border-b-0 max-md:[&>tr:last-child]:border-b-0">{children}</tbody>
      </table>
    </div>
  );
}

export function Linha({ children, apagada = false }: { children: ReactNode; apagada?: boolean }) {
  return (
    <tr
      className={`transition-colors hover:bg-farol-painel-2 max-md:grid max-md:grid-cols-2 max-md:gap-x-3.5 max-md:gap-y-2 max-md:border-b max-md:border-farol-borda max-md:px-3.5 max-md:py-3 ${
        apagada ? 'opacity-45' : ''
      }`}
    >
      {children}
    </tr>
  );
}

export function Celula({
  rotulo,
  inteira = false,
  numero = false,
  acao = false,
  children,
}: {
  /** O nome da coluna, mostrado em cima do valor no celular. Sem ele, a
   *  célula é o título do cartão. */
  rotulo?: string;
  /** No celular, ocupa a largura toda do cartão. */
  inteira?: boolean;
  numero?: boolean;
  /** A coluna dos botões da linha: à direita, com a letra da interface.
   *  (Usar `numero` só para alinhar punha o botão em letra de código.) */
  acao?: boolean;
  children: ReactNode;
}) {
  return (
    <td
      data-r={rotulo}
      className={
        'border-b border-farol-borda px-3.5 py-3 align-middle max-md:block max-md:border-b-0 max-md:p-0 ' +
        (numero ? 'whitespace-nowrap text-right font-mono text-[12.5px] tabular-nums max-md:text-left ' : '') +
        (acao ? 'whitespace-nowrap text-right max-md:text-left ' : '') +
        (inteira ? 'max-md:col-span-2 ' : '') +
        (rotulo
          ? 'max-md:before:block max-md:before:font-sans max-md:before:text-[11.5px] max-md:before:font-medium max-md:before:text-farol-suave max-md:before:content-[attr(data-r)]'
          : '')
      }
    >
      {children}
    </td>
  );
}
