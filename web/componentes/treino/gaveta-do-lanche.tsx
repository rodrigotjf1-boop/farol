'use client';

// =====================================================================
// Conferir um lanche do treinamento: uma foto por cartão, e a conta da ficha
// =====================================================================
// A21. A conferência NOVA, do protótipo aprovado pelo dono em 15/10/2026
// (`mockups/farol-conexoes-e-fichas.html`, tela Treinamento, "Conferência do
// lanche: nova"), do que ele pediu conferindo de verdade:
//
//   • "Qual lanche era?" — o palpite com o PORQUÊ (o raro que a leitura viu,
//     e o que ela leu e pode ser um raro), e as PERGUNTAS que separam as
//     fichas plausíveis, a mais rara primeiro. Sobrando uma ficha, ela fica
//     marcada (dá para trocar). Sem nada visto da ficha, não há palpite;
//   • um CARTÃO POR FOTO (as etapas com a mesma imagem juntas — a API
//     agrupa), com TUDO o que aparece nela marcado: os nomes que a leitura
//     acha possíveis (com o ponto), os da ficha do lanche, e "Outro
//     ingrediente" (das fichas, ou um nome escrito à mão, que vira sugestão);
//   • "Não dá para analisar", com o que houve: a foto ruim não ensina;
//   • o atalho "Marcar o que o Farol leu", só nas fotos sem dúvida;
//   • a conta da ficha pelas marcas, e a observação do lanche;
//   • a miniatura abre a foto inteira, maior (`quadro-da-foto.tsx`).
//
// Quem decide o que vira exemplo, o palpite e o acerto é a API.
// =====================================================================

import { Check, ImageOff, Info, Lock, Minus, Plus, TriangleAlert, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { chaveDoIngrediente } from '@/componentes/fichas/chave-do-ingrediente';
import { diaFaladoNaLoja, frase, horaNaLoja, plural, quantidadeDaFicha } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta, Chip, Ossos } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import {
  ErroDaApi,
  fichasApi,
  treinoApi,
  type ConferenciaPorFoto,
  type EtapaDoLanche,
  type FotoDoLanche,
  type LancheParaConferir,
  type PalpiteDoLanche,
  type ProdutoDaFicha,
} from '@/lib/api';

import {
  chave,
  fotoSemDuvida,
  lidosParaMarcar,
  marcasGuardadas,
  perguntasDoLanche,
  ressalvas,
  sugeridosNaFoto,
  vistosNaConferencia,
} from './conferencia-por-foto';
import { nasFichas, ondeEntra, type VocabularioDoNome } from './nome-nas-fichas';
import { QuadroDaFoto, type FotoNoQuadro } from './quadro-da-foto';

const mensagemDe = (e: unknown, padrao: string) => frase(e instanceof ErroDaApi ? e.message : padrao);
/** No seletor de "Outro ingrediente": o nome que não está nas fichas (escrito à mão). */
const NOVO = '__novo';

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

const semRepetir = (nomes: string[]) => nomes.filter((n, i) => nomes.findIndex((x) => chave(x) === chave(n)) === i);
const ehFeita = (lista: string[], nome: string) => lista.some((n) => chave(n) === chave(nome));
const idDe = (texto: string) => chave(texto).replace(/[^a-z0-9à-ú]+/g, '-');

type Escolha = string | '__nao' | '__outro' | null;
/** O que a pessoa disse de uma foto, na tela. `acrescentados`: os de "Outro ingrediente" (o botão fica, desmarcado ou não). */
type RespostaNaTela = { marcados: string[]; acrescentados: string[]; ruim: boolean; obs: string; mais: boolean; escrevendo: boolean; novo: string };
const vazia = (): RespostaNaTela => ({ marcados: [], acrescentados: [], ruim: false, obs: '', mais: false, escrevendo: false, novo: '' });
const respondida = (r: RespostaNaTela | undefined) => !!r && (r.ruim || r.marcados.length > 0);

export function GavetaDoLanche({
  lojaId,
  lancheId,
  fuso,
  posicao,
  foraDasFichas,
  aoSalvar,
  aoPular,
  aoFechar,
}: {
  lojaId: string;
  lancheId: string;
  fuso: string;
  /** "2 de 5 para conferir", quando o lanche está na fila. */
  posicao: string | null;
  /**
   * Os nomes escritos à mão em conferências que ainda esperam uma ficha (as sugestões "nome fora das fichas" sem
   * resposta ou com "vou cadastrar"): quem escreve "Pickles" acha o "Picles" que alguém já escreveu.
   */
  foraDasFichas: string[];
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
  // a escolha que as perguntas fizeram sozinhas (sobrou uma ficha): sai quando ela deixa de ser a única
  const [escolhaDoFarol, setEscolhaDoFarol] = useState(false);
  const [outroProduto, setOutroProduto] = useState('');
  const [respostas, setRespostas] = useState<Record<string, 'sim' | 'nao'>>({});
  const [fotos, setFotos] = useState<RespostaNaTela[]>([]);
  const [obs, setObs] = useState('');
  const [faltas, setFaltas] = useState<ConferenciaPorFoto['faltas']>({});
  const [aMais, setAMais] = useState<ConferenciaPorFoto['aMais']>({});
  const [ficha, setFicha] = useState<ProdutoDaFicha | null>(null);
  // a foto aberta no quadro maior; e, ao fechar, a foto cuja miniatura recebe o foco
  const [quadro, setQuadro] = useState<number | null>(null);
  const voltarPara = useRef<number | null>(null);
  // depois de um redesenho, o elemento que recebe o foco (o botão novo de "Outro ingrediente", o campo do nome…)
  const focarDepois = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;
    // outro lanche na mesma gaveta (o "ir para o próximo"): nada do anterior fica
    setD(null);
    setErro(null);
    setOcupado(null);
    setQuadro(null);
    treinoApi
      .lanche(lancheId)
      .then((r) => {
        if (!vivo) return;
        setD(r);
        // o que já foi respondido volta (conferir de novo); senão, nada marcado
        const ja = r.resposta;
        const guardadas = ja ? marcasGuardadas(r.fotos, r.etapas, ja) : null;
        setFotos(r.fotos.map((_, j) => (guardadas ? { ...vazia(), ...guardadas[j]!, acrescentados: [...guardadas[j]!.marcados] } : vazia())));
        setRespostas(ja && 'fotos' in ja ? ja.perguntas : {});
        setObs(ja && 'fotos' in ja ? (ja.obs ?? '') : '');
        setEscolhaDoFarol(false);
        if (!ja) {
          setEscolha(null);
          setOutroProduto('');
        } else if (ja.produto === null) setEscolha('__nao');
        else if (r.palpites.some((x) => x.produto === ja.produto)) setEscolha(ja.produto);
        else {
          setEscolha('__outro');
          setOutroProduto(ja.produto);
        }
        setFaltas(ja?.faltas ?? {});
        setAMais(ja?.aMais ?? {});
      })
      .catch((e) => vivo && setErro(mensagemDe(e, 'não consegui abrir o lanche')));
    return () => {
      vivo = false;
    };
  }, [lancheId]);

  const palpites = d?.palpites ?? [];
  const semPalpite = d?.semPalpite ?? true;
  const pq = useMemo(() => (semPalpite ? { plausiveis: [], sobram: [], perguntas: [] } : perguntasDoLanche(palpites, respostas)), [semPalpite, palpites, respostas]);

  // o produto da comparação e dos botões das fotos: o escolhido — ou, antes da escolha, o palpite (quando há)
  const produtoNome = escolha === '__nao' ? null : escolha === '__outro' ? outroProduto || null : (escolha ?? (semPalpite ? null : (palpites[0]?.produto ?? null)));
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
  // o nome escrito à mão é comparado com os ingredientes das fichas, com os OUTROS NOMES que quem configura juntou a
  // eles ("hamburguer" → "Blend da casa"), e com os nomes que esperam uma ficha: as sugestões "nome fora das fichas" e
  // o que já foi acrescentado neste lanche (em outra foto)
  const dasFichas = useMemo(() => new Set((d?.ingredientes ?? []).map(chaveDoIngrediente)), [d]);
  const outrosNomes = useMemo(() => d?.outrosNomes ?? {}, [d]);
  const ehForaDasFichas = useCallback(
    (nome: string) => {
      const k = chaveDoIngrediente(nome);
      return !dasFichas.has(k) && !outrosNomes[k];
    },
    [dasFichas, outrosNomes],
  );
  const vocab = useMemo<VocabularioDoNome>(
    () => ({ fichas: d?.ingredientes ?? [], fora: [...foraDasFichas, ...fotos.flatMap((r) => r.acrescentados)].filter(ehForaDasFichas), outrosNomes }),
    [d, foraDasFichas, fotos, ehForaDasFichas, outrosNomes],
  );
  // os nomes da ficha do lanche escolhido (o que se vê de cima): na hora, pelo palpite da família; senão, pela ficha
  const daFicha = useMemo(() => {
    if (!produtoNome) return [];
    const doPalpite = palpites.find((x) => chave(x.produto) === chave(produtoNome) || x.familia.some((n) => chave(n) === chave(produtoNome)));
    if (doPalpite) return doPalpite.ingredientes.map((i) => i.nome);
    return (ficha?.ficha?.ingredientes ?? []).map((i) => i.nome).filter((n) => !naoSeVe.has(chave(n)));
  }, [produtoNome, palpites, ficha, naoSeVe]);

  const vistos = useMemo(() => (d ? vistosNaConferencia(d.fotos, d.etapas, fotos) : new Map<string, { nome: string; vezes: number }>()), [d, fotos]);
  const conta = useMemo(() => {
    if (!d || !ficha?.ficha) return null;
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
  }, [d, ficha, vistos, naoSeVe]);

  // as fotos como o quadro maior as mostra: os mesmos textos do cartão, e o que a pessoa já disse
  const fotosNoQuadro = useMemo<FotoNoQuadro[]>(
    () =>
      (d?.fotos ?? []).map((f, j) => {
        const e0 = d!.etapas[f.etapas[0]!]!;
        const r = fotos[j];
        const leu = leituraDaFoto(f, d!.etapas);
        // as leituras que ficaram entre nomes: com uma só, "pode ser A ou B"; com mais, cada uma com o que ela leu
        const grupos = f.etapas.map((i) => d!.etapas[i]!).filter((e) => e.candidatos.length > 1);
        return {
          quadroId: f.quadroId,
          hora: horaComSegundos(e0.hora, fuso),
          lado: LADO_FALADO[e0.lado] + (e0.inicio ? ' · já estava' : ''),
          leu: leu.length ? leu.join(', ') : 'nada',
          podeSer:
            grupos.length === 0
              ? null
              : grupos.length === 1
                ? `pode ser: ${grupos[0]!.candidatos.join(' ou ')}`
                : grupos.map((e) => `“${e.leu ?? '?'}” pode ser ${e.candidatos.join(' ou ')}`).join('; '),
          disse: r?.ruim ? 'não dá para analisar' : r?.marcados.length ? r.marcados.join(', ') : null,
        };
      }),
    [d, fotos, fuso],
  );

  // Fechado o quadro maior, o foco volta para a miniatura da foto que estava à vista nele (não a que o abriu): é ao
  // lado dela que se responde.
  useEffect(() => {
    if (quadro !== null || voltarPara.current === null || !d) return;
    const alvo = document.querySelector<HTMLElement>(`[data-lanche="${d.id}"] [data-miniatura-da-foto="${voltarPara.current}"]`);
    voltarPara.current = null;
    alvo?.scrollIntoView({ block: 'nearest' });
    alvo?.focus({ preventScroll: true });
  }, [quadro, d]);
  // o foco pedido por uma escolha (o botão novo, o campo do nome) — depois que a tela desenhou de novo
  useEffect(() => {
    if (!focarDepois.current) return;
    const alvo = document.getElementById(focarDepois.current);
    focarDepois.current = null;
    alvo?.focus({ preventScroll: true });
  });

  const mudarFoto = (j: number, muda: (r: RespostaNaTela) => RespostaNaTela) => setFotos((atual) => atual.map((r, i) => (i === j ? muda(r) : r)));
  const marcar = (j: number, nome: string) =>
    mudarFoto(j, (r) => ({ ...r, marcados: ehFeita(r.marcados, nome) ? r.marcados.filter((n) => chave(n) !== chave(nome)) : [...r.marcados, nome] }));
  const acrescentar = (j: number, nome: string) => {
    const limpo = nome.trim();
    if (!limpo) return;
    focarDepois.current = `${p}-f${j}-${idDe(limpo)}`;
    mudarFoto(j, (r) => ({
      ...r,
      marcados: ehFeita(r.marcados, limpo) ? r.marcados : [...r.marcados, limpo],
      acrescentados: ehFeita(r.acrescentados, limpo) ? r.acrescentados : [...r.acrescentados, limpo],
      mais: false,
      escrevendo: false,
      novo: '',
    }));
  };

  function responder(nome: string, v: 'sim' | 'nao') {
    const novas = { ...respostas };
    if (novas[nome] === v) delete novas[nome];
    else novas[nome] = v;
    setRespostas(novas);
    // sobrou uma ficha só: ela vira a resposta (dá para trocar abaixo); a que o Farol marcou sai quando deixa de ser a única
    const { sobram } = perguntasDoLanche(palpites, novas);
    let proxima = escolha;
    let doFarol = escolhaDoFarol;
    if (doFarol && !(sobram.length === 1 && sobram[0]!.produto === proxima)) {
      proxima = null;
      doFarol = false;
    }
    if (proxima === null && sobram.length === 1) {
      proxima = sobram[0]!.produto;
      doFarol = true;
    }
    setEscolha(proxima);
    setEscolhaDoFarol(doFarol);
  }
  const escolher = (e: Escolha) => {
    setEscolha(e);
    setEscolhaDoFarol(false);
  };

  // o atalho: só nas fotos em que toda leitura dá um nome (as outras são onde a resposta de quem confere ensina)
  const seguras = d ? d.fotos.map((f, j) => j).filter((j) => !respondida(fotos[j]) && fotoSemDuvida(d.fotos[j]!, d.etapas, daFicha) && lidosParaMarcar(d.fotos[j]!, d.etapas, daFicha).length > 0) : [];
  const comDuvida = d ? d.fotos.map((f, j) => j).filter((j) => !respondida(fotos[j]) && !fotoSemDuvida(d.fotos[j]!, d.etapas, daFicha)) : [];
  function marcarOQueLeu() {
    if (!d) return;
    const novas = fotos.map((r, j) => (seguras.includes(j) ? { ...r, marcados: semRepetir([...r.marcados, ...lidosParaMarcar(d.fotos[j]!, d.etapas, daFicha)]) } : r));
    setFotos(novas);
    // o foco vai para a primeira foto que ainda espera resposta (a de dúvida); sem nenhuma, para o salvar — ou, sem o
    // lanche escolhido (o salvar desligado não recebe foco), para a primeira foto
    const falta = novas.findIndex((r) => !respondida(r));
    focarDepois.current = falta >= 0 ? `${p}-mini-${falta}` : produtoEscolhido ? `${p}-salvar` : `${p}-mini-0`;
  }

  const produtoEscolhido = escolha !== null && (escolha !== '__outro' || !!outroProduto);
  const conferidas = fotos.filter(respondida).length;
  const ruins = fotos.filter((r) => r.ruim).length;

  async function salvar() {
    if (!d) return;
    setErro(null);
    setOcupado('salvar');
    // só vai o que a conta de agora mostra: trocar de lanche no meio não leva a resposta do outro
    const faltando = new Set((conta?.linhas ?? []).filter((l) => !l.invisivel && l.viu < l.quer).map((l) => l.nome));
    const aMaisAgora = new Set((conta?.fora ?? []).map((f) => f.nome));
    const conferencia: ConferenciaPorFoto = {
      versao: 2,
      produto: escolha === '__nao' ? null : escolha === '__outro' ? outroProduto : (escolha as string),
      fotos: fotos.map((r) => ({ marcados: r.marcados, ruim: r.ruim, obs: r.ruim ? r.obs.trim() || null : null })),
      perguntas: respostas,
      obs: obs.trim() || null,
      faltas: Object.fromEntries(Object.entries(faltas).filter(([k]) => faltando.has(k))),
      aMais: Object.fromEntries(Object.entries(aMais).filter(([k]) => aMaisAgora.has(k))),
    };
    try {
      const r = await treinoApi.conferir(lancheId, conferencia);
      const deFora = ruins ? ` ${ruins === 1 ? 'A foto que não dava para analisar ficou de fora.' : `As ${ruins} fotos que não davam para analisar ficaram de fora.`}` : '';
      aoSalvar(
        r.exemplos > 0
          ? `Guardado: ${plural(r.exemplos, 'exemplo novo', 'exemplos novos')} para a base da bancada.${deFora}`
          : `Guardado. Sem ingrediente marcado com nome das fichas, o lanche conta só para o acerto.${deFora}`,
      );
    } catch (e) {
      setErro(mensagemDe(e, 'não consegui guardar a conferência'));
      setOcupado(null);
    }
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
    : `${conferidas} de ${plural(d?.fotos.length ?? 0, 'foto conferida', 'fotos conferidas')}${conferidas ? ': cada ingrediente marcado vira exemplo.' : '.'}`;
  const comPonto = d ? d.fotos.some((f) => sugeridosNaFoto(f, d.etapas).length > 0) : false;

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
          <Botao id={`${p}-salvar`} variante="primario" onClick={() => void salvar()} ocupado={ocupado === 'salvar'} disabled={ocupado !== null || !d || !produtoEscolhido}>
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
          {d.situacao !== 'conferido' &&
            (d.semLeitura ? (
              <Alerta icone={Info}>
                <b className="font-semibold text-farol-tinta">O Farol ainda não reconhece os ingredientes desta bancada.</b> Escolha o lanche e marque o
                que aparece em cada foto: é assim que ele aprende.
              </Alerta>
            ) : d.motivo === 'coberto' ? (
              <Alerta tom="atencao" icone={Info}>
                <b className="font-semibold">Numa foto, o Farol não conseguiu ver o que entrou.</b> Se você souber, marque; se não souber, deixe sem
                resposta.
              </Alerta>
            ) : d.motivo === 'duvida' ? (
              <Alerta tom="atencao" icone={Info}>
                <b className="font-semibold">Numa foto, a leitura ficou entre dois ou mais nomes.</b> Marque o que era: é onde a sua resposta mais
                ensina.
              </Alerta>
            ) : null)}

          {/* ───────────── qual lanche era ───────────── */}
          <section className="flex flex-col gap-2.5" aria-labelledby={`${p}-qual`}>
            <h3 id={`${p}-qual`} className={ROTULO}>
              Qual lanche era?
            </h3>
            <Palpite palpite={semPalpite ? null : (palpites[0] ?? null)} />
            {pq.perguntas.length > 0 && (
              <Perguntas
                id={`${p}-pq`}
                perguntas={pq.perguntas}
                respostas={respostas}
                sobram={pq.sobram}
                marcadaPeloFarol={escolhaDoFarol ? escolha : null}
                aoResponder={responder}
              />
            )}
            <Opcoes
              id={p}
              palpites={palpites}
              semPalpite={semPalpite}
              sobram={Object.keys(respostas).length && pq.sobram.length ? pq.sobram : null}
              escolha={escolha}
              aoEscolher={escolher}
            />
            {escolha === '__outro' && (
              <>
                <label htmlFor={`${p}-outro`} className="sr-only">
                  Qual produto
                </label>
                <select id={`${p}-outro`} className="entrada" value={outroProduto} onChange={(e) => setOutroProduto(e.target.value)} data-outro-produto>
                  <option value="">Escolha o produto</option>
                  {d.produtos.map((x) => (
                    <option key={x.id} value={x.nome}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              </>
            )}
          </section>

          {/* ───────────── foto por foto ───────────── */}
          <section className="flex flex-col gap-2" aria-labelledby={`${p}-fotos`}>
            <h3 id={`${p}-fotos`} className={ROTULO}>
              O que aparece em cada foto
            </h3>
            <p className={AJUDA}>
              Marque tudo o que você vê na foto — pode ser mais de um. Cada ingrediente marcado vira exemplo.
              {comPonto ? ' Os nomes com ponto são o que o Farol acha que pode ser.' : ''} A foto ruim não ensina: marque “Não dá para analisar”.
            </p>
            {seguras.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Botao mini onClick={marcarOQueLeu} className="max-w-full py-1.5" data-marcar-lidos>
                  <Check className="h-[15px] w-[15px] shrink-0" aria-hidden />
                  {/* o texto quebra a linha (o botão não quebra): em 320 px ele passava da borda da gaveta */}
                  <span className="whitespace-normal text-left leading-snug">
                    {seguras.length === 1 ? `Marcar o que o Farol leu na foto das ${fotosNoQuadro[seguras[0]!]!.hora}` : `Marcar o que o Farol leu nas ${seguras.length} fotos sem dúvida`}
                  </span>
                </Botao>
                {comDuvida.length > 0 && (
                  <span className={`${AJUDA} min-w-0 flex-[1_1_220px]`} data-nota-do-atalho>
                    {comDuvida.length === 1 ? `A das ${fotosNoQuadro[comDuvida[0]!]!.hora} saiu com dúvida: essa fica com você.` : `As ${comDuvida.length} com dúvida ficam com você.`}
                  </span>
                )}
              </div>
            )}
            <ol className="flex flex-col gap-2.5" data-fotos>
              {d.fotos.map((f, j) => (
                <CartaoDaFoto
                  key={j}
                  id={`${p}-f${j}`}
                  idDaMiniatura={`${p}-mini-${j}`}
                  marca={j}
                  foto={f}
                  etapas={d.etapas}
                  r={fotos[j] ?? vazia()}
                  noQuadro={fotosNoQuadro[j]!}
                  daFicha={daFicha}
                  ingredientes={d.ingredientes.filter((n) => !naoSeVe.has(chave(n)))}
                  vocab={vocab}
                  lanchesDoIngrediente={d.lanchesDoIngrediente ?? {}}
                  ehForaDasFichas={ehForaDasFichas}
                  aoMarcar={(nome) => marcar(j, nome)}
                  aoAcrescentar={(nome) => acrescentar(j, nome)}
                  aoMudar={(muda) => mudarFoto(j, muda)}
                  aoPedirFoco={(id) => (focarDepois.current = id)}
                  aoAbrirQuadro={() => setQuadro(j)}
                />
              ))}
            </ol>
            {quadro !== null && fotosNoQuadro[quadro] && (
              <QuadroDaFoto
                fotos={fotosNoQuadro}
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
            <ContaDaFicha
              id={`${p}-conta`}
              produto={produtoNome}
              pelaEscolha={escolha !== null}
              conta={conta}
              faltas={faltas}
              aMais={aMais}
              aoMudarFalta={(nome, v) => setFaltas((a) => (v ? { ...a, [nome]: v } : Object.fromEntries(Object.entries(a).filter(([k]) => k !== nome))))}
              aoMudarAMais={(nome, v) => setAMais((a) => (v ? { ...a, [nome]: v } : Object.fromEntries(Object.entries(a).filter(([k]) => k !== nome))))}
            />
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${p}-obs`} className={ROTULO}>
              Observação sobre este lanche <span className="font-normal text-farol-suave">(opcional)</span>
            </label>
            <textarea
              id={`${p}-obs`}
              className="entrada min-h-[64px]"
              rows={2}
              maxLength={300}
              placeholder="Ex.: o ovo foi pedido como adicional"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              data-obs-do-lanche
            />
          </div>
          <p className={`${AJUDA} flex items-start gap-1.5`}>
            <Lock className="mt-px h-[13px] w-[13px] shrink-0" aria-hidden />A gravação inteira fica no computador da loja. As fotos sobem reduzidas, só
            para a conferência, e saem 30 dias depois dela.
          </p>
        </div>
      )}
    </Gaveta>
  );
}

/** O que a leitura disse na foto, um texto por etapa ("pão", "molho laranja ×2"). */
function leituraDaFoto(f: FotoDoLanche, etapas: EtapaDoLanche[]): string[] {
  return f.etapas.map((i) => etapas[i]!).filter((e) => e.leu !== null).map((e) => `${e.leu}${e.vezes > 1 ? ` ×${e.vezes}` : ''}`);
}

// ───────────────────────── o palpite e as perguntas ─────────────────────────

/** O palpite com o porquê, nas palavras do estudo das fichas. Sem palpite, diz isso. */
function Palpite({ palpite }: { palpite: PalpiteDoLanche | null }) {
  if (!palpite) {
    return (
      <div className="rounded-r-[10px] border-l-[3px] border-farol-borda-forte bg-farol-painel-2 px-3 py-2.5 text-[13.5px]" data-palpite="sem">
        <b className="font-semibold">Sem palpite.</b> Nestas fotos, o Farol não reconheceu nenhum ingrediente das fichas: escolha o lanche na lista.
      </div>
    );
  }
  const onde = (r: PalpiteDoLanche['raros'][number]) => (r.tambemEm.length ? `só vai neste e no ${r.tambemEm.join(' e no ')}` : 'só vai neste lanche');
  const raros = palpite.raros.slice(0, 3);
  const viu = raros.filter((r) => r.certo);
  const talvez = raros.filter((r) => !r.certo);
  return (
    <div className="flex flex-col gap-1.5 rounded-r-[10px] border-l-[3px] border-farol-marca bg-farol-painel-2 px-3 py-2.5" data-palpite>
      {/* os espaços escritos: a linha flexível dá o espaço na tela, mas o leitor de tela lê o texto ("acha Cheddar") */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip>o Farol acha</Chip>{' '}
        <b className="break-words font-semibold">{palpite.produto}</b>
        {palpite.familia.length > 0 && (
          <>
            {' '}
            <small className="text-xs text-farol-suave">(ou {palpite.familia.join(', ')})</small>
          </>
        )}
      </p>
      {raros.length > 0 && (
        <p className={AJUDA} data-porque>
          {viu.length > 0 && (
            <>
              Porque viu{' '}
              {viu.map((r, i) => (
                <span key={r.nome}>
                  {i > 0 ? '; ' : ''}
                  <b className="font-semibold text-farol-tinta">{r.nome.toLowerCase()}</b>, que {onde(r)}
                </span>
              ))}
              .{' '}
            </>
          )}
          {talvez.length > 0 && (
            <>
              {viu.length ? 'E o' : 'Porque o'}
              {talvez.map((r, i) => (
                <span key={r.nome}>
                  {i > 0 ? '; o' : ''} que leu como “{r.de}” pode ser <b className="font-semibold text-farol-tinta">{r.nome.toLowerCase()}</b>, que {onde(r)}
                </span>
              ))}
              .
            </>
          )}
        </p>
      )}
      {palpite.familia.length > 0 && <p className={AJUDA}>O {palpite.familia.join(' e o ')} tem a mesma ficha: para a bancada, é o mesmo lanche.</p>}
    </div>
  );
}

function Perguntas({
  id,
  perguntas,
  respostas,
  sobram,
  marcadaPeloFarol,
  aoResponder,
}: {
  id: string;
  perguntas: string[];
  respostas: Record<string, 'sim' | 'nao'>;
  sobram: PalpiteDoLanche[];
  /** O produto que as perguntas marcaram sozinhas (sobrou uma ficha). */
  marcadaPeloFarol: string | null;
  aoResponder: (nome: string, v: 'sim' | 'nao') => void;
}) {
  const respondidas = Object.keys(respostas).length;
  return (
    <div className="flex flex-col rounded-[10px] border border-farol-borda px-3 pb-2.5" role="group" aria-labelledby={`${id}-t`} data-perguntas>
      <p id={`${id}-t`} className="pb-1 pt-2.5 text-xs font-semibold text-farol-suave">
        Para ter certeza: {plural(perguntas.length, 'pergunta', 'perguntas')}
      </p>
      {perguntas.map((n) => (
        <div key={n} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-farol-borda py-2" data-pergunta={n}>
          <span id={`${id}-${idDe(n)}`} className="min-w-0 text-[13.5px] font-medium">
            Tem {n.toLowerCase()}?
          </span>
          <div role="group" aria-labelledby={`${id}-${idDe(n)}`} className="flex gap-1.5">
            <Pilula marcada={respostas[n] === 'sim'} aoClicar={() => aoResponder(n, 'sim')}>
              Sim
            </Pilula>
            <Pilula marcada={respostas[n] === 'nao'} aoClicar={() => aoResponder(n, 'nao')}>
              Não
            </Pilula>
          </div>
        </div>
      ))}
      <p className={`${AJUDA} border-t border-farol-borda pt-2`} aria-live="polite" data-sobram>
        {!respondidas ? (
          'Responda o que der: cada resposta tira as fichas que não batem.'
        ) : sobram.length ? (
          <>
            {sobram.length > 1 ? 'Sobram: ' : 'Sobra: '}
            {sobram.map((s, i) => {
              const x = ressalvas(s, respostas);
              return (
                <span key={s.produtoId}>
                  {i > 0 ? ', ' : ''}
                  <b className="font-semibold text-farol-tinta">{s.produto}</b>
                  {s.familia.length > 0 && ` (ou ${s.familia.join(', ')})`}
                  {x.length > 0 && ` (${x.join('; ')})`}
                </span>
              );
            })}
            {sobram.length === 1 && marcadaPeloFarol === sobram[0]!.produto ? '. Já ficou marcado abaixo.' : '.'}
          </>
        ) : (
          'Nenhuma das fichas mais prováveis bate com as respostas: escolha o lanche abaixo.'
        )}
      </p>
    </div>
  );
}

function Opcoes({
  id,
  palpites,
  semPalpite,
  sobram,
  escolha,
  aoEscolher,
}: {
  id: string;
  palpites: PalpiteDoLanche[];
  semPalpite: boolean;
  /** Com respostas às perguntas: as fichas que sobram são as opções. */
  sobram: PalpiteDoLanche[] | null;
  escolha: Escolha;
  aoEscolher: (e: Escolha) => void;
}) {
  let opcoes = semPalpite ? [] : (sobram ?? palpites).slice(0, 2);
  // a escolha de quem confere fica à vista, mesmo quando uma resposta depois a tira das que sobram
  if (escolha && !escolha.startsWith('__') && !opcoes.some((o) => o.produto === escolha)) opcoes = [...opcoes, ...palpites.filter((o) => o.produto === escolha)];
  return (
    <div role="radiogroup" aria-labelledby={`${id}-qual`} className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-qual-lanche>
      {opcoes.map((x) => (
        <Opcao
          key={x.produtoId}
          marcada={escolha === x.produto}
          aoMarcar={() => aoEscolher(x.produto)}
          titulo={x.produto}
          sobre={`${x.familia.length ? `ou ${x.familia.join(', ')} · ` : ''}confere ${x.batem} de ${x.total}${x.fora ? ` · ${x.fora} fora da ficha` : ''}`}
        />
      ))}
      <Opcao
        marcada={escolha === '__outro'}
        aoMarcar={() => aoEscolher('__outro')}
        titulo={semPalpite ? 'Escolher o produto' : 'Outro produto'}
        sobre={semPalpite ? 'na lista do cardápio' : 'escolha na lista'}
      />
      <Opcao marcada={escolha === '__nao'} aoMarcar={() => aoEscolher('__nao')} titulo="Não era um lanche" sobre="ou não dá para saber" />
    </div>
  );
}

// ───────────────────────── uma foto ─────────────────────────

function CartaoDaFoto({
  id,
  idDaMiniatura,
  marca,
  foto,
  etapas,
  r,
  noQuadro,
  daFicha,
  ingredientes,
  vocab,
  lanchesDoIngrediente,
  ehForaDasFichas,
  aoMarcar,
  aoAcrescentar,
  aoMudar,
  aoPedirFoco,
  aoAbrirQuadro,
}: {
  id: string;
  idDaMiniatura: string;
  /** O número da foto, para o roteiro de conferência achar o cartão. */
  marca: number;
  foto: FotoDoLanche;
  etapas: EtapaDoLanche[];
  r: RespostaNaTela;
  noQuadro: FotoNoQuadro;
  daFicha: string[];
  /** Os ingredientes das fichas (sem o que não se vê de cima), para "Outro ingrediente". */
  ingredientes: string[];
  /** Com o que comparar o nome escrito à mão: os ingredientes das fichas e os nomes que esperam uma ficha. */
  vocab: VocabularioDoNome;
  /** Onde cada ingrediente das fichas entra, para quem escolhe entre os parecidos. */
  lanchesDoIngrediente: LancheParaConferir['lanchesDoIngrediente'];
  /** O nome não está nas fichas: a pílula leva a marca "fora das fichas". */
  ehForaDasFichas: (nome: string) => boolean;
  aoMarcar: (nome: string) => void;
  aoAcrescentar: (nome: string) => void;
  aoMudar: (muda: (r: RespostaNaTela) => RespostaNaTela) => void;
  aoPedirFoco: (id: string) => void;
  aoAbrirQuadro: () => void;
}) {
  const escrito = r.novo.trim();
  const achado = r.escrevendo && escrito ? nasFichas(escrito, vocab) : null;
  const sugeridos = sugeridosNaFoto(foto, etapas);
  // o que se oferece: o que a leitura acha possível, o da ficha do lanche, e o que a pessoa acrescentou ou marcou
  // (desmarcado, o acrescentado continua ali: o botão não some debaixo do dedo)
  const oferta = semRepetir([...sugeridos, ...daFicha, ...r.acrescentados, ...r.marcados]);
  const leu = leituraDaFoto(foto, etapas);
  const semNada = foto.etapas.every((i) => etapas[i]!.leu === null && etapas[i]!.candidatos.length === 0);
  const duvida = !semNada && !fotoSemDuvida(foto, etapas, daFicha);
  const fora = ingredientes.filter((n) => !ehFeita(oferta, n));
  return (
    <li
      className={`grid grid-cols-[140px_minmax(0,1fr)] gap-3 rounded-[10px] border bg-farol-painel-2 p-2.5 max-[420px]:grid-cols-1 ${
        r.ruim ? 'border-dashed border-farol-borda-forte' : duvida && !respondida(r) ? 'border-farol-facho' : 'border-farol-borda'
      }`}
      data-foto={marca}
    >
      {foto.quadroId ? (
        // A miniatura mostra o meio do recorte (`object-cover`); tocar nela abre a foto inteira, maior.
        <button
          type="button"
          id={idDaMiniatura}
          onClick={aoAbrirQuadro}
          aria-label={`Ver maior a foto das ${noQuadro.hora} (${noQuadro.lado})`}
          data-miniatura-da-foto={marca}
          className="group relative block aspect-square w-full max-w-full cursor-zoom-in overflow-hidden rounded-lg bg-farol-realce max-[420px]:max-w-[160px]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- o quadro vem da API, por id, e o navegador o guarda */}
          <img src={treinoApi.urlDoQuadro(foto.quadroId)} alt="" className={`h-full w-full object-cover ${r.ruim ? 'opacity-55 grayscale' : ''}`} loading="lazy" />
          {/* A lupa no canto diz que a foto abre maior sem depender do mouse em cima (no celular não há). */}
          <span
            className="absolute bottom-1 right-1 grid h-[22px] w-[22px] place-items-center rounded-md bg-farol-palco/80 text-farol-palco-tinta transition-transform group-hover:scale-110"
            aria-hidden
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        <div className="aspect-square w-full max-w-full overflow-hidden rounded-lg bg-farol-realce max-[420px]:max-w-[160px]">
          <span className="grid h-full w-full place-items-center text-farol-suave" title="Esta foto não subiu da loja">
            <ImageOff className="h-5 w-5" aria-hidden />
          </span>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-mono text-[11.5px] text-farol-suave">
          {noQuadro.hora} · {noQuadro.lado}
        </p>
        {/* a leitura num bloco só: na linha flexível, a vírgula sozinha ganhava espaço dos dois lados (ERR-129) */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]" data-leitura-da-foto>
          {leu.length > 0 && (
            <span className="min-w-0 break-words">
              O Farol leu{' '}
              {leu.map((t, i) => (
                <span key={i}>
                  {i > 0 ? ', ' : ''}
                  <b className="font-semibold">{t}</b>
                </span>
              ))}
            </span>
          )}
          {/* o espaço escrito: o leitor de tela lê "molho verde com dúvida", e não "verdecom" */}
          {leu.length > 0 && (semNada || duvida) ? ' ' : null}
          {semNada ? <Chip>sem leitura</Chip> : duvida ? <Chip tom="atencao">com dúvida</Chip> : null}
        </p>

        {r.ruim ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-obs`} className="text-xs font-medium text-farol-suave">
              O que houve <span className="font-normal">(opcional)</span>
            </label>
            <input
              id={`${id}-obs`}
              className="entrada"
              maxLength={120}
              autoComplete="off"
              placeholder="Ex.: só o papel do delivery, borrada, pegou as duas metades"
              value={r.obs}
              onChange={(e) => {
                const v = e.target.value;
                aoMudar((x) => ({ ...x, obs: v }));
              }}
              data-obs-da-foto
            />
          </div>
        ) : oferta.length === 0 ? (
          <p className={AJUDA}>Escolha o lanche acima para ver aqui os ingredientes da ficha dele.</p>
        ) : (
          <div role="group" aria-label={`O que aparece na foto das ${noQuadro.hora}`} className="flex flex-wrap gap-1.5" data-marcas-da-foto>
            {oferta.map((n) => {
              const lido = ehFeita(sugeridos, n);
              return (
                <Pilula key={n} id={`${id}-${idDe(n)}`} marcada={ehFeita(r.marcados, n)} ponto={lido} aoClicar={() => aoMarcar(n)}>
                  {n}
                  {lido && <span className="sr-only"> (o Farol acha que pode ser)</span>}
                  {/* o nome escrito à mão que não está nas fichas: vira sugestão para as fichas ao salvar */}
                  {ehForaDasFichas(n) && (
                    <>
                      {' '}
                      <small className="font-normal opacity-80" data-fora-das-fichas>
                        · fora das fichas
                      </small>
                    </>
                  )}
                </Pilula>
              );
            })}
          </div>
        )}

        {!r.ruim && r.mais && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-outro`} className="text-xs font-medium text-farol-suave">
              Outro ingrediente
            </label>
            <select
              id={`${id}-outro`}
              className="entrada"
              value={r.escrevendo ? NOVO : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === NOVO) {
                  aoPedirFoco(`${id}-novo`);
                  aoMudar((x) => ({ ...x, escrevendo: true }));
                } else if (v) aoAcrescentar(v);
              }}
              data-outro-ingrediente
            >
              <option value="">Escolha o ingrediente</option>
              {fora.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={NOVO}>Um ingrediente que não está nas fichas…</option>
            </select>
            {r.escrevendo && (
              <div className="flex min-w-0 flex-col gap-2">
                <label htmlFor={`${id}-novo`} className="sr-only">
                  Nome do ingrediente
                </label>
                <input
                  id={`${id}-novo`}
                  className="entrada min-w-0"
                  maxLength={120}
                  autoComplete="off"
                  placeholder="Nome do ingrediente"
                  value={r.novo}
                  onChange={(e) => {
                    const v = e.target.value;
                    aoMudar((x) => ({ ...x, novo: v }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    // o Enter faz o óbvio: o mesmo entra; com parecidos, o foco vai para o primeiro; sem nada, acrescenta
                    if (!achado) return;
                    if (achado.mesmo) aoAcrescentar(achado.mesmo.nome);
                    else if (achado.parecidos[0]) document.getElementById(`${id}-parecido-${idDe(achado.parecidos[0].nome)}`)?.focus();
                    else aoAcrescentar(escrito);
                  }}
                  data-nome-novo
                />
                {/* o que as fichas têm com o nome, enquanto se escreve (o protótipo aprovado em 19/10/2026) */}
                <div aria-live="polite" className="min-w-0" data-o-que-as-fichas-tem>
                  {!achado ? (
                    <p className={AJUDA}>Escreva o nome: o Farol procura nas fichas o mesmo ingrediente, mesmo escrito de outro jeito.</p>
                  ) : achado.mesmo && !achado.mesmo.fora ? (
                    <Alerta tom="ok" icone={Check}>
                      <b className="font-semibold">É o “{achado.mesmo.nome}” das fichas.</b>{' '}
                      {achado.outroNome ? `Quem configura a loja disse que “${escrito}” é ele.` : 'O mesmo ingrediente, escrito de outro jeito.'} Ele entra com o
                      nome da ficha, e os exemplos vão para ele.{' '}
                      <small className="mt-0.5 block text-farol-suave">{frase(ondeEntra(lanchesDoIngrediente[achado.mesmo.nome]))}</small>
                      <AcaoDoNome principal id={`${id}-usar`} aoClicar={() => aoAcrescentar(achado.mesmo!.nome)} dado="usar">
                        Marcar “{achado.mesmo.nome}”
                      </AcaoDoNome>
                    </Alerta>
                  ) : achado.mesmo ? (
                    <Alerta icone={Info}>
                      <b className="font-semibold">“{achado.mesmo.nome}” já foi escrito na conferência.</b> Ainda não está nas fichas e espera a resposta de
                      quem configura a loja. Entra com esse nome, e os exemplos ficam juntos.
                      <AcaoDoNome principal id={`${id}-usar`} aoClicar={() => aoAcrescentar(achado.mesmo!.nome)} dado="usar">
                        Marcar “{achado.mesmo.nome}”
                      </AcaoDoNome>
                    </Alerta>
                  ) : achado.parecidos.length > 0 ? (
                    <Alerta tom="atencao" icone={Info}>
                      <b className="font-semibold">
                        {achado.parecidos.every((c) => !c.fora)
                          ? achado.parecidos.length === 1
                            ? 'Parece com um ingrediente das fichas. É este?'
                            : 'Parece com ingredientes das fichas. É um destes?'
                          : achado.parecidos.length === 1
                            ? 'Parece com um nome que já existe. É este?'
                            : 'Parece com nomes que já existem. É um destes?'}
                      </b>
                      <span role="group" aria-label="Os parecidos" className="mt-2 flex flex-wrap gap-1.5">
                        {achado.parecidos.map((c) => (
                          <button
                            key={c.nome}
                            type="button"
                            id={`${id}-parecido-${idDe(c.nome)}`}
                            onClick={() => aoAcrescentar(c.nome)}
                            className="flex min-h-8 max-w-full flex-col items-start rounded-[10px] border border-farol-borda-forte bg-farol-painel px-3 py-1.5 text-left text-xs font-medium text-farol-tinta transition-colors hover:border-farol-marca"
                            data-parecido
                          >
                            <span className="min-w-0 break-words">{c.nome}</span>
                            {/* a vírgula é para o leitor de tela: sem ela, o nome e a linha de baixo viram uma palavra só */}
                            <span className="sr-only">, </span>
                            <small className="min-w-0 break-words text-[11.5px] font-normal text-farol-suave">
                              {c.fora ? 'escrito na conferência, fora das fichas' : ondeEntra(lanchesDoIngrediente[c.nome])}
                            </small>
                          </button>
                        ))}
                      </span>
                      <AcaoDoNome id={`${id}-outro-nome`} aoClicar={() => aoAcrescentar(escrito)} dado="e-outro">
                        Não, é outro: acrescentar “{escrito}”
                      </AcaoDoNome>
                    </Alerta>
                  ) : (
                    <Alerta icone={Info}>
                      <b className="font-semibold">Não está em nenhuma ficha.</b> Ele entra com este nome, marcado “fora das fichas”, e vira uma sugestão
                      para as fichas: quem configura a loja diz se é um ingrediente das fichas com outro nome ou se vai entrar numa ficha nova.
                      <AcaoDoNome id={`${id}-acrescentar`} aoClicar={() => aoAcrescentar(escrito)} dado="acrescentar">
                        Acrescentar “{escrito}”
                      </AcaoDoNome>
                    </Alerta>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {!r.ruim && (
            <Botao
              variante="fantasma"
              mini
              id={`${id}-mais`}
              aria-expanded={r.mais}
              onClick={() => {
                if (!r.mais) aoPedirFoco(`${id}-outro`);
                aoMudar((x) => ({ ...x, mais: !x.mais, escrevendo: false, novo: '' }));
              }}
              data-mais-da-foto
            >
              <Plus className="h-[15px] w-[15px]" aria-hidden />
              Outro ingrediente
            </Botao>
          )}
          <Botao mini aria-pressed={r.ruim} onClick={() => aoMudar((x) => ({ ...x, ruim: !x.ruim, mais: false }))} data-ruim-da-foto>
            Não dá para analisar
          </Botao>
        </div>
      </div>
    </li>
  );
}

// ───────────────────────── a conta da ficha ─────────────────────────

function ContaDaFicha({
  id,
  produto,
  pelaEscolha,
  conta,
  faltas,
  aMais,
  aoMudarFalta,
  aoMudarAMais,
}: {
  id: string;
  produto: string;
  /** Falso: a conta é pelo palpite (a pessoa ainda não escolheu). */
  pelaEscolha: boolean;
  conta: {
    linhas: Array<{ nome: string; quantidade: string; quer: number; viu: number; invisivel: boolean; tira: string | null }>;
    fora: Array<{ nome: string; adicional: boolean }>;
  };
  faltas: ConferenciaPorFoto['faltas'];
  aMais: ConferenciaPorFoto['aMais'];
  aoMudarFalta: (nome: string, v: ConferenciaPorFoto['faltas'][string] | null) => void;
  aoMudarAMais: (nome: string, v: ConferenciaPorFoto['aMais'][string] | null) => void;
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby={id}>
      <h3 id={id} className={ROTULO}>
        Comparado com a ficha do {produto}
      </h3>
      {!pelaEscolha && <p className={AJUDA}>Pelo palpite do Farol. Muda quando você escolher o lanche acima.</p>}
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
                <b className="font-semibold">{l.nome}</b> <span className="font-mono text-xs text-farol-suave">{l.quer > 1 ? `${l.viu} de ${l.quer}` : l.quantidade}</span>
                <small className="block text-xs text-farol-suave">
                  {bate ? 'visto' : l.viu ? 'veio menos do que a ficha diz' : 'não foi visto'}
                  {!bate && l.tira ? ` · o ${produto} tem o adicional “${l.tira}”` : ''}
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
                    aoMudar={(v) => aoMudarFalta(l.nome, v as ConferenciaPorFoto['faltas'][string])}
                    aoLimpar={() => aoMudarFalta(l.nome, null)}
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
              <small className="block text-xs text-farol-suave">{f.adicional ? `fora da ficha, mas é adicional do ${produto}` : 'fora da ficha'}</small>
              <Escolhas
                rotulo={`De onde veio ${f.nome}`}
                valor={aMais[f.nome] ?? null}
                opcoes={[
                  ['adicional', 'Pedido do cliente'],
                  ['amais', 'A mais, sem pedido'],
                ]}
                aoMudar={(v) => aoMudarAMais(f.nome, v as ConferenciaPorFoto['aMais'][string])}
                aoLimpar={() => aoMudarAMais(f.nome, null)}
              />
            </span>
          </li>
        ))}
      </ul>
      {conta.linhas.some((l) => !l.invisivel && l.viu < l.quer) && (
        <p className={AJUDA}>O que falta nem sempre é erro: o cliente pode ter pedido sem. Com os pedidos do KDS, o Farol vai saber isso sozinho.</p>
      )}
    </section>
  );
}

// ───────────────────────── as peças ─────────────────────────

function Opcao({ marcada, aoMarcar, titulo, sobre }: { marcada: boolean; aoMarcar: () => void; titulo: string; sobre: string }) {
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
      <span className="break-words font-semibold">{titulo}</span>
      <small className="text-xs text-farol-suave">{sobre}</small>
    </button>
  );
}

/** Um botão de escolha, que fica aceso quando escolhido. `ponto`: o que o Farol acha que pode ser. */
/** Uma ação do nome escrito à mão. Quebra a linha (o nome pode ser longo), ao contrário do `Botao`, que não quebra. */
function AcaoDoNome({ id, principal = false, dado, aoClicar, children }: { id: string; principal?: boolean; dado: string; aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      id={id}
      onClick={aoClicar}
      className={`mt-2 flex min-h-8 max-w-full items-center rounded-[10px] border px-2.5 py-1.5 text-left text-[13px] font-semibold leading-snug transition max-md:min-h-9 ${
        principal ? 'border-transparent bg-farol-marca text-farol-sobre-marca hover:opacity-90' : 'border-farol-borda-forte bg-farol-painel text-farol-tinta hover:border-farol-marca'
      }`}
      data-acao-do-nome={dado}
    >
      <span className="min-w-0 break-words">{children}</span>
    </button>
  );
}

function Pilula({ id, marcada, ponto = false, aoClicar, children }: { id?: string; marcada: boolean; ponto?: boolean; aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      id={id}
      aria-pressed={marcada}
      onClick={aoClicar}
      className={`inline-flex min-h-8 max-w-full items-center gap-1.5 break-words rounded-full border px-3 py-1 text-left text-xs font-medium transition-colors ${
        marcada ? 'border-farol-facho bg-farol-facho-leve text-farol-facho-tinta' : 'border-farol-borda-forte text-farol-suave hover:text-farol-tinta'
      }`}
    >
      {ponto && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${marcada ? 'bg-farol-facho-tinta' : 'bg-farol-marca'}`} aria-hidden />}
      <span className="min-w-0">{children}</span>
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
