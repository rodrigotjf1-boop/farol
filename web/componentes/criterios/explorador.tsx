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
//
// Canal com quadros mostra os critérios POR LUGAR — os gerais, na imagem
// completa, e os de cada quadro: presença dentro do balcão e fila do lado
// do cliente são a mesma câmera e critérios diferentes.
// =====================================================================

import {
  ChevronRight,
  CircleMinus,
  Clock,
  Crop,
  Ellipsis,
  Folder,
  Image as Imagem,
  Moon,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  UserRoundCheck,
} from 'lucide-react';
import { useState } from 'react';

import { emQuantosLugares, rotuloDaArea } from '@/componentes/canal/quadros';
import { plural } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { CARTAO, Chip, Liga, Titulo } from '@/componentes/ui/pecas';
import { DivisorDeMenu, ITEM_DE_MENU, Menu } from '@/componentes/ui/sobreposto';
import type { Ponto, Regra, Setor } from '@/lib/api';

import { criteriosDoCanal, emOrdem, rotuloDoCanal, temVariasAreas } from './canais';
import { estadoConhecido, NOME_DO_ESTADO, O_QUE_FAZ_NO_ESTADO, TOM_DO_ESTADO } from './estados';
import { oQuePergunta } from './familias';
import {
  ajustesEmLinha,
  faltaAFotoPadrao,
  iconeDoTipo,
  mandaAFotoPadrao,
  nomeDaSeveridade,
  etiquetaDoPorteiro,
  resumoDaFaixa,
  resumoDaProcura,
  TIPOS_DO_DETECTOR,
} from './opcoes';

export type Filtro = 'todos' | 'ligados' | 'desligados';

type Acoes = {
  configura: boolean;
  /** "+ critério" no canal — ou num lugar dele (a imagem completa ou um quadro), quando tem quadros. */
  aoAdicionar: (ponto: Ponto, zonaId?: string) => void;
  aoEditar: (regra: Regra) => void;
  aoTirar: (regra: Regra, ponto: Ponto, zonaId: string) => void;
  aoExcluir: (regra: Regra) => void;
  aoAlternar: (regra: Regra) => void;
};

type Props = Acoes & { setores: Setor[]; regras: Regra[]; filtro: Filtro };

/** Em quantos CANAIS (não lugares) o critério vale. */
function canaisDe(regra: Regra): number {
  return new Set(regra.alvos.map((a) => a.ponto_id)).size;
}

const passa = (regra: Regra, filtro: Filtro): boolean =>
  filtro === 'todos' || (filtro === 'ligados' ? regra.ativa : !regra.ativa);

/** `pontoId`: o canal em que o cartão está — ausente na lista "Sem canal". */
function Etiquetas({ regra, pontoId }: { regra: Regra; pontoId?: string }) {
  const grave = regra.severidade === 'emergencia' || regra.severidade === 'critico';
  const peloDetector = TIPOS_DO_DETECTOR.includes(regra.tipo);
  const procura = resumoDaProcura(regra.parametros);
  const n = canaisDe(regra);
  /** Em quantos quadros (fora as imagens completas). */
  const emQuadros = regra.alvos.filter((a) => !a.principal).length;
  const porteiro = etiquetaDoPorteiro(regra);
  const faixa = resumoDaFaixa(regra.janelas);
  const faltaFoto = faltaAFotoPadrao(regra, pontoId);
  const estado = estadoConhecido(regra.estado);

  return (
    <>
      {/* Comparação em canal sem foto padrão: está cadastrado e NÃO é
          conferido ali. Como "falta dizer o que procurar": aparece na lista. */}
      {faltaFoto && (
        <Chip tom="atencao" icone={TriangleAlert} title="Guarde a foto padrão na tela deste canal, em “Desenho, fotos e conexão”">
          falta a foto padrão
        </Chip>
      )}
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
      {/* "Valendo" é o que sempre existiu e não leva etiqueta. O critério que
          só observa, ou que está em ensaio, está LIGADO e não avisa ninguém:
          isso tem de estar à vista ao lado do "Ligado". */}
      {estado !== 'valendo' && (
        <Chip tom={TOM_DO_ESTADO[estado]} title={`Só “valendo” avisa. Neste estado ele ${O_QUE_FAZ_NO_ESTADO[estado]}.`}>
          {NOME_DO_ESTADO[estado]}
        </Chip>
      )}
      <Chip>{oQuePergunta(regra)}</Chip>
      <Chip tom={grave ? 'critico' : 'neutro'}>{nomeDaSeveridade(regra.severidade)}</Chip>
      {n > 1 && (
        <Chip tom="vazado" title="É um cadastro só: editar aqui muda em todos os canais">
          vale {emQuantosLugares(n, emQuadros)}
        </Chip>
      )}
      {/* "No horário" é o comum e não leva etiqueta; o que foge dele, leva. */}
      {regra.quando === 'fora_do_horario' && (
        <Chip tom="vazado" icone={Moon} title="Só é conferido com a loja fechada">
          fora do horário
        </Chip>
      )}
      {regra.quando === 'sempre' && (
        <Chip tom="vazado" icone={Clock} title="Conferido com a loja aberta ou fechada">
          sempre
        </Chip>
      )}
      {/* O que a loja decide antes de perguntar à nuvem. */}
      {porteiro && (
        <Chip tom="vazado" icone={UserRoundCheck} title="Fora disso a olhada conta como “nada a conferir” e não vai à nuvem">
          {porteiro}
        </Chip>
      )}
      {faixa && (
        <Chip tom="vazado" icone={Clock} title="Só é conferido dentro desta faixa de horas">
          {faixa}
        </Chip>
      )}
      {mandaAFotoPadrao(regra) && (
        <Chip tom="vazado" icone={Imagem} title="A foto padrão do canal vai junto à nuvem, para ela comparar">
          com a foto padrão
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
  configura,
  aoEditar,
  aoTirar,
  aoExcluir,
  aoAlternar,
}: { regra: Regra; ponto: Ponto; zonaId: string } & Omit<Acoes, 'aoAdicionar'>) {
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
        <Etiquetas regra={regra} pontoId={ponto.id} />
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
                  {!temVariasAreas(ponto)
                    ? 'Tirar deste canal'
                    : ponto.zonas.find((z) => z.id === zonaId)?.principal
                      ? 'Tirar da imagem completa'
                      : 'Tirar deste quadro'}
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
      <p className="col-span-2 text-xs text-farol-suave md:col-start-2">{ajustesEmLinha(regra)}</p>
    </li>
  );
}

type DoCanal = ReturnType<typeof criteriosDoCanal>;

function ListaDeCriterios({ itens, ponto, acoes }: { itens: DoCanal; ponto: Ponto; acoes: Acoes }) {
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((c) => (
        <CartaoDoCriterio
          key={`${c.regra.id}-${c.zonaId}`}
          regra={c.regra}
          ponto={ponto}
          zonaId={c.zonaId}
          configura={acoes.configura}
          aoEditar={acoes.aoEditar}
          aoTirar={acoes.aoTirar}
          aoExcluir={acoes.aoExcluir}
          aoAlternar={acoes.aoAlternar}
        />
      ))}
    </ul>
  );
}

/** Um lugar do canal — a imagem completa ou um quadro —, com os critérios que valem NELE. */
function AreaDoCanal({
  ponto,
  zona,
  todos,
  filtro,
  acoes,
}: {
  ponto: Ponto;
  zona: Ponto['zonas'][number];
  todos: DoCanal;
  filtro: Filtro;
  acoes: Acoes;
}) {
  const daArea = todos.filter((c) => c.zonaId === zona.id);
  const visiveis = daArea.filter((c) => passa(c.regra, filtro));

  return (
    <li className="flex flex-col gap-2 border-l-2 border-farol-borda pl-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-farol-suave">
        <Crop className="h-[15px] w-[15px] shrink-0" aria-hidden />
        <b className="min-w-0 break-words font-semibold text-farol-tinta">{rotuloDaArea(zona)}</b>
        <span>
          {daArea.length === 0
            ? 'sem critério'
            : zona.principal
              ? plural(daArea.length, 'critério geral', 'critérios gerais')
              : plural(daArea.length, 'critério', 'critérios')}
        </span>
        {acoes.configura && ponto.ativo && (
          <Botao variante="fantasma" mini className="ml-auto" onClick={() => acoes.aoAdicionar(ponto, zona.id)}>
            <Plus className="h-[15px] w-[15px]" aria-hidden />
            Critério
            <span className="sr-only">
              {' '}
              em {rotuloDaArea(zona)}, {rotuloDoCanal(ponto)}
            </span>
          </Botao>
        )}
      </div>

      {daArea.length === 0 ? (
        <p className="text-[13px] text-farol-suave">
          {zona.principal ? 'Nenhum critério geral neste canal.' : 'Nenhum critério neste quadro. Nada é verificado nele.'}
        </p>
      ) : visiveis.length === 0 ? (
        <p className="text-[13px] text-farol-suave">
          Nenhum critério {filtro === 'ligados' ? 'ligado' : 'desligado'} {zona.principal ? 'na imagem completa' : 'neste quadro'}.
        </p>
      ) : (
        <ListaDeCriterios itens={visiveis} ponto={ponto} acoes={acoes} />
      )}
    </li>
  );
}

function Canal({ ponto, regras, filtro, ...acoes }: { ponto: Ponto; regras: Regra[]; filtro: Filtro } & Acoes) {
  const todos = criteriosDoCanal(regras, ponto.id);
  const visiveis = todos.filter((c) => passa(c.regra, filtro));
  const { configura, aoAdicionar } = acoes;
  // Canal com quadros: o critério é de um LUGAR dele. A lista vem por
  // lugar (a imagem completa, depois cada quadro), e o "+ critério" fica
  // em cada um — é ali que ele vai valer.
  const porArea = temVariasAreas(ponto);
  const distintos = new Set(todos.map((c) => c.regra.id)).size;

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
        <span>
          {porArea && `${plural(ponto.zonas.filter((z) => !z.principal).length, 'quadro', 'quadros')} · `}
          {distintos === 0 ? 'sem critério' : plural(distintos, 'critério', 'critérios')}
        </span>
        {!ponto.ativo && <Chip tom="atencao">pausado, não é verificado</Chip>}
        {configura && ponto.ativo && ponto.zonas.length > 0 && !porArea && (
          <Botao variante="fantasma" mini className="ml-auto" onClick={() => aoAdicionar(ponto)}>
            <Plus className="h-[15px] w-[15px]" aria-hidden />
            Critério<span className="sr-only"> em {rotuloDoCanal(ponto)}</span>
          </Botao>
        )}
      </div>

      {porArea ? (
        <ul className="flex flex-col gap-3">
          {ponto.zonas.map((z) => (
            <AreaDoCanal key={z.id} ponto={ponto} zona={z} todos={todos} filtro={filtro} acoes={acoes} />
          ))}
        </ul>
      ) : todos.length === 0 ? (
        <p className="text-[13px] text-farol-suave">Nenhum critério neste canal. Nada é verificado aqui.</p>
      ) : visiveis.length === 0 ? (
        <p className="text-[13px] text-farol-suave">
          Nenhum critério {filtro === 'ligados' ? 'ligado' : 'desligado'} neste canal.
        </p>
      ) : (
        <ListaDeCriterios itens={visiveis} ponto={ponto} acoes={acoes} />
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
