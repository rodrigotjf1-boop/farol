'use client';

// O cartão de um equipamento, na lista do inventário: a foto, o que ele é,
// onde aparece, e o que já se sabe dele (fotos, descrição, se a loja compara
// sozinha ali).

import { ArrowRight, Cpu, Image as Imagem } from 'lucide-react';

import { plural } from '@/componentes/formatos';
import { CARTAO, Chip } from '@/componentes/ui/pecas';
import type { Equipamento } from '@/lib/api';

import { FotoDoEquipamento } from './foto-do-equipamento';
import { contaDeFotos, lugarEmTexto, MOTIVO_DO_COMPARA_NA_LOJA, nomeDoTipoDeEquipamento } from './rotulos';

export function CartaoDoEquipamento({
  item,
  maximoDeFotos,
  aoAbrir,
}: {
  item: Equipamento;
  maximoDeFotos: number;
  aoAbrir: (item: Equipamento) => void;
}) {
  const capa = item.fotos[0];
  return (
    <article
      data-equipamento={item.nome}
      className={`${CARTAO} flex flex-col gap-3 p-3.5 transition-colors hover:border-farol-borda-forte`}
    >
      <div className="grid aspect-video place-items-center overflow-hidden rounded-[10px] bg-farol-realce text-farol-suave">
        {capa ? <FotoDoEquipamento foto={capa} alt={`Foto de ${item.nome}`} /> : <Imagem className="h-[22px] w-[22px]" aria-hidden />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="break-words text-[15px] font-semibold leading-snug">{item.nome}</h3>
        <p className="break-words text-[12.5px] text-farol-suave">
          {nomeDoTipoDeEquipamento(item.tipo)}
          {item.aparece.length > 0 ? ` · ${item.aparece.map(lugarEmTexto).join(', ')}` : ' · nenhuma câmera marcada'}
        </p>
        <div className="flex flex-1 flex-wrap content-start gap-1.5">
          <Chip tom={item.fotos.length > 0 ? 'ok' : 'atencao'}>
            {item.fotos.length > 0 ? contaDeFotos(item, maximoDeFotos) : 'sem foto'}
          </Chip>
          <Chip tom={item.descricao ? 'ok' : 'neutro'}>{item.descricao ? 'descrito' : 'sem descrição'}</Chip>
          {item.comparaNaLoja && (
            <Chip tom="vazado" icone={Cpu} title={MOTIVO_DO_COMPARA_NA_LOJA}>
              compara na loja
            </Chip>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2.5 border-t border-farol-borda pt-[11px] text-[13px] text-farol-suave">
        <span className="min-w-0">
          {item.conferir.length > 0 ? `${plural(item.conferir.length, 'ponto', 'pontos')} a conferir` : 'nada a conferir ainda'}
        </span>
        <button type="button" onClick={() => aoAbrir(item)} aria-label={`Abrir ${item.nome}`} className="elo inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
          Abrir
          <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
        </button>
      </div>
    </article>
  );
}
