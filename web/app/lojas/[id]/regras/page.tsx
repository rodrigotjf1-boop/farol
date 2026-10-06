'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { podeConfigurar, Shell } from '@/componentes/shell';
import {
  api,
  consoleApi,
  ErroDaApi,
  regrasApi,
  type Eu,
  type Regra,
  type Setor,
} from '@/lib/api';

const TIPOS: Array<{ v: Regra['tipo']; r: string; ajuda: string }> = [
  { v: 'estado', r: 'Estado', ajuda: 'um quadro responde: EPI, limpeza, organização' },
  { v: 'presenca', r: 'Presença', ajuda: 'tem alguém na zona neste horário' },
  { v: 'contagem', r: 'Contagem', ajuda: 'quantas pessoas, fila, ocupação' },
  { v: 'comparacao', r: 'Comparação', ajuda: 'compara com um padrão guardado' },
  { v: 'acao', r: 'Ação', ajuda: 'sequência com etapas — custa bem mais' },
];

const SEVERIDADES = ['info', 'atencao', 'critico', 'emergencia'] as const;
const PRIORIDADES: Array<{ v: string; r: string }> = [
  { v: 'leve', r: 'Leve — pode esperar horas' },
  { v: 'intermediaria', r: 'Intermediária — até 30 s' },
  { v: 'urgente', r: 'Urgente — menos de 2 s, só local' },
];

export default function Regras() {
  const { id } = useParams<{ id: string }>();
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  async function recarregar() {
    const [r, l] = await Promise.all([regrasApi.listar(id), consoleApi.loja(id)]);
    setRegras(r.regras);
    setSetores(l.setores);
  }

  useEffect(() => {
    Promise.all([regrasApi.listar(id), consoleApi.loja(id), api.eu()])
      .then(([r, l, u]) => {
        setRegras(r.regras);
        setSetores(l.setores);
        setEu(u);
      })
      .catch((e) => setErro(e instanceof ErroDaApi ? e.message : 'não deu certo'));
  }, [id]);

  const configura = podeConfigurar(eu);
  const zonas = setores.flatMap((s) =>
    s.pontos.flatMap((p) =>
      (p.zonas ?? []).map((z) => ({
        id: z.id,
        rotulo: `${s.nome} · ${p.nome}${p.canal ? ` (canal ${p.canal})` : ''} · ${z.nome}`,
      })),
    ),
  );

  async function alternar(r: Regra) {
    try {
      await regrasApi.editar(r.id, { ativa: !r.ativa });
      await recarregar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }

  return (
    <Shell>
      <Link href={`/lojas/${id}`} className="text-sm text-farol-suave hover:text-farol-tinta">
        ← Loja
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Critérios de análise</h1>
        {configura && zonas.length > 0 && (
          <button
            onClick={() => setCriando((c) => !c)}
            aria-expanded={criando}
            className="ml-auto rounded-lg border border-farol-borda px-3 py-1.5 text-sm transition hover:border-farol-facho/50"
          >
            {criando ? 'Cancelar' : '＋ Critério'}
          </button>
        )}
      </div>

      {erro && (
        <p role="alert" className="mt-4 text-sm text-farol-critico">
          {erro}
        </p>
      )}

      {zonas.length === 0 && regras !== null && (
        <div className="mt-6 rounded-xl border border-dashed border-farol-borda p-8 text-center">
          <p className="text-farol-suave">Esta loja ainda não tem câmera cadastrada.</p>
          <Link href={`/lojas/${id}`} className="mt-2 inline-block text-sm text-farol-facho">
            Cadastrar um ponto primeiro →
          </Link>
        </div>
      )}

      {criando && (
        <FormularioRegra
          zonas={zonas}
          aoSalvar={async () => {
            setCriando(false);
            await recarregar();
          }}
        />
      )}

      {regras?.length === 0 && zonas.length > 0 && !criando && (
        <div className="mt-6 rounded-xl border border-dashed border-farol-borda p-8">
          <p className="text-farol-suave">Nenhum critério ainda.</p>
          <p className="mt-2 max-w-prose text-sm text-farol-suave">
            Um critério descreve, em português, o que é <em>conforme</em> naquela
            câmera. O agente usa esse texto como pergunta — então escreva como você
            explicaria a alguém que acabou de chegar.
          </p>
        </div>
      )}

      {regras && regras.length > 0 && (
        <ul className="mt-6 space-y-3">
          {regras.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-farol-borda bg-farol-painel p-4"
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <span className="font-medium">{r.nome}</span>
                <span className="rounded bg-farol-borda/60 px-1.5 py-0.5 text-xs text-farol-suave">
                  {r.tipo}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    r.severidade === 'emergencia' || r.severidade === 'critico'
                      ? 'bg-farol-critico/15 text-farol-critico'
                      : 'bg-farol-borda/60 text-farol-suave'
                  }`}
                >
                  {r.severidade}
                </span>

                {configura && (
                  <button
                    onClick={() => alternar(r)}
                    aria-pressed={r.ativa}
                    className={`ml-auto rounded-lg px-3 py-1.5 text-sm transition ${
                      r.ativa
                        ? 'bg-farol-ok/15 text-farol-ok'
                        : 'border border-farol-borda text-farol-suave hover:border-farol-facho/50'
                    }`}
                  >
                    {r.ativa ? 'Ligada' : 'Desligada'}
                  </button>
                )}
              </div>

              <p className="mt-2 max-w-prose text-sm text-farol-suave">{r.criterio}</p>

              <p className="mt-2 text-xs text-farol-suave">
                {r.setor_nome} · {r.ponto_nome}
                {r.canal ? ` (canal ${r.canal})` : ''} · {r.zona_nome} ·{' '}
                {r.prioridade} · confiança mínima {Number(r.confianca_minima).toFixed(2)} ·
                silêncio {r.cooldown_min} min · versão {r.criterio_versao}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

// ───────────────────────── formulário ─────────────────────────

const campo = 'w-full rounded-lg border border-farol-borda bg-farol-fundo px-3 py-2 text-sm';
const rotulo = 'block text-xs font-medium text-farol-suave';

function FormularioRegra({
  zonas,
  aoSalvar,
}: {
  zonas: Array<{ id: string; rotulo: string }>;
  aoSalvar: () => Promise<void>;
}) {
  const [zonaId, setZonaId] = useState(zonas[0]?.id ?? '');
  const [dados, setDados] = useState<Record<string, unknown>>({
    tipo: 'estado',
    prioridade: 'intermediaria',
    severidade: 'atencao',
    confiancaMinima: 0.7,
    cooldownMin: 15,
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const tipo = TIPOS.find((t) => t.v === dados.tipo);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await regrasApi.criar(zonaId, dados);
      await aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  function muda(k: string, v: unknown) {
    setDados((d) => ({ ...d, [k]: v }));
  }

  return (
    <form
      onSubmit={enviar}
      className="mt-6 rounded-xl border border-farol-borda bg-farol-painel p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={rotulo} htmlFor="onde">
            Onde
          </label>
          <select
            id="onde"
            className={`mt-1 ${campo}`}
            value={zonaId}
            onChange={(e) => setZonaId(e.target.value)}
          >
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={rotulo} htmlFor="nome">
            Nome do critério
          </label>
          <input
            id="nome"
            required
            className={`mt-1 ${campo}`}
            placeholder="Bancada limpa entre pedidos"
            onChange={(e) => muda('nome', e.target.value)}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor="tipo">
            Tipo
          </label>
          <select
            id="tipo"
            className={`mt-1 ${campo}`}
            value={String(dados.tipo)}
            onChange={(e) => muda('tipo', e.target.value)}
          >
            {TIPOS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.r}
              </option>
            ))}
          </select>
          {tipo && <p className="mt-1 text-xs text-farol-suave">{tipo.ajuda}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className={rotulo} htmlFor="criterio">
            O que é “conforme”
          </label>
          <textarea
            id="criterio"
            required
            rows={3}
            className={`mt-1 ${campo}`}
            placeholder="A superfície de trabalho está livre de restos de alimento, embalagens descartadas e utensílios sujos."
            onChange={(e) => muda('criterio', e.target.value)}
          />
          {/* O texto VAI para o modelo como pergunta. Vale dizer isso aqui,
              senão alguém escreve um rótulo e espera que funcione. */}
          <p className="mt-1 text-xs text-farol-suave">
            Este texto vai direto ao modelo como pergunta. Descreva o que se vê,
            não o rótulo — “a superfície tem restos no canto” funciona melhor que
            “sujeira”.
          </p>
        </div>

        <div>
          <label className={rotulo} htmlFor="prioridade">
            Prioridade
          </label>
          <select
            id="prioridade"
            className={`mt-1 ${campo}`}
            value={String(dados.prioridade)}
            onChange={(e) => muda('prioridade', e.target.value)}
          >
            {PRIORIDADES.map((p) => (
              <option key={p.v} value={p.v}>
                {p.r}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={rotulo} htmlFor="severidade">
            Severidade
          </label>
          <select
            id="severidade"
            className={`mt-1 ${campo}`}
            value={String(dados.severidade)}
            onChange={(e) => muda('severidade', e.target.value)}
          >
            {SEVERIDADES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={rotulo} htmlFor="confianca">
            Confiança mínima para alertar
          </label>
          <input
            id="confianca"
            type="number"
            min={0}
            max={1}
            step={0.05}
            className={`mt-1 ${campo}`}
            value={Number(dados.confiancaMinima)}
            onChange={(e) => muda('confiancaMinima', Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-farol-suave">
            Abaixo disso o resultado é registrado, mas não vira alerta.
          </p>
        </div>

        <div>
          <label className={rotulo} htmlFor="cooldown">
            Silêncio entre alertas (min)
          </label>
          <input
            id="cooldown"
            type="number"
            min={0}
            className={`mt-1 ${campo}`}
            value={Number(dados.cooldownMin)}
            onChange={(e) => muda('cooldownMin', Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-farol-suave">
            Dentro desse prazo não se analisa de novo — a condição continua lá e a
            loja já sabe.
          </p>
        </div>
      </div>

      {erro && (
        <p role="alert" className="mt-4 text-sm text-farol-critico">
          {erro}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={salvando || !zonaId}
          className="rounded-lg bg-farol-facho px-4 py-2 text-sm font-semibold text-farol-fundo transition hover:brightness-110 disabled:opacity-60"
        >
          {salvando ? 'Salvando…' : 'Criar critério'}
        </button>
        <p className="text-xs text-farol-suave">
          O critério nasce <strong className="text-farol-tinta">desligado</strong>. Ligue
          só depois de conferir que ele acerta.
        </p>
      </div>
    </form>
  );
}
