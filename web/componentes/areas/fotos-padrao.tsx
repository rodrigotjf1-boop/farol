'use client';

// =====================================================================
// As fotos padrão do canal — a lista, ao lado do quadro
// =====================================================================
// A foto padrão é o quadro do canal com o ambiente como deve ficar. A loja
// compara o quadro de agora com ela antes de perguntar a alguém. Um canal
// guarda poucas (uma para cada situação de luz), e a loja usa a que mais
// se parecer com a cena — por isso nenhuma é "a que vale": clicar numa só
// escolhe qual aparece no quadro.
// =====================================================================

import { Camera, Trash2 } from 'lucide-react';

import { diaEHora, plural } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';
import { Alerta, CARTAO, Ossos, Titulo } from '@/componentes/ui/pecas';
import { padroesApi, type FotoPadrao } from '@/lib/api';

type Props = {
  /** `null` = ainda carregando. */
  fotos: FotoPadrao[] | null;
  /** Quantas o canal guarda. */
  maximo: number;
  erro: string | null;
  /** A que está no quadro, nas vistas "Foto padrão" e "Comparar". */
  noQuadro: string | null;
  configura: boolean;
  /** O canal tem quadro para guardar? */
  temQuadro: boolean;
  aoVer: (foto: FotoPadrao) => void;
  aoGuardar: () => void;
  aoExcluir: (foto: FotoPadrao) => void;
};

export function FotosPadrao({ fotos, maximo, erro, noQuadro, configura, temQuadro, aoVer, aoGuardar, aoExcluir }: Props) {
  const cheio = fotos !== null && fotos.length >= maximo;
  const porQueNao = !temQuadro
    ? 'O canal ainda não tem quadro: atualize o quadro primeiro'
    : cheio
      ? `O canal já tem ${maximo} fotos padrão: exclua uma para guardar outra`
      : undefined;

  return (
    <section aria-labelledby="t-padrao-canal" data-fotos-padrao className={`${CARTAO} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Titulo id="t-padrao-canal">Foto padrão deste canal</Titulo>
        {configura && (
          <Botao mini className="ml-auto" onClick={aoGuardar} disabled={porQueNao !== undefined} title={porQueNao}>
            <Camera className="h-[15px] w-[15px]" aria-hidden />
            Guardar a de agora
          </Botao>
        )}
      </div>

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      )}

      {fotos === null ? (
        !erro && <Ossos alturas={[44]} />
      ) : fotos.length === 0 ? (
        <p className="text-[13px] text-farol-suave">
          Nenhuma foto padrão. Sem ela, critério de comparação não é conferido neste canal.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {fotos.map((f) => {
            const vista = f.id === noQuadro;
            return (
              <li key={f.id} className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={vista}
                  title="Ver esta foto no quadro"
                  onClick={() => aoVer(f)}
                  className={`flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border px-2 py-1.5 text-left transition-colors ${
                    vista
                      ? 'border-farol-marca bg-farol-painel shadow-[inset_0_0_0_1px_rgb(var(--marca))]'
                      : 'border-farol-borda bg-farol-painel-2 hover:border-farol-borda-forte'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={padroesApi.url(f.id)}
                    alt=""
                    loading="lazy"
                    className="h-9 w-16 shrink-0 rounded-md bg-farol-realce object-cover"
                    draggable={false}
                  />
                  <span className="min-w-0">
                    <b className="block break-words font-semibold">{f.nome}</b>
                    <small className="block text-xs text-farol-suave">
                      {diaEHora(f.criadaEm)}
                      {f.criadaPor ? ` · ${f.criadaPor}` : ''}
                      {/* Foto guardada com gente na frente compara pior: fica dito. */}
                      {f.pessoas ? ` · ${plural(f.pessoas, 'pessoa', 'pessoas')} no quadro` : ''}
                    </small>
                  </span>
                </button>
                {configura && (
                  <Botao variante="fantasma" mini quadrado aria-label={`Excluir a foto padrão ${f.nome}`} onClick={() => aoExcluir(f)}>
                    <Trash2 className="h-[18px] w-[18px]" aria-hidden />
                  </Botao>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {configura && cheio && (
        <p className={AJUDA}>O canal guarda até {maximo} fotos padrão. Para guardar outra, exclua uma.</p>
      )}
      <p className={AJUDA}>
        É o ambiente limpo, organizado e sem ninguém na frente. Vale para todas as áreas do canal: cada critério de
        comparação olha o recorte da sua área. Guarde uma para cada situação de luz: a loja compara com a que mais
        se parecer com a cena.
      </p>
    </section>
  );
}
