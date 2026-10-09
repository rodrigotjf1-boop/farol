'use client';

/**
 * O canal — a imagem completa, os quadros e os critérios de cada um.
 *
 * As palavras são as do dono: o CANAL é a câmera; a IMAGEM COMPLETA é o
 * canal inteiro, e os critérios dela são os gerais; o QUADRO é um recorte
 * marcado dentro da imagem, com nome e papel, e tem os seus critérios.
 *
 * À esquerda, a imagem com os quadros numerados e a CENA do canal (o que a
 * câmera vê e de onde olha, escrito por quem configura). À direita, a
 * árvore: onde cada critério vale.
 *
 * Esta tela não desenha contorno: isso é na tela do desenho
 * (`/pontos/:id/area`), que continua com as fotos padrão, as medidas e a
 * conexão do canal.
 */

import { ArrowLeft, CircleMinus, PencilRuler, Plus, RefreshCw, ScanEye, TriangleAlert, VideoOff } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ArvoreDoCanal } from '@/componentes/canal/arvore-do-canal';
import { CartaoDaCena } from '@/componentes/canal/cartao-da-cena';
import { GavetaDoQuadro } from '@/componentes/canal/gaveta-do-quadro';
import { ImagemDoCanal, sobrepostos, type QuadroNaImagem } from '@/componentes/canal/imagem-do-canal';
import { MAX_QUADROS, nomeParaQuadroNovo, SABE_BANCADA } from '@/componentes/canal/quadros';
import { useConsole } from '@/componentes/console';
import { GavetaDoCriterio } from '@/componentes/criterios/formulario-criterio';
import { desdeAHora, diaEHora, plural } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Ponto as PontoDeEstado, Titulo } from '@/componentes/ui/pecas';
import {
  consoleApi,
  ErroDaApi,
  previewApi,
  regrasApi,
  resultadosApi,
  type AgenteResumo,
  type EstadoDoPreview,
  type PontoCompleto,
  type Regra,
  type Setor,
  type Sinal,
  type ZonaCompleta,
} from '@/lib/api';

/** O que a tela precisa da loja do canal: para a gaveta de critério e para dizer o que o agente já sabe. */
type DaLoja = { setores: Setor[]; agentes: AgenteResumo[]; regras: Regra[]; objetos: string[] };

/** A gaveta de critério aberta: criando num lugar, ou editando um que existe. */
type CriterioAberto = { chave: string; regra?: Regra; zonaId: string };

export default function Canal() {
  const { id } = useParams<{ id: string }>();
  const { loja, saude, configura, veResultados, definirLoja, atualizar } = useConsole();
  const avisar = useAvisar();

  const [ponto, setPonto] = useState<PontoCompleto | null>(null);
  const [zonas, setZonas] = useState<ZonaCompleta[]>([]);
  const [estado, setEstado] = useState<EstadoDoPreview | null>(null);
  const [daLoja, setDaLoja] = useState<DaLoja | null>(null);
  const [sinais, setSinais] = useState<Sinal[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);

  /** A área em destaque na imagem e na árvore. Vazio = a imagem completa. */
  const [sel, setSel] = useState('');
  const [criandoQuadro, setCriandoQuadro] = useState(false);
  const [quadroAberto, setQuadroAberto] = useState<{ id: string; paraExcluir: boolean } | null>(null);
  const [criterio, setCriterio] = useState<CriterioAberto | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [dados, est] = await Promise.all([previewApi.ponto(id), previewApi.estado(id)]);
      setPonto(dados.ponto);
      setZonas(dados.zonas);
      setEstado(est);
      setErro(null);
      return dados;
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui carregar o canal');
      return null;
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O endereço desta tela não diz de que loja é o canal. A moldura precisa
  // saber, para mostrar a loja certa e marcar "Canais" na navegação.
  const lojaDoCanal = ponto?.loja_id ?? null;
  useEffect(() => {
    if (lojaDoCanal) definirLoja(lojaDoCanal);
  }, [lojaDoCanal, definirLoja]);

  // Os setores, os agentes e os critérios da loja: a gaveta de critério
  // precisa deles, e é pelos agentes que a tela sabe o que a loja já faz.
  // Falhar aqui não derruba a tela do canal: só o que depende disso espera.
  const carregarLoja = useCallback(async () => {
    if (!lojaDoCanal) return;
    try {
      const [l, r] = await Promise.all([consoleApi.loja(lojaDoCanal), regrasApi.listar(lojaDoCanal)]);
      setDaLoja({ setores: l.setores, agentes: l.agentes, regras: r.regras, objetos: r.detector?.objetos ?? [] });
    } catch {
      setDaLoja(null);
    }
  }, [lojaDoCanal]);

  useEffect(() => {
    void carregarLoja();
  }, [carregarLoja]);

  // Qual câmera está sem imagem: os mesmos sinais do painel. Se não vier
  // (perfil sem acesso, rede), a tela só deixa de afirmar.
  useEffect(() => {
    if (!lojaDoCanal || !veResultados) return;
    let vivo = true;
    resultadosApi
      .obter(lojaDoCanal, '24h')
      .then((r) => vivo && setSinais(r.sinais))
      .catch(() => vivo && setSinais(null));
    return () => {
      vivo = false;
    };
  }, [lojaDoCanal, veResultados]);

  // Enquanto há pedido de quadro em voo, pergunta o estado de tempos em
  // tempos. Para sozinho quando conclui, falha ou expira.
  const emVoo = estado?.pedido?.estado === 'pendente' || estado?.pedido?.estado === 'entregue';
  useEffect(() => {
    if (!emVoo) return;
    const t = setInterval(() => void carregar(), 2000);
    return () => clearInterval(t);
  }, [emVoo, carregar]);

  const inteira = zonas.find((z) => z.principal) ?? null;
  const quadros = useMemo(() => zonas.filter((z) => !z.principal), [zonas]);
  // A área selecionada pode ter sido excluída: volta para a imagem completa.
  const selecionada = zonas.some((z) => z.id === sel) ? sel : (inteira?.id ?? '');

  const naImagem: QuadroNaImagem[] = useMemo(
    () => quadros.filter((z) => z.numero != null && z.poligono.length >= 3).map((z) => ({ id: z.id, numero: z.numero!, nome: z.nome, pontos: z.poligono })),
    [quadros],
  );
  const pares = useMemo(() => sobrepostos(naImagem), [naImagem]);

  /** Depois de mexer: o canal, a loja, a moldura e o que estava guardado do painel. */
  async function depoisDeMexer(mensagem: string) {
    if (lojaDoCanal) resultadosApi.esquecer(lojaDoCanal);
    atualizar();
    await Promise.all([carregar(), carregarLoja()]);
    avisar(mensagem);
  }

  async function pedirQuadro() {
    setPedindo(true);
    setErro(null);
    setRecado(null);
    try {
      const r = await previewApi.pedir(id);
      setRecado(
        r.jaPedido
          ? 'Já havia um pedido em andamento. Esperando a loja responder.'
          : 'Quadro pedido ao agente da loja. Ele responde na próxima batida.',
      );
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui pedir o quadro');
    } finally {
      setPedindo(false);
    }
  }

  async function novoQuadro() {
    setCriandoQuadro(true);
    setErro(null);
    try {
      const novo = await previewApi.criarArea(id, { nome: nomeParaQuadroNovo(zonas.map((z) => z.nome)) });
      if (lojaDoCanal) resultadosApi.esquecer(lojaDoCanal);
      atualizar();
      await carregar();
      setSel(novo.id);
      // O nome e o papel são a primeira coisa a acertar: "Quadro novo" não diz nada a ninguém.
      setQuadroAberto({ id: novo.id, paraExcluir: false });
      avisar('Quadro criado no meio da imagem. Dê um nome e um papel; o contorno se ajusta em “Redesenhar o contorno”.');
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui criar o quadro');
    } finally {
      setCriandoQuadro(false);
    }
  }

  function abrirCriterio(zonaId: string, criterioId?: string) {
    setErro(null);
    if (!daLoja) {
      // A gaveta precisa dos setores e dos critérios da loja, e eles não chegaram: tenta de novo e diz.
      void carregarLoja();
      setErro('Os dados da loja ainda não chegaram. Tente de novo em instantes.');
      return;
    }
    const regra = criterioId ? daLoja.regras.find((r) => r.id === criterioId) : undefined;
    if (criterioId && !regra) {
      // O critério acabou de ser excluído em outra aba, ou a lista está velha.
      void carregarLoja();
      setErro('Não consegui abrir este critério agora. Tente de novo em instantes.');
      return;
    }
    setSel(zonaId);
    setCriterio({ chave: `${criterioId ?? 'novo'}-${zonaId}-${Date.now()}`, regra, zonaId });
  }

  // ───────────────────────── o que o cabeçalho afirma ─────────────────────────

  const todosOsCriterios = zonas.flatMap((z) => z.criterios);
  const gerais = inteira?.criterios.length ?? 0;
  const total = todosOsCriterios.length;
  const semImagem =
    saude?.estado === 'ativo' && ponto ? sinais?.find((s) => s.tipo === 'canal_sem_imagem' && s.pontoId === ponto.id) : undefined;
  const sabeDaImagem = sinais !== null && saude?.estado === 'ativo';
  const ligados = todosOsCriterios.filter((k) => k.ativa);

  // "Olhando agora" só quando é verdade: o agente está vivo, o canal está
  // ativo e há critério ligado que vale no horário de agora. Critério com
  // faixa de horas própria não entra na conta — a tela não sabe se a faixa
  // é agora, e prefere não afirmar. Nem o que está parado por falta da
  // cena: esse o agente tira da olhada.
  const aberta = loja?.aberta_agora ?? null;
  const semFaixaPropria = new Set((daLoja?.regras ?? []).filter((r) => r.janelas.length === 0).map((r) => r.id));
  const olhandoAgora =
    saude?.estado === 'ativo' &&
    ponto?.ativo === true &&
    ligados.some(
      (k) =>
        !k.falta_a_cena &&
        semFaixaPropria.has(k.id) &&
        (k.quando === 'sempre' || (k.quando === 'no_horario' && aberta !== false) || (k.quando === 'fora_do_horario' && aberta === false)),
    );

  // O agente da loja já sabe a regra do quadro de bancada? Vale o que o
  // agente ATIVO declarou; sem agente que tenha dito, não se sabe.
  const agentesQueDisseram = (daLoja?.agentes ?? []).filter((a) => a.estado === 'ativo' && a.sabe_em);
  const agenteSabeBancada = agentesQueDisseram.length === 0 ? null : agentesQueDisseram.some((a) => a.sabe?.includes(SABE_BANCADA));

  const zonaDoQuadroAberto = quadroAberto ? (zonas.find((z) => z.id === quadroAberto.id && !z.principal) ?? null) : null;
  const fuso = loja?.timezone ?? 'America/Sao_Paulo';

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Link
              href={ponto ? `/lojas/${ponto.loja_id}/canais` : '/lojas'}
              className="inline-flex items-center gap-1 no-underline hover:text-farol-tinta"
            >
              <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
              Canais
            </Link>
            {ponto && <span>· {ponto.setor_nome}</span>}
          </>
        }
        titulo={ponto?.nome ?? 'Canal'}
        acoes={
          ponto && (
            <>
              <Link href={`/pontos/${ponto.id}/area`} className={classesDoBotao()}>
                <PencilRuler className="h-[18px] w-[18px]" aria-hidden />
                Desenho, fotos e conexão
              </Link>
              {configura && (
                <Botao onClick={pedirQuadro} ocupado={pedindo || emVoo} disabled={!ponto.ativo} title={ponto.ativo ? undefined : 'Canal pausado: o agente não captura quadro dele'}>
                  {!(pedindo || emVoo) && <RefreshCw className="h-[18px] w-[18px]" aria-hidden />}
                  {pedindo ? 'Pedindo…' : emVoo ? 'Esperando a loja…' : 'Atualizar quadro'}
                </Botao>
              )}
            </>
          )
        }
      />

      {ponto && (
        <div className="-mt-2.5 flex flex-wrap items-center gap-1.5" data-situacao-do-canal>
          <Chip tom="vazado">
            <span className="font-mono">
              {ponto.canal != null ? `canal ${ponto.canal}` : 'sem número'} · {ponto.origem === 'dvr' ? 'gravador' : 'câmera IP'}
            </span>
          </Chip>
          {!ponto.ativo ? (
            <Chip tom="atencao" icone={CircleMinus}>
              pausado
            </Chip>
          ) : semImagem ? (
            <Chip tom="critico" icone={VideoOff}>
              sem imagem {desdeAHora(semImagem.desde, fuso) ?? ''}
            </Chip>
          ) : sabeDaImagem && ligados.length > 0 ? (
            <Chip tom="ok">
              <PontoDeEstado tom="ok" />
              com imagem
            </Chip>
          ) : null}
          {olhandoAgora && (
            <Chip tom="atencao" icone={ScanEye}>
              olhando agora
            </Chip>
          )}
        </div>
      )}

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
          {!ponto && (
            <button type="button" onClick={() => void carregar()} className="elo ml-2 text-[13px]">
              Tentar de novo
            </button>
          )}
        </Alerta>
      )}
      {recado && (
        <Alerta papel="status" icone={RefreshCw}>
          {recado}
        </Alerta>
      )}

      {!ponto && !erro && <Ossos alturas={[26, [360, 360]]} />}

      {ponto && !inteira && (
        <Alerta tom="critico" papel="alert" icone={TriangleAlert}>
          Este canal está sem a imagem completa dele, e por isso a tela não tem o que mostrar. Não é configuração sua:
          avise o suporte do Farol.
        </Alerta>
      )}

      {ponto && inteira && (
        <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:items-start">
          {/* Numa coluna só, a ordem de leitura é: o canal, a árvore, a cena. */}
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-5">
            {/* ─────────────────────── o canal e os quadros ─────────────────────── */}
            <section aria-labelledby="t-quadros" className={`${CARTAO} order-1 flex flex-col xl:order-none`}>
              <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-farol-borda px-4 py-3.5">
                <Titulo id="t-quadros">O canal e os quadros</Titulo>
                {estado?.capturadoEm && (
                  <span className="ml-auto font-mono text-[12.5px] text-farol-suave" title="Quando a imagem foi capturada na loja">
                    {diaEHora(estado.capturadoEm)}
                  </span>
                )}
              </header>
              <div className="flex flex-col gap-3.5 p-4">
                <ImagemDoCanal
                  src={estado?.temPreview ? previewApi.url(id, estado.capturadoEm) : null}
                  alt={`Imagem do canal ${ponto.nome}, com ${plural(quadros.length, 'quadro marcado', 'quadros marcados')}`}
                  quadros={naImagem}
                  idDaInteira={inteira.id}
                  selecionada={selecionada}
                  aoSelecionar={setSel}
                  semImagem={
                    <>
                      <b className="font-semibold text-farol-palco-tinta">Este canal ainda não tem imagem</b>
                      <span>
                        A imagem é capturada pelo agente instalado na loja. Use <strong>Atualizar quadro</strong> e ele
                        responde na próxima batida.
                      </span>
                    </>
                  }
                />

                {estado?.pedido?.estado === 'falhou' && (
                  <Alerta tom="critico" papel="alert" icone={TriangleAlert}>
                    O último pedido de quadro falhou: {estado.pedido.erro}
                  </Alerta>
                )}
                {estado?.pedido?.estado === 'expirado' && (
                  <Alerta tom="critico" papel="alert" icone={TriangleAlert}>
                    O último pedido de quadro expirou sem a loja buscar. O agente está desligado?
                  </Alerta>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-[13px] text-farol-suave" data-contagem-do-canal>
                    {plural(quadros.length, 'quadro', 'quadros')} · {plural(total, 'critério', 'critérios')}
                    {total > 0 && ` — ${gerais} ${gerais === 1 ? 'geral' : 'gerais'}, ${total - gerais} em quadros`}
                  </span>
                  {configura && (
                    <Botao
                      mini
                      className="ml-auto"
                      onClick={novoQuadro}
                      ocupado={criandoQuadro}
                      disabled={quadros.length >= MAX_QUADROS}
                      title={quadros.length >= MAX_QUADROS ? `Um canal tem no máximo ${MAX_QUADROS} quadros` : undefined}
                    >
                      {!criandoQuadro && <Plus className="h-[15px] w-[15px]" aria-hidden />}
                      {criandoQuadro ? 'Criando…' : 'Quadro'}
                    </Botao>
                  )}
                </div>

                {pares.length > 0 && (
                  <p className="text-[13px] text-farol-suave" data-sobrepostos>
                    Os quadros {pares.map(([a, b]) => `${a.numero} e ${b.numero}`).join('; ')} se sobrepõem (a faixa riscada). Cada
                    critério vale só no quadro em que foi posto.
                  </p>
                )}
              </div>
            </section>

            {/* A chave remonta o cartão quando a cena guardada muda: os campos voltam ao que o servidor tem. */}
            <CartaoDaCena
              key={`${ponto.cena}|${ponto.loja_tipo_negocio}`}
              ponto={ponto}
              configura={configura}
              aoSalvar={depoisDeMexer}
              className="order-3 xl:order-none"
            />
          </div>

          {/* ─────────────────────── onde cada critério vale ─────────────────────── */}
          <section aria-labelledby="t-arvore" className={`${CARTAO} order-2 flex min-w-0 flex-col xl:order-none`}>
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-farol-borda px-4 py-3.5">
              <Titulo id="t-arvore">Onde cada critério vale</Titulo>
            </header>
            <div className="p-4">
              <ArvoreDoCanal
                zonas={zonas}
                selecionada={selecionada}
                aoSelecionar={setSel}
                configura={configura}
                canalAtivo={ponto.ativo}
                aoAbrirCriterio={(criterioId, zonaId) => abrirCriterio(zonaId, criterioId)}
                aoNovoCriterio={(zonaId) => abrirCriterio(zonaId)}
                aoEditarQuadro={(zonaId, paraExcluir = false) => {
                  setSel(zonaId);
                  setQuadroAberto({ id: zonaId, paraExcluir });
                }}
                aoNovoQuadro={novoQuadro}
                criandoQuadro={criandoQuadro}
              />
            </div>
          </section>
        </div>
      )}

      {zonaDoQuadroAberto && ponto && (
        <GavetaDoQuadro
          // A chave remonta a gaveta quando se troca de quadro: sem ela os
          // campos ficariam com os valores do anterior.
          key={`${zonaDoQuadroAberto.id}-${quadroAberto?.paraExcluir ? 'x' : 'e'}`}
          ponto={ponto}
          zona={zonaDoQuadroAberto}
          paraExcluir={quadroAberto?.paraExcluir ?? false}
          agenteSabeBancada={agenteSabeBancada}
          aoFechar={() => setQuadroAberto(null)}
          aoSalvar={async (mensagem) => {
            setQuadroAberto(null);
            await depoisDeMexer(mensagem);
          }}
        />
      )}

      {criterio && ponto && daLoja && (
        <GavetaDoCriterio
          key={criterio.chave}
          lojaId={ponto.loja_id}
          setores={daLoja.setores}
          regra={criterio.regra}
          marcadasDeInicio={[criterio.zonaId]}
          objetosDoDetector={daLoja.objetos}
          horarioDaLoja={loja?.horario_funcionamento ?? []}
          aoFechar={() => setCriterio(null)}
          aoSalvar={async (mensagem) => {
            setCriterio(null);
            await depoisDeMexer(mensagem);
          }}
        />
      )}
    </>
  );
}
