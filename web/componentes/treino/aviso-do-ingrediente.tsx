'use client';

// =====================================================================
// O aviso "pelo ingrediente", no topo de "Qual lanche era?"
// =====================================================================
// O protótipo "Sugestão pelo ingrediente", aprovado pelo dono em 06/11/2026
// (a regra em `sugestao-pelo-ingrediente.ts`). Quatro jeitos:
//   • um lanche: "O anel de cebola só vai no Numero 08 (…). Era ele?", com
//     "É o Numero 08" (só escolhe; quem confere ainda salva) e "Não é";
//     se ele também é adicional de outros produtos, a linha de baixo diz que o
//     cliente pode ter pedido — a exceção, que o pedido do KDS vai confirmar;
//   • escolhido: "Escolhido pelo ingrediente", com "Desfazer";
//   • dispensado: uma linha com "Mostrar de novo";
//   • únicos de lanches diferentes: os dois, sem escolher.
// =====================================================================

import { Botao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';

import { nomeDaFamilia, type IngredienteUnico, type SugestaoPeloIngrediente } from './sugestao-pelo-ingrediente';

const ETIQUETA = 'font-mono text-[11px] font-semibold uppercase tracking-[0.06em]';
const CAIXA = 'flex flex-col gap-2 rounded-xl border-[1.5px] px-3.5 py-3';

/** "em 2 lanches (X-Bacon e X-Salada)" — até 3 nomes; depois, só a conta. */
function emQuais(produtos: string[]): string {
  const n = produtos.length;
  const nomes = n <= 3 ? ` (${produtos.slice(0, -1).join(', ')}${n > 1 ? ' e ' : ''}${produtos[n - 1]})` : '';
  return `em ${n} ${n === 1 ? 'lanche' : 'lanches'}${nomes}`;
}

function Ingrediente({ u }: { u: IngredienteUnico }) {
  return <b className="font-semibold">{u.ingrediente.toLowerCase()}</b>;
}

export function AvisoDoIngrediente({
  id,
  sugestao,
  escolhida,
  dispensada,
  naoEraUmLanche,
  aoEscolher,
  aoDispensar,
  aoMostrar,
  aoDesfazer,
}: {
  id: string;
  sugestao: SugestaoPeloIngrediente;
  /** A família sugerida já é a escolha de "Qual lanche era?". */
  escolhida: boolean;
  dispensada: boolean;
  /** Quem confere escolheu "Não era um lanche": o aviso dá lugar ao lembrete embaixo das opções. */
  naoEraUmLanche: boolean;
  aoEscolher: (familia: string[]) => void;
  aoDispensar: () => void;
  aoMostrar: () => void;
  aoDesfazer: () => void;
}) {
  if (sugestao.tipo === 'nenhuma' || naoEraUmLanche) return null;
  if (sugestao.tipo === 'varios') {
    return (
      <div id={id} className={`${CAIXA} border-farol-facho bg-farol-facho-leve`} role="status" data-sugestao-pelo-ingrediente="varios">
        <span className={`${ETIQUETA} text-farol-facho-tinta`}>Dois lanches diferentes</span>{' '}
        <p className="text-sm leading-snug">
          <span>
            {sugestao.opcoes.map((u, i) => (
              <span key={u.ingrediente}>
                {i > 0 ? '; o ' : 'O '}
                <Ingrediente u={u} /> só vai no <b className="font-semibold">{u.familia[0]}</b>
              </span>
            ))}
            . Os dois não cabem num lanche só: pode ser a peça de um vizinho no lugar, ou um adicional. Escolha você.
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {sugestao.opcoes.map((u) => (
            <Botao key={u.ingrediente} mini onClick={() => aoEscolher(u.familia)} className="max-w-full whitespace-normal text-left">
              É o {u.familia[0]}
            </Botao>
          ))}
        </div>
      </div>
    );
  }
  const principal = sugestao.familia[0]!;
  if (escolhida) {
    return (
      <div id={id} className={`${CAIXA} border-farol-ok bg-farol-ok-leve`} role="status" data-sugestao-pelo-ingrediente="escolhida">
        <span className={`${ETIQUETA} text-farol-ok`}>Escolhido pelo ingrediente</span>{' '}
        <p className="text-sm leading-snug">
          <span>
            <b className="font-semibold">{principal}</b> marcado na escolha abaixo. Confira os passos e salve.
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Botao mini variante="fantasma" onClick={aoDesfazer} className="underline underline-offset-[3px]">
            Desfazer
          </Botao>
        </div>
      </div>
    );
  }
  if (dispensada) {
    return (
      <p id={id} className={`${AJUDA} flex flex-wrap items-center gap-x-2 gap-y-1`} data-sugestao-pelo-ingrediente="dispensada">
        <span>Sugestão do {principal} dispensada.</span>
        <Botao mini variante="fantasma" onClick={aoMostrar} className="underline underline-offset-[3px]">
          Mostrar de novo
        </Botao>
      </p>
    );
  }
  const pelo = sugestao.pelos[0]!;
  const adicionalEm = [...new Set(sugestao.pelos.flatMap((u) => u.adicionalEm))];
  return (
    <div id={id} className={`${CAIXA} border-farol-facho bg-farol-facho-leve`} role="status" data-sugestao-pelo-ingrediente="lanche">
      {/* o espaço depois da etiqueta: o texto da página não cola "Pelo ingrediente" na frase (ERR-164) */}
      <span className={`${ETIQUETA} text-farol-facho-tinta`}>Pelo ingrediente</span>{' '}
      <p className="text-sm leading-snug">
        <span>
          O <Ingrediente u={pelo} /> só vai no <b className="font-semibold">{nomeDaFamilia(sugestao.familia)}</b>. Era ele?
        </span>
      </p>
      {sugestao.adicional && (
        <p className={AJUDA} data-aviso-de-adicional>
          Ele também é adicional {emQuais(adicionalEm)}: o cliente pode ter pedido. É a exceção — quando o pedido vier do KDS, ele vai dizer.
        </p>
      )}
      {sugestao.deixados.map((u) => (
        <p key={u.ingrediente} className={AJUDA} data-ingrediente-deixado>
          Você marcou também o <Ingrediente u={u} />, que só está na ficha do {u.familia[0]}, mas é adicional {emQuais(u.adicionalEm)}: aqui ele deve ter sido
          pedido do cliente.
        </p>
      ))}
      {sugestao.familia.length > 1 && (
        <p className={AJUDA}>
          A bancada não separa o {principal} do {sugestao.familia.slice(1).join(' nem do ')}: para o placar, é o mesmo lanche.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao mini variante="primario" onClick={() => aoEscolher(sugestao.familia)} className="max-w-full whitespace-normal text-left" data-e-este>
          É o {principal}
        </Botao>
        <Botao mini onClick={aoDispensar} data-nao-e>
          Não é
        </Botao>
      </div>
    </div>
  );
}

/** O lembrete embaixo das opções, quando quem confere escolheu "Não era um lanche" com um único marcado. */
export function LembreteDoIngrediente({ sugestao, aoEscolher }: { sugestao: SugestaoPeloIngrediente; aoEscolher: (familia: string[]) => void }) {
  if (sugestao.tipo !== 'lanche') return null;
  const principal = sugestao.familia[0]!;
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-[10px] border border-dashed border-farol-borda-forte px-2.5 py-2 text-[13px]" role="status" data-lembrete-do-ingrediente>
      <span className="min-w-0">
        Você marcou <Ingrediente u={sugestao.pelos[0]!} />, que só vai no {principal}. Era um {principal} incompleto?
      </span>
      <Botao mini variante="fantasma" onClick={() => aoEscolher(sugestao.familia)} className="underline underline-offset-[3px]">
        Escolher o {principal}
      </Botao>
    </p>
  );
}
