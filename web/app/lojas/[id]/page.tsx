'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Agentes } from '@/componentes/agentes';
import { podeConfigurar, Shell } from '@/componentes/shell';
import {
  api,
  type AgenteResumo,
  consoleApi,
  ErroDaApi,
  type Eu,
  type Loja,
  type Ponto,
  type Setor,
} from '@/lib/api';

export default function DetalheLoja() {
  const { id } = useParams<{ id: string }>();
  const [loja, setLoja] = useState<Loja | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [agentes, setAgentes] = useState<AgenteResumo[]>([]);
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);

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

  return (
    <Shell>
      <Link href="/lojas" className="text-sm text-farol-suave hover:text-farol-tinta">
        ← Lojas
      </Link>

      {erro && (
        <p role="alert" className="mt-4 text-sm text-farol-critico">
          {erro}
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
          </div>

          <div className="mt-6">
            <Agentes agentes={agentes} />
          </div>

          <div className="mt-6 space-y-5">
            {setores.map((s) => (
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
                      onClick={() => setAbrindo(abrindo === s.id ? null : s.id)}
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
                    aoSalvar={async () => {
                      setAbrindo(null);
                      await recarregar();
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
                  <div className="overflow-x-auto">
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
                                <span className="text-farol-suave">desativado</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2 text-right">
                              <Link
                                href={`/pontos/${p.id}/area`}
                                className="text-sm text-farol-facho hover:underline"
                              >
                                ver quadro e área
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
          </div>

          {configura && <NovoSetor lojaId={id} aoSalvar={recarregar} />}
        </>
      )}
    </Shell>
  );
}

// ───────────────────────── formulários ─────────────────────────

const campo =
  'w-full rounded-lg border border-farol-borda bg-farol-fundo px-3 py-2 text-sm';
const rotulo = 'block text-xs font-medium text-farol-suave';

function FormularioPonto({
  setorId,
  aoSalvar,
}: {
  setorId: string;
  aoSalvar: () => Promise<void>;
}) {
  const [dados, setDados] = useState<Partial<Ponto>>({ origem: 'dvr', porta: 554 });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function muda(campo: keyof Ponto, valor: unknown) {
    setDados((d) => ({ ...d, [campo]: valor }));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await consoleApi.criarPonto(setorId, dados);
      await aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="border-b border-farol-borda px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={rotulo} htmlFor="nome">
            Nome do ponto
          </label>
          <input
            id="nome"
            required
            className={`mt-1 ${campo}`}
            placeholder="Montagem"
            onChange={(e) => muda('nome', e.target.value)}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor="origem">
            Origem
          </label>
          <select
            id="origem"
            className={`mt-1 ${campo}`}
            value={dados.origem}
            onChange={(e) => muda('origem', e.target.value)}
          >
            <option value="dvr">Gravador (DVR/NVR)</option>
            <option value="ip">Câmera IP direta</option>
          </select>
        </div>

        {dados.origem === 'dvr' && (
          <div>
            <label className={rotulo} htmlFor="canal">
              Canal
            </label>
            <input
              id="canal"
              type="number"
              min={1}
              required
              className={`mt-1 ${campo}`}
              placeholder="11"
              onChange={(e) => muda('canal', Number(e.target.value))}
            />
          </div>
        )}

        <div>
          <label className={rotulo} htmlFor="host">
            Endereço na rede
          </label>
          <input
            id="host"
            className={`mt-1 ${campo}`}
            placeholder="192.168.1.108"
            onChange={(e) => muda('host', e.target.value)}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor="usuario">
            Usuário
          </label>
          <input
            id="usuario"
            className={`mt-1 ${campo}`}
            placeholder="admin"
            onChange={(e) => muda('usuario', e.target.value)}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor="fabricante">
            Fabricante
          </label>
          <input
            id="fabricante"
            className={`mt-1 ${campo}`}
            placeholder="intelbras"
            onChange={(e) => muda('fabricante', e.target.value)}
          />
        </div>
      </div>

      {/* Não existe campo de senha aqui, e isso é desenho, não esquecimento. */}
      <p className="mt-3 text-xs text-farol-suave">
        A senha do gravador não se cadastra aqui — ela fica no cofre do agente,
        dentro da loja. O console guarda só o usuário.
      </p>

      {erro && (
        <p role="alert" className="mt-3 text-sm text-farol-critico">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={salvando}
        className="mt-4 rounded-lg bg-farol-facho px-4 py-2 text-sm font-semibold text-farol-fundo transition hover:brightness-110 disabled:opacity-60"
      >
        {salvando ? 'Salvando…' : 'Salvar ponto'}
      </button>
    </form>
  );
}

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
