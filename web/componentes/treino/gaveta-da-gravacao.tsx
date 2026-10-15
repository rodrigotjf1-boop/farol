'use client';

// =====================================================================
// Nova gravação de treino: um horário de movimento, para ler e conferir
// =====================================================================
// A21, fatia T3. Do protótipo aprovado pelo dono em 15/10/2026
// (`mockups/farol-conexoes-e-fichas.html`, "Nova gravação de treino"):
//
//   • a bancada (as câmeras do gravador desta loja);
//   • de onde: do que o gravador já guardou (um horário das últimas ~18
//     horas) ou programar (um horário que ainda vai acontecer);
//   • o dia e os dois horários, sempre no RELÓGIO DA LOJA — a data vai à
//     API com o fuso da loja escrito, e não o do aparelho de quem cria;
//   • de 15 minutos a 1 hora. A API confere as mesmas regras; a tela só
//     diz antes.
//
// Quem cria é quem configura a loja (decisão 3): a tela nem mostra o botão
// para os outros, e a API recusa.
// =====================================================================

import { Info, TriangleAlert } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { frase } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, treinoApi, type RegrasDaGravacao, type TreinoDaLoja } from '@/lib/api';

type DeOnde = 'gravador' | 'programada';

/** O dia no relógio da loja, "AAAA-MM-DD". */
export function diaNaLoja(quando: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(quando);
}

/** "AAAA-MM-DD" + "HH:MM" no relógio da loja → data e hora com o fuso da loja escrito ("…T19:30:00-03:00"). */
export function isoNaLoja(dia: string, hora: string, fuso: string): string {
  // a diferença do fuso naquele dia (o horário de verão muda a conta): pelo próprio relógio do navegador
  const perto = new Date(`${dia}T${hora}:00Z`);
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: fuso, timeZoneName: 'longOffset' }).formatToParts(perto).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(nome);
  return `${dia}T${hora}:00${m ? `${m[1]}:${m[2] ?? '00'}` : '+00:00'}`;
}

/** As regras da API, ditas antes de mandar. Vazio = pode criar. */
function conferir(de: DeOnde, dia: string, das: string, as: string, fuso: string, regras: RegrasDaGravacao): string {
  if (!dia || !das || !as) return 'Preencha o dia e os dois horários.';
  const inicio = Date.parse(isoNaLoja(dia, das, fuso));
  const fim = Date.parse(isoNaLoja(dia, as, fuso));
  const agora = Date.now();
  const minutos = (fim - inicio) / 60_000;
  if (!(minutos > 0)) return 'O fim precisa ser depois do começo.';
  if (minutos < regras.minimoMin || minutos > regras.maximoMin) return 'Uma gravação de treino vai de 15 minutos a 1 hora.';
  if (de === 'gravador') {
    if (fim > agora) return 'Este horário ainda não terminou: escolha “Programar”.';
    if (agora - inicio > regras.gravadorGuardaH * 3600_000) return `O gravador não guarda mais este horário: ele guarda cerca de ${regras.gravadorGuardaH} horas.`;
  } else {
    if (inicio < agora) return 'Este horário já começou: escolha “Do que o gravador já guardou”.';
    if (inicio - agora > regras.programarAteDias * 86_400_000) return `Programe com até ${regras.programarAteDias} dias de antecedência.`;
  }
  return '';
}

const canalFalado = (c: TreinoDaLoja['canais'][number]) => (c.numero !== null ? `${c.nome} · canal ${c.numero}` : c.nome);

export function GavetaDaGravacao({
  lojaId,
  fuso,
  canais,
  regras,
  lojaSabeGravar,
  aoCriar,
  aoFechar,
}: {
  lojaId: string;
  fuso: string;
  canais: TreinoDaLoja['canais'];
  regras: RegrasDaGravacao;
  lojaSabeGravar: boolean;
  aoCriar: (texto: string) => void;
  aoFechar: () => void;
}) {
  const p = useId();
  // o padrão do protótipo: ontem, 19:30 às 20:00, do que o gravador já guardou
  const ontem = useMemo(() => diaNaLoja(new Date(Date.now() - 86_400_000), fuso), [fuso]);
  const [pontoId, setPontoId] = useState(canais[0]?.id ?? '');
  const [de, setDe] = useState<DeOnde>('gravador');
  const [dia, setDia] = useState(ontem);
  const [das, setDas] = useState('19:30');
  const [as, setAs] = useState('20:00');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    const problema = conferir(de, dia, das, as, fuso, regras);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      await treinoApi.criarGravacao(lojaId, { pontoId, de, inicio: isoNaLoja(dia, das, fuso), fim: isoNaLoja(dia, as, fuso) });
      aoCriar(
        de === 'gravador'
          ? 'Gravação criada: o computador da loja busca o trecho no gravador e lê quando chegar a vez dela.'
          : 'Gravação programada: depois do horário, o computador da loja busca o trecho no gravador e lê.',
      );
    } catch (e) {
      setErro(frase(e instanceof ErroDaApi ? e.message : 'não consegui criar a gravação'));
      setOcupado(false);
    }
  }

  return (
    <Gaveta
      titulo="Nova gravação de treino"
      descricao="Um horário de movimento, para o Farol ler e você conferir."
      ocupado={ocupado}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => void criar()} ocupado={ocupado} disabled={!pontoId}>
            Criar gravação
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-nova-gravacao>
        {!lojaSabeGravar && (
          <Alerta tom="atencao" icone={Info} papel="status">
            <b className="font-semibold">O computador da loja ainda não sabe gravar o treino.</b> A gravação espera na fila e começa quando o
            pacote novo for instalado nele.
            {de === 'gravador' && ` O gravador guarda cerca de ${regras.gravadorGuardaH} horas: se o pacote não chegar antes, esse horário se perde.`}
          </Alerta>
        )}

        <div className="flex flex-col gap-[5px]">
          <label htmlFor={`${p}-bancada`} className={ROTULO}>
            Bancada
          </label>
          <select id={`${p}-bancada`} className="entrada" value={pontoId} onChange={(e) => setPontoId(e.target.value)}>
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {canalFalado(c)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-[5px]">
          <span id={`${p}-de`} className={ROTULO}>
            De onde
          </span>
          <div role="radiogroup" aria-labelledby={`${p}-de`} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Escolha marcada={de === 'gravador'} aoMarcar={() => setDe('gravador')} titulo="Do que o gravador já guardou" sobre={`um horário das últimas ${regras.gravadorGuardaH} horas`} />
            <Escolha marcada={de === 'programada'} aoMarcar={() => setDe('programada')} titulo="Programar" sobre="um horário que ainda vai acontecer" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-[5px]">
            <label htmlFor={`${p}-dia`} className={ROTULO}>
              Dia
            </label>
            <input id={`${p}-dia`} type="date" className="entrada" value={dia} onChange={(e) => setDia(e.target.value)} aria-describedby={erro ? `${p}-erro` : undefined} />
          </div>
          <div className="flex min-w-0 flex-col gap-[5px]">
            <label htmlFor={`${p}-das`} className={ROTULO}>
              Das
            </label>
            <input id={`${p}-das`} type="time" className="entrada font-mono" value={das} onChange={(e) => setDas(e.target.value)} />
          </div>
          <div className="flex min-w-0 flex-col gap-[5px]">
            <label htmlFor={`${p}-as`} className={ROTULO}>
              Às
            </label>
            <input id={`${p}-as`} type="time" className="entrada font-mono" value={as} onChange={(e) => setAs(e.target.value)} />
          </div>
        </div>
        {erro && (
          <Alerta tom="critico" icone={TriangleAlert} papel="alert">
            <span id={`${p}-erro`} data-erro-da-gravacao>
              {erro}
            </span>
          </Alerta>
        )}

        <div className="rounded-[10px] border border-farol-borda bg-farol-painel-2 px-3.5 py-3 text-[13px]">
          <b className="font-semibold">Para o Farol aprender mais por minuto gravado</b>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-farol-suave">
            <li>Um horário de movimento: mais lanches, mais exemplos.</li>
            <li>De {regras.minimoMin} minutos a 1 hora por gravação.</li>
            <li>Com a luz de sempre da bancada.</li>
          </ul>
        </div>
        <p className={AJUDA}>
          A leitura roda no computador da loja, devagar, para não atrapalhar o expediente. O quanto o gravador guarda é medido nele; o desta loja
          guarda cerca de {regras.gravadorGuardaH} horas. A hora é a da loja.
        </p>
      </div>
    </Gaveta>
  );
}

function Escolha({ marcada, aoMarcar, titulo, sobre }: { marcada: boolean; aoMarcar: () => void; titulo: string; sobre: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={aoMarcar}
      className={`flex min-w-0 flex-col gap-0.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
        marcada ? 'border-farol-facho bg-farol-facho-leve' : 'border-farol-borda-forte bg-farol-painel-2 hover:border-farol-suave'
      }`}
    >
      <span className="break-words font-semibold">{titulo}</span>
      <small className="text-xs text-farol-suave">{sobre}</small>
    </button>
  );
}
