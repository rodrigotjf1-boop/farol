'use client';

// =====================================================================
// As quatro lentes da tela de Padrões
// =====================================================================
//   frequência  o que se repete: cada setor em palavras, a semana típica
//               de um indicador e o que anda junto;
//   anomalias   a hora muito diferente do normal — e a resposta de quem
//               responde pela loja;
//   tendência   hoje contra o normal, e os números semana a semana;
//   sugestões   o que os números mostram sobre os próprios critérios.
//
// A conta é toda do servidor. Aqui há só o que é da tela: qual setor, qual
// indicador e qual quadro estão escolhidos, e o desenho.
// =====================================================================

import {
  ArrowRight, Cctv, Check, CircleHelp, Crop, Flag, Folder, Hash, Image as IconeDeFoto, Minus, TrendingDown, TrendingUp, UserRoundCheck, Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { plural } from '@/componentes/formatos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { ROTULO } from '@/componentes/ui/campo';
import { CARTAO, Chip, Segmentado, Titulo } from '@/componentes/ui/pecas';
import type { HojeContraONormal, Padroes, SaidaDoPadrao, SugestaoDoPadrao, TendenciaDoPadrao } from '@/lib/api';

import { DIA, diaEMes, doSetor, dosDias, hh, horasDe, ordemDaHora, quandoFoi, Texto, valorEmTexto } from './pecas';

const NOTA = 'text-[13px] text-farol-suave';
const GRADE_DE_CARTOES = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3';
const CAIXA = 'rounded-[10px] border border-farol-borda bg-farol-painel-2 px-3 py-2.5';

function Secao({ id, titulo, nota, children, extra }: { id: string; titulo: string; nota?: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Titulo id={id}>{titulo}</Titulo>
        {nota && <span className={`${NOTA} md:ml-auto`}>{nota}</span>}
        {extra && <div className="md:ml-auto">{extra}</div>}
      </div>
      {children}
    </section>
  );
}

// ───────────────────────── frequência ─────────────────────────

export function Frequencia({
  dados,
  setor,
  indicador,
  celula,
  aoMudarIndicador,
  aoEscolherCelula,
}: {
  dados: Padroes;
  setor: string;
  indicador: string;
  celula: string;
  aoMudarIndicador: (id: string) => void;
  aoEscolherCelula: (chave: string) => void;
}) {
  const idDoSeletor = useId();
  const descricoes = dados.descricoes.filter((d) => doSetor(d, setor));
  const opcoes = dados.indicadores.filter((i) => i.noSeletor && doSetor(i, setor));
  const ind = opcoes.find((i) => i.id === indicador) ?? opcoes[0];
  const grade = ind ? (dados.semana[ind.id] ?? []) : [];
  const horas = [...new Set(grade.map((c) => c.hora))].sort((a, b) => ordemDaHora(a) - ordemDaHora(b));
  const emChave = new Map(grade.map((c) => [`${c.diaDaSemana}|${c.hora}`, c]));
  const maior = grade.reduce<(typeof grade)[number] | null>((a, b) => (!a || b.media > a.media ? b : a), null);
  const menor = grade.reduce<(typeof grade)[number] | null>((a, b) => (!a || b.media < a.media ? b : a), null);
  const chaveDe = (c: { diaDaSemana: number; hora: number }) => `${c.diaDaSemana}|${c.hora}`;
  const escolhida = emChave.get(celula) ?? maior;
  const relacoes = dados.relacoes.filter((r) => doSetor(r, setor));
  const nomeDaChave = (c: { diaDaSemana: number; hora: number }) => `${DIA[c.diaDaSemana]} às ${hh(c.hora)}`;

  return (
    <div className="flex min-w-0 flex-col gap-6" data-lente="frequencia">
      <Secao id="t-pd-setores" titulo="Como cada setor funciona" nota="A descrição é montada dos números do período.">
        <div className={GRADE_DE_CARTOES} data-setores>
          {descricoes.map((d) => (
            <article key={d.setorId} className={`${CARTAO} flex flex-col gap-2.5 p-4 ${d.texto ? '' : '!bg-farol-painel-2'}`} data-setor={d.setor}>
              <h3 className="flex items-center gap-2 text-[15px] font-semibold leading-snug">
                <Folder className="h-[18px] w-[18px] shrink-0 text-farol-facho-icone" aria-hidden />
                {d.setor}
              </h3>
              {d.texto ? (
                <>
                  <p className="text-[13.5px] leading-relaxed">{d.texto}</p>
                  {d.fatos.length > 0 && (
                    <dl className="flex flex-col gap-1.5 text-[13px]">
                      {d.fatos.map(([dt, dd], i) => (
                        <div key={`${i}|${dt}`} className="flex items-baseline justify-between gap-3 border-t border-farol-borda pt-1.5">
                          <dt className="min-w-0 text-farol-suave">{dt}</dt>
                          <dd className="text-right font-semibold">{dd}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </>
              ) : (
                <p className="text-[13.5px] leading-relaxed text-farol-suave">
                  Nenhum critério mede este setor: não há do que fazer um padrão. Um critério de presença ou de contagem já basta
                  para começar.
                </p>
              )}
            </article>
          ))}
        </div>
      </Secao>

      <section className={`${CARTAO} flex flex-col gap-3.5 p-4`} aria-labelledby="t-pd-semana">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
          <div className="min-w-0 flex-[1_1_220px]">
            <Titulo id="t-pd-semana">Semana típica</Titulo>
            <p className={NOTA}>
              Cada quadro é a média daquela hora naquele dia da semana. Toque num quadro para ver de que ele é feito.
            </p>
          </div>
          {opcoes.length > 0 && (
            <div className="flex min-w-0 flex-[0_1_440px] flex-col gap-[5px] max-md:flex-[1_1_100%]">
              <label htmlFor={idDoSeletor} className={ROTULO}>
                O que olhar
              </label>
              <select id={idDoSeletor} className="entrada" value={ind?.id ?? ''} onChange={(ev) => aoMudarIndicador(ev.target.value)}>
                {opcoes.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {!ind || !maior || !menor || !escolhida ? (
          <p className={NOTA}>Nenhum indicador deste setor tem números para uma semana típica.</p>
        ) : (
          <>
            <div className="-mx-1 overflow-x-auto px-1 py-0.5">
              <div
                className={`calor ${ind.tipo === 'medida' ? '' : 'ruim'}`}
                style={{ ['--n' as string]: horas.length }}
                role="group"
                aria-label="Semana típica, por dia e hora"
                data-calor
              >
                <span />
                {horas.map((h) => (
                  <span key={h} className="self-end pb-0.5 text-center font-mono text-[11px] text-farol-suave">
                    {hh(h)}
                  </span>
                ))}
                {DIA.map((nome, dow) => {
                  const doDia = grade.filter((c) => c.diaDaSemana === dow);
                  return (
                    <div key={nome} className="contents">
                      <span className="self-center text-[12.5px] font-semibold text-farol-suave">{nome.slice(0, 3)}</span>
                      {doDia.length === 0 ? (
                        <span
                          className="grid min-h-10 place-items-center rounded-lg text-xs text-farol-suave shadow-[inset_0_0_0_1px_rgb(var(--borda))]"
                          style={{ gridColumn: '2 / -1' }}
                        >
                          sem análise
                        </span>
                      ) : (
                        horas.map((h) => {
                          const c = emChave.get(`${dow}|${h}`);
                          if (!c) {
                            return (
                              <span
                                key={h}
                                title="sem análise nesta hora"
                                className="grid min-h-10 place-items-center rounded-lg text-xs text-farol-suave shadow-[inset_0_0_0_1px_rgb(var(--borda))]"
                              >
                                —
                              </span>
                            );
                          }
                          const f = maior.media > menor.media ? (c.media - menor.media) / (maior.media - menor.media) : 0;
                          const chave = chaveDe(c);
                          return (
                            <button
                              key={h}
                              type="button"
                              className={`calor-cel${f > 0.55 ? ' forte' : ''}${chave === chaveDe(maior) ? ' maior' : ''}`}
                              style={{ ['--f' as string]: f.toFixed(3) }}
                              data-cel={chave}
                              aria-pressed={chaveDe(escolhida) === chave}
                              aria-label={`${nome}, ${horasDe(h)}: ${valorEmTexto(ind.tipo, c.media)} ${ind.curto}, média de ${plural(c.n, 'dia', 'dias')}`}
                              onClick={() => aoEscolherCelula(chave)}
                            >
                              {valorEmTexto(ind.tipo, c.media)}
                            </button>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-farol-suave">
              <span className={`calor inline-flex !min-w-0 items-center gap-2 ${ind.tipo === 'medida' ? '' : 'ruim'}`} style={{ display: 'inline-flex' }}>
                {valorEmTexto(ind.tipo, menor.media)}
                <i className="calor-escala" />
                {valorEmTexto(ind.tipo, maior.media)}
              </span>
              <span data-calor-resumo>
                Mais alto: {nomeDaChave(maior)} ({valorEmTexto(ind.tipo, maior.media)}). Mais baixo: {nomeDaChave(menor)} (
                {valorEmTexto(ind.tipo, menor.media)}).
              </span>
            </div>
            <p className={`${CAIXA} text-[13.5px]`} aria-live="polite" data-calor-detalhe>
              <b className="font-semibold">
                {DIA[escolhida.diaDaSemana]![0]!.toUpperCase()}
                {DIA[escolhida.diaDaSemana]!.slice(1)}, das {horasDe(escolhida.hora)}:
              </b>{' '}
              {valorEmTexto(ind.tipo, escolhida.media)} {ind.curto}, em média — de {valorEmTexto(ind.tipo, escolhida.min)} a{' '}
              {valorEmTexto(ind.tipo, escolhida.max)} {escolhida.n === 1 ? 'no único dia medido' : `nos ${escolhida.n} dias medidos`}.
              {escolhida.n < 3 ? ' Poucos dias: ainda não é padrão firme.' : ''}
            </p>
          </>
        )}
      </section>

      <Secao id="t-pd-relacoes" titulo="O que anda junto" nota="Relação não é causa: é uma pista para investigar.">
        {relacoes.length === 0 ? (
          <p className={NOTA}>
            Ainda não há relação para mostrar. Ela aparece quando, na mesma hora do dia, houve dias com mais e dias com menos
            gente — e um critério do mesmo setor para comparar.
          </p>
        ) : (
          <div className={GRADE_DE_CARTOES} data-relacoes>
            {relacoes.map((r, i) => {
              const teto = Math.max(...r.linhas.map((l) => l[1]), 1);
              return (
                <article key={`${i}|${r.pergunta}`} className={`${CARTAO} flex flex-col gap-2.5 p-4`}>
                  <span className="text-[12.5px] text-farol-suave">{r.pergunta}</span>
                  <h3 className="text-balance text-[15px] font-semibold leading-snug">{r.titulo}</h3>
                  {r.linhas.map(([nome, v, calma]) => (
                    <div key={nome} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-[13px]">
                      <span className="min-w-0">{nome}</span>
                      <b className="font-mono text-[13px] font-semibold">{v.toFixed(1).replace('.', ',')}%</b>
                      <span className="col-span-2 h-2.5 overflow-hidden rounded-full bg-farol-realce">
                        <i className={`block h-full rounded-full ${calma ? 'bg-farol-graf-na' : 'bg-farol-critico'}`} style={{ width: `${(v / teto) * 100}%` }} />
                      </span>
                    </div>
                  ))}
                  <span className={NOTA}>{r.sufixo}</span>
                  <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1 text-xs text-farol-suave">
                    {r.forca === 'nenhuma' ? <Chip>sem relação</Chip> : <Chip tom={r.forca === 'forte' ? 'atencao' : 'neutro'}>relação {r.forca}</Chip>}
                    <span>{r.pe}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Secao>
    </div>
  );
}

// ───────────────────────── anomalias ─────────────────────────

export type FiltroDeSaidas = 'rever' | 'revistas' | 'todas';

function Regua({ a }: { a: SaidaDoPadrao }) {
  const maiorVisto = Math.max(a.visto, a.normal.max);
  const fundo = a.tipo === 'medida' ? Math.max(maiorVisto * 1.25, 0.001) : Math.min(100, Math.max(maiorVisto * 1.25, 1));
  const pc = (v: number): string => `${Math.min(100, (v / fundo) * 100).toFixed(1)}%`;
  return (
    <div
      className="relative h-[26px] max-w-[420px]"
      role="img"
      aria-label={`A faixa do normal vai de ${valorEmTexto(a.tipo, a.normal.min)} a ${valorEmTexto(a.tipo, a.normal.max)}; o que foi visto é ${valorEmTexto(a.tipo, a.visto)}.`}
      data-regua
    >
      <span className="absolute inset-x-0 top-2 h-2.5 rounded-full bg-farol-realce" />
      <span className="absolute top-2 h-2.5 rounded-full bg-farol-graf-ok" style={{ left: pc(a.normal.min), width: `calc(${pc(a.normal.max)} - ${pc(a.normal.min)})`, minWidth: 4 }} />
      <span className="absolute top-1 -ml-px h-[18px] w-0.5 rounded-sm bg-farol-ok" style={{ left: pc(a.normal.mediana) }} />
      <span
        className={`absolute top-[5px] -ml-2 h-4 w-4 rounded-full shadow-[0_0_0_3px_rgb(var(--painel))] ${a.grave ? 'bg-farol-critico' : 'bg-farol-facho'}`}
        style={{ left: pc(a.visto) }}
      />
    </div>
  );
}

export function Anomalias({
  dados,
  setor,
  filtro,
  configura,
  aoMudarFiltro,
  aoEsperado,
  aoProblema,
}: {
  dados: Padroes;
  setor: string;
  filtro: FiltroDeSaidas;
  configura: boolean;
  aoMudarFiltro: (f: FiltroDeSaidas) => void;
  aoEsperado: (a: SaidaDoPadrao) => void;
  aoProblema: (a: SaidaDoPadrao) => void;
}) {
  const mostradas = dados.anomalias
    .filter((a) => doSetor(a, setor))
    .filter((a) => filtro === 'todas' || (filtro === 'rever' ? a.estado === 'rever' : a.estado !== 'rever'));
  return (
    <div className="flex min-w-0 flex-col gap-3" data-lente="anomalias">
      <Secao
        id="t-pd-anomalias"
        titulo="Saídas do padrão"
        extra={
          <Segmentado
            rotulo="Mostrar"
            valor={filtro}
            aoMudar={aoMudarFiltro}
            opcoes={[
              { valor: 'rever', rotulo: 'A rever' },
              { valor: 'revistas', rotulo: 'Revistas' },
              { valor: 'todas', rotulo: 'Todas' },
            ]}
          />
        }
      >
        <p className={NOTA}>
          Uma saída do padrão é uma hora muito diferente do que costuma ser naquele dia e naquela hora — mesmo quando nenhum
          critério avisou. Você diz se era esperado ou se é problema; a resposta ensina o padrão ou vira critério.
        </p>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-farol-suave" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-[3px] bg-farol-graf-ok" />o que é normal naquele dia e hora
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-farol-facho" />o que foi visto
          </span>
        </div>
        <ul className={`${CARTAO} flex flex-col`} data-saidas>
          {mostradas.length === 0 && (
            <li className="p-4 text-[13px] text-farol-suave">
              {filtro === 'rever' ? 'Nada para rever. O que fugir do padrão aparece aqui.' : filtro === 'revistas' ? 'Nenhuma saída do padrão revista ainda.' : 'Nenhuma saída do padrão neste período.'}
            </li>
          )}
          {mostradas.map((a) => {
            const q = quandoFoi(a.dia, dados.hoje);
            return (
              <li key={a.id} className="grid grid-cols-1 gap-x-4 gap-y-1.5 border-farol-borda p-4 md:grid-cols-[96px_minmax(0,1fr)] [&+li]:border-t" data-saida={a.id}>
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 font-mono text-[12.5px] font-medium text-farol-suave md:flex-col md:gap-0.5">
                  <b className="font-sans text-[13.5px] font-semibold text-farol-tinta">{q.curto}</b>
                  {q.data && <span>{q.data}</span>}
                  <span>{horasDe(a.hora)}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] font-semibold leading-snug">
                    {a.titulo}
                    <Chip tom="vazado" icone={Cctv}>
                      {a.onde}
                    </Chip>
                    {a.estado === 'rever' ? (
                      <Chip tom={a.grave ? 'critico' : 'atencao'}>{a.grave ? 'muito fora do normal' : 'fora do normal'}</Chip>
                    ) : a.estado === 'esperado' ? (
                      <Chip tom="ok" icone={Check}>
                        esperado
                      </Chip>
                    ) : (
                      <Chip tom="ok" icone={Wrench}>
                        corrigido
                      </Chip>
                    )}
                  </h3>
                  <p className="text-[13.5px]">
                    <Texto frase={a.conta} />
                  </p>
                  <Regua a={a} />
                  {a.mais && <p className={NOTA}>{a.mais}</p>}
                  {a.estado === 'rever' ? (
                    (configura || a.camera) && (
                      <div className="mt-0.5 flex flex-wrap gap-2 max-md:[&>button]:flex-auto">
                        {configura && (
                          <>
                            <Botao mini onClick={() => aoEsperado(a)}>
                              <Check className="h-[15px] w-[15px]" aria-hidden />
                              Era esperado
                            </Botao>
                            <Botao mini variante="primario" onClick={() => aoProblema(a)}>
                              <Flag className="h-[15px] w-[15px]" aria-hidden />
                              É problema
                            </Botao>
                          </>
                        )}
                        {a.camera && (
                          <Link href={`/pontos/${a.pontoId}/area`} className="elo self-center text-[13px]">
                            Ver o quadro do canal
                            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                          </Link>
                        )}
                      </div>
                    )
                  ) : (
                    a.revisao && (
                      <div className={`${CAIXA} flex items-start gap-2.5 text-[13px]`} data-revisao>
                        {a.estado === 'esperado' ? (
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-farol-suave" aria-hidden />
                        ) : (
                          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-farol-suave" aria-hidden />
                        )}
                        <div className="min-w-0">
                          <b className="font-semibold">
                            {a.revisao.quem ?? 'Alguém da loja'} · {diaEMes(a.revisao.em)}
                          </b>
                          <span className="block text-farol-suave">{a.revisao.texto}</span>
                          {a.revisao.virou && <span className="block text-farol-suave">{a.revisao.virou}</span>}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Secao>
    </div>
  );
}

// ───────────────────────── tendência ─────────────────────────

/** O gráfico é desenhado no tamanho em que aparece: a letra não cresce no computador nem some no celular. */
function useLargura(): [React.RefObject<HTMLDivElement | null>, number] {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(640);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => el.clientWidth > 0 && setLargura(Math.max(280, Math.round(el.clientWidth)));
    medir();
    const olho = new ResizeObserver(medir);
    olho.observe(el);
    return () => olho.disconnect();
  }, []);
  return [caixa, largura];
}

function GraficoDeHoje({ h, nome }: { h: HojeContraONormal; nome: string }) {
  const [caixa, L] = useLargura();
  const A = L < 480 ? 190 : 230;
  const m = { e: 30, d: 10, c: 14, b: 26 };
  const vistos = h.horas.map((x) => x.visto).filter((v): v is number => v !== null);
  const teto = Math.max(1, Math.ceil(Math.max(...h.horas.map((x) => x.max), ...vistos) * 1.15));
  const passo = (L - m.e - m.d) / h.horas.length;
  const x = (i: number): number => m.e + passo * (i + 0.5);
  const y = (v: number): number => m.c + (1 - v / teto) * (A - m.c - m.b);
  const pts = (ps: Array<[number, number]>): string => ps.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  // a primeira hora que ainda não fechou: é onde está o "agora"
  const corrente = h.horas.findIndex((hora) => !hora.completa);
  const agoraX = corrente < 0 ? null : m.e + passo * corrente;
  const banda = [...h.horas.map((n, i): [number, number] => [x(i), y(n.max)]), ...h.horas.map((n, i): [number, number] => [x(i), y(n.min)]).reverse()];
  const pontos = h.horas.map((hora, i) => (hora.visto === null ? null : { cx: x(i), cy: y(hora.visto), parcial: !hora.completa })).filter((p) => p !== null);
  return (
    <div ref={caixa} data-hoje-contra-o-normal>
      <svg
        className="hn"
        viewBox={`0 0 ${L} ${A}`}
        width={L}
        height={A}
        role="img"
        aria-label={`${nome}: hoje até agora, comparado com a faixa do normal ${dosDias(h.diaDaSemana)}.`}
      >
        {[teto, teto / 2].map((v) => (
          <g key={v}>
            <line className="grade" x1={m.e} x2={L - m.d} y1={y(v)} y2={y(v)} />
            <text x={m.e - 6} y={y(v) + 4} textAnchor="end">
              {String(v).replace('.', ',')}
            </text>
          </g>
        ))}
        <line className="base" x1={m.e} x2={L - m.d} y1={y(0)} y2={y(0)} />
        <text x={m.e - 6} y={y(0) + 4} textAnchor="end">
          0
        </text>
        {agoraX !== null && <rect className="depois" x={agoraX.toFixed(1)} y={m.c} width={(L - m.d - agoraX).toFixed(1)} height={A - m.c - m.b} />}
        <polygon className="banda" points={pts(banda)} />
        <polyline className="normal" points={pts(h.horas.map((n, i) => [x(i), y(n.media)]))} />
        <polyline className="hoje" points={pts(pontos.map((p) => [p.cx, p.cy]))} />
        {pontos.map((p) => (
          <circle key={p.cx} className={`hoje-pt${p.parcial ? ' parcial' : ''}`} cx={p.cx.toFixed(1)} cy={p.cy.toFixed(1)} r="4.5" />
        ))}
        {agoraX !== null && (
          <>
            <line className="agora" x1={agoraX.toFixed(1)} x2={agoraX.toFixed(1)} y1={m.c} y2={y(0)} />
            <text className="agora-txt" x={(agoraX + 5).toFixed(1)} y={m.c + 10}>
              agora
            </text>
          </>
        )}
        {h.horas.map((hora, i) => (
          <text key={hora.hora} x={x(i).toFixed(1)} y={A - 8} textAnchor="middle">
            {hh(hora.hora)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** O fio de uma tendência: um ponto por semana, o último em destaque. */
function Fio({ serie, limite }: { serie: number[]; limite: number | null }) {
  const L = 132;
  const A = 44;
  let maior = Math.max(...serie, limite ?? -Infinity);
  let menor = Math.min(...serie, limite ?? Infinity);
  // variação pequena não pode parecer um vale: a régua tem pelo menos um terço do valor de altura
  const minimo = (Math.abs(serie.reduce((a, b) => a + b, 0)) / serie.length) * 0.34;
  if (maior - menor < minimo) {
    const meio = (maior + menor) / 2;
    maior = meio + minimo / 2;
    menor = meio - minimo / 2;
  }
  const folga = (maior - menor || 1) * 0.18;
  const x = (i: number): number => 6 + (i * (L - 12)) / Math.max(serie.length - 1, 1);
  const y = (v: number): number => A - 6 - ((v - (menor - folga)) / (maior - menor + 2 * folga)) * (A - 12);
  return (
    <svg className="fio" viewBox={`0 0 ${L} ${A}`} aria-hidden>
      {limite !== null && <line className="limite" x1={0} x2={L} y1={y(limite).toFixed(1)} y2={y(limite).toFixed(1)} />}
      <polyline points={serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
      {serie.map((v, i) => (
        <circle key={i} className={i === serie.length - 1 ? 'ultimo' : undefined} cx={x(i).toFixed(1)} cy={y(v).toFixed(1)} r={i === serie.length - 1 ? 4.5 : 3} />
      ))}
    </svg>
  );
}

function CartaoDeTendencia({ t }: { t: TendenciaDoPadrao }) {
  const ruim = t.sentido === t.ruim;
  return (
    <article className={`${CARTAO} flex flex-col gap-2 p-4`} data-tendencia={t.titulo}>
      <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[14.5px] font-semibold leading-snug">
        {t.titulo}
        {t.sentido === 'estável' ? (
          <Chip icone={Minus}>estável</Chip>
        ) : (
          <Chip tom={ruim ? 'atencao' : 'ok'} icone={t.sentido === 'sobe' ? TrendingUp : TrendingDown}>
            {t.sentido}
            {t.seguidas > 1 ? ` há ${t.seguidas} semanas` : ''}
          </Chip>
        )}
      </h3>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <span className="min-w-0 font-display text-[26px] font-semibold leading-tight tracking-tight tabular-nums">
          {t.valor}
          <small className="block font-sans text-[12.5px] font-medium leading-snug tracking-normal text-farol-suave">{t.legenda}</small>
        </span>
        <Fio serie={t.serie} limite={t.limite} />
      </div>
      <p className={NOTA}>
        <Texto frase={t.texto} />
      </p>
    </article>
  );
}

export function Tendencia({
  dados,
  setor,
  hojeInd,
  aoMudarHojeInd,
}: {
  dados: Padroes;
  setor: string;
  hojeInd: string;
  aoMudarHojeInd: (id: string) => void;
}) {
  const setorDe = new Map(dados.indicadores.map((i) => [i.id, i.setorId]));
  const doDia = dados.hojeContraONormal.filter((h) => doSetor({ setorId: setorDe.get(h.indicadorId) ?? '' }, setor));
  const h = doDia.find((x) => x.indicadorId === hojeInd) ?? doDia[0];
  const tendencias = dados.tendencias.filter((t) => doSetor(t, setor));
  const diaDeHoje = h?.diaDaSemana ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-lente="tendencia">
      <section className={`${CARTAO} flex min-w-0 flex-col gap-3 p-4`} aria-labelledby="t-pd-hoje">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Titulo id="t-pd-hoje">{h ? `Hoje contra o normal ${dosDias(diaDeHoje)}` : 'Hoje contra o normal'}</Titulo>
          {/* As opções são nomes de critério, do tamanho que a loja escreveu: quando não cabem lado a lado, o
              seletor quebra a linha (cada nome inteiro) em vez de espremer ou de passar da tela. */}
          {doDia.length > 1 && h && (
            <div className="min-w-0 max-w-full max-md:w-full md:ml-auto [&>div]:flex-wrap max-md:[&>div]:flex max-md:[&>div]:w-full [&_button]:flex-auto" data-o-que-comparar>
              <Segmentado rotulo="O que comparar" valor={h.indicadorId} aoMudar={aoMudarHojeInd} opcoes={doDia.map((x) => ({ valor: x.indicadorId, rotulo: x.rotulo }))} />
            </div>
          )}
        </div>
        {h ? (
          <>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-farol-suave" aria-hidden>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-[3px] bg-farol-graf-ok" />
                faixa do normal
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="w-3.5 border-t-2 border-dashed border-farol-ok" />o esperado
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-[3px] w-3.5 rounded-sm bg-farol-marca" />
                hoje, até agora
              </span>
            </div>
            <GraficoDeHoje h={h} nome={h.rotulo} />
            <p className={NOTA} data-hoje-nota>
              {h.nota}
            </p>
          </>
        ) : (
          <p className={NOTA}>
            Aparece quando um critério de presença ou de contagem deste setor tem padrão para o dia da semana de hoje.
          </p>
        )}
      </section>
      {tendencias.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-tendencias>
          {tendencias.map((t, i) => (
            // a posição entra na chave: a tela não depende de o servidor nunca repetir um título
            <CartaoDeTendencia key={`${i}|${t.setorId}|${t.titulo}`} t={t} />
          ))}
        </div>
      ) : (
        <p className={NOTA}>Tendência semana a semana precisa de três semanas de análises.</p>
      )}
      <p className={NOTA}>Tendência feita de quatro semanas é indício, não previsão: quanto mais semanas, mais firme ela fica.</p>
    </div>
  );
}

// ───────────────────────── sugestões ─────────────────────────

const ICONE_DA_SUGESTAO: Record<SugestaoDoPadrao['icone'], LucideIcon> = {
  area: Crop,
  pessoa: UserRoundCheck,
  foto: IconeDeFoto,
  criterio: Hash,
  duvida: CircleHelp,
};

export function Sugestoes({
  dados,
  setor,
  configura,
  aoAgir,
}: {
  dados: Padroes;
  setor: string;
  configura: boolean;
  /** Abrir ou criar um critério: quem sabe como é a página. */
  aoAgir: (s: SugestaoDoPadrao) => void;
}) {
  const sugestoes = dados.sugestoes.filter((s) => doSetor(s, setor));
  return (
    <div className="flex min-w-0 flex-col gap-3" data-lente="sugestoes">
      <Secao id="t-pd-sugestoes" titulo="Para melhorar o controle" nota="O que os números mostram sobre os próprios critérios.">
        <ul className={`${CARTAO} flex flex-col`} data-sugestoes>
          {sugestoes.length === 0 && (
            <li className="p-4 text-[13px] text-farol-suave">Nenhuma sugestão agora: os números não apontam ajuste nos critérios.</li>
          )}
          {sugestoes.map((s, i) => {
            const Icone = ICONE_DA_SUGESTAO[s.icone];
            return (
              <li key={`${i}|${s.icone}|${s.titulo}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-1 border-farol-borda p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] [&+li]:border-t">
                <span className="row-span-2 grid h-9 w-9 place-items-center rounded-[10px] bg-farol-facho-leve text-farol-facho-tinta">
                  <Icone className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <h3 className="text-[15px] font-semibold leading-snug">{s.titulo}</h3>
                <p className="col-start-2 text-[13.5px] text-farol-suave">
                  <Texto frase={s.texto} />
                </p>
                <div className="col-span-2 mt-1.5 md:col-span-1 md:col-start-3 md:row-span-2 md:row-start-1 md:mt-0 md:self-center [&>*]:max-md:w-full">
                  {s.acao.tipo === 'area' ? (
                    <Link href={`/pontos/${s.acao.pontoId}/area`} className={classesDoBotao({ mini: true })}>
                      {s.acao.rotulo}
                      <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                    </Link>
                  ) : (
                    configura && (
                      <Botao mini onClick={() => aoAgir(s)}>
                        {s.acao.rotulo}
                        <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                      </Botao>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Secao>
    </div>
  );
}
