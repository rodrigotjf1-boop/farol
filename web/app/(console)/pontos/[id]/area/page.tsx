'use client';

/**
 * O desenho dos quadros do canal — e as fotos padrão, as medidas e a conexão.
 *
 * É a tela que transforma `--area 0.15,0.47,0.85,0.80` em algo que quem
 * opera a loja consegue fazer: olhar a cena e marcar o contorno do que
 * importa, ponto a ponto. O desenho é o que o agente recorta — e o que fica
 * fora dele é apagado antes de analisar, para um quadro não invadir o outro.
 *
 * **O que se desenha é o QUADRO.** A imagem completa do canal é fixa: é
 * sempre o canal inteiro, e dela só se informa aqui a largura real da cena.
 * Quem mostra o canal — a imagem, os quadros com o papel de cada um, a cena e
 * os critérios — é a tela do canal (`/pontos/:id`); esta abre a partir dela.
 *
 * Duas coisas aqui não são enfeite:
 *
 * **Os números existem junto com o arrasto.** Desenhar só com o mouse
 * exclui quem usa teclado, e os números também servem para ajustar o que o
 * arrasto deixou torto. Os dois editam o mesmo estado (o desenho em si está
 * em `componentes/areas/quadro-das-areas.tsx`).
 *
 * **O diagnóstico aparece ao lado enquanto se desenha.** Marcar o quadro é
 * a decisão que define px/cm — e sem ver a consequência na hora, a pessoa
 * só descobre que o quadro era pequeno demais quando o veredito já estiver
 * errado em produção.
 */

import { ArrowLeft, Columns2, Crop, Image as Imagem, Plus, RefreshCw, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  areaDe,
  caixaDe,
  comPontoEm,
  comPontoNovo,
  ladoMaisComprido,
  limpar,
  MAX_PONTOS,
  meioDoLado,
  problemaDoDesenho,
  QUADRO_INTEIRO,
  semPonto,
  sobreposicao,
  type Ponto,
} from '@/componentes/areas/poligono';
import { FotosPadrao } from '@/componentes/areas/fotos-padrao';
import { GavetaDaFotoPadrao } from '@/componentes/areas/gaveta-da-foto-padrao';
import { QuadroComPadrao } from '@/componentes/areas/quadro-com-padrao';
import { QuadroDasAreas } from '@/componentes/areas/quadro-das-areas';
import { MAX_QUADROS, nomeParaQuadroNovo, NOME_DA_IMAGEM_COMPLETA, rotuloDaArea } from '@/componentes/canal/quadros';
import { useConsole } from '@/componentes/console';
import { GavetaDoCriterio } from '@/componentes/criterios/formulario-criterio';
import { iconeDoTipo, nomeDoTipo, resumoDaProcura, TIPOS_DO_DETECTOR } from '@/componentes/criterios/opcoes';
import { diaEHora, plural } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, Campo } from '@/componentes/ui/campo';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Segmentado, Titulo, Vazio } from '@/componentes/ui/pecas';
import { Dialogo } from '@/componentes/ui/sobreposto';
import {
  consoleApi,
  ErroDaApi,
  padroesApi,
  previewApi,
  regrasApi,
  resultadosApi,
  type EstadoDoPreview,
  type FotoPadrao,
  type PontoCompleto,
  type Setor,
  type ZonaCompleta,
} from '@/lib/api';

// A cor de cada área (a imagem completa e os quadros), na imagem e na lista ao lado. Ficam por cima da
// imagem da câmera, então não seguem o tema: precisam aparecer sobre
// qualquer cena.
const CORES_DE_AREA = ['#F2B03C', '#5AA9FF', '#7FD08A', '#C792EA', '#FF8A73', '#5EDCD0', '#F58FC2', '#B7C46A'];
const corDaArea = (i: number) => CORES_DE_AREA[i % CORES_DE_AREA.length]!;

/** Quantos passos o "desfazer" guarda. */
const MAX_DESFAZER = 40;
/** A partir de quanto um quadro "também está dentro" de outro a ponto de valer dizer. */
const SOBREPOSICAO_QUE_SE_DIZ = 0.03;

/** "12,5" — a posição de um ponto, em % do quadro, com uma casa. */
const emPorCento = (v: number) => String(Math.round(v * 1000) / 10);

/** O que aquele tanto de pontos por centímetro dá para verificar. */
function oQueSustenta(pxPorCm: number): { nome: string; tom: 'ok' | 'atencao' | 'critico' } {
  if (pxPorCm >= 12.8) return { nome: 'montagem', tom: 'ok' };
  if (pxPorCm >= 3) return { nome: 'estado', tom: 'ok' };
  if (pxPorCm >= 1.5) return { nome: 'presença', tom: 'atencao' };
  return { nome: 'insuficiente', tom: 'critico' };
}


const CONEXAO = [
  ['nome', 'Nome', 'text', false],
  ['fabricante', 'Fabricante', 'text', false],
  ['canal', 'Canal', 'number', true],
  ['host', 'Endereço', 'text', true],
  ['porta', 'Porta', 'number', true],
  ['usuario', 'Usuário', 'text', false],
] as const;


/** O que a gaveta de critério precisa da loja; buscado só quando ela abre. */
type DaLoja = { setores: Setor[]; objetos: string[] };

/** O que o quadro mostra: a cena de agora (onde se desenha), a foto padrão, ou as duas lado a lado. */
type Vista = 'agora' | 'padrao' | 'comparar';
const SEM_FOTO = 'Este canal ainda não tem foto padrão';

export default function AreaDoCanal() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura, definirLoja, atualizar } = useConsole();
  const avisar = useAvisar();

  const [ponto, setPonto] = useState<PontoCompleto | null>(null);
  const [zonas, setZonas] = useState<ZonaCompleta[]>([]);
  const [zonaId, setZonaId] = useState<string>('');
  const [estado, setEstado] = useState<EstadoDoPreview | null>(null);
  /** O desenho em edição do quadro selecionado. */
  const [pontos, setPontos] = useState<Ponto[]>(QUADRO_INTEIRO);
  /** Os desenhos de antes de cada gesto, para o "desfazer". */
  const [desfazer, setDesfazer] = useState<Ponto[][]>([]);
  /** O ponto em que se está mexendo. */
  const [ativo, setAtivo] = useState<number | null>(null);
  /** Tentou salvar com o desenho torto: o motivo aparece ao lado do botão até o desenho ficar certo. */
  const [recusado, setRecusado] = useState(false);
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

  /** As fotos padrão do canal, da mais nova para a mais antiga. `null` = carregando. */
  const [fotos, setFotos] = useState<FotoPadrao[] | null>(null);
  const [maximoDeFotos, setMaximoDeFotos] = useState(4);
  const [erroDasFotos, setErroDasFotos] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>('agora');
  /** A foto escolhida para aparecer no quadro. Sem escolha, a mais nova. */
  const [fotoEscolhida, setFotoEscolhida] = useState<string | null>(null);
  const [guardandoFoto, setGuardandoFoto] = useState(false);
  const [excluindoFoto, setExcluindoFoto] = useState<FotoPadrao | null>(null);
  const [excluindoFotoAgora, setExcluindoFotoAgora] = useState(false);
  const [erroAoExcluirFoto, setErroAoExcluirFoto] = useState<string | null>(null);

  const campoDoNome = useRef<HTMLInputElement>(null);

  const zona = zonas.find((z) => z.id === zonaId) ?? null;

  const carregar = useCallback(async () => {
    try {
      const [dados, est] = await Promise.all([previewApi.ponto(id), previewApi.estado(id)]);
      setPonto(dados.ponto);
      setConexao(dados.ponto);
      setZonas(dados.zonas);
      setEstado(est);
      setSelo(est.capturadoEm);
      // Na chegada, o quadro que o endereço pede (`?quadro=`, vindo de "Redesenhar o contorno"); sem
      // pedido, o primeiro quadro — é para desenhar que se vem aqui —, e sem quadro, a imagem completa.
      // Depois, a área selecionada pode ter sido excluída: cai no mesmo lugar.
      const pedido = new URLSearchParams(window.location.search).get('quadro');
      setZonaId((atual) => {
        if (dados.zonas.some((z) => z.id === atual)) return atual;
        if (!atual && pedido && dados.zonas.some((z) => z.id === pedido)) return pedido;
        return (dados.zonas.find((z) => !z.principal) ?? dados.zonas[0])?.id ?? '';
      });
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui carregar o canal');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // As fotos padrão vêm à parte: a lista não muda enquanto a tela pergunta
  // pelo quadro de dois em dois segundos, e falhar aqui não pode derrubar o
  // desenho das áreas.
  const carregarFotos = useCallback(async () => {
    try {
      const r = await padroesApi.listar(id);
      setFotos(r.padroes);
      setMaximoDeFotos(r.maximo);
      setErroDasFotos(null);
    } catch (e) {
      setErroDasFotos(e instanceof ErroDaApi ? e.message : 'não consegui carregar as fotos padrão');
    }
  }, [id]);

  useEffect(() => {
    void carregarFotos();
  }, [carregarFotos]);

  // O endereço desta tela não diz de que loja é o canal. A moldura precisa
  // saber, para mostrar a loja certa e marcar "Canais" na navegação.
  const lojaDoCanal = ponto?.loja_id ?? null;
  useEffect(() => {
    if (lojaDoCanal) definirLoja(lojaDoCanal);
  }, [lojaDoCanal, definirLoja]);

  // Trocar de quadro recarrega o desenho: cada um tem o seu. O que estava
  // desenhado e não foi salvo no anterior se perde — por isso a troca só
  // acontece por um gesto claro (a lista, ou um clique no outro quadro).
  const poligonoDaZona = zona?.poligono;
  const nomeDaZona = zona?.nome;
  const larguraDaZona = zona?.largura_cena_cm;
  useEffect(() => {
    if (!poligonoDaZona) return;
    setPontos(poligonoDaZona.length >= 3 ? poligonoDaZona : QUADRO_INTEIRO);
    setDesfazer([]);
    setAtivo(null);
    setRecusado(false);
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
    const largura = larguraCm.trim() ? Number(larguraCm) : null;
    // A imagem completa é fixa: dela só a largura real da cena se informa.
    if (zona.principal) {
      setSalvando(true);
      setErro(null);
      try {
        const atualizada = await previewApi.salvarArea(zona.id, { larguraCenaCm: largura });
        setZonas((lista) => lista.map((z) => (z.id === atualizada.id ? { ...z, ...atualizada } : z)));
        avisar('Largura da imagem completa salva.');
      } catch (e) {
        setErro(e instanceof ErroDaApi ? e.message : 'não consegui salvar a largura');
      } finally {
        setSalvando(false);
      }
      return;
    }
    // As mesmas recusas do servidor, ditas antes de ir — ao lado do botão,
    // e só enquanto o desenho estiver torto.
    if (problema) return setRecusado(true);
    setRecusado(false);
    setSalvando(true);
    setErro(null);
    try {
      const atualizada = await previewApi.salvarArea(zona.id, {
        nome: nomeZona.trim() || zona.nome,
        poligono: limpar(pontos),
        larguraCenaCm: largura,
      });
      // A resposta não traz os critérios nem o número: eles não mudam ao salvar o desenho.
      setZonas((lista) => lista.map((z) => (z.id === atualizada.id ? { ...z, ...atualizada } : z)));
      avisar('Quadro salvo. O agente usa o novo contorno na próxima batida.');
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui salvar o quadro');
    } finally {
      setSalvando(false);
    }
  }

  async function novoQuadro() {
    setCriando(true);
    setErro(null);
    try {
      const novo = await previewApi.criarArea(id, { nome: nomeParaQuadroNovo(zonas.map((z) => z.nome)) });
      // Recarrega o canal: é o servidor que diz o número do quadro.
      await carregar();
      setZonaId(novo.id);
      atualizar();
      avisar('Quadro criado. Arraste os pontos para marcar o contorno, dê um nome e salve.');
      // O nome é a primeira coisa a acertar: "Quadro novo" não diz nada a ninguém.
      requestAnimationFrame(() => {
        campoDoNome.current?.focus();
        campoDoNome.current?.select();
      });
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui criar o quadro');
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
        `Quadro “${nome}” excluído.` +
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

  /** "+ Critério": a gaveta abre com ESTE lugar já marcado — o quadro, ou a imagem completa. */
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

  /** Clicar numa foto da lista: é ela que aparece no quadro. */
  function verFoto(f: FotoPadrao) {
    setFotoEscolhida(f.id);
    if (vista === 'agora') setVista('padrao');
  }

  async function fotoGuardada(f: FotoPadrao) {
    setGuardandoFoto(false);
    setFotoEscolhida(f.id);
    await carregarFotos();
    avisar('Foto padrão guardada. O agente recebe na próxima batida.');
  }

  async function confirmarExclusaoDaFoto() {
    if (!excluindoFoto) return;
    setExcluindoFotoAgora(true);
    setErroAoExcluirFoto(null);
    try {
      const r = await padroesApi.excluir(excluindoFoto.id);
      setExcluindoFoto(null);
      // Sem foto não há o que mostrar ao lado: o quadro volta ao de agora, e
      // fica lá quando outra for guardada.
      if (r.restantes === 0) setVista('agora');
      await carregarFotos();
      avisar(`Foto padrão “${r.nome}” excluída.`);
    } catch (e) {
      setErroAoExcluirFoto(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setExcluindoFotoAgora(false);
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

  /** Antes da primeira mudança de um gesto: guarda o desenho para o "desfazer". */
  const guardar = () => setDesfazer((h) => [...h.slice(-(MAX_DESFAZER - 1)), pontos]);

  /** Uma mudança inteira (botão, campo): guarda o de antes e troca. */
  function mudar(novo: Ponto[]) {
    guardar();
    setPontos(novo);
  }

  function voltar() {
    const antes = desfazer[desfazer.length - 1];
    if (!antes) return;
    setDesfazer((h) => h.slice(0, -1));
    setPontos(antes);
    setAtivo(null);
  }

  function tirarPonto(i: number) {
    if (pontos.length <= 3) return;
    mudar(semPonto(pontos, i));
    setAtivo(null);
  }

  /** O botão "Acrescentar ponto": no meio do lado mais comprido. */
  function acrescentarPonto() {
    if (pontos.length >= MAX_PONTOS) return;
    const i = ladoMaisComprido(pontos);
    mudar(comPontoNovo(pontos, i, meioDoLado(pontos, i)));
    setAtivo(i + 1);
  }

  // ───────────────────────── o diagnóstico ─────────────────────────

  const larguraZona = Number(larguraCm);
  const fracao = areaDe(pontos);
  const problema = problemaDoDesenho(pontos);
  const naInteira = zona?.principal === true;
  // O que deste quadro também está dentro de OUTRO que tem critério: ali os
  // critérios do outro enxergam a mesma coisa. Dito, não proibido — quadro
  // dentro de quadro existe de propósito (o balcão e, dentro dele, a gaveta).
  // Outro quadro sem critério não olha nada: não há o que dizer. E a imagem
  // completa não entra na conta: todo quadro está dentro dela, por definição.
  const invasoes =
    problema || naInteira
      ? []
      : zonas
          .filter((z) => !z.principal && z.id !== zonaId && z.poligono.length >= 3 && z.criterios.length > 0)
          .map((z) => ({ nome: rotuloDaArea(z), criterios: z.criterios.length, parte: sobreposicao(pontos, z.poligono) }))
          .filter((x) => x.parte >= SOBREPOSICAO_QUE_SE_DIZ);
  const resolucao = ponto?.resolucao_h ?? null;

  // px/cm que o MODELO vai ver, por degrau de envio. É o número que decide
  // se a pergunta tinha como ser respondida — não o megapixel da câmera.
  const degraus = [384, 640, 1000, 1920];
  const pxPorCm = larguraZona > 0 ? degraus.map((px) => ({ px, valor: Number((px / larguraZona).toFixed(1)) })) : [];

  const quadros = zonas.filter((z) => !z.principal);
  /** A área selecionada, como a tela a chama: "Imagem completa" ou "Quadro 2 · Montagem". */
  const rotulo = zona ? rotuloDaArea(zona) : '';
  /** Só o quadro se desenha, e só por quem configura. */
  const desenha = configura && zona !== null && !naInteira;
  const nomesDosCriterios = excluindo?.criterios.map((c) => `“${c.nome}”`) ?? [];

  // A foto que aparece no quadro: a escolhida na lista; sem escolha (ou se
  // ela foi excluída), a mais nova. Canal sem foto só tem a vista "agora".
  const fotoNoQuadro = fotos?.find((f) => f.id === fotoEscolhida) ?? fotos?.[0] ?? null;
  const vistaDeFato: Vista = fotoNoQuadro ? vista : 'agora';
  const semFoto = fotoNoQuadro ? null : SEM_FOTO;

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Link href={`/pontos/${id}`} className="inline-flex items-center gap-1 no-underline hover:text-farol-tinta">
              <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
              {ponto?.nome ?? 'Canal'}
            </Link>
            {ponto && (
              <span>
                · {ponto.setor_nome}
                {ponto.canal ? ` · canal ${ponto.canal}` : ''}
              </span>
            )}
          </>
        }
        titulo="Desenho, fotos e conexão"
      >
        O contorno de cada quadro, ponto a ponto; as fotos padrão; as medidas e a conexão do canal. A imagem
        completa é sempre o canal inteiro: não se redesenha.
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
              <Titulo id="t-quadro">Imagem do canal</Titulo>
              {estado?.capturadoEm && (
                <span className="font-mono text-[12.5px] text-farol-suave">{diaEHora(estado.capturadoEm)}</span>
              )}
              <Botao mini className="ml-auto" onClick={pedirQuadro} ocupado={pedindo || emVoo}>
                {!(pedindo || emVoo) && <RefreshCw className="h-[15px] w-[15px]" aria-hidden />}
                {pedindo ? 'Pedindo…' : emVoo ? 'Esperando a loja…' : 'Atualizar quadro'}
              </Botao>
            </div>

            {estado?.temPreview && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-vista-do-quadro>
                <Segmentado<Vista>
                  rotulo="O que a imagem mostra"
                  opcoes={[
                    { valor: 'agora', rotulo: 'Agora', icone: Crop },
                    { valor: 'padrao', rotulo: 'Foto padrão', icone: Imagem, desativada: semFoto },
                    { valor: 'comparar', rotulo: 'Comparar', icone: Columns2, desativada: semFoto },
                  ]}
                  valor={vistaDeFato}
                  aoMudar={setVista}
                />
                <span className="min-w-0 text-[12.5px] text-farol-suave" data-qual-foto>
                  {fotos === null
                    ? ''
                    : !fotoNoQuadro
                      ? `${SEM_FOTO}.`
                      : vistaDeFato === 'agora'
                        ? ''
                        : `Foto padrão: ${fotoNoQuadro.nome}, guardada em ${diaEHora(fotoNoQuadro.criadaEm)}.`}
                </span>
              </div>
            )}

            {estado?.temPreview && fotoNoQuadro && vistaDeFato !== 'agora' ? (
              <QuadroComPadrao
                modo={vistaDeFato}
                agora={previewApi.url(id, selo)}
                padrao={padroesApi.url(fotoNoQuadro.id)}
                nomeDaFoto={fotoNoQuadro.nome}
                nomeDoCanal={ponto.nome}
              />
            ) : estado?.temPreview ? (
              <QuadroDasAreas
                src={previewApi.url(id, selo)}
                alt={`Imagem do canal ${ponto.nome}, para marcar os quadros`}
                // A imagem completa não entra como contorno: ela é a própria imagem, e por cima dela
                // ficariam escondidos os quadros na hora do clique.
                areas={zonas
                  .map((z, i) => ({ id: z.id, nome: rotuloDaArea(z), pontos: z.poligono, cor: corDaArea(i), principal: z.principal }))
                  .filter((a) => !a.principal || a.id === zonaId)}
                selecionada={zonaId}
                pontos={pontos}
                ativo={ativo}
                aoAtivar={setAtivo}
                comProblema={problema !== null}
                etiqueta={naInteira ? null : zona?.numero != null ? `Quadro ${zona.numero} · ${nomeZona.trim() || 'quadro'}` : nomeZona.trim() || 'quadro'}
                editavel={desenha}
                aoComecar={guardar}
                aoMudar={setPontos}
                aoDesistir={voltar}
                aoSelecionar={setZonaId}
              />
            ) : (
              <Vazio icone={Crop} titulo="Este canal ainda não tem imagem">
                A imagem é capturada pelo agente instalado na loja. Use <strong>Atualizar quadro</strong> e ele
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

            {estado?.temPreview && desenha && vistaDeFato === 'agora' && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-barra-do-desenho>
                <span className="font-mono text-[12.5px] text-farol-suave">
                  {ativo !== null && ativo < pontos.length ? `ponto ${ativo + 1} de ${pontos.length}` : `${pontos.length} pontos`}
                </span>
                <Botao mini onClick={acrescentarPonto} disabled={pontos.length >= MAX_PONTOS}>
                  <Plus className="h-[15px] w-[15px]" aria-hidden />
                  Acrescentar ponto
                </Botao>
                <Botao
                  mini
                  onClick={() => ativo !== null && tirarPonto(ativo)}
                  disabled={ativo === null || ativo >= pontos.length || pontos.length <= 3}
                  title={pontos.length <= 3 ? 'O desenho precisa de pelo menos três pontos' : undefined}
                >
                  <Trash2 className="h-[15px] w-[15px]" aria-hidden />
                  Tirar este ponto
                </Botao>
                <Botao mini className="ml-auto" onClick={voltar} disabled={desfazer.length === 0}>
                  <Undo2 className="h-[15px] w-[15px]" aria-hidden />
                  Desfazer
                </Botao>
              </div>
            )}

            {problema && !naInteira && (
              <Alerta tom="critico" icone={TriangleAlert} papel="alert">
                {problema}
              </Alerta>
            )}
            {invasoes.map((x) => (
              <Alerta key={x.nome} tom="atencao" icone={TriangleAlert}>
                {Math.round(x.parte * 100)}% deste quadro também está dentro do “{x.nome}”, que tem{' '}
                {plural(x.criterios, 'critério', 'critérios')}: o que acontecer ali também é visto por{' '}
                {x.criterios === 1 ? 'ele' : 'eles'}. Para separar, ajuste o contorno de um dos dois.
              </Alerta>
            ))}

            {vistaDeFato === 'agora' ? (
              <p className="text-[12.5px] text-farol-suave" data-nota-do-desenho>
                {naInteira
                  ? 'A imagem completa é o canal inteiro: não se redesenha. Para conferir só uma parte, crie um quadro.'
                  : (desenha
                      ? 'Arraste um ponto para ajustar o contorno. O ponto menor, no meio de cada lado, cria um ponto novo. Arrastar sobre a imagem redesenha o quadro como um retângulo. '
                      : '') + 'O que fica escuro está fora do quadro: o agente apaga antes de analisar.'}
                {quadros.length > (naInteira ? 0 : 1) && ' Clique num quadro, sem arrastar, para passar a mexer nele.'}
              </p>
            ) : (
              <p className="text-[12.5px] text-farol-suave" data-nota-da-vista>
                {vistaDeFato === 'padrao'
                  ? 'É com esta imagem que a loja compara. Os quadros se desenham na imagem de agora.'
                  : 'Arraste o divisor: à esquerda, a imagem de agora; à direita, a foto padrão.'}
              </p>
            )}
          </section>

          {/* ───────────────────── ao lado ───────────────────── */}
          <aside aria-label="Quadros do canal e ajustes" className="flex flex-col gap-3.5">
            {/* a imagem completa e os quadros do canal */}
            <section aria-labelledby="t-areas" className={`${CARTAO} flex flex-col gap-3 p-4`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Titulo id="t-areas">Quadros deste canal</Titulo>
                {configura && (
                  <Botao
                    mini
                    className="ml-auto"
                    onClick={novoQuadro}
                    ocupado={criando}
                    disabled={quadros.length >= MAX_QUADROS}
                    title={quadros.length >= MAX_QUADROS ? `Um canal tem no máximo ${MAX_QUADROS} quadros` : undefined}
                  >
                    {!criando && <Plus className="h-[15px] w-[15px]" aria-hidden />}
                    {criando ? 'Criando…' : 'Novo quadro'}
                  </Botao>
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {zonas.map((z, i) => {
                  const selecionada = z.id === zonaId;
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
                          <b className="block break-words font-semibold">{rotuloDaArea(z)}</b>
                          <small className="block text-xs text-farol-suave">
                            {z.principal ? 'o canal inteiro · ' : ''}
                            {z.criterios.length === 0
                              ? 'sem critério'
                              : z.principal
                                ? plural(z.criterios.length, 'critério geral', 'critérios gerais')
                                : plural(z.criterios.length, 'critério', 'critérios')}
                          </small>
                        </span>
                      </button>
                      {/* A imagem completa não se exclui: ela é o canal. */}
                      {configura && !z.principal && (
                        <Botao
                          variante="fantasma"
                          mini
                          quadrado
                          aria-label={`Excluir o ${rotuloDaArea(z)}`}
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
                Cada quadro tem os seus critérios; os da imagem completa são os gerais do canal. O papel de cada
                quadro se escolhe na tela do canal.
              </p>
            </section>

            {/* os critérios do que está selecionado */}
            {zona && (
              <section aria-labelledby="t-area-crit" className={`${CARTAO} flex flex-col gap-3 p-4`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Titulo id="t-area-crit">{naInteira ? 'Critérios gerais do canal' : `Critérios no ${rotulo}`}</Titulo>
                  {configura && ponto.ativo && (
                    <Botao mini className="ml-auto" onClick={criterioNaArea} ocupado={abrindoCriterio}>
                      {!abrindoCriterio && <Plus className="h-[15px] w-[15px]" aria-hidden />}
                      Critério
                    </Botao>
                  )}
                </div>
                {zona.criterios.length === 0 ? (
                  <p className="text-[13px] text-farol-suave">
                    {naInteira ? 'Nenhum critério geral neste canal.' : 'Nenhum critério neste quadro. Nada é verificado nele.'}
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

            {/* as fotos padrão do canal */}
            <FotosPadrao
              fotos={fotos}
              maximo={maximoDeFotos}
              erro={erroDasFotos}
              noQuadro={vistaDeFato === 'agora' ? null : (fotoNoQuadro?.id ?? null)}
              configura={configura}
              temQuadro={Boolean(estado?.temPreview)}
              aoVer={verFoto}
              aoGuardar={() => setGuardandoFoto(true)}
              aoExcluir={(f) => {
                setErroAoExcluirFoto(null);
                setExcluindoFoto(f);
              }}
            />

            {/* o que está selecionado: a imagem completa, ou um quadro */}
            <section className={`${CARTAO} flex flex-col gap-3 p-4`} data-selecionada={naInteira ? 'inteira' : 'quadro'}>
              <Titulo>{naInteira ? NOME_DA_IMAGEM_COMPLETA : zona?.numero != null ? `Quadro ${zona.numero}` : 'Quadro'}</Titulo>

              {naInteira && (
                <p className="text-[13px] text-farol-suave">
                  É sempre o canal inteiro: não muda de contorno nem de nome, e é nela que ficam os critérios gerais.
                  Para conferir só uma parte da imagem, crie um quadro.
                </p>
              )}

              {!naInteira && (
              <Campo rotulo="Nome do quadro" htmlFor="area-nome">
                <input
                  ref={campoDoNome}
                  id="area-nome"
                  value={nomeZona}
                  maxLength={60}
                  disabled={!configura}
                  onChange={(e) => setNomeZona(e.target.value)}
                  placeholder="área de montagem"
                  className="entrada"
                />
              </Campo>
              )}

              {!naInteira && (
              <details className="rounded-[10px] border border-farol-borda px-3 py-2" data-pontos-em-numeros>
                <summary className="cursor-pointer text-[13px] font-semibold">
                  Ajustar pelos números ({pontos.length} pontos)
                </summary>
                <p className={`${AJUDA} mt-2`}>A posição de cada ponto, em % da imagem: da esquerda e do topo.</p>
                <ol className="mt-2 flex flex-col gap-1.5">
                  {pontos.map(([x, y], i) => (
                    <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
                      <span className="font-mono text-[12.5px] text-farol-suave">{i + 1}</span>
                      {([0, 1] as const).map((eixo) => (
                        <input
                          key={eixo}
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          disabled={!configura}
                          aria-label={`Ponto ${i + 1}: % ${eixo === 0 ? 'da esquerda' : 'do topo'}`}
                          value={emPorCento(eixo === 0 ? x : y)}
                          onFocus={() => setAtivo(i)}
                          onChange={(e) => {
                            const v = Number(e.target.value) / 100;
                            if (!Number.isFinite(v)) return;
                            mudar(comPontoEm(pontos, i, eixo === 0 ? [v, y] : [x, v]));
                          }}
                          className="entrada !min-h-9 !px-2 font-mono"
                        />
                      ))}
                      {configura && (
                        <Botao
                          variante="fantasma"
                          mini
                          quadrado
                          disabled={pontos.length <= 3}
                          aria-label={`Tirar o ponto ${i + 1}`}
                          onClick={() => tirarPonto(i)}
                        >
                          <Trash2 className="h-[16px] w-[16px]" aria-hidden />
                        </Botao>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
              )}

              {desenha && (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  <button type="button" onClick={() => mudar(QUADRO_INTEIRO)} className="elo text-[13px]">
                    Cobrir a imagem inteira
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const c = caixaDe(pontos);
                      mudar([[c.x1, c.y1], [c.x2, c.y1], [c.x2, c.y2], [c.x1, c.y2]]);
                    }}
                    className="elo text-[13px]"
                  >
                    Voltar a um retângulo
                  </button>
                </div>
              )}

              <Campo
                rotulo={naInteira ? 'Largura real do que a câmera vê, em cm' : 'Largura real deste quadro, em cm'}
                htmlFor="area-largura"
                ajuda="É o que permite saber quantos pontos de imagem cabem em cada centímetro. Medir com fita é mais confiável que a conta pela lente, porque a lente de verdade distorce."
              >
                <input
                  id="area-largura"
                  type="number"
                  min={1}
                  step={1}
                  value={larguraCm}
                  disabled={!configura}
                  onChange={(e) => setLarguraCm(e.target.value)}
                  placeholder="meça com fita"
                  className="entrada font-mono"
                />
              </Campo>

              {recusado && problema && !naInteira && (
                <Alerta tom="critico" papel="alert">
                  Não salvei. {problema}
                </Alerta>
              )}
              {configura && (
                <Botao variante="primario" onClick={salvar} ocupado={salvando} disabled={!zona}>
                  {salvando ? 'Salvando…' : naInteira ? 'Salvar largura' : 'Salvar quadro'}
                </Botao>
              )}
            </section>

            <section className={`${CARTAO} flex flex-col gap-3 p-4`}>
              <Titulo>{naInteira ? 'O que a imagem completa sustenta' : 'O que este quadro sustenta'}</Titulo>
              <dl className="flex flex-col text-[13px] [&>div+div]:border-t [&>div+div]:border-farol-borda [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:py-[7px]">
                <div>
                  <dt className="text-farol-suave">da imagem</dt>
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
                  : naInteira
                    ? 'Informe a largura real do que a câmera vê para saber o que a imagem completa sustenta.'
                    : 'Informe a largura real do quadro para ver o que ele sustenta.'}
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

      {guardandoFoto && (
        <GavetaDaFotoPadrao
          pontoId={id}
          capturadoEm={estado?.capturadoEm ?? null}
          pessoas={estado?.pessoas ?? null}
          aoGuardar={fotoGuardada}
          aoFechar={() => setGuardandoFoto(false)}
        />
      )}

      {excluindoFoto && (
        <Dialogo
          titulo={`Excluir a foto padrão “${excluindoFoto.nome}”?`}
          rotuloConfirmar="Excluir foto"
          rotuloOcupado="Excluindo…"
          ocupado={excluindoFotoAgora}
          erro={erroAoExcluirFoto}
          aoConfirmar={confirmarExclusaoDaFoto}
          aoCancelar={() => setExcluindoFoto(null)}
        >
          {(fotos?.length ?? 0) <= 1 ? (
            <p>
              É a única foto padrão deste canal.{' '}
              <strong>Sem ela, critério de comparação deixa de ser conferido aqui</strong> e fica marcado com “falta a
              foto padrão”. Critério de estado que manda a foto junto passa a perguntar sem ela.
            </p>
          ) : (
            <p>
              O canal continua com {plural((fotos?.length ?? 1) - 1, 'foto padrão', 'fotos padrão')}: a loja compara
              com a que mais se parecer com a cena.
            </p>
          )}
          <p>A imagem é apagada da nuvem e, na próxima batida do agente, do computador da loja.</p>
        </Dialogo>
      )}

      {excluindo && (
        <Dialogo
          titulo={`Excluir o ${rotuloDaArea(excluindo)}?`}
          rotuloConfirmar="Excluir quadro"
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
            <p>Nenhum critério vale neste quadro.</p>
          )}
          <p>O que já foi registrado nele continua no histórico. Os outros quadros são renumerados; a imagem completa não muda.</p>
        </Dialogo>
      )}
    </>
  );
}
