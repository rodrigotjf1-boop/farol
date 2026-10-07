// "Precisa de atenção": os sinais de que o SISTEMA não está conseguindo
// olhar. A API manda o tipo e os números; aqui eles viram frase.
//
// Cada sinal diz três coisas, nesta ordem: o que está acontecendo, o que
// isso custa, e onde se resolve. "Câmera offline" sozinho não comunica que
// um critério deixou de ser verificado.

import {
  ArrowRight,
  CircleCheck,
  CircleHelp,
  Eye,
  SlidersHorizontal,
  TriangleAlert,
  Unplug,
  VideoOff,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { haQuanto } from '@/componentes/console';
import { desdeAHora, plural } from '@/componentes/formatos';
import { CARTAO } from '@/componentes/ui/pecas';
import type { Sinal } from '@/lib/api';

type Frase = {
  icone: LucideIcon;
  titulo: string;
  texto: string;
  acao?: { rotulo: string; href: string };
};

export function fraseDoSinal(s: Sinal, lojaId: string, fuso: string): Frase {
  const criterios = `/lojas/${lojaId}/regras`;
  const nome = s.regraNome ? `“${s.regraNome}”` : 'Um critério';

  switch (s.tipo) {
    case 'sem_agente':
      return {
        icone: Unplug,
        titulo: 'Esta loja não tem agente instalado',
        texto:
          'O agente é o programa que roda no computador da loja. Sem ele não há captura nem análise: a loja ' +
          'aparece cadastrada e nada é verificado. A instalação é feita pela Regem.',
      };
    case 'agente_fora':
      return {
        icone: Unplug,
        titulo:
          s.segundosSemBater == null
            ? 'O agente ainda não deu sinal'
            : `O agente está sem sinal ${haQuanto(s.segundosSemBater)}`,
        texto:
          'Enquanto ele estiver fora, nenhuma câmera é verificada. Confira se o computador da loja está ligado ' +
          'e com internet.',
      };
    case 'canal_sem_imagem': {
      const desde = desdeAHora(s.desde, fuso);
      const n = s.quantos ?? 0;
      return {
        icone: VideoOff,
        titulo: `${s.pontoNome} está sem imagem${desde ? ` ${desde}` : ''}`,
        texto:
          (s.canal != null ? `O canal ${s.canal} parou de entregar cena. ` : 'A câmera parou de entregar cena. ') +
          (n > 0
            ? `Enquanto isso, ${n === 1 ? '1 critério não é verificado' : `${n} critérios não são verificados`}.`
            : '') +
          (s.impedimento ? ` O agente informou: ${s.impedimento}.` : ''),
        acao: s.pontoId ? { rotulo: 'Ver o canal', href: `/pontos/${s.pontoId}/area` } : undefined,
      };
    }
    case 'sem_juiz':
      return {
        icone: CircleHelp,
        titulo: `${nome} não tem quem julgue`,
        texto:
          (s.impedimento ? `${capitalizar(s.impedimento)}. ` : 'O agente da loja não tem como julgar este critério. ') +
          `Ele está ligado e não é verificado em ${plural(s.quantos ?? 1, 'canal', 'canais')}.`,
        acao: { rotulo: 'Ver o critério', href: criterios },
      };
    case 'julgamento_falhando':
      return {
        icone: TriangleAlert,
        titulo: `${nome} não está sendo julgado`,
        texto:
          `${plural(s.quantos ?? 0, 'tentativa falhou', 'tentativas falharam')} neste período` +
          (s.impedimento ? `. O agente informou: ${s.impedimento}.` : '.'),
        acao: { rotulo: 'Ver o critério', href: criterios },
      };
    case 'avalia_pouco':
      return {
        icone: CircleHelp,
        titulo: `${nome} não conseguiu avaliar ${s.percentual ?? 0}% das vezes em ${s.pontoNome}`,
        texto: 'A câmera não mostra o suficiente para decidir. Vale ajustar a área ou o enquadramento.',
        acao: s.pontoId ? { rotulo: 'Ver a área', href: `/pontos/${s.pontoId}/area` } : undefined,
      };
    case 'falta_dizer_o_que_procurar':
      return {
        icone: SlidersHorizontal,
        titulo: `${nome} não tem como ser verificado`,
        texto: 'Falta dizer o que o detector procura. Edite o critério e escolha o objeto.',
        acao: { rotulo: 'Ajustar o critério', href: criterios },
      };
    case 'nunca_olhado':
      return {
        icone: Eye,
        titulo: `${nome} está ligado e não foi olhado nenhuma vez`,
        texto: 'Não houve captura neste período. Confira se os canais dele estão ativos.',
        acao: { rotulo: 'Ver o critério', href: criterios },
      };
  }
}

function capitalizar(t: string): string {
  const limpo = t.trim().replace(/[.\s]+$/, '');
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

export function Sinais({ sinais, lojaId, fuso }: { sinais: Sinal[]; lojaId: string; fuso: string }) {
  if (sinais.length === 0) {
    return (
      <div className={`${CARTAO} flex flex-col items-center gap-1.5 px-4 py-7 text-center text-farol-suave`}>
        <span className="grid h-11 w-11 place-items-center rounded-full bg-farol-ok-leve text-farol-ok">
          <CircleCheck className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <b className="font-semibold text-farol-tinta">Tudo em dia</b>
        <span className="text-[13px]">O agente está de pé, as câmeras têm imagem e os critérios estão sendo julgados.</span>
      </div>
    );
  }

  return (
    <ul className={`${CARTAO} flex flex-col`}>
      {sinais.map((s, i) => {
        const f = fraseDoSinal(s, lojaId, fuso);
        const Icone = f.icone;
        const critico = s.gravidade === 'critico';
        return (
          <li
            key={`${s.tipo}-${s.regraId ?? ''}-${s.pontoId ?? ''}-${i}`}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3.5 [&+li]:border-t [&+li]:border-farol-borda"
          >
            <span
              className={`row-span-3 grid h-[34px] w-[34px] place-items-center rounded-[10px] ${
                critico ? 'bg-farol-critico-leve text-farol-critico' : 'bg-farol-facho-leve text-farol-facho-tinta'
              }`}
            >
              <Icone className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <b className="font-semibold leading-snug">
              <span className="sr-only">{critico ? 'Crítico: ' : 'Atenção: '}</span>
              {f.titulo}
            </b>
            <p className="text-[13px] text-farol-suave">{f.texto}</p>
            {f.acao && (
              <Link href={f.acao.href} className="elo mt-0.5 justify-self-start text-[13px]">
                {f.acao.rotulo}
                <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
