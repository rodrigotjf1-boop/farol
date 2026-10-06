'use client';

// =====================================================================
// Alertas — quem recebe o quê, e se chegou
// =====================================================================
// Três perguntas, nesta ordem, porque é a ordem em que elas aparecem na
// cabeça de quem configura:
//
//   1 · Para quem eu aviso?          → destinos
//   2 · Aviso de quê, para quem?     → política
//   3 · Chegou?                      → envios
//
// A terceira existe porque "mandei" e "chegou" são fatos diferentes, e um
// produto que não distingue os dois não consegue explicar o alerta que
// ninguém viu — a reclamação mais corrosiva que um sistema de auditoria
// pode receber, porque põe em dúvida todo o resto.
// =====================================================================

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { podeConfigurar, Shell } from '@/componentes/shell';
import {
  alertasApi,
  api,
  type Destino,
  type Envio,
  ErroDaApi,
  type Eu,
  type Politica,
} from '@/lib/api';

const TIPOS = [
  { v: 'whatsapp', r: 'WhatsApp', dica: 'número com + e país: +5521988887777' },
  { v: 'email', r: 'E-mail', dica: 'endereço de e-mail' },
  { v: 'kds', r: 'KDS do Regem', dica: 'id da loja no Regem' },
  { v: 'webhook', r: 'Webhook', dica: 'URL https, sem token na querystring' },
] as const;

const PAPEIS = ['presidente', 'gerente', 'supervisao', 'execucao'] as const;
const SEVERIDADES = ['info', 'atencao', 'critico', 'emergencia'] as const;
const PRIORIDADES = ['urgente', 'intermediaria', 'leve'] as const;

/** A mesma classe de campo do resto do console. */
const campo = 'w-full rounded-lg border border-farol-borda bg-farol-fundo px-3 py-2 text-sm';

const ESTADO_ROTULO: Record<string, { r: string; cor: string }> = {
  pendente: { r: 'Na fila', cor: 'text-farol-suave' },
  enviado: { r: 'Mandado', cor: 'text-farol-atencao' },
  entregue: { r: 'Chegou', cor: 'text-farol-ok' },
  falhou: { r: 'Falhou', cor: 'text-farol-critico' },
  descartado: { r: 'Descartado', cor: 'text-farol-suave' },
};

function quando(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function Alertas() {
  const { id } = useParams<{ id: string }>();
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [politicas, setPoliticas] = useState<Politica[]>([]);
  const [escopo, setEscopo] = useState<{ vigente: string; explicacao: string } | null>(null);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Formulário de destino
  const [tipo, setTipo] = useState<string>('whatsapp');
  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  const [papel, setPapel] = useState('');
  const [daRede, setDaRede] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Formulário de política
  const [pSeveridade, setPSeveridade] = useState('');
  const [pPrioridade, setPPrioridade] = useState('');
  const [pEnviar, setPEnviar] = useState(true);
  const [pDestino, setPDestino] = useState('');

  async function recarregar() {
    const [d, p, e] = await Promise.all([
      alertasApi.destinos(id),
      alertasApi.politicas(id),
      alertasApi.envios(id),
    ]);
    setDestinos(d.destinos);
    setPoliticas(p.politicas);
    setEscopo({ vigente: p.escopo_vigente, explicacao: p.explicacao });
    setEnvios(e.envios);
  }

  useEffect(() => {
    Promise.all([
      alertasApi.destinos(id),
      alertasApi.politicas(id),
      alertasApi.envios(id),
      api.eu(),
    ])
      .then(([d, p, e, u]) => {
        setDestinos(d.destinos);
        setPoliticas(p.politicas);
        setEscopo({ vigente: p.escopo_vigente, explicacao: p.explicacao });
        setEnvios(e.envios);
        setEu(u);
      })
      .catch((e) => setErro(e instanceof ErroDaApi ? e.message : 'não deu certo'));
  }, [id]);

  const configura = podeConfigurar(eu);
  const dica = TIPOS.find((t) => t.v === tipo)?.dica ?? '';

  async function salvarDestino(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setAviso(null);
    setSalvando(true);
    try {
      await alertasApi.criarDestino(id, {
        tipo, nome, endereco,
        papel: papel || undefined,
        daRede,
      });
      setNome('');
      setEndereco('');
      setPapel('');
      await recarregar();
      setAviso('destino cadastrado');
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setSalvando(false);
    }
  }

  async function salvarPolitica(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setAviso(null);
    try {
      await alertasApi.criarPolitica(id, {
        severidade: pSeveridade || null,
        prioridade: pPrioridade || null,
        enviar: pEnviar,
        destinoId: pEnviar ? pDestino : undefined,
      });
      setPDestino('');
      await recarregar();
      setAviso('política salva');
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }

  return (
    <Shell>
      <Link href={`/lojas/${id}`} className="text-sm text-farol-suave hover:text-farol-tinta">
        ← Loja
      </Link>

      <h1 className="mt-4 font-display text-2xl text-farol-tinta">Alertas</h1>
      <p className="mt-1 max-w-2xl text-sm text-farol-suave">
        O Farol decide quem recebe o quê; a entrega sai pelo Regem ou pelo n8n.
        Nenhum segredo de integração é digitado aqui.
      </p>

      {erro && (
        <p role="alert" className="mt-4 rounded-md bg-farol-critico/10 p-3 text-sm text-farol-critico">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="mt-4 rounded-md bg-farol-ok/10 p-3 text-sm text-farol-ok">
          {aviso}
        </p>
      )}

      {/* ───────────────────── 1 · destinos ───────────────────── */}

      <section className="mt-8">
        <h2 className="font-display text-lg text-farol-tinta">Quem recebe</h2>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Destinos de alerta desta loja</caption>
            <thead>
              <tr className="border-b border-farol-borda text-left text-xs uppercase text-farol-suave">
                <th className="py-2 pr-3 font-medium">Nome</th>
                <th className="py-2 pr-3 font-medium">Canal</th>
                <th className="py-2 pr-3 font-medium">Endereço</th>
                <th className="py-2 pr-3 font-medium">Perfil</th>
                <th className="py-2 pr-3 font-medium">Escopo</th>
                <th className="py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {destinos.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-farol-suave">
                    Nenhum destino cadastrado. Enquanto não houver,{' '}
                    <strong className="text-farol-tinta">
                      nem a queda do agente é avisada
                    </strong>{' '}
                    — e a queda do agente significa que esta loja parou de ser auditada.
                  </td>
                </tr>
              )}
              {destinos.map((d) => (
                <tr key={d.id} className="border-b border-farol-borda/50">
                  <td className="py-2 pr-3 text-farol-tinta">
                    {d.nome}
                    {d.tem_segredo && (
                      <span
                        className="ml-2 rounded bg-farol-borda px-1.5 py-0.5 text-[10px] uppercase text-farol-suave"
                        title="há um segredo guardado pela distribuição para este destino"
                      >
                        com segredo
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{TIPOS.find((t) => t.v === d.tipo)?.r ?? d.tipo}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{d.endereco}</td>
                  <td className="py-2 pr-3">{d.papel ?? '—'}</td>
                  <td className="py-2 pr-3 text-farol-suave">
                    {d.da_rede ? 'Rede' : 'Esta loja'}
                  </td>
                  <td className="py-2">
                    {configura ? (
                      <button
                        type="button"
                        aria-pressed={d.ativo}
                        onClick={async () => {
                          try {
                            await alertasApi.alternarDestino(d.id, !d.ativo);
                            await recarregar();
                          } catch (e) {
                            setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
                          }
                        }}
                        className={`rounded px-2 py-1 text-xs ${
                          d.ativo
                            ? 'bg-farol-ok/15 text-farol-ok'
                            : 'bg-farol-borda text-farol-suave'
                        }`}
                      >
                        {d.ativo ? 'Ativo' : 'Desligado'}
                      </button>
                    ) : (
                      <span className={d.ativo ? 'text-farol-ok' : 'text-farol-suave'}>
                        {d.ativo ? 'Ativo' : 'Desligado'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {configura && (
          <form onSubmit={salvarDestino} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="block text-farol-suave">Canal</span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className={`mt-1 ${campo}`}
              >
                {TIPOS.map((t) => (
                  <option key={t.v} value={t.v}>{t.r}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="block text-farol-suave">Nome</span>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                placeholder="Celular do gerente"
                className={`mt-1 ${campo}`}
              />
            </label>

            <label className="text-sm">
              <span className="block text-farol-suave">Endereço</span>
              <input
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
                required
                placeholder={dica}
                className={`mt-1 ${campo} font-mono text-xs`}
              />
              <span className="mt-1 block text-xs text-farol-suave">{dica}</span>
            </label>

            <label className="text-sm">
              <span className="block text-farol-suave">Perfil (opcional)</span>
              <select
                value={papel}
                onChange={(e) => setPapel(e.target.value)}
                className={`mt-1 ${campo}`}
              >
                <option value="">qualquer</option>
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={daRede}
                onChange={(e) => setDaRede(e.target.checked)}
              />
              <span className="text-farol-suave">
                Vale para a rede inteira — evita recadastrar o mesmo número em cada loja
              </span>
            </label>

            <div className="sm:col-span-2 lg:col-span-4">
              <button
                type="submit"
                disabled={salvando}
                className="rounded-lg bg-farol-facho px-4 py-2 text-sm font-semibold text-farol-fundo transition hover:brightness-110 disabled:opacity-60"
              >
                {salvando ? 'Salvando…' : 'Cadastrar destino'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ───────────────────── 2 · política ───────────────────── */}

      <section className="mt-10">
        <h2 className="font-display text-lg text-farol-tinta">Quem recebe o quê</h2>

        {escopo && (
          <p className="mt-1 text-sm text-farol-suave">
            Valendo agora: <strong className="text-farol-tinta">
              {escopo.vigente === 'loja' ? 'política desta loja' : 'padrão da rede'}
            </strong>{' '}
            — {escopo.explicacao}
          </p>
        )}

        <p className="mt-2 max-w-2xl text-xs text-farol-suave">
          Sem nenhuma linha que case, <strong>emergência e urgente alcançam todos os
          destinos ativos</strong>; o resto fica calado. Um alerta a mais incomoda por um
          instante; uma emergência não vista tira a razão de ser do produto. Para ficar
          sem o alcance padrão, cadastre uma linha de <em>não avisar</em>.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">Política de alertas</caption>
            <thead>
              <tr className="border-b border-farol-borda text-left text-xs uppercase text-farol-suave">
                <th className="py-2 pr-3 font-medium">Severidade</th>
                <th className="py-2 pr-3 font-medium">Prioridade</th>
                <th className="py-2 pr-3 font-medium">Ação</th>
                <th className="py-2 pr-3 font-medium">Destino</th>
                <th className="py-2 pr-3 font-medium">Escopo</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {politicas.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-farol-suave">
                    Nenhuma linha. Vale o padrão descrito acima.
                  </td>
                </tr>
              )}
              {politicas.map((p) => {
                const ignorada = escopo?.vigente === 'loja' && p.da_rede;
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-farol-borda/50 ${ignorada ? 'opacity-40' : ''}`}
                  >
                    <td className="py-2 pr-3">{p.severidade ?? 'qualquer'}</td>
                    <td className="py-2 pr-3">{p.prioridade ?? 'qualquer'}</td>
                    <td className="py-2 pr-3">
                      {p.enviar ? (
                        <span className="text-farol-ok">avisar</span>
                      ) : (
                        <span className="text-farol-critico">não avisar</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{p.destino_nome ?? '—'}</td>
                    <td className="py-2 pr-3 text-farol-suave">
                      {p.da_rede ? 'Rede' : 'Esta loja'}
                      {ignorada && ' · sem efeito aqui'}
                    </td>
                    <td className="py-2">
                      {configura && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await alertasApi.removerPolitica(p.id);
                              await recarregar();
                            } catch (e) {
                              setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
                            }
                          }}
                          className="text-xs text-farol-critico hover:underline"
                        >
                          remover
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {configura && (
          <form onSubmit={salvarPolitica} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="block text-farol-suave">Severidade</span>
              <select
                value={pSeveridade}
                onChange={(e) => setPSeveridade(e.target.value)}
                className={`mt-1 ${campo}`}
              >
                <option value="">qualquer</option>
                {SEVERIDADES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <label className="text-sm">
              <span className="block text-farol-suave">Prioridade</span>
              <select
                value={pPrioridade}
                onChange={(e) => setPPrioridade(e.target.value)}
                className={`mt-1 ${campo}`}
              >
                <option value="">qualquer</option>
                {PRIORIDADES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <label className="text-sm">
              <span className="block text-farol-suave">Ação</span>
              <select
                value={pEnviar ? 'sim' : 'nao'}
                onChange={(e) => setPEnviar(e.target.value === 'sim')}
                className={`mt-1 ${campo}`}
              >
                <option value="sim">avisar</option>
                <option value="nao">não avisar</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="block text-farol-suave">Destino</span>
              <select
                value={pDestino}
                onChange={(e) => setPDestino(e.target.value)}
                disabled={!pEnviar}
                required={pEnviar}
                className={`mt-1 ${campo} disabled:opacity-50`}
              >
                <option value="">escolha…</option>
                {destinos.filter((d) => d.ativo).map((d) => (
                  <option key={d.id} value={d.id}>{d.nome}</option>
                ))}
              </select>
              {!pEnviar && (
                <span className="mt-1 block text-xs text-farol-suave">
                  não avisar silencia a combinação inteira, sem destino
                </span>
              )}
            </label>

            <div className="sm:col-span-2 lg:col-span-4">
              <button
                type="submit"
                className="rounded-lg bg-farol-facho px-4 py-2 text-sm font-semibold text-farol-fundo transition hover:brightness-110"
              >
                Salvar linha
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ───────────────────── 3 · chegou? ───────────────────── */}

      <section className="mt-10">
        <h2 className="font-display text-lg text-farol-tinta">Chegou?</h2>
        <p className="mt-1 max-w-2xl text-sm text-farol-suave">
          <strong className="text-farol-tinta">Mandado</strong> é "passei ao transporte";{' '}
          <strong className="text-farol-tinta">Chegou</strong> é "o transporte confirmou".
          A diferença entre os dois é a única coisa que explica um alerta que ninguém viu.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Últimos envios de alerta</caption>
            <thead>
              <tr className="border-b border-farol-borda text-left text-xs uppercase text-farol-suave">
                <th className="py-2 pr-3 font-medium">Quando</th>
                <th className="py-2 pr-3 font-medium">Motivo</th>
                <th className="py-2 pr-3 font-medium">Para</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">Tentativas</th>
                <th className="py-2 font-medium">Confirmado</th>
              </tr>
            </thead>
            <tbody>
              {envios.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-farol-suave">
                    Nenhum envio ainda. Aparece aqui quando uma regra ligada produzir um
                    veredito fora do critério.
                  </td>
                </tr>
              )}
              {envios.map((e) => {
                const es = ESTADO_ROTULO[e.estado] ?? { r: e.estado, cor: '' };
                return (
                  <tr key={e.id} className="border-b border-farol-borda/50">
                    <td className="py-2 pr-3 font-mono text-xs">{quando(e.criado_em)}</td>
                    <td className="py-2 pr-3">
                      {e.motivo === 'agente_caiu' ? (
                        <span className="text-farol-critico">agente caiu</span>
                      ) : (
                        e.regra_nome ?? e.motivo
                      )}
                    </td>
                    <td className="py-2 pr-3">{e.destino_nome}</td>
                    <td className={`py-2 pr-3 ${es.cor}`}>
                      {es.r}
                      {e.erro && (
                        <span className="mt-0.5 block text-xs text-farol-suave">{e.erro}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{e.tentativas}</td>
                    <td className="py-2 font-mono text-xs">{quando(e.confirmado_em)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
