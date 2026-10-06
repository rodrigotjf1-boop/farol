'use client';

// =====================================================================
// O explorador de critérios
// =====================================================================
// Setor é pasta, canal é o que está dentro, critério é o arquivo. Navega-se
// como num explorador: abre o setor, abre o canal, vê os critérios que
// valem ali.
//
// O mesmo critério aparece debaixo de cada canal em que vale — é o MESMO
// cadastro, e a linha diz em quantos canais ele está. Editar em qualquer
// um edita em todos; "tirar do canal" tira só daquele.
// =====================================================================

import { useEffect, useRef, useState } from 'react';

import type { Ponto, Regra, Setor } from '@/lib/api';

import { criteriosDoCanal, emOrdem, rotuloDoCanal } from './canais';
import { Arquivo, Camera, Pasta, Seta } from './icones';
import { nomeDaPrioridade, nomeDaSeveridade, nomeDoTipo } from './opcoes';

type Props = {
  setores: Setor[];
  regras: Regra[];
  configura: boolean;
  aoAdicionar: (ponto: Ponto) => void;
  aoEditar: (regra: Regra) => void;
  aoTirar: (regra: Regra, ponto: Ponto, zonaId: string) => void;
  aoAlternar: (regra: Regra) => void;
};

const botaoDeLinha =
  'rounded-lg border border-farol-borda px-2.5 py-1 text-xs transition hover:border-farol-facho/50';

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Em quantos CANAIS (não áreas) o critério vale. */
function canaisDe(regra: Regra): number {
  return new Set(regra.alvos.map((a) => a.ponto_id)).size;
}

function Etiquetas({ regra }: { regra: Regra }) {
  const grave = regra.severidade === 'emergencia' || regra.severidade === 'critico';
  return (
    <>
      <span className="rounded bg-farol-borda/60 px-1.5 py-0.5 text-xs text-farol-suave">
        {nomeDoTipo(regra.tipo)}
      </span>
      <span
        className={`rounded px-1.5 py-0.5 text-xs ${
          grave ? 'bg-farol-critico/15 text-farol-critico' : 'bg-farol-borda/60 text-farol-suave'
        }`}
      >
        {nomeDaSeveridade(regra.severidade)}
      </span>
    </>
  );
}

function BotaoLigar({
  regra,
  configura,
  aoAlternar,
}: {
  regra: Regra;
  configura: boolean;
  aoAlternar: (regra: Regra) => void;
}) {
  const n = canaisDe(regra);
  if (!configura) {
    return (
      <span className={`text-xs ${regra.ativa ? 'text-farol-ok' : 'text-farol-suave'}`}>
        {regra.ativa ? 'Ligado' : 'Desligado'}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => aoAlternar(regra)}
      aria-pressed={regra.ativa}
      title={
        n > 1
          ? `Liga ou desliga nos ${n} canais em que este critério vale`
          : 'Liga ou desliga este critério'
      }
      className={`rounded-lg px-2.5 py-1 text-xs transition ${
        regra.ativa
          ? 'bg-farol-ok/15 text-farol-ok'
          : 'border border-farol-borda text-farol-suave hover:border-farol-facho/50'
      }`}
    >
      {regra.ativa ? 'Ligado' : 'Desligado'}
    </button>
  );
}

function LinhaDoCriterio({
  regra,
  ponto,
  zonaId,
  zonaNome,
  configura,
  aoEditar,
  aoTirar,
  aoAlternar,
}: {
  regra: Regra;
  ponto: Ponto;
  zonaId: string;
  zonaNome: string;
  configura: boolean;
  aoEditar: Props['aoEditar'];
  aoTirar: Props['aoTirar'];
  aoAlternar: Props['aoAlternar'];
}) {
  const n = canaisDe(regra);
  return (
    <li className="rounded-lg border border-farol-borda/70 bg-farol-fundo/60 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Arquivo className="text-farol-suave" />
        <span className="min-w-0 break-words text-sm font-medium">{regra.nome}</span>
        <Etiquetas regra={regra} />
        {n > 1 && (
          <span
            className="rounded bg-farol-facho/15 px-1.5 py-0.5 text-xs text-farol-facho"
            title="É um cadastro só: editar aqui muda em todos os canais"
          >
            vale em {n} canais
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <BotaoLigar regra={regra} configura={configura} aoAlternar={aoAlternar} />
          {configura && (
            <>
              <button type="button" onClick={() => aoEditar(regra)} className={botaoDeLinha}>
                Editar<span className="sr-only"> o critério {regra.nome}</span>
              </button>
              <button
                type="button"
                onClick={() => aoTirar(regra, ponto, zonaId)}
                className={`${botaoDeLinha} text-farol-critico hover:border-farol-critico/60`}
              >
                Tirar do canal
                <span className="sr-only">
                  {' '}
                  {rotuloDoCanal(ponto)} o critério {regra.nome}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      <p className="mt-2 line-clamp-2 max-w-prose text-sm text-farol-suave">{regra.criterio}</p>
      <p className="mt-1 text-xs text-farol-suave">
        {ponto.zonas.length > 1 && <>área: {zonaNome} · </>}
        prioridade {nomeDaPrioridade(regra.prioridade)} · confiança mínima{' '}
        {Number(regra.confianca_minima).toFixed(2)} · silêncio{' '}
        {regra.cooldown_min} min · versão {regra.criterio_versao}
      </p>
    </li>
  );
}

function Canal({
  ponto,
  regras,
  configura,
  aoAdicionar,
  aoEditar,
  aoTirar,
  aoAlternar,
}: { ponto: Ponto } & Omit<Props, 'setores'>) {
  const criterios = criteriosDoCanal(regras, ponto.id);
  const [aberto, setAberto] = useState(criterios.length > 0);

  // Canal que GANHA um critério abre sozinho. Sem isto, quem clica em
  // "+ critério" num canal vazio salva e não vê nada mudar: o canal
  // continua recolhido, com o critério novo escondido dentro. Só abre —
  // nunca fecha por conta própria o que a pessoa deixou aberto.
  const antes = useRef(criterios.length);
  useEffect(() => {
    if (criterios.length > antes.current) setAberto(true);
    antes.current = criterios.length;
  }, [criterios.length]);

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 py-1.5">
        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          className="flex min-w-0 items-center gap-2 rounded text-left hover:text-farol-facho"
        >
          <Seta aberta={aberto} />
          <Camera className="text-farol-suave" />
          <span className="min-w-0 break-words text-sm">{rotuloDoCanal(ponto)}</span>
        </button>
        {!ponto.ativo && (
          <span className="rounded bg-farol-atencao/15 px-1.5 py-0.5 text-xs text-farol-atencao">
            desativado — não é verificado
          </span>
        )}
        <span className="text-xs text-farol-suave">
          {criterios.length === 0 ? 'sem critério' : plural(criterios.length, 'critério', 'critérios')}
        </span>

        {configura && ponto.ativo && ponto.zonas.length > 0 && (
          <button
            type="button"
            onClick={() => aoAdicionar(ponto)}
            className="ml-auto rounded-lg border border-dashed border-farol-borda px-2.5 py-1 text-xs text-farol-facho transition hover:border-farol-facho/60"
          >
            ＋ critério<span className="sr-only"> em {rotuloDoCanal(ponto)}</span>
          </button>
        )}
      </div>

      {aberto && (
        <ul className="mb-2 ml-2.5 space-y-2 border-l border-farol-borda pl-3 sm:ml-4 sm:pl-4">
          {criterios.length === 0 && (
            <li className="py-1 text-sm text-farol-suave">
              Nenhum critério neste canal. Nada é verificado aqui.
            </li>
          )}
          {criterios.map((c) => (
            <LinhaDoCriterio
              key={`${c.regra.id}-${c.zonaId}`}
              regra={c.regra}
              ponto={ponto}
              zonaId={c.zonaId}
              zonaNome={c.zonaNome}
              configura={configura}
              aoEditar={aoEditar}
              aoTirar={aoTirar}
              aoAlternar={aoAlternar}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SetorDaLoja({ setor, ...resto }: { setor: Setor } & Omit<Props, 'setores'>) {
  const [aberto, setAberto] = useState(true);
  const canais = emOrdem(setor.pontos);
  const comCriterio = new Set<string>();
  for (const p of canais) {
    for (const c of criteriosDoCanal(resto.regras, p.id)) comCriterio.add(c.regra.id);
  }

  return (
    <li className="rounded-xl border border-farol-borda bg-farol-painel p-3 sm:p-4">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded text-left hover:text-farol-facho"
      >
        <Seta aberta={aberto} />
        <Pasta className="text-farol-facho" />
        <span className="min-w-0 break-words font-medium">{setor.nome}</span>
        <span className="ml-auto text-xs text-farol-suave">
          {plural(canais.length, 'canal', 'canais')} ·{' '}
          {plural(comCriterio.size, 'critério', 'critérios')}
        </span>
      </button>

      {aberto && (
        <ul className="ml-2.5 mt-1 border-l border-farol-borda pl-3 sm:pl-4">
          {canais.length === 0 && (
            <li className="py-1 text-sm text-farol-suave">Este setor ainda não tem câmera.</li>
          )}
          {canais.map((p) => (
            <Canal key={p.id} ponto={p} {...resto} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Explorador({ setores, regras, ...resto }: Props) {
  // Critério que foi tirado do último canal. Não é verificado em lugar
  // nenhum, mas continua existindo — aparece aqui para poder voltar.
  const semCanal = regras.filter((r) => r.alvos.length === 0);

  return (
    <div className="mt-6 space-y-3">
      <ul className="space-y-3">
        {setores.map((s) => (
          <SetorDaLoja key={s.id} setor={s} regras={regras} {...resto} />
        ))}
      </ul>

      {semCanal.length > 0 && (
        <section
          aria-label="Critérios sem canal"
          className="rounded-xl border border-dashed border-farol-borda p-3 sm:p-4"
        >
          <h2 className="text-sm font-medium">
            Sem canal <span className="text-farol-suave">({semCanal.length})</span>
          </h2>
          <p className="mt-1 max-w-prose text-xs text-farol-suave">
            Critérios que não valem em canal nenhum, e por isso não são verificados. Ficam
            guardados com o histórico; edite para marcar canais de novo.
          </p>
          <ul className="mt-3 space-y-2">
            {semCanal.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-farol-borda/70 p-3"
              >
                <Arquivo className="text-farol-suave" />
                <span className="min-w-0 break-words text-sm font-medium">{r.nome}</span>
                <Etiquetas regra={r} />
                {resto.configura && (
                  <button
                    type="button"
                    onClick={() => resto.aoEditar(r)}
                    className={`ml-auto ${botaoDeLinha}`}
                  >
                    Marcar canais<span className="sr-only"> para o critério {r.nome}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
