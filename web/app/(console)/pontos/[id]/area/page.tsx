'use client';

/**
 * As áreas de análise do canal — ver o quadro e desenhar o que importa.
 *
 * É a tela que transforma `--area 0.15,0.47,0.85,0.80` em algo que quem
 * opera a loja consegue fazer: olhar a cena e arrastar um retângulo.
 *
 * **Um canal pode ter mais de uma área, e cada área tem os seus critérios.**
 * A mesma câmera do caixa confere presença DENTRO do balcão e fila do lado
 * do cliente: são dois recortes da mesma imagem, e o critério vale só no
 * recorte em que foi posto.
 *
 * Duas coisas aqui não são enfeite:
 *
 * **Os campos numéricos existem junto com o arrasto.** Desenhar só com o
 * mouse exclui quem usa teclado, e os números também servem para ajustar
 * o que o arrasto deixou torto. Os dois editam o mesmo estado.
 *
 * **O diagnóstico aparece ao lado enquanto se desenha.** Marcar a área é
 * a decisão que define px/cm — e sem ver a consequência na hora, a pessoa
 * só descobre que a área era pequena demais quando o veredito já estiver
 * errado em produção.
 */

import { ArrowLeft, Crop, Plus, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { GavetaDoCriterio } from '@/componentes/criterios/formulario-criterio';
import { iconeDoTipo, nomeDoTipo, resumoDaProcura, TIPOS_DO_DETECTOR } from '@/componentes/criterios/opcoes';
import { diaEHora, plural } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, Campo } from '@/componentes/ui/campo';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Titulo, Vazio } from '@/componentes/ui/pecas';
import { Dialogo } from '@/componentes/ui/sobreposto';
import {
  consoleApi,
  ErroDaApi,
  previewApi,
  regrasApi,
  resultadosApi,
  type EstadoDoPreview,
  type PontoCompleto,
  type Setor,
  type ZonaCompleta,
} from '@/lib/api';

type Retangulo = { x1: number; y1: number; x2: number; y2: number };

const QUADRO_INTEIRO: Retangulo = { x1: 0, y1: 0, x2: 1, y2: 1 };

// A cor de cada área, no quadro e na lista ao lado. Ficam por cima da
// imagem da câmera, então não seguem o tema: precisam aparecer sobre
// qualquer cena.
const CORES_DE_AREA = ['#F2B03C', '#5AA9FF', '#7FD08A', '#C792EA', '#FF8A73', '#5EDCD0', '#F58FC2', '#B7C46A'];
const corDaArea = (i: number) => CORES_DE_AREA[i % CORES_DE_AREA.length]!;

function paraRetangulo(poligono: [number, number][]): Retangulo {
  if (!poligono?.length) return QUADRO_INTEIRO;
  const xs = poligono.map((p) => p[0]);
  const ys = poligono.map((p) => p[1]);
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

function paraPoligono(r: Retangulo): [number, number][] {
  return [
    [r.x1, r.y1],
    [r.x2, r.y1],
    [r.x2, r.y2],
    [r.x1, r.y2],
  ];
}

const prender = (v: number) => Math.min(1, Math.max(0, v));
const pc = (v: number) => `${(v * 100).toFixed(2)}%`;

/** O que aquele tanto de pontos por centímetro dá para verificar. */
function oQueSustenta(pxPorCm: number): { nome: string; tom: 'ok' | 'atencao' | 'critico' } {
  if (pxPorCm >= 12.8) return { nome: 'montagem', tom: 'ok' };
  if (pxPorCm >= 3) return { nome: 'estado', tom: 'ok' };
  if (pxPorCm >= 1.5) return { nome: 'presença', tom: 'atencao' };
  return { nome: 'insuficiente', tom: 'critico' };
}

/** "Área 2", "Área 3"… — o primeiro que ainda não existe neste canal. */
function nomeLivre(zonas: ZonaCompleta[]): string {
  const usados = new Set(zonas.map((z) => z.nome.trim().toLowerCase()));
  let n = zonas.length + 1;
  while (usados.has(`área ${n}`)) n += 1;
  return `Área ${n}`;
}

const LADOS = [
  ['x1', 'Esquerda'],
  ['y1', 'Topo'],
  ['x2', 'Direita'],
  ['y2', 'Base'],
] as const;

const CONEXAO = [
  ['nome', 'Nome', 'text', false],
  ['fabricante', 'Fabricante', 'text', false],
  ['canal', 'Canal', 'number', true],
  ['host', 'Endereço', 'text', true],
  ['porta', 'Porta', 'number', true],
  ['usuario', 'Usuário', 'text', false],
] as const;

/**
 * Um aperto do ponteiro sobre o quadro, até soltar. Só vira DESENHO depois
 * de andar alguns pontos; até lá é um clique, e clique seleciona.
 */
type Gesto = {
  x: number;
  y: number;
  telaX: number;
  telaY: number;
  /** A área como estava antes do aperto, para devolver se o arrasto não der em nada. */
  antes: Retangulo;
  desenhado: Retangulo | null;
};

/** Quantos pontos de tela o ponteiro anda antes de o aperto virar arrasto. */
const FOLGA_DO_CLIQUE = 6;

const contem = (r: Retangulo, x: number, y: number) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
const tamanho = (r: Retangulo) => (r.x2 - r.x1) * (r.y2 - r.y1);

/** O que a gaveta de critério precisa da loja; buscado só quando ela abre. */
type DaLoja = { setores: Setor[]; objetos: string[] };

export default function AreaDoCanal() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura, definirLoja, atualizar } = useConsole();
  const avisar = useAvisar();

  const [ponto, setPonto] = useState<PontoCompleto | null>(null);
  const [zonas, setZonas] = useState<ZonaCompleta[]>([]);
  const [zonaId, setZonaId] = useState<string>('');
  const [estado, setEstado] = useState<EstadoDoPreview | null>(null);
  const [retangulo, setRetangulo] = useState<Retangulo>(QUADRO_INTEIRO);
  const [larguraCm, setLarguraCm] = useState<string>('');
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [selo, setSelo] = useState<string | null>(null);
  const [nomeZona, setNomeZona] = useState('');
  const [conexao, setConexao] = useState<Partial<PontoCompleto>>({});
  const [salvandoConexao, setSalvandoConexao] = useState(false);

  const [criando, setCriando] = useState(false);
  const [excluindo, setExcluindo] = useState<ZonaCompleta | null>(null);
  const [excluindoAgora, setExcluindoAgora] = useState(false);
  const [erroAoExcluir, setErroAoExcluir] = useState<string | null>(null);
  /** A gaveta de critério aberta a partir de uma área, com o que ela precisa. */
  const [criterioNovo, setCriterioNovo] = useState<(DaLoja & { zonaId: string; chave: string }) | null>(null);
  const [abrindoCriterio, setAbrindoCriterio] = useState(false);

  const area = useRef<HTMLDivElement>(null);
  const arrastando = useRef<Gesto | null>(null);
  const campoDoNome = useRef<HTMLInputElement>(null);

  const zona = zonas.find((z) => z.id === zonaId) ?? null;
  const indiceDaZona = Math.max(0, zonas.findIndex((z) => z.id === zonaId));

  const carregar = useCallback(async () => {
    try {
      const [dados, est] = await Promise.all([previewApi.ponto(id), previewApi.estado(id)]);
      setPonto(dados.ponto);
      setConexao(dados.ponto);
      setZonas(dados.zonas);
      setEstado(est);
      setSelo(est.capturadoEm);
      // A área selecionada pode ter sido excluída: cai na primeira que existe.
      setZonaId((atual) => (dados.zonas.some((z) => z.id === atual) ? atual : (dados.zonas[0]?.id ?? '')));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui carregar o canal');
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

  // Trocar de área recarrega o desenho: cada uma tem o seu. O que estava
  // desenhado e não foi salvo na anterior se perde — por isso a troca só
  // acontece por um gesto claro (a lista, ou um clique na outra área).
  const poligonoDaZona = zona?.poligono;
  const nomeDaZona = zona?.nome;
  const larguraDaZona = zona?.largura_cena_cm;
  useEffect(() => {
    if (!poligonoDaZona) return;
    setRetangulo(paraRetangulo(poligonoDaZona));
    setNomeZona(nomeDaZona ?? '');
    setLarguraCm(larguraDaZona ? String(larguraDaZona) : '');
    // Só quando MUDA a área selecionada, não a cada recarga do canal: a
    // tela pergunta o estado do quadro de dois em dois segundos, e isso
    // não pode apagar o que a pessoa está desenhando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonaId]);

  // Enquanto há pedido em voo, pergunta o estado de tempos em tempos. Para
  // sozinho quando conclui, falha ou expira — espera eterna é pior que
  // erro, porque não dá o que fazer a seguir.
  const emVoo = estado?.pedido?.estado === 'pendente' || estado?.pedido?.estado === 'entregue';
  useEffect(() => {
    if (!emVoo) return;
    const t = setInterval(() => void carregar(), 2000);
    return () => clearInterval(t);
  }, [emVoo, carregar]);

  async function pedirQuadro() {
    setPedindo(true);
    setErro(null);
    setRecado(null);
    try {
      const r = await previewApi.pedir(id);
      setRecado(
        r.jaPedido
          ? 'Já havia um pedido em andamento. Esperando a loja responder.'
          : 'Pedido enviado. O agente responde na próxima batida.',
      );
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui pedir o quadro');
    } finally {
      setPedindo(false);
    }
  }

  async function salvar() {
    if (!zona) return;
    setSalvando(true);
    setErro(null);
    try {
      const atualizada = await previewApi.salvarArea(zona.id, {
        nome: nomeZona.trim() || zona.nome,
        poligono: paraPoligono(retangulo),
        larguraCenaCm: larguraCm.trim() ? Number(larguraCm) : null,
      });
      // A resposta não traz os critérios: eles não mudam ao salvar o desenho.
      setZonas((lista) => lista.map((z) => (z.id === atualizada.id ? { ...z, ...atualizada } : z)));
      avisar('Área salva. O agente usa a nova na próxima batida.');
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui salvar a área');
    } finally {
      setSalvando(false);
    }
  }

  async function novaArea() {
    setCriando(true);
    setErro(null);
    try {
      const nova = await previewApi.criarArea(id, { nome: nomeLivre(zonas) });
      setZonas((lista) => [...lista, nova]);
      setZonaId(nova.id);
      atualizar();
      avisar('Área criada. Arraste na imagem para posicionar, dê um nome e salve.');
      // O nome é a primeira coisa a acertar: "Área 2" não diz nada a ninguém.
      requestAnimationFrame(() => {
        campoDoNome.current?.focus();
        campoDoNome.current?.select();
      });
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui criar a área');
    } finally {
      setCriando(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setExcluindoAgora(true);
    setErroAoExcluir(null);
    try {
      const r = await previewApi.excluirArea(excluindo.id);
      const nome = excluindo.nome;
      setExcluindo(null);
      if (lojaDoCanal) resultadosApi.esquecer(lojaDoCanal);
      atualizar();
      await carregar();
      avisar(
        `Área “${nome}” excluída.` +
          (r.criteriosDesligados.length > 0
            ? ` ${r.criteriosDesligados.map((n) => `“${n}”`).join(' e ')} ${
                r.criteriosDesligados.length === 1 ? 'ficou sem lugar e foi desligado' : 'ficaram sem lugar e foram desligados'
              }.`
            : ''),
      );
    } catch (e) {
      // O erro fica DENTRO da pergunta: fechá-la esconderia que a ação não
      // aconteceu.
      setErroAoExcluir(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setExcluindoAgora(false);
    }
  }

  /** "+ Critério" da área: a gaveta abre com ESTA área já marcada. */
  async function criterioNaArea() {
    if (!zona || !lojaDoCanal) return;
    setAbrindoCriterio(true);
    setErro(null);
    try {
      const [l, r] = await Promise.all([consoleApi.loja(lojaDoCanal), regrasApi.listar(lojaDoCanal)]);
      setCriterioNovo({
        setores: l.setores,
        objetos: r.detector?.objetos ?? [],
        zonaId: zona.id,
        chave: `${zona.id}-${Date.now()}`,
      });
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui abrir o critério');
    } finally {
      setAbrindoCriterio(false);
    }
  }

  async function salvarConexao() {
    setSalvandoConexao(true);
    setErro(null);
    try {
      await consoleApi.editarPonto(id, {
        nome: conexao.nome,
        fabricante: conexao.fabricante,
        canal: conexao.canal ? Number(conexao.canal) : null,
        host: conexao.host,
        porta: conexao.porta ? Number(conexao.porta) : null,
        usuario: conexao.usuario,
      } as Record<string, unknown>);
      avisar('Conexão salva. O agente usa a nova na próxima batida.');
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui salvar a conexão');
    } finally {
      setSalvandoConexao(false);
    }
  }

  // ─────────────────────────── o desenho ───────────────────────────

  function posicao(ev: React.PointerEvent): { x: number; y: number } | null {
    const caixa = area.current?.getBoundingClientRect();
    if (!caixa || caixa.width === 0) return null;
    return {
      x: prender((ev.clientX - caixa.left) / caixa.width),
      y: prender((ev.clientY - caixa.top) / caixa.height),
    };
  }

  // CLIQUE seleciona, ARRASTO desenha — e o arrasto pode começar em cima
  // de outra área. Toda loja nova tem a área "Quadro inteiro" cobrindo a
  // imagem toda: se apertar sobre ela já trocasse a seleção, não sobrava
  // onde começar a desenhar a segunda.
  function aoPressionar(ev: React.PointerEvent) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const p = posicao(ev);
    if (!p) return;
    area.current?.setPointerCapture?.(ev.pointerId);
    arrastando.current = { ...p, telaX: ev.clientX, telaY: ev.clientY, antes: retangulo, desenhado: null };
  }

  function aoMover(ev: React.PointerEvent) {
    const gesto = arrastando.current;
    if (!gesto) return;
    // Mão que treme num clique não é arrasto.
    if (!gesto.desenhado && Math.hypot(ev.clientX - gesto.telaX, ev.clientY - gesto.telaY) < FOLGA_DO_CLIQUE) return;
    const p = posicao(ev);
    if (!p) return;
    gesto.desenhado = {
      x1: Math.min(gesto.x, p.x),
      y1: Math.min(gesto.y, p.y),
      x2: Math.max(gesto.x, p.x),
      y2: Math.max(gesto.y, p.y),
    };
    setRetangulo(gesto.desenhado);
  }

  function aoSoltar(ev: React.PointerEvent) {
    const gesto = arrastando.current;
    if (!gesto) return;
    arrastando.current = null;
    const r = gesto.desenhado;
    if (r) {
      // Um risco fino viraria uma área de tamanho zero, que o servidor
      // recusaria com uma mensagem técnica. Volta a que estava: quem
      // quer o quadro inteiro tem o atalho logo abaixo.
      if (r.x2 - r.x1 < 0.01 || r.y2 - r.y1 < 0.01) setRetangulo(gesto.antes);
      return;
    }
    if (ev.type !== 'pointerup') return;
    // Foi um clique. Vale a MENOR área que contém o ponto: é a que a
    // pessoa está vendo ali, mesmo com uma maior por baixo. Clicar dentro
    // da que já está selecionada não troca nada.
    let alvo: { id: string; tamanho: number } | null = null;
    for (const z of zonas) {
      const ret = z.id === zonaId ? gesto.antes : paraRetangulo(z.poligono);
      if (!contem(ret, gesto.x, gesto.y)) continue;
      const t = tamanho(ret);
      if (!alvo || t < alvo.tamanho || (t === alvo.tamanho && z.id === zonaId)) alvo = { id: z.id, tamanho: t };
    }
    if (alvo && alvo.id !== zonaId) setZonaId(alvo.id);
  }

  // ───────────────────────── o diagnóstico ─────────────────────────

  const larguraZona = Number(larguraCm);
  const fracao = (retangulo.x2 - retangulo.x1) * (retangulo.y2 - retangulo.y1);
  const resolucao = ponto?.resolucao_h ?? null;

  // px/cm que o MODELO vai ver, por degrau de envio. É o número que decide
  // se a pergunta tinha como ser respondida — não o megapixel da câmera.
  const degraus = [384, 640, 1000, 1920];
  const pxPorCm = larguraZona > 0 ? degraus.map((px) => ({ px, valor: Number((px / larguraZona).toFixed(1)) })) : [];

  const variasAreas = zonas.length > 1;
  const nomesDosCriterios = excluindo?.criterios.map((c) => `“${c.nome}”`) ?? [];

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
            {ponto && (
              <span>
                · {ponto.setor_nome}
                {ponto.canal ? ` · canal ${ponto.canal}` : ''}
              </span>
            )}
          </>
        }
        titulo={ponto?.nome ?? 'Canal'}
      >
        Marque na imagem cada região que importa e diga o que conferir em cada uma. Um canal pode ter mais de uma
        área: o critério vale só dentro da área em que foi posto.
      </Cabecalho>

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      )}
      {recado && (
        <Alerta papel="status" icone={RefreshCw}>
          {recado}
        </Alerta>
      )}

      {!ponto && !erro && <Ossos alturas={[360]} />}

      {ponto && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* ─────────────────────── o quadro ─────────────────────── */}
          <section aria-labelledby="t-quadro" className={`${CARTAO} flex flex-col gap-3 p-4`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Titulo id="t-quadro">Quadro do canal</Titulo>
              {estado?.capturadoEm && (
                <span className="font-mono text-[12.5px] text-farol-suave">{diaEHora(estado.capturadoEm)}</span>
              )}
              <Botao mini className="ml-auto" onClick={pedirQuadro} ocupado={pedindo || emVoo}>
                {!(pedindo || emVoo) && <RefreshCw className="h-[15px] w-[15px]" aria-hidden />}
                {pedindo ? 'Pedindo…' : emVoo ? 'Esperando a loja…' : 'Atualizar quadro'}
              </Botao>
            </div>

            {estado?.temPreview ? (
              <div
                ref={area}
                onPointerDown={aoPressionar}
                onPointerMove={aoMover}
                onPointerUp={aoSoltar}
                onPointerCancel={aoSoltar}
                className="relative max-w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl border border-farol-borda"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewApi.url(id, selo)}
                  alt={`Quadro do canal ${ponto.nome}, para marcar as áreas de análise`}
                  className="block w-full"
                  draggable={false}
                />
                {/* O que está FORA da área selecionada escurece: é o que
                    mostra, de relance, quanto do quadro está sendo pago sem
                    ser olhado. */}
                <div
                  className="pointer-events-none absolute inset-0 bg-black/55"
                  style={{
                    clipPath:
                      `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pc(retangulo.x1)} ${pc(retangulo.y1)}, ` +
                      `${pc(retangulo.x1)} ${pc(retangulo.y2)}, ${pc(retangulo.x2)} ${pc(retangulo.y2)}, ` +
                      `${pc(retangulo.x2)} ${pc(retangulo.y1)}, ${pc(retangulo.x1)} ${pc(retangulo.y1)})`,
                  }}
                />
                {/* As OUTRAS áreas do canal: tracejadas, cada uma na sua cor.
                    Clicar numa passa a mexer nela — quem decide é o gesto no
                    quadro (clique × arrasto), não o botão: o `onClick` daqui
                    só atende o TECLADO (`detail` 0), senão soltar o arrasto em
                    cima de outra área trocaria a seleção. */}
                {zonas.map((z, i) => {
                  if (z.id === zonaId) return null;
                  const r = paraRetangulo(z.poligono);
                  return (
                    <button
                      key={z.id}
                      type="button"
                      data-outra-area={z.id}
                      aria-label={`Selecionar a área ${z.nome}`}
                      onClick={(ev) => {
                        if (ev.detail === 0) setZonaId(z.id);
                      }}
                      className="absolute cursor-crosshair rounded border-2 border-dashed"
                      style={{
                        left: pc(r.x1),
                        top: pc(r.y1),
                        width: pc(r.x2 - r.x1),
                        height: pc(r.y2 - r.y1),
                        borderColor: corDaArea(i),
                        background: `color-mix(in srgb, ${corDaArea(i)} 18%, transparent)`,
                      }}
                    >
                      <Etiqueta cor={corDaArea(i)} dentro={r.y1 < 0.07}>
                        {z.nome}
                      </Etiqueta>
                    </button>
                  );
                })}
                <div
                  className="pointer-events-none absolute rounded border-2 shadow-[0_0_0_1px_rgb(4_8_14/0.5)]"
                  style={{
                    left: pc(retangulo.x1),
                    top: pc(retangulo.y1),
                    width: pc(retangulo.x2 - retangulo.x1),
                    height: pc(retangulo.y2 - retangulo.y1),
                    borderColor: corDaArea(indiceDaZona),
                  }}
                >
                  {variasAreas && (
                    <Etiqueta cor={corDaArea(indiceDaZona)} dentro={retangulo.y1 < 0.07}>
                      {nomeZona.trim() || 'área'}
                    </Etiqueta>
                  )}
                </div>
              </div>
            ) : (
              <Vazio icone={Crop} titulo="Este canal ainda não tem quadro">
                O quadro é capturado pelo agente instalado na loja. Use <strong>Atualizar quadro</strong> e ele
                responde na próxima batida.
                {estado?.pedido?.estado === 'falhou' && (
                  <span role="alert" className="mt-2 block text-farol-critico">
                    O último pedido falhou: {estado.pedido.erro}
                  </span>
                )}
                {estado?.pedido?.estado === 'expirado' && (
                  <span role="alert" className="mt-2 block text-farol-critico">
                    O pedido expirou sem a loja buscar. O agente está desligado?
                  </span>
                )}
              </Vazio>
            )}

            <p className="text-[12.5px] text-farol-suave">
              Arraste sobre a imagem para redesenhar a área selecionada. O que fica escuro está fora dela.
              {variasAreas && ' Clique em outra área, sem arrastar, para passar a mexer nela.'}
            </p>
          </section>

          {/* ───────────────────── ao lado ───────────────────── */}
          <aside aria-label="Áreas do canal e ajustes" className="flex flex-col gap-3.5">
            {/* as áreas do canal */}
            <section aria-labelledby="t-areas" className={`${CARTAO} flex flex-col gap-3 p-4`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Titulo id="t-areas">Áreas deste canal</Titulo>
                {configura && (
                  <Botao mini className="ml-auto" onClick={novaArea} ocupado={criando}>
                    {!criando && <Plus className="h-[15px] w-[15px]" aria-hidden />}
                    {criando ? 'Criando…' : 'Nova área'}
                  </Botao>
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {zonas.map((z, i) => {
                  const selecionada = z.id === zonaId;
                  const unica = zonas.length === 1;
                  return (
                    <li key={z.id} className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        aria-pressed={selecionada}
                        onClick={() => setZonaId(z.id)}
                        className={`flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-left transition-colors ${
                          selecionada
                            ? 'border-farol-marca bg-farol-painel shadow-[inset_0_0_0_1px_rgb(var(--marca))]'
                            : 'border-farol-borda bg-farol-painel-2 hover:border-farol-borda-forte'
                        }`}
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-[4px] shadow-[0_0_0_1px_rgb(4_8_14/0.25)]"
                          style={{ background: corDaArea(i) }}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <b className="block break-words font-semibold">{z.nome}</b>
                          <small className="block text-xs text-farol-suave">
                            {z.criterios.length === 0 ? 'sem critério' : plural(z.criterios.length, 'critério', 'critérios')}
                          </small>
                        </span>
                      </button>
                      {configura && (
                        <Botao
                          variante="fantasma"
                          mini
                          quadrado
                          disabled={unica}
                          title={unica ? 'O canal precisa de pelo menos uma área' : undefined}
                          aria-label={`Excluir a área ${z.nome}`}
                          onClick={() => {
                            setErroAoExcluir(null);
                            setExcluindo(z);
                          }}
                        >
                          <Trash2 className="h-[18px] w-[18px]" aria-hidden />
                        </Botao>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className={AJUDA}>
                Cada área tem os seus critérios. Presença se confere dentro do balcão; fila, do lado do cliente.
              </p>
            </section>

            {/* os critérios da área selecionada */}
            {zona && (
              <section aria-labelledby="t-area-crit" className={`${CARTAO} flex flex-col gap-3 p-4`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Titulo id="t-area-crit">{variasAreas ? `Critérios em “${zona.nome}”` : 'Critérios deste canal'}</Titulo>
                  {configura && ponto.ativo && (
                    <Botao mini className="ml-auto" onClick={criterioNaArea} ocupado={abrindoCriterio}>
                      {!abrindoCriterio && <Plus className="h-[15px] w-[15px]" aria-hidden />}
                      Critério
                    </Botao>
                  )}
                </div>
                {zona.criterios.length === 0 ? (
                  <p className="text-[13px] text-farol-suave">
                    Nenhum critério {variasAreas ? 'nesta área. Nada é verificado nela.' : 'neste canal. Nada é verificado aqui.'}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {zona.criterios.map((c) => {
                      const Icone = iconeDoTipo(c.tipo);
                      const procura = TIPOS_DO_DETECTOR.includes(c.tipo) ? resumoDaProcura(c.parametros) : null;
                      return (
                        <li key={c.id} className="flex min-w-0 items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-farol-realce text-farol-marca">
                            <Icone className="h-[18px] w-[18px]" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <b className="block break-words font-semibold">{c.nome}</b>
                            <small className="block text-xs text-farol-suave">
                              {nomeDoTipo(c.tipo)}
                              {procura ? ` · ${procura}` : ''}
                            </small>
                          </span>
                          <Chip tom={c.ativa ? 'ok' : 'neutro'}>{c.ativa ? 'ligado' : 'desligado'}</Chip>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {ponto.loja_id && zona.criterios.length > 0 && (
                  <Link href={`/lojas/${ponto.loja_id}/regras`} className="elo self-start text-[13px]">
                    Editar na tela de critérios
                  </Link>
                )}
              </section>
            )}

            {/* a área selecionada */}
            <section className={`${CARTAO} flex flex-col gap-3 p-4`}>
              <Titulo>{variasAreas ? 'Área selecionada' : 'Área'}</Titulo>

              <Campo
                rotulo="Nome desta área"
                htmlFor="area-nome"
                ajuda={
                  nomeZona.trim() === 'Quadro inteiro' && fracao < 0.95
                    ? 'A área já não é o quadro inteiro. Vale trocar o nome, senão daqui a três meses alguém lê e acredita.'
                    : undefined
                }
              >
                <input
                  ref={campoDoNome}
                  id="area-nome"
                  value={nomeZona}
                  maxLength={60}
                  onChange={(e) => setNomeZona(e.target.value)}
                  placeholder="bancada de montagem"
                  className="entrada"
                />
              </Campo>

              <div className="grid grid-cols-2 gap-2.5">
                {LADOS.map(([chave, rotulo]) => (
                  <Campo key={chave} rotulo={rotulo} htmlFor={`area-${chave}`}>
                    <input
                      id={`area-${chave}`}
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={retangulo[chave].toFixed(2)}
                      onChange={(e) => setRetangulo((r) => ({ ...r, [chave]: prender(Number(e.target.value)) }))}
                      className="entrada font-mono"
                    />
                  </Campo>
                ))}
              </div>

              <button type="button" onClick={() => setRetangulo(QUADRO_INTEIRO)} className="elo self-start text-[13px]">
                Usar o quadro inteiro
              </button>

              <Campo
                rotulo="Largura real desta área, em cm"
                htmlFor="area-largura"
                ajuda="É o que permite saber quantos pontos de imagem cabem em cada centímetro. Medir com fita é mais confiável que a conta pela lente, porque a lente de verdade distorce."
              >
                <input
                  id="area-largura"
                  type="number"
                  min={1}
                  step={1}
                  value={larguraCm}
                  onChange={(e) => setLarguraCm(e.target.value)}
                  placeholder="meça com fita"
                  className="entrada font-mono"
                />
              </Campo>

              {configura && (
                <Botao variante="primario" onClick={salvar} ocupado={salvando} disabled={!zona}>
                  {salvando ? 'Salvando…' : 'Salvar área'}
                </Botao>
              )}
            </section>

            <section className={`${CARTAO} flex flex-col gap-3 p-4`}>
              <Titulo>O que esta área sustenta</Titulo>
              <dl className="flex flex-col text-[13px] [&>div+div]:border-t [&>div+div]:border-farol-borda [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:py-[7px]">
                <div>
                  <dt className="text-farol-suave">do quadro</dt>
                  <dd className="font-mono text-[12.5px]">{(fracao * 100).toFixed(0)}%</dd>
                </div>
                {resolucao && (
                  <div>
                    <dt className="text-farol-suave">imagem do canal</dt>
                    <dd className="font-mono text-[12.5px]">{resolucao} px</dd>
                  </div>
                )}
                {pxPorCm.map(({ px, valor }) => {
                  const s = oQueSustenta(valor);
                  return (
                    <div key={px}>
                      <dt className="text-farol-suave">envio de {px} px</dt>
                      <dd className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px]">{valor.toFixed(1).replace('.', ',')}</span> por cm
                        <Chip tom={s.tom}>{s.nome}</Chip>
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className={AJUDA}>
                {pxPorCm.length > 0
                  ? 'Montagem item a item pede 12,8 pontos por cm; estado, 3; presença, 1,5.'
                  : 'Informe a largura real da área para ver o que ela sustenta.'}
              </p>
            </section>

            <section className={`${CARTAO} flex flex-col gap-3 p-4`}>
              <Titulo>Conexão</Titulo>
              <p className={AJUDA}>A senha não entra aqui: ela fica no cofre do agente, na loja.</p>
              <div className="grid grid-cols-2 gap-2.5">
                {CONEXAO.map(([campo, rotulo, tipo, mono]) => (
                  <Campo key={campo} rotulo={rotulo} htmlFor={`cx-${campo}`}>
                    <input
                      id={`cx-${campo}`}
                      type={tipo}
                      value={String(conexao[campo] ?? '')}
                      onChange={(e) => setConexao((c) => ({ ...c, [campo]: e.target.value }))}
                      disabled={!configura}
                      className={`entrada ${mono ? 'font-mono' : ''}`}
                    />
                  </Campo>
                ))}
              </div>
              {ponto.mac && (
                <p className={AJUDA}>
                  Identificação do gravador vista pelo agente: <span className="font-mono">{ponto.mac}</span>
                  {ponto.mac_visto_em && `, em ${new Date(ponto.mac_visto_em).toLocaleDateString('pt-BR')}`}. É o que
                  permite reencontrá-lo se o endereço mudar.
                </p>
              )}
              {configura && (
                <Botao onClick={salvarConexao} ocupado={salvandoConexao}>
                  {salvandoConexao ? 'Salvando…' : 'Salvar conexão'}
                </Botao>
              )}
            </section>
          </aside>
        </div>
      )}

      {criterioNovo && ponto && (
        <GavetaDoCriterio
          key={criterioNovo.chave}
          lojaId={ponto.loja_id}
          setores={criterioNovo.setores}
          marcadasDeInicio={[criterioNovo.zonaId]}
          objetosDoDetector={criterioNovo.objetos}
          horarioDaLoja={loja?.horario_funcionamento ?? []}
          aoFechar={() => setCriterioNovo(null)}
          aoSalvar={async (mensagem) => {
            setCriterioNovo(null);
            resultadosApi.esquecer(ponto.loja_id);
            atualizar();
            await carregar();
            avisar(mensagem);
          }}
        />
      )}

      {excluindo && (
        <Dialogo
          titulo={`Excluir a área “${excluindo.nome}”?`}
          rotuloConfirmar="Excluir área"
          rotuloOcupado="Excluindo…"
          ocupado={excluindoAgora}
          erro={erroAoExcluir}
          aoConfirmar={confirmarExclusao}
          aoCancelar={() => setExcluindo(null)}
        >
          {nomesDosCriterios.length > 0 ? (
            <p>
              {nomesDosCriterios.join(' e ')}{' '}
              <strong>
                {nomesDosCriterios.length === 1 ? 'deixa de ser verificado' : 'deixam de ser verificados'} neste canal
              </strong>
              . Se era o único lugar {nomesDosCriterios.length === 1 ? 'dele' : 'de algum deles'}, o critério é
              desligado e fica em “Sem canal”.
            </p>
          ) : (
            <p>Nenhum critério vale nesta área.</p>
          )}
          <p>O que já foi registrado nela continua no histórico. As outras áreas deste canal não mudam.</p>
        </Dialogo>
      )}
    </>
  );
}

/**
 * O nome da área, colado no canto do retângulo dela — por fora, em cima.
 * Área que encosta no topo do quadro não tem "em cima": ali a etiqueta
 * vai por dentro, senão seria cortada.
 */
function Etiqueta({ cor, dentro, children }: { cor: string; dentro: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute -left-0.5 top-0 max-w-[calc(100%+4px)] truncate px-[7px] py-0.5 text-[11px] font-semibold text-[#1B1403] ${
        dentro ? 'rounded-br-[5px]' : '-translate-y-full rounded-t-[5px]'
      }`}
      style={{ background: cor }}
    >
      {children}
    </span>
  );
}
