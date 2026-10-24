'use client';

// =====================================================================
// A conferência POR PASSO: o pão pelas peças, e um cartão por passo
// =====================================================================
// A23.3. O protótipo aprovado pelo dono em 20/10/2026 ("conferência por
// passo"): a leitura ao vivo da bancada lê o lanche em PASSOS — em cada
// metade do pão, o que chegou e quando — e o juiz de ingrediente da loja diz
// o nome e a nota. Aqui:
//
//   • o PÃO pelas peças: 3 peças é o pão de dois cortes (o único com a fatia
//     do meio); com 2, o Farol ainda não separa o de 1 corte do brioche, e
//     pergunta. Certo / Era outro;
//   • um CARTÃO POR PASSO: o recorte da peça em que o ingrediente chegou,
//     com o tracejado do que chegou, e a leitura com a certeza (pela nota do
//     juiz). Certo / Era outro / Não era ingrediente. O passo que o juiz
//     tirou ("vazio") pergunta ao contrário: Certo, não era / Era um
//     ingrediente;
//   • "marcar os de certeza alta ou média como certos": fica para a pessoa
//     o que o Farol não tem certeza;
//   • o fechamento, as peças que saíram e os movimentos ignorados.
//
// A resposta vai como a conferência POR ETAPA (uma por etapa, na ordem). O
// "não era ingrediente" de um passo vira exemplo do que NÃO é ingrediente
// (migration 054), e cada nome confirmado ou corrigido vira exemplo do
// ingrediente — do jeito que o juiz da loja compara.
// =====================================================================

import { Check, ZoomIn } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { chaveDoIngrediente } from '@/componentes/fichas/chave-do-ingrediente';
import { plural } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Chip, type Tom } from '@/componentes/ui/pecas';
import { treinoApi, type ConferenciaDoLanche, type ConferenciaPorEtapa, type EtapaDoLanche, type RespostaDaEtapa } from '@/lib/api';

const chave = chaveDoIngrediente;

/** A certeza pela nota do juiz: alta de 0,60 para cima, média de 0,52; abaixo, pouca (a API põe abaixo de 0,55 na dúvida). */
export const NOTA_ALTA = 0.6;
export const NOTA_MEDIA = 0.52;
export type Certeza = 'alta' | 'media' | 'baixa' | 'sem';
const CERTEZA: Record<Certeza, [Tom, string]> = {
  alta: ['ok', 'certeza alta'],
  media: ['neutro', 'certeza média'],
  baixa: ['atencao', 'pouca certeza'],
  sem: ['atencao', 'sem leitura'],
};
export const certezaDa = (e: EtapaDoLanche): Certeza =>
  !e.leu || e.nota === undefined ? 'sem' : e.nota >= NOTA_ALTA ? 'alta' : e.nota >= NOTA_MEDIA ? 'media' : 'baixa';

/** Os passos que a pessoa confere: o passo, o provisório e o vazio (o que o juiz tirou). */
const CONFERIVEIS = new Set(['passo', 'provisorio', 'vazio']);
export const conferiveis = (etapas: EtapaDoLanche[]): number[] => etapas.flatMap((e, i) => (CONFERIVEIS.has(e.tipo ?? '') ? [i] : []));
export const comecos = (etapas: EtapaDoLanche[]): number[] => etapas.flatMap((e, i) => (e.tipo === 'comeco' ? [i] : []));
export const ehPao = (nome: string) => chave(nome).startsWith('pao');

export type RespostaDoPasso = { v: 'certo' | 'outro' | 'nada' | null; nome: string };
export type RespostasPorPasso = { pao: { v: 'certo' | 'outro' | null; nome: string }; passos: Record<number, RespostaDoPasso> };
export const semRespostas = (): RespostasPorPasso => ({ pao: { v: null, nome: '' }, passos: {} });

/**
 * O pão pelas peças (o protótipo): 3 peças é o pão de dois cortes — o único com a fatia do meio —, quando a loja tem um
 * pão com esse nome; com outro número de peças, o Farol não diz (por cima, ele ainda não separa o de 1 corte do
 * brioche) e pergunta.
 */
export function paoPelasPecas(pecas: number | null, paes: string[]): string | null {
  if (pecas !== 3) return null;
  // pelo nome sem acento e sem maiúscula (a chave do ingrediente põe no singular: "dois" vira "doi")
  const simples = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const doisCortes = paes.filter((n) => /\b(dois|2) cortes?\b/.test(simples(n)));
  return doisCortes.length === 1 ? doisCortes[0]! : null;
}

/** O que já foi respondido volta (conferir de novo): a resposta guardada é a por etapa. */
export function respostasGuardadas(etapas: EtapaDoLanche[], ja: ConferenciaDoLanche | null, paoLido: string | null): RespostasPorPasso {
  const r = semRespostas();
  if (!ja || !('etapas' in ja) || !Array.isArray(ja.etapas)) return r;
  for (const i of conferiveis(etapas)) {
    const x = ja.etapas[i];
    if (x) r.passos[i] = { v: x.v, nome: x.nome ?? '' };
  }
  const doPao = comecos(etapas)
    .map((i) => ja.etapas[i])
    .find((x): x is NonNullable<RespostaDaEtapa> => !!x);
  if (doPao) {
    // o "certo" do pão vai como "outro" quando a leitura do começo não disse o mesmo nome: volta como "certo"
    const nome = doPao.v === 'outro' ? (doPao.nome ?? '') : '';
    r.pao = doPao.v === 'certo' || (paoLido && chave(nome) === chave(paoLido)) ? { v: 'certo', nome: '' } : { v: 'outro', nome };
  }
  return r;
}

/** O pão que a resposta diz: o lido (pelas peças) confirmado, ou o que a pessoa escolheu. */
const paoDaResposta = (r: RespostasPorPasso, paoLido: string | null): string | null =>
  r.pao.v === 'certo' ? paoLido : r.pao.v === 'outro' ? r.pao.nome.trim() || null : null;

/** O nome que o passo ensina: o lido ("certo"), ou o que a pessoa disse ("outro"). */
const nomeDoPasso = (e: EtapaDoLanche, x: RespostaDoPasso | undefined): string | null =>
  x?.v === 'certo' ? e.leu : x?.v === 'outro' ? x.nome.trim() || null : null;

/**
 * A conferência POR ETAPA que vai para a API: cada começo (a janela de cada peça) ensina o pão; cada passo, o nome — o
 * "certo" só onde a leitura disse um nome só (senão vai como "outro", com o nome lido); "não era ingrediente" é `nada`.
 */
export function corpoPorPasso(
  etapas: EtapaDoLanche[],
  r: RespostasPorPasso,
  paoLido: string | null,
  produto: string | null,
  faltas: ConferenciaPorEtapa['faltas'],
  aMais: ConferenciaPorEtapa['aMais'],
): ConferenciaPorEtapa {
  const respostas: RespostaDaEtapa[] = etapas.map(() => null);
  const pao = paoDaResposta(r, paoLido);
  if (pao) {
    for (const i of comecos(etapas)) {
      const e = etapas[i]!;
      respostas[i] = e.candidatos.length === 1 && chave(e.candidatos[0]!) === chave(pao) ? { v: 'certo' } : { v: 'outro', nome: pao };
    }
  }
  for (const i of conferiveis(etapas)) {
    const e = etapas[i]!;
    const x = r.passos[i];
    if (!x?.v) continue;
    if (x.v === 'nada') respostas[i] = { v: 'nada' };
    else if (x.v === 'certo') respostas[i] = e.candidatos.length === 1 ? { v: 'certo' } : e.leu ? { v: 'outro', nome: e.leu } : null;
    else if (x.nome.trim()) respostas[i] = { v: 'outro', nome: x.nome.trim() };
  }
  return { produto, etapas: respostas, faltas, aMais };
}

/** O que a resposta diz que foi visto (a conta da ficha): o pão e cada nome dos passos, com as vezes da leitura. */
export function vistosPorPasso(etapas: EtapaDoLanche[], r: RespostasPorPasso, paoLido: string | null): Map<string, { nome: string; vezes: number }> {
  const conta = new Map<string, { nome: string; vezes: number }>();
  const soma = (nome: string, vezes: number) => {
    const k = chave(nome);
    const ja = conta.get(k);
    conta.set(k, { nome: ja?.nome ?? nome, vezes: (ja?.vezes ?? 0) + vezes });
  };
  const pao = paoDaResposta(r, paoLido);
  if (pao) soma(pao, 1);
  for (const i of conferiveis(etapas)) {
    const nome = nomeDoPasso(etapas[i]!, r.passos[i]);
    if (!nome) continue;
    // o passo que é o pão (a tampa que chega por cima) não soma outro pão: o pão do lanche conta uma vez só
    if (ehPao(nome)) {
      if (![...conta.keys()].some((k) => k.startsWith('pao'))) soma(nome, 1);
      continue;
    }
    soma(nome, etapas[i]!.vezes);
  }
  return conta;
}

/** Quantas respostas faltam: cada passo sem resposta (ou "era outro" sem o nome) e o pão. */
export function faltamPorPasso(etapas: EtapaDoLanche[], r: RespostasPorPasso): number {
  const passos = conferiveis(etapas).filter((i) => {
    const x = r.passos[i];
    return !x?.v || (x.v === 'outro' && !x.nome.trim());
  }).length;
  const pao = comecos(etapas).length > 0 && !(r.pao.v === 'certo' || (r.pao.v === 'outro' && r.pao.nome.trim())) ? 1 : 0;
  return passos + pao;
}

// ───────────────────────── a tela ─────────────────────────

export function PassosDoLanche({
  id,
  etapas,
  pecas,
  paes,
  paoLido,
  ingredientes,
  r,
  aoMudar,
  horaDe,
  aoAbrirRecorte,
}: {
  id: string;
  etapas: EtapaDoLanche[];
  pecas: number | null;
  /** Os pães das fichas, para "Era outro". */
  paes: string[];
  /** O pão pelas peças (nulo = o Farol pergunta). */
  paoLido: string | null;
  /** Os ingredientes das fichas que se veem de cima, com os pães no fim (a tampa que chega por cima é um passo). */
  ingredientes: string[];
  r: RespostasPorPasso;
  aoMudar: (r: RespostasPorPasso) => void;
  horaDe: (iso: string) => string;
  /** Abre o recorte do passo `i` maior. */
  aoAbrirRecorte: (i: number) => void;
}) {
  const [verIgnorados, setVerIgnorados] = useState(false);
  const passos = conferiveis(etapas);
  const ignorados = etapas.flatMap((e, i) => (e.tipo === 'transitorio' ? [i] : []));
  const saidas = etapas.flatMap((e, i) => (e.tipo === 'saiu' ? [i] : []));
  const fechou = etapas.find((e) => e.tipo === 'fechou') ?? null;
  // o atalho: os de certeza alta ou média ainda sem resposta
  const seguros = passos.filter((i) => !r.passos[i]?.v && etapas[i]!.tipo !== 'vazio' && ['alta', 'media'].includes(certezaDa(etapas[i]!)));

  const mudarPasso = (i: number, muda: (x: RespostaDoPasso) => RespostaDoPasso) =>
    aoMudar({ ...r, passos: { ...r.passos, [i]: muda(r.passos[i] ?? { v: null, nome: '' }) } });
  const alternar = (i: number, v: NonNullable<RespostaDoPasso['v']>) => mudarPasso(i, (x) => (x.v === v ? { v: null, nome: '' } : { v, nome: v === 'outro' ? x.nome : '' }));

  return (
    <>
      {/* ───────────── o pão ───────────── */}
      <section className="flex flex-col gap-2" aria-labelledby={`${id}-pao`} data-pao-do-lanche>
        <h3 id={`${id}-pao`} className={ROTULO}>
          O pão
        </h3>
        <div className="flex flex-wrap items-start gap-3">
          <Pecas n={pecas ?? comecos(etapas).length} />
          <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
            {paoLido ? (
              <>
                <p className="text-[13.5px]">
                  {r.pao.v === 'outro' && r.pao.nome ? (
                    <>
                      <s className="text-farol-suave">{paoLido}</s> <b className="font-semibold">{r.pao.nome}</b>
                    </>
                  ) : (
                    <b className="font-semibold">{paoLido}</b>
                  )}{' '}
                  <Chip tom="ok">pelas peças</Chip>
                </p>
                <p className={AJUDA}>Pelas 3 peças: só o pão de dois cortes tem a fatia do meio.</p>
                <div role="group" aria-label="O pão" className="flex flex-wrap gap-1.5">
                  <Opcao marcada={r.pao.v === 'certo'} aoClicar={() => aoMudar({ ...r, pao: r.pao.v === 'certo' ? { v: null, nome: '' } : { v: 'certo', nome: '' } })}>
                    Certo
                  </Opcao>
                  <Opcao marcada={r.pao.v === 'outro'} aoClicar={() => aoMudar({ ...r, pao: r.pao.v === 'outro' ? { v: null, nome: '' } : { v: 'outro', nome: r.pao.nome } })}>
                    Era outro
                  </Opcao>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13.5px]">
                  <b className="font-semibold">{plural(pecas ?? comecos(etapas).length, 'peça', 'peças')}</b> <Chip tom="atencao">diga qual</Chip>
                </p>
                <p className={AJUDA}>Com 2 peças pode ser o de 1 corte ou um brioche. Por cima, o Farol ainda não separa os dois: diga qual era.</p>
              </>
            )}
            {(!paoLido || r.pao.v === 'outro') && (
              <Lista
                id={`${id}-pao-qual`}
                rotulo="Qual pão"
                opcoes={paes}
                valor={r.pao.nome}
                aoMudar={(nome) => aoMudar({ ...r, pao: { v: nome ? 'outro' : null, nome } })}
              />
            )}
          </div>
        </div>
      </section>

      {/* ───────────── os passos ───────────── */}
      <section className="flex flex-col gap-2" aria-labelledby={`${id}-passos`}>
        <h3 id={`${id}-passos`} className={ROTULO}>
          Os passos, na ordem
        </h3>
        <p className={AJUDA}>
          Cada recorte é só a peça em que o ingrediente chegou; o tracejado é o que chegou naquele passo. Cada nome confirmado vira um exemplo, do jeito
          que o Farol compara. O que não era ingrediente também ensina.
        </p>
        {seguros.length > 0 && (
          <div>
            <Botao
              mini
              className="max-w-full py-1.5"
              onClick={() => aoMudar({ ...r, passos: { ...r.passos, ...Object.fromEntries(seguros.map((i) => [i, { v: 'certo' as const, nome: '' }])) } })}
              data-marcar-certos
            >
              <Check className="h-[15px] w-[15px] shrink-0" aria-hidden />
              <span className="whitespace-normal text-left leading-snug">
                {seguros.length === 1 ? 'Marcar como certo o passo de certeza alta ou média' : `Marcar como certos os ${seguros.length} passos de certeza alta ou média`}
              </span>
            </Botao>
          </div>
        )}
        {passos.length === 0 ? (
          <p className={AJUDA}>Nenhum passo para conferir neste lanche.</p>
        ) : (
          <ol className="flex flex-col gap-2.5" data-passos>
            {passos.map((i) => (
              <CartaoDoPasso
                key={i}
                id={`${id}-p${i}`}
                e={etapas[i]!}
                x={r.passos[i]}
                hora={horaDe(etapas[i]!.hora)}
                ingredientes={ingredientes}
                aoAlternar={(v) => alternar(i, v)}
                aoEscolher={(nome) => mudarPasso(i, () => ({ v: 'outro', nome }))}
                aoAbrir={() => aoAbrirRecorte(i)}
              />
            ))}
          </ol>
        )}
        {saidas.map((i) => (
          <p key={i} className={`${AJUDA} flex items-start gap-1.5`} data-saiu>
            <span aria-hidden>■</span>
            <span>
              <b className="font-mono text-farol-tinta">{horaDe(etapas[i]!.hora)}</b> a peça {etapas[i]!.metade} saiu (embrulhada, fechada na caixa ou levada):
              daí em diante o Farol não conta nela.
            </span>
          </p>
        ))}
        {fechou && (
          <p className={`${AJUDA} flex items-start gap-1.5`} data-fechou>
            <span aria-hidden>■</span>
            <span>
              <b className="font-mono text-farol-tinta">{horaDe(fechou.hora)}</b> fechado: a tampa foi para cima da base. Daqui em diante é o embrulho, e o
              Farol não conta.
            </span>
          </p>
        )}
        {ignorados.length > 0 && (
          <div className="flex flex-col gap-1.5" data-ignorados>
            <div className="flex flex-wrap items-center gap-2">
              <span className={AJUDA}>
                <b className="font-semibold text-farol-tinta">{plural(ignorados.length, 'movimento ignorado', 'movimentos ignorados')}</b> (a mão, o
                papel empurrado, a junção das peças)
              </span>
              <Botao mini onClick={() => setVerIgnorados((v) => !v)} aria-expanded={verIgnorados}>
                {verIgnorados ? 'Esconder' : 'Ver'}
              </Botao>
            </div>
            {verIgnorados && (
              <ul className={`${AJUDA} flex flex-col gap-0.5`}>
                {ignorados.map((i) => (
                  <li key={i}>
                    <span className="font-mono">{horaDe(etapas[i]!.hora)}</span> · peça {etapas[i]!.metade} · algo pousou e saiu
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function CartaoDoPasso({
  id,
  e,
  x,
  hora,
  ingredientes,
  aoAlternar,
  aoEscolher,
  aoAbrir,
}: {
  id: string;
  e: EtapaDoLanche;
  x: RespostaDoPasso | undefined;
  hora: string;
  ingredientes: string[];
  aoAlternar: (v: NonNullable<RespostaDoPasso['v']>) => void;
  aoEscolher: (nome: string) => void;
  aoAbrir: () => void;
}) {
  const vazio = e.tipo === 'vazio';
  const c = certezaDa(e);
  const atencao = !x?.v && (vazio || c === 'baixa' || c === 'sem');
  const [tom, texto] = vazio ? (['atencao', 'não era ingrediente?'] as [Tom, string]) : CERTEZA[c];
  let leitura: ReactNode;
  if (vazio) {
    leitura =
      x?.v === 'outro' && x.nome ? (
        <b className="font-semibold">{x.nome}</b>
      ) : (
        <>
          <b className="font-semibold">O Farol acha que não era ingrediente</b>
          {e.leu ? <span className="text-farol-suave"> (parece {e.leu})</span> : null}
        </>
      );
  } else if (e.leu) {
    leitura =
      x?.v === 'outro' && x.nome ? (
        <>
          <s className="text-farol-suave">{e.leu}</s> <b className="font-semibold">{x.nome}</b>
        </>
      ) : x?.v === 'nada' ? (
        <>
          <s className="text-farol-suave">{e.leu}</s> <b className="font-semibold">não era ingrediente</b>
        </>
      ) : (
        <b className="font-semibold">{e.leu}</b>
      );
  } else {
    leitura = <b className="font-semibold">{x?.v === 'outro' && x.nome ? x.nome : x?.v === 'nada' ? 'não era ingrediente' : 'O que era?'}</b>;
  }
  return (
    <li
      className={`flex gap-3 rounded-[10px] border p-2.5 ${atencao ? 'border-farol-facho' : 'border-farol-borda'} ${x?.v ? 'bg-farol-painel-2' : ''}`}
      data-passo={e.hora}
      data-tipo={e.tipo}
    >
      <Recorte e={e} hora={hora} aoAbrir={aoAbrir} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-farol-suave">
          <span className="font-mono text-farol-tinta">{hora}</span>
          <span>peça {e.metade}</span>
          {e.tipo === 'provisorio' && <Chip tom="atencao">parado um quadro só</Chip>}
        </p>
        <p className="break-words text-[13.5px]">
          {leitura} <Chip tom={tom}>{texto}</Chip>
        </p>
        <div role="group" aria-label={`O passo das ${hora}`} className="flex flex-wrap gap-1.5">
          {vazio ? (
            <>
              <Opcao marcada={x?.v === 'nada'} aoClicar={() => aoAlternar('nada')}>
                Certo, não era
              </Opcao>
              <Opcao marcada={x?.v === 'outro'} aoClicar={() => aoAlternar('outro')}>
                Era um ingrediente
              </Opcao>
            </>
          ) : e.leu ? (
            <>
              <Opcao marcada={x?.v === 'certo'} aoClicar={() => aoAlternar('certo')}>
                Certo
              </Opcao>
              <Opcao marcada={x?.v === 'outro'} aoClicar={() => aoAlternar('outro')}>
                Era outro
              </Opcao>
              <Opcao marcada={x?.v === 'nada'} aoClicar={() => aoAlternar('nada')}>
                Não era ingrediente
              </Opcao>
            </>
          ) : (
            <>
              <Opcao marcada={x?.v === 'outro'} aoClicar={() => aoAlternar('outro')}>
                Eu digo o que era
              </Opcao>
              <Opcao marcada={x?.v === 'nada'} aoClicar={() => aoAlternar('nada')}>
                Não era ingrediente
              </Opcao>
            </>
          )}
        </div>
        {x?.v === 'outro' && <Lista id={`${id}-qual`} rotulo="O que era" opcoes={ingredientes} valor={x.nome} aoMudar={aoEscolher} />}
      </div>
    </li>
  );
}

/** O recorte do passo, com o tracejado do que chegou. O tracejado está em pixels do quadro: o SVG usa o tamanho dele. */
function Recorte({ e, hora, aoAbrir }: { e: EtapaDoLanche; hora: string; aoAbrir: () => void }) {
  const [tamanho, setTamanho] = useState<[number, number] | null>(null);
  if (!e.quadroId) {
    return (
      <div className="grid h-24 w-24 shrink-0 place-items-center rounded-lg border border-dashed border-farol-borda-forte px-1 text-center text-[11px] text-farol-suave">
        sem recorte
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-farol-borda bg-farol-painel-2"
      aria-label={`Ver maior o recorte das ${hora} (peça ${e.metade})`}
      data-recorte-do-passo
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- o quadro vem da API com sessão; o otimizador do Next não alcança */}
      <img
        src={treinoApi.urlDoQuadro(e.quadroId)}
        alt=""
        className="h-full w-full object-cover"
        onLoad={(ev) => setTamanho([ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight])}
      />
      {tamanho && e.contorno?.length ? (
        <svg viewBox={`0 0 ${tamanho[0]} ${tamanho[1]}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {e.contorno.map((pedaco, k) => (
            <polygon
              key={k}
              points={pedaco.map(([px, py]) => `${px},${py}`).join(' ')}
              className="fill-farol-facho/15 stroke-farol-facho"
              strokeWidth={2.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : null}
      <span className="absolute bottom-1 right-1 grid h-6 w-6 place-items-center rounded-md bg-farol-fundo/85 text-farol-tinta opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
        <ZoomIn className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function Pecas({ n }: { n: number }) {
  return (
    <span className="flex shrink-0 gap-1" aria-hidden data-pecas={n}>
      {Array.from({ length: Math.max(1, Math.min(n, 6)) }, (_, k) => (
        <svg key={k} viewBox="0 0 30 30" width="30" height="30">
          <circle cx="15" cy="15" r="13" className="fill-farol-facho-tinta/70" />
          <circle cx="15" cy="15" r="10.5" className="fill-farol-facho-leve" />
        </svg>
      ))}
    </span>
  );
}

function Opcao({ marcada, aoClicar, children }: { marcada: boolean; aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      onClick={aoClicar}
      className={`inline-flex min-h-8 max-w-full items-center rounded-full border px-3 py-1 text-left text-xs font-medium transition-colors ${
        marcada ? 'border-farol-facho bg-farol-facho-leve text-farol-facho-tinta' : 'border-farol-borda-forte text-farol-suave hover:text-farol-tinta'
      }`}
    >
      {children}
    </button>
  );
}

function Lista({ id, rotulo, opcoes, valor, aoMudar }: { id: string; rotulo: string; opcoes: string[]; valor: string; aoMudar: (v: string) => void }) {
  return (
    <div className="flex max-w-sm flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        {rotulo}
      </label>
      <select id={id} className="entrada" value={valor} onChange={(ev) => aoMudar(ev.target.value)}>
        <option value="">{rotulo}: escolha</option>
        {opcoes.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
