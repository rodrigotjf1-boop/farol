'use client';

// =====================================================================
// O painel ao lado da planta: o que está escolhido
// =====================================================================
// Fora da edição ele CONTA: o canal da câmera (situação, o que confere, a
// frase do lugar) ou o equipamento (quem o vê, o que o inventário sabe).
// Na edição ele MEXE: a lente da câmera, o nome e as medidas do móvel e do
// ambiente — e é por onde se tira algo da planta.
// =====================================================================

import { ArrowRight, Crop, Package, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { iconeDoTipo, nomeDoTipo } from '@/componentes/criterios/opcoes';
import { plural } from '@/componentes/formatos';
import { nomeDoTipoDeEquipamento } from '@/componentes/inventario/rotulos';
import type { Selecao } from '@/componentes/planta/desenho';
import { numeroDoCanal, type Situacao } from '@/componentes/planta/situacao';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Chip } from '@/componentes/ui/pecas';
import type { Equipamento, Ponto, Regra, Setor } from '@/lib/api';
import { ambienteEm, camerasQueVeem, comVirgula, LIMITES, type Camera, type Planta } from '@/lib/planta';

export type CanalNaPlanta = { ponto: Ponto; situacao: Situacao; setorNome: string };

const NUMERO =
  'grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] bg-farol-realce font-mono text-[13px] font-semibold text-farol-marca';

function Topo({ selo, titulo, sub }: { selo: ReactNode; titulo: string; sub: string }) {
  return (
    <div className="flex items-start gap-[11px]">
      <span className={NUMERO}>{selo}</span>
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-base font-semibold leading-snug">{titulo}</h3>
        <p className="break-words text-[12.5px] text-farol-suave">{sub}</p>
      </div>
    </div>
  );
}

/** Um número em metros. Valor fora da faixa não entra na planta: o campo fica com ele até ser corrigido. */
function Medida({
  rotulo,
  valor,
  faixa,
  passo = 0.1,
  aoMudar,
}: {
  rotulo: string;
  valor: number;
  faixa: readonly [number, number];
  passo?: number;
  aoMudar: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-[5px]">
      <label htmlFor={id} className={ROTULO}>
        {rotulo}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className="entrada font-mono"
        min={faixa[0]}
        max={faixa[1]}
        step={passo}
        defaultValue={valor}
        onChange={(ev) => {
          const v = Math.round(Number(ev.target.value) * 100) / 100;
          if (ev.target.value.trim() !== '' && Number.isFinite(v) && v >= faixa[0] && v <= faixa[1]) aoMudar(v);
        }}
      />
    </div>
  );
}

/** Um controle deslizante da lente da câmera, com o valor escrito ao lado. */
function Faixa({
  rotulo,
  valor,
  faixa,
  passo,
  unidade,
  aoMudar,
}: {
  rotulo: string;
  valor: number;
  faixa: readonly [number, number];
  passo: number;
  unidade: string;
  aoMudar: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5">
      <label htmlFor={id} className={ROTULO}>
        {rotulo}
      </label>
      <output htmlFor={id} className="font-mono text-[12.5px] font-medium text-farol-suave">
        {comVirgula(valor)}
        {unidade}
      </output>
      <input
        id={id}
        type="range"
        className="col-span-2 min-h-7 w-full accent-[rgb(var(--marca))]"
        min={faixa[0]}
        max={faixa[1]}
        step={passo}
        // A câmera pode ter sido salva fora da faixa do controle (a API aceita mais): ele mostra o extremo.
        value={Math.min(faixa[1], Math.max(faixa[0], valor))}
        onChange={(ev) => aoMudar(Number(ev.target.value))}
      />
    </div>
  );
}

const NOTA = 'text-[13px] text-farol-suave';
const SECAO = 'flex flex-col gap-3';

export function PainelDaPlanta({
  lojaId,
  planta,
  selecao,
  editando,
  veResultados,
  canais,
  regras,
  setores,
  itens,
  lugares,
  /** O que acabou de ser desenhado: o campo do nome já vem selecionado, para escrever por cima. */
  recemCriado,
  aoMudar,
  aoTirar,
}: {
  lojaId: string;
  planta: Planta;
  selecao: Selecao | null;
  editando: boolean;
  veResultados: boolean;
  canais: ReadonlyMap<string, CanalNaPlanta>;
  regras: Regra[];
  setores: Setor[];
  itens: Equipamento[];
  lugares: Record<string, string>;
  recemCriado: string | null;
  aoMudar: (planta: Planta) => void;
  /** Tira o que está escolhido da planta. */
  aoTirar: (s: Selecao) => void;
}) {
  const nome = useRef<HTMLInputElement>(null);
  const idDoNome = useId();
  const idDoSetor = useId();
  const idDoItem = useId();

  useEffect(() => {
    if (recemCriado && selecao?.id === recemCriado) nome.current?.select();
  }, [recemCriado, selecao?.id]);

  // ───────────────────────── a câmera ─────────────────────────
  const cam = selecao?.tipo === 'camera' ? planta.cameras.find((c) => c.pontoId === selecao.id) : undefined;
  const canal = cam ? canais.get(cam.pontoId) : undefined;
  if (cam && canal) {
    const { ponto, situacao, setorNome } = canal;
    const mudar = (campo: keyof Camera, v: number) =>
      aoMudar({ ...planta, cameras: planta.cameras.map((c) => (c.pontoId === cam.pontoId ? { ...c, [campo]: v } : c)) });
    const doCanal = regras.filter((r) => r.alvos.some((a) => a.ponto_id === ponto.id));
    const lugar = lugares[ponto.id];
    return (
      <section className={SECAO} data-painel="camera">
        <Topo selo={numeroDoCanal(ponto)} titulo={ponto.nome} sub={`${setorNome} · ${ambienteEm(planta, cam.x, cam.y)?.nome ?? 'fora dos ambientes'}`} />
        <div className="flex flex-wrap gap-1.5">
          <Chip tom={situacao.tom}>{situacao.texto}</Chip>
          {ponto.zonas.length > 1 && (
            <Chip tom="vazado" icone={Crop}>
              {plural(ponto.zonas.length, 'área', 'áreas')}
            </Chip>
          )}
        </div>
        {editando ? (
          <>
            <Faixa rotulo="Direção" valor={cam.dir} faixa={[0, 359]} passo={1} unidade="°" aoMudar={(v) => mudar('dir', v)} />
            <Faixa rotulo="Abertura" valor={cam.abertura} faixa={LIMITES.abertura} passo={1} unidade="°" aoMudar={(v) => mudar('abertura', v)} />
            <Faixa rotulo="Alcance" valor={cam.alcance} faixa={LIMITES.alcance} passo={0.1} unidade=" m" aoMudar={(v) => mudar('alcance', v)} />
            <Faixa rotulo="Altura" valor={cam.alt} faixa={LIMITES.alturaDaCamera} passo={0.1} unidade=" m" aoMudar={(v) => mudar('alt', v)} />
            <p className={NOTA}>A abertura é a da lente: uma lente de 2,8 mm abre perto de 100°; uma de 3,6 mm, perto de 80°.</p>
            <Botao variante="perigo-leve" mini className="self-start" onClick={() => aoTirar({ tipo: 'camera', id: cam.pontoId })}>
              <Trash2 className="h-[15px] w-[15px]" aria-hidden />
              Tirar da planta
            </Botao>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold">O que confere</h2>
            {doCanal.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {doCanal.map((r) => {
                  const Icone = iconeDoTipo(r.tipo);
                  return (
                    <li key={r.id} className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-farol-realce text-farol-marca">
                        <Icone className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <b className="block break-words text-[13.5px] font-semibold">{r.nome}</b>
                        <small className="text-xs text-farol-suave">
                          {nomeDoTipo(r.tipo)}
                          {r.quando === 'fora_do_horario' ? ' · só com a loja fechada' : ''}
                        </small>
                      </span>
                      <Chip tom={r.ativa ? 'ok' : 'neutro'}>{r.ativa ? 'ligado' : 'desligado'}</Chip>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={NOTA}>Nenhum critério neste canal. Nada é verificado aqui.</p>
            )}
            {lugar && (
              <div className="rounded-[10px] border border-farol-borda bg-farol-painel-2 px-3 py-2.5 text-[13px]" data-lugar>
                {lugar}
                <small className="mt-1 block text-xs text-farol-suave">
                  Escrita a partir da planta. Vai junto com a imagem em cada análise deste canal que sobe à nuvem.
                </small>
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
              <Link href={`/pontos/${ponto.id}/area`} className="elo">
                Quadro e área
                <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
              </Link>
              {veResultados && (
                <Link href={`/lojas/${lojaId}/analises?canal=${ponto.id}`} className="elo">
                  Análises deste canal
                  <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                </Link>
              )}
            </div>
          </>
        )}
      </section>
    );
  }

  // ───────────────────────── o móvel ─────────────────────────
  const movel = selecao?.tipo === 'movel' ? planta.moveis.find((m) => m.id === selecao.id) : undefined;
  if (movel) {
    const item = movel.itemId ? itens.find((i) => i.id === movel.itemId) : undefined;
    const mudar = (mais: Partial<typeof movel>) => aoMudar({ ...planta, moveis: planta.moveis.map((m) => (m.id === movel.id ? { ...m, ...mais } : m)) });
    const veem = camerasQueVeem(planta, movel)
      .map((c) => canais.get(c.pontoId)?.ponto)
      .filter((p): p is Ponto => Boolean(p));
    // Um equipamento está num lugar só: os que já estão em outro móvel não aparecem na lista.
    const emOutro = new Set(planta.moveis.filter((m) => m.id !== movel.id && m.itemId).map((m) => m.itemId));
    const livres = itens.filter((i) => !emOutro.has(i.id));
    return (
      <section className={SECAO} data-painel="movel">
        <Topo
          selo={<Package className="h-[18px] w-[18px]" aria-hidden />}
          titulo={item?.nome ?? movel.nome}
          sub={item ? `${nomeDoTipoDeEquipamento(item.tipo)} · ${item.setorNome}` : 'móvel, sem cadastro no inventário'}
        />
        {editando ? (
          <>
            <div className="flex min-w-0 flex-col gap-[5px]">
              <label htmlFor={idDoNome} className={ROTULO}>
                Nome
              </label>
              <input
                // Ligar a um equipamento pode dar o nome dele ao móvel: o campo recomeça com o nome novo.
                key={`${movel.id}-${movel.itemId ?? ''}`}
                ref={nome}
                id={idDoNome}
                className="entrada"
                maxLength={LIMITES.nome}
                defaultValue={movel.nome}
                onChange={(ev) => {
                  const v = ev.target.value.replace(/\s+/g, ' ').trim();
                  if (v) mudar({ nome: v });
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-[5px]">
              <label htmlFor={idDoItem} className={ROTULO}>
                Equipamento do inventário
              </label>
              <select
                id={idDoItem}
                className="entrada"
                value={item?.id ?? ''}
                onChange={(ev) => {
                  const escolhido = itens.find((i) => i.id === ev.target.value);
                  // Ligar a um equipamento dá ao móvel o nome dele, se o móvel ainda não tinha um.
                  mudar({ itemId: escolhido?.id ?? null, ...(escolhido && movel.nome === 'Equipamento' ? { nome: escolhido.nome.slice(0, LIMITES.nome) } : {}) });
                }}
              >
                <option value="">nenhum — é só um móvel</option>
                {livres.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome} · {i.setorNome}
                  </option>
                ))}
              </select>
              <p className={AJUDA}>Ligado a um equipamento, o nome dele vai na descrição do lugar da câmera que o vê.</p>
            </div>
            <div key={movel.id} className="grid grid-cols-3 items-end gap-2.5">
              <Medida rotulo="Largura, em m" valor={movel.w} faixa={LIMITES.ladoDoMovel} aoMudar={(v) => mudar({ w: v })} />
              <Medida rotulo="Comprimento, em m" valor={movel.h} faixa={LIMITES.ladoDoMovel} aoMudar={(v) => mudar({ h: v })} />
              <Medida rotulo="Altura, em m" valor={movel.alt} faixa={LIMITES.alturaDoMovel} aoMudar={(v) => mudar({ alt: v })} />
            </div>
            <Botao variante="perigo-leve" mini className="self-start" onClick={() => aoTirar({ tipo: 'movel', id: movel.id })}>
              <Trash2 className="h-[15px] w-[15px]" aria-hidden />
              Tirar da planta
            </Botao>
          </>
        ) : (
          <>
            {item && (
              <div className="flex flex-wrap gap-1.5">
                <Chip tom={item.fotos.length ? 'ok' : 'atencao'}>{item.fotos.length ? plural(item.fotos.length, 'foto', 'fotos') : 'sem foto'}</Chip>
                <Chip tom={item.descricao ? 'ok' : 'neutro'}>{item.descricao ? 'descrito' : 'sem descrição'}</Chip>
              </div>
            )}
            <dl className="flex flex-col gap-2 text-[13px]">
              <div>
                <dt className="text-xs font-semibold text-farol-suave">Visto por</dt>
                <dd>{veem.length ? veem.map((p) => `${p.nome} (${numeroDoCanal(p)})`).join(', ') : 'nenhuma câmera'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-farol-suave">Medidas</dt>
                <dd>
                  {comVirgula(movel.w)} × {comVirgula(movel.h)} m · {comVirgula(movel.alt)} m de altura
                </dd>
              </div>
            </dl>
            {item?.descricao && (
              <div className="rounded-[10px] border border-farol-borda bg-farol-painel-2 px-3 py-2.5 text-[13px]">{item.descricao}</div>
            )}
            {item && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
                <Link href={`/lojas/${lojaId}/canais/inventario?equipamento=${item.id}`} className="elo">
                  Abrir no inventário
                  <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
                </Link>
              </div>
            )}
          </>
        )}
      </section>
    );
  }

  // ───────────────────────── o ambiente (só na edição) ─────────────────────────
  const ambiente = selecao?.tipo === 'ambiente' && editando ? planta.ambientes.find((a) => a.id === selecao.id) : undefined;
  if (ambiente) {
    const mudar = (mais: Partial<typeof ambiente>) =>
      aoMudar({ ...planta, ambientes: planta.ambientes.map((a) => (a.id === ambiente.id ? { ...a, ...mais } : a)) });
    return (
      <section className={SECAO} data-painel="ambiente">
        <h2 className="text-base font-semibold">Ambiente</h2>
        <div className="flex min-w-0 flex-col gap-[5px]">
          <label htmlFor={idDoNome} className={ROTULO}>
            Nome
          </label>
          <input
            key={ambiente.id}
            ref={nome}
            id={idDoNome}
            className="entrada"
            maxLength={LIMITES.nome}
            defaultValue={ambiente.nome}
            onChange={(ev) => {
              const v = ev.target.value.replace(/\s+/g, ' ').trim();
              if (v) mudar({ nome: v });
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-[5px]">
          <label htmlFor={idDoSetor} className={ROTULO}>
            Setor
          </label>
          <select id={idDoSetor} className="entrada" value={ambiente.setorId ?? ''} onChange={(ev) => mudar({ setorId: ev.target.value || null })}>
            {(ambiente.setorId === null || setores.length === 0) && <option value="">sem setor</option>}
            {setores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </div>
        <div key={ambiente.id} className="grid grid-cols-2 items-end gap-2.5">
          <Medida rotulo="Largura, em m" valor={ambiente.w} faixa={LIMITES.ladoDoAmbiente} passo={0.5} aoMudar={(v) => mudar({ w: v })} />
          <Medida rotulo="Comprimento, em m" valor={ambiente.h} faixa={LIMITES.ladoDoAmbiente} passo={0.5} aoMudar={(v) => mudar({ h: v })} />
        </div>
        <Botao variante="perigo-leve" mini className="self-start" onClick={() => aoTirar({ tipo: 'ambiente', id: ambiente.id })}>
          <Trash2 className="h-[15px] w-[15px]" aria-hidden />
          Excluir o ambiente
        </Botao>
      </section>
    );
  }

  return (
    <section className={SECAO} data-painel="nada">
      <h2 className="text-base font-semibold">Nada selecionado</h2>
      <p className={NOTA}>
        {editando
          ? 'Toque numa câmera, num equipamento ou num ambiente para mexer nele. Use os botões acima da planta para desenhar um novo.'
          : 'Toque numa câmera ou num equipamento da planta.'}
      </p>
    </section>
  );
}
