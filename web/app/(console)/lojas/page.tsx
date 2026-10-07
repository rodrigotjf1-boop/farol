'use client';

// Todas as lojas da conta, e como cada uma está agora. A pergunta desta
// tela é "qual delas precisa de mim?" — por isso o estado do agente vem
// antes de qualquer número.

import { ArrowRight, Building2, Store, Unplug } from 'lucide-react';
import Link from 'next/link';

import { saudeDaLoja, useConsole } from '@/componentes/console';
import { numero, porcento } from '@/componentes/formatos';
import { Cabecalho, CARTAO, Chip, Ossos, Ponto, Vazio } from '@/componentes/ui/pecas';
import type { LojaResumo } from '@/lib/api';

const MODO: Record<string, string> = {
  nuvem: 'julgamento na nuvem',
  local: 'julgamento na loja',
  hibrido: 'julgamento na loja e na nuvem',
};

function Fato({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="min-w-0">
      <b className="block font-display text-lg font-semibold leading-tight tabular-nums">{valor}</b>
      <span className="text-xs text-farol-suave">{rotulo}</span>
    </div>
  );
}

function CartaoDaLoja({ loja, veResultados }: { loja: LojaResumo; veResultados: boolean }) {
  const saude = saudeDaLoja(loja);
  const r = loja.resultado_24h;
  const julgadas = r ? r.conformes + r.naoConformes + r.naoAvaliaveis : 0;

  return (
    <Link
      href={`/lojas/${loja.id}`}
      className={`${CARTAO} flex flex-col gap-3.5 p-[18px] text-farol-tinta no-underline transition duration-200 ease-farol hover:-translate-y-0.5 hover:border-farol-marca hover:shadow-farol-1`}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-farol-realce text-farol-marca">
          <Store className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <h2 className="break-words font-display text-lg font-semibold leading-tight tracking-tight">{loja.nome}</h2>
          {saude.estado === 'ativo' && (
            <Chip tom="ok">
              <Ponto tom="ok" pulsa />
              agente ativo
            </Chip>
          )}
          {saude.estado === 'fora' && (
            <Chip tom="critico" icone={Unplug}>
              agente sem sinal · {saude.detalhe}
            </Chip>
          )}
          {saude.estado === 'nenhum' && <Chip tom="atencao">sem agente instalado</Chip>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <Fato valor={numero(loja.pontos)} rotulo={loja.pontos === 1 ? 'canal' : 'canais'} />
        <Fato valor={numero(loja.criterios)} rotulo={loja.criterios === 1 ? 'critério' : 'critérios'} />
        {/* Quem não vê resultados não recebe o número: a API manda nulo. E
            nulo, para essa pessoa, não é "nada julgado" — é "não é com você":
            o lugar mostra os setores. */}
        {veResultados ? (
          <Fato
            valor={r && julgadas > 0 ? `${porcento(r.conformes, julgadas)}%` : '—'}
            rotulo={r && julgadas > 0 ? 'conforme em 24 h' : 'nada julgado em 24 h'}
          />
        ) : (
          <Fato valor={numero(loja.setores)} rotulo={loja.setores === 1 ? 'setor' : 'setores'} />
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-farol-borda pt-3 text-[13px] text-farol-suave">
        <span>{loja.ativa ? (MODO[loja.modo_julgamento] ?? loja.modo_julgamento) : 'loja inativa'}</span>
        <span className="elo">
          Entrar
          <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export default function Lojas() {
  const { lojas, veResultados } = useConsole();

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Building2 className="h-[15px] w-[15px]" aria-hidden />
            Sua conta
          </>
        }
        titulo="Lojas"
      >
        Todas as lojas e como cada uma está agora. Escolha uma para entrar.
      </Cabecalho>

      {lojas === null && <Ossos alturas={[[190, 190]]} />}

      {lojas?.length === 0 && (
        <Vazio icone={Store} titulo="Nenhuma loja cadastrada ainda">
          A primeira loja é criada pela Regem, na contratação. Depois disso, os setores e os canais se cadastram
          aqui.
        </Vazio>
      )}

      {lojas && lojas.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-3.5">
          {lojas.map((l) => (
            <CartaoDaLoja key={l.id} loja={l} veResultados={veResultados} />
          ))}
        </div>
      )}
    </>
  );
}
