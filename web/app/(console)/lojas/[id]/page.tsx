'use client';

// =====================================================================
// O que o Farol viu
// =====================================================================
// A tela inicial de uma loja. Responde, nesta ordem:
//
//   1 · O sistema está conseguindo olhar?   (agente, câmeras, critérios)
//   2 · O que precisa de mim?               (os sinais)
//   3 · Como foi a operação?                (os números e o gráfico)
//   4 · Onde, exatamente?                   (por critério e canal)
//   5 · O que aconteceu por último?         (as ocorrências)
//
// Sem a primeira pergunta, as outras enganam: uma loja calada pode ser
// cozinha em ordem ou sistema parado, e as duas têm a mesma cara.
// =====================================================================

import {
  Activity,
  ArrowRight,
  BellOff,
  Cctv,
  CheckCheck,
  CircleX,
  Clock,
  Cpu,
  ListChecks,
  RefreshCw,
  ScanEye,
  Send,
  Store,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { haQuanto, LIMITE_DO_AGENTE_SEG, useConsole } from '@/componentes/console';
import {
  confiancaEmPorcento,
  desdeAHora,
  horaNaLoja,
  numero,
  plural,
  porcento,
  quandoNaLoja,
  segundos,
} from '@/componentes/formatos';
import { Grafico } from '@/componentes/painel/grafico';
import { Sinais } from '@/componentes/painel/sinais';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Ponto, Segmentado, Titulo, Vazio } from '@/componentes/ui/pecas';
import { Celula, Linha, Tabela } from '@/componentes/ui/tabela';
import { ErroDaApi, resultadosApi, type LinhaDeResultado, type Ocorrencia, type Periodo, type Resultados } from '@/lib/api';

const PERIODOS = [
  { valor: '24h', rotulo: '24 horas' },
  { valor: '7d', rotulo: '7 dias' },
] as const;

/** De quanto em quanto tempo a tela se atualiza sozinha, com a aba à vista. */
const ATUALIZA_MS = 60_000;

// ───────────────────────── um número que conta ─────────────────────────

/** Ao trocar de período, o número CORRE até o novo valor: mostra que mudou
 *  e de quanto. Na primeira vez ele já aparece pronto. */
function Contado({ valor }: { valor: number }) {
  const [mostrado, setMostrado] = useState(valor);
  const anterior = useRef(valor);

  useEffect(() => {
    const de = anterior.current;
    anterior.current = valor;
    if (de === valor || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMostrado(valor);
      return;
    }
    const inicio = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      const p = Math.min(1, (agora - inicio) / 520);
      setMostrado(Math.round(de + (valor - de) * (1 - (1 - p) ** 3)));
      if (p < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [valor]);

  return <>{numero(mostrado)}</>;
}

function Numero({
  rotulo,
  marca,
  valor,
  sufixo,
  pe,
}: {
  rotulo: string;
  marca: React.ReactNode;
  valor: number;
  sufixo?: string;
  pe: string;
}) {
  return (
    <article className={`${CARTAO} flex flex-col gap-0.5 px-4 py-3.5`}>
      <span className="flex items-center gap-[7px] text-[12.5px] text-farol-suave">
        {marca}
        {rotulo}
      </span>
      <span className="font-display text-[26px] font-semibold leading-tight tracking-tight tabular-nums md:text-[30px]">
        <Contado valor={valor} />
        {sufixo && <small className="font-sans text-sm font-medium tracking-normal text-farol-suave">{sufixo}</small>}
      </span>
      <span className="text-xs text-farol-suave">{pe}</span>
    </article>
  );
}

// ───────────────────────── a saúde ─────────────────────────

function Saude({ r, fechada }: { r: Resultados; fechada: boolean }) {
  const agente = r.agentes[0];
  const dePe = r.agentes.some(
    (a) => a.estado === 'ativo' && a.segundos_sem_bater !== null && a.segundos_sem_bater <= LIMITE_DO_AGENTE_SEG,
  );
  const semImagem = r.sinais.find((s) => s.tipo === 'canal_sem_imagem');
  const parados = r.canais.verificados - r.canais.comImagem;
  const desligados = r.criterios.total - r.criterios.ligados;
  // Dos ligados, os que só observam: sem dizer isso, "4 de 4" parece "4 conferindo".
  const soObservam = r.criterios.observando ?? 0;

  const item = 'flex min-w-0 items-start gap-3 px-4 py-3.5 max-md:flex-col max-md:gap-2 max-md:p-3';
  const selo = 'grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] max-md:h-[30px] max-md:w-[30px]';
  const detalhe = 'block text-xs leading-snug text-farol-suave max-md:hidden';

  return (
    <ul className={`${CARTAO} grid grid-cols-3 [&>li+li]:border-l [&>li+li]:border-farol-borda`}>
      <li className={item}>
        <span className={`${selo} ${dePe || r.agentes.length === 0 ? 'bg-farol-realce text-farol-marca' : 'bg-farol-critico-leve text-farol-critico'}`}>
          <Cpu className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <span className="block text-[12.5px] text-farol-suave max-md:text-[11.5px]">Agente</span>
          <span className="flex items-center gap-2 text-[15px] font-semibold max-md:text-sm">
            <Ponto tom={dePe ? 'ok' : r.agentes.length === 0 ? 'neutro' : 'critico'} pulsa={dePe} />
            {dePe ? 'Ativo' : r.agentes.length === 0 ? 'Não instalado' : 'Sem sinal'}
          </span>
          <small className={detalhe}>
            {!agente
              ? 'nada é verificado nesta loja'
              : agente.segundos_sem_bater === null
                ? 'ainda não bateu'
                : `${dePe ? 'bateu' : 'última batida'} ${haQuanto(agente.segundos_sem_bater)}` +
                  (agente.versao ? ` · versão ${agente.versao}` : '')}
          </small>
        </div>
      </li>

      <li className={item}>
        <span className={`${selo} ${parados > 0 ? 'bg-farol-critico-leve text-farol-critico' : 'bg-farol-realce text-farol-marca'}`}>
          <Cctv className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <span className="block text-[12.5px] text-farol-suave max-md:text-[11.5px]">Canais com imagem</span>
          <span className="block text-[15px] font-semibold tabular-nums max-md:text-sm">
            {r.canais.comImagem} de {r.canais.verificados}
          </span>
          <small className={detalhe}>
            {r.canais.verificados === 0
              ? 'nenhum canal com critério ligado'
              : semImagem
                ? `${semImagem.pontoNome} sem imagem ${desdeAHora(semImagem.desde, r.loja.timezone) ?? ''}`
                : 'todos entregando cena'}
          </small>
        </div>
      </li>

      <li className={item}>
        <span className={`${selo} bg-farol-realce text-farol-marca`}>
          <ListChecks className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <span className="block text-[12.5px] text-farol-suave max-md:text-[11.5px]">Critérios ligados</span>
          <span className="block text-[15px] font-semibold tabular-nums max-md:text-sm">
            {r.criterios.ligados} de {r.criterios.total}
          </span>
          <small className={detalhe}>
            {r.criterios.total === 0
              ? 'nenhum critério em canal'
              : desligados === 0
                ? 'todos ligados'
                : `${plural(desligados, 'desligado', 'desligados')}`}
            {soObservam > 0 && ` · ${plural(soObservam, 'só observa', 'só observam')}`}
            {/* Loja fechada: os critérios "no horário" estão certos em não
                rodar — e é isso que explica os números parados. */}
            {fechada && r.criterios.total > 0 && ' · loja fechada agora: os do horário esperam'}
          </small>
        </div>
      </li>
    </ul>
  );
}

// ───────────────────────── a tabela ─────────────────────────

const MARCA: Record<NonNullable<LinhaDeResultado['marca']>, { rotulo: string; tom: 'critico' | 'atencao' }> = {
  sem_imagem: { rotulo: 'sem imagem', tom: 'critico' },
  sem_juiz: { rotulo: 'sem quem julgue', tom: 'atencao' },
  falhando: { rotulo: 'julgamento falhando', tom: 'atencao' },
  avalia_pouco: { rotulo: 'avalia pouco', tom: 'atencao' },
};

function PorCriterio({ r }: { r: Resultados }) {
  return (
    <Tabela
      legenda="Resultado de cada critério em cada canal, no período escolhido"
      colunas={[
        { rotulo: 'Critério' },
        { rotulo: 'Canal' },
        { rotulo: 'Conforme' },
        { rotulo: 'Análises', numero: true },
        { rotulo: 'Fora do critério', numero: true },
        { rotulo: 'Não avaliou', numero: true },
        { rotulo: 'Confiança', numero: true },
        { rotulo: 'Tempo', numero: true },
        { rotulo: 'Última', numero: true },
      ]}
    >
      {r.linhas.map((l) => {
        const marca = l.marca ? MARCA[l.marca] : null;
        return (
          <Linha key={`${l.regraId}-${l.pontoId}`} apagada={l.historico}>
            <Celula inteira>
              <span className="block min-w-0 font-semibold md:min-w-[200px]">{l.regraNome}</span>
            </Celula>
            <Celula rotulo="Canal">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Chip tom="vazado" icone={Cctv}>
                  {l.pontoNome}
                  {l.areaNome && ` · ${l.areaNome}`}
                </Chip>
                {marca && <Chip tom={marca.tom}>{marca.rotulo}</Chip>}
                {l.historico && <Chip>excluído</Chip>}
              </span>
            </Celula>
            <Celula rotulo="Conforme" inteira>
              {l.analises > 0 ? (
                <div className="flex min-w-[150px] items-center gap-2.5">
                  <span
                    className="flex h-2 flex-1 overflow-hidden rounded-full bg-farol-realce"
                    title={`${numero(l.conformes)} conforme, ${numero(l.naoConformes)} fora do critério, ${numero(l.naoAvaliaveis)} sem avaliar`}
                  >
                    <i className="block h-full bg-farol-critico" style={{ width: `${(l.naoConformes / l.analises) * 100}%` }} />
                    <i className="block h-full bg-farol-graf-na" style={{ width: `${(l.naoAvaliaveis / l.analises) * 100}%` }} />
                    <i className="block h-full bg-farol-graf-ok" style={{ width: `${(l.conformes / l.analises) * 100}%` }} />
                  </span>
                  <b className="min-w-[38px] text-right font-mono text-[12.5px] font-semibold tabular-nums">
                    {porcento(l.conformes, l.analises)}%
                  </b>
                </div>
              ) : (
                <span className="text-farol-suave">nada julgado</span>
              )}
            </Celula>
            <Celula rotulo="Análises" numero>
              {numero(l.analises)}
            </Celula>
            <Celula rotulo="Fora do critério" numero>
              {numero(l.naoConformes)}
            </Celula>
            <Celula rotulo="Não avaliou" numero>
              {numero(l.naoAvaliaveis)}
            </Celula>
            <Celula rotulo="Confiança média" numero>
              {confiancaEmPorcento(l.confiancaMedia)}
            </Celula>
            <Celula rotulo="Tempo médio" numero>
              {segundos(l.latenciaMediaMs)}
            </Celula>
            <Celula rotulo="Última análise" numero>
              {quandoNaLoja(l.ultimaEm, r.loja.timezone, r.agora)}
            </Celula>
          </Linha>
        );
      })}
    </Tabela>
  );
}

// ───────────────────────── as ocorrências ─────────────────────────

function Aviso({ estado }: { estado: Ocorrencia['aviso'] }) {
  if (estado === 'entregue') return <Chip tom="ok" icone={CheckCheck}>aviso chegou</Chip>;
  if (estado === 'enviado') return <Chip tom="atencao" icone={Send}>aviso mandado</Chip>;
  if (estado === 'pendente') return <Chip icone={Clock}>aviso na fila</Chip>;
  if (estado === 'falhou') return <Chip tom="critico" icone={CircleX}>aviso falhou</Chip>;
  return <Chip icone={BellOff}>sem aviso</Chip>;
}

function Ocorrencias({ r }: { r: Resultados }) {
  return (
    <ul className={`${CARTAO} flex flex-col`}>
      {r.ocorrencias.map((o) => (
        <li
          key={o.id}
          className="grid grid-cols-[46px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-1 px-4 py-[13px] md:grid-cols-[minmax(52px,auto)_minmax(0,1fr)_auto] [&+li]:border-t [&+li]:border-farol-borda"
        >
          <time dateTime={o.ocorridoEm} className="pt-0.5 font-mono text-[12.5px] font-medium text-farol-suave">
            {r.periodo === '24h' ? horaNaLoja(o.ocorridoEm, r.loja.timezone) : quandoNaLoja(o.ocorridoEm, r.loja.timezone, r.agora)}
          </time>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-semibold">
              {o.regraNome ?? 'Critério excluído'}
              {o.pontoNome && (
                <Chip tom="vazado" icone={Cctv}>
                  {o.pontoNome}
                  {o.areaNome && ` · ${o.areaNome}`}
                </Chip>
              )}
            </div>
            {o.motivo && <p className="text-[13px] text-farol-suave">{o.motivo}</p>}
          </div>
          <div className="col-start-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 md:col-start-3 md:flex-col md:items-end">
            <Aviso estado={o.aviso} />
            {o.confianca !== null && (
              <span className="font-mono text-xs text-farol-suave">confiança {confiancaEmPorcento(o.confianca)}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── a tela ─────────────────────────

export default function PainelDaLoja() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura, veResultados } = useConsole();
  const [periodo, setPeriodo] = useState<Periodo>('24h');
  const [r, setR] = useState<Resultados | null>(null);
  const [erro, setErro] = useState<{ texto: string; semPermissao: boolean } | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const buscar = useCallback(
    async (forcar: boolean) => {
      setAtualizando(true);
      try {
        const novo = await resultadosApi.obter(id, periodo, forcar);
        setR(novo);
        setErro(null);
      } catch (e) {
        const semPermissao = e instanceof ErroDaApi && e.status === 403;
        setErro({ texto: e instanceof ErroDaApi ? e.message : 'não deu certo', semPermissao });
      } finally {
        setAtualizando(false);
      }
    },
    [id, periodo],
  );

  useEffect(() => {
    if (!veResultados) return;
    void buscar(false);
    // A tela é para ficar aberta: ela se atualiza sozinha, mas só com a aba
    // à vista — console esquecido aberto não fica consultando o banco.
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void buscar(true);
    }, ATUALIZA_MS);
    return () => clearInterval(t);
  }, [buscar, veResultados]);

  // O que está na tela é de outro período enquanto o novo não chega.
  const doPeriodo = r && r.periodo === periodo ? r : null;
  const dados = doPeriodo ?? r;

  const cabecalho = (
    <Cabecalho
      sobre={
        <>
          <Store className="h-[15px] w-[15px]" aria-hidden />
          {loja?.nome ?? dados?.loja.nome ?? 'Loja'}
        </>
      }
      titulo="O que o Farol viu"
      acoes={
        veResultados && (
          <>
            <Segmentado rotulo="Período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
            <Botao
              variante="fantasma"
              quadrado
              aria-label="Atualizar agora"
              title="Atualizar agora"
              onClick={() => void buscar(true)}
              disabled={atualizando}
              className="!flex-none"
            >
              <RefreshCw className={`h-[18px] w-[18px] ${atualizando ? 'animate-spin' : ''}`} aria-hidden />
            </Botao>
          </>
        )
      }
    >
      Tudo o que foi analisado nas câmeras desta loja, por critério e por canal.
    </Cabecalho>
  );

  if (!veResultados || erro?.semPermissao) {
    return (
      <>
        {cabecalho}
        <Vazio icone={ScanEye} titulo="Os resultados ficam com a gestão">
          Esta tela é vista pela supervisão, pela gerência e pela diretoria. Você continua com acesso aos canais e
          aos critérios da loja.
        </Vazio>
      </>
    );
  }

  if (!dados) {
    return (
      <>
        {cabecalho}
        {erro ? (
          <Alerta tom="critico" papel="alert">
            <p>Não consegui buscar os resultados: {erro.texto}.</p>
            <Botao mini className="mt-2" onClick={() => void buscar(true)}>
              Tentar de novo
            </Botao>
          </Alerta>
        ) : (
          <Ossos alturas={[74, [96, 96, 96, 96], 230]} />
        )}
      </>
    );
  }

  const t = dados.totais;
  const baldes = dados.serie.pontos.length;
  const lojaNova = !dados.temHistorico;

  return (
    <>
      {cabecalho}

      {erro && (
        <Alerta tom="atencao" papel="status">
          Não consegui atualizar agora ({erro.texto}). O que está na tela é de {horaNaLoja(dados.agora, dados.loja.timezone)}.
        </Alerta>
      )}

      <Saude r={dados} fechada={loja?.aberta_agora === false} />

      {lojaNova ? (
        <>
          {dados.sinais.length > 0 && (
            <section aria-labelledby="t-atencao" className="flex min-w-0 flex-col gap-3">
              <Titulo id="t-atencao" conta={dados.sinais.length}>
                Precisa de atenção
              </Titulo>
              <Sinais sinais={dados.sinais} lojaId={id} fuso={dados.loja.timezone} />
            </section>
          )}
          <Vazio
            icone={ScanEye}
            titulo="Ainda não há o que mostrar"
            acao={
              configura && (
                <Link href={`/lojas/${id}/canais`} className={classesDoBotao({ variante: 'primario' })}>
                  {dados.canais.verificados === 0 ? 'Ver os canais da loja' : 'Ver os canais'}
                  <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
                </Link>
              )
            }
          >
            O Farol começa a registrar quando a loja tem o agente de pé, pelo menos um canal com imagem e um
            critério ligado. O primeiro resultado aparece aqui em poucos minutos.
          </Vazio>
        </>
      ) : (
        <>
          <div
            className={`grid grid-cols-[minmax(0,1fr)] gap-5 transition-opacity md:gap-6 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] xl:items-start ${
              doPeriodo ? '' : 'opacity-60'
            }`}
          >
            {/* No computador os sinais ficam ao lado; nas telas menores vêm
                ANTES dos números — o que precisa de mim vem primeiro. */}
            <section aria-labelledby="t-atencao" className="flex min-w-0 flex-col gap-3 xl:order-2">
              <Titulo id="t-atencao" conta={dados.sinais.length}>
                Precisa de atenção
              </Titulo>
              <Sinais sinais={dados.sinais} lojaId={id} fuso={dados.loja.timezone} />
            </section>

            <div className="flex min-w-0 flex-col gap-5 md:gap-6 xl:order-1">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Numero
                rotulo="Análises"
                marca={<Activity className="h-[15px] w-[15px]" aria-hidden />}
                valor={t.analises}
                pe={`${numero(Math.floor(t.analises / Math.max(1, baldes)))} por ${dados.serie.passo === 'hora' ? 'hora' : 'dia'}, em média`}
              />
              <Numero
                rotulo="Conforme"
                marca={<Ponto tom="ok" />}
                valor={porcento(t.conformes, t.analises)}
                sufixo="%"
                pe={plural(t.conformes, 'análise', 'análises')}
              />
              <Numero
                rotulo="Fora do critério"
                marca={<Ponto tom="critico" />}
                valor={t.naoConformes}
                pe={`${porcento(t.naoConformes, t.analises)}% das análises`}
              />
              <Numero
                rotulo="Não deu para avaliar"
                marca={<Ponto />}
                valor={porcento(t.naoAvaliaveis, t.analises)}
                sufixo="%"
                pe={plural(t.naoAvaliaveis, 'análise', 'análises')}
              />
            </div>

            <Grafico serie={dados.serie} periodo={dados.periodo} />
            <Link href={`/lojas/${id}/analises`} className="elo self-start text-[13px]">
              Explorar por hora, canal e custo
              <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
            </Link>
            </div>
          </div>

          <section aria-labelledby="t-porcrit" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Titulo id="t-porcrit">Por critério e canal</Titulo>
              <span className="text-[12.5px] text-farol-suave md:ml-auto">
                Do que mais ficou fora do critério para o que menos ficou.
              </span>
            </div>
            {dados.linhas.length > 0 ? (
              <PorCriterio r={dados} />
            ) : (
              <p className={`${CARTAO} px-4 py-6 text-farol-suave`}>
                Nenhum critério foi olhado neste período.
              </p>
            )}
          </section>

          <section aria-labelledby="t-ocorr" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Titulo id="t-ocorr">Últimas vezes fora do critério</Titulo>
              <Link href={`/lojas/${id}/alertas`} className="elo text-[13px] md:ml-auto">
                Ver se o aviso chegou
                <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
              </Link>
            </div>
            {dados.ocorrencias.length > 0 ? (
              <Ocorrencias r={dados} />
            ) : (
              <p className={`${CARTAO} px-4 py-6 text-farol-suave`}>
                Nada ficou fora do critério neste período.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
