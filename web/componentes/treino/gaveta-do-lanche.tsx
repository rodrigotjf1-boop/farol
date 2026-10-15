'use client';

// =====================================================================
// Conferir um lanche do treinamento: etapa por etapa, e a conta da ficha
// =====================================================================
// A21, fatia T4. Do protótipo aprovado pelo dono em 15/10/2026
// (`mockups/farol-conexoes-e-fichas.html`, tela Treinamento).
//
//   • "Qual lanche era?" — nada vem marcado: a pessoa escolhe. O palpite
//     da ficha (feito pela API com as fichas de hoje) aparece como "o Farol
//     acha";
//   • etapa por etapa: o quadro da etapa, o que a leitura da loja disse e
//     as escolhas. Quando a leitura disse UM nome: "Certo", "Era outro",
//     "Não era ingrediente". Quando disse um grupo (a cor não separa dois
//     molhos): um botão para cada nome possível. Quando não deu para ver:
//     "Eu sei o que era";
//   • a conta da ficha do lanche escolhido: o que bate, o que falta (o
//     cliente pediu assim, faltou, ou estava lá e o Farol não viu) e o que
//     veio a mais (pedido do cliente, ou a mais sem pedido). A ficha é o
//     padrão; a variação é legítima (o dono, 15/10/2026);
//   • salvar: cada etapa respondida com nome das fichas, e com quadro, vira
//     exemplo na base de conhecimento (quem decide é a API). A etapa sem
//     resposta não ensina;
//   • a miniatura da etapa abre o quadro inteiro, maior, por cima da gaveta
//     (`quadro-da-etapa.tsx`; pedido do dono e protótipo aprovado em 15/10).
// =====================================================================

import { Check, ChevronRight, ImageOff, Info, Lock, Minus, Plus, TriangleAlert, ZoomIn } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { diaFaladoNaLoja, frase, horaNaLoja, plural, quantidadeDaFicha } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta, Chip, Ossos } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import {
  ErroDaApi,
  fichasApi,
  treinoApi,
  type ConferenciaDoLanche,
  type EtapaDoLanche,
  type LancheParaConferir,
  type ProdutoDaFicha,
  type RespostaDaEtapa,
} from '@/lib/api';

import { QuadroDaEtapa, type EtapaNoQuadro } from './quadro-da-etapa';

const chave = (s: string) => s.trim().toLowerCase();
const mensagemDe = (e: unknown, padrao: string) => frase(e instanceof ErroDaApi ? e.message : padrao);
/** No seletor de "Era outro": o nome que não está nas fichas (escrito à mão) e o "não sei". */
const NOVO = '__novo';
const NAO_SEI = '__naosei';

export const LADO_FALADO: Record<EtapaDoLanche['lado'], string> = { pao: 'pão aberto', tampo: 'tampo', base: 'base', outro: 'outro lugar' };

/** A hora no relógio da loja, com os segundos: "19:37:08". */
export function horaComSegundos(iso: string | null, fuso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
}

/** O horário de uma gravação no relógio da loja: "hoje, 19:30 às 20:00", "14/10, 21:30 às 22:00". */
export function quandoDaGravacao(inicio: string, fim: string, fuso: string): string {
  return `${diaFaladoNaLoja(inicio, fuso)} às ${horaNaLoja(fim, fuso)}`;
}

/** Quantas vezes o ingrediente entra: o número quando se conta de cima (fatia, unidade); o resto é presença. A mesma conta da API. */
function vezesNaFicha(quantidade: number | null, unidade: string | null): number {
  const u = (unidade ?? '').trim().toLowerCase();
  if (quantidade !== null && Number.isInteger(quantidade) && quantidade >= 1 && /^(fatias?|unidades?|un|und)$/.test(u)) return quantidade;
  return 1;
}

/** O nome que a etapa mostra agora: o que a pessoa respondeu; sem resposta, o da leitura quando ela disse um nome só. */
function nomeDaEtapa(e: EtapaDoLanche, r: RespostaDaEtapa, novo: string): string | null {
  if (r?.v === 'certo') return e.candidatos[0] ?? null;
  if (r?.v === 'outro') return r.nome === NOVO ? novo.trim() || null : r.nome?.trim() || null;
  if (r?.v === 'nada') return null;
  return e.candidatos.length === 1 ? e.candidatos[0]! : null;
}

type Escolha = string | '__nao' | '__outro' | null;

export function GavetaDoLanche({
  lojaId,
  lancheId,
  fuso,
  posicao,
  aoSalvar,
  aoPular,
  aoFechar,
}: {
  lojaId: string;
  lancheId: string;
  fuso: string;
  /** "2 de 5 para conferir", quando o lanche está na fila. */
  posicao: string | null;
  /** Depois de salvar: a tela recarrega e abre o próximo. */
  aoSalvar: (texto: string) => void;
  aoPular: (texto: string) => void;
  aoFechar: () => void;
}) {
  const p = useId();
  const [d, setD] = useState<LancheParaConferir | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | 'salvar' | 'pular'>(null);
  const [escolha, setEscolha] = useState<Escolha>(null);
  const [outroProduto, setOutroProduto] = useState('');
  const [etapas, setEtapas] = useState<RespostaDaEtapa[]>([]);
  const [novos, setNovos] = useState<Record<number, string>>({});
  const [faltas, setFaltas] = useState<ConferenciaDoLanche['faltas']>({});
  const [aMais, setAMais] = useState<ConferenciaDoLanche['aMais']>({});
  const [ficha, setFicha] = useState<ProdutoDaFicha | null>(null);
  // a etapa aberta no quadro maior; e, ao fechar, a etapa cuja miniatura recebe o foco
  const [quadro, setQuadro] = useState<number | null>(null);
  const voltarPara = useRef<number | null>(null);

  useEffect(() => {
    let vivo = true;
    // outro lanche na mesma gaveta (o "ir para o próximo"): nada do anterior fica
    setD(null);
    setErro(null);
    setOcupado(null);
    setNovos({});
    setQuadro(null);
    treinoApi
      .lanche(lancheId)
      .then((r) => {
        if (!vivo) return;
        setD(r);
        // o que já foi respondido volta (conferir de novo); senão, nada marcado
        const ja = r.resposta;
        if (ja) {
          // o nome escrito à mão (fora das fichas) volta no campo de escrever
          const conhecidos = new Set(r.ingredientes.map(chave));
          const escritos: Record<number, string> = {};
          setEtapas(
            ja.etapas.map((x, i) => {
              if (x?.v !== 'outro' || !x.nome) return x;
              const doGrupo = r.etapas[i]!.candidatos.length > 1 && r.etapas[i]!.candidatos.includes(x.nome);
              if (doGrupo || conhecidos.has(chave(x.nome))) return x;
              escritos[i] = x.nome;
              return { v: 'outro', nome: NOVO };
            }),
          );
          setNovos(escritos);
          if (ja.produto === null) setEscolha('__nao');
          else if (r.palpites.slice(0, 2).some((x) => x.produto === ja.produto)) setEscolha(ja.produto);
          else {
            setEscolha('__outro');
            setOutroProduto(ja.produto);
          }
        } else {
          setEtapas(r.etapas.map(() => null));
          setEscolha(null);
          setOutroProduto('');
        }
        setFaltas(ja?.faltas ?? {});
        setAMais(ja?.aMais ?? {});
      })
      .catch((e) => vivo && setErro(mensagemDe(e, 'não consegui abrir o lanche')));
    return () => {
      vivo = false;
    };
  }, [lancheId]);

  // o produto da comparação: o escolhido — ou, antes da escolha, o palpite
  const produtoNome = escolha === '__nao' ? null : escolha === '__outro' ? outroProduto || null : (escolha ?? d?.palpites[0]?.produto ?? null);
  const produtoId = useMemo(() => d?.produtos.find((x) => x.nome === produtoNome)?.id ?? null, [d, produtoNome]);
  useEffect(() => {
    let vivo = true;
    setFicha(null);
    if (!produtoId) return;
    fichasApi
      .produto(lojaId, produtoId)
      .then((r) => vivo && setFicha(r))
      .catch(() => vivo && setFicha(null));
    return () => {
      vivo = false;
    };
  }, [lojaId, produtoId]);

  const naoSeVe = useMemo(() => new Set(d?.naoSeVe ?? []), [d]);
  const conta = useMemo(() => {
    if (!d || !ficha?.ficha) return null;
    const vistos = new Map<string, { nome: string; vezes: number }>();
    d.etapas.forEach((e, i) => {
      const nome = nomeDaEtapa(e, etapas[i] ?? null, novos[i] ?? '');
      if (!nome) return;
      const ja = vistos.get(chave(nome));
      vistos.set(chave(nome), { nome: ja?.nome ?? nome, vezes: (ja?.vezes ?? 0) + e.vezes });
    });
    const naFicha = new Set(ficha.ficha.ingredientes.map((i) => chave(i.nome)));
    const adicionais = new Set<string>();
    // o adicional que TIRA um ingrediente ("Sem cebola"): ajuda a entender o que falta
    const tira = new Map<string, string>();
    for (const g of ficha.adicionais) {
      for (const o of g.opcoes) {
        const ef = o.efeito;
        if (g.tipo === 'adicionar' && (ef.tipo === 'insumo' || ef.tipo === 'preparo') && ef.nome) adicionais.add(chave(ef.nome));
        if (ef.tipo === 'retira' && !tira.has(chave(ef.nome))) tira.set(chave(ef.nome), o.nome);
      }
    }
    const linhas = ficha.ficha.ingredientes.map((i) => ({
      nome: i.nome,
      quantidade: quantidadeDaFicha(i.quantidade, i.unidade),
      quer: vezesNaFicha(i.quantidade, i.unidade),
      viu: vistos.get(chave(i.nome))?.vezes ?? 0,
      invisivel: naoSeVe.has(chave(i.nome)),
      tira: tira.get(chave(i.nome)) ?? null,
    }));
    const fora = [...vistos.entries()].filter(([k]) => !naFicha.has(k)).map(([k, v]) => ({ nome: v.nome, adicional: adicionais.has(k) }));
    return { linhas, fora };
  }, [d, ficha, etapas, novos, naoSeVe]);

  // as etapas como o quadro maior as mostra: os mesmos textos da linha da etapa, e a resposta já dada
  const etapasNoQuadro = useMemo<EtapaNoQuadro[]>(
    () =>
      (d?.etapas ?? []).map((e, i) => {
        const r = etapas[i] ?? null;
        const nome = r?.v === 'outro' ? (r.nome === NOVO ? (novos[i] ?? '') : (r.nome ?? '')).trim() : '';
        return {
          quadroId: e.quadroId,
          hora: horaComSegundos(e.hora, fuso),
          lado: LADO_FALADO[e.lado] + (e.inicio ? ' · já estava' : ''),
          leu: e.leu ?? 'não deu para ver',
          vezes: e.vezes,
          podeSer: e.candidatos.length > 1 ? e.candidatos : [],
          disse: r?.v === 'certo' ? 'certo' : r?.v === 'nada' ? 'não era ingrediente' : r?.v === 'outro' ? (nome ? `era ${nome}` : 'era outro') : null,
        };
      }),
    [d, etapas, novos, fuso],
  );

  // Fechado o quadro maior, o foco volta para a etapa que estava à vista nele (não a que o abriu): é ao lado da
  // miniatura dela que se responde.
  useEffect(() => {
    if (quadro !== null || voltarPara.current === null || !d) return;
    const linha = document.querySelector<HTMLElement>(`[data-lanche="${d.id}"] [data-etapa="${voltarPara.current}"]`);
    voltarPara.current = null;
    const alvo = linha?.querySelector<HTMLElement>('[data-miniatura-da-etapa]') ?? linha?.querySelector<HTMLElement>('button');
    linha?.scrollIntoView({ block: 'nearest' });
    alvo?.focus({ preventScroll: true });
  }, [quadro, d]);

  const responder = (i: number, r: RespostaDaEtapa) =>
    setEtapas((atual) => {
      const novo = [...atual];
      const antes = novo[i];
      // tocar de novo no que já está marcado desmarca
      novo[i] = antes && r && antes.v === r.v && (antes.nome ?? null) === (r.nome ?? null) ? null : r;
      return novo;
    });
  const semResposta = d ? d.etapas.filter((e, i) => e.candidatos.length === 1 && !etapas[i]).length : 0;
  const respondidas = etapas.filter(Boolean).length;
  const produtoEscolhido = escolha !== null && (escolha !== '__outro' || !!outroProduto);
  // "Era outro" marcado sem dizer o quê: a API recusa — a tela diz antes
  const semNome = etapas.filter((r, i) => r?.v === 'outro' && (!r.nome || (r.nome === NOVO && !(novos[i] ?? '').trim()))).length;
  const tudoCerto = d && !d.resposta && escolha === null && d.motivo === 'certo' && d.etapas.every((e) => e.candidatos.length === 1);

  async function salvar(conferencia: ConferenciaDoLanche) {
    setErro(null);
    setOcupado('salvar');
    try {
      const r = await treinoApi.conferir(lancheId, conferencia);
      aoSalvar(
        r.exemplos > 0
          ? `Guardado: ${plural(r.exemplos, 'exemplo novo', 'exemplos novos')} para a base da bancada.`
          : 'Guardado. Sem etapa respondida com nome das fichas, o lanche conta só para o acerto.',
      );
    } catch (e) {
      setErro(mensagemDe(e, 'não consegui guardar a conferência'));
      setOcupado(null);
    }
  }
  function conferencia(): ConferenciaDoLanche {
    // só vai o que a conta de agora mostra: trocar de lanche no meio não leva a resposta do outro
    const faltando = new Set((conta?.linhas ?? []).filter((l) => !l.invisivel && l.viu < l.quer).map((l) => l.nome));
    const aMaisAgora = new Set((conta?.fora ?? []).map((f) => f.nome));
    return {
      produto: escolha === '__nao' ? null : escolha === '__outro' ? outroProduto : (escolha as string),
      etapas: etapas.map((r, i) => (r?.v === 'outro' && r.nome === NOVO ? { v: 'outro', nome: (novos[i] ?? '').trim() } : r)),
      faltas: Object.fromEntries(Object.entries(faltas).filter(([k]) => faltando.has(k))),
      aMais: Object.fromEntries(Object.entries(aMais).filter(([k]) => aMaisAgora.has(k))),
    };
  }

  async function pular() {
    setErro(null);
    setOcupado('pular');
    try {
      await treinoApi.pular(lancheId);
      aoPular('Pulado: o lanche espera em “Pulados”.');
    } catch (e) {
      setErro(mensagemDe(e, 'não consegui pular'));
      setOcupado(null);
    }
  }

  const titulo = d ? `Lanche das ${horaNaLoja(d.abertoEm ?? d.fechouEm, fuso)}` : 'Lanche';
  const descricao = d
    ? [
        `gravação de ${quandoDaGravacao(d.gravacao.inicio, d.gravacao.fim, fuso)}`,
        d.fechouEm ? `fechou às ${horaComSegundos(d.fechouEm, fuso)}` : null,
        posicao,
        d.situacao === 'conferido' && d.conferidoPor ? `conferido por ${d.conferidoPor}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  const pe = !produtoEscolhido
    ? 'Escolha qual lanche era para salvar.'
    : semNome
      ? `Diga o que era ${semNome === 1 ? 'na etapa marcada' : 'nas etapas marcadas'} com “Era outro”, ou desmarque.`
      : `${respondidas} de ${plural(d?.etapas.length ?? 0, 'etapa conferida', 'etapas conferidas')}${respondidas ? ': cada uma com nome das fichas vira exemplo.' : '.'}`;

  return (
    <Gaveta
      larga
      titulo={titulo}
      descricao={descricao}
      ocupado={ocupado !== null}
      aoFechar={aoFechar}
      rodape={
        <>
          <p className={`${AJUDA} min-w-0 flex-[1_1_200px]`} data-pe-da-conferencia>
            {pe}
          </p>
          {d && d.situacao !== 'conferido' && (
            <Botao onClick={() => void pular()} ocupado={ocupado === 'pular'} disabled={ocupado !== null}>
              Pular
            </Botao>
          )}
          {tudoCerto && (
            <Botao
              onClick={() => void salvar({ produto: d!.palpites[0]!.produto, etapas: d!.etapas.map(() => ({ v: 'certo' })), faltas: {}, aMais: {} })}
              disabled={ocupado !== null}
            >
              <Check className="h-[16px] w-[16px]" aria-hidden />
              Está tudo certo
            </Botao>
          )}
          <Botao
            variante="primario"
            onClick={() => void salvar(conferencia())}
            ocupado={ocupado === 'salvar'}
            disabled={ocupado !== null || !d || !produtoEscolhido || semNome > 0}
          >
            {d?.situacao === 'conferido' ? 'Salvar de novo' : 'Salvar e ir para o próximo'}
          </Botao>
        </>
      }
    >
      {erro && (
        <Alerta tom="critico" icone={TriangleAlert} papel="alert">
          {erro}
        </Alerta>
      )}
      {!d && !erro && <Ossos alturas={[90, 140, 140]} />}
      {d && (
        <div className="flex flex-col gap-5" data-lanche={d.id}>
          {d.motivo === 'coberto' && d.situacao !== 'conferido' && (
            <Alerta tom="atencao" icone={Info}>
              <b className="font-semibold">Numa etapa, o Farol não conseguiu ver o que entrou.</b> Se você souber, diga; se não souber, deixe sem
              resposta.
            </Alerta>
          )}
          {d.motivo === 'duvida' && d.situacao !== 'conferido' && (
            <Alerta tom="atencao" icone={Info}>
              <b className="font-semibold">Numa etapa, a leitura ficou entre dois ou mais nomes.</b> Diga qual era: é onde a sua resposta mais
              ensina.
            </Alerta>
          )}

          {/* ───────────── qual lanche era ───────────── */}
          <section className="flex flex-col gap-2" aria-labelledby={`${p}-qual`}>
            <h3 id={`${p}-qual`} className={ROTULO}>
              Qual lanche era?
            </h3>
            <div role="radiogroup" aria-labelledby={`${p}-qual`} className="grid grid-cols-2 gap-2" data-qual-lanche>
              {d.palpites.slice(0, 2).map((x, i) => (
                <Opcao
                  key={x.produtoId}
                  marcada={escolha === x.produto}
                  aoMarcar={() => setEscolha(x.produto)}
                  titulo={x.produto}
                  destaque={i === 0 ? 'o Farol acha' : undefined}
                  sobre={`confere ${x.batem} de ${x.total}${x.fora ? ` · ${x.fora} fora da ficha` : ''}`}
                />
              ))}
              <Opcao marcada={escolha === '__outro'} aoMarcar={() => setEscolha('__outro')} titulo="Outro produto" sobre="escolha na lista" />
              <Opcao marcada={escolha === '__nao'} aoMarcar={() => setEscolha('__nao')} titulo="Não era um lanche" sobre="ou não dá para saber" />
            </div>
            {escolha === '__outro' && (
              <>
                <label htmlFor={`${p}-outro`} className="sr-only">
                  Qual produto
                </label>
                <select id={`${p}-outro`} className="entrada" value={outroProduto} onChange={(e) => setOutroProduto(e.target.value)}>
                  <option value="">Escolha o produto</option>
                  {d.produtos
                    .filter((x) => !d.palpites.slice(0, 2).some((y) => y.produto === x.nome))
                    .map((x) => (
                      <option key={x.id} value={x.nome}>
                        {x.nome}
                      </option>
                    ))}
                </select>
              </>
            )}
          </section>

          {/* ───────────── etapa por etapa ───────────── */}
          <section className="flex flex-col gap-2" aria-labelledby={`${p}-etapas`}>
            <h3 id={`${p}-etapas`} className={ROTULO}>
              O que o Farol viu, etapa por etapa
            </h3>
            <p className={AJUDA}>Na ordem em que aconteceu. Responda o que der: a etapa sem resposta não ensina, e não atrapalha.</p>
            {semResposta > 0 && (
              <div>
                <Botao mini onClick={() => setEtapas((atual) => atual.map((r, i) => r ?? (d.etapas[i]!.candidatos.length === 1 ? { v: 'certo' } : null)))}>
                  <Check className="h-[15px] w-[15px]" aria-hidden />
                  {semResposta === d.etapas.length ? `Marcar as ${semResposta} como certas` : `Marcar as outras ${semResposta} como certas`}
                </Botao>
              </div>
            )}
            <ol className="flex flex-col gap-2.5" data-etapas>
              {d.etapas.map((e, i) => (
                <Etapa
                  key={i}
                  e={e}
                  r={etapas[i] ?? null}
                  fuso={fuso}
                  ingredientes={d.ingredientes.filter((n) => !naoSeVe.has(chave(n)))}
                  novo={novos[i] ?? ''}
                  marca={i}
                  aoResponder={(r) => responder(i, r)}
                  aoEscolherNome={(nome) => setEtapas((atual) => atual.map((x, j) => (j === i ? (nome === NAO_SEI ? null : { v: 'outro', nome }) : x)))}
                  aoEscreverNovo={(texto) => setNovos((atual) => ({ ...atual, [i]: texto }))}
                  aoAbrirQuadro={() => setQuadro(i)}
                />
              ))}
            </ol>
            {quadro !== null && etapasNoQuadro[quadro] && (
              <QuadroDaEtapa
                etapas={etapasNoQuadro}
                indice={quadro}
                aoIr={setQuadro}
                aoFechar={() => {
                  voltarPara.current = quadro;
                  setQuadro(null);
                }}
              />
            )}
          </section>

          {/* ───────────── a conta da ficha ───────────── */}
          {produtoNome && conta && (
            <section className="flex flex-col gap-2" aria-labelledby={`${p}-conta`}>
              <h3 id={`${p}-conta`} className={ROTULO}>
                Comparado com a ficha do {produtoNome}
              </h3>
              {escolha === null && <p className={AJUDA}>Pelo palpite do Farol. Muda quando você escolher o lanche acima.</p>}
              <ul className="flex flex-col divide-y divide-farol-borda rounded-[10px] border border-farol-borda" data-conta-da-ficha>
                {conta.linhas.map((l) => {
                  if (l.invisivel) {
                    return (
                      <li key={l.nome} className="flex items-start gap-2.5 px-3 py-2.5 text-[13.5px]" data-linha-da-conta="nao-se-ve">
                        <Minus className="mt-0.5 h-[15px] w-[15px] shrink-0 text-farol-suave" aria-hidden />
                        <span className="min-w-0">
                          <b className="font-semibold">{l.nome}</b>
                          <small className="block text-xs text-farol-suave">não se vê de cima: o Farol não confere</small>
                        </span>
                      </li>
                    );
                  }
                  const bate = l.viu >= l.quer;
                  return (
                    <li key={l.nome} className="flex items-start gap-2.5 px-3 py-2.5 text-[13.5px]" data-linha-da-conta={bate ? 'bate' : 'falta'}>
                      {bate ? (
                        <Check className="mt-0.5 h-[15px] w-[15px] shrink-0 text-farol-ok" aria-hidden />
                      ) : (
                        <TriangleAlert className="mt-0.5 h-[15px] w-[15px] shrink-0 text-farol-facho-tinta" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <b className="font-semibold">{l.nome}</b>{' '}
                        <span className="font-mono text-xs text-farol-suave">{l.quer > 1 ? `${l.viu} de ${l.quer}` : l.quantidade}</span>
                        <small className="block text-xs text-farol-suave">
                          {bate ? 'visto' : l.viu ? 'veio menos do que a ficha diz' : 'não foi visto'}
                          {!bate && l.tira ? ` · o ${produtoNome} tem o adicional “${l.tira}”` : ''}
                        </small>
                        {!bate && (
                          <Escolhas
                            rotulo={`O que houve com ${l.nome}`}
                            valor={faltas[l.nome] ?? null}
                            opcoes={[
                              ['cliente', 'O cliente pediu assim'],
                              ['faltou', 'Faltou'],
                              ['naoviu', 'Estava lá; o Farol não viu'],
                            ]}
                            aoMudar={(v) => setFaltas((a) => ({ ...a, [l.nome]: v as 'cliente' | 'faltou' | 'naoviu' }))}
                            aoLimpar={() => setFaltas((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== l.nome)))}
                          />
                        )}
                      </span>
                    </li>
                  );
                })}
                {conta.fora.map((f) => (
                  <li key={f.nome} className="flex items-start gap-2.5 px-3 py-2.5 text-[13.5px]" data-linha-da-conta="fora">
                    <Plus className="mt-0.5 h-[15px] w-[15px] shrink-0 text-farol-marca" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <b className="font-semibold">{f.nome}</b>
                      <small className="block text-xs text-farol-suave">{f.adicional ? `fora da ficha, mas é adicional do ${produtoNome}` : 'fora da ficha'}</small>
                      <Escolhas
                        rotulo={`De onde veio ${f.nome}`}
                        valor={aMais[f.nome] ?? null}
                        opcoes={[
                          ['adicional', 'Pedido do cliente'],
                          ['amais', 'A mais, sem pedido'],
                        ]}
                        aoMudar={(v) => setAMais((a) => ({ ...a, [f.nome]: v as 'adicional' | 'amais' }))}
                        aoLimpar={() => setAMais((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== f.nome)))}
                      />
                    </span>
                  </li>
                ))}
              </ul>
              {conta.linhas.some((l) => !l.invisivel && l.viu < l.quer) && (
                <p className={AJUDA}>O que falta nem sempre é erro: o cliente pode ter pedido sem. Com os pedidos do KDS, o Farol vai saber isso sozinho.</p>
              )}
            </section>
          )}
          <p className={`${AJUDA} flex items-start gap-1.5`}>
            <Lock className="mt-px h-[13px] w-[13px] shrink-0" aria-hidden />A gravação inteira fica no computador da loja. Os quadros das etapas
            sobem reduzidos, só para a conferência, e saem 30 dias depois dela.
          </p>
        </div>
      )}
    </Gaveta>
  );
}

function Opcao({ marcada, aoMarcar, titulo, destaque, sobre }: { marcada: boolean; aoMarcar: () => void; titulo: string; destaque?: string; sobre: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={aoMarcar}
      className={`flex min-w-0 flex-col gap-0.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
        marcada ? 'border-farol-facho bg-farol-facho-leve' : 'border-farol-borda-forte bg-farol-painel-2 hover:border-farol-suave'
      }`}
    >
      <span className="flex flex-wrap items-center gap-1.5 font-semibold">
        <span className="break-words">{titulo}</span>
        {destaque && <Chip>{destaque}</Chip>}
      </span>
      <small className="text-xs text-farol-suave">{sobre}</small>
    </button>
  );
}

/** Um botão de escolha, que fica aceso quando escolhido. */
function Pilula({ marcada, aoClicar, children }: { marcada: boolean; aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      onClick={aoClicar}
      className={`min-h-8 max-w-full break-words rounded-full border px-3 py-1 text-left text-xs font-medium transition-colors ${
        marcada ? 'border-farol-facho bg-farol-facho-leve text-farol-facho-tinta' : 'border-farol-borda-forte text-farol-suave hover:text-farol-tinta'
      }`}
    >
      {children}
    </button>
  );
}

function Escolhas({
  rotulo,
  valor,
  opcoes,
  aoMudar,
  aoLimpar,
}: {
  rotulo: string;
  valor: string | null;
  opcoes: Array<[string, string]>;
  aoMudar: (v: string) => void;
  aoLimpar: () => void;
}) {
  return (
    <div role="group" aria-label={rotulo} className="mt-1.5 flex flex-wrap gap-1.5">
      {opcoes.map(([v, texto]) => (
        <Pilula key={v} marcada={valor === v} aoClicar={() => (valor === v ? aoLimpar() : aoMudar(v))}>
          {texto}
        </Pilula>
      ))}
    </div>
  );
}

function Etapa({
  e,
  r,
  fuso,
  ingredientes,
  novo,
  marca,
  aoResponder,
  aoEscolherNome,
  aoEscreverNovo,
  aoAbrirQuadro,
}: {
  e: EtapaDoLanche;
  r: RespostaDaEtapa;
  fuso: string;
  ingredientes: string[];
  novo: string;
  /** O número da etapa, para o roteiro de conferência achar a linha. */
  marca: number;
  aoResponder: (r: RespostaDaEtapa) => void;
  aoEscolherNome: (nome: string) => void;
  aoEscreverNovo: (texto: string) => void;
  /** A miniatura abre o quadro inteiro, maior. */
  aoAbrirQuadro: () => void;
}) {
  const id = useId();
  const grupo = e.candidatos.length > 1;
  // "Era outro" aberto: o seletor aparece. No grupo, escolher um dos nomes possíveis é o botão dele
  const escolhendo = r?.v === 'outro' && !(grupo && e.candidatos.includes(r.nome ?? ''));
  const lido = e.leu ?? 'não deu para ver';
  // a correção: o que a leitura disse sai riscado. O "Certo" não risca nada — a leitura estava certa
  const resposta =
    r?.v === 'outro' ? (r.nome === NOVO ? novo.trim() || null : r.nome || null) : r?.v === 'nada' ? 'não era ingrediente' : null;
  const hora = horaComSegundos(e.hora, fuso);
  return (
    <li
      className={`grid grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-[10px] border bg-farol-painel-2 p-2.5 max-[400px]:grid-cols-[72px_minmax(0,1fr)] ${
        e.candidatos.length !== 1 && !r ? 'border-farol-facho' : 'border-farol-borda'
      }`}
      data-etapa={marca}
    >
      {e.quadroId ? (
        // A miniatura mostra o meio do recorte (`object-cover`); tocar nela abre o quadro inteiro, maior.
        <button
          type="button"
          onClick={aoAbrirQuadro}
          aria-label={`Ver maior o quadro da etapa das ${hora} (${LADO_FALADO[e.lado]})`}
          data-miniatura-da-etapa={marca}
          className="group relative block aspect-square max-w-full cursor-zoom-in overflow-hidden rounded-lg bg-farol-realce"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- o quadro vem da API, por id, e o navegador o guarda */}
          <img src={treinoApi.urlDoQuadro(e.quadroId)} alt="" className="h-full w-full object-cover" loading="lazy" />
          {/* A lupa no canto diz que o quadro abre maior sem depender do mouse em cima (no celular não há). */}
          <span
            className="absolute bottom-1 right-1 grid h-[22px] w-[22px] place-items-center rounded-md bg-farol-palco/80 text-farol-palco-tinta transition-transform group-hover:scale-110"
            aria-hidden
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        <div className="aspect-square max-w-full overflow-hidden rounded-lg bg-farol-realce">
          <span className="grid h-full w-full place-items-center text-farol-suave" title="Esta etapa não tem quadro">
            <ImageOff className="h-5 w-5" aria-hidden />
          </span>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="font-mono text-[11.5px] text-farol-suave">
          {hora} · {LADO_FALADO[e.lado]}
          {e.inicio ? ' · já estava' : ''}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
          {resposta ? (
            <>
              <s className="break-words text-farol-suave">{lido}</s>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-farol-suave" aria-hidden />
              <b className="break-words font-semibold">{resposta}</b>
            </>
          ) : (
            <b className="break-words font-semibold">{lido}</b>
          )}
          {e.vezes > 1 && <span className="font-mono text-xs text-farol-suave">×{e.vezes}</span>}
          {!resposta && grupo && <span className="text-xs text-farol-suave">pode ser: {e.candidatos.join(' ou ')}</span>}
          {!resposta && e.candidatos.length === 1 && e.leu && chave(e.leu) !== chave(e.candidatos[0]!) && (
            <span className="text-xs text-farol-suave">= {e.candidatos[0]}</span>
          )}
        </p>
        <div role="group" aria-label={`A leitura das ${hora}`} className="flex flex-wrap gap-1.5">
          {e.candidatos.length === 1 && (
            <Pilula marcada={r?.v === 'certo'} aoClicar={() => aoResponder({ v: 'certo' })}>
              Certo
            </Pilula>
          )}
          {grupo &&
            e.candidatos.map((c) => (
              <Pilula key={c} marcada={r?.v === 'outro' && r.nome === c} aoClicar={() => aoResponder({ v: 'outro', nome: c })}>
                {c}
              </Pilula>
            ))}
          <Pilula marcada={escolhendo} aoClicar={() => aoResponder(escolhendo ? r : { v: 'outro', nome: '' })}>
            {e.candidatos.length || e.leu !== null ? 'Era outro' : 'Eu sei o que era'}
          </Pilula>
          {e.leu !== null && (
            <Pilula marcada={r?.v === 'nada'} aoClicar={() => aoResponder({ v: 'nada' })}>
              Não era ingrediente
            </Pilula>
          )}
        </div>
        {escolhendo && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-nome`} className="sr-only">
              O que era
            </label>
            <select id={`${id}-nome`} className="entrada" value={r?.nome ?? ''} onChange={(ev) => aoEscolherNome(ev.target.value)}>
              <option value="">Escolha o ingrediente</option>
              {ingredientes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={NOVO}>Um ingrediente que não está nas fichas…</option>
              <option value={NAO_SEI}>Não sei o que era</option>
            </select>
            {r?.nome === NOVO && (
              <>
                <label htmlFor={`${id}-novo`} className="sr-only">
                  Nome do ingrediente
                </label>
                <input
                  id={`${id}-novo`}
                  className="entrada"
                  maxLength={120}
                  autoComplete="off"
                  placeholder="Nome do ingrediente"
                  value={novo}
                  onChange={(ev) => aoEscreverNovo(ev.target.value)}
                />
                <small className={AJUDA}>Fica guardado na conferência; a sugestão para as fichas vem depois.</small>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
