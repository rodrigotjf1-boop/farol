'use client';

// O que ficou de fora de uma planilha — produto por produto, com a aba, a
// linha, o motivo e o que fazer. A mesma lista aparece em dois lugares: no
// passo "Conferir" da importação (antes de gravar) e, depois de importar,
// na gaveta que a tela Fichas abre.
//
// Decisão do dono (11/10/2026): "entra o que está certo e a tela lista o
// que ficou de fora". Quem decide o que fica de fora é o servidor.

import { useEffect, useState } from 'react';

import { diaFaladoNaLoja, frase, plural } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';
import { Alerta, Ossos } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, fichasApi, type ProblemaDaPlanilha, type ProdutoDeFora, type RelatorioDaPlanilha } from '@/lib/api';

function Problemas({ lista }: { lista: ProblemaDaPlanilha[] }) {
  return (
    <ul className="overflow-hidden rounded-[10px] border border-farol-borda">
      {lista.map((p, i) => (
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
      ))}
    </ul>
  );
}

/** A lista inteira: os produtos que ficaram de fora e, depois, as linhas que não são de produto nenhum. */
export function ListaDeFora({ deFora, soltos, problemas }: Pick<RelatorioDaPlanilha, 'deFora' | 'soltos' | 'problemas'>) {
  const mostrados = deFora.reduce((n, d) => n + d.problemas.length, 0) + soltos.length;
  return (
    <div className="flex flex-col gap-3.5" data-de-fora>
      {deFora.map((d: ProdutoDeFora) => (
        <section key={d.produto} className="flex min-w-0 flex-col gap-1.5" data-produto-de-fora>
          <h4 className="break-words text-[13.5px] font-semibold">{d.produto}</h4>
          {d.problemas.length > 0 && <Problemas lista={d.problemas} />}
        </section>
      ))}
      {soltos.length > 0 && (
        <section className="flex min-w-0 flex-col gap-1.5" data-soltos>
          <h4 className="text-[13.5px] font-semibold">Linhas que não são de nenhum produto</h4>
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

/** Depois de importar: a lista do que ficou de fora na última importação, para quem vai corrigir a planilha. */
export function GavetaDeFora({ lojaId, fuso, aoFechar }: { lojaId: string; fuso: string; aoFechar: () => void }) {
  type Registro = Awaited<ReturnType<typeof fichasApi.importacao>>;
  const [r, setR] = useState<Registro | null>(null);
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

  const linhas = r ? r.problemas : 0;
  return (
    <Gaveta
      titulo="O que ficou de fora"
      descricao={r ? `${r.arquivo || 'planilha'} · importada ${diaFaladoNaLoja(r.em, fuso)}, por ${r.por}` : undefined}
      aoFechar={aoFechar}
      rodape={
        <>
          <p className={`${AJUDA} min-w-0 flex-[1_1_220px]`}>Corrija na planilha e importe de novo: a importação troca todas as fichas da loja.</p>
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
            {plural(linhas, 'linha para corrigir', 'linhas para corrigir')}. Os outros produtos da planilha entraram.
          </p>
          <ListaDeFora deFora={r.deFora} soltos={r.soltos} problemas={r.problemas} />
        </>
      )}
    </Gaveta>
  );
}
