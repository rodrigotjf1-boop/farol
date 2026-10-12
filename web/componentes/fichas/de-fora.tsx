'use client';

// O que ficou de fora — produto por produto, com o lugar, o motivo e (na
// planilha) o que fazer. A mesma lista aparece em dois lugares: no passo
// "Conferir" da importação por planilha (antes de gravar) e, depois, na
// gaveta que a tela Fichas abre — para a planilha importada e para o envio
// de outro sistema.
//
// Decisão do dono (11/10/2026): "entra o que está certo e a tela lista o
// que ficou de fora". Quem decide o que fica de fora é o servidor. O lugar
// do problema é dito como quem vai corrigir o procura: na planilha, a aba e
// a linha; no envio de outro sistema, o caminho no que foi enviado.

import { useEffect, useState } from 'react';

import { diaFaladoNaLoja, frase, plural } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';
import { Alerta, Ossos } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, fichasApi, type ProblemaDaPlanilha, type ProblemaDoEnvio, type RegistroDoQueFicouDeFora } from '@/lib/api';

type Problema = ProblemaDaPlanilha | ProblemaDoEnvio;
const doEnvio = (p: Problema): p is ProblemaDoEnvio => 'onde' in p;

function Problemas({ lista }: { lista: Problema[] }) {
  return (
    <ul className="overflow-hidden rounded-[10px] border border-farol-borda">
      {lista.map((p, i) =>
        doEnvio(p) ? (
          // O caminho no envio é comprido (`produtos[12].ingredientes[3]`): fica em linha própria, e quebra onde precisar.
          <li key={`${p.onde}-${i}`} className="grid grid-cols-1 gap-y-0.5 border-b border-farol-borda px-3 py-2.5 last:border-b-0">
            <span className="break-all font-mono text-xs leading-5 text-farol-critico">{p.onde}</span>
            <span className="block break-words text-[13.5px]">{frase(p.texto)}</span>
          </li>
        ) : (
          // O mesmo problema pode repetir na mesma linha em abas diferentes: a posição desempata.
          <li key={`${p.aba}-${p.linha}-${i}`} className="grid grid-cols-1 gap-x-3 gap-y-0.5 border-b border-farol-borda px-3 py-2.5 last:border-b-0 sm:grid-cols-[176px_minmax(0,1fr)]">
            {/* 176px: cabe "Adicionais, linha 12345" numa linha só, sem quebrar o número para baixo. */}
            <span className="font-mono text-xs leading-5 text-farol-critico sm:whitespace-nowrap">
              {p.aba}, linha {p.linha}
            </span>
            <span className="min-w-0">
              <span className="block break-words text-[13.5px]">{frase(p.texto)}</span>
              <small className="block break-words text-xs text-farol-suave">{p.corrigir}</small>
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

/** A lista inteira: os produtos que ficaram de fora e, depois, o que não é de produto nenhum. */
export function ListaDeFora({
  deFora,
  soltos,
  problemas,
}: {
  deFora: Array<{ produto: string; problemas: Problema[] }>;
  soltos: Problema[];
  /** Quantos problemas ao todo (a lista pode vir cortada). */
  problemas: number;
}) {
  const mostrados = deFora.reduce((n, d) => n + d.problemas.length, 0) + soltos.length;
  return (
    <div className="flex flex-col gap-3.5" data-de-fora>
      {deFora.map((d) => (
        <section key={d.produto} className="flex min-w-0 flex-col gap-1.5" data-produto-de-fora>
          <h4 className="break-words text-[13.5px] font-semibold">{d.produto}</h4>
          {d.problemas.length > 0 && <Problemas lista={d.problemas} />}
        </section>
      ))}
      {soltos.length > 0 && (
        <section className="flex min-w-0 flex-col gap-1.5" data-soltos>
          <h4 className="text-[13.5px] font-semibold">{soltos.some(doEnvio) ? 'O que não é de nenhum produto' : 'Linhas que não são de nenhum produto'}</h4>
          <Problemas lista={soltos} />
        </section>
      )}
      {mostrados < problemas && (
        <p className={AJUDA}>
          A lista mostra os primeiros {mostrados} problemas, de {problemas}. Corrija estes e envie de novo para ver os outros.
        </p>
      )}
    </div>
  );
}

/** Depois de importar (ou de o outro sistema enviar): a lista do que ficou de fora, para quem vai corrigir. */
export function GavetaDeFora({ lojaId, fuso, aoFechar }: { lojaId: string; fuso: string; aoFechar: () => void }) {
  const [r, setR] = useState<RegistroDoQueFicouDeFora | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fichasApi
      .importacao(lojaId)
      .then((x) => vivo && setR(x))
      .catch((e) => vivo && setErro(frase(e instanceof ErroDaApi ? e.message : 'não deu para carregar a lista')));
    return () => {
      vivo = false;
    };
  }, [lojaId]);

  const doSistema = r?.origem === 'sistema';
  const quando = r ? diaFaladoNaLoja(r.em, fuso) : '';
  return (
    <Gaveta
      titulo="O que ficou de fora"
      descricao={r ? (doSistema ? `${r.por} · recebido ${quando}` : `${r.arquivo || 'planilha'} · importada ${quando}, por ${r.por}`) : undefined}
      aoFechar={aoFechar}
      rodape={
        <>
          <p className={`${AJUDA} min-w-0 flex-[1_1_220px]`}>
            {!r
              ? ''
              : doSistema
                ? `Quem corrige é quem cuida do ${r.por}. No envio seguinte, o que estiver certo entra.`
                : 'Corrija na planilha e importe de novo: a importação troca todas as fichas da loja.'}
          </p>
          <Botao onClick={aoFechar}>Fechar</Botao>
        </>
      }
    >
      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      )}
      {!r && !erro && <Ossos alturas={[40, 160]} />}
      {r && (
        <>
          <p className="text-[13.5px]" data-resumo-de-fora>
            {r.deFora.length > 0 ? `${plural(r.deFora.length, 'produto', 'produtos')} e ` : ''}
            {doSistema ? plural(r.problemas, 'item para corrigir', 'itens para corrigir') : plural(r.problemas, 'linha para corrigir', 'linhas para corrigir')}. Os outros
            produtos {doSistema ? 'do envio' : 'da planilha'} entraram.
          </p>
          <ListaDeFora deFora={r.deFora} soltos={r.soltos} problemas={r.problemas} />
        </>
      )}
    </Gaveta>
  );
}
