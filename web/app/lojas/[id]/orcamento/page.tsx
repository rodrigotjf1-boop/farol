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

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { CanalNoOrcamentoCartao } from '@/componentes/orcamento/canal-no-orcamento';
import { CartaoDaOpcao } from '@/componentes/orcamento/opcao';
import { CartaoDoPacote } from '@/componentes/orcamento/pacote';
import { NOME_DO_NIVEL } from '@/componentes/orcamento/rotulos';
import { podeConfigurar, Shell } from '@/componentes/shell';
import {
  api,
  consoleApi,
  ErroDaApi,
  type CanalNoOrcamento,
  type Eu,
  type Importancia,
  type Orcamento,
} from '@/lib/api';

export default function OrcamentoDaLoja() {
  const { id } = useParams<{ id: string }>();
  const [orcamento, setOrcamento] = useState<Orcamento | null>(null);
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    Promise.all([consoleApi.orcamento(id), api.eu()])
      .then(([o, u]) => {
        setOrcamento(o);
        setEu(u);
      })
      .catch((e) => setErro(e instanceof ErroDaApi ? e.message : 'não deu certo'));
  }, [id]);

  const configura = podeConfigurar(eu);

  async function mudarImportancia(canal: CanalNoOrcamento, importancia: Importancia) {
    setErro(null);
    setAviso(null);
    setSalvando(true);
    try {
      await consoleApi.editarPonto(canal.id, { importancia });
      setOrcamento(await consoleApi.orcamento(id));
      setAviso(`“${canal.nome}” agora é de importância ${importancia === 'critico' ? 'crítica' : importancia === 'baixo' ? 'baixa' : 'normal'}.`);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setSalvando(false);
    }
  }

  const r = orcamento?.resumo;

  return (
    <Shell>
      <Link href={`/lojas/${id}`} className="text-sm text-farol-suave hover:text-farol-tinta">
        ← Loja
      </Link>

      <h1 className="mt-2 text-xl font-semibold">Orçamento por uso</h1>
      <p className="mt-1 max-w-prose text-sm text-farol-suave">
        Cada canal é classificado pelo quanto é usado e pelo que precisa enxergar. A partir
        disso, as câmeras que servem — uma por nível — e três pacotes somados.
      </p>

      {erro && (
        <p role="alert" className="mt-4 rounded-lg bg-farol-critico/10 p-3 text-sm text-farol-critico">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="mt-4 rounded-lg bg-farol-ok/10 p-3 text-sm text-farol-ok">
          {aviso}
        </p>
      )}

      {orcamento && r && (
        <>
          {orcamento.avisos.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-lg border border-farol-atencao/40 bg-farol-atencao/10 p-3 text-sm text-farol-atencao">
              {orcamento.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}

          {/* ───────────── o resumo ───────────── */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <p className="text-xs text-farol-suave">Canais em uso</p>
              <p className="mt-1 font-mono text-xl">
                {r.emUso} <span className="text-sm text-farol-suave">de {r.canais}</span>
              </p>
            </div>
            <div className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <p className="text-xs text-farol-suave">Por quantidade de uso</p>
              <p className="mt-1 text-sm">
                {r.porCarga.intensa} intenso · {r.porCarga.moderada} moderado · {r.porCarga.leve}{' '}
                leve · {r.porCarga.sem_uso} sem uso
              </p>
            </div>
            <div className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <p className="text-xs text-farol-suave">Quadros julgados por hora</p>
              <p className="mt-1 font-mono text-xl">{r.quadrosPorHora.toLocaleString('pt-BR')}</p>
            </div>
            <div className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <p className="text-xs text-farol-suave">Câmera instalada</p>
              <p className="mt-1 text-sm">
                {r.cameraNaoAtende} não atende · {r.cameraNaoMedida} sem medida
              </p>
            </div>
          </div>

          {/* ───────────── os canais ───────────── */}
          <h2 className="mt-8 font-medium">Canais</h2>
          <p className="mt-1 max-w-prose text-xs text-farol-suave">
            Na ordem em que o dinheiro resolve: os críticos primeiro, depois os mais usados.
          </p>
          {orcamento.canais.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-farol-borda p-6 text-sm text-farol-suave">
              Esta loja ainda não tem canal cadastrado.{' '}
              <Link href={`/lojas/${id}`} className="text-farol-facho">
                Cadastrar um ponto →
              </Link>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {orcamento.canais.map((c) => (
                <CanalNoOrcamentoCartao
                  key={c.id}
                  canal={c}
                  configura={configura}
                  salvando={salvando}
                  aoMudarImportancia={mudarImportancia}
                />
              ))}
            </ul>
          )}

          {/* ───────────── computador e gravador ───────────── */}
          <h2 className="mt-8 font-medium">Computador e gravador</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <h3 className="text-sm font-medium">
                Computador: pelo menos {NOME_DO_NIVEL[orcamento.computador.nivelExigido].toLowerCase()}
              </h3>
              <p className="mt-1 text-sm text-farol-suave">{orcamento.computador.motivo}</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {orcamento.computador.opcoes.map((o) => (
                  <CartaoDaOpcao key={`${o.fabricante}-${o.modelo}`} opcao={o} />
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-farol-borda bg-farol-painel p-4">
              <h3 className="text-sm font-medium">
                Gravador: pelo menos {NOME_DO_NIVEL[orcamento.gravador.nivelExigido].toLowerCase()}
              </h3>
              <p className="mt-1 text-sm text-farol-suave">{orcamento.gravador.motivo}</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {orcamento.gravador.opcoes.map((o) => (
                  <CartaoDaOpcao key={`${o.fabricante}-${o.modelo}`} opcao={o} />
                ))}
              </div>
            </section>
          </div>

          {/* ───────────── os pacotes ───────────── */}
          <h2 className="mt-8 font-medium">Três caminhos</h2>
          <p className="mt-1 max-w-prose text-xs text-farol-suave">
            Cada pacote usa, em cada canal, a opção daquele nível que serve ao uso. Câmera que
            já atende não entra. Se a loja já tem gravador ou computador que serve, tire-os da
            conta.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            {orcamento.pacotes.map((p) => (
              <CartaoDoPacote key={p.nivel} pacote={p} />
            ))}
          </div>

          <p className="mt-6 max-w-prose text-xs text-farol-suave">
            Os preços são referência, com a data em que foram vistos — confira antes de comprar.
            As opções vêm do catálogo mantido pelo Monitor Farol.
          </p>
        </>
      )}
    </Shell>
  );
}
