'use client';

// Tabela que vira cartões quando não cabe.
//
// Com espaço, é tabela de verdade: cabeçalho, colunas alinhadas, número à
// direita. Sem espaço, rolar de lado esconderia justamente a coluna que
// importa — então cada linha vira um cartão, com o nome da coluna escrito em
// cima de cada valor.
//
// **Quem decide é o espaço da PEÇA, não a largura da tela.** A tabela mede a
// si mesma: se, como tabela, ela precisa de mais largura do que a caixa tem,
// vira cartões. Decidir pela tela errava no meio do caminho — num tablet ou
// num notebook, com o menu ao lado, uma tabela de nove colunas tinha menos
// espaço do que precisava e ganhava uma barra de rolagem (de 768 a 1.280 px,
// no Painel). E a largura de que ela precisa muda com o que está escrito
// nela: não há número de tela que sirva para toda loja.
//
// A caixa leva `relative`: o texto só-para-leitor de tela é posicionado em
// absoluto, e sem um ancestral posicionado ele escapa do corte e alarga a
// página inteira (já aconteceu: 761 px num celular de 375).

import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';

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
  const caixa = useRef<HTMLDivElement>(null);

  // Mede COMO TABELA (é a largura de que ela precisa) e diz o modo na
  // própria caixa (`data-modo`), que é por onde as linhas e as células sabem
  // como se mostrar. Tudo antes de a tela ser pintada: não há troca à vista.
  const medir = useCallback(() => {
    const el = caixa.current;
    const tabela = el?.querySelector('table');
    if (!el || !tabela) return;
    el.dataset.modo = 'tabela';
    el.dataset.modo = tabela.scrollWidth <= el.clientWidth + 1 ? 'tabela' : 'cartoes';
  }, []);

  // A cada vez que a tabela é desenhada: as linhas podem ter mudado.
  useLayoutEffect(medir);
  // E quando a caixa muda de LARGURA (a janela, o menu que abre e fecha).
  // Trocar de modo muda a altura da caixa: por isso só a largura conta, e a
  // medida é feita no quadro seguinte — mexer no tamanho de quem está sendo
  // observado, de dentro do aviso, faz o navegador acusar um laço.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    let largura = el.clientWidth;
    let pedido = 0;
    const olho = new ResizeObserver(() => {
      if (el.clientWidth === largura) return;
      largura = el.clientWidth;
      cancelAnimationFrame(pedido);
      pedido = requestAnimationFrame(medir);
    });
    olho.observe(el);
    return () => {
      cancelAnimationFrame(pedido);
      olho.disconnect();
    };
  }, [medir]);

  return (
    <div ref={caixa} className={`${CARTAO} group/t relative overflow-x-auto`}>
      <table className="w-full border-collapse text-[13.5px] group-data-[modo=cartoes]/t:block">
        <caption className="sr-only">{legenda}</caption>
        <thead className="group-data-[modo=cartoes]/t:sr-only">
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
        <tbody className="group-data-[modo=cartoes]/t:block [&>tr:last-child>td]:border-b-0 group-data-[modo=cartoes]/t:[&>tr:last-child]:border-b-0">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Linha({
  children,
  apagada = false,
  total = false,
}: {
  children: ReactNode;
  apagada?: boolean;
  /** A linha que soma as outras: fica no fim, em negrito, sobre um fundo. */
  total?: boolean;
}) {
  return (
    <tr
      className={`transition-colors hover:bg-farol-painel-2 group-data-[modo=cartoes]/t:grid group-data-[modo=cartoes]/t:grid-cols-2 group-data-[modo=cartoes]/t:gap-x-3.5 group-data-[modo=cartoes]/t:gap-y-2 group-data-[modo=cartoes]/t:border-b group-data-[modo=cartoes]/t:border-farol-borda group-data-[modo=cartoes]/t:px-3.5 group-data-[modo=cartoes]/t:py-3 md:group-data-[modo=cartoes]/t:grid-cols-4 ${
        apagada ? 'opacity-45' : ''
      } ${total ? 'bg-farol-painel-2 font-semibold group-data-[modo=tabela]/t:[&>td]:border-t group-data-[modo=tabela]/t:[&>td]:border-t-farol-borda-forte' : ''}`}
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
  vazia = false,
  children,
}: {
  /** O nome da coluna, mostrado em cima do valor quando a linha é um cartão.
   *  Sem ele, a célula é o título do cartão. */
  rotulo?: string;
  /** No cartão, ocupa mais largura: a linha toda no celular, metade dela
   *  quando o cartão é largo. O título (sem rótulo) ocupa sempre a linha toda. */
  inteira?: boolean;
  numero?: boolean;
  /** A coluna dos botões da linha: à direita, com a letra da interface.
   *  (Usar `numero` só para alinhar punha o botão em letra de código.) */
  acao?: boolean;
  /** Coluna sem valor nesta linha (o total não tem canal): na tabela ocupa
   *  o lugar dela; no cartão, some. */
  vazia?: boolean;
  children?: ReactNode;
}) {
  return (
    <td
      data-r={rotulo}
      className={
        'border-b border-farol-borda px-3.5 py-3 align-middle group-data-[modo=cartoes]/t:block group-data-[modo=cartoes]/t:border-b-0 group-data-[modo=cartoes]/t:p-0 ' +
        (numero
          ? 'whitespace-nowrap text-right font-mono text-[12.5px] tabular-nums group-data-[modo=cartoes]/t:text-left '
          : '') +
        (acao ? 'whitespace-nowrap text-right group-data-[modo=cartoes]/t:text-left ' : '') +
        (inteira ? (rotulo ? 'group-data-[modo=cartoes]/t:col-span-2 ' : 'group-data-[modo=cartoes]/t:col-span-full ') : '') +
        (vazia ? 'group-data-[modo=cartoes]/t:!hidden ' : '') +
        (rotulo
          ? // O nome da coluna quebra a linha mesmo na célula de número (que não quebra): rótulo comprido,
            // em meio cartão de celular, passava da caixa.
            'group-data-[modo=cartoes]/t:before:block group-data-[modo=cartoes]/t:before:whitespace-normal group-data-[modo=cartoes]/t:before:font-sans group-data-[modo=cartoes]/t:before:text-[11.5px] group-data-[modo=cartoes]/t:before:font-medium group-data-[modo=cartoes]/t:before:text-farol-suave group-data-[modo=cartoes]/t:before:content-[attr(data-r)]'
          : '')
      }
    >
      {children}
    </td>
  );
}
