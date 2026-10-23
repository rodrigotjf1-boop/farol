'use client';

// =====================================================================
// Planta da loja — os ambientes, os equipamentos e cada câmera no lugar
// =====================================================================
// Serve para três coisas: achar ONDE cada coisa acontece; ver o que
// nenhuma câmera cobre; e dar ao julgamento a descrição do lugar (a frase
// de cada câmera vai junto com a análise do canal que sobe à nuvem).
//
// A planta é feita de retângulos em metros — é o que permite a conta de
// cobertura e a descrição automática. Edita-se de cima, tudo de uma vez:
// "Concluir edição" salva a planta inteira, "Descartar mudanças" volta ao
// que está guardado. Quem salva diz a versão que leu; se outra pessoa
// salvou no meio, nada é gravado e a tela avisa.
// =====================================================================

import { Box, Check, Map as IconeDeMapa, Pencil, Plus, Rotate3d, Square, Store } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { emOrdem } from '@/componentes/criterios/canais';
import { DesenhoDaPlanta, type Camada, type Ferramenta, type Retangulo, type Selecao } from '@/componentes/planta/desenho';
import { PainelDaPlanta, type CanalNaPlanta } from '@/componentes/planta/painel';
import { cobre, numeroDoCanal, situacaoDoCanal } from '@/componentes/planta/situacao';
import { abasDeCanais } from '@/componentes/pontos/abas-de-canais';
import { Abas } from '@/componentes/ui/abas';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Segmentado, Titulo, Vazio } from '@/componentes/ui/pecas';
import {
  consoleApi,
  ErroDaApi,
  inventarioApi,
  plantaApi,
  regrasApi,
  resultadosApi,
  type Equipamento,
  type Regra,
  type Resultados,
  type Setor,
} from '@/lib/api';
import { CAMERA_NOVA, centroDe, coberturaDaPlanta, LIMITES, mesmaPlanta, PLANTA_VAZIA, type Planta } from '@/lib/planta';

type Vista = 'perspectiva' | 'cima' | '3d';

// A vista em 3D (planta viva, degrau 1) traz a biblioteca 3D: só carrega quando alguém a escolhe, e só no navegador.
const Vista3D = dynamic(() => import('@/componentes/planta/vista-3d').then((m) => m.Vista3D), {
  ssr: false,
  loading: () => <div className="osso aspect-[16/11] max-w-full rounded-xl max-md:aspect-[4/3.4]" aria-hidden />,
});

/** O que a legenda explica, em cada camada. */
const BOLINHA = 'h-3 w-3 shrink-0 rounded-full';
const LEGENDA = {
  ok: `${BOLINHA} shadow-[inset_0_0_0_2px_rgb(var(--ok))]`,
  alerta: `${BOLINHA} bg-farol-critico-leve shadow-[inset_0_0_0_2px_rgb(var(--critico))]`,
  neutro: `${BOLINHA} shadow-[inset_0_0_0_2px_rgb(var(--suave))]`,
  traco: `${BOLINHA} border-2 border-dashed border-farol-suave`,
  cego: 'h-3 w-3 shrink-0 rounded-[3px] bg-farol-critico/25',
};

const novoId = (prefixo: string): string => `${prefixo}-${Math.random().toString(36).slice(2, 10)}`;

export default function PlantaDaLoja() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura, veResultados, saude } = useConsole();
  const avisar = useAvisar();

  // o que está guardado
  const [guardada, setGuardada] = useState<Planta | null | undefined>(undefined); // undefined = carregando
  const [versao, setVersao] = useState<number | null>(null);
  const [lugares, setLugares] = useState<Record<string, string>>({});
  const [setores, setSetores] = useState<Setor[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [itens, setItens] = useState<Equipamento[]>([]);
  const [resultados, setResultados] = useState<Resultados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // o que a tela mostra
  const [vista, setVista] = useState<Vista>('perspectiva');
  const [t, setT] = useState(1);
  const [camada, setCamada] = useState<Camada>('situacao');
  const [selecao, setSelecao] = useState<Selecao | null>(null);

  // a edição
  const [rascunho, setRascunho] = useState<Planta | null>(null); // não nulo = editando
  const [ferramenta, setFerramenta] = useState<Ferramenta>('');
  const [recemCriado, setRecemCriado] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const vistaAntes = useRef<Vista>('perspectiva');
  const animacao = useRef<number | null>(null);

  const editando = rascunho !== null;
  const planta = rascunho ?? guardada ?? PLANTA_VAZIA;

  const carregar = useCallback(async () => {
    try {
      const [p, l, r, inv] = await Promise.all([plantaApi.obter(id), consoleApi.loja(id), regrasApi.listar(id), inventarioApi.listar(id)]);
      setGuardada(p.planta);
      setVersao(p.versao);
      setLugares(p.lugares);
      setSetores(l.setores);
      setRegras(r.regras);
      setItens(inv.itens);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui carregar a planta');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // A situação de agora: os mesmos sinais e ocorrências do painel, de minuto
  // em minuto. Perfil que não vê resultados fica sem — e a planta não afirma.
  useEffect(() => {
    if (!veResultados) return;
    let vivo = true;
    const buscar = (forcar: boolean) =>
      resultadosApi
        .obter(id, '24h', forcar)
        .then((r) => vivo && setResultados(r))
        .catch(() => vivo && setResultados(null));
    void buscar(false);
    const relogio = setInterval(() => {
      if (document.visibilityState === 'visible') void buscar(true);
    }, 60_000);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, [id, veResultados]);

  // Em tela estreita a planta começa vista de cima: em perspectiva as câmeras
  // ficam umas sobre as outras. Vale só na chegada; depois, quem escolhe a
  // vista é quem está olhando.
  useEffect(() => {
    if (window.innerWidth < 640) {
      setVista('cima');
      setT(0);
    }
  }, []);

  // Sair com a edição aberta e mudança por salvar: o navegador pergunta.
  const mudou = editando && !mesmaPlanta(rascunho, guardada ?? PLANTA_VAZIA);
  useEffect(() => {
    if (!mudou) return;
    const perguntar = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener('beforeunload', perguntar);
    return () => window.removeEventListener('beforeunload', perguntar);
  }, [mudou]);

  /** Vai de uma vista para a outra girando a planta. O 3D é outro desenho: troca sem girar. */
  const girar = useCallback((para: Vista) => {
    setVista(para);
    if (para === '3d') return;
    const alvo = para === 'perspectiva' ? 1 : 0;
    if (animacao.current !== null) cancelAnimationFrame(animacao.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setT(alvo);
      return;
    }
    let de: number | null = null;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const k = Math.min(1, (agora - inicio) / 520);
      setT((atual) => {
        de ??= atual;
        return de + (alvo - de) * (1 - (1 - k) ** 3);
      });
      animacao.current = k < 1 ? requestAnimationFrame(passo) : null;
    };
    animacao.current = requestAnimationFrame(passo);
  }, []);
  useEffect(() => () => void (animacao.current !== null && cancelAnimationFrame(animacao.current)), []);

  // ───────────────────────── o que se sabe de cada canal ─────────────────────────

  const canais = useMemo(() => {
    const mapa = new Map<string, CanalNaPlanta>();
    const sabe = {
      regras,
      sinais: resultados?.sinais ?? null,
      ocorrencias: resultados?.ocorrencias ?? null,
      agora: resultados?.agora ?? null,
      fuso: resultados?.loja.timezone ?? 'America/Sao_Paulo',
      abertaAgora: loja?.aberta_agora ?? null,
      agenteAtivo: saude?.estado === 'ativo',
    };
    for (const s of setores) for (const p of s.pontos) mapa.set(p.id, { ponto: p, situacao: situacaoDoCanal(p, sabe), setorNome: s.nome });
    return mapa;
  }, [setores, regras, resultados, loja?.aberta_agora, saude?.estado]);

  const naPlanta = useMemo(() => new Set(planta.cameras.map((c) => c.pontoId)), [planta.cameras]);
  const itemDe = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens]);
  const cobertura = camada === 'cobertura' && !editando;
  const porAmbiente = useMemo(
    () => (cobertura ? coberturaDaPlanta(planta, (cam) => cobre(canais.get(cam.pontoId)?.situacao)) : []),
    [cobertura, planta, canais],
  );

  // ───────────────────────── a edição ─────────────────────────

  function editar() {
    vistaAntes.current = vista;
    setRascunho(guardada ?? PLANTA_VAZIA);
    setFerramenta('');
    setErroAoSalvar(null);
    girar('cima');
  }

  function sairDaEdicao() {
    setRascunho(null);
    setFerramenta('');
    setRecemCriado(null);
    setErroAoSalvar(null);
    girar(vistaAntes.current);
  }

  async function concluir() {
    if (!rascunho) return;
    setSalvando(true);
    setErroAoSalvar(null);
    try {
      const r = await plantaApi.salvar(id, rascunho, versao);
      setGuardada(r.planta);
      setVersao(r.versao);
      setLugares(r.lugares);
      sairDaEdicao();
      avisar('Planta salva. A descrição do lugar de cada canal foi refeita.');
    } catch (e) {
      // O erro fica na tela, com a edição aberta: fechar esconderia que nada foi salvo.
      setErroAoSalvar(e instanceof ErroDaApi ? e.message : 'não consegui salvar a planta');
    } finally {
      setSalvando(false);
    }
  }

  async function descartar() {
    setSelecao(null);
    sairDaEdicao();
    // Volta ao que está GUARDADO agora — que pode ser o que outra pessoa salvou.
    await carregar();
    avisar('Mudanças descartadas. A planta voltou a como estava.');
  }

  /** Um retângulo acabou de ser desenhado: vira ambiente ou móvel, já escolhido e com o nome pronto para trocar. */
  function desenhou(ret: Retangulo) {
    if (!rascunho || !ferramenta) return;
    const novo = novoId(ferramenta === 'ambiente' ? 'a' : 'm');
    if (ferramenta === 'ambiente') {
      setRascunho({
        ...rascunho,
        ambientes: [...rascunho.ambientes, { id: novo, nome: `Ambiente ${rascunho.ambientes.length + 1}`, setorId: setores[0]?.id ?? null, ...ret }],
      });
      avisar('Ambiente criado. Dê um nome e escolha o setor.');
    } else {
      setRascunho({ ...rascunho, moveis: [...rascunho.moveis, { id: novo, nome: 'Equipamento', itemId: null, alt: 0.9, ...ret }] });
      avisar('Equipamento posto na planta. Dê um nome; o cadastro completo fica no inventário.');
    }
    setSelecao({ tipo: ferramenta === 'ambiente' ? 'ambiente' : 'movel', id: novo });
    setRecemCriado(novo);
    setFerramenta('');
  }

  function tirar(s: Selecao) {
    if (!rascunho) return;
    if (s.tipo === 'camera') {
      setRascunho({ ...rascunho, cameras: rascunho.cameras.filter((c) => c.pontoId !== s.id) });
      avisar('Câmera tirada da planta. O canal continua cadastrado.');
    } else if (s.tipo === 'movel') {
      setRascunho({ ...rascunho, moveis: rascunho.moveis.filter((m) => m.id !== s.id) });
      avisar('Tirado da planta. O cadastro no inventário continua.');
    } else {
      setRascunho({ ...rascunho, ambientes: rascunho.ambientes.filter((a) => a.id !== s.id) });
      avisar('Ambiente excluído.');
    }
    setSelecao(null);
  }

  /** Na edição, tocar na lista num canal que ainda não está na planta o põe nela: no meio do primeiro ambiente. */
  function porCamera(pontoId: string) {
    if (!rascunho) return;
    const [x, y] = rascunho.ambientes[0] ? centroDe(rascunho.ambientes[0]) : [7, 4.5];
    setRascunho({ ...rascunho, cameras: [...rascunho.cameras, { pontoId, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, ...CAMERA_NOVA }] });
    setSelecao({ tipo: 'camera', id: pontoId });
    avisar('Câmera posta na planta. Arraste para o lugar dela e gire a bolinha âmbar para onde ela olha.');
  }

  // ───────────────────────── a tela ─────────────────────────

  const carregando = guardada === undefined && !erro;
  const semPlanta = guardada !== undefined && !editando && planta.ambientes.length === 0;
  const totalDeCanais = setores.reduce((n, s) => n + s.pontos.length, 0);
  const cheio = (lista: 'ambientes' | 'moveis') => planta[lista].length >= LIMITES[lista];

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Store className="h-[15px] w-[15px]" aria-hidden />
            {loja?.nome ?? 'Loja'}
          </>
        }
        titulo="Planta da loja"
        acoes={
          configura &&
          !carregando &&
          !semPlanta && (
            <>
              {editando && (
                <Botao onClick={() => void descartar()} disabled={salvando}>
                  Descartar mudanças
                </Botao>
              )}
              <Botao variante={editando ? 'primario' : 'secundario'} ocupado={salvando} onClick={() => (editando ? void concluir() : editar())}>
                {!salvando && (editando ? <Check className="h-[18px] w-[18px]" aria-hidden /> : <Pencil className="h-[18px] w-[18px]" aria-hidden />)}
                {editando ? 'Concluir edição' : 'Editar planta'}
              </Botao>
            </>
          )
        }
      >
        Os ambientes, os equipamentos e cada câmera no seu lugar: onde está, para onde olha e o que cobre.
      </Cabecalho>

      <Abas rotulo="Vistas dos canais" abas={abasDeCanais(id)} />

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      )}
      {erroAoSalvar && (
        <Alerta tom="critico" papel="alert">
          {erroAoSalvar}
        </Alerta>
      )}

      {carregando && <Ossos alturas={[420]} />}

      {semPlanta && (
        <Vazio
          icone={IconeDeMapa}
          titulo="A loja ainda não tem planta"
          acao={
            configura && (
              <Botao variante="primario" onClick={editar}>
                <Plus className="h-[18px] w-[18px]" aria-hidden />
                Desenhar a planta
              </Botao>
            )
          }
        >
          Desenhe os ambientes como retângulos, ponha os equipamentos e arraste cada câmera para o lugar dela. Leva uns dez
          minutos e não precisa de medida exata.
        </Vazio>
      )}

      {guardada !== undefined && !semPlanta && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className={`${CARTAO} flex flex-col gap-3 p-4`} aria-labelledby="t-planta">
            <h2 id="t-planta" className="sr-only">
              Planta
            </h2>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 max-md:[&>div]:flex max-md:[&>div]:flex-[1_1_100%] max-md:[&>div>button]:flex-1">
              <Segmentado
                rotulo="Vista"
                valor={vista}
                aoMudar={girar}
                opcoes={[
                  { valor: 'perspectiva', rotulo: 'Em perspectiva', icone: Box, desativada: editando ? 'A planta é editada de cima.' : null },
                  { valor: 'cima', rotulo: 'De cima', icone: Square },
                  // Vale também na edição: as faixas da câmera no painel mudam o 3D na hora (é onde se acerta a câmera).
                  { valor: '3d', rotulo: '3D', icone: Rotate3d },
                ]}
              />
              {!editando && vista !== '3d' && (
                <Segmentado
                  rotulo="O que a planta mostra"
                  valor={camada}
                  aoMudar={setCamada}
                  opcoes={[
                    { valor: 'situacao', rotulo: 'Situação agora' },
                    { valor: 'cobertura', rotulo: 'Cobertura' },
                  ]}
                />
              )}
              {editando && (
                <div className="flex flex-wrap gap-2 md:ml-auto">
                  {(['ambiente', 'movel'] as const).map((f) => {
                    const lista = f === 'ambiente' ? 'ambientes' : 'moveis';
                    return (
                      <Botao
                        key={f}
                        mini
                        aria-pressed={ferramenta === f}
                        disabled={cheio(lista) || vista === '3d'}
                        title={
                          vista === '3d'
                            ? 'Desenhe na vista de cima.'
                            : cheio(lista)
                              ? `A planta já tem ${LIMITES[lista]}: é o limite.`
                              : undefined
                        }
                        className={ferramenta === f ? '!border-farol-facho !bg-farol-facho-leve' : ''}
                        onClick={() => setFerramenta(ferramenta === f ? '' : f)}
                      >
                        <Plus className="h-[15px] w-[15px]" aria-hidden />
                        {f === 'ambiente' ? 'Ambiente' : 'Equipamento'}
                      </Botao>
                    );
                  })}
                </div>
              )}
            </div>

            {vista === '3d' ? (
              <Vista3D planta={planta} selecao={selecao} canais={canais} aoSelecionar={setSelecao} />
            ) : (
              <DesenhoDaPlanta
                planta={planta}
                t={t}
                camada={camada}
                editando={editando}
                ferramenta={ferramenta}
                selecao={selecao}
                canais={canais}
                nomeDoMovel={(m) => m.nome}
                movelToca={(m) => Boolean(m.itemId && itemDe.has(m.itemId))}
                aoSelecionar={setSelecao}
                aoMudar={setRascunho}
                aoDesenhar={desenhou}
              />
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-farol-suave" data-legenda>
              {vista === '3d' ? (
                <span>
                  Arraste para girar, use a pinça ou a roda para aproximar e toque numa câmera para ver o que ela vê. A cor da
                  câmera é a situação do canal; a escolhida fica em vermelho.
                </span>
              ) : editando ? (
                <span>
                  Arraste uma câmera para movê-la; a bolinha âmbar gira a direção. Arraste um equipamento ou um ambiente para
                  mudá-lo de lugar.
                </span>
              ) : cobertura ? (
                <>
                  <span className="inline-flex items-center gap-[7px]">
                    <i className={LEGENDA.ok} />o que as câmeras alcançam
                  </span>
                  <span className="inline-flex items-center gap-[7px]">
                    <i className={LEGENDA.cego} />
                    nenhuma câmera vê
                  </span>
                  <span className="inline-flex items-center gap-[7px]">
                    <i className={LEGENDA.traco} />
                    canal sem imagem ou pausado: não cobre
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-[7px]">
                    <i className={LEGENDA.ok} />
                    conferindo
                  </span>
                  <span className="inline-flex items-center gap-[7px]">
                    <i className={LEGENDA.alerta} />
                    aviso nos últimos 10 min
                  </span>
                  <span className="inline-flex items-center gap-[7px]">
                    <i className={LEGENDA.neutro} />
                    sem conferência agora
                  </span>
                  <span className="inline-flex items-center gap-[7px]">
                    <i className={LEGENDA.traco} />
                    sem imagem ou pausado
                  </span>
                </>
              )}
            </div>
            <p className="text-[13px] text-farol-suave" data-nota>
              {vista === '3d'
                ? editando
                  ? 'Na edição, as faixas da câmera no painel mudam o 3D na hora. Para desenhar ambientes e equipamentos, use a vista de cima.'
                  : 'A mesma planta, com volume. Para mudar alguma coisa, clique em Editar planta.'
                : editando
                ? ferramenta
                  ? `Arraste na planta para desenhar ${ferramenta === 'ambiente' ? 'o ambiente' : 'o equipamento'}. Não precisa de medida exata: dá para corrigir os números ao lado.`
                  : 'A planta é editada de cima. As medidas são em metros.'
                : 'Toque numa câmera para ver o canal; num equipamento, para ver o que o inventário sabe dele.'}
            </p>
          </section>

          <aside className="flex min-w-0 flex-col gap-3.5" aria-label="O que está selecionado na planta">
            <div className={`${CARTAO} p-4`} aria-live="polite">
              <PainelDaPlanta
                lojaId={id}
                planta={planta}
                selecao={selecao}
                editando={editando}
                veResultados={veResultados}
                canais={canais}
                regras={regras}
                setores={setores}
                itens={itens}
                lugares={lugares}
                recemCriado={recemCriado}
                aoMudar={setRascunho}
                aoTirar={tirar}
              />
            </div>

            {cobertura && (
              <section className={`${CARTAO} flex flex-col gap-3 p-4`} data-cobertura>
                <Titulo>Cobertura por ambiente</Titulo>
                <ul className="flex flex-col gap-2.5">
                  {porAmbiente.map(({ ambiente, parte }) => (
                    <li key={ambiente.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-[13px]">
                      <span className="min-w-0 break-words">{ambiente.nome}</span>
                      <b className="font-mono text-[12.5px] font-semibold">{Math.round(parte * 100)}%</b>
                      <span className="col-span-2 h-2 overflow-hidden rounded-full bg-farol-critico-leve">
                        <i className="block h-full rounded-full bg-farol-ok" style={{ width: `${parte * 100}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-farol-suave">
                  Estimativa pela posição, pela abertura e pelo alcance informados. Equipamento alto na frente da câmera não
                  entra na conta. Canal sem imagem ou pausado não cobre nada.
                </p>
              </section>
            )}

            <section className={`${CARTAO} flex flex-col gap-3 p-4`} aria-labelledby="t-cams">
              <Titulo id="t-cams">Câmeras</Titulo>
              {totalDeCanais === 0 ? (
                <p className="text-[13px] text-farol-suave">A loja ainda não tem canal cadastrado. Cadastre em Canais → Lista.</p>
              ) : (
                <ul className="flex flex-col gap-1.5" aria-label="Câmeras da loja" data-cameras>
                  {setores.map((s) =>
                    s.pontos.length === 0 ? null : (
                      <li key={s.id} className="flex flex-col gap-1.5">
                        <span className="px-0.5 pt-1.5 text-xs font-semibold text-farol-suave">{s.nome}</span>
                        <ul className="flex flex-col gap-1.5">
                          {emOrdem(s.pontos).map((p) => {
                            const posta = naPlanta.has(p.id);
                            const marcada = selecao?.tipo === 'camera' && selecao.id === p.id;
                            const situacao = canais.get(p.id)?.situacao;
                            return (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  data-canal={p.id}
                                  aria-pressed={marcada}
                                  // Fora da edição, canal que não está na planta não tem o que mostrar nela.
                                  disabled={!posta && !editando}
                                  title={!posta && !editando ? 'Este canal ainda não está na planta.' : undefined}
                                  onClick={() => (posta ? setSelecao({ tipo: 'camera', id: p.id }) : porCamera(p.id))}
                                  className={`flex w-full min-w-0 items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-70 ${
                                    marcada ? 'border-farol-facho bg-farol-facho-leve/40' : 'border-farol-borda enabled:hover:border-farol-borda-forte'
                                  }`}
                                >
                                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-farol-realce font-mono text-[11px] font-semibold text-farol-marca">
                                    {numeroDoCanal(p)}
                                  </span>
                                  <b className="min-w-0 flex-1 break-words text-[13.5px] font-semibold">{p.nome}</b>
                                  {posta ? (
                                    situacao && <Chip tom={situacao.tom}>{situacao.texto}</Chip>
                                  ) : (
                                    <Chip tom="vazado">{editando ? 'pôr na planta' : 'fora da planta'}</Chip>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
