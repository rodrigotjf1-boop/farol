'use client';

// =====================================================================
// Planta › Calibrar câmera (A26, P4)
// =====================================================================
// Do protótipo aprovado em 25/10/2026 (`mockups/farol-planta-viva-e-saude.html`).
// Quem configura marca, na imagem do canal, um ponto do CHÃO e depois o
// mesmo ponto na planta (medido com trena); de 4 pontos para cima a conta
// começa (`POST …/calibracoes/:canal/conferir`, sem salvar): a planta mostra
// o piso que a câmera vê, a régua do erro conferido e, para o próximo ponto,
// onde a conta acha que ele fica. "Salvar calibração" grava com a versão que
// leu (409 = outra pessoa salvou no meio); "Tirar calibração" apaga (a câmera
// foi mexida). A conta é do servidor (`api/src/calibracao.ts`).
//
// "Importar pontos" (27/10/2026): as calibrações feitas fora do console (pela
// grade do piso) entram por um arquivo, cada uma no canal da loja com o mesmo
// número (`lib/calibracao-importar.ts`); salvas como o "Salvar calibração".
// =====================================================================

import { Crosshair, Map as IconeDeMapa, Save, Trash2, Undo2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { type ChangeEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { abasDaPlanta } from '@/componentes/planta-viva/abas-da-planta';
import { ImagemParaMarcar } from '@/componentes/planta-viva/imagem-para-marcar';
import { PlantaDeCima, PoligonoNoChao } from '@/componentes/planta-viva/planta-de-cima';
import { usePlantaViva } from '@/componentes/planta-viva/use-planta-viva';
import { abasDeCanais } from '@/componentes/pontos/abas-de-canais';
import { Abas } from '@/componentes/ui/abas';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Segmentado, Titulo, Vazio } from '@/componentes/ui/pecas';
import { Dialogo } from '@/componentes/ui/sobreposto';
import { calibracaoApi, ErroDaApi } from '@/lib/api';
import { lerArquivoDePontos, TAMANHO_MAXIMO_DO_ARQUIVO, type CalibracaoImportada } from '@/lib/calibracao-importar';
import { LIMITES } from '@/lib/planta';
import { ERRO_SUSPEITO_M, PONTOS_MINIMOS, PONTOS_RECOMENDADOS, projetar, type ConferenciaDaCalibracao, type ParDaCalibracao, type Pt } from '@/lib/planta-viva';

const mesmoPonto = (a: ParDaCalibracao, img: Pt, piso: Pt) =>
  Math.hypot(a.img[0] - img[0], a.img[1] - img[1]) < 0.01 || Math.hypot(a.piso[0] - piso[0], a.piso[1] - piso[1]) < 0.05;
const fmt = (n: number, casas = 0) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function Calibrar() {
  const { id } = useParams<{ id: string }>();
  const busca = useSearchParams();
  const router = useRouter();
  const { loja, configura } = useConsole();
  const avisar = useAvisar();
  const { dados, erro, carregar, nomeDaCamera, nomeLongo, corDe } = usePlantaViva(id);

  const canais = dados?.canais ?? [];
  const pedido = busca.get('canal');
  const canal = canais.find((c) => c.id === pedido)?.id ?? dados?.planta?.cameras[0]?.pontoId ?? canais[0]?.id ?? null;

  // o que está sendo marcado neste canal
  const [pares, setPares] = useState<ParDaCalibracao[]>([]);
  const [guardados, setGuardados] = useState<ParDaCalibracao[]>([]);
  const [versao, setVersao] = useState<number | null>(null);
  const [pendente, setPendente] = useState<Pt | null>(null);
  const [conta, setConta] = useState<ConferenciaDaCalibracao | null>(null);
  const [erroDaConta, setErroDaConta] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const [tirando, setTirando] = useState(false);
  const [erroAoTirar, setErroAoTirar] = useState<string | null>(null);
  const [perguntandoTirar, setPerguntandoTirar] = useState(false);
  const [trocarPara, setTrocarPara] = useState<string | null>(null);

  // importar os pontos de um arquivo
  const arquivo = useRef<HTMLInputElement>(null);
  const [importacao, setImportacao] = useState<{ nome: string; lista: CalibracaoImportada[] } | null>(null);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<Array<{ rotulo: string; ok: boolean; texto: string }> | null>(null);
  const [recarga, setRecarga] = useState(0);

  // a calibração guardada do canal escolhido (de novo depois de importar)
  useEffect(() => {
    if (!canal) return;
    let vivo = true;
    setLendo(true);
    setPendente(null);
    setErroAoSalvar(null);
    calibracaoApi
      .uma(id, canal)
      .then((c) => { if (vivo) { setPares(c.pares ?? []); setGuardados(c.pares ?? []); setVersao(c.versao); } })
      .catch((e) => {
        if (!vivo) return;
        setPares([]);
        setGuardados([]);
        setVersao(null);
        if (!(e instanceof ErroDaApi && e.status === 404)) setErroAoSalvar(e instanceof ErroDaApi ? e.message : 'não consegui ler a calibração');
      })
      .finally(() => vivo && setLendo(false));
    return () => { vivo = false; };
  }, [id, canal, recarga]);

  // a conta, sem salvar, a cada mudança dos pontos (de 4 para cima); só a resposta mais nova vale
  const pedidoDaConta = useRef(0);
  useEffect(() => {
    if (!canal || pares.length < PONTOS_MINIMOS) {
      setConta(null);
      setErroDaConta(null);
      return;
    }
    const meu = ++pedidoDaConta.current;
    const t = setTimeout(() => {
      calibracaoApi
        .conferir(id, canal, pares)
        .then((c) => { if (meu === pedidoDaConta.current) { setConta(c); setErroDaConta(null); } })
        .catch((e) => { if (meu === pedidoDaConta.current) { setConta(null); setErroDaConta(e instanceof ErroDaApi ? e.message : 'não consegui fazer a conta'); } });
    }, 150);
    return () => clearTimeout(t);
  }, [id, canal, pares]);

  const mudou = JSON.stringify(pares) !== JSON.stringify(guardados);
  useEffect(() => {
    if (!mudou) return;
    const perguntar = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener('beforeunload', perguntar);
    return () => window.removeEventListener('beforeunload', perguntar);
  }, [mudou]);

  const tocarNoChao = useCallback(
    (piso: Pt) => {
      if (!pendente) {
        avisar('Primeiro o ponto na imagem da câmera; depois, o mesmo ponto aqui na planta.');
        return;
      }
      if (piso[0] < 0 || piso[1] < 0 || piso[0] > LIMITES.extensao || piso[1] > LIMITES.extensao) {
        avisar('Fora da planta: toque dentro do chão desenhado.');
        return;
      }
      const repetido = pares.findIndex((p) => mesmoPonto(p, pendente, piso));
      setPendente(null);
      if (repetido >= 0) {
        avisar(`É o mesmo ponto que o ${repetido + 1}: perto demais na imagem ou no chão.`);
        return;
      }
      const novos = [...pares, { img: pendente, piso }];
      setPares(novos);
      avisar(novos.length === PONTOS_MINIMOS ? 'Com 4 pontos, a conta começou: a planta já mostra o piso que a câmera vê.' : `Ponto ${novos.length} marcado.`);
    },
    [pendente, pares, avisar],
  );

  async function salvar() {
    if (!canal) return;
    setSalvando(true);
    setErroAoSalvar(null);
    try {
      const c = await calibracaoApi.salvar(id, canal, pares, versao);
      setVersao(c.versao);
      setGuardados(c.pares ?? pares);
      await carregar();
      avisar(`Calibração do ${nomeDaCamera(canal).toLowerCase()} salva. O agente recebe em até 1 minuto.`);
    } catch (e) {
      setErroAoSalvar(e instanceof ErroDaApi ? e.message : 'não consegui salvar a calibração');
    } finally {
      setSalvando(false);
    }
  }

  async function tirar() {
    if (!canal) return;
    setTirando(true);
    setErroAoTirar(null);
    try {
      await calibracaoApi.tirar(id, canal);
      setPares([]);
      setGuardados([]);
      setVersao(null);
      setPerguntandoTirar(false);
      await carregar();
      avisar(`Calibração do ${nomeDaCamera(canal).toLowerCase()} tirada.`);
    } catch (e) {
      setErroAoTirar(e instanceof ErroDaApi ? e.message : 'não consegui tirar a calibração');
    } finally {
      setTirando(false);
    }
  }

  /** O arquivo escolhido: lido e ligado aos canais; o resumo vai para o diálogo antes de salvar. */
  async function leuArquivo(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = ''; // o MESMO arquivo de novo tem de disparar outra vez
    if (!f) return;
    setErroDoArquivo(null);
    setResultado(null);
    if (f.size > TAMANHO_MAXIMO_DO_ARQUIVO) {
      setErroDoArquivo(`O arquivo ${f.name} não foi aberto: é grande demais para pontos de calibração.`);
      return;
    }
    let conteudo: string;
    try {
      conteudo = await f.text();
    } catch {
      setErroDoArquivo(`Não consegui ler o arquivo ${f.name}.`);
      return;
    }
    const r = lerArquivoDePontos(conteudo, (dados?.canais ?? []).map((c) => ({ id: c.id, canal: c.canal, nome: c.nome })));
    if (!r.calibracoes) {
      setErroDoArquivo(`O arquivo ${f.name} não foi aberto: ${r.problema ?? 'não traz pontos de calibração'}.`);
      return;
    }
    setImportacao({ nome: f.name, lista: r.calibracoes });
  }

  /** Confirmado: cada calibração que entrou é salva no seu canal, com a versão lida (como o "Salvar calibração"). */
  async function salvarImportadas() {
    if (!importacao) return;
    setImportando(true);
    const feitos: Array<{ rotulo: string; ok: boolean; texto: string }> = [];
    for (const c of importacao.lista) {
      if (!c.ponto) continue;
      const nome = nomeLongo(c.ponto.id);
      try {
        const salva = await calibracaoApi.salvar(id, c.ponto.id, c.pares, dados?.calibracoes.get(c.ponto.id)?.versao ?? null);
        const reg = salva.erros?.conferido?.medianaM;
        feitos.push({ rotulo: nome, ok: true, texto: `${c.pares.length} pontos${reg != null ? ` · régua ${fmt(reg * 100)} cm` : ''}` });
      } catch (e) {
        feitos.push({ rotulo: nome, ok: false, texto: e instanceof ErroDaApi ? e.message : 'não consegui salvar' });
      }
    }
    setImportando(false);
    setImportacao(null);
    setResultado(feitos);
    await carregar();
    setRecarga((n) => n + 1);
    const certos = feitos.filter((f) => f.ok).length;
    avisar(certos === feitos.length ? `${certos} calibração(ões) salva(s). O agente recebe em até 1 minuto.` : `${certos} de ${feitos.length} calibrações salvas; veja o que faltou no alto.`);
  }

  const fantasma = useMemo(() => (pendente && conta ? projetar(conta.homografia, pendente) : null), [pendente, conta]);

  const cabecalho = (
    <>
      <Cabecalho
        sobre={loja?.nome}
        titulo="Planta viva"
        acoes={
          configura && dados && (
            <Botao onClick={() => arquivo.current?.click()} disabled={importando} data-importar-pontos>
              <Upload className="h-[18px] w-[18px]" aria-hidden />
              Importar pontos
            </Botao>
          )
        }
      >
        Cada câmera no mapa pelos pontos marcados no chão: o que ela cobre de verdade, e as pessoas no mapa — sem nome e sem
        rosto.
      </Cabecalho>
      <Abas rotulo="Vistas dos canais" abas={abasDeCanais(id)} />
      <Abas rotulo="Vistas da planta" abas={abasDaPlanta(id)} />
      {/* o arquivo dos pontos: escolhido pelo botão "Importar pontos" */}
      <input
        ref={arquivo}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(ev) => void leuArquivo(ev)}
        data-arquivo-de-pontos
      />
      {erroDoArquivo && <Alerta tom="critico" papel="alert">{erroDoArquivo}</Alerta>}
      {resultado && resultado.some((r) => !r.ok) && (
        <Alerta tom="critico" papel="alert">
          <b className="font-semibold">Nem todas as calibrações foram salvas.</b>{' '}
          {resultado.filter((r) => !r.ok).map((r) => `${r.rotulo}: ${r.texto}`).join(' · ')}
        </Alerta>
      )}
      {importacao && (
        <Dialogo
          titulo="Importar os pontos de calibração"
          rotuloConfirmar={`Salvar ${importacao.lista.filter((c) => c.ponto).length} calibração(ões)`}
          rotuloOcupado="Salvando…"
          variante="primario"
          ocupado={importando}
          aoConfirmar={() => void salvarImportadas()}
          aoCancelar={() => setImportacao(null)}
        >
          <div className="flex flex-col gap-3 text-[14px]" data-resumo-dos-pontos>
            <p>
              <b className="break-all font-semibold">{importacao.nome}</b>: {importacao.lista.length} calibração(ões).
            </p>
            <ul className="flex flex-col gap-1.5" aria-label="As calibrações do arquivo">
              {[...importacao.lista]
                .sort((a, b) => (a.numero ?? 1e9) - (b.numero ?? 1e9))
                .map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <b className="font-semibold">{c.rotulo}</b>
                    {c.ponto ? (
                      <span className="min-w-0 text-farol-suave">
                        → {nomeLongo(c.ponto.id)} · {c.pares.length} pontos ·{' '}
                        {dados?.calibracoes.has(c.ponto.id) ? 'troca a calibração de agora' : 'ainda sem calibração'}
                      </span>
                    ) : (
                      <Chip tom="atencao">fica de fora: {c.motivo}</Chip>
                    )}
                  </li>
                ))}
            </ul>
            {mudou && canal && importacao.lista.some((c) => c.ponto?.id === canal) && (
              <p className="text-farol-critico">Os pontos ainda não salvos do {nomeDaCamera(canal).toLowerCase()} se perdem: entram os do arquivo.</p>
            )}
            <p className="text-farol-suave">
              Cada calibração é salva no seu canal como no Salvar calibração, e o agente recebe em até 1 minuto. Para desfazer
              uma, use Tirar calibração no canal.
            </p>
          </div>
        </Dialogo>
      )}
    </>
  );
  if (!configura) {
    return (
      <>
        {cabecalho}
        <Alerta papel="status">
          <b className="font-semibold">Calibrar as câmeras é de quem configura a loja (gerente para cima).</b> Você vê o que
          cada câmera cobre e o movimento.
        </Alerta>
      </>
    );
  }
  if (erro) return (<>{cabecalho}<Alerta tom="critico" papel="alert">{erro}</Alerta></>);
  if (!dados) return (<>{cabecalho}<Ossos alturas={[[300, 300], 160]} /></>);
  const planta = dados.planta;
  if (!planta || !planta.ambientes.length) {
    return (
      <>
        {cabecalho}
        <Vazio icone={IconeDeMapa} titulo="Falta a planta da loja" acao={<Link href={`/lojas/${id}/canais/planta`} className={classesDoBotao({ variante: 'primario' })}>Desenhar a planta</Link>}>
          Os pontos do chão se marcam na planta, em metros. Desenhe os ambientes da loja primeiro.
        </Vazio>
      </>
    );
  }
  if (!canal) {
    return (
      <>
        {cabecalho}
        <Vazio icone={Crosshair} titulo="Nenhum canal na loja">Cadastre os canais (as câmeras) em Canais › Lista primeiro.</Vazio>
      </>
    );
  }

  const cor = corDe(canal);
  const porPar = conta?.erros.conferido?.porPar ?? [];
  const regua = conta?.erros.conferido?.medianaM ?? null;
  const [minimo, maximo] = PONTOS_RECOMENDADOS;
  const situacao =
    pares.length < PONTOS_MINIMOS
      ? `faltam ${PONTOS_MINIMOS - pares.length} ponto(s) para a conta começar`
      : erroDaConta
        ? erroDaConta
        : pares.length < minimo
          ? `calibrada · marque mais ${minimo - pares.length} para a régua ficar boa`
          : 'calibrada';

  return (
    <>
      {cabecalho}
      <Segmentado
        rotulo="O canal"
        opcoes={canais.map((c) => ({ valor: c.id, rotulo: nomeDaCamera(c.id) }))}
        valor={canal}
        aoMudar={(novo) => {
          if (mudou) setTrocarPara(novo);
          else router.replace(`/lojas/${id}/canais/planta/calibrar?canal=${novo}`);
        }}
      />
      {mudou && (
        <Alerta tom="atencao" papel="status">
          <b className="font-semibold">Pontos ainda não salvos.</b> Trocar de canal ou sair perde o que foi marcado aqui.
        </Alerta>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={`${CARTAO} flex flex-col gap-3 p-[14px] md:p-[18px]`} aria-labelledby="t-imagem" data-passo-imagem>
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <Titulo id="t-imagem">{pendente ? '2 · Agora o mesmo ponto na planta' : '1 · Toque num ponto do chão na imagem'}</Titulo>
            <span className="font-mono text-[11px] text-farol-suave">{nomeLongo(canal)}</span>
          </header>
          {lendo ? (
            <div className="osso aspect-video w-full rounded-xl" aria-hidden />
          ) : (
            <ImagemParaMarcar
              key={canal}
              pontoId={canal}
              nome={nomeLongo(canal)}
              cor={cor}
              marcados={pares.map((p) => p.img)}
              pendente={pendente}
              podeMarcar
              aoTocar={(uv) => setPendente(uv)}
            />
          )}
        </section>
        <section className={`${CARTAO} flex flex-col gap-3 p-[14px] md:p-[18px]`} aria-labelledby="t-planta" data-passo-planta>
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <Titulo id="t-planta">Planta</Titulo>
            <span className="font-mono text-[11px] text-farol-suave">
              {pendente ? 'onde esse ponto fica, medido com trena' : 'os pontos marcados e o piso que a câmera vê'}
            </span>
          </header>
          <PlantaDeCima
            planta={planta}
            descricao={`A planta com os ${pares.length} ponto(s) marcados de ${nomeLongo(canal)}${pendente ? '; toque onde fica o ponto marcado na imagem' : ''}`}
            camerasVisiveis={new Set([canal])}
            nomeDaCamera={nomeDaCamera}
            corDe={corDe}
            alvo={Boolean(pendente)}
            aoTocarNoChao={tocarNoChao}
          >
            {({ p, recorte }) => (
              <>
                {conta && <PoligonoNoChao pts={conta.area} p={p} cor={cor} recorte={recorte} />}
                {pares.map((par, i) => {
                  const [x, y] = p(par.piso[0], par.piso[1]);
                  return (
                    <g key={i} pointerEvents="none">
                      <circle cx={x} cy={y} r={11} fill={cor} stroke="white" strokeWidth={1.5} />
                      <text x={x} y={y + 4} textAnchor="middle" className="font-display text-[12px] font-extrabold" fill="white">{i + 1}</text>
                    </g>
                  );
                })}
                {fantasma && (() => {
                  const [x, y] = p(fantasma[0], fantasma[1]);
                  return (
                    <g pointerEvents="none" data-fantasma>
                      <circle cx={x} cy={y} r={13} fill="none" stroke="rgb(var(--mostarda))" strokeWidth={3} strokeDasharray="4 3" />
                      <text x={x} y={y - 18} textAnchor="middle" className="font-mono text-[10px]" style={{ fill: 'rgb(var(--tinta))', paintOrder: 'stroke', stroke: 'rgb(var(--painel))', strokeWidth: 3 }}>
                        a conta acha que é aqui
                      </text>
                    </g>
                  );
                })()}
              </>
            )}
          </PlantaDeCima>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className={`${CARTAO} flex flex-col gap-3 p-[18px]`} aria-labelledby="t-regua" data-regua>
          <Titulo id="t-regua">A régua</Titulo>
          <div className="flex items-baseline gap-3">
            <b className="font-display text-[54px] font-black leading-[.9]">{regua != null ? fmt(regua * 100) : '—'}</b>
            <span className="text-[14px]">
              cm: quanto a posição de um ponto do chão erra, deixando cada ponto de fora por vez e vendo onde ele cai
              {pares.length < 5 ? ' (aparece com 5 pontos ou mais)' : ''}
            </span>
          </div>
          <p className="text-[12.5px] text-farol-suave">
            {situacao}. {pares.length} de {minimo} a {maximo} pontos. Erro de um ponto acima de {fmt(ERRO_SUSPEITO_M * 100)} cm costuma ser
            trena ou toque no lugar errado: tire-o e marque de novo.
          </p>
          {erroAoSalvar && <Alerta tom="critico" papel="alert">{erroAoSalvar}</Alerta>}
          <div className="flex flex-wrap gap-2">
            <Botao variante="primario" onClick={salvar} ocupado={salvando} disabled={!conta || !mudou} data-salvar-calibracao>
              <Save className="h-4 w-4" aria-hidden />
              Salvar calibração
            </Botao>
            <Botao onClick={() => (pendente ? setPendente(null) : setPares((ps) => ps.slice(0, -1)))} disabled={!pendente && !pares.length}>
              <Undo2 className="h-4 w-4" aria-hidden />
              Desfazer
            </Botao>
            <Botao variante="fantasma" onClick={() => setPerguntandoTirar(true)} disabled={!guardados.length}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Tirar calibração
            </Botao>
          </div>
        </section>
        <section className="flex flex-col gap-2 rounded-[22px] bg-farol-painel-2 p-[18px]" aria-labelledby="t-pontos" data-pontos>
          <Titulo id="t-pontos" conta={pares.length}>Os pontos</Titulo>
          {pares.length ? (
            <ol className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
              {pares.map((par, i) => {
                const e = porPar[i];
                return (
                  <li key={i} className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-xl bg-farol-painel px-2.5 py-2 font-mono text-[12px]">
                    <span className="grid h-[26px] w-[26px] place-items-center rounded-full font-display text-[13px] font-extrabold text-white" style={{ background: cor }}>{i + 1}</span>
                    <span className="min-w-0">
                      imagem {fmt(par.img[0] * 100)}% · {fmt(par.img[1] * 100)}%
                      <br />
                      planta x {fmt(par.piso[0], 2)} m · y {fmt(par.piso[1], 2)} m
                    </span>
                    <span className={`font-semibold ${e != null && e > ERRO_SUSPEITO_M ? 'text-farol-critico' : ''}`}>{e != null ? `${fmt(e * 100)} cm` : '—'}</span>
                    <Botao variante="fantasma" mini quadrado aria-label={`Tirar o ponto ${i + 1}`} onClick={() => setPares((ps) => ps.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Botao>
                  </li>
                );
              })}
            </ol>
          ) : (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px]">
              <li>Na loja, marque de {minimo} a {maximo} pontos no chão com fita, espalhados (inclusive atrás das bancadas), e meça cada um com trena a partir de duas paredes.</li>
              <li>Aqui, toque no ponto na imagem da câmera; depois, no mesmo ponto na planta.</li>
              <li>Com 4 pontos a conta começa; com 5, aparece a régua; a partir daí, a planta mostra onde a conta acha que o próximo ponto fica.</li>
            </ol>
          )}
        </section>
      </div>

      {trocarPara && (
        <Dialogo
          titulo="Trocar de canal sem salvar?"
          rotuloConfirmar="Trocar sem salvar"
          rotuloCancelar="Continuar marcando"
          aoConfirmar={() => {
            const novo = trocarPara;
            setTrocarPara(null);
            router.replace(`/lojas/${id}/canais/planta/calibrar?canal=${novo}`);
          }}
          aoCancelar={() => setTrocarPara(null)}
        >
          <p>Os pontos marcados agora no {nomeDaCamera(canal).toLowerCase()} ainda não foram salvos e se perdem ao trocar.</p>
        </Dialogo>
      )}
      {perguntandoTirar && (
        <Dialogo
          titulo="Tirar a calibração?"
          rotuloConfirmar="Tirar calibração"
          rotuloOcupado="Tirando…"
          ocupado={tirando}
          erro={erroAoTirar}
          aoConfirmar={tirar}
          aoCancelar={() => setPerguntandoTirar(false)}
        >
          <p>
            Os {guardados.length} pontos do {nomeDaCamera(canal).toLowerCase()} saem, e a planta viva deixa de usar esta câmera
            até ela ser calibrada de novo. Use quando a câmera foi mexida.
          </p>
        </Dialogo>
      )}
    </>
  );
}

export default function PaginaDeCalibrar() {
  // `useSearchParams` pede o Suspense em volta (o Next monta a página sem a busca no servidor)
  return (
    <Suspense fallback={<Ossos alturas={[[300, 300], 160]} />}>
      <Calibrar />
    </Suspense>
  );
}
