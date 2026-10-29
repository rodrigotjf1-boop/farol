'use client';

// =====================================================================
// Planta › Atendimento (28/10/2026)
// =====================================================================
// Pedido do dono: "faça a integração com o balcão, e o atendimento delivery
// e saída dos entregadores" — as pessoas no mapa E os números. Do protótipo
// aprovado em 29/10/2026 (`mockups/farol-planta-atendimento.html`).
//
// As ÁREAS DE MEDIDA se marcam no Desenho (espera ou porta). Aqui: em cada
// área de espera, a espera do meio, quantas pessoas, a maior e hora a hora;
// em cada porta, quem saiu (e a hora), quem entrou e o tempo na loja; a
// linha do tempo do expediente; e onde ficam as áreas. A conta é da API
// (`GET /v1/lojas/:id/planta-viva/atendimento`), pelos caminhos que o agente
// manda — agregado, para quem acompanha a loja. O período vai até 7 dias
// (é o que o caminho de cada um fica guardado).
// =====================================================================

import { Timer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { CartaoDaPorta, CartaoDeEspera, LinhaDoTempo } from '@/componentes/planta-viva/atendimento';
import { abasDaPlanta } from '@/componentes/planta-viva/abas-da-planta';
import { PlantaDeCima } from '@/componentes/planta-viva/planta-de-cima';
import { usePlantaViva } from '@/componentes/planta-viva/use-planta-viva';
import { abasDeCanais } from '@/componentes/pontos/abas-de-canais';
import { Abas } from '@/componentes/ui/abas';
import { classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Segmentado, Titulo, Vazio } from '@/componentes/ui/pecas';
import { ErroDaApi, plantaVivaApi } from '@/lib/api';
import { areasDe } from '@/lib/planta';
import { camerasQueVeem, expedientes, type AtendimentoDaPlanta } from '@/lib/planta-viva';

type Periodo = 'hora' | 'este' | 'anterior' | '7d';
const PERIODOS: ReadonlyArray<{ valor: Periodo; rotulo: string }> = [
  { valor: 'hora', rotulo: 'Última hora' },
  { valor: 'este', rotulo: 'Este expediente' },
  { valor: 'anterior', rotulo: 'Expediente anterior' },
  { valor: '7d', rotulo: 'Últimos 7 dias' },
];
/** O que está acontecendo agora se lê de novo a cada minuto; o que já passou, não muda. */
const RELER_A_CADA_MS = 60_000;

export default function AtendimentoNaPlanta() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura } = useConsole();
  const fuso = loja?.timezone ?? 'America/Sao_Paulo';
  const horario = loja?.horario_funcionamento;
  const { dados, erro: erroDaPlanta, nomeDaCamera, corDe } = usePlantaViva(id);
  const [periodo, setPeriodo] = useState<Periodo>('este');
  // a leitura guarda de que período ela é: trocou o período, a de antes não aparece com o rótulo novo
  const [leitura, setLeitura] = useState<{ periodo: Periodo; de: number; ate: number; r: AtendimentoDaPlanta } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const pedido = useRef(0);

  const intervalo = useCallback((): [number, number] => {
    const agora = Date.now();
    if (periodo === 'hora') return [agora - 3_600_000, agora];
    if (periodo === '7d') return [agora - 7 * 86_400_000 + 60_000, agora];
    const e = expedientes(horario ?? [], fuso, agora);
    return periodo === 'este' ? e.este : e.anterior;
  }, [periodo, horario, fuso]);

  const carregar = useCallback(
    (limpar: boolean) => {
      const meu = ++pedido.current;
      const [de, ate] = intervalo();
      if (limpar) setLeitura(null);
      plantaVivaApi
        .atendimento(id, new Date(de).toISOString(), new Date(ate).toISOString())
        .then((r) => {
          if (meu !== pedido.current) return;
          setLeitura({ periodo, de, ate, r });
          setErro(null);
          setSemAcesso(false);
        })
        .catch((e) => {
          if (meu !== pedido.current) return;
          if (e instanceof ErroDaApi && e.status === 403) setSemAcesso(true);
          else setErro(e instanceof ErroDaApi ? e.message : 'não consegui ler o atendimento');
        });
    },
    [id, intervalo, periodo],
  );
  useEffect(() => carregar(true), [carregar]);
  useEffect(() => {
    if (periodo !== 'hora' && periodo !== 'este') return;
    const vez = setInterval(() => carregar(false), RELER_A_CADA_MS);
    return () => clearInterval(vez);
  }, [periodo, carregar]);

  // o chão que cada câmera calibrada cobre: a área que nenhuma vê fica sem números
  const chaos = useMemo(() => [...(dados?.calibracoes.values() ?? [])].map((c) => c.area), [dados]);

  const cabecalho = (
    <>
      <Cabecalho sobre={loja?.nome} titulo="Planta viva">
        Cada câmera no mapa pelos pontos marcados no chão: o que ela cobre de verdade, e as pessoas no mapa — sem nome e sem
        rosto.
      </Cabecalho>
      <Abas rotulo="Vistas dos canais" abas={abasDeCanais(id)} />
      <Abas rotulo="Vistas da planta" abas={abasDaPlanta(id)} />
    </>
  );
  if (semAcesso) return (<>{cabecalho}<Alerta papel="status">O atendimento na planta é de quem acompanha a loja (supervisão para cima).</Alerta></>);
  if (erroDaPlanta || erro) return (<>{cabecalho}<Alerta tom="critico" papel="alert">{erroDaPlanta ?? erro}</Alerta></>);
  if (!dados) return (<>{cabecalho}<Ossos alturas={[[300, 300, 300]]} /></>);
  const planta = dados.planta;
  const areas = planta ? areasDe(planta) : [];
  if (!planta || areas.length === 0) {
    return (
      <>
        {cabecalho}
        <Vazio
          icone={Timer}
          titulo="Nenhuma área marcada na planta"
          acao={configura ? <Link href={`/lojas/${id}/canais/planta`} className={classesDoBotao({ variante: 'primario' })}>Marcar áreas no Desenho</Link> : undefined}
        >
          Marque no Desenho onde as pessoas esperam (a fila do balcão, a retirada, a espera dos entregadores) e por onde elas
          entram e saem (a porta). Daí em diante o Farol conta o tempo de cada espera e cada saída, sem nome e sem rosto.
        </Vazio>
      </>
    );
  }

  const r = leitura?.periodo === periodo ? leitura.r : undefined;
  const naLinhaDoTempo = periodo === 'este' || periodo === 'anterior';
  return (
    <>
      {cabecalho}
      <div className="flex flex-wrap items-center gap-2">
        <Segmentado rotulo="Período" opcoes={PERIODOS.map(({ valor, rotulo }) => ({ valor, rotulo }))} valor={periodo} aoMudar={setPeriodo} />
        <Chip quebra>sem nome · sem rosto · conta pelo caminho de cada um (guardado por 7 dias)</Chip>
      </div>

      {!r || !leitura ? (
        <Ossos alturas={[[300, 300, 300]]} />
      ) : (
        <>
          {r.minutos === 0 && (
            <Alerta papel="status">
              Nenhum minuto chegou do computador da loja neste período. A planta viva mede só com a loja aberta e com as câmeras
              calibradas.
            </Alerta>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-cartoes data-periodo={periodo}>
            {r.areas.map((a) => {
              const def = areas.find((x) => x.id === a.id);
              const cameras = def ? camerasQueVeem(def, chaos) : 0;
              return a.tipo === 'porta'
                ? <CartaoDaPorta key={a.id} area={a} fuso={fuso} cameras={cameras} />
                : <CartaoDeEspera key={a.id} area={a} fuso={fuso} cameras={cameras} />;
            })}
          </div>

          <section className={`${CARTAO} flex flex-col gap-3 p-[14px] md:p-[18px]`} aria-labelledby="t-linha" data-linha-do-tempo>
            <Titulo id="t-linha">O expediente, área por área</Titulo>
            {naLinhaDoTempo ? (
              <>
                <LinhaDoTempo areas={r.areas} de={leitura.de} ate={leitura.ate} fuso={fuso} />
                <p className="text-[12.5px] text-farol-suave">
                  Cada barra é uma pessoa numa área de espera, do começo ao fim da espera (a vermelha passou de 5 min). Na porta, ▽ é
                  alguém entrando e ▲ saindo.
                </p>
              </>
            ) : (
              <p className="text-[13.5px] text-farol-suave">A linha do tempo mostra um expediente de cada vez: escolha “Este expediente” ou “Expediente anterior”.</p>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <section className={`${CARTAO} flex min-w-0 flex-col gap-3 p-[14px] md:p-[18px]`} aria-labelledby="t-onde" data-onde>
              <Titulo id="t-onde">Onde ficam as áreas</Titulo>
              <PlantaDeCima
                planta={planta}
                descricao={`A planta com ${areas.length} área(s) de medida: ${areas.map((a) => a.nome).join(', ')}`}
                nomeDaCamera={nomeDaCamera}
                corDe={corDe}
                fundo={({ p, escala }) => (
                  <g>
                    {areas.map((a) => {
                      const [x, y] = p(a.x, a.y);
                      const [cx, cy] = p(a.x + a.w / 2, a.y + a.h / 2);
                      return (
                        <g key={a.id}>
                          <rect className={`pl-area ${a.tipo}`} x={x} y={y} width={a.w * escala} height={a.h * escala} rx={3} />
                          <text className={`pl-area-nome ${a.tipo}`} x={cx} y={cy + 4}>
                            {a.nome.length * 6.4 <= a.w * escala - 6 ? a.nome : a.tipo === 'porta' ? 'Porta' : 'Espera'}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}
              />
              <p className="text-[12.5px] text-farol-suave">
                As áreas se marcam no Desenho (Editar planta › Área de medida). Para medir, a área precisa estar no chão que uma
                câmera calibrada cobre.
              </p>
            </section>
            <section className={`${CARTAO} flex min-w-0 flex-col gap-3 p-[18px]`} aria-labelledby="t-como" data-como>
              <Titulo id="t-como">Como conta</Titulo>
              <ul className="flex flex-col gap-2.5 text-[14px]">
                <li><b className="font-semibold">Área de espera:</b> o tempo de cada pessoa, de quando entra na área até quando sai. Quem fica menos de 5 s só passou e não conta.</li>
                <li><b className="font-semibold">Porta:</b> o caminho que <b className="font-semibold">termina</b> na porta é alguém saindo; o que <b className="font-semibold">começa</b> nela, alguém entrando — com a hora de cada um.</li>
                <li><b className="font-semibold">Tempo na loja:</b> da entrada à saída pela mesma porta, quando as câmeras seguem a pessoa o caminho inteiro (quem some das câmeras no meio não entra nessa conta).</li>
                <li>Sem nome e sem rosto: cada pessoa é um caminho do dia. A espera é de quem estava na área — cliente, entregador ou equipe —, conforme onde a área foi marcada.</li>
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}
