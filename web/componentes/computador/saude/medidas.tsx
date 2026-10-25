// As medidas do período, uma por cartão (A26, M2): a média e o pico, com a hora do pico no relógio da loja. As de
// sensor (temperaturas, consumo, disco, frequência real) só aparecem quando o pacote do agente as manda.

import type { HoraDaSaude, ResumoDaSaude } from '@/lib/saude';
import { num, quandoNaLoja, ultimoDosSensores } from '@/lib/saude';

type Cartao = { chave: string; nome: string; valor: string; unidade: string; linha: string; quente?: boolean };

function Medida({ c }: { c: Cartao }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[18px] border border-farol-borda/60 bg-farol-painel px-4 py-3.5 shadow-farol-1" data-medida={c.chave}>
      <span className="font-mono text-[11.5px] text-farol-suave">{c.nome}</span>
      <b className={`font-display text-[34px] font-black leading-none ${c.quente ? 'text-farol-critico' : ''}`}>
        {c.valor}
        <small className="ml-0.5 text-[18px]">{c.unidade}</small>
      </b>
      <span className="font-mono text-[11.5px] leading-snug">{c.linha}</span>
    </div>
  );
}

export function Medidas({ resumo, horas, fuso, comDia, limiteDaPlaca }: {
  resumo: ResumoDaSaude;
  horas: readonly HoraDaSaude[];
  fuso: string;
  /** Período de mais de um dia: o pico diz o dia. */
  comDia: boolean;
  limiteDaPlaca: number;
}) {
  const quando = (iso?: string | null) => (iso ? quandoNaLoja(iso, fuso, comDia) : '');
  const cartoes: Cartao[] = [];
  for (const [chave, nome] of [['cpu', 'Processador'], ['mem', 'Memória'], ['gpu', 'Placa de vídeo']] as const) {
    const r = resumo[chave];
    if (r.media == null && !r.pico) continue;
    cartoes.push({ chave, nome, valor: num(r.media), unidade: '%', linha: r.pico ? `pico ${num(r.pico.valor)}% ${quando(r.pico.quando)}` : 'sem pico' });
  }
  const s = (campo: string) => resumo.sensores[campo];
  const sensor = (campo: string, nome: string, unidade: string, casas = 0, extra?: (v: { media: number; pico: { valor: number; quando: string } | null }) => Partial<Cartao>) => {
    const v = s(campo);
    if (!v) return;
    cartoes.push({
      chave: campo, nome, valor: num(v.media, casas), unidade,
      linha: v.pico ? `pico ${num(v.pico.valor, casas)} ${unidade} ${quando(v.pico.quando)}` : '',
      ...(extra ? extra(v) : {}),
    });
  };
  sensor('gpuTempC', 'Temperatura da placa', '°C', 0, (v) => ({ quente: (v.pico?.valor ?? 0) >= limiteDaPlaca }));
  sensor('gpuPotenciaW', 'Consumo da placa', 'W');
  const memPlaca = s('gpuMemMb');
  if (memPlaca) {
    cartoes.push({
      chave: 'gpuMemMb', nome: 'Memória da placa', valor: num(memPlaca.media / 1024, 1), unidade: 'GB',
      linha: memPlaca.pico ? `pico ${num(memPlaca.pico.valor / 1024, 1)} GB ${quando(memPlaca.pico.quando)}` : '',
    });
  }
  sensor('tempPlacaMaeC', 'Placa-mãe', '°C');
  const discoTemp = s('discoTempC');
  const saude = ultimoDosSensores(horas, 'discoSaude');
  const horasLigado = ultimoDosSensores(horas, 'discoHorasLigado');
  if (discoTemp || saude) {
    const nomeDaSaude = saude === 'ok' ? 'saúde ok' : saude === 'atencao' ? 'pede atenção' : saude === 'ruim' ? 'com defeito' : 'saúde sem leitura';
    cartoes.push({
      chave: 'disco', nome: 'Disco (SSD)', valor: discoTemp ? num(discoTemp.media) : '—', unidade: discoTemp ? '°C' : '',
      linha: `${nomeDaSaude}${typeof horasLigado === 'number' ? ` · ${num(horasLigado)} h ligado` : ''}`, quente: saude === 'ruim' || saude === 'atencao',
    });
  }
  const livre = [...horas].reverse().find((h) => h.discoLivreGb != null);
  if (livre?.discoLivreGb != null) {
    cartoes.push({ chave: 'discoLivre', nome: 'Disco livre', valor: num(livre.discoLivreGb), unidade: 'GB', linha: livre.discoTotalGb ? `de ${num(livre.discoTotalGb)} GB` : '' });
  }
  sensor('cpuDesempenhoPct', 'Frequência real', '%', 0, () => ({ linha: 'acima de 100% = turbo; cai quando esquenta' }));

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3" data-medidas>
      {cartoes.map((c) => (
        <Medida key={c.chave} c={c} />
      ))}
    </div>
  );
}
