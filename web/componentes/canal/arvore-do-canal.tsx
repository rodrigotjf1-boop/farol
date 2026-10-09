'use client';

// =====================================================================
// Onde cada critério vale — a árvore do canal
// =====================================================================
// Um nó para a imagem completa (os critérios gerais do canal) e um para
// cada quadro, com o número, o nome e o papel dele. Debaixo de cada nó, os
// critérios que valem ali — e só ali.
//
// A segunda linha de cada critério diz o que ele está fazendo AGORA: se
// está desligado, se falta a cena, ou o que o estado dele faz. Nada aqui é
// suposição da tela: "falta descrever a cena" vem do servidor.
// =====================================================================

import { Crop, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';

import { estadoConhecido, NOME_DO_ESTADO, O_QUE_FAZ_NO_ESTADO, TOM_DO_ESTADO } from '@/componentes/criterios/estados';
import { nomeDoTipo } from '@/componentes/criterios/opcoes';
import { plural } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { Chip, type Tom } from '@/componentes/ui/pecas';
import { DivisorDeMenu, ITEM_DE_MENU, Menu } from '@/componentes/ui/sobreposto';
import type { CriterioDaArea, ZonaCompleta } from '@/lib/api';

import { emQuantosLugares, MAX_QUADROS, nomeDoPapel, NOME_DA_IMAGEM_COMPLETA } from './quadros';

/** A pastilha e a segunda linha de um critério: o que ele está fazendo agora. */
export function situacaoDoCriterio(k: CriterioDaArea): { tom: Tom; pastilha: string; linha: string } {
  const tipo = nomeDoTipo(k.tipo);
  const onde = k.canais > 1 ? ` · ${emQuantosLugares(k.canais, k.quadros)}` : '';
  if (!k.ativa) {
    return { tom: 'neutro', pastilha: 'desligado', linha: `${tipo} · não é conferido enquanto estiver desligado${onde}` };
  }
  if (k.falta_a_cena) {
    return {
      tom: 'critico',
      pastilha: 'falta descrever a cena',
      linha:
        k.tipo === 'comparacao'
          ? `${tipo} · sem a cena, o que não for igual à foto padrão fica sem resposta${onde}`
          : `${tipo} · não é analisado enquanto a cena estiver em branco${onde}`,
    };
  }
  const estado = estadoConhecido(k.estado);
  return { tom: TOM_DO_ESTADO[estado], pastilha: NOME_DO_ESTADO[estado], linha: `${tipo} · ${O_QUE_FAZ_NO_ESTADO[estado]}${onde}` };
}

type Props = {
  /** A imagem completa primeiro; depois os quadros, na ordem do número. */
  zonas: ZonaCompleta[];
  selecionada: string;
  aoSelecionar: (zonaId: string) => void;
  configura: boolean;
  /** O canal está ativo: canal pausado não ganha critério novo. */
  canalAtivo: boolean;
  aoAbrirCriterio: (criterioId: string, zonaId: string) => void;
  aoNovoCriterio: (zonaId: string) => void;
  /** Abre a gaveta do quadro — já na exclusão, se pedido. */
  aoEditarQuadro: (zonaId: string, paraExcluir?: boolean) => void;
  aoNovoQuadro: () => void;
  criandoQuadro: boolean;
};

function No({ zona, ...p }: { zona: ZonaCompleta } & Omit<Props, 'zonas' | 'aoNovoQuadro' | 'criandoQuadro'>) {
  const aqui = zona.id === p.selecionada;
  const inteira = zona.principal;
  const nome = inteira ? NOME_DA_IMAGEM_COMPLETA : zona.nome;
  const quantos = plural(zona.criterios.length, 'critério', 'critérios');

  return (
    <li
      data-no={inteira ? 'inteira' : zona.id}
      className={`min-w-0 rounded-[10px] border bg-farol-painel-2 transition-colors ${
        aqui ? 'border-farol-facho shadow-[inset_0_0_0_1px_rgb(var(--facho))]' : 'border-farol-borda'
      }`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5">
        <button
          type="button"
          aria-pressed={aqui}
          onClick={() => p.aoSelecionar(zona.id)}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-lg text-left"
        >
          <span
            className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border font-mono text-[13px] font-semibold ${
              aqui ? 'border-farol-facho bg-farol-facho text-[#1A1204]' : 'border-farol-borda-forte bg-farol-painel text-farol-tinta'
            }`}
          >
            {inteira ? <Crop className="h-[14px] w-[14px]" aria-hidden /> : zona.numero}
          </span>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <b className="min-w-0 break-words font-semibold">
              {!inteira && <span className="sr-only">Quadro {zona.numero}: </span>}
              {nome}
            </b>
            {/* O espaço é texto de verdade: sem ele o leitor de tela lê o nome e o papel colados. */}{' '}
            <small className="text-[13px] text-farol-suave">
              {inteira ? 'critérios gerais do canal' : nomeDoPapel(zona.papel)} · {quantos}
            </small>
          </span>
        </button>

        {!inteira && p.configura && (
          <Menu
            alinhar="fim"
            gatilho={(g) => (
              <Botao variante="fantasma" mini quadrado aria-label={`Ações do Quadro ${zona.numero}, ${zona.nome}`} {...g}>
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
                    p.aoEditarQuadro(zona.id);
                  }}
                >
                  <Pencil className="h-[18px] w-[18px]" aria-hidden />
                  Editar o quadro
                </button>
                {p.canalAtivo && (
                  <button
                    type="button"
                    role="menuitem"
                    className={ITEM_DE_MENU}
                    onClick={() => {
                      fechar();
                      p.aoNovoCriterio(zona.id);
                    }}
                  >
                    <Plus className="h-[18px] w-[18px]" aria-hidden />
                    Critério neste quadro
                  </button>
                )}
                <DivisorDeMenu />
                <button
                  type="button"
                  role="menuitem"
                  className={`${ITEM_DE_MENU} text-farol-critico`}
                  onClick={() => {
                    fechar();
                    p.aoEditarQuadro(zona.id, true);
                  }}
                >
                  <Trash2 className="h-[18px] w-[18px]" aria-hidden />
                  Excluir o quadro
                </button>
              </>
            )}
          </Menu>
        )}
      </div>

      {zona.criterios.length > 0 && (
        <ul className="flex flex-col gap-1.5 px-3 pb-2.5">
          {zona.criterios.map((k) => {
            const s = situacaoDoCriterio(k);
            const conteudo = (
              <>
                <b className="min-w-0 break-words font-medium">{k.nome}</b>{' '}
                <Chip tom={s.tom}>{s.pastilha}</Chip>{' '}
                <span className="col-span-full font-mono text-[12.5px] leading-snug text-farol-suave">{s.linha}</span>
              </>
            );
            const classe =
              'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 rounded-lg border border-farol-borda bg-farol-painel px-[11px] py-[9px] text-left';
            return (
              <li key={k.id}>
                {p.configura ? (
                  <button
                    type="button"
                    data-criterio={k.id}
                    onClick={() => p.aoAbrirCriterio(k.id, zona.id)}
                    className={`${classe} transition-colors hover:border-farol-borda-forte`}
                  >
                    {conteudo}
                  </button>
                ) : (
                  <div data-criterio={k.id} className={classe}>
                    {conteudo}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-3 pb-3 text-[13px] text-farol-suave">
        {zona.criterios.length === 0 && <span>{inteira ? 'Nenhum critério geral.' : 'Nenhum critério neste quadro.'}</span>}
        {p.configura && p.canalAtivo && (
          <button type="button" data-novo-criterio={inteira ? 'inteira' : zona.id} onClick={() => p.aoNovoCriterio(zona.id)} className="elo text-[13px]">
            <Plus className="h-[14px] w-[14px]" aria-hidden />
            {inteira ? 'critério geral' : 'critério'}
            {!inteira && <span className="sr-only"> no Quadro {zona.numero}, {zona.nome}</span>}
          </button>
        )}
      </div>
    </li>
  );
}

export function ArvoreDoCanal({ zonas, aoNovoQuadro, criandoQuadro, ...resto }: Props) {
  const quadros = zonas.filter((z) => !z.principal);
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-col gap-2.5">
        {zonas.map((z) => (
          <No key={z.id} zona={z} {...resto} />
        ))}
      </ul>

      {quadros.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-farol-borda-forte px-5 py-8 text-center" data-sem-quadro>
          <h3 className="font-display text-[17px] font-semibold">Nenhum quadro marcado</h3>
          <p className="max-w-[46ch] text-farol-suave">
            O canal já tem a imagem completa, para os critérios gerais. Marque um quadro quando um critério valer só
            numa parte da imagem: as cubas, a área de montagem, a impressora.
          </p>
          {resto.configura && (
            <Botao variante="primario" className="mt-1" onClick={aoNovoQuadro} ocupado={criandoQuadro}>
              {!criandoQuadro && <Plus className="h-[18px] w-[18px]" aria-hidden />}
              {criandoQuadro ? 'Criando…' : 'Marcar o primeiro quadro'}
            </Botao>
          )}
        </div>
      )}

      {quadros.length >= MAX_QUADROS && resto.configura && (
        <p className="text-[12.5px] text-farol-suave">Este canal chegou a {MAX_QUADROS} quadros, que é o máximo.</p>
      )}
    </div>
  );
}
