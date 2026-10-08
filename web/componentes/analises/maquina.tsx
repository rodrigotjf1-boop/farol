'use client';

// A máquina de análise: o computador da loja, que é quem julga.
//
// Responde "esta máquina está dando conta?" — processador, memória e placa
// de vídeo (média e pico), a parte que é do Farol, e o disco que sobra.
//
// **O uso é da máquina inteira.** Segue o período e as horas do recorte;
// canal e critério não mudam estes números. O que acompanha canal e
// critério é o TEMPO que a máquina passou julgando, que sai das próprias
// análises e vai na nota de baixo.
//
// **"Não medi" não é zero.** Máquina sem contador de placa de vídeo mostra
// "sem medida", não 0%.
//
// O gráfico usa as mesmas colunas do gráfico de análises e também escolhe a
// hora (ou abre o dia): olhar o pico das 20h e ver o que foi julgado às 20h
// é um toque só.

import { Cpu, Gpu, HardDrive, MemoryStick, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { numero } from '@/componentes/formatos';
import { CARTAO } from '@/componentes/ui/pecas';
import type { Analises, CelulaDeAnalise } from '@/lib/api';

import {
  discoMaisRecente,
  discoPorDia,
  duracao,
  juntarUso,
  tempoJulgandoNaLoja,
  usoDoRecorte,
  usoPorBalde,
  type Balde,
  type Filtros,
  type Medida,
  type Peca,
  type Uso,
} from './conta';

const PECAS: ReadonlyArray<{ chave: Peca; rotulo: string; nome: string; icone: LucideIcon }> = [
  { chave: 'cpu', rotulo: 'Processador', nome: 'processador', icone: Cpu },
  { chave: 'mem', rotulo: 'Memória', nome: 'memória', icone: MemoryStick },
  { chave: 'gpu', rotulo: 'Placa de vídeo', nome: 'placa de vídeo', icone: Gpu },
];

const p = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);
const virgula = (v: number, casas = 1) => v.toFixed(casas).replace('.', ',');

const ITEM = 'flex min-w-0 flex-col gap-0.5 rounded-[10px] border px-3.5 py-3 text-left';

export function MaquinaDeAnalise({
  dados,
  filtros,
  baldes,
  recorte,
  aoEscolher,
}: {
  dados: Analises;
  filtros: Filtros;
  /** As barras do gráfico de análises: as daqui são as mesmas. */
  baldes: Balde[];
  /** As análises do recorte, para o tempo de julgamento. */
  recorte: CelulaDeAnalise[];
  aoEscolher: (b: Balde) => void;
}) {
  const [peca, setPeca] = useState<Peca>('cpu');
  const [escolhida, setEscolhida] = useState<string>('');
  const [sobre, setSobre] = useState<number | null>(null);

  const maquinas = dados.maquina?.agentes ?? [];
  const horas = dados.maquina?.horas ?? [];
  // A primeira máquina que mediu algo no intervalo; com uma só, é ela.
  const comMedida = maquinas.filter((m) => horas.some((h) => h.agenteId === m.id));
  const maquina = maquinas.find((m) => m.id === escolhida) ?? comMedida[0] ?? maquinas[0] ?? null;

  const doRecorte = maquina ? usoDoRecorte(horas, maquina.id, filtros) : [];
  const total = juntarUso(doRecorte);
  const colunas = maquina ? usoPorBalde(baldes, horas, maquina.id, filtros) : baldes.map(() => null);
  const disco = discoMaisRecente(doRecorte);
  const encolhe = discoPorDia(doRecorte);
  const julgando = tempoJulgandoNaLoja(recorte);

  const porHora = baldes[0]?.hora !== undefined;
  const umaHora = porHora && filtros.ate - filtros.de === 1;
  const vao = porHora ? 'gap-[3px]' : 'gap-[clamp(8px,3%,28px)]';
  const atual = sobre !== null ? colunas[sobre] : null;
  const medida = (u: Uso, qual: Peca): Medida => u[qual];
  const aPeca = PECAS.find((x) => x.chave === peca)!;

  const pecasDaMaquina = maquina
    ? [
        maquina.nome,
        maquina.processador,
        maquina.memoriaGb ? `${Math.round(maquina.memoriaGb)} GB de memória` : null,
        maquina.placaDeVideo,
      ].filter(Boolean)
    : [];

  return (
    <section aria-labelledby="t-an-maquina" data-maquina className={`${CARTAO} flex flex-col gap-3.5 p-4`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id="t-an-maquina" className="text-base font-semibold">
          Máquina de análise
        </h2>
        {comMedida.length > 1 ? (
          <select
            aria-label="Qual máquina"
            className="entrada ml-auto w-auto max-w-full"
            value={maquina?.id ?? ''}
            onChange={(e) => setEscolhida(e.target.value)}
          >
            {comMedida.map((m) => (
              <option key={m.id} value={m.id}>
                {[m.nome, m.processador].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        ) : (
          <span data-maquina-nome className="min-w-0 text-[12.5px] text-farol-suave md:ml-auto">
            {pecasDaMaquina.join(' · ')}
          </span>
        )}
      </div>

      {!total ? (
        <p data-maquina-vazia className="text-[13px] text-farol-suave">
          {maquina
            ? 'Sem medida de uso neste recorte. O agente mede a máquina a cada volta; horas anteriores à versão que mede não têm número.'
            : 'O agente desta loja ainda não mandou o uso da máquina. Ele começa a medir quando é atualizado.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div role="group" aria-label="O que o gráfico da máquina mostra" className="grid grid-cols-2 gap-2.5 md:max-xl:grid-cols-4">
              {PECAS.map((x) => {
                const m = medida(total, x.chave);
                const ligada = peca === x.chave;
                return (
                  <button
                    key={x.chave}
                    type="button"
                    data-peca={x.chave}
                    aria-pressed={ligada}
                    onClick={() => setPeca(x.chave)}
                    className={`${ITEM} transition-colors ${
                      ligada
                        ? 'border-farol-marca bg-farol-painel shadow-[inset_0_0_0_1px_rgb(var(--marca))]'
                        : 'border-farol-borda bg-farol-painel-2 hover:border-farol-borda-forte'
                    }`}
                  >
                    <span className="flex items-center gap-[7px] text-[12.5px] text-farol-suave">
                      <x.icone className="h-[15px] w-[15px]" aria-hidden />
                      {x.rotulo}
                    </span>
                    <span className="whitespace-nowrap font-display text-[21px] font-semibold leading-tight tracking-tight tabular-nums md:text-2xl">
                      {m.media === null ? '—' : Math.round(m.media)}
                      {m.media !== null && <small className="font-sans text-[13px] font-medium tracking-normal text-farol-suave">%</small>}
                    </span>
                    <span className="text-xs text-farol-suave">
                      {m.media === null ? 'sem medida nesta máquina' : `em média · pico de ${p(m.pico)}`}
                    </span>
                  </button>
                );
              })}
              <div data-peca="disco" className={`${ITEM} border-farol-borda bg-farol-painel-2`}>
                <span className="flex items-center gap-[7px] text-[12.5px] text-farol-suave">
                  <HardDrive className="h-[15px] w-[15px]" aria-hidden />
                  Disco
                </span>
                <span className="whitespace-nowrap font-display text-[21px] font-semibold leading-tight tracking-tight tabular-nums md:text-2xl">
                  {disco ? numero(Math.round(disco.livreGb)) : '—'}
                  {disco && <small className="font-sans text-[13px] font-medium tracking-normal text-farol-suave"> GB livres</small>}
                </span>
                <span className="text-xs text-farol-suave">
                  {!disco
                    ? 'sem medida'
                    : [
                        disco.totalGb ? `de ${numero(Math.round(disco.totalGb))} GB` : null,
                        encolhe !== null && encolhe >= 0.05 ? `${virgula(encolhe)} GB a menos por dia` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2.5">
              <div aria-hidden className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-farol-suave">
                <span className="inline-flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-[3px] bg-farol-marca" />
                  média
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-[3px] bg-farol-facho" />
                  pico
                </span>
              </div>
              <div className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-2" onPointerLeave={() => setSobre(null)}>
                <div aria-hidden className="flex h-[136px] flex-col justify-between text-right font-mono text-[11px] text-farol-suave">
                  <span>100%</span>
                  <span>50%</span>
                  <span>0</span>
                </div>
                <div
                  className={`relative flex h-[136px] items-end ${vao}`}
                  style={{
                    background:
                      'linear-gradient(rgb(var(--borda)), rgb(var(--borda))) 0 0 / 100% 1px no-repeat, ' +
                      'linear-gradient(rgb(var(--borda)), rgb(var(--borda))) 0 50% / 100% 1px no-repeat, ' +
                      'linear-gradient(rgb(var(--borda-forte)), rgb(var(--borda-forte))) 0 100% / 100% 1px no-repeat',
                  }}
                >
                  {baldes.map((b, i) => {
                    const u = colunas[i];
                    const m = u ? medida(u, peca) : null;
                    const dentro = !porHora || (b.hora! >= filtros.de && b.hora! < filtros.ate);
                    const marcada = umaHora && b.hora === filtros.de;
                    return (
                      <button
                        key={`${b.dia ?? ''}-${b.hora ?? ''}`}
                        type="button"
                        data-uso={i}
                        disabled={b.futura}
                        aria-pressed={porHora ? marcada : undefined}
                        aria-label={
                          m && m.media !== null
                            ? `${b.rotulo}: ${aPeca.nome} em ${p(m.media)} na média, pico de ${p(m.pico)}.`
                            : `${b.rotulo}: sem medida.`
                        }
                        onClick={() => aoEscolher(b)}
                        onPointerEnter={() => setSobre(i)}
                        onFocus={() => setSobre(i)}
                        onBlur={() => setSobre(null)}
                        className={`relative flex h-full min-w-0 flex-1 items-end rounded-t-[5px] transition-colors hover:bg-farol-realce focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-farol-marca disabled:cursor-default disabled:hover:bg-transparent ${
                          marcada ? 'bg-farol-facho-leve shadow-[inset_0_-3px_0_rgb(var(--facho))]' : ''
                        }`}
                      >
                        {m && m.media !== null ? (
                          <>
                            <span
                              className={`block w-full origin-bottom animate-cresce rounded-t bg-farol-marca ${dentro ? '' : 'opacity-30'}`}
                              style={{ height: `${Math.min(100, m.media)}%`, animationDelay: `${i * 14}ms` }}
                            />
                            {m.pico !== null && (
                              <span
                                className={`pointer-events-none absolute inset-x-[10%] -mb-[1.5px] h-[3px] rounded-sm bg-farol-facho ${dentro ? '' : 'opacity-30'}`}
                                style={{ bottom: `${Math.min(98.5, m.pico)}%` }}
                              />
                            )}
                          </>
                        ) : (
                          !b.futura && <span className="absolute inset-x-[25%] bottom-0 h-0.5 rounded-sm bg-farol-borda-forte" />
                        )}
                      </button>
                    );
                  })}

                  {atual && sobre !== null && (
                    <div
                      role="presentation"
                      className="pointer-events-none absolute top-1 z-[5] -translate-x-1/2 whitespace-nowrap rounded-[10px] bg-farol-tinta px-2.5 py-2 text-xs leading-relaxed text-farol-fundo shadow-farol-2"
                      style={{ left: `clamp(100px, ${((sobre + 0.5) / baldes.length) * 100}%, calc(100% - 100px))` }}
                    >
                      <b>{baldes[sobre]!.rotulo}</b> · média e pico
                      <br />
                      processador {p(atual.cpu.media)} · {p(atual.cpu.pico)}
                      <br />
                      memória {p(atual.mem.media)} · {p(atual.mem.pico)}
                      <br />
                      placa de vídeo {p(atual.gpu.media)} · {p(atual.gpu.pico)}
                    </div>
                  )}
                </div>
                <div aria-hidden className={`col-start-2 flex font-mono text-[11px] text-farol-suave ${vao}`}>
                  {baldes.map((b, i) => (
                    <span
                      key={`${b.dia ?? ''}-${b.hora ?? ''}`}
                      className={`min-w-0 flex-1 whitespace-nowrap text-center ${porHora && i % 6 !== 0 ? 'max-md:invisible' : ''}`}
                    >
                      {b.mostra ? b.rotulo : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <p data-maquina-nota className="max-w-[90ch] text-[12.5px] text-farol-suave">
            {total.farol.media !== null && (
              <>O Farol ocupou, em média, {virgula(total.farol.media)}% do processador desta máquina neste recorte. </>
            )}
            {julgando.analises > 0 ? (
              <>
                Tempo julgando na loja: {duracao(julgando.ms)}, em {numero(julgando.analises)} análises — este número
                acompanha os filtros de canal e de critério.{' '}
              </>
            ) : (
              <>Nenhuma análise foi julgada na loja neste recorte. </>
            )}
            Processador, memória e placa de vídeo são da máquina inteira: seguem o período e as horas, não o canal nem
            o critério. O pico é a maior média de meio minuto.
          </p>
        </>
      )}
    </section>
  );
}
