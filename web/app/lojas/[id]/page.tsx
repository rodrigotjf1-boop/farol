'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Agentes } from '@/componentes/agentes';
import { Confirmar } from '@/componentes/criterios/confirmar';
import { FormularioPonto } from '@/componentes/pontos/formulario-ponto';
import { podeConfigurar, Shell } from '@/componentes/shell';
import {
  api,
  type AgenteResumo,
  consoleApi,
  ErroDaApi,
  type Eu,
  type Loja,
  type Ponto,
  regrasApi,
  type Setor,
} from '@/lib/api';

/** Um critério que vale no canal que está para ser excluído. */
type CriterioDoCanal = { nome: string; ligado: boolean; soAqui: boolean };

/** A pergunta aberta antes de excluir um canal. */
type Excluindo = { ponto: Ponto; criterios: CriterioDoCanal[] };

const botaoDeLinha =
  'rounded-lg border border-farol-borda px-2.5 py-1 text-xs transition hover:border-farol-facho/50';

export default function DetalheLoja() {
  const { id } = useParams<{ id: string }>();
  const [loja, setLoja] = useState<Loja | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [agentes, setAgentes] = useState<AgenteResumo[]>([]);
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [editando, setEditando] = useState<Ponto | null>(null);
  const [excluindo, setExcluindo] = useState<Excluindo | null>(null);
  const [excluindoAgora, setExcluindoAgora] = useState(false);
  const [erroAoExcluir, setErroAoExcluir] = useState<string | null>(null);

  async function recarregar() {
    const r = await consoleApi.loja(id);
    setLoja(r.loja);
    setSetores(r.setores);
    setAgentes(r.agentes ?? []);
  }

  useEffect(() => {
    Promise.all([consoleApi.loja(id), api.eu()])
      .then(([r, u]) => {
        setLoja(r.loja);
        setSetores(r.setores);
        setAgentes(r.agentes ?? []);
        setEu(u);
      })
      .catch((e) => setErro(e instanceof ErroDaApi ? e.message : 'não deu certo'));
  }, [id]);

  const configura = podeConfigurar(eu);

  function abrirCriacao(setorId: string) {
    setErro(null);
    setAviso(null);
    setEditando(null);
    setAbrindo(abrindo === setorId ? null : setorId);
  }

  function abrirEdicao(p: Ponto) {
    setErro(null);
    setAviso(null);
    setAbrindo(null);
    setEditando(p);
  }

  // Antes de perguntar, descobre o que deixa de ser verificado. A pergunta
  // "tem certeza?" sem dizer a consequência não é pergunta.
  async function pedirExclusao(p: Ponto) {
    setErro(null);
    setAviso(null);
    setErroAoExcluir(null);
    try {
      const { regras } = await regrasApi.listar(id);
      const criterios = regras
        .filter((r) => r.alvos.some((a) => a.ponto_id === p.id))
        .map((r) => ({
          nome: r.nome,
          ligado: r.ativa,
          soAqui: r.alvos.every((a) => a.ponto_id === p.id),
        }));
      setExcluindo({ ponto: p, criterios });
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setExcluindoAgora(true);
    setErroAoExcluir(null);
    try {
      const r = await consoleApi.excluirPonto(excluindo.ponto.id);
      await recarregar();
      const desligados = r.criteriosDesligados.length;
      setAviso(
        `Canal “${excluindo.ponto.nome}” excluído.` +
          (r.criteriosTirados > 0
            ? ` ${r.criteriosTirados} ${r.criteriosTirados === 1 ? 'critério saiu' : 'critérios saíram'} dele` +
              (desligados > 0
                ? `; ${desligados} ${desligados === 1 ? 'ficou' : 'ficaram'} sem canal e ${desligados === 1 ? 'foi desligado' : 'foram desligados'}.`
                : '.')
            : ''),
      );
      setExcluindo(null);
      if (editando?.id === excluindo.ponto.id) setEditando(null);
    } catch (e) {
      // O erro fica DENTRO da pergunta: fechá-la esconderia que a exclusão
      // não aconteceu.
      setErroAoExcluir(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setExcluindoAgora(false);
    }
  }

  const ficamSemCanal = excluindo?.criterios.filter((c) => c.soAqui) ?? [];
  const seguemEmOutros = excluindo?.criterios.filter((c) => !c.soAqui) ?? [];

  return (
    <Shell>
      <Link href="/lojas" className="text-sm text-farol-suave hover:text-farol-tinta">
        ← Lojas
      </Link>

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

      {loja && (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold">{loja.nome}</h1>
            <span className="text-sm text-farol-suave">
              julgamento {loja.modo_julgamento} · envio {loja.resolucao_padrao} ·{' '}
              {loja.timezone}
            </span>
            <Link
              href={`/lojas/${id}/regras`}
              className="ml-auto rounded-lg border border-farol-borda px-3 py-1.5 text-sm transition hover:border-farol-facho/50"
            >
              Critérios de análise →
            </Link>
            <Link
              href={`/lojas/${id}/alertas`}
              className="rounded-lg border border-farol-borda px-3 py-1.5 text-sm transition hover:border-farol-facho/50"
            >
              Alertas →
            </Link>
          </div>

          <div className="mt-6">
            <Agentes agentes={agentes} />
          </div>

          <div className="mt-6 space-y-5">
            {setores.map((s) => {
              const editandoAqui = editando && s.pontos.some((p) => p.id === editando.id);
              return (
                <section
                  key={s.id}
                  className="rounded-xl border border-farol-borda bg-farol-painel"
                >
                  <header className="flex flex-wrap items-center gap-3 border-b border-farol-borda px-4 py-3">
                    <h2 className="font-medium">{s.nome}</h2>
                    <span className="text-sm text-farol-suave">
                      {s.pontos.length} {s.pontos.length === 1 ? 'ponto' : 'pontos'}
                    </span>
                    {configura && (
                      <button
                        type="button"
                        onClick={() => abrirCriacao(s.id)}
                        aria-expanded={abrindo === s.id}
                        className="ml-auto rounded-lg border border-farol-borda px-3 py-1.5 text-sm transition hover:border-farol-facho/50"
                      >
                        {abrindo === s.id ? 'Cancelar' : '＋ Ponto'}
                      </button>
                    )}
                  </header>

                  {abrindo === s.id && (
                    <FormularioPonto
                      setorId={s.id}
                      aoCancelar={() => setAbrindo(null)}
                      aoSalvar={async (mensagem) => {
                        setAbrindo(null);
                        await recarregar();
                        setAviso(mensagem);
                      }}
                    />
                  )}

                  {editandoAqui && editando && (
                    // A chave remonta o formulário quando se troca de canal:
                    // sem ela os campos ficariam com os valores do anterior.
                    <FormularioPonto
                      key={editando.id}
                      setorId={s.id}
                      ponto={editando}
                      aoCancelar={() => setEditando(null)}
                      aoSalvar={async (mensagem) => {
                        setEditando(null);
                        await recarregar();
                        setAviso(mensagem);
                      }}
                    />
                  )}

                  {s.pontos.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-farol-suave">
                      Nenhum ponto neste setor. Um ponto é uma câmera — do gravador
                      (com canal) ou IP direta.
                    </p>
                  ) : (
                    // Tabela sempre dentro de rolagem horizontal: em 375px
                    // ela não cabe, e o corpo da página não pode rolar de lado.
                    //
                    // `relative` não é enfeite: os textos `sr-only` das células
                    // são posicionados em absoluto, e sem um ancestral
                    // posicionado eles escapam do corte desta caixa — a página
                    // inteira ganhava 761 px de largura num celular de 375.
                    <div className="relative overflow-x-auto">
                      <table className="w-full text-sm">
                        <caption className="sr-only">
                          Pontos do setor {s.nome}
                        </caption>
                        <thead className="text-left text-farol-suave">
                          <tr>
                            <th className="px-4 py-2 font-medium">Nome</th>
                            <th className="px-4 py-2 font-medium">Origem</th>
                            <th className="px-4 py-2 font-medium">Canal</th>
                            <th className="px-4 py-2 font-medium">Endereço</th>
                            <th className="px-4 py-2 font-medium">Estado</th>
                            <th className="px-4 py-2 font-medium">
                              <span className="sr-only">Ações</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.pontos.map((p) => (
                            <tr key={p.id} className="border-t border-farol-borda">
                              <td className="whitespace-nowrap px-4 py-2">{p.nome}</td>
                              <td className="px-4 py-2 text-farol-suave">
                                {p.origem === 'dvr' ? 'gravador' : 'câmera IP'}
                              </td>
                              <td className="px-4 py-2 text-farol-suave">{p.canal ?? '—'}</td>
                              <td className="whitespace-nowrap px-4 py-2 text-farol-suave">
                                {p.host ?? '—'}
                                {p.usuario ? ` · ${p.usuario}` : ''}
                              </td>
                              <td className="px-4 py-2">
                                {p.ativo ? (
                                  <span className="text-farol-ok">ativo</span>
                                ) : (
                                  <span className="text-farol-atencao">pausado</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2 text-right">
                                <span className="inline-flex items-center gap-2">
                                  <Link
                                    href={`/pontos/${p.id}/area`}
                                    className="text-sm text-farol-facho hover:underline"
                                  >
                                    ver quadro e área
                                  </Link>
                                  {configura && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => abrirEdicao(p)}
                                        className={botaoDeLinha}
                                      >
                                        Editar<span className="sr-only"> o canal {p.nome}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => pedirExclusao(p)}
                                        className={`${botaoDeLinha} text-farol-critico hover:border-farol-critico/60`}
                                      >
                                        Excluir<span className="sr-only"> o canal {p.nome}</span>
                                      </button>
                                    </>
                                  )}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {configura && <NovoSetor lojaId={id} aoSalvar={recarregar} />}
        </>
      )}

      {excluindo && (
        <Confirmar
          titulo={`Excluir o canal “${excluindo.ponto.nome}”?`}
          rotuloConfirmar="Excluir canal"
          rotuloOcupado="Excluindo…"
          ocupado={excluindoAgora}
          erro={erroAoExcluir}
          aoConfirmar={confirmarExclusao}
          aoCancelar={() => setExcluindo(null)}
        >
          <p>
            O canal some desta tela e{' '}
            <strong className="text-farol-tinta">deixa de ser verificado</strong>. O histórico do
            que já foi registrado nele continua.
          </p>
          {excluindo.criterios.length === 0 && <p>Nenhum critério vale neste canal.</p>}
          {ficamSemCanal.length > 0 && (
            <p>
              {ficamSemCanal.length === 1 ? 'Este critério só vale' : 'Estes critérios só valem'}{' '}
              aqui: {ficamSemCanal.length === 1 ? 'é desligado e vai' : 'são desligados e vão'} para
              “Sem canal”:{' '}
              <strong className="text-farol-tinta">
                {ficamSemCanal.map((c) => c.nome).join(', ')}
              </strong>
              .
            </p>
          )}
          {seguemEmOutros.length > 0 && (
            <p>
              {seguemEmOutros.length === 1 ? 'Sai' : 'Saem'} deste canal e{' '}
              {seguemEmOutros.length === 1 ? 'continua' : 'continuam'} nos outros:{' '}
              {seguemEmOutros.map((c) => c.nome).join(', ')}.
            </p>
          )}
          <p>
            Se a ideia é só parar por um tempo, use <strong className="text-farol-tinta">Editar</strong>{' '}
            e mude a situação para “pausado”.
          </p>
        </Confirmar>
      )}
    </Shell>
  );
}

// ───────────────────────── formulários ─────────────────────────

const campo =
  'w-full rounded-lg border border-farol-borda bg-farol-fundo px-3 py-2 text-sm';
const rotulo = 'block text-xs font-medium text-farol-suave';

function NovoSetor({ lojaId, aoSalvar }: { lojaId: string; aoSalvar: () => Promise<void> }) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await consoleApi.criarSetor(lojaId, nome);
      setNome('');
      await aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }

  return (
    <form onSubmit={enviar} className="mt-6 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <label className={rotulo} htmlFor="setor">
          Novo setor
        </label>
        <input
          id="setor"
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className={`mt-1 ${campo} max-w-sm`}
          placeholder="Cozinha, Salão, Estoque…"
        />
      </div>
      <button
        type="submit"
        className="rounded-lg border border-farol-borda px-4 py-2 text-sm transition hover:border-farol-facho/50"
      >
        Criar setor
      </button>
      {erro && (
        <p role="alert" className="w-full text-sm text-farol-critico">
          {erro}
        </p>
      )}
    </form>
  );
}
