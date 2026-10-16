'use client';

// =====================================================================
// Treinamento — a bancada aprende com o que você confere
// =====================================================================
// A21, fatia T4. Do protótipo aprovado pelo dono em 15/10/2026
// (`mockups/farol-conexoes-e-fichas.html`, tela Treinamento), com as
// decisões do mesmo dia:
//
//   • a loja lê os lanches de uma gravação de treino e manda, de cada um,
//     as etapas e os quadros reduzidos. Aqui a pessoa confere: "qual lanche
//     era?", etapa por etapa, e a conta da ficha
//     (`componentes/treino/gaveta-do-lanche.tsx`). A fila começa pelos de
//     mais dúvida — é onde a conferência ensina mais;
//   • os números contam SÓ o que alguém conferiu: antes da conferência, o
//     Farol não sabe se acertou. A meta: o lanche certo em 9 de cada 10,
//     com pelo menos 30 conferidos (decisão 2);
//   • conferem a diretoria, a gerência e a supervisão (decisão 3) — a API
//     decide; esta tela só não mostra o que o perfil não usa;
//   • a gravação inteira fica no computador da loja; os quadros saem 30
//     dias depois da conferência (decisão 1).
//
// A GRAVAÇÃO DE TREINO (fatia T3): quem configura cria no console
// (`componentes/treino/gaveta-da-gravacao.tsx`), cancela o que ainda não
// começou e apaga as imagens da gravação já conferida. Quem lê é o
// computador da loja — enquanto o pacote dele não sabe (`lojaSabeGravar`),
// a tela diz que a gravação espera na fila.
//
// As SUGESTÕES PARA AS FICHAS (fatia T6): tiradas só do que foi conferido;
// quem configura responde (`componentes/treino/painel-das-sugestoes.tsx`).
// =====================================================================

import { ChevronRight, ClipboardList, Clock, GraduationCap, ImageOff, Info, Lock, Plus, Store, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useConsole } from '@/componentes/console';
import { chaveDoIngrediente, GavetaDoIngrediente, type AlvoDaGaveta } from '@/componentes/fichas/gaveta-do-ingrediente';
import { frase, numero, plural } from '@/componentes/formatos';
import { GavetaDaGravacao } from '@/componentes/treino/gaveta-da-gravacao';
import { GavetaDoLanche, quandoDaGravacao } from '@/componentes/treino/gaveta-do-lanche';
import { PainelDasSugestoes } from '@/componentes/treino/painel-das-sugestoes';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Segmentado, Vazio, type Tom } from '@/componentes/ui/pecas';
import { Dialogo } from '@/componentes/ui/sobreposto';
import {
  ErroDaApi,
  ingredientesApi,
  treinoApi,
  type GravacaoDeTreino,
  type IngredienteDaLoja,
  type IngredientesDaLoja,
  type LancheNaFila,
  type MotivoNaFila,
  type TreinoDaLoja,
} from '@/lib/api';

type Aba = 'lanches' | 'ingredientes' | 'sugestoes' | 'gravacoes';
type FiltroDosLanches = 'conferir' | 'conferidos' | 'pulados';
type FiltroDosIngredientes = 'todos' | 'semex' | 'semfoto';

const ABAS: ReadonlyArray<{ id: Aba; rotulo: string }> = [
  { id: 'lanches', rotulo: 'Lanches' },
  { id: 'ingredientes', rotulo: 'Ingredientes' },
  { id: 'sugestoes', rotulo: 'Sugestões para as fichas' },
  { id: 'gravacoes', rotulo: 'Gravações' },
];

/** Por que o lanche está na fila, dito na linha dele. */
const MOTIVO: Record<MotivoNaFila, { tom: Tom; texto: string }> = {
  coberto: { tom: 'atencao', texto: 'uma etapa ficou sem leitura' },
  duvida: { tom: 'atencao', texto: 'a leitura ficou entre dois nomes' },
  diferenca: { tom: 'vazado', texto: 'diferente da ficha' },
  certo: { tom: 'neutro', texto: 'o Farol acha que acertou' },
};
const SEM_LEITURA: { tom: Tom; texto: string } = { tom: 'neutro', texto: 'sem leitura dos ingredientes' };

/** "Reconhece" quando a leitura acertou o ingrediente em 85% das vezes, com pelo menos 5 lanches (o protótipo). */
const RECONHECE = { parte: 0.85, minimo: 5 };

const mensagemDe = (e: unknown): string => (e instanceof ErroDaApi ? e.message : 'não deu certo');

/** O que a gravação é, no chip da linha dela. */
function situacaoDaGravacao(g: GravacaoDeTreino): { tom: Tom; texto: string; sobre: string | null } {
  const faltam = g.lanches - g.conferidos;
  switch (g.situacao) {
    case 'programada':
      return { tom: 'neutro', texto: 'programada', sobre: 'a loja busca no gravador depois do horário e lê' };
    case 'fila':
      return { tom: 'neutro', texto: 'na fila', sobre: 'começa quando chegar a vez dela' };
    case 'lendo':
      return { tom: 'atencao', texto: 'lendo na loja', sobre: g.progresso !== null ? `${g.progresso}%` : null };
    case 'apagada':
      return { tom: 'neutro', texto: 'imagens apagadas', sobre: `${plural(g.lanches, 'lanche', 'lanches')} · o aprendido ficou` };
    case 'cancelada':
      return { tom: 'neutro', texto: 'cancelada', sobre: null };
    case 'falhou':
      return { tom: 'critico', texto: 'a leitura falhou', sobre: g.motivo };
    default:
      if (g.lanches === 0) return { tom: 'neutro', texto: 'sem lanche', sobre: 'a leitura não achou lanche nesse horário' };
      return faltam > 0
        ? { tom: 'atencao', texto: `${numero(faltam)} para conferir`, sobre: plural(g.lanches, 'lanche', 'lanches') }
        : { tom: 'ok', texto: 'conferida', sobre: `${plural(g.lanches, 'lanche', 'lanches')} · imagens por 30 dias depois da conferência` };
  }
}

/** De onde a gravação veio. */
const ORIGEM: Record<GravacaoDeTreino['origem'], string> = {
  gravador: 'do que o gravador guardou',
  programada: 'programada',
  carga: 'leitura de teste da bancada',
};

export default function Treinamento() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const avisar = useAvisar();
  const { loja } = useConsole();
  const fuso = loja?.timezone ?? 'America/Sao_Paulo';

  const [d, setD] = useState<TreinoDaLoja | null>(null);
  const [falha, setFalha] = useState<{ semPermissao: boolean; texto: string } | null>(null);
  // Os ingredientes das fichas, com as fotos e os exemplos (A21, fatia T1). Vêm à parte: se não vierem, a conferência
  // continua e só a aba Ingredientes fica sem lista.
  const [ingredientes, setIngredientes] = useState<IngredientesDaLoja | null>(null);
  const [aba, setAba] = useState<Aba>('lanches');
  const [filtro, setFiltro] = useState<FiltroDosLanches>('conferir');
  const [filtroIng, setFiltroIng] = useState<FiltroDosIngredientes>('todos');
  /** O lanche na gaveta, e de qual lista ele veio (o "próximo" é dessa lista). */
  const [aberto, setAberto] = useState<{ id: string; de: FiltroDosLanches } | null>(null);
  const [ingredienteAberto, setIngredienteAberto] = useState<{ nome?: string; orfao?: string } | null>(null);
  // a gravação de treino (fatia T3): a gaveta da nova, a que está sendo cancelada e a das imagens a apagar
  const [novaGravacao, setNovaGravacao] = useState(false);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [apagando, setApagando] = useState<GravacaoDeTreino | null>(null);
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  const botoes = useRef<Record<string, HTMLButtonElement | null>>({});

  const carregar = useCallback(async (): Promise<TreinoDaLoja | null> => {
    try {
      const r = await treinoApi.daLoja(id);
      setD(r);
      setFalha(null);
      return r;
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 401) {
        router.replace('/entrar');
        return null;
      }
      setFalha({ semPermissao: e instanceof ErroDaApi && e.status === 403, texto: mensagemDe(e) });
      return null;
    }
  }, [id, router]);

  const carregarIngredientes = useCallback(async () => {
    try {
      setIngredientes(await ingredientesApi.listar(id));
    } catch {
      setIngredientes(null);
    }
  }, [id]);

  useEffect(() => {
    setD(null);
    setIngredientes(null);
    void carregar();
    void carregarIngredientes();
  }, [carregar, carregarIngredientes]);

  // ───────────────────────── as listas ─────────────────────────

  const listas = useMemo(() => {
    const lanches = d?.lanches ?? [];
    return {
      conferir: lanches.filter((l) => l.situacao === 'conferir'),
      conferidos: lanches
        .filter((l) => l.situacao === 'conferido')
        .sort((a, b) => Date.parse(b.conferidoEm ?? '') - Date.parse(a.conferidoEm ?? '')),
      pulados: lanches.filter((l) => l.situacao === 'pulado'),
    };
  }, [d]);
  const gravacaoDe = useMemo(() => new Map((d?.gravacoes ?? []).map((g) => [g.id, g])), [d]);

  // Os ingredientes desta bancada: os dos lanches que alguém conferiu nela, e o que a conferência ensinou
  const daBancada = useMemo(() => {
    if (!d || !ingredientes) return [];
    const produtos = new Set(listas.conferidos.flatMap((l) => (l.produto ? [chaveDoIngrediente(l.produto)] : [])));
    const ensinados = new Set(Object.keys(d.aprendizado).map(chaveDoIngrediente));
    return ingredientes.ingredientes.filter(
      (i) => ensinados.has(chaveDoIngrediente(i.nome)) || i.produtos.some((p) => produtos.has(chaveDoIngrediente(p.produto))),
    );
  }, [d, ingredientes, listas.conferidos]);
  const aprendido = useMemo(() => {
    const m = new Map<string, { presente: number; reconheceu: number }>();
    for (const [nome, a] of Object.entries(d?.aprendizado ?? {})) m.set(chaveDoIngrediente(nome), a);
    return m;
  }, [d]);

  // ───────────────────────── a gaveta do lanche ─────────────────────────

  async function depoisDaGaveta(texto: string, de: FiltroDosLanches, saiu: string, fechar: boolean) {
    avisar(texto);
    const r = await carregar();
    if (fechar || !r) return setAberto(null);
    // o próximo da mesma lista (a fila já vem na ordem: a dúvida primeiro)
    const situacao = de === 'pulados' ? 'pulado' : 'conferir';
    const proximo = r.lanches.find((l) => l.situacao === situacao && l.id !== saiu);
    if (proximo) setAberto({ id: proximo.id, de });
    else {
      setAberto(null);
      if (de === 'conferir') avisar('Tudo conferido: não há lanche esperando conferência.');
    }
  }
  const lista = aberto ? listas[aberto.de] : [];
  const posicao = aberto && aberto.de === 'conferir' ? lista.findIndex((l) => l.id === aberto.id) : -1;

  // ───────────────────────── a gravação de treino (fatia T3) ─────────────────────────

  async function criou(texto: string) {
    setNovaGravacao(false);
    avisar(texto);
    await carregar();
    setAba('gravacoes');
  }

  // do protótipo: cancelar não pede confirmação — a gravação ainda não começou, e criar de novo é fácil
  async function cancelarGravacao(g: GravacaoDeTreino) {
    setCancelando(g.id);
    try {
      await treinoApi.cancelarGravacao(g.id);
      avisar(`Gravação de ${quandoDaGravacao(g.inicio, g.fim, fuso)} cancelada.`);
    } catch (e) {
      avisar(frase(mensagemDe(e)));
    } finally {
      setCancelando(null);
      await carregar();
    }
  }

  async function apagarImagens() {
    if (!apagando) return;
    setOcupadoApagar(true);
    setErroApagar(null);
    try {
      await treinoApi.apagarImagens(apagando.id);
      avisar(`Imagens da gravação de ${quandoDaGravacao(apagando.inicio, apagando.fim, fuso)} apagadas. O que o Farol aprendeu ficou.`);
      setApagando(null);
      await carregar();
    } catch (e) {
      setErroApagar(frase(mensagemDe(e)));
    } finally {
      setOcupadoApagar(false);
    }
  }

  // ───────────────────────── a gaveta do ingrediente ─────────────────────────

  const alvoAberto: AlvoDaGaveta | null = (() => {
    if (!ingredienteAberto || !ingredientes) return null;
    if (ingredienteAberto.orfao) {
      const o = ingredientes.orfaos.find((x) => x.itemId === ingredienteAberto.orfao);
      return o ? { tipo: 'orfao', orfao: o } : null;
    }
    const i = ingredientes.ingredientes.find((x) => chaveDoIngrediente(x.nome) === chaveDoIngrediente(ingredienteAberto.nome ?? ''));
    return i ? { tipo: 'ingrediente', ingrediente: i } : null;
  })();

  function irParaAba(delta: number) {
    const i = ABAS.findIndex((a) => a.id === aba);
    const nova = ABAS[(i + delta + ABAS.length) % ABAS.length]!.id;
    setAba(nova);
    botoes.current[nova]?.focus();
  }

  const canais = [...new Set((d?.gravacoes ?? []).flatMap((g) => (g.canal ? [g.canal.numero !== null ? `${g.canal.nome} · canal ${g.canal.numero}` : g.canal.nome] : [])))];
  // Sem ingrediente nenhum nas fichas (e sem órfão): a loja não tem fichas — o treinamento não tem com o que comparar
  const semFichas = ingredientes !== null && ingredientes.ingredientes.length === 0 && ingredientes.orfaos.length === 0;
  const conta = {
    conferir: listas.conferir.length,
    ingredientes: daBancada.length,
    // a aba conta as que esperam resposta
    sugestoes: (d?.sugestoes ?? []).filter((s) => s.decisao === null).length,
    gravacoes: d?.gravacoes.length ?? 0,
  };
  // a gravação nova: quem configura, com fichas e com uma câmera do gravador (a API decide; a tela só não oferece)
  const podeGravar = !!d && d.podeConfigurar && !semFichas && d.canais.length > 0;
  const botaoNova = (
    <Botao variante="primario" onClick={() => setNovaGravacao(true)}>
      <Plus className="h-4 w-4" aria-hidden />
      Nova gravação de treino
    </Botao>
  );

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Store className="h-[15px] w-[15px]" aria-hidden />
            {loja?.nome ?? 'Loja'}
          </>
        }
        titulo={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            Treinamento
            {d && d.gravacoes.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5 font-sans text-sm font-normal tracking-normal">
                {canais.slice(0, 2).map((c) => (
                  <Chip key={c} tom="vazado" quebra>
                    {c}
                  </Chip>
                ))}
                <Chip>lido no computador da loja</Chip>
              </span>
            )}
          </span>
        }
        acoes={podeGravar && d.gravacoes.length > 0 ? botaoNova : undefined}
      >
        O Farol lê os lanches de uma gravação de treino e mostra o que viu, etapa por etapa. Você confirma ou corrige; cada caso conferido vira exemplo
        na base da bancada.
      </Cabecalho>

      {!d && !falha && <Ossos alturas={[[88, 88, 88], 44, 300]} />}

      {falha &&
        (falha.semPermissao ? (
          <Vazio icone={Lock} titulo="Seu perfil não vê o treinamento da loja">
            O treinamento aparece para a supervisão, a gerência e a diretoria.
          </Vazio>
        ) : (
          <Vazio
            icone={TriangleAlert}
            titulo="O console não respondeu"
            acao={
              <Botao
                variante="primario"
                onClick={() => {
                  setFalha(null);
                  void carregar();
                }}
              >
                Tentar de novo
              </Botao>
            }
          >
            {frase(falha.texto)}
          </Vazio>
        ))}

      {d && semFichas && (
        <Vazio
          icone={ClipboardList}
          titulo="Primeiro, as fichas"
          acao={
            <Link href={`/lojas/${id}/fichas`} className={classesDoBotao({ variante: 'primario' })}>
              Ir para Fichas
            </Link>
          }
        >
          O treinamento compara o que a bancada montou com as fichas da loja. Sem elas, o Farol não sabe o que esperar de cada lanche.
        </Vazio>
      )}

      {d && !semFichas && d.gravacoes.length === 0 && (
        <Vazio
          icone={GraduationCap}
          titulo="O Farol aprende com a sua bancada"
          acao={
            <div className="flex flex-col items-center gap-3">
              <ol className="max-w-[52ch] list-decimal space-y-1 pl-5 text-left text-[13.5px] text-farol-suave">
                <li>Escolha o horário: do que o gravador já guardou, ou para gravar depois.</li>
                <li>O computador da loja lê os lanches, devagar, sem atrapalhar o expediente.</li>
                <li>Você confere: confirma o que está certo e corrige o que não está. Cada conferência ensina.</li>
              </ol>
              {podeGravar ? botaoNova : <p className={AJUDA}>Quem configura a loja cria a gravação de treino.</p>}
            </div>
          }
        >
          Escolha um horário de movimento. O Farol lê os lanches no computador da loja e traz o que viu para você conferir.
        </Vazio>
      )}

      {d && !semFichas && d.gravacoes.length > 0 && (
        <>
          <Numeros d={d} daBancada={daBancada} fuso={fuso} />

          <div role="tablist" aria-label="Partes do treinamento" className="flex flex-wrap gap-x-1 border-b border-farol-borda max-sm:gap-x-0">
            {ABAS.map((a) => {
              const ativa = a.id === aba;
              return (
                <button
                  key={a.id}
                  ref={(el) => {
                    botoes.current[a.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`aba-${a.id}`}
                  aria-controls={`painel-${a.id}`}
                  aria-selected={ativa}
                  tabIndex={ativa ? 0 : -1}
                  onClick={() => setAba(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') irParaAba(1);
                    if (e.key === 'ArrowLeft') irParaAba(-1);
                  }}
                  className={`relative inline-flex min-h-11 items-center gap-2 whitespace-nowrap px-3 font-semibold max-sm:px-2.5 after:absolute after:inset-x-3 max-sm:after:inset-x-2.5 after:-bottom-px after:h-0.5 after:origin-center after:rounded-sm after:bg-farol-facho after:transition-transform after:duration-200 after:ease-farol ${
                    ativa ? 'text-farol-tinta after:scale-x-100' : 'text-farol-suave after:scale-x-0 hover:text-farol-tinta'
                  }`}
                >
                  {a.rotulo}
                  <span className="font-mono text-xs font-medium text-farol-suave">{numero(conta[a.id === 'lanches' ? 'conferir' : a.id])}</span>
                </button>
              );
            })}
          </div>

          {aba === 'lanches' && (
            <div role="tabpanel" id="painel-lanches" aria-labelledby="aba-lanches" className="flex animate-sobe flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Segmentado
                  rotulo="Quais lanches"
                  valor={filtro}
                  aoMudar={setFiltro}
                  opcoes={[
                    { valor: 'conferir', rotulo: `Para conferir ${numero(listas.conferir.length)}` },
                    { valor: 'conferidos', rotulo: `Conferidos ${numero(d.contas.conferidos)}` },
                    { valor: 'pulados', rotulo: `Pulados ${numero(listas.pulados.length)}` },
                  ]}
                />
              </div>
              <PainelDosLanches
                filtro={filtro}
                listas={listas}
                conferidosAoTodo={d.contas.conferidos}
                gravacaoDe={gravacaoDe}
                gravacoes={d.gravacoes}
                fuso={fuso}
                aoAbrir={(l) => setAberto({ id: l.id, de: filtro })}
              />
            </div>
          )}

          {aba === 'ingredientes' && (
            <div role="tabpanel" id="painel-ingredientes" aria-labelledby="aba-ingredientes" className="flex animate-sobe flex-col gap-3">
              <PainelDosIngredientes
                ingredientes={ingredientes}
                daBancada={daBancada}
                aprendido={aprendido}
                filtro={filtroIng}
                aoFiltrar={setFiltroIng}
                aoAbrir={(nome) => setIngredienteAberto({ nome })}
                aoAbrirOrfao={(itemId) => setIngredienteAberto({ orfao: itemId })}
                lojaId={id}
              />
            </div>
          )}

          {aba === 'sugestoes' && (
            <div role="tabpanel" id="painel-sugestoes" aria-labelledby="aba-sugestoes" className="flex animate-sobe flex-col gap-3">
              <PainelDasSugestoes
                lojaId={id}
                fuso={fuso}
                sugestoes={d.sugestoes}
                fichasDe={d.fichasDe}
                podeConfigurar={d.podeConfigurar}
                aoResponder={async () => {
                  await carregar();
                }}
              />
            </div>
          )}

          {aba === 'gravacoes' && (
            <div role="tabpanel" id="painel-gravacoes" aria-labelledby="aba-gravacoes" className="flex animate-sobe flex-col gap-3">
              <ul className={`${CARTAO} divide-y divide-farol-borda`} aria-label="Gravações de treino" data-gravacoes>
                {d.gravacoes.map((g) => (
                  <LinhaDaGravacao
                    key={g.id}
                    g={g}
                    fuso={fuso}
                    podeConfigurar={d.podeConfigurar}
                    cancelando={cancelando === g.id}
                    aoConferir={() => {
                      setFiltro('conferir');
                      setAba('lanches');
                    }}
                    aoCancelar={() => void cancelarGravacao(g)}
                    aoApagar={() => {
                      setErroApagar(null);
                      setApagando(g);
                    }}
                  />
                ))}
              </ul>
              {!d.lojaSabeGravar && d.gravacoes.some((g) => g.situacao === 'programada' || g.situacao === 'fila') && (
                <Alerta tom="atencao" icone={Info} papel="status">
                  <b className="font-semibold">O computador da loja ainda não sabe gravar o treino.</b> As gravações na fila começam quando o pacote
                  novo for instalado nele.
                </Alerta>
              )}
              <p className={`${AJUDA} flex items-start gap-1.5`}>
                <Lock className="mt-px h-[13px] w-[13px] shrink-0" aria-hidden />A gravação inteira fica no computador da loja, separada das outras.
                Para você conferir de qualquer lugar, sobem só os quadros das etapas, reduzidos; eles saem {d.diasDosQuadros} dias depois da
                conferência, e o que foi aprendido fica.
              </p>
            </div>
          )}
        </>
      )}

      {aberto && (
        <GavetaDoLanche
          lojaId={id}
          lancheId={aberto.id}
          fuso={fuso}
          posicao={posicao >= 0 ? `${posicao + 1} de ${lista.length} para conferir` : null}
          aoSalvar={(texto) => void depoisDaGaveta(texto, aberto.de, aberto.id, aberto.de === 'conferidos')}
          aoPular={(texto) => void depoisDaGaveta(texto, aberto.de, aberto.id, false)}
          aoFechar={() => setAberto(null)}
        />
      )}

      {alvoAberto && ingredientes && (
        <GavetaDoIngrediente
          lojaId={id}
          fuso={fuso}
          alvo={alvoAberto}
          limiteDeFotos={ingredientes.limiteDeFotos}
          podeConfigurar={ingredientes.podeConfigurar}
          nomesNasFichas={ingredientes.ingredientes.map((i) => i.nome)}
          voltarPara={null}
          aoMudar={carregarIngredientes}
          aoFechar={() => setIngredienteAberto(null)}
        />
      )}

      {novaGravacao && d && (
        <GavetaDaGravacao
          lojaId={id}
          fuso={fuso}
          canais={d.canais}
          regras={d.regras}
          lojaSabeGravar={d.lojaSabeGravar}
          aoCriar={(texto) => void criou(texto)}
          aoFechar={() => setNovaGravacao(false)}
        />
      )}

      {apagando && (
        <Dialogo
          titulo={`Apagar as imagens da gravação de ${quandoDaGravacao(apagando.inicio, apagando.fim, fuso)}?`}
          rotuloConfirmar="Apagar as imagens"
          rotuloOcupado="Apagando…"
          rotuloCancelar="Manter"
          ocupado={ocupadoApagar}
          erro={erroApagar}
          aoConfirmar={() => void apagarImagens()}
          aoCancelar={() => setApagando(null)}
        >
          Os quadros das etapas saem da nuvem agora, e o computador da loja recebe a ordem de apagar a gravação. O que o Farol aprendeu fica: o recorte
          de cada ingrediente conferido e os números.
        </Dialogo>
      )}
    </>
  );
}

// ───────────────────────── os números ─────────────────────────

function Numero({ valor, children }: { valor: string; children: ReactNode }) {
  return (
    <div className={`${CARTAO} flex flex-col gap-0.5 px-3 py-2.5 sm:px-4 sm:py-3.5`}>
      <b className="break-words font-display text-lg font-semibold leading-tight tracking-tight tabular-nums sm:text-[22px] md:text-[26px]">{valor}</b>
      <span className="text-[11.5px] leading-snug text-farol-suave sm:text-[12.5px]">{children}</span>
    </div>
  );
}

function Numeros({ d, daBancada, fuso }: { d: TreinoDaLoja; daBancada: IngredienteDaLoja[]; fuso: string }) {
  const { conferidos, acertou } = d.contas;
  const visiveis = daBancada.filter((i) => i.visivel);
  const comExemplo = visiveis.filter((i) => i.exemplos > 0).length;
  const porGravacao = d.gravacoes.filter((g) => g.conferidos > 0);
  const meta = d.meta;
  const naMeta = conferidos >= meta.minimo && acertou / conferidos >= meta.acerto;
  const sobreAMeta =
    conferidos < meta.minimo
      ? `Faltam ${plural(meta.minimo - conferidos, 'lanche conferido', 'lanches conferidos')} para a meta valer.`
      : naMeta
        ? 'A bancada está na meta.'
        : 'A bancada ainda está abaixo da meta.';
  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:gap-3" role="group" aria-label="O que o Farol já sabe nesta bancada" data-numeros>
        <Numero valor={numero(conferidos)}>{conferidos === 1 ? 'lanche conferido' : 'lanches conferidos'}</Numero>
        <Numero valor={conferidos ? `${numero(acertou)} de ${numero(conferidos)}` : '—'}>o lanche certo, antes da conferência</Numero>
        <Numero valor={`${numero(comExemplo)} de ${numero(visiveis.length)}`}>ingredientes da bancada com exemplo</Numero>
      </div>
      {porGravacao.length > 0 && (
        <section className={`${CARTAO} flex flex-col gap-3 px-4 py-3.5`} aria-labelledby="t-acerto">
          <header className="flex flex-wrap items-center gap-2">
            <h2 id="t-acerto" className="text-base font-semibold">
              O lanche certo, gravação por gravação
            </h2>
            <span className="ml-auto">
              <Chip tom={naMeta ? 'ok' : 'neutro'}>meta: 9 em 10</Chip>
            </span>
          </header>
          <div className="flex flex-col gap-2.5" data-acerto-por-gravacao>
            {porGravacao.map((g) => {
              const parte = g.acertou / g.conferidos;
              return (
                <div key={g.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)_auto]">
                  <span className="col-start-1 row-start-1 min-w-0 break-words text-farol-suave">{quandoDaGravacao(g.inicio, g.fim, fuso)}</span>
                  <span
                    className="relative col-span-2 col-start-1 row-start-2 h-2.5 overflow-hidden rounded-full bg-farol-realce sm:col-span-1 sm:col-start-2 sm:row-start-1"
                    role="img"
                    aria-label={`${Math.round(parte * 100)}% certos`}
                  >
                    <i className={`block h-full rounded-full ${parte >= meta.acerto ? 'bg-farol-ok' : 'bg-farol-marca'}`} style={{ width: `${Math.max(1.5, parte * 100)}%` }} />
                    {/* a meta: um traço nos 90% */}
                    <i className="absolute inset-y-0 w-px bg-farol-tinta/50" style={{ left: `${meta.acerto * 100}%` }} aria-hidden />
                  </span>
                  <span className="col-start-2 row-start-1 text-right font-mono text-[13px] font-semibold sm:col-start-3">
                    {numero(g.acertou)} de {numero(g.conferidos)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className={AJUDA}>
            Contado só nos lanches que alguém conferiu: antes da conferência, o Farol não sabe se acertou. A meta: o lanche certo em 9 de cada 10, com
            pelo menos {meta.minimo} conferidos. {sobreAMeta}
          </p>
        </section>
      )}
    </>
  );
}

// ───────────────────────── os lanches ─────────────────────────

function Miniatura({ quadroId, rotulo }: { quadroId: string | null; rotulo: string }) {
  return (
    <span className="grid h-[46px] w-[46px] place-items-center overflow-hidden rounded-md bg-farol-realce text-farol-suave max-[360px]:h-10 max-[360px]:w-10" title={rotulo}>
      {quadroId ? (
        // eslint-disable-next-line @next/next/no-img-element -- o quadro vem da API, por id, e o navegador o guarda
        <img src={treinoApi.urlDoQuadro(quadroId)} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <ImageOff className="h-4 w-4" aria-hidden />
      )}
    </span>
  );
}

function PainelDosLanches({
  filtro,
  listas,
  conferidosAoTodo,
  gravacaoDe,
  gravacoes,
  fuso,
  aoAbrir,
}: {
  filtro: FiltroDosLanches;
  listas: Record<FiltroDosLanches, LancheNaFila[]>;
  conferidosAoTodo: number;
  gravacaoDe: Map<string, GravacaoDeTreino>;
  gravacoes: GravacaoDeTreino[];
  fuso: string;
  aoAbrir: (l: LancheNaFila) => void;
}) {
  const lista = listas[filtro];
  const deQual = (l: LancheNaFila) => {
    const g = gravacaoDe.get(l.gravacaoId);
    return g ? `gravação de ${quandoDaGravacao(g.inicio, g.fim, fuso)}` : 'gravação de treino';
  };
  const hora = (l: LancheNaFila) => new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' }).format(new Date(l.abertoEm ?? l.fechouEm ?? 0));

  if (lista.length === 0) {
    if (filtro === 'conferidos') {
      return (
        <Vazio icone={ClipboardList} titulo="Nenhum lanche conferido ainda">
          Os lanches que alguém conferir aparecem aqui, com o que o Farol tinha achado.
        </Vazio>
      );
    }
    if (filtro === 'pulados') {
      return (
        <Vazio icone={ClipboardList} titulo="Nenhum lanche pulado">
          Quando você pular um lanche na conferência, ele espera aqui.
        </Vazio>
      );
    }
    const lendo = gravacoes.find((g) => g.situacao === 'lendo');
    return lendo ? (
      <Vazio icone={Clock} titulo="Nada para conferir ainda">
        A gravação de {quandoDaGravacao(lendo.inicio, lendo.fim, fuso)} está sendo lida no computador da loja
        {lendo.progresso !== null ? ` (${lendo.progresso}%)` : ''}. Os lanches aparecem aqui quando a leitura terminar.
      </Vazio>
    ) : (
      <Vazio icone={GraduationCap} titulo="Tudo conferido">
        Não há lanche esperando conferência. Os próximos chegam com a próxima gravação de treino.
      </Vazio>
    );
  }

  return (
    <>
      {filtro === 'conferir' && <p className={AJUDA}>Primeiro os lanches em que o Farol tem mais dúvida: é onde a sua conferência ensina mais.</p>}
      {filtro === 'conferidos' && conferidosAoTodo > lista.length && (
        <p className={AJUDA}>Os {numero(lista.length)} conferidos mais recentes; os números contam todos.</p>
      )}
      <ul className={`${CARTAO} divide-y divide-farol-borda overflow-hidden`} aria-label={filtro === 'conferir' ? 'Lanches para conferir' : filtro === 'pulados' ? 'Lanches pulados' : 'Lanches conferidos'} data-lanches={filtro}>
        {lista.map((l) => {
          // antes da identificação dos ingredientes, nenhuma etapa tem leitura: não é "uma etapa", é o lanche todo
          const motivo = l.semLeitura ? SEM_LEITURA : MOTIVO[l.motivo];
          const certo = l.acertou === true;
          return (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => aoAbrir(l)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-farol-painel-2 focus-visible:bg-farol-painel-2 max-sm:px-3"
                data-linha-do-lanche={l.id}
              >
                <span className="flex shrink-0 gap-1.5" aria-hidden>
                  <Miniatura quadroId={l.miniaturas.tampo} rotulo="tampo" />
                  <Miniatura quadroId={l.miniaturas.base} rotulo="base" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5 md:flex-row md:items-center md:gap-4">
                  <span className="flex min-w-0 flex-col md:flex-[1.1_1_0%]">
                    <b className="break-words font-semibold">
                      Lanche das {hora(l)}
                      {l.situacao === 'conferido' ? ` · ${l.produto ?? 'não era lanche'}` : ''}
                    </b>
                    <small className="break-words text-xs text-farol-suave">
                      {deQual(l)}
                      {l.situacao === 'conferido' && l.conferidoPor ? ` · conferido por ${l.conferidoPor}` : ''}
                    </small>
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-1.5 md:flex-[1.5_1_0%]">
                    {l.situacao === 'conferido' ? (
                      certo ? (
                        <Chip tom="ok">o Farol acertou</Chip>
                      ) : (
                        <Chip tom="critico" quebra>
                          {l.palpite ? `o Farol achou ${l.palpite.produto}` : 'o Farol não tinha palpite'}
                        </Chip>
                      )
                    ) : (
                      <>
                        <Chip quebra>{l.palpite ? `o Farol acha: ${l.palpite.produto}` : 'sem palpite'}</Chip>
                        <Chip tom={motivo.tom} quebra>
                          {motivo.texto}
                        </Chip>
                      </>
                    )}
                  </span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-farol-suave" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ───────────────────────── os ingredientes ─────────────────────────

function PainelDosIngredientes({
  ingredientes,
  daBancada,
  aprendido,
  filtro,
  aoFiltrar,
  aoAbrir,
  aoAbrirOrfao,
  lojaId,
}: {
  ingredientes: IngredientesDaLoja | null;
  daBancada: IngredienteDaLoja[];
  aprendido: Map<string, { presente: number; reconheceu: number }>;
  filtro: FiltroDosIngredientes;
  aoFiltrar: (f: FiltroDosIngredientes) => void;
  aoAbrir: (nome: string) => void;
  aoAbrirOrfao: (itemId: string) => void;
  lojaId: string;
}) {
  if (!ingredientes) {
    return (
      <Alerta tom="neutro" icone={Info}>
        A lista dos ingredientes não veio agora. A conferência dos lanches continua normalmente.
      </Alerta>
    );
  }
  const semEx = daBancada.filter((i) => i.visivel && i.exemplos === 0);
  const semFoto = daBancada.filter((i) => i.visivel && i.fotos.length === 0);
  const lista = filtro === 'semex' ? semEx : filtro === 'semfoto' ? semFoto : daBancada;
  const orfaos = ingredientes.orfaos;

  return (
    <>
      {orfaos.length > 0 && (
        <Alerta tom="atencao" icone={Info} papel="status">
          <b className="font-semibold">
            {plural(orfaos.length, 'ingrediente que saiu das fichas ainda tem fotos', 'ingredientes que saíram das fichas ainda têm fotos')}:
          </b>{' '}
          {orfaos.map((o) => o.nome).join(', ')}.{' '}
          <Botao mini onClick={() => aoAbrirOrfao(orfaos[0]!.itemId)}>
            Ver
          </Botao>
        </Alerta>
      )}
      {daBancada.length === 0 ? (
        <Vazio
          icone={ClipboardList}
          titulo="Nenhum ingrediente ainda"
          acao={
            <Link href={`/lojas/${lojaId}/fichas`} className={classesDoBotao()}>
              Ir para Fichas
            </Link>
          }
        >
          Os ingredientes aparecem aqui quando o primeiro lanche desta bancada for conferido. As fotos de referência de cada ingrediente ficam em Fichas.
        </Vazio>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmentado
              rotulo="Quais ingredientes"
              valor={filtro}
              aoMudar={aoFiltrar}
              opcoes={[
                { valor: 'todos', rotulo: `Todos ${numero(daBancada.length)}` },
                { valor: 'semex', rotulo: `Sem exemplo ${numero(semEx.length)}` },
                { valor: 'semfoto', rotulo: `Sem foto ${numero(semFoto.length)}` },
              ]}
            />
          </div>
          {lista.length === 0 ? (
            <Vazio icone={ClipboardList} titulo="Nenhum ingrediente com esse filtro" acao={<Botao onClick={() => aoFiltrar('todos')}>Ver todos</Botao>}>
              Volte a ver todos.
            </Vazio>
          ) : (
            <ul className={`${CARTAO} divide-y divide-farol-borda overflow-hidden`} aria-label="Ingredientes desta bancada" data-ingredientes-da-bancada>
              {lista.map((i) => {
                const a = aprendido.get(chaveDoIngrediente(i.nome)) ?? { presente: 0, reconheceu: 0 };
                const estado: { tom: Tom; texto: string } = !i.visivel
                  ? { tom: 'neutro', texto: 'não se vê de cima' }
                  : i.exemplos === 0
                    ? { tom: 'critico', texto: 'sem exemplo' }
                    : a.presente >= RECONHECE.minimo && a.reconheceu / a.presente >= RECONHECE.parte
                      ? { tom: 'ok', texto: `reconhece: ${a.reconheceu} de ${a.presente}` }
                      : { tom: 'atencao', texto: `aprendendo: ${a.reconheceu} de ${a.presente}` };
                return (
                  <li key={i.nome}>
                    <button
                      type="button"
                      onClick={() => aoAbrir(i.nome)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-farol-painel-2 focus-visible:bg-farol-painel-2 max-sm:px-3"
                      data-linha-do-ingrediente={i.nome}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1.5 md:flex-row md:items-center md:gap-4">
                        <span className="flex min-w-0 flex-col md:flex-[1.2_1_0%]">
                          <b className="break-words font-semibold">{i.nome}</b>
                          <small className="break-words text-xs text-farol-suave">
                            {i.produtos.map((p) => (p.adicional ? `${p.produto} (adicional)` : p.produto)).join(', ')}
                          </small>
                        </span>
                        <span className="flex min-w-0 flex-wrap gap-1.5 md:flex-[1_1_0%]">
                          <Chip>{i.fotos.length ? plural(i.fotos.length, 'foto', 'fotos') : 'sem foto'}</Chip>
                          <Chip>{plural(i.exemplos, 'exemplo', 'exemplos')}</Chip>
                          <Chip tom={estado.tom}>{estado.texto}</Chip>
                        </span>
                      </span>
                      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-farol-suave" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className={AJUDA}>
            Os ingredientes dos lanches que já passaram por esta bancada. Outro ingrediente da loja entra aqui quando um lanche que o leva for conferido
            nela.
          </p>
        </>
      )}
    </>
  );
}

// ───────────────────────── as gravações ─────────────────────────

function LinhaDaGravacao({
  g,
  fuso,
  podeConfigurar,
  cancelando,
  aoConferir,
  aoCancelar,
  aoApagar,
}: {
  g: GravacaoDeTreino;
  fuso: string;
  podeConfigurar: boolean;
  cancelando: boolean;
  aoConferir: () => void;
  aoCancelar: () => void;
  aoApagar: () => void;
}) {
  const s = situacaoDaGravacao(g);
  const deOnde = [ORIGEM[g.origem], g.canal ? (g.canal.numero !== null ? `${g.canal.nome} · canal ${g.canal.numero}` : g.canal.nome) : null].filter(Boolean).join(' · ');
  // do protótipo: cancela-se o que ainda não começou; apagam-se as imagens da gravação já conferida
  const cancela = podeConfigurar && (g.situacao === 'programada' || g.situacao === 'fila');
  const apaga = podeConfigurar && g.situacao === 'pronta' && g.lanches > 0 && g.conferidos === g.lanches;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 max-sm:px-3" data-gravacao={g.id}>
      <span className="flex min-w-0 flex-[1_1_220px] flex-col">
        <b className="break-words font-semibold">{quandoDaGravacao(g.inicio, g.fim, fuso)}</b>
        <small className="break-words text-xs text-farol-suave">{deOnde}</small>
      </span>
      <span className="flex min-w-0 flex-[1_1_200px] flex-wrap items-center gap-2">
        <Chip tom={s.tom}>{s.texto}</Chip>
        {g.situacao === 'lendo' && g.progresso !== null && (
          <progress className="h-2 w-24 overflow-hidden rounded-full" max={100} value={g.progresso} aria-label="Leitura da gravação">
            {g.progresso}%
          </progress>
        )}
        {s.sobre && <span className="break-words font-mono text-xs text-farol-suave">{s.sobre}</span>}
      </span>
      {(g.situacao === 'pronta' && g.lanches > g.conferidos) || cancela || apaga ? (
        <span className="flex flex-wrap gap-2">
          {g.situacao === 'pronta' && g.lanches > g.conferidos && (
            <Botao mini onClick={aoConferir}>
              Conferir
            </Botao>
          )}
          {cancela && (
            <Botao mini onClick={aoCancelar} ocupado={cancelando}>
              Cancelar
            </Botao>
          )}
          {apaga && (
            <Botao mini variante="perigo-leve" onClick={aoApagar}>
              Apagar as imagens
            </Botao>
          )}
        </span>
      ) : null}
    </li>
  );
}
