'use client';

// =====================================================================
// O funil do critério — olhadas → com contexto → com gatilho → julgadas
// =====================================================================
// Os números são do servidor (`GET /v1/regras/:id/funil`), dos últimos dias
// no relógio da loja. Cada olhada termina num desfecho só, e a tela mostra
// a conta fechando: o que não entrou no funil (critério sem quem julgue,
// câmera sem imagem, silêncio depois de um aviso) aparece ao lado.
//
// "Quanto custaria ligado" é o TETO — gatilhos por dia × o preço MEDIDO de
// uma análise na nuvem. Sem preço medido a tela diz que não há: número
// inventado não entra.
// =====================================================================

import { Info } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { numero, plural } from '@/componentes/formatos';
import { Alerta, Ossos } from '@/componentes/ui/pecas';
import { ErroDaApi, regrasApi, type EstadoDoCriterio, type FunilDoCriterio } from '@/lib/api';

import { quandoChegaOJulgamento } from './familias';

/** "R$ 0,12" a partir de centavos; abaixo de um centavo, com três casas. */
export function reais(centavos: number): string {
  const v = centavos / 100;
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: v > 0 && v < 0.01 ? 3 : 2, maximumFractionDigits: v > 0 && v < 0.01 ? 3 : 2 })}`;
}

function Linha({ rotulo, valor, max, espera = false, fim = false }: { rotulo: string; valor: number; max: number; espera?: boolean; fim?: boolean }) {
  // Raiz quadrada: o funil cai de milhares para dezenas, e em escala reta a última barra sumiria.
  const largura = espera || valor <= 0 ? 0 : Math.max(1.5, Math.sqrt(valor / Math.max(1, max)) * 100);
  return (
    <div className="grid grid-cols-[minmax(0,118px)_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]" data-linha-do-funil={rotulo}>
      <span className="text-farol-suave">{rotulo}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-farol-realce">
        <i className={`block h-full rounded-full ${fim ? 'bg-farol-critico' : 'bg-farol-marca'}`} style={{ width: `${largura}%` }} />
      </div>
      <span className="min-w-[52px] text-right font-mono text-[13px] font-semibold">{espera ? '—' : numero(valor)}</span>
    </div>
  );
}

function Dado({ valor, children }: { valor: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-farol-borda bg-farol-painel-2 p-3">
      <b className="font-mono text-lg font-semibold leading-tight">{valor}</b>
      <span className="text-[12.5px] leading-snug text-farol-suave">{children}</span>
    </div>
  );
}

type Props = {
  /** Ausente = o critério ainda não existe (está sendo criado). */
  regraId?: string;
  estado: EstadoDoCriterio;
  familia: string;
};

export function AbaDoFunil({ regraId, estado, familia }: Props) {
  const [funil, setFunil] = useState<FunilDoCriterio | null>(null);
  const [erro, setErro] = useState<{ texto: string; semPermissao: boolean } | null>(null);

  const carregar = useCallback(async () => {
    if (!regraId) return;
    setErro(null);
    try {
      setFunil(await regrasApi.funil(regraId));
    } catch (e) {
      const semPermissao = e instanceof ErroDaApi && e.status === 403;
      setErro({ texto: e instanceof ErroDaApi ? e.message : 'não consegui buscar o funil', semPermissao });
    }
  }, [regraId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!regraId) {
    return (
      <div className="rounded-xl border border-dashed border-farol-borda-forte p-3.5" data-funil="novo">
        <b className="font-semibold">Ainda sem dados</b>
        <p className="mt-0.5 text-[13px] text-farol-suave">
          Depois de criado, o critério começa a contar quando o computador da loja buscar a configuração: primeiro as
          olhadas, o contexto e o gatilho — sem julgar.
        </p>
      </div>
    );
  }
  if (erro) {
    return (
      <Alerta tom={erro.semPermissao ? 'neutro' : 'critico'} papel="alert">
        {erro.semPermissao ? 'O funil é visto pela supervisão, pela gerência e pela diretoria.' : erro.texto}
        {!erro.semPermissao && (
          <button type="button" className="elo ml-2 text-[13px]" onClick={() => void carregar()}>
            Tentar de novo
          </button>
        )}
      </Alerta>
    );
  }
  if (!funil) return <Ossos alturas={[18, 96, 84]} />;

  const f = funil.total;
  const dias = plural(funil.dias, 'dia', 'dias');
  if (f.olhadas === 0) {
    return (
      <div className="rounded-xl border border-dashed border-farol-borda-forte p-3.5" data-funil="vazio">
        <b className="font-semibold">Ainda sem dados</b>
        <p className="mt-0.5 text-[13px] text-farol-suave">
          Nenhuma olhada deste critério nos últimos {dias}. Ele conta quando está ligado, no horário dele, e o computador
          da loja está no ar.
        </p>
      </div>
    );
  }

  const observa = estado === 'observando';
  const fora = f.semJuiz + f.semImagem + f.emSilencio;
  const semContextoPct = Math.round((f.semContexto / f.olhadas) * 100);
  const s = funil.seLigado;
  const porDia = Math.round(s.gatilhosPorDia);
  const chega = quandoChegaOJulgamento(familia);
  // O custo do que já foi julgado, por dia EM QUE HOUVE OLHADA: dividir pelos dias do período
  // diria um custo menor que o de um dia de verdade (o critério pode ter rodado em 2 dos 7).
  const diasComOlhada = Math.max(1, funil.porDia.filter((d) => d.olhadas > 0).length);
  const custoPorDia = f.custoCentavos / diasComOlhada;

  return (
    <div className="flex flex-col gap-3.5" data-funil="com-dados">
      <p className="text-[12.5px] text-farol-suave">
        Últimos {dias}, até hoje, no relógio da loja.
        {!funil.temEstudo && ' Sem estudo confirmado, “com contexto” é o que o “quando vale a pena conferir” deixou passar, e todo contexto abre a análise.'}
      </p>

      <div
        className="flex flex-col gap-2"
        role="img"
        aria-label={`Funil: ${numero(f.olhadas)} olhadas, ${numero(f.comContexto)} com contexto, ${numero(f.comGatilho)} com gatilho, ${
          observa ? 'ainda sem julgar' : `${numero(f.julgadas)} julgadas, ${numero(f.foraDoCriterio)} fora do critério`
        }.`}
      >
        <Linha rotulo="Olhadas" valor={f.olhadas} max={f.olhadas} />
        <Linha rotulo="Com contexto" valor={f.comContexto} max={f.olhadas} />
        <Linha rotulo="Com gatilho" valor={f.comGatilho} max={f.olhadas} />
        <Linha rotulo="Julgadas" valor={f.julgadas} max={f.olhadas} espera={observa && f.julgadas === 0} />
        <Linha rotulo="Fora do critério" valor={f.foraDoCriterio} max={f.olhadas} espera={observa && f.julgadas === 0} fim />
      </div>

      {fora > 0 && (
        <p className="text-[12.5px] text-farol-suave" data-fora-do-funil>
          Não entraram no funil: {[
            f.semJuiz > 0 ? `${numero(f.semJuiz)} sem quem julgasse` : null,
            f.semImagem > 0 ? `${numero(f.semImagem)} sem imagem da câmera` : null,
            f.emSilencio > 0 ? `${numero(f.emSilencio)} em silêncio depois de um aviso` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          .
        </p>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Dado valor={`${semContextoPct}%`}>das olhadas sem contexto: não julgadas, não pagas, fora da conta.</Dado>
        <Dado valor={numero(porDia)}>
          {porDia === 1 ? 'vez' : 'vezes'} por dia o gatilho acontece
          {s.diasNaMedia === 0 ? '.' : s.parcial ? ' — só o dia de hoje, que ainda não acabou.' : ` — média de ${plural(s.diasNaMedia, 'dia inteiro', 'dias inteiros')}.`}
        </Dado>
        {observa ? (
          <Dado valor={s.soNaLoja ? 'R$ 0,00' : s.tetoPorDiaCentavos === null ? '—' : reais(s.tetoPorDiaCentavos)}>
            {s.soNaLoja
              ? 'por dia, quando julgar: é conferido só no computador da loja.'
              : s.tetoPorDiaCentavos === null
                ? 'Ainda sem preço medido: a loja não pagou nenhuma análise na nuvem, e o teto não é inventado.'
                : `por dia, no máximo, quando julgar — se toda análise precisasse da nuvem (${
                    s.deOndeVemOPreco === 'criterio' ? 'pelo que este critério já pagou' : 'pelo que a loja pagou'
                  } por análise).`}
          </Dado>
        ) : (
          <Dado valor={reais(custoPorDia)}>
            por dia de nuvem, na média {diasComOlhada === 1 ? 'do dia' : `dos ${diasComOlhada} dias`} com olhada
            {f.naNuvem > 0
              ? ` — ${f.naNuvem === 1 ? '1 análise precisou' : `${numero(f.naNuvem)} análises precisaram`} dela.`
              : ': tudo o que foi julgado, foi no computador da loja.'}
          </Dado>
        )}
      </div>

      {observa && (
        <Alerta icone={Info}>
          <b className="font-semibold">Observando.</b> O critério conta o contexto e o gatilho, sem julgar. É o que
          mostra quanto ele trabalharia — e quanto custaria — antes de julgar.
          {chega && ` O julgamento desta família ${chega}.`}
        </Alerta>
      )}
    </div>
  );
}
