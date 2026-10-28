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
//
// Cada pergunta é uma aba: quem veio conferir se o aviso chegou não
// precisa rolar por dois formulários para achar a resposta.
// =====================================================================

import {
  BellOff,
  BellRing,
  CheckCheck,
  CircleX,
  Clock,
  Gauge,
  HardDrive,
  Info,
  LockKeyhole,
  Mail,
  MessageCircle,
  Monitor,
  Plus,
  Send,
  SlidersHorizontal,
  Store,
  Thermometer,
  Unplug,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { nomeDoNivel, useConsole } from '@/componentes/console';
import { nomeDaPrioridade, nomeDaSeveridade } from '@/componentes/criterios/opcoes';
import { diaEHora, frase } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { Campo, Escolhas, GRADE } from '@/componentes/ui/campo';
import { Alerta, Cabecalho, CARTAO, Chip, Liga, Ossos, Vazio, type Tom } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { Celula, Linha, Tabela } from '@/componentes/ui/tabela';
import { alertasApi, ErroDaApi, type Destino, type Envio, type Eu, type Politica } from '@/lib/api';

const CANAIS: ReadonlyArray<{
  valor: Destino['tipo'];
  titulo: string;
  ajuda: string;
  icone: LucideIcon;
  exemplo: string;
  dica: string;
}> = [
  { valor: 'whatsapp', titulo: 'WhatsApp', ajuda: 'número com + e país', icone: MessageCircle, exemplo: '+5521988887777', dica: 'O número com + e o código do país, sem espaços.' },
  { valor: 'email', titulo: 'E-mail', ajuda: 'endereço de e-mail', icone: Mail, exemplo: 'voce@empresa.com.br', dica: 'O endereço de e-mail de quem recebe.' },
  { valor: 'kds', titulo: 'Tela da cozinha', ajuda: 'KDS do Regem', icone: Monitor, exemplo: 'identificador da loja no Regem', dica: 'O identificador desta loja no Regem.' },
  { valor: 'webhook', titulo: 'Outro sistema', ajuda: 'endereço https', icone: Webhook, exemplo: 'https://…', dica: 'Um endereço https, sem chave escrita nele.' },
];

const canalDe = (tipo: string) => CANAIS.find((c) => c.valor === tipo);

const PAPEIS: ReadonlyArray<Eu['nivel']> = ['presidente', 'gerente', 'supervisao', 'execucao'];
const SEVERIDADES = ['info', 'atencao', 'critico', 'emergencia'] as const;
const PRIORIDADES = ['urgente', 'intermediaria', 'leve'] as const;

const ESTADO: Record<Envio['estado'], { rotulo: string; tom: Tom; icone: LucideIcon }> = {
  pendente: { rotulo: 'na fila', tom: 'neutro', icone: Clock },
  enviado: { rotulo: 'mandado', tom: 'atencao', icone: Send },
  entregue: { rotulo: 'chegou', tom: 'ok', icone: CheckCheck },
  falhou: { rotulo: 'falhou', tom: 'critico', icone: CircleX },
  descartado: { rotulo: 'descartado', tom: 'neutro', icone: BellOff },
};

const ABAS = [
  { id: 'quem', rotulo: 'Quem recebe', icone: Send },
  { id: 'regras', rotulo: 'Quem recebe o quê', icone: SlidersHorizontal },
  { id: 'chegou', rotulo: 'Chegou?', icone: CheckCheck },
] as const;
type Aba = (typeof ABAS)[number]['id'];

// ───────────────────────── novo destino ─────────────────────────

function GavetaDoDestino({ lojaId, aoSalvar, aoFechar }: { lojaId: string; aoSalvar: () => Promise<void>; aoFechar: () => void }) {
  const p = useId();
  const [tipo, setTipo] = useState<Destino['tipo']>('whatsapp');
  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  const [papel, setPapel] = useState('');
  const [daRede, setDaRede] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const canal = canalDe(tipo)!;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await alertasApi.criarDestino(lojaId, { tipo, nome, endereco, papel: papel || undefined, daRede });
      await aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo="Novo destino"
      descricao="Quem pode receber um aviso desta loja."
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando}>
            {salvando ? 'Salvando…' : 'Cadastrar destino'}
          </Botao>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={enviar} className="flex flex-col gap-4">
        <Escolhas nome={`${p}-canal`} rotulo="Por onde chega" opcoes={CANAIS} valor={tipo} aoMudar={setTipo} />
        <Campo rotulo="Nome" htmlFor={`${p}-nome`}>
          <input
            id={`${p}-nome`}
            required
            autoFocus
            className="entrada"
            placeholder="Celular do gerente"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </Campo>
        <Campo rotulo="Endereço" htmlFor={`${p}-endereco`} ajuda={canal.dica}>
          <input
            id={`${p}-endereco`}
            required
            className="entrada font-mono"
            placeholder={canal.exemplo}
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
          />
        </Campo>
        <Campo rotulo="Perfil de quem recebe" htmlFor={`${p}-papel`} ajuda="Opcional. Serve para saber de quem é o destino.">
          <select id={`${p}-papel`} className="entrada" value={papel} onChange={(e) => setPapel(e.target.value)}>
            <option value="">qualquer</option>
            {PAPEIS.map((n) => (
              <option key={n} value={n}>
                {nomeDoNivel(n)}
              </option>
            ))}
          </select>
        </Campo>
        <label htmlFor={`${p}-rede`} className="flex cursor-pointer items-start gap-2.5">
          <input
            id={`${p}-rede`}
            type="checkbox"
            checked={daRede}
            onChange={(e) => setDaRede(e.target.checked)}
            className="mt-0.5 h-[17px] w-[17px] shrink-0 accent-farol-marca"
          />
          <span>Vale para a rede inteira, para não recadastrar o mesmo número em cada loja</span>
        </label>
        <Alerta icone={LockKeyhole}>
          Nenhuma chave de integração é digitada aqui. Quando um destino precisa de uma, quem guarda é a Regem.
        </Alerta>
        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}

// ───────────────────────── nova regra ─────────────────────────

function GavetaDaRegra({
  lojaId,
  destinos,
  aoSalvar,
  aoFechar,
}: {
  lojaId: string;
  destinos: Destino[];
  aoSalvar: () => Promise<void>;
  aoFechar: () => void;
}) {
  const p = useId();
  const ativos = destinos.filter((d) => d.ativo);
  const [severidade, setSeveridade] = useState('');
  const [prioridade, setPrioridade] = useState('');
  const [acao, setAcao] = useState<'avisar' | 'calar'>('avisar');
  const [destino, setDestino] = useState(ativos[0]?.id ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const avisa = acao === 'avisar';

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await alertasApi.criarPolitica(lojaId, {
        severidade: severidade || null,
        prioridade: prioridade || null,
        enviar: avisa,
        destinoId: avisa ? destino : undefined,
      });
      await aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo="Nova regra de aviso"
      descricao="Para uma combinação de gravidade e prioridade, avisar alguém ou ficar calado."
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando} disabled={avisa && !destino}>
            {salvando ? 'Salvando…' : 'Salvar regra'}
          </Botao>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={enviar} className="flex flex-col gap-4">
        <div className={GRADE}>
          <Campo rotulo="Gravidade" htmlFor={`${p}-sev`}>
            <select id={`${p}-sev`} className="entrada" value={severidade} onChange={(e) => setSeveridade(e.target.value)}>
              <option value="">qualquer</option>
              {SEVERIDADES.map((s) => (
                <option key={s} value={s}>
                  {nomeDaSeveridade(s)}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Prioridade" htmlFor={`${p}-prio`}>
            <select id={`${p}-prio`} className="entrada" value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
              <option value="">qualquer</option>
              {PRIORIDADES.map((s) => (
                <option key={s} value={s}>
                  {nomeDaPrioridade(s)}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <Escolhas
          nome={`${p}-acao`}
          rotulo="O que fazer"
          valor={acao}
          aoMudar={setAcao}
          opcoes={[
            { valor: 'avisar', titulo: 'Avisar', ajuda: 'manda para o destino escolhido', icone: BellRing },
            { valor: 'calar', titulo: 'Não avisar', ajuda: 'silencia a combinação inteira', icone: BellOff },
          ]}
        />

        {avisa && (
          <Campo
            rotulo="Para quem"
            htmlFor={`${p}-dest`}
            ajuda={ativos.length === 0 ? 'Não há destino ligado. Cadastre um na aba “Quem recebe”.' : undefined}
          >
            <select id={`${p}-dest`} className="entrada" required value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">escolha…</option>
              {ativos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}

        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}

// ───────────────────────── a tela ─────────────────────────

export default function Alertas() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura } = useConsole();
  const avisar = useAvisar();

  const [destinos, setDestinos] = useState<Destino[] | null>(null);
  const [politicas, setPoliticas] = useState<Politica[]>([]);
  const [escopo, setEscopo] = useState<{ vigente: string; explicacao: string } | null>(null);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('quem');
  const [gaveta, setGaveta] = useState<'destino' | 'regra' | null>(null);
  const botoes = useRef<Record<string, HTMLButtonElement | null>>({});

  const carregar = useCallback(async () => {
    try {
      const [d, p, e] = await Promise.all([alertasApi.destinos(id), alertasApi.politicas(id), alertasApi.envios(id)]);
      setDestinos(d.destinos);
      setPoliticas(p.politicas);
      setEscopo({ vigente: p.escopo_vigente, explicacao: p.explicacao });
      setEnvios(e.envios);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function alternarDestino(d: Destino) {
    setErro(null);
    try {
      await alertasApi.alternarDestino(d.id, !d.ativo);
      await carregar();
      avisar(`“${d.nome}” ${d.ativo ? 'deixa de receber avisos' : 'volta a receber avisos'}.`);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }

  async function removerPolitica(p: Politica) {
    setErro(null);
    try {
      await alertasApi.removerPolitica(p.id);
      await carregar();
      avisar('Regra removida.');
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }

  function irParaAba(delta: number) {
    const i = ABAS.findIndex((a) => a.id === aba);
    const nova = ABAS[(i + delta + ABAS.length) % ABAS.length]!.id;
    setAba(nova);
    botoes.current[nova]?.focus();
  }

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Store className="h-[15px] w-[15px]" aria-hidden />
            {loja?.nome ?? 'Loja'}
          </>
        }
        titulo="Alertas"
      >
        Aqui você decide quem recebe o quê. A entrega é feita pela Regem, e nenhuma chave de integração é digitada
        nesta tela.
      </Cabecalho>

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      )}

      {destinos === null && !erro && <Ossos alturas={[44, [112, 112, 112, 112]]} />}

      {destinos !== null && (
        <>
          <div
            role="tablist"
            aria-label="Partes dos alertas"
            className="flex flex-wrap gap-x-1 border-b border-farol-borda max-sm:gap-x-0"
          >
            {ABAS.map((a) => {
              const ativa = a.id === aba;
              const Icone = a.icone;
              return (
                <button
                  key={a.id}
                  ref={(el) => {
                    botoes.current[a.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`aba-${a.id}`}
                  aria-controls={`painel-${a.id}`}
                  aria-selected={ativa}
                  tabIndex={ativa ? 0 : -1}
                  onClick={() => setAba(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') irParaAba(1);
                    if (e.key === 'ArrowLeft') irParaAba(-1);
                  }}
                  className={`relative inline-flex min-h-11 items-center gap-2 whitespace-nowrap px-3 font-semibold max-sm:px-2.5 after:absolute after:inset-x-3 max-sm:after:inset-x-2.5 after:-bottom-px after:h-0.5 after:origin-center after:rounded-sm after:bg-farol-facho after:transition-transform after:duration-200 after:ease-farol ${
                    ativa ? 'text-farol-tinta after:scale-x-100' : 'text-farol-suave after:scale-x-0 hover:text-farol-tinta'
                  }`}
                >
                  {/* No celular as três abas só cabem sem o ícone; com ele a
                      terceira ficava cortada na borda. */}
                  <Icone className="h-[18px] w-[18px] max-sm:hidden" aria-hidden />
                  {a.rotulo}
                </button>
              );
            })}
          </div>

          {/* ───────────────────── 1 · quem recebe ───────────────────── */}
          {aba === 'quem' && (
            <div role="tabpanel" id="painel-quem" aria-labelledby="aba-quem" className="flex animate-sobe flex-col gap-3">
              {destinos.length === 0 ? (
                <Vazio
                  icone={BellRing}
                  titulo="Ninguém recebe aviso desta loja"
                  acao={
                    configura && (
                      <Botao variante="primario" onClick={() => setGaveta('destino')}>
                        <Plus className="h-[18px] w-[18px]" aria-hidden />
                        Cadastrar o primeiro destino
                      </Botao>
                    )
                  }
                >
                  Enquanto não houver um destino, nem a queda do agente é avisada. E agente fora quer dizer loja sem
                  verificação.
                </Vazio>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <p className="text-[12.5px] text-farol-suave">Pessoas e sistemas que podem receber um aviso desta loja.</p>
                    {configura && (
                      <Botao variante="primario" className="ml-auto" onClick={() => setGaveta('destino')}>
                        <Plus className="h-[18px] w-[18px]" aria-hidden />
                        Novo destino
                      </Botao>
                    )}
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
                    {destinos.map((d) => {
                      const canal = canalDe(d.tipo);
                      const Icone = canal?.icone ?? Send;
                      return (
                        <article key={d.id} className={`${CARTAO} flex flex-col gap-2.5 p-3.5`}>
                          <div className="flex items-start gap-[11px]">
                            <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] bg-farol-realce text-farol-marca">
                              <Icone className="h-[18px] w-[18px]" aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                              <h3 className="break-words text-[15px] font-semibold leading-snug">{d.nome}</h3>
                              <p className="break-all font-mono text-xs text-farol-suave">{d.endereco}</p>
                            </div>
                            {configura ? (
                              <Liga ligado={d.ativo} aoMudar={() => void alternarDestino(d)} descricao={`Destino ${d.nome}`} />
                            ) : (
                              <Chip tom={d.ativo ? 'ok' : 'neutro'}>{d.ativo ? 'ligado' : 'desligado'}</Chip>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Chip>{canal?.valor === 'kds' ? 'KDS do Regem' : (canal?.titulo ?? d.tipo)}</Chip>
                            {d.papel && <Chip>perfil {nomeDoNivel(d.papel as Eu['nivel'])}</Chip>}
                            <Chip tom="vazado">{d.da_rede ? 'rede inteira' : 'esta loja'}</Chip>
                            {d.tem_segredo && (
                              <Chip icone={LockKeyhole} title="Há uma chave guardada pela Regem para este destino">
                                chave guardada
                              </Chip>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ───────────────────── 2 · quem recebe o quê ───────────────────── */}
          {aba === 'regras' && (
            <div role="tabpanel" id="painel-regras" aria-labelledby="aba-regras" className="flex animate-sobe flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {escopo && (
                  <p className="min-w-0 flex-[1_1_260px] text-[12.5px] text-farol-suave">
                    Valendo agora:{' '}
                    <b className="font-semibold text-farol-tinta">
                      {escopo.vigente === 'loja' ? 'regras desta loja' : 'padrão da rede'}
                    </b>
                    . {frase(escopo.explicacao)}
                  </p>
                )}
                {configura && (
                  <Botao variante="primario" className="ml-auto" onClick={() => setGaveta('regra')}>
                    <Plus className="h-[18px] w-[18px]" aria-hidden />
                    Nova regra
                  </Botao>
                )}
              </div>

              <Alerta icone={Info}>
                Sem regra que case, <b className="font-semibold text-farol-tinta">emergência e urgente chegam a todos os destinos ligados</b>{' '}
                e o resto fica calado. Um aviso a mais incomoda por um instante; uma emergência não vista tira a
                razão de ser do produto. Para silenciar uma combinação, crie uma regra de não avisar.
              </Alerta>

              {politicas.length === 0 ? (
                <p className={`${CARTAO} px-4 py-6 text-farol-suave`}>Nenhuma regra. Vale o padrão descrito acima.</p>
              ) : (
                <Tabela
                  legenda="Regras de aviso desta loja"
                  colunas={[
                    { rotulo: 'Quando for' },
                    { rotulo: 'O que fazer' },
                    { rotulo: 'Para quem' },
                    { rotulo: 'Vale em' },
                    { rotulo: 'Ações', soLeitor: true },
                  ]}
                >
                  {politicas.map((p) => {
                    // Quando a loja tem regras próprias, as da rede não agem aqui.
                    const semEfeito = escopo?.vigente === 'loja' && p.da_rede;
                    const grave = p.severidade === 'critico' || p.severidade === 'emergencia';
                    return (
                      <Linha key={p.id} apagada={semEfeito}>
                        <Celula inteira>
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <Chip tom={grave ? 'critico' : 'neutro'}>
                              {p.severidade ? nomeDaSeveridade(p.severidade) : 'qualquer gravidade'}
                            </Chip>
                            <Chip>{p.prioridade ? nomeDaPrioridade(p.prioridade) : 'qualquer prioridade'}</Chip>
                          </span>
                        </Celula>
                        <Celula rotulo="O que fazer">
                          {p.enviar ? (
                            <Chip tom="ok" icone={BellRing}>
                              avisar
                            </Chip>
                          ) : (
                            <Chip icone={BellOff}>não avisar</Chip>
                          )}
                        </Celula>
                        <Celula rotulo="Para quem">{p.destino_nome ?? '—'}</Celula>
                        <Celula rotulo="Vale em">
                          {p.da_rede ? 'rede inteira' : 'esta loja'}
                          {semEfeito && <span className="text-farol-suave"> · sem efeito aqui</span>}
                        </Celula>
                        <Celula inteira acao>
                          {configura && (
                            <Botao mini variante="perigo-leve" onClick={() => void removerPolitica(p)}>
                              Remover<span className="sr-only"> esta regra</span>
                            </Botao>
                          )}
                        </Celula>
                      </Linha>
                    );
                  })}
                </Tabela>
              )}
            </div>
          )}

          {/* ───────────────────── 3 · chegou? ───────────────────── */}
          {aba === 'chegou' && (
            <div role="tabpanel" id="painel-chegou" aria-labelledby="aba-chegou" className="flex animate-sobe flex-col gap-3">
              <p className="max-w-[70ch] text-[12.5px] text-farol-suave">
                <b className="font-semibold text-farol-tinta">Mandado</b> quer dizer que o aviso saiu do Farol.{' '}
                <b className="font-semibold text-farol-tinta">Chegou</b> quer dizer que quem entrega confirmou. A
                diferença entre os dois explica um aviso que ninguém viu.
              </p>

              {envios.length === 0 ? (
                <p className={`${CARTAO} px-4 py-6 text-farol-suave`}>
                  Nenhum aviso ainda. Aparece aqui quando um critério ligado ficar fora do combinado.
                </p>
              ) : (
                <Tabela
                  legenda="Últimos avisos enviados"
                  colunas={[
                    { rotulo: 'Quando' },
                    { rotulo: 'Motivo' },
                    { rotulo: 'Para' },
                    { rotulo: 'Situação' },
                    { rotulo: 'Tentativas', numero: true },
                    { rotulo: 'Confirmado', numero: true },
                  ]}
                >
                  {envios.map((e) => {
                    const es = ESTADO[e.estado] ?? { rotulo: e.estado, tom: 'neutro' as Tom, icone: Clock };
                    return (
                      <Linha key={e.id}>
                        <Celula rotulo="Quando">
                          <span className="whitespace-nowrap font-mono text-[12.5px]">{diaEHora(e.criado_em)}</span>
                        </Celula>
                        <Celula inteira>
                          <span className="flex items-center gap-[7px] font-semibold">
                            {e.motivo === 'agente_caiu' ? (
                              <>
                                <Unplug className="h-[15px] w-[15px] shrink-0 text-farol-critico" aria-hidden />
                                Agente sem sinal
                              </>
                            ) : e.motivo === 'computador' ? (
                              e.computador === 'sobrecarregado' ? (
                                <>
                                  <Gauge className="h-[15px] w-[15px] shrink-0 text-farol-facho-icone" aria-hidden />
                                  Computador sobrecarregado
                                </>
                              ) : e.computador === 'disco' ? (
                                <>
                                  <HardDrive className="h-[15px] w-[15px] shrink-0 text-farol-facho-icone" aria-hidden />
                                  Disco quase cheio
                                </>
                              ) : (
                                <>
                                  <Thermometer className="h-[15px] w-[15px] shrink-0 text-farol-critico" aria-hidden />
                                  Computador esquentando
                                </>
                              )
                            ) : (
                              (e.regra_nome ?? 'Critério excluído')
                            )}
                          </span>
                        </Celula>
                        <Celula rotulo="Para">{e.destino_nome}</Celula>
                        <Celula rotulo="Situação">
                          <Chip tom={es.tom} icone={es.icone}>
                            {es.rotulo}
                          </Chip>
                          {e.erro && <small className="mt-0.5 block text-xs text-farol-suave">{e.erro}</small>}
                        </Celula>
                        <Celula rotulo="Tentativas" numero>
                          {e.tentativas}
                        </Celula>
                        <Celula rotulo="Confirmado" numero>
                          {diaEHora(e.confirmado_em)}
                        </Celula>
                      </Linha>
                    );
                  })}
                </Tabela>
              )}
            </div>
          )}
        </>
      )}

      {gaveta === 'destino' && (
        <GavetaDoDestino
          lojaId={id}
          aoFechar={() => setGaveta(null)}
          aoSalvar={async () => {
            setGaveta(null);
            await carregar();
            avisar('Destino cadastrado.');
          }}
        />
      )}

      {gaveta === 'regra' && destinos && (
        <GavetaDaRegra
          lojaId={id}
          destinos={destinos}
          aoFechar={() => setGaveta(null)}
          aoSalvar={async () => {
            setGaveta(null);
            await carregar();
            avisar('Regra salva.');
          }}
        />
      )}
    </>
  );
}
