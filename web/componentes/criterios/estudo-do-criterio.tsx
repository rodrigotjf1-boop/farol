'use client';

// =====================================================================
// O estudo do critério — quando vale a pena olhar
// =====================================================================
// A ficha de seis partes (contexto, gatilho, janela, ação, desfecho, fora
// de contexto). Todas têm texto; duas têm também a forma que a loja confere
// SOZINHA, de graça: o contexto (todas as condições têm de valer) e o
// gatilho (basta um). Cada condição lê um sinal num lugar do canal.
//
// O que a tela afirma, e de onde tira:
//   - só o estudo CONFIRMADO vale — e só ele desce para a loja. Rascunho
//     fica guardado e não muda nada;
//   - sem estudo confirmado, o critério segue como era conferido antes
//     (`comoEHoje`);
//   - presença e contagem são conferidas na loja em toda olhada: o estudo
//     delas guarda os textos, e não leva contexto nem gatilho.
// =====================================================================

import { Check, Plus, RotateCcw, Trash2, X } from 'lucide-react';

import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta } from '@/componentes/ui/pecas';
import type { Condicao, OndeDaCondicao, ParteDoEstudo } from '@/lib/api';

import {
  chaveDoLugar,
  fonteDoSinal,
  fraseDaCondicao,
  GATILHOS_SEM_LUGAR,
  MAX_POR_LISTA,
  MAX_TEXTO_DA_PARTE,
  MINUTOS,
  MODELOS_DE_ESTUDO,
  NOME_DA_FONTE,
  PARTES,
  SINAIS_DE_CONTEXTO,
  SINAIS_DE_GATILHO,
  type Lugar,
} from './sinais';

/** O estudo como está na gaveta, antes de salvar. */
export type RascunhoDoEstudo = {
  /** Há ficha (mesmo em branco). Falso = sem estudo: ao salvar, o que houver guardado é tirado. */
  existe: boolean;
  partes: Partial<Record<ParteDoEstudo, string>>;
  contexto: Condicao[];
  gatilho: Condicao[];
  confirmado: boolean;
};

export const SEM_ESTUDO: RascunhoDoEstudo = { existe: false, partes: {}, contexto: [], gatilho: [], confirmado: false };

/** O que vai para o servidor: os textos sem espaço sobrando e as condições sem o que não é delas. */
export function estudoParaSalvar(r: RascunhoDoEstudo, usaContextoEGatilho: boolean) {
  const partes: Partial<Record<ParteDoEstudo, string>> = {};
  for (const p of PARTES) {
    const texto = (r.partes[p.valor] ?? '').trim();
    if (texto) partes[p.valor] = texto;
  }
  const limpa = (c: Condicao): Condicao =>
    c.sinal === 'a_cada'
      ? { sinal: c.sinal, minutos: c.minutos }
      : GATILHOS_SEM_LUGAR.includes(c.sinal)
        ? { sinal: c.sinal }
        : c.onde === 'quadro'
          ? { sinal: c.sinal, onde: 'quadro', zonaId: c.zonaId }
          : { sinal: c.sinal, onde: c.onde ?? 'aqui' };
  return {
    partes,
    contexto: usaContextoEGatilho ? r.contexto.map(limpa) : [],
    gatilho: usaContextoEGatilho ? r.gatilho.map(limpa) : [],
    confirmado: r.confirmado,
  };
}

/** Dois rascunhos dizem a mesma coisa? (É por aqui que a gaveta sabe se há estudo a salvar.) */
export const mesmoEstudo = (a: RascunhoDoEstudo, b: RascunhoDoEstudo, usa: boolean): boolean =>
  a.existe === b.existe && (!a.existe || JSON.stringify(estudoParaSalvar(a, usa)) === JSON.stringify(estudoParaSalvar(b, usa)));

type Props = {
  prefixo: string;
  valor: RascunhoDoEstudo;
  aoMudar: (novo: RascunhoDoEstudo) => void;
  /** Os lugares que uma condição pode olhar: o do próprio critério, a imagem completa e os quadros dos canais dele. */
  lugares: ReadonlyArray<Lugar>;
  /** Presença e contagem não levam contexto nem gatilho. */
  usaContextoEGatilho: boolean;
  configura: boolean;
  /** Como o critério é conferido sem estudo confirmado: "em toda olhada", "só com pessoa na área"… */
  comoEHoje: string;
  /** O computador da loja já sabe usar o estudo? `null` = ele ainda não disse. */
  agenteSabe: boolean | null;
  /** O que falta para as condições poderem ser salvas — dito ao lado do botão de confirmar. */
  problema: string | null;
};

const SELETOR = 'entrada min-w-0 py-1.5 text-[13px]';

function Condicoes({
  prefixo,
  qual,
  lista,
  lugares,
  configura,
  aoMudar,
}: {
  prefixo: string;
  qual: 'contexto' | 'gatilho';
  lista: Condicao[];
  lugares: ReadonlyArray<Lugar>;
  configura: boolean;
  aoMudar: (nova: Condicao[]) => void;
}) {
  const sinais = qual === 'contexto' ? SINAIS_DE_CONTEXTO : SINAIS_DE_GATILHO;
  const nome = qual === 'contexto' ? 'condição' : 'gatilho';

  function trocar(i: number, c: Condicao) {
    aoMudar(lista.map((o, j) => (j === i ? c : o)));
  }
  function mudarSinal(i: number, sinal: string) {
    const atual = lista[i]!;
    if (sinal === 'a_cada') return trocar(i, { sinal, minutos: atual.minutos ?? 10 });
    if (GATILHOS_SEM_LUGAR.includes(sinal)) return trocar(i, { sinal });
    trocar(i, { sinal, onde: atual.onde ?? 'aqui', ...(atual.onde === 'quadro' ? { zonaId: atual.zonaId } : {}) });
  }
  function mudarLugar(i: number, chave: string) {
    const lugar = lugares.find((l) => chaveDoLugar(l) === chave);
    if (!lugar) return;
    const { sinal } = lista[i]!;
    trocar(i, lugar.onde === 'quadro' ? { sinal, onde: 'quadro', zonaId: lugar.zonaId } : { sinal, onde: lugar.onde as OndeDaCondicao });
  }

  return (
    <div className="flex flex-col gap-2" data-condicoes={qual}>
      {lista.length === 0 && (
        <p className={AJUDA}>
          {qual === 'contexto'
            ? 'Sem condição: o contexto vale em toda olhada em que o critério está no horário.'
            : 'Sem gatilho escolhido: toda olhada em que o contexto vale abre a análise.'}
        </p>
      )}
      {lista.map((c, i) => {
        const semLugar = GATILHOS_SEM_LUGAR.includes(c.sinal);
        const fonte = fonteDoSinal(c.sinal);
        const frase = fraseDaCondicao(c, lugares);
        // O quadro citado pode ter saído do canal: aparece como opção, dito, em vez de a lista trocar o valor calada.
        const sumiu = !semLugar && !lugares.some((l) => chaveDoLugar(l) === chaveDoLugar(c));
        return (
          // A posição é a identidade da linha: duas condições podem ter o mesmo texto enquanto são editadas.
          <div key={i} className="flex flex-col gap-1 rounded-[10px] border border-farol-borda bg-farol-painel-2 p-2" data-condicao>
            {/* O sinal e o lugar, um embaixo do outro: lado a lado, na largura da gaveta, o seletor cortava o
                texto ("deixou de estar como na foto pa…"). O botão de tirar fica sempre no canto. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5">
              <div className="flex min-w-0 flex-col gap-1.5">
                <select
                  className={SELETOR}
                  aria-label={`${qual === 'contexto' ? 'Condição' : 'Gatilho'} ${i + 1}: o sinal`}
                  value={c.sinal}
                  disabled={!configura}
                  onChange={(e) => mudarSinal(i, e.target.value)}
                >
                  {sinais.map((s) => (
                    <option key={s.valor} value={s.valor}>
                      {s.rotulo}
                    </option>
                  ))}
                  {/* Sinal que a tela ainda não conhece (a nuvem ganhou um novo): aparece como veio. */}
                  {!sinais.some((s) => s.valor === c.sinal) && <option value={c.sinal}>{c.sinal}</option>}
                </select>
                {c.sinal === 'a_cada' ? (
                  <label className="flex items-center gap-1.5 text-[13px] text-farol-suave">
                    a cada
                    <input
                      type="number"
                      className={`${SELETOR} w-[76px] font-mono`}
                      aria-label={`Gatilho ${i + 1}: de quantos em quantos minutos`}
                      min={MINUTOS.minimo}
                      max={MINUTOS.maximo}
                      step={1}
                      value={c.minutos ?? ''}
                      disabled={!configura}
                      onChange={(e) => trocar(i, { sinal: 'a_cada', minutos: e.target.value === '' ? undefined : Number(e.target.value) })}
                    />
                    min
                  </label>
                ) : semLugar ? null : (
                  <select
                    className={SELETOR}
                    aria-label={`${qual === 'contexto' ? 'Condição' : 'Gatilho'} ${i + 1}: onde`}
                    value={chaveDoLugar(c)}
                    disabled={!configura}
                    onChange={(e) => mudarLugar(i, e.target.value)}
                  >
                    {lugares.map((l) => (
                      <option key={chaveDoLugar(l)} value={chaveDoLugar(l)}>
                        {l.rotulo}
                      </option>
                    ))}
                    {sumiu && <option value={chaveDoLugar(c)}>num quadro que não existe mais</option>}
                  </select>
                )}
              </div>
              {configura && (
                <Botao variante="fantasma" mini quadrado aria-label={`Tirar: ${frase}`} onClick={() => aoMudar(lista.filter((_, j) => j !== i))}>
                  <X className="h-[15px] w-[15px]" aria-hidden />
                </Botao>
              )}
            </div>
            {fonte && (
              <p className="text-[11.5px] leading-snug text-farol-suave">
                A loja confere por: {NOME_DA_FONTE[fonte]}.
                {sumiu && ' Este quadro não existe mais: escolha outro lugar, ou tire a condição.'}
              </p>
            )}
          </div>
        );
      })}
      {configura && (
        <div>
          <Botao
            mini
            variante="fantasma"
            disabled={lista.length >= MAX_POR_LISTA}
            title={lista.length >= MAX_POR_LISTA ? `No máximo ${MAX_POR_LISTA}` : undefined}
            onClick={() =>
              aoMudar([...lista, qual === 'contexto' ? { sinal: 'pessoa', onde: 'aqui' } : { sinal: 'parou', onde: 'aqui' }])
            }
            data-mais={qual}
          >
            <Plus className="h-[15px] w-[15px]" aria-hidden />
            {nome}
            <span className="sr-only"> {qual === 'contexto' ? 'de contexto' : 'que abre a análise'}</span>
          </Botao>
          <span className="sr-only" id={`${prefixo}-${qual}-conta`}>
            {lista.length} de {MAX_POR_LISTA}
          </span>
        </div>
      )}
    </div>
  );
}

export function EstudoDoCriterio({ prefixo, valor, aoMudar, lugares, usaContextoEGatilho, configura, comoEHoje, agenteSabe, problema }: Props) {
  // ───────────── sem estudo ─────────────
  if (!valor.existe) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-farol-borda-forte p-3.5" data-estudo="sem">
        <div>
          <b className="font-semibold">Ainda sem estudo</b>
          <p className="mt-0.5 text-[13px] text-farol-suave">
            Sem ele, este critério é conferido {comoEHoje}. O estudo diz quando vale a pena olhar — o que precisa estar
            acontecendo e o que abre a análise. A loja confere isso sozinha, sem custo, antes de julgar.
          </p>
        </div>
        {configura && (
          <>
            {usaContextoEGatilho && (
              <div className="flex flex-col gap-1.5">
                <span className={ROTULO}>Começar por um modelo</span>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
                  {MODELOS_DE_ESTUDO.map((m) => (
                    <button
                      key={m.valor}
                      type="button"
                      data-modelo={m.valor}
                      onClick={() => aoMudar({ existe: true, partes: { ...m.partes }, contexto: m.contexto.map((c) => ({ ...c })), gatilho: m.gatilho.map((g) => ({ ...g })), confirmado: false })}
                      className="flex flex-col gap-1 rounded-[10px] border border-farol-borda-forte bg-farol-painel p-2.5 text-left transition-colors hover:border-farol-suave"
                    >
                      <b className="font-semibold">{m.titulo}</b>
                      <small className="text-[11.5px] leading-snug text-farol-suave">{m.ajuda}</small>
                    </button>
                  ))}
                </div>
                <p className={AJUDA}>
                  Em câmera que olha de cima o detector vê mão e braço, não gente: ali o sinal que serve é o movimento.
                </p>
              </div>
            )}
            <div>
              <Botao mini onClick={() => aoMudar({ ...SEM_ESTUDO, existe: true })} data-estudo-do-zero>
                <Plus className="h-[15px] w-[15px]" aria-hidden />
                Escrever do zero
              </Botao>
            </div>
          </>
        )}
      </div>
    );
  }

  // ───────────── a ficha ─────────────
  const mudar = (parte: Partial<RascunhoDoEstudo>) => aoMudar({ ...valor, ...parte });

  return (
    <div className="flex flex-col gap-3" data-estudo={valor.confirmado ? 'confirmado' : 'rascunho'}>
      {!usaContextoEGatilho ? (
        <Alerta>
          Presença e contagem são conferidas na loja em toda olhada: aqui o estudo guarda só os textos. Contexto e
          gatilho não se aplicam.
        </Alerta>
      ) : valor.confirmado ? (
        <Alerta tom="ok" icone={Check} papel="status">
          <b className="font-semibold">Estudo confirmado.</b> É ele que diz quando este critério é conferido.
          {configura && (
            <button type="button" className="elo ml-1.5 text-[13px]" onClick={() => mudar({ confirmado: false })}>
              Voltar a rascunho
            </button>
          )}
        </Alerta>
      ) : (
        <Alerta tom="atencao" papel="status">
          <b className="font-semibold">Rascunho.</b> Ainda não vale: enquanto não for confirmado, o critério segue sendo
          conferido {comoEHoje}.
        </Alerta>
      )}

      {usaContextoEGatilho && agenteSabe === false && (
        <Alerta tom="atencao">
          O computador da loja ainda não sabe usar o estudo. Ele fica guardado e passa a valer quando o programa da loja
          for atualizado.
        </Alerta>
      )}

      <div className="flex flex-col">
        {PARTES.map((p) => {
          const id = `${prefixo}-parte-${p.valor}`;
          const comCondicoes = usaContextoEGatilho && (p.valor === 'contexto' || p.valor === 'gatilho');
          return (
            <div
              key={p.valor}
              className="grid grid-cols-1 gap-x-3.5 gap-y-1.5 border-t border-farol-borda py-3 first:border-t-0 first:pt-0 sm:grid-cols-[132px_minmax(0,1fr)]"
              data-parte={p.valor}
            >
              <label htmlFor={id} className="flex flex-col">
                <span className={ROTULO}>{p.titulo}</span>
                <small className="text-[11.5px] leading-snug text-farol-suave">{p.pergunta}</small>
              </label>
              <div className="flex min-w-0 flex-col gap-2">
                <textarea
                  id={id}
                  rows={2}
                  maxLength={MAX_TEXTO_DA_PARTE}
                  className="entrada min-h-[56px] resize-y text-[13.5px] leading-normal"
                  placeholder={p.exemplo}
                  value={valor.partes[p.valor] ?? ''}
                  disabled={!configura}
                  onChange={(e) => mudar({ partes: { ...valor.partes, [p.valor]: e.target.value } })}
                />
                {comCondicoes && (
                  <Condicoes
                    prefixo={prefixo}
                    qual={p.valor as 'contexto' | 'gatilho'}
                    lista={p.valor === 'contexto' ? valor.contexto : valor.gatilho}
                    lugares={lugares}
                    configura={configura}
                    aoMudar={(nova) => mudar(p.valor === 'contexto' ? { contexto: nova } : { gatilho: nova })}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {configura && (
        <div className="flex flex-wrap items-center gap-2.5">
          {usaContextoEGatilho && !valor.confirmado && (
            <Botao mini variante="primario" disabled={problema !== null} onClick={() => mudar({ confirmado: true })} data-confirmar-estudo>
              <Check className="h-[15px] w-[15px]" aria-hidden />
              Confirmar o estudo
            </Botao>
          )}
          <Botao mini variante="perigo-leve" onClick={() => aoMudar(SEM_ESTUDO)} data-tirar-estudo>
            <Trash2 className="h-[15px] w-[15px]" aria-hidden />
            Tirar o estudo
          </Botao>
          {problema ? (
            <p className="flex-[1_1_200px] text-[12.5px] text-farol-critico" role="alert">
              {problema}
            </p>
          ) : (
            <p className="flex-[1_1_200px] text-[12.5px] text-farol-suave">
              <RotateCcw className="mr-1 inline h-[13px] w-[13px] align-[-2px]" aria-hidden />
              Nada disto vale antes de você salvar o critério.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
