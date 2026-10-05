'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Shell } from '@/componentes/shell';
import { consoleApi, ErroDaApi, type LojaResumo } from '@/lib/api';

export default function Lojas() {
  const [lojas, setLojas] = useState<LojaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    consoleApi
      .lojas()
      .then((r) => setLojas(r.lojas))
      .catch((e) => setErro(e instanceof ErroDaApi ? e.message : 'não deu certo'));
  }, []);

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Lojas</h1>

      {erro && (
        <p role="alert" className="mt-4 text-sm text-farol-critico">
          {erro}
        </p>
      )}

      {lojas === null && !erro && <p className="mt-4 text-sm text-farol-suave">carregando…</p>}

      {lojas?.length === 0 && (
        // Estado vazio com o próximo passo escrito, não só "nada aqui":
        // quem abre esta tela pela primeira vez precisa saber o que fazer.
        <div className="mt-6 rounded-xl border border-dashed border-farol-borda p-8 text-center">
          <p className="text-farol-suave">Nenhuma loja cadastrada ainda.</p>
          <p className="mt-2 text-sm text-farol-suave">
            A primeira loja é criada no provisionamento, pela Regem. Depois disso,
            setores e pontos se cadastram aqui.
          </p>
        </div>
      )}

      {lojas && lojas.length > 0 && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lojas.map((l) => (
            <li key={l.id}>
              <Link
                href={`/lojas/${l.id}`}
                className="block rounded-xl border border-farol-borda bg-farol-painel p-4 transition hover:border-farol-facho/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{l.nome}</span>
                  {!l.ativa && (
                    <span className="rounded bg-farol-borda px-1.5 py-0.5 text-xs text-farol-suave">
                      inativa
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-farol-suave">
                  {l.setores} {l.setores === 1 ? 'setor' : 'setores'} ·{' '}
                  {l.pontos} {l.pontos === 1 ? 'ponto' : 'pontos'}
                </p>
                <p className="mt-1 text-xs text-farol-suave">
                  julgamento {l.modo_julgamento} · envio {l.resolucao_padrao}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
