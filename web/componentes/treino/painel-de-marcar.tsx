'use client';

// =====================================================================
// Marcar ingredientes — o recorte de um passo e a pilha que a câmera vê
// =====================================================================
// A24, fase F3. O dono, 23/10/2026: "para treinamento inicial, antes de
// associar com ficha, primeiro teríamos que treinar identificar
// ingrediente como no teste de 112 [...] ali é um bom treinamento". Do
// protótipo "Marcar ingredientes", aprovado em 24/10/2026:
//
//   • a loja escolhe, com ela fechada, uns 100 recortes da noite (os de
//     mais dúvida do juiz e um pouco de cada ingrediente). Aqui vem UMA
//     noite por vez, a dúvida primeiro, um recorte de cada vez;
//   • a pessoa toca nos ingredientes na ordem da pilha, de cima para
//     baixo; o que se conta por unidade ou fatia tem − e +; ↑ ↓ ✕ arrumam a
//     pilha. Ou diz "não é ingrediente" ou "não dá para ver";
//   • "Salvar e próximo" (ou Enter) grava na hora: o de cima vira exemplo
//     da base da loja, e o agente reaprende com a loja fechada. No último,
//     a tela leva ao que ficou sem resposta (ERR-149 da página local);
//   • "o Farol acertou antes": dos marcados nesta noite com um ingrediente
//     em cima, em quantos o juiz tinha dito esse nome.
// =====================================================================

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ImageOff, Info, Layers, Minus, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import { dataNaLoja, frase, horaNaLoja, numero, plural, porcento } from '@/componentes/formatos';
import { NOTA_ALTA, NOTA_MEDIA } from '@/componentes/treino/conferencia-por-passo';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta, CARTAO, Chip, Vazio, type Tom } from '@/componentes/ui/pecas';
import {
  ErroDaApi,
  marcarApi,
  type CamadaMarcada,
  type EstadoDaMarcacao,
  type MarcacaoDoRecorte,
  type MotivoDoRecorte,
  type NoiteDeRecortes,
  type RecorteParaMarcar,
  type RecortesDaLoja,
} from '@/lib/api';

const MAX_OBSERVACAO = 300;

/** Por que o recorte está aqui, dito embaixo dele. */
const MOTIVO: Record<MotivoDoRecorte, string> = {
  duvida: 'o Farol teve dúvida',
  cobertura: 'um pouco de cada ingrediente',
  comeco: 'o começo da peça',
};

/** A certeza pela nota do juiz — a mesma régua da conferência por passo. */
function certeza(nota: number | null): { tom: Tom; texto: string } | null {
  if (nota === null) return null;
  if (nota >= NOTA_ALTA) return { tom: 'ok', texto: 'certeza alta' };
  if (nota >= NOTA_MEDIA) return { tom: 'neutro', texto: 'certeza média' };
  return { tom: 'atencao', texto: 'certeza baixa' };
}

type Rascunho = { estado: EstadoDaMarcacao; pilha: CamadaMarcada[]; obs: string };
const vazio = (): Rascunho => ({ estado: 'pilha', pilha: [], obs: '' });
const doRecorte = (r: RecorteParaMarcar | undefined): Rascunho =>
  r?.situacao === 'marcado' && r.resposta
    ? { estado: r.resposta.estado, pilha: r.resposta.pilha.map((p) => ({ ...p })), obs: r.resposta.obs ?? '' }
    : vazio();
const pronto = (x: Rascunho) => x.estado !== 'pilha' || x.pilha.length > 0;

/** A noite depois de um recorte mudar de situação: as contas da linha dela acompanham. */
function contarDeNovo(noite: NoiteDeRecortes, de: RecorteParaMarcar['situacao'], para: RecorteParaMarcar['situacao']): NoiteDeRecortes {
  if (de === para) return noite;
  const n = { ...noite };
  const campo = { marcar: 'marcar', marcado: 'marcados', pulado: 'pulados' } as const;
  n[campo[de]] -= 1;
  n[campo[para]] += 1;
  return n;
}

export function PainelDeMarcar({
  dados,
  fuso,
  aoAtualizar,
  aoTrocarNoite,
}: {
  dados: RecortesDaLoja;
  fuso: string;
  /** O que mudou depois de marcar ou pular (a página conta o que falta na aba). */
  aoAtualizar: (novo: RecortesDaLoja) => void;
  aoTrocarNoite: (gravacaoId: string) => void;
}) {
  const id = useId();
  const avisar = useAvisar();
  const recortes = dados.recortes;
  const noite = dados.noites.find((n) => n.gravacaoId === dados.noite) ?? null;
  const primeiroSemResposta = useCallback((lista: RecorteParaMarcar[]) => Math.max(0, lista.findIndex((r) => r.situacao === 'marcar')), []);
  const [atual, setAtual] = useState(() => primeiroSemResposta(recortes));
  const [rascunho, setRascunho] = useState<Rascunho>(() => doRecorte(recortes[primeiroSemResposta(recortes)]));
  const [fim, setFim] = useState(() => recortes.length > 0 && recortes.every((r) => r.situacao !== 'marcar'));
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState('');

  // outra noite chegou: começa pelo primeiro sem resposta dela
  useEffect(() => {
    const i = primeiroSemResposta(dados.recortes);
    setAtual(i);
    setRascunho(doRecorte(dados.recortes[i]));
    setFim(dados.recortes.length > 0 && dados.recortes.every((r) => r.situacao !== 'marcar'));
    setRecado('');
    // só a troca de noite reinicia; marcar um recorte atualiza `dados` sem voltar ao começo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados.noite]);

  const r = recortes[atual];
  const contas = useMemo(() => {
    const marcados = recortes.filter((x) => x.situacao === 'marcado');
    const comNome = marcados.filter((x) => x.acertou !== null);
    return {
      falta: recortes.filter((x) => x.situacao === 'marcar').length,
      feitos: marcados.length,
      respondidos: recortes.filter((x) => x.situacao !== 'marcar').length,
      acerto: comNome.length ? `${porcento(comNome.filter((x) => x.acertou).length, comNome.length)}%` : '—',
    };
  }, [recortes]);
  const contaveis = useMemo(() => new Set(dados.nomes.flatMap((g) => g.nomes.filter((n) => n.conta).map((n) => n.nome))), [dados.nomes]);

  function abrir(i: number) {
    const j = Math.max(0, Math.min(recortes.length - 1, i));
    setAtual(j);
    setRascunho(doRecorte(recortes[j]));
    setFim(false);
  }

  /** O próximo depois do atual que espera resposta (dá a volta). Nenhum: a noite está toda respondida. */
  function avancar(lista: RecorteParaMarcar[], de: number) {
    for (let k = 1; k <= lista.length; k += 1) {
      const j = (de + k) % lista.length;
      if (lista[j]!.situacao === 'marcar') {
        setAtual(j);
        setRascunho(doRecorte(lista[j]));
        return;
      }
    }
    setFim(true);
  }

  function trocar(recorte: RecorteParaMarcar, mudou: Partial<RecorteParaMarcar>) {
    const novos = recortes.map((x) => (x.id === recorte.id ? { ...x, ...mudou } : x));
    const para = mudou.situacao ?? recorte.situacao;
    aoAtualizar({
      ...dados,
      recortes: novos,
      noites: dados.noites.map((n) => (n.gravacaoId === dados.noite ? contarDeNovo(n, recorte.situacao, para) : n)),
    });
    return novos;
  }

  const falhou = (e: unknown) => avisar(frase(e instanceof ErroDaApi ? e.message : 'não deu certo, tente de novo'));

  async function salvar() {
    if (!r || !pronto(rascunho) || salvando || !r.temImagem) return;
    const m: MarcacaoDoRecorte = { estado: rascunho.estado, pilha: rascunho.estado === 'pilha' ? rascunho.pilha : [], obs: rascunho.obs.trim() || null };
    setSalvando(true);
    try {
      const feito = await marcarApi.marcar(r.id, m);
      const novos = trocar(r, { situacao: 'marcado', resposta: m, acertou: feito.acertou, marcadoEm: new Date().toISOString() });
      setRecado(
        feito.estado === 'pilha'
          ? `Salvo: ${feito.cima} vira exemplo.`
          : feito.estado === 'nada'
            ? 'Salvo: vira exemplo do que não é comida.'
            : 'Salvo: este recorte fica fora do treino.',
      );
      avancar(novos, atual);
    } catch (e) {
      falhou(e);
    } finally {
      setSalvando(false);
    }
  }

  async function pular() {
    if (!r || salvando) return;
    setSalvando(true);
    try {
      if (r.situacao === 'marcar') {
        await marcarApi.pular(r.id);
        avancar(trocar(r, { situacao: 'pulado' }), atual);
      } else {
        // o que já tem resposta (marcado ou pulado) fica como está: só vai ao próximo
        avancar(recortes, atual);
      }
      setRecado('Pulado.');
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 409) avancar(recortes, atual);
      else falhou(e);
    } finally {
      setSalvando(false);
    }
  }

  // Enter salva e vai ao próximo — menos dentro da observação, num botão ou num seletor
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' || ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || fim) return;
      const alvo = ev.target as HTMLElement | null;
      if (alvo && alvo.closest('textarea, input, select, button, a, [contenteditable="true"], dialog')) return;
      ev.preventDefault();
      void salvar();
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  });

  const mudarPilha = (f: (p: CamadaMarcada[]) => CamadaMarcada[]) => setRascunho((x) => ({ ...x, estado: 'pilha', pilha: f(x.pilha) }));
  const mover = (i: number, d: number) =>
    mudarPilha((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const q = [...p];
      [q[i], q[j]] = [q[j]!, q[i]!];
      return q;
    });

  const nomeDaNoite = noite ? `${dataNaLoja(noite.inicio, fuso)}${noite.canal ? ` · ${noite.canal.nome}` : ''}` : null;

  if (!recortes.length) {
    return (
      <Vazio icone={Layers} titulo="Nada para marcar agora">
        Quando a loja fecha, o agente escolhe uns 100 recortes da noite: os de mais dúvida e um pouco de cada ingrediente. Eles aparecem aqui de manhã.
      </Vazio>
    );
  }

  const cert = r ? certeza(r.nota) : null;
  const naPilha = new Set(rascunho.pilha.map((p) => p.nome));
  const estadoDoPe = !pronto(rascunho)
    ? { forte: 'Nada marcado ainda.', resto: 'Toque no ingrediente de cima.' }
    : {
        forte: rascunho.estado === 'pilha' ? `${plural(rascunho.pilha.length, 'na pilha', 'na pilha')}.` : rascunho.estado === 'nada' ? 'Não é ingrediente.' : 'Não dá para ver.',
        resto: 'Salve e vá ao próximo (Enter).',
      };

  return (
    <section aria-labelledby={`${id}-titulo`} className="flex flex-col gap-4" data-painel-de-marcar>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-[64ch]">
          <h2 id={`${id}-titulo`} className="text-balance font-display text-[26px] font-black uppercase leading-[.95] md:text-[30px]">
            Ensine o Farol a reconhecer o ingrediente
          </h2>
          <p className="mt-1.5 text-[14px] text-farol-suave">
            Recortes da noite de <b className="font-semibold text-farol-tinta">{nomeDaNoite ?? '—'}</b>, escolhidos onde o Farol mais erra e um pouco de cada
            ingrediente. Marque a pilha que a câmera vê, de cima para baixo. Cada resposta vira exemplo, e o Farol aprende com a loja fechada.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-2 max-sm:w-full" aria-live="polite">
          {[
            { rotulo: 'para marcar', valor: numero(contas.falta), marca: true },
            { rotulo: 'marcados', valor: numero(contas.feitos), marca: false },
            { rotulo: 'o Farol acertou antes', valor: contas.acerto, marca: false },
          ].map((c) => (
            <div key={c.rotulo} className={`min-w-[88px] rounded-[14px] border px-3 py-2 ${c.marca ? 'border-farol-facho bg-farol-facho-leve' : 'border-farol-borda bg-farol-painel'}`}>
              <dd className="font-mono text-[22px] font-semibold leading-none text-farol-tinta" data-conta={c.rotulo}>
                {c.valor}
              </dd>
              <dt className="mt-1 text-[11.5px] leading-tight text-farol-suave">{c.rotulo}</dt>
            </div>
          ))}
        </dl>
      </div>

      <ol aria-label="Como funciona" className="grid grid-cols-1 gap-2 text-[13px] text-farol-suave sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['A loja fecha:', 'o agente escolhe uns 100 recortes da noite.'],
          ['Você marca', 'a pilha de cada um, aqui.'],
          ['Cada resposta', 'vira exemplo na biblioteca da loja.'],
          ['O agente reaprende', 'com a loja fechada; a noite seguinte já usa.'],
        ].map(([forte, resto], i) => (
          <li key={i} className="flex items-start gap-2 rounded-[12px] border border-farol-borda bg-farol-painel-2 px-3 py-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-farol-realce font-mono text-[11px] text-farol-tinta" aria-hidden>
              {i + 1}
            </span>
            <span>
              <b className="font-semibold text-farol-tinta">{forte}</b> {resto}
            </span>
          </li>
        ))}
      </ol>

      {dados.noites.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-noite`} className={ROTULO}>
            Noite
          </label>
          <select
            id={`${id}-noite`}
            value={dados.noite ?? ''}
            onChange={(e) => aoTrocarNoite(e.target.value)}
            className="min-h-10 max-w-full rounded-[10px] border border-farol-borda-forte bg-farol-painel px-3 text-[14px] text-farol-tinta"
          >
            {dados.noites.map((n) => (
              <option key={n.gravacaoId} value={n.gravacaoId}>
                {dataNaLoja(n.inicio, fuso)}
                {n.canal ? ` · ${n.canal.nome}` : ''} · {n.marcar > 0 ? `${numero(n.marcar)} para marcar` : 'toda marcada'}
              </option>
            ))}
          </select>
        </div>
      )}

      {fim ? (
        <div className={`${CARTAO} flex flex-col items-start gap-2 p-5`} data-tudo-marcado>
          <Chip tom="ok">Tudo marcado</Chip>
          <h3 className="font-display text-[24px] font-black uppercase leading-none">Obrigado: {plural(contas.feitos || recortes.length, 'exemplo novo', 'exemplos novos')}</h3>
          <p className="max-w-[60ch] text-[14px] text-farol-suave">
            Eles entram na biblioteca da loja agora. Quando a loja fechar, o agente reaprende com eles, e a noite seguinte já sai com o juiz novo. Amanhã cedo chega
            outra amostra.
          </p>
        </div>
      ) : (
        r && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className={`${CARTAO} flex flex-col gap-3 p-4`}>
              <Recorte r={r} hora={horaNaLoja(r.hora, fuso)} cert={cert?.texto ?? null} />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="font-semibold">Lanche das {horaNaLoja(r.hora, fuso)}</b>
                <span className="font-mono text-[12.5px] text-farol-suave">{r.peca ? `peça ${r.peca}` : 'peça —'}</span>
              </div>
              <p className="flex flex-wrap items-center gap-1.5 text-[14px]">
                {r.palpite ? (
                  <>
                    O Farol acha: <b className="font-semibold">{r.palpite}</b>
                    {cert && <Chip tom={cert.tom}>{cert.texto}</Chip>}
                  </>
                ) : (
                  <span className="text-farol-suave">{r.motivo === 'comeco' ? 'O começo da peça: o Farol não diz o pão.' : 'O Farol não deu nome a este recorte.'}</span>
                )}
              </p>
              <p className={AJUDA}>
                {frase(MOTIVO[r.motivo])}
                {r.situacao === 'marcado' && r.marcadoPor ? ` Marcado por ${r.marcadoPor}.` : ''}
                {r.situacao === 'pulado' ? ' Pulado antes.' : ''}
              </p>
              <div className="flex items-center justify-center gap-3">
                <Botao mini quadrado variante="secundario" aria-label="Recorte anterior" disabled={atual === 0} onClick={() => abrir(atual - 1)}>
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Botao>
                <span className="font-mono text-[13px]" data-numero>
                  {numero(atual + 1)} de {numero(recortes.length)}
                </span>
                <Botao mini quadrado variante="secundario" aria-label="Próximo recorte" disabled={atual === recortes.length - 1} onClick={() => abrir(atual + 1)}>
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Botao>
              </div>
            </div>

            <div className={`${CARTAO} flex min-w-0 flex-col gap-3 p-4`}>
              <h3 className="font-display text-[20px] font-black uppercase leading-none">A pilha que a câmera vê</h3>
              <p className={AJUDA}>
                Toque nos ingredientes na ordem: primeiro o de cima, por último o pão. O que se conta por unidade ou fatia (anel, carne, fatia de queijo, ovo) tem − e +
                para a quantidade.
              </p>
              <Pilha
                rascunho={rascunho}
                contaveis={contaveis}
                aoMudar={mudarPilha}
                aoMover={mover}
              />
              <div role="group" aria-label="Quando não é uma pilha" className="flex flex-wrap gap-2">
                {(
                  [
                    ['nada', 'Não é ingrediente (inox, papel, mão, caixa)'],
                    ['nao-da', 'Não dá para ver'],
                  ] as const
                ).map(([estado, texto]) => (
                  <Escolha
                    key={estado}
                    marcada={rascunho.estado === estado}
                    aoClicar={() => setRascunho((x) => (x.estado === estado ? { ...x, estado: 'pilha' } : { ...x, estado, pilha: [] }))}
                  >
                    {texto}
                  </Escolha>
                ))}
              </div>
              {dados.nomes.length === 0 ? (
                <Alerta tom="atencao" icone={Info} papel="status">
                  As fichas da loja não chegaram: sem elas não há nomes para a pilha.
                </Alerta>
              ) : (
                <div className="flex flex-col gap-3">
                  {dados.nomes.map((g) => (
                    <div key={g.grupo}>
                      <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[.08em] text-farol-suave">{g.grupo}</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {g.nomes.map((n) => (
                          <Escolha key={n.nome} marcada={naPilha.has(n.nome)} aoClicar={() => mudarPilha((p) => [...p, { nome: n.nome, vezes: 1 }])} dado={n.nome}>
                            {n.nome}
                          </Escolha>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-obs`} className={ROTULO}>
                  Observação (opcional)
                </label>
                <textarea
                  id={`${id}-obs`}
                  value={rascunho.obs}
                  maxLength={MAX_OBSERVACAO}
                  onChange={(e) => setRascunho((x) => ({ ...x, obs: e.target.value }))}
                  placeholder="Ex.: o corte pegou metade do pão ao lado"
                  rows={2}
                  className="w-full resize-y rounded-[10px] border border-farol-borda-forte bg-farol-painel px-3 py-2 text-[14px] text-farol-tinta placeholder:text-farol-suave"
                />
              </div>
            </div>
          </div>
        )
      )}

      <div
        className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-t-[16px] border-t border-farol-borda bg-farol-painel/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-2.5 backdrop-blur"
        data-pe-de-marcar
      >
        {/* no estreito, o recado ocupa a linha inteira e os botões descem (o protótipo, a 375 px) */}
        <div className="min-w-0 basis-full text-[13.5px] sm:flex-1 sm:basis-auto" aria-live="polite">
          {fim ? (
            <b className="font-semibold">Todos marcados. Nada mais nesta noite.</b>
          ) : (
            <>
              <b className="font-semibold">{estadoDoPe.forte}</b> {recado || estadoDoPe.resto}
            </>
          )}
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-farol-realce" aria-hidden>
            <i className="block h-full rounded-full bg-farol-facho transition-[width] duration-300" style={{ width: `${porcento(contas.respondidos, recortes.length)}%` }} />
          </div>
        </div>
        {!fim && (
          <div className="flex gap-2 max-sm:w-full">
            <Botao variante="secundario" onClick={() => void pular()} disabled={salvando || !r}>
              Pular
            </Botao>
            <Botao variante="primario" className="max-sm:flex-1" onClick={() => void salvar()} ocupado={salvando} disabled={!r || !pronto(rascunho) || !r.temImagem}>
              Salvar e próximo
            </Botao>
          </div>
        )}
      </div>
    </section>
  );
}

/** Um botão de escolha (nome da pilha, "não é ingrediente"): marcado quando está na pilha ou é o estado. */
function Escolha({ marcada, aoClicar, dado, children }: { marcada: boolean; aoClicar: () => void; dado?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      onClick={aoClicar}
      data-nome={dado}
      className={`inline-flex min-h-9 max-w-full items-center rounded-full border px-3 text-left text-[13.5px] transition-colors duration-200 max-md:min-h-10 ${
        marcada ? 'border-farol-facho bg-farol-facho-leve font-semibold text-farol-facho-tinta' : 'border-farol-borda bg-farol-painel text-farol-tinta hover:border-farol-borda-forte'
      }`}
    >
      <span className="min-w-0 break-words">{children}</span>
    </button>
  );
}

/** A pilha montada: o de cima primeiro; a quantidade do que se conta; subir, descer e tirar. */
function Pilha({
  rascunho,
  contaveis,
  aoMudar,
  aoMover,
}: {
  rascunho: Rascunho;
  contaveis: Set<string>;
  aoMudar: (f: (p: CamadaMarcada[]) => CamadaMarcada[]) => void;
  aoMover: (i: number, d: number) => void;
}) {
  if (rascunho.estado !== 'pilha') {
    return (
      <p className="rounded-[12px] border border-dashed border-farol-borda-forte px-3 py-3 text-[13.5px] text-farol-suave" aria-live="polite" data-pilha>
        {rascunho.estado === 'nada' ? 'Não é ingrediente: este recorte ensina o que NÃO é comida.' : 'Não dá para ver: este recorte fica fora do treino.'}
      </p>
    );
  }
  if (!rascunho.pilha.length) {
    return (
      <p className="rounded-[12px] border border-dashed border-farol-borda-forte px-3 py-3 text-[13.5px] text-farol-suave" aria-live="polite" data-pilha>
        Nada marcado ainda: toque no ingrediente de cima.
      </p>
    );
  }
  const total = rascunho.pilha.length;
  return (
    <ol className="flex flex-col gap-1.5" aria-label="A pilha, de cima para baixo" aria-live="polite" data-pilha>
      {rascunho.pilha.map((p, i) => (
        <li key={`${p.nome}-${i}`} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-farol-borda bg-farol-painel-2 px-2.5 py-1.5">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-farol-realce font-mono text-[12px]" aria-hidden>
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 break-words text-[14px]">
            {p.nome}
            {(i === 0 || i === total - 1) && <small className="ml-1.5 text-[11.5px] text-farol-suave">{i === 0 ? 'o de cima' : 'embaixo'}</small>}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {contaveis.has(p.nome) && (
              <>
                <Botao mini quadrado variante="fantasma" aria-label={`Uma a menos de ${p.nome}`} disabled={p.vezes <= 1} onClick={() => aoMudar((q) => q.map((x, k) => (k === i ? { ...x, vezes: Math.max(1, x.vezes - 1) } : x)))}>
                  <Minus className="h-3.5 w-3.5" aria-hidden />
                </Botao>
                <span className="min-w-[22px] text-center font-mono text-[13px]" aria-label={`${p.vezes} de ${p.nome}`}>
                  {p.vezes}
                </span>
                <Botao mini quadrado variante="fantasma" aria-label={`Uma a mais de ${p.nome}`} disabled={p.vezes >= 20} onClick={() => aoMudar((q) => q.map((x, k) => (k === i ? { ...x, vezes: Math.min(20, x.vezes + 1) } : x)))}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </Botao>
              </>
            )}
            <Botao mini quadrado variante="fantasma" aria-label={`Subir ${p.nome}`} disabled={i === 0} onClick={() => aoMover(i, -1)}>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </Botao>
            <Botao mini quadrado variante="fantasma" aria-label={`Descer ${p.nome}`} disabled={i === total - 1} onClick={() => aoMover(i, 1)}>
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </Botao>
            <Botao mini quadrado variante="perigo-leve" aria-label={`Tirar ${p.nome} da pilha`} onClick={() => aoMudar((q) => q.filter((_, k) => k !== i))}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </Botao>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** O recorte inteiro (`object-contain`), com o tracejado do que chegou — em pixels do recorte, como a API guarda. */
function Recorte({ r, hora, cert }: { r: RecorteParaMarcar; hora: string; cert: string | null }) {
  const [tamanho, setTamanho] = useState<[number, number] | null>(r.largura && r.altura ? [r.largura, r.altura] : null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    setTamanho(r.largura && r.altura ? [r.largura, r.altura] : null);
    setFalhou(false);
  }, [r.id, r.largura, r.altura]);
  const descricao = `Recorte das ${hora}${r.peca ? `, peça ${r.peca}` : ''}.${r.palpite ? ` O Farol acha: ${r.palpite}${cert ? `, ${cert}` : ''}.` : ''}`;
  if (!r.temImagem || falhou) {
    return (
      <div className="grid aspect-square w-full max-w-[420px] place-items-center self-center rounded-[14px] border border-dashed border-farol-borda-forte px-4 text-center text-[13px] text-farol-suave" role="img" aria-label={descricao}>
        <span className="flex flex-col items-center gap-2">
          <ImageOff className="h-6 w-6" aria-hidden />
          {r.temImagem ? 'A imagem não abriu. Tente de novo daqui a pouco.' : 'A imagem deste recorte já saiu (30 dias depois da marcação).'}
        </span>
      </div>
    );
  }
  return (
    <div className="relative aspect-square w-full max-w-[420px] self-center overflow-hidden rounded-[14px] bg-farol-palco" role="img" aria-label={descricao} data-recorte>
      {/* eslint-disable-next-line @next/next/no-img-element -- a imagem vem da API com sessão; o otimizador do Next não alcança */}
      <img
        key={r.id}
        src={marcarApi.urlDaImagem(r.id)}
        alt=""
        className="h-full w-full object-contain"
        onLoad={(ev) => setTamanho([ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight])}
        onError={() => setFalhou(true)}
      />
      {tamanho && r.contorno?.length ? (
        <svg viewBox={`0 0 ${tamanho[0]} ${tamanho[1]}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {r.contorno.map((pedaco, k) => (
            <polygon
              key={k}
              points={pedaco.map(([px, py]) => `${px},${py}`).join(' ')}
              className="fill-farol-facho/10 stroke-farol-facho"
              strokeWidth={2.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}
