'use client';

// =====================================================================
// O computador da loja: quando ele dorme e acorda sozinho (A22, fatia P2)
// =====================================================================
// Do protótipo aprovado em 16/10/2026 (`mockups/farol-computador-da-loja.html`).
// Chega-se aqui pela aba "Horário" de Computador da loja (desde 25/10/2026
// a primeira aba é a Saúde — A26). O que mostra:
//
//   - como ele está agora: acordado, dormindo no horário, ou "não acordou";
//   - o horário da semana, desenhado (a conta é da API);
//   - os cuidados antes de programar.
//
// Ficam para a fatia P3 (o agente que sabe dormir): o teste "dormir 3
// minutos" e "o que aconteceu" (dormiu, acordou e em quanto tempo).
// =====================================================================

import { Moon, Pencil, Power, TriangleAlert } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { haQuanto, useConsole } from '@/componentes/console';
import { abasDoComputador } from '@/componentes/computador/abas-do-computador';
import { GavetaDoHorarioDoComputador } from '@/componentes/computador/gaveta-do-horario-do-computador';
import { SemanaDoComputador } from '@/componentes/computador/semana-do-computador';
import { Abas } from '@/componentes/ui/abas';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos } from '@/componentes/ui/pecas';
import { consoleApi, ErroDaApi, type TelaDoComputador } from '@/lib/api';

/** O dia (1 = segunda) e o minuto de agora no relógio da loja, para a marca na barra de hoje. */
function agoraNaLoja(fuso: string): { dia: number; minuto: number } | null {
  try {
    const partes = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date());
    const de = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
    const dia = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(de('weekday')) + 1;
    return dia > 0 ? { dia, minuto: Number(de('hour')) * 60 + Number(de('minute')) } : null;
  } catch {
    return null;
  }
}

export default function PaginaDoComputador() {
  const { id } = useParams<{ id: string }>();
  const { loja, atualizar } = useConsole();
  const avisar = useAvisar();
  const [tela, setTela] = useState<TelaDoComputador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [agora, setAgora] = useState<{ dia: number; minuto: number } | null>(null);

  const carregar = useCallback(() => {
    consoleApi
      .computador(id)
      .then((t) => {
        setTela(t);
        setErro(null);
      })
      .catch((e) => setErro(e instanceof ErroDaApi ? e.message : 'não deu para carregar o computador da loja'));
  }, [id]);

  useEffect(() => carregar(), [carregar]);
  // A marca de agora sai depois de montar (o relógio do navegador não entra no primeiro desenho).
  useEffect(() => {
    if (loja?.timezone) setAgora(agoraNaLoja(loja.timezone));
  }, [loja?.timezone]);

  if (erro) {
    return (
      <Alerta tom="critico" papel="alert">
        {erro}
      </Alerta>
    );
  }
  if (!tela) return <Ossos alturas={[64, 220, 160]} />;

  const h = tela.horario;
  const ligado = h?.ligado === true;
  const ag = tela.agente;
  const dormindo = ag?.dormindo === true;
  const naoAcordou = ag?.nao_acordou === true;
  const sabe = ag?.sabeDormir === true;
  const abrir = () => setEditando(true);

  const estado = dormindo
    ? { tom: 'neutro' as const, texto: `dormindo até ${ag?.acorda_as ?? '…'}, como programado` }
    : naoAcordou
      ? { tom: 'critico' as const, texto: `não acordou às ${ag?.acorda_as ?? '…'}` }
      : ag && ag.segundosSemBater !== null
        ? { tom: 'ok' as const, texto: `acordado · bateu ${haQuanto(ag.segundosSemBater)}` }
        : { tom: 'neutro' as const, texto: 'sem agente batendo' };

  return (
    <>
      <Cabecalho
        sobre={loja?.nome}
        titulo="Computador da loja"
        acoes={
          tela.configura && (
            <Botao variante="primario" onClick={abrir} data-editar-horario>
              {h ? <Pencil className="h-4 w-4" aria-hidden /> : <Power className="h-4 w-4" aria-hidden />}
              {h ? 'Editar o horário' : 'Programar o horário'}
            </Botao>
          )
        }
      >
        O computador que lê as câmeras desta loja. Aqui fica o horário em que ele dorme e acorda sozinho, fora do
        expediente.
      </Cabecalho>

      <Abas rotulo="Vistas do computador" abas={abasDoComputador(id)} />

      <div className="-mt-2 flex flex-wrap gap-2" data-estado-do-computador>
        <Chip tom={estado.tom} quebra>
          {estado.texto}
        </Chip>
        {ag?.versao && <Chip>agente {ag.versao}</Chip>}
        {ligado && <Chip>dorme e acorda sozinho</Chip>}
      </div>

      {dormindo && (
        <Alerta icone={Moon} papel="status">
          <b className="font-semibold">Dormindo até {ag?.acorda_as}, como programado.</b> A loja está fechada: nada é
          conferido até lá, e o Farol não avisa que o agente está sem sinal enquanto ele dorme no horário.
        </Alerta>
      )}
      {naoAcordou && (
        <Alerta tom="critico" icone={TriangleAlert} papel="alert">
          <b className="font-semibold">O computador não acordou às {ag?.acorda_as}.</b> Ele dormiu como programado e não
          voltou. Pode ter faltado energia enquanto ele dormia: aí ele só volta quando alguém apertar o botão de ligar. O
          aviso de agente sem sinal voltou a ser enviado.
        </Alerta>
      )}
      {h && !sabe && (
        <Alerta tom="atencao" papel="status">
          <b className="font-semibold">O computador da loja ainda não sabe dormir e acordar sozinho.</b> O horário fica
          guardado e vale quando o pacote novo for instalado nele. Até lá, ele fica ligado o tempo todo.
        </Alerta>
      )}

      <section className={`${CARTAO} flex flex-col gap-3.5 p-[18px]`} aria-labelledby="t-horario" data-cartao-do-horario>
        <header className="flex flex-wrap items-center gap-2">
          <h2 id="t-horario" className="font-display text-lg font-semibold">
            O horário
          </h2>
          {ligado && <span className="ml-auto"><Chip>no relógio da loja</Chip></span>}
        </header>
        {!ligado ? (
          <div className="flex flex-col items-center gap-2.5 py-6 text-center" data-sem-horario>
            <Power className="h-7 w-7 text-farol-suave" aria-hidden />
            <h3 className="font-display text-base font-semibold">Sem horário: o computador fica ligado o tempo todo</h3>
            <p className="max-w-[56ch] text-farol-suave">
              Fora do expediente ele pode dormir: gasta menos energia, esquenta menos e acorda sozinho antes de a loja
              abrir.
            </p>
            {tela.configura ? (
              <Botao variante="primario" onClick={abrir}>
                <Power className="h-4 w-4" aria-hidden />
                Programar o horário
              </Botao>
            ) : (
              <p className="text-[12.5px] text-farol-suave">Quem configura a loja programa o horário.</p>
            )}
          </div>
        ) : (
          <>
            <SemanaDoComputador semana={tela.semana} dias={h?.dias ?? null} agora={agora} />
            <p className="text-[12.5px] text-farol-suave">
              Ele não desliga de vez: entra em espera e acorda sozinho no horário. A loja aberta (a faixa de cima) é a do
              horário de funcionamento, em Critérios.
            </p>
          </>
        )}
      </section>

      <section className={`${CARTAO} flex flex-col gap-2.5 p-[18px]`} aria-labelledby="t-cuidados">
        <h2 id="t-cuidados" className="font-display text-lg font-semibold">
          Antes de programar
        </h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] text-farol-suave marker:text-farol-borda-forte">
          <li>
            <b className="font-semibold text-farol-tinta">Ele não desliga de vez:</b> entra em espera. Se a energia cair
            enquanto ele dorme, ele só volta quando alguém apertar o botão de ligar.
          </li>
          <li>
            <b className="font-semibold text-farol-tinta">Outro sistema no mesmo computador dorme junto.</b> Se ele também
            atende o servidor do Regem ou o caixa, programe só fora do expediente.
          </li>
          <li>
            <b className="font-semibold text-farol-tinta">Depois de acordar, o agente leva um pouco para voltar a conferir:</b>{' '}
            acorde antes de abrir. “Sugerir pelo horário da loja” deixa 1 hora de folga.
          </li>
          <li>
            <b className="font-semibold text-farol-tinta">Enquanto ele dorme no horário,</b> o console mostra “dormindo” e o
            Farol não manda o aviso de agente sem sinal. Se ele não acordar, o aviso volta.
          </li>
        </ul>
      </section>

      {editando && (
        <GavetaDoHorarioDoComputador
          lojaId={id}
          tela={tela}
          aoFechar={() => setEditando(false)}
          aoSalvar={(nova, mensagem) => {
            setTela(nova);
            setEditando(false);
            avisar(mensagem);
            atualizar();
          }}
        />
      )}
    </>
  );
}
