'use client';

// =====================================================================
// O explorador de critérios
// =====================================================================
// Setor é pasta, canal é o que está dentro, critério é o arquivo. Navega-se
// como num explorador: abre o setor, vê os canais e os critérios que valem
// em cada um.
//
// O mesmo critério aparece debaixo de cada canal em que vale — é o MESMO
// cadastro, e a linha diz em quantos canais ele está. Editar em qualquer
// um edita em todos; "tirar deste canal" tira só daquele.
// =====================================================================

import { ChevronRight, CircleMinus, Ellipsis, Folder, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { plural } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { CARTAO, Chip, Liga, Titulo } from '@/componentes/ui/pecas';
import { DivisorDeMenu, ITEM_DE_MENU, Menu } from '@/componentes/ui/sobreposto';
import type { Ponto, Regra, Setor } from '@/lib/api';

import { criteriosDoCanal, emOrdem, rotuloDoCanal } from './canais';
import {
  iconeDoTipo,
  nomeDaPrioridade,
  nomeDaSeveridade,
  nomeDoTipo,
  resumoDaProcura,
  TIPOS_DO_DETECTOR,
} from './opcoes';

export type Filtro = 'todos' | 'ligados' | 'desligados';

type Acoes = {
  configura: boolean;
  aoAdicionar: (ponto: Ponto) => void;
  aoEditar: (regra: Regra) => void;
  aoTirar: (regra: Regra, ponto: Ponto, zonaId: string) => void;
  aoExcluir: (regra: Regra) => void;
  aoAlternar: (regra: Regra) => void;
};

type Props = Acoes & { setores: Setor[]; regras: Regra[]; filtro: Filtro };

/** Em quantos CANAIS (não áreas) o critério vale. */
function canaisDe(regra: Regra): number {
  return new Set(regra.alvos.map((a) => a.ponto_id)).size;
}

const passa = (regra: Regra, filtro: Filtro): boolean =>
  filtro === 'todos' || (filtro === 'ligados' ? regra.ativa : !regra.ativa);

function Etiquetas({ regra }: { regra: Regra }) {
  const grave = regra.severidade === 'emergencia' || regra.severidade === 'critico';
  const peloDetector = TIPOS_DO_DETECTOR.includes(regra.tipo);
  const procura = resumoDaProcura(regra.parametros);
  const n = canaisDe(regra);

  return (
    <>
      {peloDetector && procura && (
        <Chip tom="ok" title="Julgado dentro da loja pelo detector, sem internet">
          {procura}
        </Chip>
      )}
      {/* Presença ou contagem sem dizer o que procurar: está cadastrado e
          NÃO é verificado. Tem que aparecer na lista, não só ao abrir. */}
      {peloDetector && !procura && (
        <Chip tom="atencao" icone={TriangleAlert}>
          falta dizer o que procurar
        </Chip>
      )}
      <Chip>{nomeDoTipo(regra.tipo)}</Chip>
      <Chip tom={grave ? 'critico' : 'neutro'}>{nomeDaSeveridade(regra.severidade)}</Chip>
      {n > 1 && (
        <Chip tom="vazado" title="É um cadastro só: editar aqui muda em todos os canais">
          vale em {n} canais
        </Chip>
      )}
    </>
  );
}

function Interruptor({ regra, configura, aoAlternar }: { regra: Regra; configura: boolean; aoAlternar: Acoes['aoAlternar'] }) {
  const n = canaisDe(regra);
  if (!configura) {
    return (
      <span className={`text-[12.5px] font-medium ${regra.ativa ? 'text-farol-ok' : 'text-farol-suave'}`}>
        {regra.ativa ? 'Ligado' : 'Desligado'}
      </span>
    );
  }
  return (
    <Liga
      ligado={regra.ativa}
      aoMudar={() => aoAlternar(regra)}
      descricao={`Critério ${regra.nome}`}
      rotulo={regra.ativa ? 'Ligado' : 'Desligado'}
      // Ligar ou desligar vale para o critério inteiro, em todos os canais.
      title={n > 1 ? `Liga ou desliga nos ${n} canais em que este critério vale` : undefined}
    />
  );
}

function CartaoDoCriterio({
  regra,
  ponto,
  zonaId,
  zonaNome,
  configura,
  aoEditar,
  aoTirar,
  aoExcluir,
  aoAlternar,
}: { regra: Regra; ponto: Ponto; zonaId: string; zonaNome: string } & Omit<Acoes, 'aoAdicionar'>) {
  const Icone = iconeDoTipo(regra.tipo);

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-farol-borda bg-farol-painel-2 p-3 transition-colors hover:border-farol-borda-forte md:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span
        className={`grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-farol-borda bg-farol-painel md:row-span-2 ${
          regra.ativa ? 'text-farol-marca' : 'text-farol-suave'
        }`}
      >
        <Icone className="h-[18px] w-[18px]" aria-hidden />
      </span>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <b className="min-w-0 break-words font-semibold">{regra.nome}</b>
        <Etiquetas regra={regra} />
      </div>

      <div className="col-span-2 flex items-center justify-between gap-1.5 max-md:order-last max-md:border-t max-md:border-farol-borda max-md:pt-2 md:col-span-1 md:justify-end">
        <Interruptor regra={regra} configura={configura} aoAlternar={aoAlternar} />
        {configura && (
          <Menu
            alinhar="fim"
            gatilho={(p) => (
              <Botao variante="fantasma" mini quadrado aria-label={`Ações do critério ${regra.nome}`} {...p}>
                <Ellipsis className="h-[18px] w-[18px]" aria-hidden />
              </Botao>
            )}
          >
            {(fechar) => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={ITEM_DE_MENU}
                  onClick={() => {
                    fechar();
                    aoEditar(regra);
                  }}
                >
                  <Pencil className="h-[18px] w-[18px]" aria-hidden />
                  Editar
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={ITEM_DE_MENU}
                  onClick={() => {
                    fechar();
                    aoTirar(regra, ponto, zonaId);
                  }}
                >
                  <CircleMinus className="h-[18px] w-[18px]" aria-hidden />
                  Tirar deste canal
                </button>
                <DivisorDeMenu />
                <button
                  type="button"
                  role="menuitem"
                  className={`${ITEM_DE_MENU} text-farol-critico`}
                  onClick={() => {
                    fechar();
                    aoExcluir(regra);
                  }}
                >
                  <Trash2 className="h-[18px] w-[18px]" aria-hidden />
                  Excluir de todos os canais
                </button>
              </>
            )}
          </Menu>
        )}
      </div>

      <p className="col-span-2 line-clamp-2 text-[13px] text-farol-suave md:col-start-2">{regra.criterio}</p>
      <p className="col-span-2 text-xs text-farol-suave md:col-start-2">
        {ponto.zonas.length > 1 && <>área: {zonaNome} · </>}
        prioridade {nomeDaPrioridade(regra.prioridade)} · confiança mínima{' '}
        {Number(regra.confianca_minima).toFixed(2).replace('.', ',')} · silêncio de {regra.cooldown_min} min · versão{' '}
        {regra.criterio_versao}
      </p>
    </li>
  );
}

function Canal({ ponto, regras, filtro, ...acoes }: { ponto: Ponto; regras: Regra[]; filtro: Filtro } & Acoes) {
  const todos = criteriosDoCanal(regras, ponto.id);
  const visiveis = todos.filter((c) => passa(c.regra, filtro));
  const { configura, aoAdicionar } = acoes;

  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-[9px] gap-y-1.5 text-[13px] text-farol-suave">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-farol-realce font-mono text-[11.5px] font-semibold text-farol-marca"
          title={ponto.canal != null ? `Canal ${ponto.canal} do gravador` : 'Câmera IP'}
        >
          {ponto.canal != null ? String(ponto.canal).padStart(2, '0') : 'IP'}
        </span>
        <b className="min-w-0 break-words font-semibold text-farol-tinta">{ponto.nome}</b>
        <span>{todos.length === 0 ? 'sem critério' : plural(todos.length, 'critério', 'critérios')}</span>
        {!ponto.ativo && <Chip tom="atencao">pausado, não é verificado</Chip>}
        {configura && ponto.ativo && ponto.zonas.length > 0 && (
          <Botao variante="fantasma" mini className="ml-auto" onClick={() => aoAdicionar(ponto)}>
            <Plus className="h-[15px] w-[15px]" aria-hidden />
            Critério<span className="sr-only"> em {rotuloDoCanal(ponto)}</span>
          </Botao>
        )}
      </div>

      {todos.length === 0 ? (
        <p className="text-[13px] text-farol-suave">Nenhum critério neste canal. Nada é verificado aqui.</p>
      ) : visiveis.length === 0 ? (
        <p className="text-[13px] text-farol-suave">
          Nenhum critério {filtro === 'ligados' ? 'ligado' : 'desligado'} neste canal.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visiveis.map((c) => (
            <CartaoDoCriterio
              key={`${c.regra.id}-${c.zonaId}`}
              regra={c.regra}
              ponto={ponto}
              zonaId={c.zonaId}
              zonaNome={c.zonaNome}
              configura={configura}
              aoEditar={acoes.aoEditar}
              aoTirar={acoes.aoTirar}
              aoExcluir={acoes.aoExcluir}
              aoAlternar={acoes.aoAlternar}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SetorDaLoja({ setor, regras, filtro, ...acoes }: { setor: Setor; regras: Regra[]; filtro: Filtro } & Acoes) {
  const [aberto, setAberto] = useState(true);
  const canais = emOrdem(setor.pontos);

  // Critérios DISTINTOS do setor: o mesmo critério em três canais conta um.
  const distintos = new Set<string>();
  for (const p of canais) for (const c of criteriosDoCanal(regras, p.id)) distintos.add(c.regra.id);

  return (
    <li className={CARTAO}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full flex-wrap items-center gap-x-[9px] gap-y-1 rounded-[14px] px-3.5 py-3 text-left"
      >
        <ChevronRight
          className={`h-[18px] w-[18px] shrink-0 text-farol-suave transition-transform duration-200 ease-farol ${aberto ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <Folder className="h-[18px] w-[18px] shrink-0 text-farol-facho-icone" aria-hidden />
        <b className="min-w-0 break-words text-[15px] font-semibold">{setor.nome}</b>
        <span className="ml-auto text-[12.5px] text-farol-suave">
          {plural(canais.length, 'canal', 'canais')} · {plural(distintos.size, 'critério', 'critérios')}
        </span>
      </button>

      {/* A pasta abre e fecha deslizando. Fechada, o que há dentro sai da
          ordem do teclado: `inert` impede o foco de cair em algo invisível. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-farol ${aberto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!aberto}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="flex flex-col gap-3.5 px-3.5 pb-3.5">
            {canais.length === 0 && <li className="text-[13px] text-farol-suave">Este setor ainda não tem câmera.</li>}
            {canais.map((p) => (
              <Canal key={p.id} ponto={p} regras={regras} filtro={filtro} {...acoes} />
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}

export function Explorador({ setores, regras, filtro, ...acoes }: Props) {
  // Critério que não vale em canal nenhum: não tem galho na árvore, e some
  // de vista se não ganhar um lugar próprio. Não é verificado — e é
  // exatamente por isso que precisa aparecer.
  const semCanal = regras.filter((r) => r.alvos.length === 0 && passa(r, filtro));

  return (
    <>
      <ul className="flex flex-col gap-3">
        {setores.map((s) => (
          <SetorDaLoja key={s.id} setor={s} regras={regras} filtro={filtro} {...acoes} />
        ))}
      </ul>

      {semCanal.length > 0 && (
        <section aria-labelledby="t-semcanal" className="flex min-w-0 flex-col gap-3">
          <Titulo id="t-semcanal" conta={semCanal.length}>
            Sem canal
          </Titulo>
          <p className="max-w-[70ch] text-[12.5px] text-farol-suave">
            Critérios que não valem em canal nenhum e, por isso, não são verificados. Ficam guardados com o
            histórico: marque canais de novo ou exclua.
          </p>
          <ul className="flex flex-col gap-2">
            {semCanal.map((r) => {
              const Icone = iconeDoTipo(r.tipo);
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-farol-borda-forte p-3"
                >
                  <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] border border-farol-borda bg-farol-painel text-farol-suave">
                    <Icone className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
                    <b className="min-w-0 break-words font-semibold">{r.nome}</b>
                    <Etiquetas regra={r} />
                  </div>
                  {acoes.configura && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Botao mini onClick={() => acoes.aoEditar(r)}>
                        Marcar canais<span className="sr-only"> para o critério {r.nome}</span>
                      </Botao>
                      <Botao mini variante="perigo-leve" onClick={() => acoes.aoExcluir(r)}>
                        Excluir<span className="sr-only"> o critério {r.nome}</span>
                      </Botao>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
