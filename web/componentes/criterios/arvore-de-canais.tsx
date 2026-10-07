'use client';

// =====================================================================
// A árvore de canais — onde o critério vale
// =====================================================================
// Como num explorador de arquivos: o setor é a pasta, o canal é o que
// está dentro. Marcar a pasta marca tudo o que há nela; abrir a pasta
// deixa marcar um canal só.
//
// O que está marcado aqui é EXATAMENTE o que é gravado. Não existe "o
// setor inteiro" guardado como vínculo: câmera instalada depois aparece
// nesta árvore desmarcada, e o setor passa a mostrar a caixa parcial —
// que é a tela dizendo "há um canal aqui sem este critério".
// =====================================================================

import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Ponto, Setor } from '@/lib/api';

import {
  alternarCanal,
  alternarSetor,
  canaisDoSetor,
  canalMarcado,
  contarCanais,
  estadoDoSetor,
  rotuloDoCanal,
} from './canais';

type Props = {
  setores: Setor[];
  marcadas: ReadonlySet<string>;
  aoMudar: (novo: Set<string>) => void;
  prefixo: string;
};

function Caixa({
  id,
  marcada,
  parcial = false,
  aoClicar,
  rotulo,
}: {
  id: string;
  marcada: boolean;
  parcial?: boolean;
  aoClicar: () => void;
  rotulo: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // "Parcial" não existe como atributo de HTML: só se liga pelo elemento.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = parcial;
  }, [parcial]);

  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={marcada}
      onChange={aoClicar}
      aria-label={rotulo}
      aria-checked={parcial ? 'mixed' : marcada}
      className="h-[17px] w-[17px] shrink-0 accent-farol-marca"
    />
  );
}

function Seta({ aberta, rotulo, aoClicar }: { aberta: boolean; rotulo: string; aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-expanded={aberta}
      aria-label={rotulo}
      className="rounded p-0.5 text-farol-suave hover:text-farol-tinta"
    >
      <ChevronRight className={`h-4 w-4 transition-transform duration-200 ease-farol ${aberta ? 'rotate-90' : ''}`} aria-hidden />
    </button>
  );
}

function LinhaDoCanal({
  ponto,
  marcadas,
  aoMudar,
  prefixo,
}: {
  ponto: Ponto;
  marcadas: ReadonlySet<string>;
  aoMudar: (novo: Set<string>) => void;
  prefixo: string;
}) {
  const [aberto, setAberto] = useState(false);
  const variasAreas = ponto.zonas.length > 1;
  const marcado = canalMarcado(ponto, marcadas);
  const idCaixa = `${prefixo}-canal-${ponto.id}`;

  return (
    <li>
      <div className="flex min-h-[34px] min-w-0 items-center gap-2">
        {variasAreas ? (
          <Seta
            aberta={aberto}
            aoClicar={() => setAberto((a) => !a)}
            rotulo={`${aberto ? 'Recolher' : 'Abrir'} as áreas de ${rotuloDoCanal(ponto)}`}
          />
        ) : (
          <span className="w-5 shrink-0" aria-hidden />
        )}
        <Caixa
          id={idCaixa}
          marcada={marcado}
          aoClicar={() => aoMudar(alternarCanal(ponto, marcadas))}
          rotulo={rotuloDoCanal(ponto)}
        />
        <label htmlFor={idCaixa} className="min-w-0 flex-1 cursor-pointer break-words">
          {rotuloDoCanal(ponto)}
          {!ponto.ativo && <span className="ml-2 text-xs text-farol-facho-tinta">pausado, não é verificado</span>}
        </label>
      </div>

      {variasAreas && aberto && (
        <ul className="ml-11 border-l border-farol-borda pl-3">
          {ponto.zonas.map((z) => {
            const idArea = `${prefixo}-area-${z.id}`;
            return (
              <li key={z.id} className="flex min-h-[34px] min-w-0 items-center gap-2">
                <Caixa
                  id={idArea}
                  marcada={marcadas.has(z.id)}
                  aoClicar={() => {
                    const novo = new Set(marcadas);
                    if (novo.has(z.id)) novo.delete(z.id);
                    else novo.add(z.id);
                    aoMudar(novo);
                  }}
                  rotulo={`${z.nome} em ${rotuloDoCanal(ponto)}`}
                />
                <label htmlFor={idArea} className="min-w-0 cursor-pointer break-words text-farol-suave">
                  {z.nome}
                  {z.principal && <span className="ml-2 text-xs">área principal</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function PastaDoSetor({
  setor,
  marcadas,
  aoMudar,
  prefixo,
}: {
  setor: Setor;
  marcadas: ReadonlySet<string>;
  aoMudar: (novo: Set<string>) => void;
  prefixo: string;
}) {
  const [aberto, setAberto] = useState(true);
  const canais = canaisDoSetor(setor, marcadas);
  const estado = estadoDoSetor(setor, marcadas);
  const n = canais.filter((p) => canalMarcado(p, marcadas)).length;
  const idCaixa = `${prefixo}-setor-${setor.id}`;

  if (canais.length === 0) {
    return (
      <li className="py-1.5 pl-7 text-farol-suave">
        {setor.nome} <span className="text-xs">· sem câmera cadastrada</span>
      </li>
    );
  }

  return (
    <li>
      <div className="flex min-h-[34px] min-w-0 items-center gap-2">
        <Seta
          aberta={aberto}
          aoClicar={() => setAberto((a) => !a)}
          rotulo={`${aberto ? 'Recolher' : 'Abrir'} o setor ${setor.nome}`}
        />
        <Caixa
          id={idCaixa}
          marcada={estado === 'todos'}
          parcial={estado === 'alguns'}
          aoClicar={() => aoMudar(alternarSetor(setor, marcadas))}
          rotulo={`Setor ${setor.nome} inteiro`}
        />
        <label htmlFor={idCaixa} className="min-w-0 flex-1 cursor-pointer break-words font-semibold">
          {setor.nome}
        </label>
        <span className="shrink-0 text-xs text-farol-suave">
          {n} de {canais.length}
        </span>
      </div>

      {aberto && (
        <ul className="ml-2 border-l border-farol-borda pl-3">
          {canais.map((p) => (
            <LinhaDoCanal key={p.id} ponto={p} marcadas={marcadas} aoMudar={aoMudar} prefixo={prefixo} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ArvoreDeCanais({ setores, marcadas, aoMudar, prefixo }: Props) {
  const total = contarCanais(setores, marcadas);

  return (
    <div className="flex flex-col gap-[5px]">
      <ul className="rounded-[10px] border border-farol-borda-forte bg-farol-painel px-2 py-1.5">
        {setores.map((s) => (
          <PastaDoSetor key={s.id} setor={s} marcadas={marcadas} aoMudar={aoMudar} prefixo={prefixo} />
        ))}
      </ul>
      <p className="text-xs text-farol-suave" aria-live="polite">
        {total === 0 ? 'Nenhum canal marcado.' : total === 1 ? 'Vale em 1 canal.' : `Vale em ${total} canais.`}
      </p>
    </div>
  );
}
