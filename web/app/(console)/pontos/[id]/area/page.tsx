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

import { ArrowLeft, Crop, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { diaEHora } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, Campo } from '@/componentes/ui/campo';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Titulo, Vazio } from '@/componentes/ui/pecas';
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

/** O que aquele tanto de pontos por centímetro dá para verificar. */
function oQueSustenta(pxPorCm: number): { nome: string; tom: 'ok' | 'atencao' | 'critico' } {
  if (pxPorCm >= 12.8) return { nome: 'montagem', tom: 'ok' };
  if (pxPorCm >= 3) return { nome: 'estado', tom: 'ok' };
  if (pxPorCm >= 1.5) return { nome: 'presença', tom: 'atencao' };
  return { nome: 'insuficiente', tom: 'critico' };
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

export default function AreaDoCanal() {
  const { id } = useParams<{ id: string }>();
  const { configura, definirLoja } = useConsole();
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

  const area = useRef<HTMLDivElement>(null);
  const arrastando = useRef<{ x: number; y: number } | null>(null);

  const zona = zonas.find((z) => z.id === zonaId) ?? null;

  const carregar = useCallback(async () => {
    try {
      const [dados, est] = await Promise.all([previewApi.ponto(id), previewApi.estado(id)]);
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

  // O endereço desta tela não diz de que loja é o canal. A moldura precisa
  // saber, para mostrar a loja certa e marcar "Canais" na navegação.
  const lojaDoCanal = ponto?.loja_id ?? null;
  useEffect(() => {
    if (lojaDoCanal) definirLoja(lojaDoCanal);
  }, [lojaDoCanal, definirLoja]);

  // Troca de zona recarrega o desenho: cada área tem o seu.
  useEffect(() => {
    if (!zona) return;
    setRetangulo(paraRetangulo(zona.poligono));
    setNomeZona(zona.nome);
    setLarguraCm(zona.largura_cena_cm ? String(zona.largura_cena_cm) : '');
  }, [zonaId, zona]);

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
      setZonas((lista) => lista.map((z) => (z.id === atualizada.id ? atualizada : z)));
      avisar('Área salva. O agente usa a nova na próxima batida.');
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui salvar a área');
    } finally {
      setSalvando(false);
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
  const pxPorCm = larguraZona > 0 ? degraus.map((px) => ({ px, valor: Number((px / larguraZona).toFixed(1)) })) : [];

  const pc = (v: number) => `${(v * 100).toFixed(2)}%`;

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
        Marque na imagem a região que importa. Sem área marcada, o quadro inteiro é analisado: custa mais e mostra
        menos detalhe por centímetro.
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
                  alt={`Quadro do canal ${ponto.nome}, para marcar a área de análise`}
                  className="block w-full"
                  draggable={false}
                />
                {/* O que está FORA da área escurece: é o que mostra, de
                    relance, quanto do quadro está sendo pago sem ser
                    olhado. */}
                <div
                  className="pointer-events-none absolute inset-0 bg-black/55"
                  style={{
                    clipPath:
                      `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pc(retangulo.x1)} ${pc(retangulo.y1)}, ` +
                      `${pc(retangulo.x1)} ${pc(retangulo.y2)}, ${pc(retangulo.x2)} ${pc(retangulo.y2)}, ` +
                      `${pc(retangulo.x2)} ${pc(retangulo.y1)}, ${pc(retangulo.x1)} ${pc(retangulo.y1)})`,
                  }}
                />
                <div
                  className="pointer-events-none absolute rounded border-2 border-[#F2B03C] shadow-[0_0_0_1px_rgb(4_8_14/0.5)]"
                  style={{
                    left: pc(retangulo.x1),
                    top: pc(retangulo.y1),
                    width: pc(retangulo.x2 - retangulo.x1),
                    height: pc(retangulo.y2 - retangulo.y1),
                  }}
                />
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
              Arraste sobre a imagem para marcar a região. O que fica escuro está fora da análise.
            </p>
          </section>

          {/* ───────────────────── os números ───────────────────── */}
          <aside aria-label="Ajustes da área" className="flex flex-col gap-3.5">
            <section className={`${CARTAO} flex flex-col gap-3 p-4`}>
              <Titulo>Área</Titulo>

              {zonas.length > 1 && (
                <Campo rotulo="Qual área" htmlFor="area-zona">
                  <select id="area-zona" value={zonaId} onChange={(e) => setZonaId(e.target.value)} className="entrada">
                    {zonas.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.nome}
                        {z.principal ? ' (principal)' : ''}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}

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
                  id="area-nome"
                  value={nomeZona}
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
    </>
  );
}
