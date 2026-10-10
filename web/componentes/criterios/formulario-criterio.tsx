'use client';

// =====================================================================
// A gaveta do critério — criar, editar e acompanhar
// =====================================================================
// O critério é cadastrado UMA vez e a árvore diz em quais canais ele vale.
// Editar aqui muda em todos: é o motivo de o cadastro ser um só.
//
// Quatro abas (A19, onda 1, fatia 1.5 — o protótipo aprovado em 09/10):
//
//   O critério  o nome, o texto, o que ele pergunta (a família), onde e
//               quando vale, e o ESTUDO: quando vale a pena olhar;
//   O funil     olhadas → com contexto → com gatilho → julgadas, em números;
//   Estado      observando · em ensaio · medido · valendo, e ligado/desligado;
//   Aviso       prioridade, gravidade, confiança, silêncio — como sempre.
//
// O que a gaveta afirma sai do servidor: a família que tem juiz, o estado
// que uma pessoa pode escolher, o estudo guardado e o funil. Critério novo
// nasce "observando" e ligado: conta, sem julgar e sem avisar.
//
// Salvar são até duas idas ao servidor — o critério e, se mudou, o estudo.
// Se a segunda falhar, o critério já está salvo e a mensagem diz isso: a
// gaveta nunca apaga um estudo que não conseguiu ler.
// =====================================================================

import { Image as Imagem, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { emQuantosLugares, rotuloDaArea } from '@/componentes/canal/quadros';
import { resumoDoHorario } from '@/componentes/horario/semana';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, Campo, Escolhas, GRADE, Grupo, ROTULO } from '@/componentes/ui/campo';
import { Alerta, Chip, Ossos } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import {
  ErroDaApi,
  regrasApi,
  type AgenteResumo,
  type EstadoDoCriterio,
  type FaixaDeHorario,
  type Familia,
  type Porteiro,
  type Quando,
  type Regra,
  type Setor,
} from '@/lib/api';

import { AbaDoEstado } from './aba-do-estado';
import { AbaDoFunil } from './aba-do-funil';
import { ArvoreDeCanais } from './arvore-de-canais';
import { contarCanais } from './canais';
import { estadoConhecido, NOME_DO_ESTADO } from './estados';
import { EstudoDoCriterio, estudoParaSalvar, mesmoEstudo, SEM_ESTUDO, type RascunhoDoEstudo } from './estudo-do-criterio';
import { FAMILIAS, familiaNatural, familiaSoObserva, FORMAS_DE_ESTADO, quandoChegaOJulgamento, tipoDaFamilia } from './familias';
import {
  CONFIRMACOES,
  faixaDeTodosOsDias,
  faixaSimples,
  nomeDaSeveridade,
  porcentoExato,
  PORTEIROS,
  porteirosDoTipo,
  PRIORIDADES,
  QUANDOS,
  resumoDaFaixa,
  SEVERIDADES,
  TIPOS_DO_DETECTOR,
} from './opcoes';
import { problemaDasCondicoes, type Lugar } from './sinais';

type Props = {
  lojaId: string;
  setores: Setor[];
  /** O critério em edição. Ausente = criando um novo. */
  regra?: Regra;
  /** Num critério NOVO: as áreas que já vêm marcadas ao abrir — o canal onde se clicou "+ critério".
   *  Na edição não vale: os canais marcados são os do próprio critério. */
  marcadasDeInicio: string[];
  /** Um critério NOVO que já nasce preenchido (sugerido pelo inventário ou pelos padrões). Na edição não vale. */
  inicial?: {
    nome?: string;
    criterio?: string;
    porteiro?: Porteiro;
    comPadrao?: boolean;
    tipo?: Regra['tipo'];
    /** O que o detector procura e quantos são aceitáveis (presença e contagem). */
    objeto?: string;
    minimo?: number;
    maximo?: number | null;
    /** A faixa de horas em que ele é conferido. */
    faixa?: { de: string; ate: string };
  };
  /** Na EDIÇÃO: a opção de "quando vale conferir" que os padrões sugerem. Só entra se a pessoa salvar. */
  porteiroSugerido?: Porteiro;
  /** O que o detector local sabe procurar. Vem da API, junto com os critérios. */
  objetosDoDetector: string[];
  /** Quando a loja abre. É por ele que "no horário" e "fora do horário" valem. */
  horarioDaLoja: FaixaDeHorario[];
  /** Os agentes da loja: é pelo que eles declaram que a gaveta sabe se o estudo já vale lá. Ausente = não se sabe. */
  agentes?: AgenteResumo[];
  /** Quem abriu pode mexer. Falso = a gaveta só mostra (o estudo, o funil, o estado). */
  configura?: boolean;
  aoSalvar: (mensagem: string) => Promise<void>;
  aoFechar: () => void;
};

type Aba = 'criterio' | 'funil' | 'estado' | 'aviso';
const ABAS: ReadonlyArray<{ valor: Aba; titulo: string }> = [
  { valor: 'criterio', titulo: 'O critério' },
  { valor: 'funil', titulo: 'O funil' },
  { valor: 'estado', titulo: 'Estado' },
  { valor: 'aviso', titulo: 'Aviso' },
];

/** O que o agente da loja declara quando sabe usar o estudo (`api/src/estudo.ts`, `SABE_ESTUDO`). */
const SABE_ESTUDO = 'estudo';

/** Como o critério é conferido sem estudo confirmado: o "quando vale a pena conferir" de antes, em palavras. */
const COMO_SEM_ESTUDO: Record<Porteiro, string> = {
  sempre: 'em toda olhada',
  pessoa: 'só com pessoa na área',
  livre: 'só com a área livre',
  movimento: 'só quando algo se mexe',
};

const PAINEL = 'm-0 flex min-w-0 flex-col gap-4 border-0 p-0';

export function GavetaDoCriterio({
  lojaId,
  setores,
  regra,
  marcadasDeInicio,
  inicial,
  porteiroSugerido,
  objetosDoDetector,
  horarioDaLoja,
  agentes,
  configura = true,
  aoSalvar,
  aoFechar,
}: Props) {
  const editando = regra !== undefined;
  const p = useId();
  const [aba, setAba] = useState<Aba>('criterio');

  // Na edição, os canais são os do critério — nunca o que a tela que abriu a gaveta lembrou de passar: salvar
  // sem mexer em nada tem de deixar o critério onde ele está (sem isto, uma lista vazia o tirava de todos).
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(regra ? regra.alvos.map((a) => a.zona_id) : marcadasDeInicio));
  const [nome, setNome] = useState(regra?.nome ?? inicial?.nome ?? '');
  const [tipo, setTipo] = useState<Regra['tipo']>(regra?.tipo ?? inicial?.tipo ?? 'estado');
  // A família guardada; resposta de API antiga não traz, e aí vale a natural do tipo.
  const [familia, setFamilia] = useState<Familia>(regra?.familia ?? familiaNatural(regra?.tipo ?? inicial?.tipo ?? 'estado'));
  const [criterio, setCriterio] = useState(regra?.criterio ?? inicial?.criterio ?? '');
  const [prioridade, setPrioridade] = useState<string>(regra?.prioridade ?? 'intermediaria');
  const [severidade, setSeveridade] = useState<string>(regra?.severidade ?? 'atencao');
  // Em porcento, como aparece na tela. A API guarda a fração, com três casas: a conversão é feita
  // ao salvar, e o que abre para editar não é arredondado (72,5% continua 72,5%).
  const [confiancaMinima, setConfiancaMinima] = useState(regra ? porcentoExato(regra.confianca_minima) : 70);
  const [cooldownMin, setCooldownMin] = useState(regra?.cooldown_min ?? 15);
  // Quase todo critério é de operação: nasce valendo com a loja aberta.
  const [quando, setQuando] = useState<Quando>(regra?.quando ?? 'no_horario');

  // A faixa de horas. A gaveta edita UMA faixa, todos os dias; o que foi
  // gravado com mais detalhe (dias diferentes) continua valendo até alguém
  // mexer aqui — por isso a faixa só sobe quando foi mexida.
  const faixaGuardada = faixaSimples(regra?.janelas);
  const faixaDetalhada = faixaGuardada === 'detalhada';
  const faixaInicial = regra ? undefined : inicial?.faixa;
  const [comFaixa, setComFaixa] = useState((faixaGuardada !== null && !faixaDetalhada) || Boolean(faixaInicial));
  const [faixaDe, setFaixaDe] = useState(faixaGuardada && !faixaDetalhada ? faixaGuardada.de : (faixaInicial?.de ?? '20:00'));
  const [faixaAte, setFaixaAte] = useState(faixaGuardada && !faixaDetalhada ? faixaGuardada.ate : (faixaInicial?.ate ?? '22:00'));
  const [mexeuNaFaixa, setMexeuNaFaixa] = useState(false);

  // O "quando vale a pena conferir" de antes. Vale enquanto o critério não tiver estudo confirmado.
  const [porteiro, setPorteiro] = useState<Porteiro>((regra ? (porteiroSugerido ?? regra.porteiro) : inicial?.porteiro) ?? 'sempre');
  // Em quantas olhadas seguidas fora do critério ele avisa.
  const [confirmarEm, setConfirmarEm] = useState(regra?.confirmar_em ?? 1);
  // Critério de estado: a foto padrão do canal vai junto à nuvem.
  const [comPadrao, setComPadrao] = useState(regra?.com_padrao ?? inicial?.comPadrao ?? false);

  // O que o detector procura. Só vale nos tipos julgados na loja.
  const doDetector = regra ? regra.parametros : inicial;
  const [objeto, setObjeto] = useState(doDetector?.objeto ?? 'pessoa');
  const [deveHaver, setDeveHaver] = useState(doDetector?.maximo !== 0);
  const [minimo, setMinimo] = useState(String(doDetector?.minimo ?? 0));
  const [maximo, setMaximo] = useState(doDetector?.maximo == null ? '' : String(doDetector.maximo));

  // O estado e o ligado/desligado: o guardado e o que vai ser salvo.
  const estadoGuardado: EstadoDoCriterio = regra ? estadoConhecido(regra.estado) : 'observando';
  const [estado, setEstado] = useState<EstadoDoCriterio>(estadoGuardado);
  const [ligado, setLigado] = useState(regra?.ativa ?? true);

  // O estudo: o guardado no servidor (`null` = ainda não chegou) e o da gaveta.
  const [estudoGuardado, setEstudoGuardado] = useState<RascunhoDoEstudo | null>(editando ? null : SEM_ESTUDO);
  const [estudo, setEstudo] = useState<RascunhoDoEstudo>(SEM_ESTUDO);
  const [erroDoEstudo, setErroDoEstudo] = useState<string | null>(null);

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const campoDoNome = useRef<HTMLInputElement>(null);
  const campoDoTexto = useRef<HTMLTextAreaElement>(null);
  const caixaDoErro = useRef<HTMLDivElement>(null);

  const regraId = regra?.id;
  const buscarEstudo = useCallback(async () => {
    if (!regraId) return;
    setErroDoEstudo(null);
    try {
      const r = await regrasApi.estudo(regraId);
      const lido: RascunhoDoEstudo = r.estudo
        ? { existe: true, partes: r.estudo.partes ?? {}, contexto: r.estudo.contexto ?? [], gatilho: r.estudo.gatilho ?? [], confirmado: r.estudo.confirmado === true }
        : SEM_ESTUDO;
      setEstudoGuardado(lido);
      setEstudo(lido);
    } catch (e) {
      setErroDoEstudo(e instanceof ErroDaApi ? e.message : 'não consegui buscar o estudo deste critério');
    }
  }, [regraId]);

  useEffect(() => {
    void buscarEstudo();
  }, [buscarEstudo]);

  // O foco começa no nome de quem está criando. (`autoFocus` não serve: a
  // gaveta é um <dialog> que abre depois de montado.)
  useEffect(() => {
    if (!editando && configura) campoDoNome.current?.focus();
    // Só na abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (erro) caixaDoErro.current?.scrollIntoView({ block: 'nearest' });
  }, [erro]);

  const tipoFinal = tipoDaFamilia(familia, tipo);
  const peloDetector = TIPOS_DO_DETECTOR.includes(tipoFinal);
  const usaContextoEGatilho = !peloDetector;
  const porteiros = porteirosDoTipo(tipoFinal);
  const porteiroFinal: Porteiro = porteiros.some((o) => o.valor === porteiro) ? porteiro : 'sempre';
  const soObserva = familiaSoObserva(familia);
  const chega = quandoChegaOJulgamento(familia);
  // Com o critério julgando (ou valendo), as famílias que só observam ficam fora de alcance: o servidor recusa.
  const julgando = estado !== 'observando';
  // O critério de ação de ANTES das famílias que já julgava: a família dele ainda não tem juiz próprio, e ele
  // segue sendo julgado pelo texto, como sempre. É a única família sem juiz que cabe num critério que julga —
  // e só enquanto ninguém mexer no estado dele.
  const familiaGuardada: Familia | null = regra ? (regra.familia ?? familiaNatural(regra.tipo)) : null;
  const comoEstaGuardado = (f: Familia) => f === familiaGuardada && estado === estadoGuardado;
  const julgaDeAntes = soObserva && julgando;

  function mudarFamilia(nova: Familia) {
    setFamilia(nova);
    mudarTipo(tipoDaFamilia(nova, tipo));
  }
  /** Trocar o tipo larga a escolha que não cabe no novo (a mesma regra do servidor). */
  function mudarTipo(novo: Regra['tipo']) {
    setTipo(novo);
    if (!porteirosDoTipo(novo).some((o) => o.valor === porteiro)) setPorteiro('sempre');
  }
  function mudarFaixa(parte: { com?: boolean; de?: string; ate?: string }) {
    if (parte.com !== undefined) setComFaixa(parte.com);
    if (parte.de !== undefined) setFaixaDe(parte.de);
    if (parte.ate !== undefined) setFaixaAte(parte.ate);
    setMexeuNaFaixa(true);
  }

  /** Os parâmetros que sobem, ou `undefined` quando o tipo não usa detector. */
  function parametros(): Record<string, unknown> | undefined {
    if (!peloDetector) return undefined;
    if (tipoFinal === 'presenca') {
      // "Deve haver" é pelo menos um; "não deve haver" é no máximo zero.
      return deveHaver ? { objeto, minimo: 1, maximo: null } : { objeto, minimo: 0, maximo: 0 };
    }
    return { objeto, minimo: minimo === '' ? 0 : Number(minimo), maximo: maximo === '' ? null : Number(maximo) };
  }

  const canais = contarCanais(setores, marcadas);
  const resumoDaLoja = resumoDoHorario(horarioDaLoja);

  // Onde o critério vale, para o cabeçalho; e os lugares que uma condição do estudo pode olhar.
  const { lugares, descricao } = useMemo(() => {
    const dosCanais = setores.flatMap((s) => s.pontos).filter((ponto) => ponto.zonas.some((z) => marcadas.has(z.id)));
    const marcados = dosCanais.flatMap((ponto) => ponto.zonas.filter((z) => marcadas.has(z.id)).map((z) => ({ ponto, z })));
    const lista: Lugar[] = [
      { onde: 'aqui', rotulo: 'onde o critério vale' },
      { onde: 'canal', rotulo: 'na imagem completa do canal' },
    ];
    for (const ponto of dosCanais) {
      for (const z of ponto.zonas) {
        if (z.principal) continue;
        lista.push({ onde: 'quadro', zonaId: z.id, pontoId: ponto.id, rotulo: `no ${rotuloDaArea(z)}${dosCanais.length > 1 ? ` (${ponto.nome})` : ''}` });
      }
    }
    const emQuadros = marcados.filter((m) => !m.z.principal).length;
    const onde =
      marcados.length === 0
        ? 'Sem canal marcado'
        : marcados.length === 1
          ? `${marcados[0]!.ponto.nome} · ${rotuloDaArea(marcados[0]!.z)}`
          : `Vale ${emQuantosLugares(dosCanais.length, emQuadros)}: o que você mudar aqui muda em todos`;
    return { lugares: lista, descricao: onde };
  }, [setores, marcadas]);

  const disseram = (agentes ?? []).filter((a) => a.estado === 'ativo' && a.sabe_em);
  const agenteSabe = disseram.length === 0 ? null : disseram.some((a) => a.sabe?.includes(SABE_ESTUDO));

  const estudoCarregado = estudoGuardado !== null;
  const problemaDoEstudo = estudo.existe && usaContextoEGatilho ? problemaDasCondicoes(estudo.contexto, estudo.gatilho) : null;
  const estudoMudou = estudoCarregado && !mesmoEstudo(estudo, estudoGuardado, usaContextoEGatilho);

  function reclamar(naAba: Aba, texto: string, foco?: { current: HTMLElement | null }) {
    setAba(naAba);
    setErro(texto);
    // O campo está numa aba que pode ter acabado de aparecer: o foco vai depois de ela ser desenhada.
    requestAnimationFrame(() => foco?.current?.focus());
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!configura) return;
    setErro(null);
    if (!nome.trim()) return reclamar('criterio', 'Dê um nome ao critério.', campoDoNome);
    if (!criterio.trim()) return reclamar('criterio', 'Escreva como você explicaria este critério a um funcionário novo.', campoDoTexto);
    if (!editando && canais === 0) return reclamar('criterio', 'Marque ao menos um canal.');
    // A faixa só sobe quando é nova ou foi mexida: ausente, o servidor mantém a que está guardada.
    const mandaFaixa = !regra || mexeuNaFaixa;
    if (mandaFaixa && comFaixa) {
      if (!faixaDe || !faixaAte) return reclamar('criterio', 'Diga a hora de início e a de fim da faixa de horas.');
      if (faixaDe === faixaAte) {
        return reclamar('criterio', 'A faixa de horas começa e termina na mesma hora. Escolha horas diferentes, ou desmarque a faixa.');
      }
    }
    if (estudoMudou && problemaDoEstudo) return reclamar('criterio', `No estudo: ${problemaDoEstudo}`);

    setSalvando(true);
    let salvo: { canais: number; desligada?: boolean; id: string };
    try {
      const corpo = {
        nome: nome.trim(),
        tipo: tipoFinal,
        criterio: criterio.trim(),
        prioridade,
        severidade,
        confiancaMinima: Number((Math.min(100, Math.max(0, confiancaMinima)) / 100).toFixed(3)),
        cooldownMin,
        zonaIds: [...marcadas],
        parametros: parametros(),
        quando,
        // Vai sempre, já acertado para o tipo: o servidor recusa presença
        // ou contagem com outra coisa que não "em toda olhada".
        porteiro: porteiroFinal,
        confirmarEm,
        // Só o critério de estado tem a escolha; nos outros tipos ela sobe
        // desmarcada, para não ficar valendo escondida depois de trocar o tipo.
        comPadrao: tipoFinal === 'estado' && comPadrao,
        ...(mandaFaixa ? { janelas: comFaixa ? faixaDeTodosOsDias(faixaDe, faixaAte) : [] } : {}),
      };
      if (regra) {
        const r = await regrasApi.editar(regra.id, {
          ...corpo,
          // Só o que mudou: mandar de volta um estado que esta tela não conhece seria recusado.
          ...(familia !== regra.familia || tipoFinal !== regra.tipo ? { familia } : {}),
          ...(estado !== estadoGuardado ? { estado } : {}),
          ...(ligado !== regra.ativa ? { ativa: ligado } : {}),
        });
        salvo = { canais: r.canais, desligada: r.desligada, id: regra.id };
      } else {
        // Nasce observando — e, por isso, ligado: só conta.
        const r = await regrasApi.criar(lojaId, { ...corpo, familia, estado: 'observando' });
        salvo = { canais: r.canais, id: r.id };
      }
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
      return;
    }

    // O estudo, se mudou. O critério já está salvo: se esta parte falhar, a mensagem diz.
    let doEstudo = '';
    if (estudoMudou) {
      try {
        if (estudo.existe) {
          await regrasApi.gravarEstudo(salvo.id, estudoParaSalvar(estudo, usaContextoEGatilho));
          doEstudo = !usaContextoEGatilho
            ? ' Os textos do estudo foram guardados.'
            : estudo.confirmado
              ? ' O estudo confirmado passa a dizer quando ele é conferido.'
              : ' O estudo ficou como rascunho: ainda não vale.';
        } else {
          await regrasApi.tirarEstudo(salvo.id);
          doEstudo = ' O estudo foi tirado.';
        }
      } catch (e) {
        doEstudo = ` Mas o estudo NÃO foi salvo: ${e instanceof ErroDaApi ? e.message : 'não deu certo'}. Abra o critério para tentar de novo.`;
      }
    }

    const emCanais = `${salvo.canais} ${salvo.canais === 1 ? 'canal' : 'canais'}`;
    const doEstado =
      regra && estado !== estadoGuardado
        ? estado === 'ensaio'
          ? ' Passou a em ensaio: julga e mostra, sem avisar.'
          : ' Voltou a só observar.'
        : '';
    const doLigado = regra && ligado !== regra.ativa && !salvo.desligada ? (ligado ? ' Foi ligado.' : ' Foi desligado.') : '';
    await aoSalvar(
      regra
        ? (salvo.desligada
            ? 'Critério salvo. Sem canal marcado, ele foi desligado e fica em “Sem canal”.'
            : `Critério salvo. Vale em ${emCanais}.`) +
            doEstado +
            doLigado +
            doEstudo
        : `Critério criado em ${emCanais}. Ele nasce observando e ligado: conta as olhadas, o contexto e o gatilho, sem julgar.${doEstudo}`,
    );
  }

  // ───────────────────────── as abas ─────────────────────────
  const botoesDasAbas = useRef<Partial<Record<Aba, HTMLButtonElement | null>>>({});
  function teclaNaAba(e: React.KeyboardEvent, i: number) {
    const destino =
      e.key === 'ArrowRight' ? (i + 1) % ABAS.length : e.key === 'ArrowLeft' ? (i - 1 + ABAS.length) % ABAS.length : e.key === 'Home' ? 0 : e.key === 'End' ? ABAS.length - 1 : -1;
    if (destino < 0) return;
    e.preventDefault();
    const nova = ABAS[destino]!.valor;
    setAba(nova);
    botoesDasAbas.current[nova]?.focus();
  }

  const titulo = editando ? regra.nome : 'Novo critério';
  const idDoForm = `${p}-form`;

  return (
    <Gaveta
      larga
      titulo={titulo}
      // O estado e o ligado do cabeçalho são os GUARDADOS: o que está marcado para mudar aparece na aba Estado.
      descricao={`${descricao} · ${NOME_DO_ESTADO[estadoGuardado]}${editando && !regra.ativa ? ' · desligado' : ''}`}
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        configura ? (
          <>
            <Botao type="submit" form={idDoForm} variante="primario" ocupado={salvando} disabled={!editando && canais === 0}>
              {salvando ? 'Salvando…' : editando ? 'Salvar critério' : 'Criar critério'}
            </Botao>
            <Botao onClick={aoFechar} disabled={salvando}>
              Cancelar
            </Botao>
            {!editando && (
              <p className="flex-[1_1_180px] text-[12.5px] text-farol-suave">
                {canais === 0 ? (
                  'Marque ao menos um canal.'
                ) : (
                  <>
                    Nasce <strong className="font-semibold text-farol-tinta">observando</strong>: conta o contexto e o
                    gatilho, sem julgar.
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <Botao onClick={aoFechar}>Fechar</Botao>
        )
      }
    >
      <div role="tablist" aria-label="Partes do critério" className="-mt-1 flex flex-wrap gap-x-1 border-b border-farol-borda">
        {ABAS.map((a, i) => {
          const atual = aba === a.valor;
          return (
            <button
              key={a.valor}
              ref={(el) => {
                botoesDasAbas.current[a.valor] = el;
              }}
              type="button"
              role="tab"
              id={`${p}-aba-${a.valor}`}
              aria-selected={atual}
              aria-controls={`${p}-painel-${a.valor}`}
              tabIndex={atual ? 0 : -1}
              onClick={() => setAba(a.valor)}
              onKeyDown={(e) => teclaNaAba(e, i)}
              className={`relative min-h-10 px-3 text-[13.5px] font-semibold transition-colors max-[359px]:px-2 ${
                atual ? 'text-farol-tinta' : 'text-farol-suave hover:text-farol-tinta'
              }`}
            >
              {a.titulo}
              <span aria-hidden className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${atual ? 'bg-farol-marca' : 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>

      <form id={idDoForm} onSubmit={enviar} noValidate className="flex flex-col gap-4" aria-label={editando ? `Critério ${regra.nome}` : 'Novo critério'}>
        {/* ───────────────────────── o critério ───────────────────────── */}
        <div role="tabpanel" id={`${p}-painel-criterio`} aria-labelledby={`${p}-aba-criterio`} hidden={aba !== 'criterio'}>
          <fieldset disabled={!configura} className={PAINEL}>
            <Campo rotulo="Nome do critério" htmlFor={`${p}-nome`}>
              <input
                id={`${p}-nome`}
                ref={campoDoNome}
                className="entrada"
                placeholder="Bancada limpa entre pedidos"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </Campo>

            <Campo
              rotulo="Como você explicaria a um funcionário novo"
              htmlFor={`${p}-criterio`}
              // A dica não pode mentir em nenhum caso. Enquanto o critério só observa, o texto não vai a lugar
              // nenhum. Julgando: nos tipos de texto ele VAI ao modelo como pergunta; em presença e contagem
              // não vai a modelo nenhum; em comparação, só quando a cena não é igual à foto padrão.
              ajuda={
                soObserva && !julgando
                  ? 'Descreva o que se vê, não o rótulo. Enquanto o critério só observa, este texto não é enviado a modelo nenhum.'
                  : peloDetector
                    ? 'Aqui o texto não é enviado a modelo nenhum: ele descreve a regra para quem ler o aviso. Quem decide são os campos de “O que o detector procura”.'
                    : tipoFinal === 'comparacao'
                      ? 'Quando ele julgar e a cena não for igual à foto padrão, este texto vai ao modelo como pergunta, com a foto ao lado. Descreva o que se vê, não o rótulo.'
                      : 'Quando ele julgar, este texto vai ao modelo como pergunta. Descreva o que se vê, não o rótulo: “a superfície tem restos no canto” funciona melhor que “sujeira”.'
              }
            >
              <textarea
                id={`${p}-criterio`}
                ref={campoDoTexto}
                rows={3}
                className="entrada min-h-[84px] resize-y leading-normal"
                placeholder="Entre um lote e outro, a área de montagem fica sem restos de alimento."
                value={criterio}
                onChange={(e) => setCriterio(e.target.value)}
              />
            </Campo>

            <div className="flex min-w-0 flex-col gap-[5px]">
              <span id={`${p}-familia-rotulo`} className={ROTULO}>
                O que este critério pergunta
              </span>
              <div role="radiogroup" aria-labelledby={`${p}-familia-rotulo`} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FAMILIAS.map((f) => {
                  const marcada = familia === f.valor;
                  // A mesma regra do servidor: família sem juiz só com o critério observando — ou do jeito
                  // que ele já está guardado (clicou em outra por engano: dá para voltar).
                  const travada = julgando && f.chega !== null && !marcada && !comoEstaGuardado(f.valor);
                  return (
                    <div key={f.valor} className="relative">
                      <input
                        type="radio"
                        name={`${p}-familia`}
                        id={`${p}-familia-${f.valor}`}
                        value={f.valor}
                        checked={marcada}
                        disabled={travada}
                        onChange={() => mudarFamilia(f.valor)}
                        className="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      />
                      <label
                        htmlFor={`${p}-familia-${f.valor}`}
                        className={`flex h-full cursor-pointer flex-col gap-1 rounded-[10px] border p-2.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-farol-marca peer-disabled:cursor-not-allowed peer-disabled:opacity-55 ${
                          marcada
                            ? 'border-farol-marca bg-farol-painel-2 shadow-[inset_0_0_0_1px_rgb(var(--marca))]'
                            : 'border-farol-borda-forte bg-farol-painel hover:border-farol-suave'
                        }`}
                      >
                        <b className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                          {f.titulo}
                          {f.chega && <Chip>{f.chega}</Chip>}
                        </b>
                        <small className="text-[11.5px] leading-snug text-farol-suave">
                          {f.pergunta} {f.como}
                        </small>
                      </label>
                    </div>
                  );
                })}
              </div>
              {julgaDeAntes ? (
                <p className={AJUDA} data-familia-de-antes>
                  Este critério já era julgado antes de as famílias existirem, e continua: pelo texto, como sempre. O
                  julgamento próprio desta família {chega}.
                </p>
              ) : soObserva ? (
                <p className={AJUDA} data-familia-so-observa>
                  O julgamento desta família {chega}. Até lá o critério só observa: conta o contexto e o gatilho, sem
                  julgar.
                </p>
              ) : (
                julgando && (
                  <p className={AJUDA} data-familias-fora-de-alcance>
                    Este critério está {NOME_DO_ESTADO[estado]}: as famílias que só observam ficam fora de alcance.
                    {/* Só "em ensaio" tem caminho de volta a "observando" pela tela. */}
                    {estado === 'ensaio' && ' Para trocar, volte-o antes a “observando”, na aba Estado.'}
                  </p>
                )
              )}
            </div>

            {familia === 'estado' && (
              <Escolhas nome={`${p}-forma`} rotulo="Como conferir" opcoes={FORMAS_DE_ESTADO} valor={tipoFinal} aoMudar={mudarTipo} />
            )}

            {/* Presença e contagem são julgadas dentro da loja, pelo detector.
                Ele não lê o texto: trabalha com o objeto e a quantidade. Sem
                estes campos o critério fica cadastrado e não é verificado. */}
            {peloDetector && (
              <Grupo titulo="O que o detector procura">
                <p className="text-[12.5px] text-farol-suave">
                  Esta forma é julgada <strong className="font-semibold text-farol-tinta">dentro da loja</strong>, sem
                  internet e sem custo por análise. Quem decide são os campos abaixo.
                </p>
                <div className={GRADE}>
                  {tipoFinal === 'presenca' && (
                    <Campo rotulo="Regra" htmlFor={`${p}-deve`}>
                      <select id={`${p}-deve`} className="entrada" value={deveHaver ? 'sim' : 'nao'} onChange={(e) => setDeveHaver(e.target.value === 'sim')}>
                        <option value="sim">deve haver</option>
                        <option value="nao">não deve haver</option>
                      </select>
                    </Campo>
                  )}
                  <Campo rotulo="O que procurar" htmlFor={`${p}-objeto`}>
                    <select id={`${p}-objeto`} className="entrada" value={objeto} onChange={(e) => setObjeto(e.target.value)}>
                      {objetosDoDetector.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                      {/* O objeto guardado que a lista não trouxe: aparece, em vez de a gaveta trocá-lo calada. */}
                      {!objetosDoDetector.includes(objeto) && <option value={objeto}>{objeto}</option>}
                    </select>
                  </Campo>
                  {tipoFinal === 'contagem' && (
                    <>
                      <Campo rotulo="Pelo menos" htmlFor={`${p}-minimo`}>
                        <input id={`${p}-minimo`} type="number" min={0} step={1} className="entrada font-mono" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
                      </Campo>
                      <Campo rotulo="No máximo" htmlFor={`${p}-maximo`}>
                        <input
                          id={`${p}-maximo`}
                          type="number"
                          min={0}
                          step={1}
                          placeholder="sem limite"
                          className="entrada font-mono"
                          value={maximo}
                          onChange={(e) => setMaximo(e.target.value)}
                        />
                      </Campo>
                    </>
                  )}
                </div>
                <p className="text-[12.5px] text-farol-suave">
                  O detector conhece só os objetos desta lista. Na dúvida ele responde “não deu para avaliar” em vez de
                  avisar: um casaco pendurado não vira pessoa.
                </p>
              </Grupo>
            )}

            {/* Comparação é julgada na loja, contra a foto padrão do canal. Só o
                que NÃO for igual a ela vai à nuvem, com a foto ao lado. */}
            {tipoFinal === 'comparacao' && (
              <Grupo titulo="Com o que comparar">
                <p className="text-[12.5px] text-farol-suave">
                  Com a <strong className="font-semibold text-farol-tinta">foto padrão</strong> do canal em que o
                  critério valer. É julgado <strong className="font-semibold text-farol-tinta">dentro da loja</strong>:
                  parecido com o padrão é conforme, sem custo. Só vai à nuvem — com a foto padrão ao lado — quando a
                  loja ficar em dúvida.
                </p>
                <Alerta icone={Imagem}>
                  Canal sem foto padrão não é conferido: o critério fica marcado com “falta a foto padrão” até ela
                  existir. A foto se guarda na tela do canal, em “Desenho, fotos e conexão”.
                </Alerta>
              </Grupo>
            )}

            {tipoFinal === 'estado' && (
              <label htmlFor={`${p}-com-padrao`} className="flex cursor-pointer items-start gap-2.5">
                <input
                  id={`${p}-com-padrao`}
                  type="checkbox"
                  checked={comPadrao}
                  onChange={(e) => setComPadrao(e.target.checked)}
                  className="mt-0.5 h-[17px] w-[17px] shrink-0 accent-farol-marca"
                />
                Mandar a foto padrão do canal junto, para a nuvem comparar com ela
              </label>
            )}

            <div className="flex min-w-0 flex-col gap-[5px]">
              <span className={ROTULO}>Onde vale</span>
              <p className="text-xs text-farol-suave">
                Marque o setor para valer em todos os canais dele, ou abra o setor e marque só os canais que quiser.
                Canal com quadros: marque onde o critério vale — na imagem completa ou num quadro.
              </p>
              <ArvoreDeCanais setores={setores} marcadas={marcadas} aoMudar={setMarcadas} prefixo={p} />
              {editando && canais === 0 && (
                <Alerta tom="atencao" icone={TriangleAlert} papel="alert">
                  Sem nenhum canal, este critério deixa de ser verificado em qualquer lugar e é desligado. Ele fica
                  guardado em “Sem canal”.
                </Alerta>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-[5px]">
              <Escolhas nome={`${p}-quando`} rotulo="Em que horário conferir" opcoes={QUANDOS} valor={quando} aoMudar={setQuando} />
              <p className="text-xs text-farol-suave">
                {resumoDaLoja
                  ? `O horário é o da loja: ${resumoDaLoja}. Mudou lá, mudou para todos os critérios.`
                  : 'A loja ainda não informou horário, então vale como sempre aberta.'}
              </p>
              {/* Sem horário a loja nunca está "fechada": este critério ficaria
                  cadastrado, ligado e sem ser conferido — tem que estar dito. */}
              {!resumoDaLoja && quando === 'fora_do_horario' && (
                <Alerta tom="atencao" icone={TriangleAlert} papel="alert">
                  Sem horário informado, a loja nunca está fechada: este critério só começa a ser conferido depois que
                  o horário de funcionamento for informado, na tela de critérios.
                </Alerta>
              )}

              <label htmlFor={`${p}-faixa`} className="mt-1.5 flex cursor-pointer items-center gap-2.5">
                <input
                  id={`${p}-faixa`}
                  type="checkbox"
                  checked={comFaixa}
                  onChange={(e) => mudarFaixa({ com: e.target.checked })}
                  className="h-[17px] w-[17px] shrink-0 accent-farol-marca"
                />
                Só numa faixa de horas
              </label>
              {comFaixa && (
                <>
                  <div className="grid grid-cols-2 gap-3.5">
                    <Campo rotulo="Das" htmlFor={`${p}-faixa-de`}>
                      <input id={`${p}-faixa-de`} type="time" className="entrada font-mono" value={faixaDe} onChange={(e) => mudarFaixa({ de: e.target.value })} />
                    </Campo>
                    <Campo rotulo="Às" htmlFor={`${p}-faixa-ate`}>
                      <input id={`${p}-faixa-ate`} type="time" className="entrada font-mono" value={faixaAte} onChange={(e) => mudarFaixa({ ate: e.target.value })} />
                    </Campo>
                  </div>
                  <p className="text-xs text-farol-suave">
                    Todos os dias, dentro do horário escolhido acima.
                    {faixaDe && faixaAte && faixaAte < faixaDe && ` Passa da meia-noite: vai até as ${faixaAte} do dia seguinte.`}
                  </p>
                </>
              )}
              {/* Faixa gravada com mais detalhe do que a gaveta edita: dita, e
                  mantida enquanto ninguém mexer. */}
              {faixaDetalhada && !mexeuNaFaixa && (
                <Alerta>
                  Este critério já tem uma faixa de horas com dias diferentes: {resumoDaFaixa(regra?.janelas)}. Ela
                  continua valendo. Marcar a caixa acima troca por uma faixa só, igual em todos os dias.
                </Alerta>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-2.5" data-secao-do-estudo>
              <div>
                <span className={ROTULO}>O estudo deste critério — quando vale a pena olhar</span>
              </div>

              {/* O "quando vale a pena conferir" de antes: é o que vale enquanto não houver estudo confirmado. */}
              {porteiros.length > 0 && !(estudo.existe && estudo.confirmado) && (
                <Campo
                  rotulo="Sem estudo confirmado, conferir"
                  htmlFor={`${p}-porteiro`}
                  ajuda="Quem responde é o detector, dentro da loja e sem custo. Quando não vale, a olhada conta como “nada a conferir”."
                >
                  <select id={`${p}-porteiro`} className="entrada" value={porteiroFinal} onChange={(e) => setPorteiro(e.target.value as Porteiro)}>
                    {porteiros.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.titulo.charAt(0).toLowerCase() + o.titulo.slice(1)} — {o.ajuda}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}
              {porteiros.length > 0 && estudo.existe && estudo.confirmado && porteiroFinal !== 'sempre' && (
                <p className={AJUDA}>
                  Com o estudo confirmado, a regra de antes (“{PORTEIROS.find((o) => o.valor === porteiroFinal)?.titulo.toLowerCase()}”) não é
                  consultada.
                </p>
              )}

              {erroDoEstudo ? (
                <Alerta tom="critico" papel="alert">
                  {erroDoEstudo} O que está guardado não é tocado ao salvar.
                  <button type="button" className="elo ml-2 text-[13px]" onClick={() => void buscarEstudo()}>
                    Tentar de novo
                  </button>
                </Alerta>
              ) : !estudoCarregado ? (
                <Ossos alturas={[72]} />
              ) : (
                <EstudoDoCriterio
                  prefixo={p}
                  valor={estudo}
                  aoMudar={setEstudo}
                  lugares={lugares}
                  usaContextoEGatilho={usaContextoEGatilho}
                  configura={configura}
                  comoEHoje={peloDetector ? 'em toda olhada, no computador da loja' : COMO_SEM_ESTUDO[porteiroFinal]}
                  agenteSabe={agenteSabe}
                  problema={problemaDoEstudo}
                />
              )}
            </div>
          </fieldset>
        </div>

        {/* ───────────────────────── o funil ───────────────────────── */}
        <div role="tabpanel" id={`${p}-painel-funil`} aria-labelledby={`${p}-aba-funil`} hidden={aba !== 'funil'}>
          {aba === 'funil' && <AbaDoFunil regraId={regra?.id} estado={estadoGuardado} familia={regra?.familia ?? familia} />}
        </div>

        {/* ───────────────────────── o estado ───────────────────────── */}
        <div role="tabpanel" id={`${p}-painel-estado`} aria-labelledby={`${p}-aba-estado`} hidden={aba !== 'estado'}>
          <AbaDoEstado
            guardado={estadoGuardado}
            pendente={estado}
            aoMudar={setEstado}
            ligadoGuardado={regra?.ativa ?? true}
            ligado={ligado}
            aoLigar={setLigado}
            nome={nome || 'sem nome'}
            familia={familia}
            // Voltar ao estado guardado: sempre, numa família que julga; numa sem juiz, só se ela é a guardada.
            podeDesfazer={!soObserva || familia === familiaGuardada}
            novo={!editando}
            configura={configura}
            soNaLoja={peloDetector}
          />
        </div>

        {/* ───────────────────────── o aviso ───────────────────────── */}
        <div role="tabpanel" id={`${p}-painel-aviso`} aria-labelledby={`${p}-aba-aviso`} hidden={aba !== 'aviso'}>
          <fieldset disabled={!configura} className={PAINEL}>
            <p className="text-[12.5px] text-farol-suave">
              Só “valendo” avisa. Em “observando” e “em ensaio” estes ajustes ficam guardados e nenhum aviso sai.
            </p>
            <div className={GRADE}>
              <Campo rotulo="Prioridade" htmlFor={`${p}-prioridade`}>
                <select id={`${p}-prioridade`} className="entrada" value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
                  {PRIORIDADES.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.r}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Gravidade" htmlFor={`${p}-severidade`}>
                <select id={`${p}-severidade`} className="entrada" value={severidade} onChange={(e) => setSeveridade(e.target.value)}>
                  {SEVERIDADES.map((s) => (
                    <option key={s} value={s}>
                      {nomeDaSeveridade(s)}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Confiança mínima, em %" htmlFor={`${p}-confianca`} ajuda="Abaixo disso o resultado é registrado, mas não vira aviso.">
                <input
                  id={`${p}-confianca`}
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  className="entrada font-mono"
                  value={confiancaMinima}
                  onChange={(e) => setConfiancaMinima(Number(e.target.value))}
                />
              </Campo>
              <Campo rotulo="Silêncio entre avisos, em minutos" htmlFor={`${p}-cooldown`} ajuda="Vale por canal: o aviso de um não cala os outros.">
                <input id={`${p}-cooldown`} type="number" min={0} className="entrada font-mono" value={cooldownMin} onChange={(e) => setCooldownMin(Number(e.target.value))} />
              </Campo>
              <Campo rotulo="Avisar só se continuar" htmlFor={`${p}-continua`} ajuda="Evita aviso por algo que durou um instante." largo>
                <select id={`${p}-continua`} className="entrada" value={confirmarEm} onChange={(e) => setConfirmarEm(Number(e.target.value))}>
                  {CONFIRMACOES.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.r}
                    </option>
                  ))}
                  {/* Valor gravado fora da lista (pela API): aparece, em vez de
                      a gaveta trocá-lo calada ao salvar. */}
                  {!CONFIRMACOES.some((o) => o.v === confirmarEm) && <option value={confirmarEm}>por {confirmarEm} olhadas seguidas</option>}
                </select>
              </Campo>
            </div>
          </fieldset>
        </div>

        {erro && (
          <div ref={caixaDoErro}>
            <Alerta tom="critico" papel="alert">
              {erro}
            </Alerta>
          </div>
        )}
      </form>
    </Gaveta>
  );
}
