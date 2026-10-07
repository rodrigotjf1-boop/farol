'use client';

// =====================================================================
// Orçamento por uso
// =====================================================================
// Pedido do dono (07/10/2026): classificar cada canal pela importância e
// pela quantidade de usos de análise, e montar o orçamento de acordo com
// o uso de cada um, com o equipamento em básico, intermediário e avançado.
//
// A tela responde, nesta ordem:
//
//   1 · Quanto cada canal é usado, e o que ele precisa enxergar?
//   2 · A câmera que está lá serve?
//   3 · Quais equipamentos servem — e quanto custa cada caminho?
//
// O que aparece aqui são SOLUÇÕES. O catálogo de equipamentos é do
// Monitor Farol e não vem para o navegador: a API devolve só marca,
// modelo, nível, a razão do nível e a faixa de preço do que serve.
// =====================================================================

import { Calculator, Cpu, HardDrive, Plus, Store, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { numero, plural } from '@/componentes/formatos';
import { CanalNoOrcamentoCartao } from '@/componentes/orcamento/canal-no-orcamento';
import { CartaoDaOpcao } from '@/componentes/orcamento/opcao';
import { CartaoDoPacote } from '@/componentes/orcamento/pacote';
import { NOME_DA_IMPORTANCIA, NOME_DO_NIVEL } from '@/componentes/orcamento/rotulos';
import { useAvisar } from '@/componentes/ui/avisos';
import { classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, CARTAO, Ossos, Titulo, Vazio } from '@/componentes/ui/pecas';
import { consoleApi, ErroDaApi, type CanalNoOrcamento, type Importancia, type Opcao, type Orcamento } from '@/lib/api';

function Resumo({ rotulo, valor, sufixo, pe }: { rotulo: string; valor: string; sufixo?: string; pe: string }) {
  return (
    <article className={`${CARTAO} flex flex-col gap-0.5 px-4 py-3.5`}>
      <span className="text-[12.5px] text-farol-suave">{rotulo}</span>
      <span className="font-display text-[26px] font-semibold leading-tight tracking-tight tabular-nums md:text-[30px]">
        {valor}
        {sufixo && <small className="font-sans text-sm font-medium tracking-normal text-farol-suave"> {sufixo}</small>}
      </span>
      <span className="text-xs text-farol-suave">{pe}</span>
    </article>
  );
}

function Infra({
  icone: Icone,
  titulo,
  motivo,
  opcoes,
}: {
  icone: typeof Cpu;
  titulo: string;
  motivo: string;
  opcoes: Opcao[];
}) {
  return (
    <article className={`${CARTAO} flex flex-col gap-3.5 p-4`}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-farol-realce text-farol-marca">
          <Icone className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <h3 className="text-[15px] font-semibold">{titulo}</h3>
      </div>
      <p className="text-farol-suave">{motivo}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-2.5">
        {opcoes.map((o) => (
          <CartaoDaOpcao key={`${o.fabricante}-${o.modelo}`} opcao={o} />
        ))}
      </div>
    </article>
  );
}

export default function OrcamentoDaLoja() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura } = useConsole();
  const avisar = useAvisar();
  const [orcamento, setOrcamento] = useState<Orcamento | null>(null);
  const [erro, setErro] = useState<{ texto: string; semPermissao: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setOrcamento(await consoleApi.orcamento(id));
      setErro(null);
    } catch (e) {
      setErro({
        texto: e instanceof ErroDaApi ? e.message : 'não deu certo',
        semPermissao: e instanceof ErroDaApi && e.status === 403,
      });
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function mudarImportancia(canal: CanalNoOrcamento, importancia: Importancia) {
    setSalvando(true);
    try {
      await consoleApi.editarPonto(canal.id, { importancia });
      await carregar();
      avisar(`“${canal.nome}” agora é de importância ${NOME_DA_IMPORTANCIA[importancia]}.`);
    } catch (e) {
      setErro({ texto: e instanceof ErroDaApi ? e.message : 'não deu certo', semPermissao: false });
    } finally {
      setSalvando(false);
    }
  }

  const r = orcamento?.resumo;
  const nomeDaLoja = loja?.nome ?? orcamento?.loja.nome ?? 'Loja';

  const cabecalho = (
    <Cabecalho
      sobre={
        <>
          <Store className="h-[15px] w-[15px]" aria-hidden />
          {nomeDaLoja}
        </>
      }
      titulo="Orçamento por uso"
    >
      Cada canal é classificado pelo quanto é usado e pelo que precisa enxergar. A partir disso, o que serve em cada
      nível e três caminhos somados.
    </Cabecalho>
  );

  if (erro?.semPermissao) {
    return (
      <>
        {cabecalho}
        <Vazio icone={Calculator} titulo="O orçamento fica com quem decide a compra">
          Esta tela é vista pela gerência, pela diretoria e pelo suporte.
        </Vazio>
      </>
    );
  }

  return (
    <>
      {cabecalho}

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro.texto}
        </Alerta>
      )}

      {!orcamento && !erro && <Ossos alturas={[[96, 96, 96, 96], 240]} />}

      {orcamento && r && (
        <>
          {orcamento.avisos.length > 0 && (
            <Alerta tom="atencao" icone={TriangleAlert}>
              <ul className="flex flex-col gap-1">
                {orcamento.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Alerta>
          )}

          {orcamento.canais.length === 0 ? (
            <Vazio
              icone={Calculator}
              titulo="Ainda não há o que orçar"
              acao={
                <Link href={`/lojas/${id}/canais`} className={classesDoBotao({ variante: 'primario' })}>
                  <Plus className="h-[18px] w-[18px]" aria-hidden />
                  Cadastrar um canal
                </Link>
              }
            >
              O orçamento sai dos canais e dos critérios da loja. Cadastre um canal e diga o que ele precisa
              conferir.
            </Vazio>
          ) : (
            <>
              {/* ───────────── o resumo ───────────── */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Resumo
                  rotulo="Canais em uso"
                  valor={numero(r.emUso)}
                  sufixo={`de ${numero(r.canais)}`}
                  pe={`${numero(r.porCarga.sem_uso)} sem critério`}
                />
                <Resumo
                  rotulo="Por quantidade de uso"
                  valor={numero(r.porCarga.intensa)}
                  sufixo={r.porCarga.intensa === 1 ? 'intenso' : 'intensos'}
                  pe={`${plural(r.porCarga.moderada, 'moderado', 'moderados')} · ${plural(r.porCarga.leve, 'leve', 'leves')}`}
                />
                <Resumo
                  rotulo="Quadros julgados por hora"
                  valor={numero(r.quadrosPorHora)}
                  pe="soma de todos os canais"
                />
                <Resumo
                  rotulo="Câmeras instaladas"
                  valor={numero(r.cameraNaoAtende)}
                  sufixo={r.cameraNaoAtende === 1 ? 'não atende' : 'não atendem'}
                  pe={`${numero(r.cameraNaoMedida)} ainda sem medida`}
                />
              </div>

              {/* ───────────── os canais ───────────── */}
              <section aria-labelledby="t-orc-canais" className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Titulo id="t-orc-canais">Canais</Titulo>
                  <span className="text-[12.5px] text-farol-suave md:ml-auto">
                    Na ordem em que o dinheiro resolve: os críticos primeiro, depois os mais usados.
                  </span>
                </div>
                <ul className="flex flex-col gap-3">
                  {orcamento.canais.map((c, i) => (
                    <CanalNoOrcamentoCartao
                      key={c.id}
                      canal={c}
                      configura={configura}
                      salvando={salvando}
                      abertoDeInicio={i === 0}
                      aoMudarImportancia={mudarImportancia}
                    />
                  ))}
                </ul>
              </section>

              {/* ───────────── computador e gravador ───────────── */}
              <section aria-labelledby="t-orc-infra" className="flex min-w-0 flex-col gap-3">
                <Titulo id="t-orc-infra">Computador e gravador</Titulo>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Infra
                    icone={Cpu}
                    titulo={`Computador: pelo menos ${NOME_DO_NIVEL[orcamento.computador.nivelExigido].toLowerCase()}`}
                    motivo={orcamento.computador.motivo}
                    opcoes={orcamento.computador.opcoes}
                  />
                  <Infra
                    icone={HardDrive}
                    titulo={`Gravador: pelo menos ${NOME_DO_NIVEL[orcamento.gravador.nivelExigido].toLowerCase()}`}
                    motivo={orcamento.gravador.motivo}
                    opcoes={orcamento.gravador.opcoes}
                  />
                </div>
              </section>

              {/* ───────────── os pacotes ───────────── */}
              <section aria-labelledby="t-orc-pacotes" className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Titulo id="t-orc-pacotes">Três caminhos</Titulo>
                  <span className="text-[12.5px] text-farol-suave md:ml-auto">
                    Câmera que já atende não entra na soma.
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {orcamento.pacotes.map((p) => (
                    <CartaoDoPacote key={p.nivel} pacote={p} />
                  ))}
                </div>
                <p className="max-w-[70ch] text-[12.5px] text-farol-suave">
                  Cada pacote usa, em cada canal, a opção daquele nível que serve ao uso. Se a loja já tem gravador
                  ou computador que serve, tire-os da conta. Os preços são referência, com a data em que foram
                  vistos: confira antes de comprar. As opções vêm do catálogo mantido pelo Monitor Farol.
                </p>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
