// Os três blocos do topo da Saúde do computador (A26, M2): "Sobrecarregado?", "Esquentando?" e "Por quê".
//
// Do protótipo aprovado em 25/10/2026, com uma diferença de legibilidade: a frase pequena de cada bloco vai numa tira
// de papel (tinta normal sobre o cartão). Medido: texto pequeno branco sobre o picles dá 4,3:1 no claro e 3,2:1 no
// escuro, e sobre o ketchup do escuro 3,4:1 — abaixo de 4,5:1. A palavra grande (texto grande) fica sobre a cor.

import type { Limites, ResumoDaSaude } from '@/lib/saude';
import { num } from '@/lib/saude';

type Tom = 'ok' | 'mal' | 'sem';
const COR: Record<Tom, string> = {
  // branco sobre a cor só no título (19 px extranegrito) e na palavra grande: texto grande, ≥ 3:1 nos dois temas
  ok: 'bg-farol-picles text-white',
  mal: 'bg-farol-ketchup text-white',
  sem: 'bg-farol-painel-2 text-farol-tinta border border-farol-borda',
};

function Bloco({ titulo, palavra, frase, tom, dado }: { titulo: string; palavra: string; frase: string; tom: Tom; dado: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-2 rounded-[26px] p-5 ${COR[tom]}`} aria-label={`${titulo} ${palavra}`} data-veredito={dado}>
      <h2 className="font-display text-[19px] font-extrabold uppercase leading-tight tracking-[.04em]">{titulo}</h2>
      <span className="font-display text-[56px] font-black uppercase leading-[.86] md:text-[64px]">{palavra}</span>
      <p className="mt-auto rounded-xl bg-farol-painel px-3 py-2 text-[13px] font-medium leading-snug text-farol-tinta">{frase}</p>
    </section>
  );
}

export function Vereditos({ resumo, limites, comSensores }: { resumo: ResumoDaSaude; limites: Limites; comSensores: boolean }) {
  const pico = (campo: string) => resumo.sensores[campo]?.pico?.valor ?? null;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-vereditos>
      <Bloco
        dado="sobrecarga"
        titulo="Sobrecarregado?"
        palavra={resumo.sobrecarregado ? 'Sim' : 'Não'}
        tom={resumo.sobrecarregado ? 'mal' : 'ok'}
        frase={
          resumo.sobrecarregado
            ? `mais de ${limites.minutosParaSobrecarga} minutos por dia acima do limite`
            : `nenhuma peça passou ${limites.minutosParaSobrecarga} minutos por dia acima do limite`
        }
      />
      <Bloco
        dado="calor"
        titulo="Esquentando?"
        palavra={!comSensores ? '—' : resumo.esquentando ? 'Sim' : 'Não'}
        tom={!comSensores ? 'sem' : resumo.esquentando ? 'mal' : 'ok'}
        frase={
          !comSensores
            ? 'o pacote do agente desta loja ainda não lê as temperaturas'
            : resumo.esquentando
              ? 'passou do limite de temperatura no período'
              : `placa de vídeo até ${num(pico('gpuTempC'))} °C · placa-mãe até ${num(pico('tempPlacaMaeC'))} °C`
        }
      />
      <section className="flex min-w-0 flex-col gap-2 rounded-[26px] bg-farol-palco p-5 text-farol-palco-tinta" aria-labelledby="t-porque" data-porque>
        <h2 id="t-porque" className="font-display text-[19px] font-extrabold uppercase leading-tight tracking-[.04em]">
          Por quê
        </h2>
        {resumo.porque.length ? (
          <ul className="flex flex-col gap-1.5 font-semibold">
            {resumo.porque.map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden>▸</span>
                {p}
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-semibold">Tudo dentro do normal no período.</p>
        )}
        <p className="mt-auto font-mono text-[11.5px] leading-relaxed text-farol-palco-suave">
          limites: {limites.cpuPct}% (processador e memória) · {limites.gpuPct}% (placa) · {limites.gpuTempC} °C (placa) ·{' '}
          {limites.tempPlacaMaeC} °C (placa-mãe) · {limites.discoTempC} °C (disco)
        </p>
      </section>
    </div>
  );
}
