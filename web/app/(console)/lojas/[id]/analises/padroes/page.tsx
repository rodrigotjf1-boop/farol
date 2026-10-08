'use client';

// =====================================================================
// Padrões — como a loja costuma funcionar, e o que fugiu disso
// =====================================================================
// "Análises" responde o que foi julgado. Esta tela responde o que vem
// depois: como a loja costuma funcionar (frequência), o que fugiu disso
// (anomalia), para onde os números apontam (tendência) e o que fazer com
// os critérios (sugestões).
//
// Tudo sai de número guardado por hora — a medida de cada olhada, o que
// ficou fora do critério e o que não deu para avaliar. Nenhuma imagem
// entra na conta, e a conta é toda do servidor: aqui só se escolhe o que
// olhar e se responde ao que fugiu do padrão.
// =====================================================================

import { ArrowRight, CalendarDays, ChartColumn, Lightbulb, RefreshCw, Repeat, ScanEye, Store, TrendingUp, TriangleAlert, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { abasDeAnalises } from '@/componentes/analises/abas-de-analises';
import { useConsole } from '@/componentes/console';
import { GavetaDoCriterio } from '@/componentes/criterios/formulario-criterio';
import { ajustesEmLinha } from '@/componentes/criterios/opcoes';
import { plural } from '@/componentes/formatos';
import { GavetaDeCorrecao, GavetaDeEsperado, type Depois } from '@/componentes/padroes/gavetas';
import { Anomalias, Frequencia, Sugestoes, Tendencia, type FiltroDeSaidas } from '@/componentes/padroes/lentes';
import { diaEMes, doSetor, Texto } from '@/componentes/padroes/pecas';
import { Abas } from '@/componentes/ui/abas';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Ossos, Segmentado, Titulo, Vazio } from '@/componentes/ui/pecas';
import {
  consoleApi,
  ErroDaApi,
  especialistaApi,
  regrasApi,
  resultadosApi,
  type CriterioProposto,
  type Padroes,
  type Regra,
  type SaidaDoPadrao,
  type Setor,
  type SugestaoDoPadrao,
} from '@/lib/api';

type Lente = 'frequencia' | 'anomalias' | 'tendencia' | 'sugestoes';
/** A gaveta de critério aberta daqui: um proposto (novo, preenchido) ou um que já existe. */
type CriterioAberto = { chave: string; proposto?: CriterioProposto; regra?: Regra; porteiro?: 'pessoa' };

const LENTES: ReadonlyArray<{ valor: Lente; rotulo: string; icone: LucideIcon }> = [
  { valor: 'frequencia', rotulo: 'Frequência', icone: Repeat },
  { valor: 'anomalias', rotulo: 'Anomalias', icone: TriangleAlert },
  { valor: 'tendencia', rotulo: 'Tendência', icone: TrendingUp },
  { valor: 'sugestoes', rotulo: 'Sugestões', icone: Lightbulb },
];

export default function PadroesDaLoja() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura, veResultados, atualizar } = useConsole();
  const avisar = useAvisar();

  const [dados, setDados] = useState<Padroes | null>(null);
  const [erro, setErro] = useState<{ texto: string; semPermissao: boolean } | null>(null);
  const [buscando, setBuscando] = useState(false);

  const [setor, setSetor] = useState('todos');
  const [lente, setLente] = useState<Lente>('frequencia');
  const [indicador, setIndicador] = useState('');
  const [celula, setCelula] = useState('');
  const [filtro, setFiltro] = useState<FiltroDeSaidas>('rever');
  const [hojeInd, setHojeInd] = useState('');
  const asLentes = useRef<HTMLDivElement>(null);

  const [esperado, setEsperado] = useState<SaidaDoPadrao | null>(null);
  const [correcao, setCorrecao] = useState<SaidaDoPadrao | null>(null);
  const [criterio, setCriterio] = useState<CriterioAberto | null>(null);
  // o que a gaveta de critério precisa: os canais, o que o detector conhece e os critérios que já existem
  const [setores, setSetores] = useState<Setor[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [objetos, setObjetos] = useState<string[]>([]);

  const buscar = useCallback(
    async (forcar: boolean) => {
      setBuscando(true);
      try {
        setDados(await especialistaApi.obter(id, forcar));
        setErro(null);
      } catch (e) {
        setErro({ texto: e instanceof ErroDaApi ? e.message : 'não deu certo', semPermissao: e instanceof ErroDaApi && e.status === 403 });
      } finally {
        setBuscando(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (veResultados) void buscar(false);
  }, [buscar, veResultados]);

  // Os canais e os critérios só servem a quem pode abrir a gaveta de critério.
  const carregarCriterios = useCallback(async () => {
    const [l, r] = await Promise.all([consoleApi.loja(id), regrasApi.listar(id)]);
    setSetores(l.setores);
    setRegras(r.regras);
    setObjetos(r.detector?.objetos ?? []);
    return r.regras;
  }, [id]);
  useEffect(() => {
    if (configura && veResultados) void carregarCriterios().catch(() => undefined);
  }, [carregarCriterios, configura, veResultados]);

  /** Do parecer para a lente: troca, e leva a tela até as lentes. */
  function irPara(nova: Lente) {
    setLente(nova);
    if (nova === 'anomalias' && dados) setFiltro(dados.aRever > 0 ? 'rever' : 'revistas');
    requestAnimationFrame(() => asLentes.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  /** Os ajustes de hoje de um critério, para a prévia de "ajustar um critério que já existe". */
  const ajustesDe = (regraId: string | undefined): string | undefined => {
    const regra = regras.find((r) => r.id === regraId);
    return regra && ajustesEmLinha(regra);
  };

  const abrirCriterio = (c: Omit<CriterioAberto, 'chave'>) => setCriterio({ ...c, chave: `${c.proposto?.nome ?? c.regra?.id ?? ''}-${Date.now()}` });

  /** O critério que já existe, para a gaveta de edição. Se a lista envelheceu, busca de novo. */
  async function abrirExistente(regraId: string, porteiro?: 'pessoa') {
    try {
      const regra = regras.find((r) => r.id === regraId) ?? (await carregarCriterios()).find((r) => r.id === regraId);
      if (!regra) {
        setErro({ texto: 'este critério não existe mais', semPermissao: false });
        return;
      }
      abrirCriterio({ regra, porteiro });
    } catch (e) {
      setErro({ texto: e instanceof ErroDaApi ? e.message : 'não consegui abrir o critério', semPermissao: false });
    }
  }

  function agir(s: SugestaoDoPadrao) {
    if (s.acao.tipo === 'criar') abrirCriterio({ proposto: s.acao.criterio });
    else if (s.acao.tipo === 'criterio') void abrirExistente(s.acao.regraId, s.acao.porteiro);
  }

  /** A correção foi registrada: depois que a gaveta dela fecha, abre a do critério. */
  function corrigida(novo: Padroes, depois: Depois) {
    const a = correcao;
    setDados(novo);
    setCorrecao(null);
    avisar('Correção registrada.');
    if (!a || depois === 'nada') return;
    if (depois === 'criar' && a.criterio) abrirCriterio({ proposto: a.criterio });
    else if (depois === 'ajustar' && a.ajustar) void abrirExistente(a.ajustar.regraId);
  }

  const cabecalho = (
    <>
      <Cabecalho
        sobre={
          <>
            <Store className="h-[15px] w-[15px]" aria-hidden />
            {loja?.nome ?? dados?.loja.nome ?? 'Loja'}
          </>
        }
        titulo="Padrões"
        acoes={
          veResultados && (
            <Botao variante="fantasma" quadrado aria-label="Atualizar agora" title="Atualizar agora" onClick={() => void buscar(true)} disabled={buscando} className="!flex-none">
              <RefreshCw className={`h-[18px] w-[18px] ${buscando ? 'animate-spin' : ''}`} aria-hidden />
            </Botao>
          )
        }
      >
        Como a loja costuma funcionar, o que fugiu disso e para onde os números apontam.
      </Cabecalho>
      {veResultados && !erro?.semPermissao && <Abas rotulo="Vistas das análises" abas={abasDeAnalises(id, dados?.aRever)} />}
    </>
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

  if (!dados) {
    return (
      <>
        {cabecalho}
        {erro ? (
          <Alerta tom="critico" papel="alert">
            <p>Não consegui montar os padrões: {erro.texto}.</p>
            <Botao mini className="mt-2" onClick={() => void buscar(true)}>
              Tentar de novo
            </Botao>
          </Alerta>
        ) : (
          <Ossos alturas={[66, 150, 44, [180, 180, 180, 180]]} />
        )}
      </>
    );
  }

  if (!dados.suficiente) {
    return (
      <>
        {cabecalho}
        <Vazio
          icone={Repeat}
          titulo="O padrão aparece com 7 dias de análises"
          acao={
            <Link href={`/lojas/${id}/analises`} className={classesDoBotao({ variante: 'primario' })}>
              <ChartColumn className="h-[18px] w-[18px]" aria-hidden />
              Ver o que foi julgado
            </Link>
          }
        >
          Com uma semana já dá para dizer como é cada hora. O padrão por dia da semana fica firme com três. Enquanto isso, o
          que foi julgado está na outra aba.
          {dados.base.dias > 0 ? ` Até agora: ${plural(dados.base.dias, 'dia', 'dias')} com análise.` : ''}
        </Vazio>
      </>
    );
  }

  const aReverDoSetor = dados.anomalias.filter((a) => a.estado === 'rever' && doSetor(a, setor)).length;
  const sugestoesDoSetor = dados.sugestoes.filter((s) => doSetor(s, setor)).length;
  const contaDa = (l: Lente): number => (l === 'anomalias' ? aReverDoSetor : l === 'sugestoes' ? sugestoesDoSetor : 0);
  const frases: Array<{ lente: Lente; icone: LucideIcon; nome: string; texto: React.ReactNode; elo: string }> = [
    { lente: 'frequencia', icone: Repeat, nome: 'Frequência', texto: dados.parecer.frequencia ?? 'Ainda não há medida que conte o movimento de um setor.', elo: 'Ver a semana típica' },
    { lente: 'anomalias', icone: TriangleAlert, nome: 'Anomalias', texto: <Texto frase={dados.parecer.anomalias} />, elo: dados.aRever > 0 ? 'Rever agora' : 'Ver as revistas' },
    {
      lente: 'tendencia', icone: TrendingUp, nome: 'Tendência',
      texto: dados.parecer.tendencia ? <Texto frase={dados.parecer.tendencia} /> : 'Tendência precisa de três semanas de análises.',
      elo: 'Ver para onde vai',
    },
  ];

  return (
    <>
      {cabecalho}

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro.texto}
        </Alerta>
      )}

      <section className={`${CARTAO} flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5`} aria-label="De que o padrão é feito" data-base>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-farol-realce text-farol-marca">
          <CalendarDays className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-[1_1_260px]">
          <b className="font-semibold">
            Padrão feito de {plural(dados.base.dias, 'dia', 'dias')} de análises
            {dados.base.de && dados.base.ate ? `, de ${diaEMes(dados.base.de)} a ${diaEMes(dados.base.ate)}` : ''}
          </b>
          <p className="text-[13px] text-farol-suave">
            {dados.base.firme ? 'Já há três de cada dia da semana' : 'Ainda sem três de cada dia da semana: cada hora é comparada com a mesma hora dos outros dias'} · refeito
            cada vez que esta tela abre · o dia vira às 6h, e hoje não entra na conta
          </p>
        </div>
        <div className="max-md:w-full max-md:[&>div]:flex max-md:[&>div]:w-full max-md:[&_button]:flex-1">
          <Segmentado
            rotulo="Setor"
            valor={setor}
            aoMudar={setSetor}
            opcoes={[{ valor: 'todos', rotulo: 'Todos' }, ...dados.setores.map((s) => ({ valor: s.id, rotulo: s.nome }))]}
          />
        </div>
      </section>

      <section className={`${CARTAO} flex flex-col gap-3.5 p-4`} aria-labelledby="t-pd-parecer">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Titulo id="t-pd-parecer">Parecer</Titulo>
          <span className="text-[13px] text-farol-suave md:ml-auto">Escrito a partir dos números. Cada frase leva ao dado de onde saiu.</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-parecer>
          {frases.map((f) => (
            <article key={f.lente} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-farol-borda bg-farol-painel-2 p-3.5" data-frase={f.lente}>
              <span className="flex items-center gap-[7px] text-[12.5px] font-semibold text-farol-suave">
                <f.icone className="h-[15px] w-[15px] text-farol-facho-icone" aria-hidden />
                {f.nome}
              </span>
              <p className="text-sm leading-normal">{f.texto}</p>
              <button type="button" className="elo mt-auto self-start text-[13px]" onClick={() => irPara(f.lente)}>
                {f.elo}
                <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
              </button>
            </article>
          ))}
        </div>
      </section>

      <div ref={asLentes} role="group" aria-label="O que olhar" className="grid scroll-mt-4 grid-cols-2 gap-0.5 rounded-xl bg-farol-realce p-[3px] md:flex" data-lentes>
        {LENTES.map((l) => (
          <button
            key={l.valor}
            type="button"
            aria-pressed={lente === l.valor}
            onClick={() => setLente(l.valor)}
            className={`inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-[7px] rounded-[9px] px-2.5 text-[13px] font-semibold transition-all duration-200 ${
              lente === l.valor ? 'bg-farol-painel text-farol-tinta shadow-farol-1' : 'text-farol-suave hover:text-farol-tinta'
            }`}
          >
            <l.icone className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{l.rotulo}</span>
            {contaDa(l.valor) > 0 && (
              <span className="min-w-5 rounded-full bg-farol-facho-leve px-1.5 text-center text-xs font-semibold leading-5 text-farol-facho-tinta">{contaDa(l.valor)}</span>
            )}
          </button>
        ))}
      </div>

      {lente === 'frequencia' && (
        <Frequencia
          dados={dados}
          setor={setor}
          indicador={indicador}
          celula={celula}
          aoMudarIndicador={(novo) => {
            setIndicador(novo);
            setCelula('');
          }}
          aoEscolherCelula={setCelula}
        />
      )}
      {lente === 'anomalias' && (
        <Anomalias dados={dados} setor={setor} filtro={filtro} configura={configura} aoMudarFiltro={setFiltro} aoEsperado={setEsperado} aoProblema={setCorrecao} />
      )}
      {lente === 'tendencia' && <Tendencia dados={dados} setor={setor} hojeInd={hojeInd} aoMudarHojeInd={setHojeInd} />}
      {lente === 'sugestoes' && <Sugestoes dados={dados} setor={setor} configura={configura} aoAgir={agir} />}

      {esperado && (
        <GavetaDeEsperado
          key={esperado.id}
          lojaId={id}
          a={esperado}
          hoje={dados.hoje}
          aoFechar={() => setEsperado(null)}
          aoResponder={(novo, mensagem) => {
            setDados(novo);
            setEsperado(null);
            avisar(mensagem);
          }}
        />
      )}
      {correcao && (
        <GavetaDeCorrecao
          key={correcao.id}
          lojaId={id}
          a={correcao}
          hoje={dados.hoje}
          ajustesDoCriterio={ajustesDe(correcao.ajustar?.regraId)}
          aoFechar={() => setCorrecao(null)}
          aoResponder={corrigida}
        />
      )}

      {criterio && (
        <GavetaDoCriterio
          key={criterio.chave}
          lojaId={id}
          setores={setores}
          regra={criterio.regra}
          porteiroSugerido={criterio.porteiro}
          marcadasDeInicio={criterio.proposto ? [criterio.proposto.zonaId] : []}
          inicial={
            criterio.proposto && {
              nome: criterio.proposto.nome,
              criterio: criterio.proposto.texto,
              tipo: 'contagem',
              objeto: criterio.proposto.objeto,
              minimo: criterio.proposto.minimo,
              maximo: criterio.proposto.maximo,
              // "00:00 às 00:00" é o dia inteiro: aí o critério nasce sem faixa de horas
              faixa: criterio.proposto.janela[0] === criterio.proposto.janela[1] ? undefined : { de: criterio.proposto.janela[0], ate: criterio.proposto.janela[1] },
            }
          }
          objetosDoDetector={objetos}
          horarioDaLoja={loja?.horario_funcionamento ?? []}
          aoFechar={() => setCriterio(null)}
          aoSalvar={async (mensagem) => {
            setCriterio(null);
            resultadosApi.esquecer(id);
            especialistaApi.esquecer(id);
            atualizar();
            avisar(mensagem);
            await Promise.all([buscar(true), carregarCriterios().catch(() => undefined)]);
          }}
        />
      )}
    </>
  );
}
