// As olhadas que a loja segurou, ditas à parte na tela de Análises.
//
// O critério que pede "só com pessoa na área" (ou "com a área livre", ou
// "quando algo se mexe") não pergunta à nuvem quando a condição não vale:
// quem confere é o detector, dentro da loja. Essas olhadas não são análise —
// não entram em nenhum outro número da tela —, e sem dizê-las um critério
// com poucas análises pareceria um critério que ninguém está conferindo.

import { UserRoundCheck } from 'lucide-react';

import { numero } from '@/componentes/formatos';
import { Alerta } from '@/componentes/ui/pecas';
import type { Analises } from '@/lib/api';

import type { NadaAConferir as Seguradas } from './conta';

export function NadaAConferir({ dados, seguradas }: { dados: Analises; seguradas: Seguradas }) {
  if (seguradas.total <= 0) return null;
  const nome = new Map(dados.criterios.map((c) => [c.id, c.nome]));

  return (
    <div data-nada-a-conferir>
      <Alerta icone={UserRoundCheck} papel="status">
        <p>
          <b className="font-semibold text-farol-tinta">
            {numero(seguradas.total)} {seguradas.total === 1 ? 'olhada ficou' : 'olhadas ficaram'} em “nada a conferir”
          </b>{' '}
          neste recorte: a loja viu que a condição do critério não valia — ninguém na área, gente na frente ou nada se
          mexeu — e não perguntou à nuvem. Não entram nas análises.
        </p>
        {seguradas.porCriterio.length > 1 && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {seguradas.porCriterio.map((c) => (
              <span key={c.regraId}>
                {nome.get(c.regraId) ?? 'Critério excluído'}{' '}
                <b className="font-mono font-semibold tabular-nums text-farol-tinta">{numero(c.quantas)}</b>
              </span>
            ))}
          </p>
        )}
      </Alerta>
    </div>
  );
}
