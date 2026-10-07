'use client';

// Um canal no orçamento: quanto é usado, o que precisa enxergar, se a câmera
// atual serve, e as opções — uma por nível — entre as que servem.

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { CARTAO, Chip, type Tom } from '@/componentes/ui/pecas';
import type { CanalNoOrcamento, Importancia } from '@/lib/api';

import { CartaoDaOpcao } from './opcao';
import { NOME_DA_CARGA, NOME_DA_IMPORTANCIA, NOME_DO_USO, TOM_DA_CARGA } from './rotulos';

const SITUACAO: Record<CanalNoOrcamento['camera']['situacao'], { nome: string; tom: Tom }> = {
  sem_uso: { nome: 'sem critério', tom: 'neutro' },
  nao_medido: { nome: 'ainda sem medida', tom: 'atencao' },
  atende: { nome: 'atende', tom: 'ok' },
  nao_atende: { nome: 'não atende', tom: 'critico' },
};

type Props = {
  canal: CanalNoOrcamento;
  configura: boolean;
  salvando: boolean;
  /** As opções já vêm abertas no canal que mais pesa; nos outros, sob pedido. */
  abertoDeInicio: boolean;
  aoMudarImportancia: (canal: CanalNoOrcamento, importancia: Importancia) => void;
};

export function CanalNoOrcamentoCartao({ canal, configura, salvando, abertoDeInicio, aoMudarImportancia }: Props) {
  const [aberto, setAberto] = useState(abertoDeInicio);
  const { uso, exige, camera } = canal;
  const situacao = SITUACAO[camera.situacao];
  const temOpcoes = uso.criterios > 0;

  return (
    <li className={`${CARTAO} flex flex-col gap-3.5 p-4`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-farol-realce font-mono text-xs font-semibold text-farol-marca">
          {canal.canal != null ? String(canal.canal).padStart(2, '0') : 'IP'}
        </span>
        <h3 className="min-w-0 break-words text-[15px] font-semibold">{canal.nome}</h3>
        <span className="text-farol-suave">{canal.setor}</span>
        <Chip tom={TOM_DA_CARGA[uso.carga]}>{NOME_DA_CARGA[uso.carga]}</Chip>
        {!canal.ativo && <Chip tom="atencao">pausado, fora dos pacotes</Chip>}

        <div className="ml-auto flex items-center gap-2">
          <label className="text-farol-suave" htmlFor={`imp-${canal.id}`}>
            Importância
          </label>
          {configura ? (
            <select
              id={`imp-${canal.id}`}
              value={canal.importancia}
              disabled={salvando}
              onChange={(e) => aoMudarImportancia(canal, e.target.value as Importancia)}
              className="entrada !min-h-8 !w-auto !py-1"
            >
              <option value="critico">crítica</option>
              <option value="normal">normal</option>
              <option value="baixo">baixa</option>
            </select>
          ) : (
            <span id={`imp-${canal.id}`}>{NOME_DA_IMPORTANCIA[canal.importancia]}</span>
          )}
        </div>
      </div>

      <p className="text-farol-suave">{uso.motivo}</p>

      {uso.criterios > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-farol-suave">Usos de análise</dt>
            <dd>{uso.tipos.map((t) => NOME_DO_USO[t] ?? t).join(', ')}</dd>
          </div>
          <div>
            <dt className="text-xs text-farol-suave">O que precisa enxergar</dt>
            <dd>
              {exige.descricao ?? '—'}
              {exige.pxPorCmMin != null && <span className="text-farol-suave"> · {exige.pxPorCmMin} pontos por cm</span>}
              {exige.cor && <span className="text-farol-suave"> · cor</span>}
              {exige.julgamentoNaLoja && <span className="text-farol-suave"> · julgado na loja</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-farol-suave">Câmera instalada</dt>
            <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Chip tom={situacao.tom}>{situacao.nome}</Chip>
              <span className="text-farol-suave">{camera.mensagem}</span>
            </dd>
          </div>
        </dl>
      )}

      {temOpcoes &&
        (canal.opcoes.length === 0 ? (
          <p className="text-farol-facho-tinta">
            Nenhuma câmera do catálogo sustenta todos esses usos juntos. Vale dividir os critérios em dois canais.
          </p>
        ) : (
          <>
            <Botao mini className="self-start" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
              <ChevronDown
                className={`h-[15px] w-[15px] transition-transform duration-200 ease-farol ${aberto ? 'rotate-180' : ''}`}
                aria-hidden
              />
              {aberto
                ? 'Esconder as câmeras que servem'
                : `Ver ${canal.opcoes.length === 1 ? 'a câmera que serve' : `as ${canal.opcoes.length} câmeras que servem`}`}
            </Botao>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-farol ${aberto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
              inert={!aberto}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {canal.opcoes.map((o) => (
                    <CartaoDaOpcao key={`${o.fabricante}-${o.modelo}`} opcao={o} />
                  ))}
                </div>
              </div>
            </div>
          </>
        ))}
    </li>
  );
}
