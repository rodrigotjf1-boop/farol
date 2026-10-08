'use client';

// =====================================================================
// Análises
// =====================================================================
// O Painel responde "está tudo bem?". Esta tela responde "o que foi
// julgado, onde, por quem e quanto custou":
//
//   1 · Que recorte estou olhando?      (os filtros e a frase do recorte)
//   2 · Quanto foi, e no que deu?       (os números)
//   3 · Em que hora? Em que canal?      (os dois gráficos, que também filtram)
//   4 · A máquina está dando conta?     (o uso do computador da loja)
//   5 · Em que critério, e a que custo? (a tabela)
//   6 · O que virou aviso?              (a lista)
//
// A API entrega o miúdo do período e a tela recorta aqui: trocar hora,
// canal, critério ou "onde foi julgado" responde na hora, sem ir ao
// servidor. Só o período vai.
// =====================================================================

import { Activity, ArrowRight, ChartColumn, Coins, Cpu, FilterX, RefreshCw, ScanEye, Store } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  baldes as montarBaldes,
  dinheiro,
  dinheiroFino,
  diaMenos,
  FILTROS_PADRAO,
  hh,
  horasCom,
  intervaloDoPeriodo,
  linhas as montarLinhas,
  recortar,
  recortarAvisos,
  rotuloDoDia,
  somar,
  type Balde,
  type Filtros,
  type Soma,
  type Vista,
} from '@/componentes/analises/conta';
import { FiltrosDasAnalises } from '@/componentes/analises/filtros';
import { GraficoDeHoras } from '@/componentes/analises/grafico-de-horas';
import { MaquinaDeAnalise } from '@/componentes/analises/maquina';
import { PorCanal } from '@/componentes/analises/por-canal';
import { AvisosDoRecorte, PorCriterioECanal } from '@/componentes/analises/tabela-e-avisos';
import { useConsole } from '@/componentes/console';
import { horaNaLoja, numero, plural, porcento } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Ossos, Ponto, Titulo, Vazio } from '@/componentes/ui/pecas';
import { analisesApi, ErroDaApi, type Analises } from '@/lib/api';

/** De quanto em quanto tempo a tela se atualiza sozinha, com a aba à vista. */
const ATUALIZA_MS = 60_000;

// ───────────────────────── os números ─────────────────────────

const CAIXA = `${CARTAO} flex flex-col gap-0.5 px-4 py-3.5`;
const ROTULO = 'flex items-center gap-[7px] text-[12.5px] text-farol-suave';
const GRANDE = 'whitespace-nowrap font-display text-[22px] font-semibold leading-tight tracking-tight tabular-nums md:text-[26px]';
const PEQUENO = 'font-sans text-sm font-medium tracking-normal text-farol-suave';
const PE = 'text-xs text-farol-suave';

function Numeros({ s, recorte }: { s: Soma; recorte: Analises['celulas'] }) {
  const horas = Math.max(1, horasCom(recorte));
  const horasComCusto = Math.max(1, horasCom(recorte, (c) => c.custoCentavos > 0));

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <article className={CAIXA}>
        <span className={ROTULO}>
          <Activity className="h-[15px] w-[15px]" aria-hidden />
          Análises
        </span>
        <span className={GRANDE} data-numero="total">
          {numero(s.analises)}
        </span>
        <span className={PE}>{numero(Math.round(s.analises / horas))} por hora, em média</span>
      </article>

      <article className={CAIXA}>
        <span className={ROTULO}>
          <Ponto tom="ok" />
          Conforme
        </span>
        <span className={GRANDE}>
          {porcento(s.conformes, s.analises)}
          <small className={PEQUENO}>%</small>
        </span>
        <span className={PE}>{plural(s.conformes, 'análise', 'análises')}</span>
      </article>

      <article className={CAIXA}>
        <span className={ROTULO}>
          <Ponto tom="critico" />
          Fora do critério
        </span>
        <span className={GRANDE} data-numero="fora">
          {numero(s.fora)}
        </span>
        <span className={PE}>
          {porcento(s.fora, s.analises)}% das análises · {plural(s.avisos, 'aviso', 'avisos')}
        </span>
      </article>

      <article className={CAIXA}>
        <span className={ROTULO}>
          <Ponto />
          Não deu para avaliar
        </span>
        <span className={GRANDE}>
          {porcento(s.naoAvaliou, s.analises)}
          <small className={PEQUENO}>%</small>
        </span>
        <span className={PE}>{plural(s.naoAvaliou, 'análise', 'análises')}</span>
      </article>

      <article className={CAIXA}>
        <span className={ROTULO}>
          <Cpu className="h-[15px] w-[15px]" aria-hidden />
          Onde foi julgado
        </span>
        <span
          role="img"
          aria-label={`${porcento(s.naLoja, s.analises)}% na loja e ${porcento(s.naNuvem, s.analises)}% na nuvem`}
          className="my-[9px] flex h-3 gap-0.5 overflow-hidden rounded-full bg-farol-realce"
        >
          <i className="block h-full min-w-0 bg-farol-marca" style={{ flex: `${s.naLoja} 1 0` }} />
          <i className="block h-full min-w-0 bg-farol-facho" style={{ flex: `${s.naNuvem} 1 0` }} />
        </span>
        <span className={PE}>
          <span className="block">
            <b className="font-semibold text-farol-tinta" data-numero="loja">
              {numero(s.naLoja)}
            </b>{' '}
            na loja ({porcento(s.naLoja, s.analises)}%)
          </span>
          <span className="block">
            <b className="font-semibold text-farol-tinta" data-numero="nuvem">
              {numero(s.naNuvem)}
            </b>{' '}
            na nuvem ({porcento(s.naNuvem, s.analises)}%)
          </span>
        </span>
      </article>

      <article className={CAIXA}>
        <span className={ROTULO}>
          <Coins className="h-[15px] w-[15px]" aria-hidden />
          Custo da nuvem
        </span>
        <span className={GRANDE} data-numero="custo">
          {dinheiro(s.custoCentavos)}
        </span>
        <span className={PE}>
          {s.naNuvem > 0 ? (
            <>
              <span className="block">{dinheiroFino(s.custoCentavos / s.naNuvem)} por análise</span>
              <span className="block">{dinheiro(s.custoCentavos / horasComCusto)} por hora</span>
            </>
          ) : (
            'nenhuma análise na nuvem neste recorte'
          )}
        </span>
      </article>
    </div>
  );
}

// ───────────────────────── a frase do recorte ─────────────────────────

function FraseDoRecorte({ f, dados, total }: { f: Filtros; dados: Analises; total: number }) {
  const periodo =
    f.periodo === 'hoje'
      ? `Hoje, ${rotuloDoDia(dados.de)}`
      : f.periodo === 'ontem'
        ? `Ontem, ${rotuloDoDia(dados.de)}`
        : f.periodo === '7d'
          ? `Últimos 7 dias, de ${rotuloDoDia(dados.de)} a ${rotuloDoDia(dados.ate)}`
          : rotuloDoDia(dados.de);
  const horas = f.de === 0 && f.ate === 24 ? 'o dia inteiro' : `das ${hh(f.de)} às ${hh(f.ate)}`;
  const canal = f.canal ? (dados.canais.find((c) => c.id === f.canal)?.nome ?? 'canal excluído') : 'todos os canais';
  const criterio = f.criterio ? `“${dados.criterios.find((c) => c.id === f.criterio)?.nome ?? 'critério excluído'}”` : 'todos os critérios';
  const onde = f.onde === 'loja' ? 'só o que foi julgado na loja' : f.onde === 'nuvem' ? 'só o que foi julgado na nuvem' : 'na loja e na nuvem';
  return (
    <p aria-live="polite" data-recorte className="min-w-0 flex-[1_1_280px] text-[13.5px] text-farol-suave">
      <b className="font-semibold text-farol-tinta">{periodo}</b>, {horas} ·{' '}
      <b className="font-semibold text-farol-tinta">{canal}</b> · {criterio} · {onde} — {plural(total, 'análise', 'análises')}
    </p>
  );
}

// ───────────────────────── a tela ─────────────────────────

export default function AnalisesDaLoja() {
  const { id } = useParams<{ id: string }>();
  const { loja, veResultados } = useConsole();
  const avisar = useAvisar();

  const [filtros, setFiltros] = useState<Filtros>({ ...FILTROS_PADRAO, dia: '' });
  const [vista, setVista] = useState<Vista>('resultado');
  const [dados, setDados] = useState<Analises | null>(null);
  /** O dia de hoje NA LOJA, dito pelo servidor na primeira resposta. */
  const [hoje, setHoje] = useState<string | null>(null);
  const [erro, setErro] = useState<{ texto: string; semPermissao: boolean } | null>(null);
  const [buscando, setBuscando] = useState(false);

  // Só o período vai ao servidor. Sem saber que dia é hoje na loja, pede-se
  // "hoje" sem datas e o servidor responde com a dele.
  const intervalo = useMemo(() => {
    if (filtros.periodo === 'hoje' || !hoje) return null;
    if (filtros.periodo === 'dia' && !filtros.dia) return null;
    return intervaloDoPeriodo(filtros, hoje);
  }, [filtros.periodo, filtros.dia, hoje]); // eslint-disable-line react-hooks/exhaustive-deps
  const chaveDoIntervalo = intervalo ? `${intervalo.de}:${intervalo.ate}` : 'hoje';

  const buscar = useCallback(
    async (forcar: boolean) => {
      setBuscando(true);
      try {
        const novo = await analisesApi.obter(id, intervalo, forcar);
        setDados(novo);
        setHoje(novo.hoje);
        setErro(null);
      } catch (e) {
        const semPermissao = e instanceof ErroDaApi && e.status === 403;
        setErro({ texto: e instanceof ErroDaApi ? e.message : 'não deu certo', semPermissao });
      } finally {
        setBuscando(false);
      }
    },
    // `chaveDoIntervalo` é o intervalo em texto: o objeto muda a cada desenho.
    [id, chaveDoIntervalo], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!veResultados) return;
    void buscar(false);
    // A tela é para ficar aberta: ela se atualiza sozinha, mas só com a aba
    // à vista, e só quando o recorte inclui hoje — o que passou não muda.
    if (filtros.periodo !== 'hoje' && filtros.periodo !== '7d') return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void buscar(true);
    }, ATUALIZA_MS);
    return () => clearInterval(t);
  }, [buscar, veResultados, filtros.periodo]);

  const mudar = useCallback(
    (parte: Partial<Filtros>) =>
      setFiltros((f) => {
        const novo = { ...f, ...parte };
        // "Outro dia" começa em anteontem: hoje e ontem já têm o seu botão.
        if (novo.periodo === 'dia' && !novo.dia && hoje) novo.dia = diaMenos(hoje, 2);
        return novo;
      }),
    [hoje],
  );

  // O que está na tela é de outro período enquanto o novo não chega.
  const esperado = intervalo ?? (hoje ? { de: hoje, ate: hoje } : null);
  const doPeriodo = dados && (!esperado || (dados.de === esperado.de && dados.ate === esperado.ate));

  const cabecalho = (
    <Cabecalho
      sobre={
        <>
          <Store className="h-[15px] w-[15px]" aria-hidden />
          {loja?.nome ?? dados?.loja.nome ?? 'Loja'}
        </>
      }
      titulo="Análises"
      acoes={
        veResultados && (
          <Botao
            variante="fantasma"
            quadrado
            aria-label="Atualizar agora"
            title="Atualizar agora"
            onClick={() => void buscar(true)}
            disabled={buscando}
            className="!flex-none"
          >
            <RefreshCw className={`h-[18px] w-[18px] ${buscando ? 'animate-spin' : ''}`} aria-hidden />
          </Botao>
        )
      }
    >
      O que foi julgado nas câmeras, hora a hora: em que canal, onde foi julgado e quanto custou.
    </Cabecalho>
  );

  if (!veResultados || erro?.semPermissao) {
    return (
      <>
        {cabecalho}
        <Vazio icone={ScanEye} titulo="As análises ficam com a gestão">
          Esta tela é vista pela supervisão, pela gerência e pela diretoria. Você continua com acesso aos canais e aos
          critérios da loja.
        </Vazio>
      </>
    );
  }

  const filtrosNaTela = <FiltrosDasAnalises filtros={filtros} aoMudar={mudar} dados={dados} hoje={hoje} />;

  if (!dados) {
    return (
      <>
        {cabecalho}
        {filtrosNaTela}
        {erro ? (
          <Alerta tom="critico" papel="alert">
            <p>Não consegui buscar as análises: {erro.texto}.</p>
            <Botao mini className="mt-2" onClick={() => void buscar(true)}>
              Tentar de novo
            </Botao>
          </Alerta>
        ) : (
          <Ossos alturas={[[96, 96, 96, 96], 260, 200]} />
        )}
      </>
    );
  }

  // ── o recorte, e o que se tira dele ──
  const recorte = recortar(dados.celulas, filtros);
  const total = somar(recorte);
  const osBaldes = montarBaldes(dados, filtros);
  const semCanal = recortar(dados.celulas, filtros, 'canal');
  const porCanal = new Map(dados.canais.map((c) => [c.id, somar(semCanal.filter((x) => x.pontoId === c.id))]));
  const asLinhas = montarLinhas(recorte);
  const osAvisos = recortarAvisos(dados.avisos, filtros);
  const variosDias = dados.de !== dados.ate;
  const haAnalise = dados.celulas.some((c) => c.analises > 0);
  const mexeu =
    filtros.periodo !== FILTROS_PADRAO.periodo ||
    filtros.de !== 0 || filtros.ate !== 24 || filtros.canal !== '' || filtros.criterio !== '' || filtros.onde !== 'tudo';

  const limpar = () => {
    setFiltros((f) => ({ ...FILTROS_PADRAO, dia: f.dia }));
    avisar('Filtros limpos: hoje, o dia inteiro, todos os canais.');
  };

  const escolher = (b: Balde) => {
    if (b.hora !== undefined) {
      const jaEra = filtros.de === b.hora && filtros.ate === b.hora + 1;
      mudar(jaEra ? { de: 0, ate: 24 } : { de: b.hora, ate: b.hora + 1 });
      return;
    }
    // um dia do gráfico de dias: abre o dia, hora a hora
    if (b.dia === dados.hoje) mudar({ periodo: 'hoje' });
    else if (b.dia === diaMenos(dados.hoje, 1)) mudar({ periodo: 'ontem' });
    else mudar({ periodo: 'dia', dia: b.dia });
  };

  return (
    <>
      {cabecalho}

      {erro && (
        <Alerta tom="atencao" papel="status">
          Não consegui atualizar agora ({erro.texto}). O que está na tela é de {horaNaLoja(dados.agora, dados.loja.timezone)}.
        </Alerta>
      )}

      {filtrosNaTela}

      <div className={`flex min-w-0 flex-col gap-5 transition-opacity md:gap-6 ${doPeriodo ? '' : 'opacity-60'}`}>
        <div className="-my-2 flex min-h-9 flex-wrap items-center gap-x-3.5 gap-y-2">
          <FraseDoRecorte f={filtros} dados={dados} total={total.analises} />
          {mexeu && (
            <Botao variante="fantasma" mini onClick={limpar}>
              <FilterX className="h-[15px] w-[15px]" aria-hidden />
              Limpar filtros
            </Botao>
          )}
        </div>

        {total.analises === 0 && (
          <div
            data-sem-analise
            className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-farol-borda-forte px-5 py-7 text-center"
          >
            <span className="mb-1 grid h-[52px] w-[52px] place-items-center rounded-2xl bg-farol-realce text-farol-marca">
              <ChartColumn className="h-[22px] w-[22px]" aria-hidden />
            </span>
            <h2 className="font-display text-lg font-semibold">
              {haAnalise ? 'Nada foi analisado neste recorte' : 'Nada foi analisado neste período'}
            </h2>
            <p className="max-w-[52ch] text-farol-suave">
              {haAnalise
                ? 'Nenhum critério foi conferido nestas horas, neste canal. Escolha outra hora no gráfico abaixo ou limpe os filtros.'
                : 'Nenhum critério foi julgado nas câmeras desta loja nestes dias. Escolha outro período, ou veja no Painel se o agente e os canais estão de pé.'}
            </p>
            {mexeu && (
              <Botao className="mt-2" onClick={limpar}>
                <FilterX className="h-[18px] w-[18px]" aria-hidden />
                Limpar filtros
              </Botao>
            )}
          </div>
        )}

        {total.analises > 0 && <Numeros s={total} recorte={recorte} />}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:gap-6 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] xl:items-start">
          <GraficoDeHoras
            baldes={osBaldes}
            vista={vista}
            aoMudarVista={setVista}
            de={filtros.de}
            ate={filtros.ate}
            aoEscolher={escolher}
          />
          <PorCanal
            canais={dados.canais}
            somas={porCanal}
            vista={vista}
            escolhido={filtros.canal}
            aoEscolher={(canal) => mudar({ canal })}
          />
        </div>

        {/* A máquina aparece sempre, com ou sem análise no recorte: o uso é
            dela inteira, não do canal nem do critério escolhidos. */}
        <MaquinaDeAnalise dados={dados} filtros={filtros} baldes={osBaldes} recorte={recorte} aoEscolher={escolher} />

        {total.analises > 0 && (
          <>
            <section aria-labelledby="t-an-tabela" className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Titulo id="t-an-tabela">Por critério e canal</Titulo>
                <span className="text-[12.5px] text-farol-suave md:ml-auto">
                  Do que mais ficou fora do critério para o que menos ficou.
                </span>
              </div>
              <PorCriterioECanal linhas={asLinhas} total={total} dados={dados} />
              <p className="max-w-[70ch] text-[12.5px] text-farol-suave">
                O custo é uma estimativa: o preço de tabela do modelo usado, convertido com o dólar a R$ 5,40. A conta de
                verdade vem na fatura do provedor. Análise feita na loja não tem custo por análise.
              </p>
            </section>

            <section aria-labelledby="t-an-avisos" className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Titulo id="t-an-avisos" conta={Math.max(total.avisos, osAvisos.length)}>
                  Avisos neste recorte
                </Titulo>
                <Link href={`/lojas/${id}/alertas`} className="elo text-[13px] md:ml-auto">
                  Ver se o aviso chegou
                  <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                </Link>
              </div>
              <AvisosDoRecorte avisos={osAvisos} quantos={total.avisos} dados={dados} variosDias={variosDias} />
              <p className="max-w-[70ch] text-[12.5px] text-farol-suave">
                Toda olhada fora do critério entra na contagem acima. Vira aviso — com hora, motivo e imagem — a primeira
                de cada período de silêncio do critério.
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
