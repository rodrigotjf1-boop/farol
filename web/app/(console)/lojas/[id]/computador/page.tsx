'use client';

// =====================================================================
// O computador da loja: a SAÚDE (A26, parte M2)
// =====================================================================
// Do protótipo aprovado em 25/10/2026 (`mockups/farol-planta-viva-e-saude.html`,
// "Computador › Saúde"). O pedido do dono: o uso do processador, da memória e
// da placa por hora, os picos, as temperaturas, e se o computador está
// sobrecarregado ou esquentando. A conta é da API
// (`GET /v1/lojas/:id/computador/saude`); aqui, o desenho — no relógio da loja.
//
//   - "Sobrecarregado?", "Esquentando?" e "Por quê";
//   - as medidas do período (média e pico, com a hora do pico);
//   - o gráfico hora a hora (num dia) ou dia a dia (7 e 31 dias), que abre a
//     gaveta com o pico de cada minuto;
//   - as quedas do computador.
//
// A segunda aba é o Horário (A22), em `/computador/horario`.
// =====================================================================

import { Activity } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { abasDoComputador } from '@/componentes/computador/abas-do-computador';
import { GavetaDaBarra } from '@/componentes/computador/saude/gaveta-da-barra';
import { GraficoDasHoras } from '@/componentes/computador/saude/grafico-das-horas';
import { Medidas } from '@/componentes/computador/saude/medidas';
import { Quedas } from '@/componentes/computador/saude/quedas';
import { Vereditos } from '@/componentes/computador/saude/vereditos';
import { useConsole } from '@/componentes/console';
import { Abas } from '@/componentes/ui/abas';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Segmentado, Titulo, Vazio } from '@/componentes/ui/pecas';
import { consoleApi, ErroDaApi, type DiaDesenhado } from '@/lib/api';
import { barras, MEDIDAS, num, temSensores, type Barra, type Medida, type SaudeDaMaquina } from '@/lib/saude';

type Periodo = '1' | '7' | '31';
const PERIODOS: ReadonlyArray<{ valor: Periodo; rotulo: string }> = [
  { valor: '1', rotulo: 'Últimas 24 h' },
  { valor: '7', rotulo: '7 dias' },
  { valor: '31', rotulo: '31 dias' },
];

export default function SaudeDoComputador() {
  const { id } = useParams<{ id: string }>();
  const { loja } = useConsole();
  const [periodo, setPeriodo] = useState<Periodo>('1');
  const [dados, setDados] = useState<SaudeDaMaquina | null>(null);
  const [semana, setSemana] = useState<DiaDesenhado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [medida, setMedida] = useState<Medida>('cpu');
  const [escolhida, setEscolhida] = useState<Barra | null>(null);
  // Só a resposta do pedido mais novo vale: trocar de período rápido não deixa a de antes por cima.
  const pedido = useRef(0);

  const carregar = useCallback(() => {
    const meu = ++pedido.current;
    setErro(null);
    consoleApi
      .saudeDoComputador(id, Number(periodo))
      .then((d) => {
        if (meu === pedido.current) setDados(d);
      })
      .catch((e) => {
        if (meu === pedido.current) setErro(e instanceof ErroDaApi ? e.message : 'não deu para carregar a saúde do computador');
      });
  }, [id, periodo]);
  useEffect(() => carregar(), [carregar]);
  // A loja aberta (para pintar as barras) vem do horário do computador; sem ele, as barras ficam todas iguais.
  useEffect(() => {
    consoleApi.computador(id).then((t) => setSemana(t.semana)).catch(() => setSemana(null));
  }, [id]);

  const comSensores = useMemo(() => (dados ? temSensores(dados.horas) : false), [dados]);
  const opcoes = useMemo(
    () => (Object.entries(MEDIDAS) as Array<[Medida, (typeof MEDIDAS)[Medida]]>)
      .filter(([, m]) => comSensores || !m.sensor)
      .map(([valor, m]) => ({ valor, rotulo: m.nome })),
    [comSensores],
  );
  const medidaVale = opcoes.some((o) => o.valor === medida) ? medida : 'cpu';
  const porDia = periodo !== '1';
  const lista = useMemo(() => (dados ? barras(dados.horas, medidaVale, dados.fuso, porDia, semana) : []), [dados, medidaVale, porDia, semana]);

  const cabecalho = (
    <>
      <Cabecalho sobre={loja?.nome} titulo="Saúde do computador">
        Por hora: o uso do processador, da memória e da placa, as temperaturas e o pico de cada minuto. Para saber se o
        computador que lê as câmeras está sobrecarregado ou esquentando.
      </Cabecalho>
      <Abas rotulo="Vistas do computador" abas={abasDoComputador(id)} />
    </>
  );

  if (erro) {
    return (
      <>
        {cabecalho}
        <Alerta tom="critico" papel="alert">{erro}</Alerta>
      </>
    );
  }
  if (!dados) {
    return (
      <>
        {cabecalho}
        <Ossos alturas={[[180, 180, 180], 110, 300]} />
      </>
    );
  }

  const m = dados.maquina;
  const resumo = dados.periodo;
  const med = MEDIDAS[medidaVale];
  const limite = med.limite(dados.limites);
  return (
    <>
      {cabecalho}

      <div className="flex flex-wrap items-center gap-2" data-maquina>
        {m?.processador && <Chip>{m.processador.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').replace(/\s+/g, ' ').trim()}</Chip>}
        {m?.placaDeVideo && <Chip>{m.placaDeVideo}</Chip>}
        {m?.memoriaGb && <Chip>{num(m.memoriaGb)} GB de memória</Chip>}
        {resumo.ligadoHaH != null && <Chip tom="ok">ligado há {num(resumo.ligadoHaH, 1)} h</Chip>}
        <span className="ml-auto">
          <Segmentado rotulo="Período" opcoes={PERIODOS} valor={periodo} aoMudar={(p) => { setPeriodo(p); setEscolhida(null); }} />
        </span>
      </div>

      {dados.horas.length === 0 ? (
        <Vazio icone={Activity} titulo="Ainda sem medidas">
          O agente manda as medidas do computador a cada poucos minutos. A primeira hora aparece aqui logo depois que ele
          enviar.
        </Vazio>
      ) : (
        <>
          {!comSensores && (
            <Alerta papel="status">
              <b className="font-semibold">O pacote do agente desta loja ainda não lê as temperaturas.</b> Aqui aparecem o
              processador, a memória e a placa; com o pacote novo entram as temperaturas, o consumo da placa, o disco e as
              quedas.
            </Alerta>
          )}

          <Vereditos resumo={resumo} limites={dados.limites} comSensores={comSensores} />
          <Medidas resumo={resumo} horas={dados.horas} fuso={dados.fuso} comDia={porDia} limiteDaPlaca={dados.limites.gpuTempC} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className={`${CARTAO} flex flex-col gap-3 p-[18px]`} aria-labelledby="t-grafico">
              <Titulo id="t-grafico">{med.nome}, {porDia ? 'dia a dia' : 'hora a hora'}</Titulo>
              <Segmentado rotulo="O que mostrar" opcoes={opcoes} valor={medidaVale} aoMudar={(v) => { setMedida(v); setEscolhida(null); }} />
              <GraficoDasHoras barras={lista} limite={limite} unidade={med.unidade} nome={med.nome} aoEscolher={setEscolhida} />
              <p className="text-[12.5px] text-farol-suave">
                A barra é a média {porDia ? 'do dia' : 'da hora'}; o traço em cima, o pico. A linha tracejada é o limite (
                {limite}
                {med.unidade}). Toque numa barra para ver {porDia ? 'as horas do dia' : 'o pico de cada minuto'}.
              </p>
            </section>
            <Quedas quedas={dados.quedas} fuso={dados.fuso} comSensores={comSensores} />
          </div>
        </>
      )}

      {escolhida && (
        <GavetaDaBarra
          barra={escolhida}
          horas={dados.horas}
          medida={medidaVale}
          nome={med.nome}
          unidade={med.unidade}
          limite={limite}
          fuso={dados.fuso}
          porDia={porDia}
          aoFechar={() => setEscolhida(null)}
        />
      )}
    </>
  );
}
