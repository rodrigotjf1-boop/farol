'use client';

/**
 * A área de análise do canal — ver o quadro e desenhar o que importa.
 *
 * É a tela que transforma `--area 0.15,0.47,0.85,0.80` em algo que quem
 * opera a loja consegue fazer: olhar a cena e arrastar um retângulo.
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

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Shell } from '@/componentes/shell';
import {
  consoleApi,
  ErroDaApi,
  previewApi,
  type EstadoDoPreview,
  type PontoCompleto,
  type ZonaCompleta,
} from '@/lib/api';

type Retangulo = { x1: number; y1: number; x2: number; y2: number };

const QUADRO_INTEIRO: Retangulo = { x1: 0, y1: 0, x2: 1, y2: 1 };

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

export default function AreaDoCanal() {
  const { id } = useParams<{ id: string }>();

  const [ponto, setPonto] = useState<PontoCompleto | null>(null);
  const [zonas, setZonas] = useState<ZonaCompleta[]>([]);
  const [zonaId, setZonaId] = useState<string>('');
  const [estado, setEstado] = useState<EstadoDoPreview | null>(null);
  const [retangulo, setRetangulo] = useState<Retangulo>(QUADRO_INTEIRO);
  const [larguraCm, setLarguraCm] = useState<string>('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [selo, setSelo] = useState<string | null>(null);
  const [nomeZona, setNomeZona] = useState('');
  const [conexao, setConexao] = useState<Partial<PontoCompleto>>({});
  const [salvandoConexao, setSalvandoConexao] = useState(false);

  const area = useRef<HTMLDivElement>(null);
  const arrastando = useRef<{ x: number; y: number } | null>(null);

  const zona = zonas.find((z) => z.id === zonaId) ?? null;

  const carregar = useCallback(async () => {
    try {
      const [dados, est] = await Promise.all([
        previewApi.ponto(id),
        previewApi.estado(id),
      ]);
      setPonto(dados.ponto);
      setConexao(dados.ponto);
      setZonas(dados.zonas);
      setEstado(est);
      setSelo(est.capturadoEm);
      setZonaId((atual) => atual || dados.zonas[0]?.id || '');
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui carregar o canal');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Troca de zona recarrega o desenho: cada área tem o seu.
  useEffect(() => {
    if (!zona) return;
    setRetangulo(paraRetangulo(zona.poligono));
    setNomeZona(zona.nome);
    setLarguraCm(zona.largura_cena_cm ? String(zona.largura_cena_cm) : '');
  }, [zonaId, zona]);

  // Enquanto há pedido em voo, pergunta o estado de tempos em tempos. Para
  // sozinho quando conclui, falha ou expira — spinner eterno é pior que
  // erro, porque não dá o que fazer a seguir.
  useEffect(() => {
    const emVoo =
      estado?.pedido?.estado === 'pendente' || estado?.pedido?.estado === 'entregue';
    if (!emVoo) return;

    const t = setInterval(() => void carregar(), 2000);
    return () => clearInterval(t);
  }, [estado?.pedido?.estado, carregar]);

  async function pedirQuadro() {
    setPedindo(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await previewApi.pedir(id);
      setAviso(
        r.jaPedido
          ? 'já havia um pedido em andamento — esperando a loja responder'
          : 'pedido enviado. O agente responde na próxima batida.',
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
    setAviso(null);
    try {
      const atualizada = await previewApi.salvarArea(zona.id, {
        nome: nomeZona.trim() || zona.nome,
        poligono: paraPoligono(retangulo),
        larguraCenaCm: larguraCm.trim() ? Number(larguraCm) : null,
      });
      setZonas((lista) => lista.map((z) => (z.id === atualizada.id ? atualizada : z)));
      setAviso('área salva. O agente usa a nova na próxima batida.');
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui salvar a área');
    } finally {
      setSalvando(false);
    }
  }

  async function salvarConexao() {
    setSalvandoConexao(true);
    setErro(null);
    setAviso(null);
    try {
      await consoleApi.editarPonto(id, {
        nome: conexao.nome,
        fabricante: conexao.fabricante,
        canal: conexao.canal ? Number(conexao.canal) : null,
        host: conexao.host,
        porta: conexao.porta ? Number(conexao.porta) : null,
        usuario: conexao.usuario,
      } as Record<string, unknown>);
      setAviso('conexão salva. O agente usa a nova na próxima batida.');
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

  function aoPressionar(ev: React.PointerEvent) {
    const p = posicao(ev);
    if (!p) return;
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    arrastando.current = p;
    setRetangulo({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  }

  function aoMover(ev: React.PointerEvent) {
    const inicio = arrastando.current;
    if (!inicio) return;
    const p = posicao(ev);
    if (!p) return;
    setRetangulo({
      x1: Math.min(inicio.x, p.x),
      y1: Math.min(inicio.y, p.y),
      x2: Math.max(inicio.x, p.x),
      y2: Math.max(inicio.y, p.y),
    });
  }

  function aoSoltar() {
    const r = retangulo;
    // Clique sem arrasto viraria uma área de tamanho zero, que o servidor
    // recusaria com uma mensagem técnica. Devolver o quadro inteiro é o
    // que a pessoa quis dizer: "nenhuma área marcada".
    if (r.x2 - r.x1 < 0.01 || r.y2 - r.y1 < 0.01) setRetangulo(QUADRO_INTEIRO);
    arrastando.current = null;
  }

  // ───────────────────────── o diagnóstico ─────────────────────────

  const larguraZona = Number(larguraCm);
  const fracao = (retangulo.x2 - retangulo.x1) * (retangulo.y2 - retangulo.y1);
  const resolucao = ponto?.resolucao_h ?? null;

  // px/cm que o MODELO vai ver, por degrau de envio. É o número que decide
  // se a pergunta tinha como ser respondida — não o megapixel da câmera.
  const degraus = [384, 640, 1000, 1920];
  const pxPorCm =
    larguraZona > 0
      ? degraus.map((px) => ({ px, valor: Number((px / larguraZona).toFixed(1)) }))
      : [];

  return (
    <Shell>
      <div className="mx-auto w-full max-w-5xl">
        <Link
          href={ponto ? `/lojas/${ponto.loja_id}` : '/lojas'}
          className="text-sm text-farol-suave hover:text-farol-tinta"
        >
          ← voltar
        </Link>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">
            {ponto ? `${ponto.nome} · área de análise` : 'carregando…'}
          </h1>
          {ponto && (
            <span className="text-sm text-farol-suave">
              {ponto.setor_nome}
              {ponto.canal ? ` · canal ${ponto.canal}` : ''}
            </span>
          )}
        </div>

        {erro && (
          <p role="alert" className="mt-4 text-sm text-farol-critico">
            {erro}
          </p>
        )}
        {aviso && (
          <p role="status" className="mt-4 text-sm text-farol-suave">
            {aviso}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          {/* ─────────────────────── o quadro ─────────────────────── */}
          <section className="rounded-xl border border-farol-borda bg-farol-painel">
            <header className="flex flex-wrap items-center gap-3 border-b border-farol-borda px-4 py-3">
              <h2 className="font-medium">Quadro do canal</h2>
              {estado?.capturadoEm && (
                <span className="text-sm text-farol-suave">
                  de {new Date(estado.capturadoEm).toLocaleString('pt-BR')}
                </span>
              )}
              <button
                type="button"
                onClick={pedirQuadro}
                disabled={pedindo}
                className="ml-auto rounded-lg border border-farol-borda px-3 py-1.5 text-sm transition hover:border-farol-facho/50 disabled:opacity-50"
              >
                {pedindo ? 'pedindo…' : 'Atualizar quadro'}
              </button>
            </header>

            <div className="p-4">
              {estado?.temPreview ? (
                <div
                  ref={area}
                  onPointerDown={aoPressionar}
                  onPointerMove={aoMover}
                  onPointerUp={aoSoltar}
                  className="relative select-none touch-none overflow-hidden rounded-lg border border-farol-borda"
                  style={{ cursor: 'crosshair' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewApi.url(id, selo)}
                    alt={`Quadro do canal ${ponto?.nome ?? ''}, para marcar a área de análise`}
                    className="block w-full"
                    draggable={false}
                  />
                  {/* O que está FORA da área escurece: é o que mostra, de
                      relance, quanto do quadro está sendo pago sem ser
                      olhado. */}
                  <div
                    className="pointer-events-none absolute inset-0 bg-black/55"
                    style={{
                      clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                        ${retangulo.x1 * 100}% ${retangulo.y1 * 100}%,
                        ${retangulo.x1 * 100}% ${retangulo.y2 * 100}%,
                        ${retangulo.x2 * 100}% ${retangulo.y2 * 100}%,
                        ${retangulo.x2 * 100}% ${retangulo.y1 * 100}%,
                        ${retangulo.x1 * 100}% ${retangulo.y1 * 100}%)`,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute border-2 border-farol-facho"
                    style={{
                      left: `${retangulo.x1 * 100}%`,
                      top: `${retangulo.y1 * 100}%`,
                      width: `${(retangulo.x2 - retangulo.x1) * 100}%`,
                      height: `${(retangulo.y2 - retangulo.y1) * 100}%`,
                    }}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-farol-borda px-4 py-10 text-center">
                  <p className="text-sm text-farol-suave">
                    Este canal ainda não tem quadro.
                  </p>
                  <p className="mt-2 text-sm text-farol-suave">
                    O quadro é capturado pelo agente instalado na loja — clique em{' '}
                    <strong className="text-farol-tinta">Atualizar quadro</strong> e
                    ele responde na próxima batida.
                  </p>
                  {estado?.pedido?.estado === 'falhou' && (
                    <p role="alert" className="mt-3 text-sm text-farol-critico">
                      o último pedido falhou: {estado.pedido.erro}
                    </p>
                  )}
                  {estado?.pedido?.estado === 'expirado' && (
                    <p role="alert" className="mt-3 text-sm text-farol-critico">
                      o pedido expirou sem a loja buscar — o agente está desligado?
                    </p>
                  )}
                </div>
              )}

              <p className="mt-3 text-sm text-farol-suave">
                Arraste sobre a imagem para marcar a região que importa. Sem área
                marcada, o quadro inteiro é analisado — custa mais e entrega menos
                detalhe por centímetro.
              </p>
            </div>
          </section>

          {/* ───────────────────── os números ───────────────────── */}
          <aside className="space-y-4">
            <section className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <h2 className="font-medium">Área</h2>

              {zonas.length > 1 && (
                <label className="mt-3 block text-sm">
                  <span className="text-farol-suave">Zona</span>
                  <select
                    value={zonaId}
                    onChange={(e) => setZonaId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-farol-borda bg-transparent px-2 py-1.5"
                  >
                    {zonas.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.nome}
                        {z.principal ? ' (principal)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="mt-3 block text-sm">
                <span className="text-farol-suave">Nome desta área</span>
                <input
                  value={nomeZona}
                  onChange={(e) => setNomeZona(e.target.value)}
                  placeholder="bancada de montagem"
                  className="mt-1 w-full rounded-lg border border-farol-borda bg-transparent px-2 py-1.5"
                />
              </label>
              {nomeZona.trim() === 'Quadro inteiro' && fracao < 0.95 && (
                <p className="mt-1 text-xs text-farol-suave">
                  A área já não é o quadro inteiro — vale trocar o nome, senão
                  daqui a três meses alguém vai ler e acreditar.
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    ['x1', 'esquerda'],
                    ['y1', 'topo'],
                    ['x2', 'direita'],
                    ['y2', 'base'],
                  ] as const
                ).map(([chave, rotulo]) => (
                  <label key={chave} className="block text-sm">
                    <span className="text-farol-suave">{rotulo}</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={retangulo[chave].toFixed(2)}
                      onChange={(e) =>
                        setRetangulo((r) => ({
                          ...r,
                          [chave]: prender(Number(e.target.value)),
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-farol-borda bg-transparent px-2 py-1.5 font-mono"
                    />
                  </label>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setRetangulo(QUADRO_INTEIRO)}
                className="mt-2 text-sm text-farol-suave underline hover:text-farol-tinta"
              >
                usar o quadro inteiro
              </button>

              <label className="mt-4 block text-sm">
                <span className="text-farol-suave">
                  Largura real desta área, em cm
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={larguraCm}
                  onChange={(e) => setLarguraCm(e.target.value)}
                  placeholder="meça com fita"
                  className="mt-1 w-full rounded-lg border border-farol-borda bg-transparent px-2 py-1.5 font-mono"
                />
              </label>
              <p className="mt-1 text-xs text-farol-suave">
                É o que permite calcular px/cm. Medir com fita vence a conta pela
                óptica, porque a lente real distorce.
              </p>

              <button
                type="button"
                onClick={salvar}
                disabled={salvando || !zona}
                className="mt-4 w-full rounded-lg bg-farol-facho px-3 py-2 text-sm font-medium text-farol-fundo transition hover:opacity-90 disabled:opacity-50"
              >
                {salvando ? 'salvando…' : 'Salvar área'}
              </button>
            </section>

            <section className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <h2 className="font-medium">O que esta área sustenta</h2>

              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-farol-suave">do quadro</dt>
                  <dd className="font-mono">{(fracao * 100).toFixed(0)}%</dd>
                </div>
                {resolucao && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-farol-suave">canal</dt>
                    <dd className="font-mono">{resolucao} px</dd>
                  </div>
                )}
              </dl>

              {pxPorCm.length > 0 ? (
                <>
                  <p className="mt-3 text-xs text-farol-suave">
                    px/cm que o modelo vê, por tamanho de envio:
                  </p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {pxPorCm.map(({ px, valor }) => (
                      <li key={px} className="flex justify-between gap-2">
                        <span className="text-farol-suave">{px} px</span>
                        <span className="font-mono">
                          {valor}
                          {valor >= 12.8
                            ? ' · montagem'
                            : valor >= 3
                              ? ' · estado'
                              : valor >= 1.5
                                ? ' · presença'
                                : ' · insuficiente'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-farol-suave">
                    Montagem item a item exige 12,8 px/cm; estado, 3; presença, 1,5.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-farol-suave">
                  Informe a largura real da área para ver o que ela sustenta.
                </p>
              )}
            </section>
            <section className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <h2 className="font-medium">Conexão</h2>
              <p className="mt-1 text-xs text-farol-suave">
                A senha não entra aqui — ela fica no cofre do agente, na loja.
              </p>

              <div className="mt-3 space-y-2">
                {(
                  [
                    ['nome', 'nome', 'text'],
                    ['fabricante', 'fabricante', 'text'],
                    ['canal', 'canal', 'number'],
                    ['host', 'endereço', 'text'],
                    ['porta', 'porta', 'number'],
                    ['usuario', 'usuário', 'text'],
                  ] as const
                ).map(([campo, rotulo, tipo]) => (
                  <label key={campo} className="block text-sm">
                    <span className="text-farol-suave">{rotulo}</span>
                    <input
                      type={tipo}
                      value={String(conexao[campo] ?? '')}
                      onChange={(e) =>
                        setConexao((c) => ({ ...c, [campo]: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-farol-borda bg-transparent px-2 py-1.5"
                    />
                  </label>
                ))}
              </div>

              {ponto?.mac && (
                <p className="mt-3 text-xs text-farol-suave">
                  MAC visto pelo agente:{' '}
                  <span className="font-mono">{ponto.mac}</span>
                  {ponto.mac_visto_em &&
                    ` em ${new Date(ponto.mac_visto_em).toLocaleDateString('pt-BR')}`}
                  . É o que permite reencontrar o gravador se o endereço mudar.
                </p>
              )}

              <button
                type="button"
                onClick={salvarConexao}
                disabled={salvandoConexao}
                className="mt-4 w-full rounded-lg border border-farol-borda px-3 py-2 text-sm transition hover:border-farol-facho/50 disabled:opacity-50"
              >
                {salvandoConexao ? 'salvando…' : 'Salvar conexão'}
              </button>
            </section>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
