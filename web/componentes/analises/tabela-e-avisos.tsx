'use client';

// A parte de baixo da tela de Análises: cada critério em cada canal (e
// área), com onde foi julgado, tempo e custo — e os avisos do recorte.

import { BellOff, Cctv, CheckCheck, CircleX, Clock, Cloud, Cpu, Send } from 'lucide-react';

import { fracao, numero, porcento, segundos } from '@/componentes/formatos';
import { CARTAO, Chip } from '@/componentes/ui/pecas';
import { Celula, Linha, Tabela } from '@/componentes/ui/tabela';
import type { Analises, AvisoDaAnalise } from '@/lib/api';

import { dinheiro, dinheiroFino, rotuloDoDia, type LinhaDaTabela, type Soma } from './conta';

/** Onde aquilo foi julgado, em pastilha. */
function Onde({ loja, nuvem }: { loja: number; nuvem: number }) {
  if (nuvem > 0 && loja > 0) return <Chip icone={Cloud}>loja e nuvem</Chip>;
  if (nuvem > 0) return <Chip tom="atencao" icone={Cloud}>na nuvem</Chip>;
  return <Chip icone={Cpu}>na loja</Chip>;
}

function Fita({ s }: { s: Soma }) {
  return (
    <div className="flex min-w-[112px] items-center gap-2.5">
      <span
        className="flex h-2 flex-1 overflow-hidden rounded-full bg-farol-realce"
        title={`${numero(s.conformes)} conforme, ${numero(s.fora)} fora do critério, ${numero(s.naoAvaliou)} sem avaliar`}
      >
        <i className="block h-full bg-farol-critico" style={{ width: `${(s.fora / s.analises) * 100}%` }} />
        <i className="block h-full bg-farol-graf-na" style={{ width: `${(s.naoAvaliou / s.analises) * 100}%` }} />
        <i className="block h-full bg-farol-graf-ok" style={{ width: `${(s.conformes / s.analises) * 100}%` }} />
      </span>
      <b className="min-w-[38px] text-right font-mono text-[12.5px] font-semibold tabular-nums">
        {porcento(s.conformes, s.analises)}%
      </b>
    </div>
  );
}

const tempo = (s: Soma) => segundos(s.comLatencia > 0 ? s.latenciaMs / s.comLatencia : null);

export function PorCriterioECanal({ linhas, total, dados }: { linhas: LinhaDaTabela[]; total: Soma; dados: Analises }) {
  const canal = new Map(dados.canais.map((c) => [c.id, c]));
  const criterio = new Map(dados.criterios.map((c) => [c.id, c]));

  return (
    // Dez colunas: aperta um pouco as margens para caber sem rolar em 1440.
    <div className="md:[&_td]:px-2.5 md:[&_th]:px-2.5 md:[&_td:first-child]:pl-4 md:[&_th:first-child]:pl-4 md:[&_td:last-child]:pr-4 md:[&_th:last-child]:pr-4">
      <Tabela
        legenda="Cada critério em cada canal, no recorte escolhido: resultado, onde foi julgado, tempo e custo"
        colunas={[
          { rotulo: 'Critério' },
          { rotulo: 'Canal' },
          { rotulo: 'Onde julga' },
          { rotulo: 'Conforme' },
          { rotulo: 'Análises', numero: true },
          { rotulo: 'Fora', numero: true },
          { rotulo: 'Não avaliou', numero: true },
          { rotulo: 'Tempo', numero: true },
          { rotulo: 'Custo', numero: true },
          { rotulo: 'Por análise', numero: true },
        ]}
      >
        {linhas.map((l) => {
          const s = l.soma;
          const c = canal.get(l.pontoId);
          const r = criterio.get(l.regraId);
          return (
            <Linha key={l.chave} apagada={Boolean(c?.excluido || r?.excluido)}>
              <Celula inteira>
                <span className="block min-w-0 font-semibold md:min-w-[150px]">{r?.nome ?? 'Critério excluído'}</span>
              </Celula>
              <Celula rotulo="Canal" inteira>
                <Chip tom="vazado" icone={Cctv}>
                  {c?.nome ?? 'Canal excluído'}
                  {l.areaNome && ` · ${l.areaNome}`}
                </Chip>
              </Celula>
              <Celula rotulo="Onde julga" inteira>
                <Onde loja={s.naLoja} nuvem={s.naNuvem} />
              </Celula>
              <Celula rotulo="Conforme" inteira>
                <Fita s={s} />
              </Celula>
              <Celula rotulo="Análises" numero>
                {numero(s.analises)}
              </Celula>
              <Celula rotulo="Fora do critério" numero>
                {numero(s.fora)}
              </Celula>
              <Celula rotulo="Não avaliou" numero>
                {numero(s.naoAvaliou)}
              </Celula>
              <Celula rotulo="Tempo médio" numero>
                {tempo(s)}
              </Celula>
              <Celula rotulo="Custo" numero>
                {s.naNuvem > 0 ? dinheiro(s.custoCentavos) : '—'}
              </Celula>
              <Celula rotulo="Custo por análise" numero>
                {s.naNuvem > 0 ? dinheiroFino(s.custoCentavos / s.naNuvem) : '—'}
              </Celula>
            </Linha>
          );
        })}
        <Linha total>
          <Celula inteira>Total do recorte</Celula>
          <Celula vazia />
          <Celula vazia />
          <Celula rotulo="Conforme" inteira>
            <Fita s={total} />
          </Celula>
          <Celula rotulo="Análises" numero>
            {numero(total.analises)}
          </Celula>
          <Celula rotulo="Fora do critério" numero>
            {numero(total.fora)}
          </Celula>
          <Celula rotulo="Não avaliou" numero>
            {numero(total.naoAvaliou)}
          </Celula>
          <Celula rotulo="Tempo médio" numero>
            {tempo(total)}
          </Celula>
          <Celula rotulo="Custo" numero>
            {dinheiro(total.custoCentavos)}
          </Celula>
          <Celula rotulo="Custo por análise na nuvem" numero>
            {total.naNuvem > 0 ? dinheiroFino(total.custoCentavos / total.naNuvem) : '—'}
          </Celula>
        </Linha>
      </Tabela>
    </div>
  );
}

// ───────────────────────── os avisos ─────────────────────────

function EstadoDoAviso({ estado }: { estado: AvisoDaAnalise['aviso'] }) {
  if (estado === 'entregue') return <Chip tom="ok" icone={CheckCheck}>aviso chegou</Chip>;
  if (estado === 'enviado') return <Chip tom="atencao" icone={Send}>aviso mandado</Chip>;
  if (estado === 'pendente') return <Chip icone={Clock}>aviso na fila</Chip>;
  if (estado === 'falhou') return <Chip tom="critico" icone={CircleX}>aviso falhou</Chip>;
  // O agente registrou o aviso, mas nada saiu: sem destino cadastrado ou
  // fora da política de envio. A tela de Alertas diz qual dos dois.
  return <Chip icone={BellOff}>não enviado</Chip>;
}

/** Quantos avisos a lista mostra; o resto vai na frase "e mais N". */
export const AVISOS_NA_TELA = 6;

export function AvisosDoRecorte({
  avisos,
  quantos,
  dados,
  variosDias,
}: {
  /** Os avisos do recorte que vieram com detalhe, do mais novo para trás. */
  avisos: AvisoDaAnalise[];
  /** Quantos avisos o recorte teve ao todo (a contagem das análises). */
  quantos: number;
  dados: Analises;
  variosDias: boolean;
}) {
  const canal = new Map(dados.canais.map((c) => [c.id, c]));
  const criterio = new Map(dados.criterios.map((c) => [c.id, c]));
  const naTela = avisos.slice(0, AVISOS_NA_TELA);
  const mais = Math.max(quantos, avisos.length) - naTela.length;

  if (naTela.length === 0 && mais <= 0) {
    return <p className={`${CARTAO} px-4 py-6 text-farol-suave`}>Nenhum aviso neste recorte.</p>;
  }

  return (
    <ul className={`${CARTAO} flex flex-col`}>
      {naTela.map((a) => (
        <li
          key={a.id}
          className="grid grid-cols-[46px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-1 px-4 py-[13px] md:grid-cols-[minmax(52px,auto)_minmax(0,1fr)_auto] [&+li]:border-t [&+li]:border-farol-borda"
        >
          <time dateTime={a.ocorridoEm} className="pt-0.5 font-mono text-[12.5px] font-medium text-farol-suave">
            {variosDias && <span className="block">{rotuloDoDia(a.dia, false)}</span>}
            {a.horaMinuto}
          </time>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-semibold">
              {(a.regraId && criterio.get(a.regraId)?.nome) ?? 'Critério excluído'}
              {a.pontoId && (
                <Chip tom="vazado" icone={Cctv}>
                  {canal.get(a.pontoId)?.nome ?? 'Canal excluído'}
                  {a.areaNome && ` · ${a.areaNome}`}
                </Chip>
              )}
              {a.onde && (a.onde === 'nuvem' ? <Chip tom="atencao" icone={Cloud}>na nuvem</Chip> : <Chip icone={Cpu}>na loja</Chip>)}
            </div>
            {a.motivo && <p className="text-[13px] text-farol-suave">{a.motivo}</p>}
          </div>
          <div className="col-start-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 md:col-start-3 md:flex-col md:items-end">
            <EstadoDoAviso estado={a.aviso} />
            {a.confianca !== null && <span className="font-mono text-xs text-farol-suave">confiança {fracao(a.confianca)}</span>}
          </div>
        </li>
      ))}
      {mais > 0 && (
        <li className={`px-4 py-3 text-[13px] text-farol-suave ${naTela.length > 0 ? 'border-t border-farol-borda' : ''}`}>
          {naTela.length > 0 ? 'e mais ' : ''}
          {numero(mais)} {mais === 1 ? 'aviso' : 'avisos'} neste recorte
          {naTela.length === 0 ? ', ainda sem o detalhe aqui' : ''}.
        </li>
      )}
    </ul>
  );
}
