'use client';

// Um canal no orçamento: quanto é usado, o que precisa enxergar, se a câmera
// atual serve, e as opções — uma por nível — entre as que servem.

import type { CanalNoOrcamento, Importancia } from '@/lib/api';

import { CartaoDaOpcao } from './opcao';
import {
  COR_DA_CARGA,
  NOME_DA_CARGA,
  NOME_DA_IMPORTANCIA,
  NOME_DO_USO,
} from './rotulos';

const COR_DA_SITUACAO: Record<CanalNoOrcamento['camera']['situacao'], string> = {
  sem_uso: 'text-farol-suave',
  nao_medido: 'text-farol-atencao',
  atende: 'text-farol-ok',
  nao_atende: 'text-farol-critico',
};

const NOME_DA_SITUACAO: Record<CanalNoOrcamento['camera']['situacao'], string> = {
  sem_uso: 'sem critério',
  nao_medido: 'câmera atual não medida',
  atende: 'a câmera atual atende',
  nao_atende: 'a câmera atual NÃO atende',
};

type Props = {
  canal: CanalNoOrcamento;
  configura: boolean;
  salvando: boolean;
  aoMudarImportancia: (canal: CanalNoOrcamento, importancia: Importancia) => void;
};

export function CanalNoOrcamentoCartao({ canal, configura, salvando, aoMudarImportancia }: Props) {
  const rotulo = (canal.canal ? `Canal ${canal.canal} · ` : '') + canal.nome;
  const { uso, exige, camera } = canal;

  return (
    <li className="rounded-xl border border-farol-borda bg-farol-painel p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <h3 className="min-w-0 break-words font-medium">{rotulo}</h3>
        <span className="text-xs text-farol-suave">{canal.setor}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${COR_DA_CARGA[uso.carga]}`}>
          {NOME_DA_CARGA[uso.carga]}
        </span>
        {!canal.ativo && (
          <span className="rounded bg-farol-atencao/15 px-1.5 py-0.5 text-xs text-farol-atencao">
            pausado — fora dos pacotes
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-farol-suave" htmlFor={`imp-${canal.id}`}>
            Importância
          </label>
          {configura ? (
            <select
              id={`imp-${canal.id}`}
              value={canal.importancia}
              disabled={salvando}
              onChange={(e) => aoMudarImportancia(canal, e.target.value as Importancia)}
              className="rounded-lg border border-farol-borda bg-farol-fundo px-2 py-1 text-xs disabled:opacity-60"
            >
              <option value="critico">crítico</option>
              <option value="normal">normal</option>
              <option value="baixo">baixo</option>
            </select>
          ) : (
            <span id={`imp-${canal.id}`} className="text-xs">
              {NOME_DA_IMPORTANCIA[canal.importancia]}
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm text-farol-suave">{uso.motivo}</p>

      {uso.criterios > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-farol-suave">Usos de análise</dt>
            <dd>{uso.tipos.map((t) => NOME_DO_USO[t] ?? t).join(', ')}</dd>
          </div>
          <div>
            <dt className="text-xs text-farol-suave">O que precisa enxergar</dt>
            <dd>
              {exige.descricao ?? '—'}
              {exige.pxPorCmMin != null && (
                <span className="text-farol-suave"> · {exige.pxPorCmMin} px por cm</span>
              )}
              {exige.cor && <span className="text-farol-suave"> · cor</span>}
              {exige.julgamentoNaLoja && <span className="text-farol-suave"> · julgado na loja</span>}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-farol-suave">Câmera instalada</dt>
            <dd>
              <span className={COR_DA_SITUACAO[camera.situacao]}>
                {NOME_DA_SITUACAO[camera.situacao]}
              </span>
              <span className="text-farol-suave"> — {camera.mensagem}</span>
            </dd>
          </div>
        </dl>
      )}

      {uso.criterios > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-medium text-farol-suave">
            Câmeras que servem a este uso
          </h4>
          {canal.opcoes.length === 0 ? (
            <p className="mt-2 text-sm text-farol-atencao">
              Nenhuma câmera do catálogo sustenta todos esses usos juntos. Vale dividir os
              critérios em dois canais.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {canal.opcoes.map((o) => (
                <CartaoDaOpcao key={`${o.fabricante}-${o.modelo}`} opcao={o} />
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
