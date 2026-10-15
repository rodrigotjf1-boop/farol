'use client';

// =====================================================================
// Conexões — de onde o Farol lê o que as lojas vendem e produzem
// =====================================================================
// Tela da CONTA, não de uma loja. As fichas de uma loja vêm de UM de três
// lugares: do Regem (esta tela conecta e liga as lojas), de outro sistema
// (a diretoria cria aqui o acesso dele) ou de uma planilha (importada na
// tela Fichas da loja). Os cartões do outro sistema e da planilha moram em
// `componentes/conexoes/outro-sistema.tsx`.
//
// O Regem:
//
// O caminho, do protótipo aprovado em 11/10/2026
// (`mockups/farol-conexoes-e-fichas.html`):
//
//   sem conexão → "Conectar ao Regem" leva à página de autorização de lá →
//   a pessoa volta com as lojas autorizadas → diz qual loja do Farol é
//   cada uma ("Ligar as lojas") → conectado.
//
// Só a diretoria conecta, liga e desconecta. O gerente e o suporte veem a
// tela, sem os botões — e quem decide é a API: aqui só se esconde.
//
// Cada loja ligada tem as fichas lidas na hora e, depois, uma vez por dia;
// a linha dela diz quando foi a última busca boa, se a última falhou e o
// que a base tem. A tela diz o que o Farol PODE ler pela conexão — a fila
// da cozinha está liberada e ainda não é lida. Frase de tela só vale com o
// serviço que a sustenta.
// =====================================================================

import { ArrowRight, Building2, Check, ExternalLink, Lock, Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { diaFaladoNaLoja, frase, plural } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Vazio } from '@/componentes/ui/pecas';
import { Dialogo } from '@/componentes/ui/sobreposto';
import { AvisoDosAcessos, OutroSistema, Planilha } from '@/componentes/conexoes/outro-sistema';
import { acessosApi, ErroDaApi, regemApi, type AcessosDaConta, type ConexaoComORegem, type LojaDoRegemEsperando, type LojaDoRegemLigada, type VoltaDoRegem } from '@/lib/api';

/** "Não usar esta loja agora": o acesso dela é devolvido ao Regem. */
const NAO_USAR = '';

type Recado = { tom: 'neutro' | 'atencao' | 'critico'; texto: string };

// O que dizer quando a volta do Regem não termina em "autorizado".
const RECADO_DA_VOLTA: Partial<Record<VoltaDoRegem, Recado>> = {
  cancelado: { tom: 'neutro', texto: 'A autorização foi cancelada no Regem. Nada mudou por aqui.' },
  vencido: { tom: 'atencao', texto: 'O pedido de conexão venceu: ele vale dez minutos. Comece de novo.' },
  outra_conta: { tom: 'atencao', texto: 'Esta volta do Regem não é de um pedido feito por você nesta conta. Comece de novo por aqui.' },
  sem_permissao: { tom: 'atencao', texto: 'Só a diretoria conecta o Regem.' },
  invalido: { tom: 'atencao', texto: 'Este pedido de conexão não vale mais. Comece de novo.' },
  falhou: {
    tom: 'critico',
    texto: 'Não deu para concluir a conexão com o Regem. Tente de novo em instantes; se continuar, fale com quem cuida do Farol.',
  },
};

/** De quanto em quanto tempo a tela pergunta de novo enquanto a primeira busca de uma loja não termina. */
const ESPERA_DA_BUSCA_MS = 3000;
const MAX_PERGUNTAS = 20;

const mensagemDe = (e: unknown): string => (e instanceof ErroDaApi ? e.message : 'não deu certo');

// ───────────────────── o que a conexão libera ─────────────────────

function Lista({ titulo, itens, icone: Icone, tom }: { titulo: string; itens: React.ReactNode[]; icone: typeof Check; tom: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[13px] font-semibold">{titulo}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {itens.map((item, i) => (
          // A lista é fixa, escrita aqui: a posição serve de chave.
          <li key={i} className="flex items-start gap-2 text-[13px] text-farol-suave">
            <Icone className={`mt-0.5 h-[15px] w-[15px] shrink-0 ${tom}`} aria-hidden />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OQueLibera() {
  const forte = (t: string) => <b className="font-semibold text-farol-tinta">{t}</b>;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Lista
        titulo="O que o Farol pode ler de cada loja"
        icone={Check}
        tom="text-farol-ok"
        itens={[
          <>{forte('O cardápio')} — produtos, variações e adicionais</>,
          <>{forte('As fichas técnicas')} — os ingredientes de cada uma, na ordem</>,
          <>{forte('A fila da cozinha')} — o que foi pedido, com a observação</>,
        ]}
      />
      <Lista
        titulo="O que ele não lê"
        icone={Lock}
        tom="text-farol-suave"
        itens={['Preço, custo e margem', 'Quem é o cliente', 'Vendas, caixa, estoque e equipe']}
      />
    </div>
  );
}

function CabecaDoCartao({ id, titulo, children }: { id: string; titulo: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-farol-borda px-[18px] py-3.5">
      <h2 id={id} className="font-display text-lg font-semibold leading-tight tracking-tight">
        {titulo}
      </h2>
      {children}
    </header>
  );
}

// ───────────────────────── sem conexão ─────────────────────────

function SemConexao({
  c,
  indo,
  erro,
  aoConectar,
}: {
  c: ConexaoComORegem;
  indo: boolean;
  erro: string | null;
  aoConectar: () => void;
}) {
  const id = useId();
  return (
    <section className={CARTAO} aria-labelledby={id} data-cartao="sem-conexao">
      <CabecaDoCartao id={id} titulo="Regem">
        <span className="ml-auto">
          <Chip>não conectado</Chip>
        </span>
      </CabecaDoCartao>
      <div className="flex flex-col gap-4 p-[18px]">
        <p className="max-w-[68ch]">
          O Regem é onde a loja cadastra o cardápio e as fichas técnicas. Conectado, o Farol passa a saber o que cada loja
          vende e como cada produto deve ser montado.
        </p>
        <OQueLibera />
        <div>
          <h3 className="text-[13px] font-semibold">Como funciona</h3>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-farol-suave marker:font-semibold marker:text-farol-tinta">
            <li>Você vai para o Regem, já com a sua conta de lá.</li>
            <li>Marca as lojas e autoriza.</li>
            <li>Volta para cá e diz qual loja do Farol é cada uma.</li>
          </ol>
        </div>

        {erro && (
          <Alerta tom="critico" icone={TriangleAlert} papel="alert">
            {erro}
          </Alerta>
        )}

        {!c.podeConectar ? (
          <Alerta icone={Lock}>
            <b className="font-semibold text-farol-tinta">Só a diretoria conecta o Regem.</b> Deixar outro sistema ser lido é
            decisão dela.
          </Alerta>
        ) : !c.disponivel ? (
          <Alerta icone={Lock}>
            <b className="font-semibold text-farol-tinta">A conexão com o Regem ainda não está disponível nesta conta.</b> Fale com
            quem cuida do Farol.
          </Alerta>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2.5">
              <Botao variante="primario" ocupado={indo} onClick={aoConectar}>
                {!indo && <ExternalLink className="h-4 w-4" aria-hidden />}
                {indo ? 'Indo para o Regem…' : 'Conectar ao Regem'}
              </Botao>
            </div>
            <p className={AJUDA}>Nenhuma senha é digitada aqui. Quem autoriza, no Regem, é o presidente da empresa.</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ───────────────────────── ligar as lojas ─────────────────────────

function LigarAsLojas({
  c,
  aoSalvar,
}: {
  c: ConexaoComORegem;
  /** Devolve o erro a mostrar no cartão, ou nulo se deu certo. */
  aoSalvar: (pares: Array<{ id: string; lojaId: string | null }>) => Promise<string | null>;
}) {
  const id = useId();
  // A escolha de cada loja do Regem: o id da loja do Farol, `NAO_USAR`, ou
  // nada ainda (indefinido) — sem sugestão, quem escolhe é a pessoa, e não
  // um valor de fábrica que devolveria o acesso sem ninguém ter decidido.
  const [escolhas, setEscolhas] = useState<Record<string, string | undefined>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O estado inicial sai do que o servidor mandou. Quando a lista muda (uma
  // loja saiu, outra chegou), quem já tinha escolha a mantém.
  useEffect(() => {
    setEscolhas((antes) => {
      const livres = new Set(c.lojasLivres.map((l) => l.id));
      const novo: Record<string, string | undefined> = {};
      for (const e of c.esperando) {
        const tinha = antes[e.id];
        const aindaVale = tinha === NAO_USAR || (tinha !== undefined && livres.has(tinha));
        novo[e.id] = aindaVale ? tinha : (e.sugestaoLojaId ?? undefined);
      }
      return novo;
    });
  }, [c.esperando, c.lojasLivres]);

  const vezes = useMemo(() => {
    const conta = new Map<string, number>();
    for (const v of Object.values(escolhas)) if (v) conta.set(v, (conta.get(v) ?? 0) + 1);
    return conta;
  }, [escolhas]);
  const repetida = (lojaId: string | undefined) => Boolean(lojaId) && (vezes.get(lojaId!) ?? 0) > 1;
  const haRepetida = c.esperando.some((e) => repetida(escolhas[e.id]));
  const faltam = c.esperando.filter((e) => escolhas[e.id] === undefined).length;
  const houveSugestao = c.esperando.some((e) => e.sugestaoLojaId !== null);

  const empresas = [...new Set(c.esperando.map((e) => e.regemEmpresaNome))];
  const n = c.esperando.length;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const recado = await aoSalvar(c.esperando.map((e) => ({ id: e.id, lojaId: escolhas[e.id] || null })));
    setErro(recado);
    setSalvando(false);
  }

  return (
    <section className={CARTAO} aria-labelledby={id} data-cartao="ligar">
      <CabecaDoCartao id={id} titulo="Ligar as lojas">
        <span className="ml-auto">
          <Chip tom="ok">autorizado no Regem</Chip>
        </span>
      </CabecaDoCartao>
      <div className="flex flex-col gap-4 p-[18px]">
        <p className="max-w-[68ch]">
          {empresas.length === 1 ? (
            <>
              <b className="font-semibold">{empresas[0]}</b> autorizou {plural(n, 'loja', 'lojas')}.
            </>
          ) : (
            <>{n === 1 ? 'Uma loja foi autorizada' : `${n} lojas foram autorizadas`} no Regem.</>
          )}{' '}
          Diga qual loja do Farol é cada uma.
        </p>

        <div className="flex flex-col gap-3">
          {c.esperando.map((e) => (
            <Par
              key={e.id}
              loja={e}
              comEmpresa={empresas.length > 1}
              livres={c.lojasLivres}
              valor={escolhas[e.id]}
              repetida={repetida(escolhas[e.id])}
              travado={!c.podeConectar || salvando}
              aoMudar={(v) => setEscolhas((antes) => ({ ...antes, [e.id]: v }))}
            />
          ))}
        </div>

        <p className={AJUDA}>
          {houveSugestao && 'O Farol sugeriu os pares pelo nome: confira antes de salvar. '}A loja que ficar sem par não é lida, e o
          acesso dela é devolvido ao Regem.
        </p>

        {erro && (
          <Alerta tom="critico" icone={TriangleAlert} papel="alert">
            {erro}
          </Alerta>
        )}

        {c.podeConectar ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Botao variante="primario" ocupado={salvando} disabled={haRepetida || faltam > 0} onClick={salvar}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Botao>
            {faltam > 0 && (
              <span className={AJUDA}>
                Falta escolher {faltam === 1 ? 'a loja de uma delas' : `a loja de ${faltam} delas`}.
              </span>
            )}
          </div>
        ) : (
          <Alerta icone={Lock}>
            <b className="font-semibold text-farol-tinta">Só a diretoria liga as lojas.</b>
          </Alerta>
        )}
      </div>
    </section>
  );
}

function Par({
  loja,
  comEmpresa,
  livres,
  valor,
  repetida,
  travado,
  aoMudar,
}: {
  loja: LojaDoRegemEsperando;
  comEmpresa: boolean;
  livres: ConexaoComORegem['lojasLivres'];
  valor: string | undefined;
  repetida: boolean;
  travado: boolean;
  aoMudar: (novo: string) => void;
}) {
  const id = useId();
  return (
    <div
      data-par={loja.id}
      className={`grid grid-cols-1 items-center gap-x-3 gap-y-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ${
        repetida ? 'border-farol-critico' : 'border-farol-borda'
      }`}
    >
      <div className="min-w-0">
        <b className="block break-words font-semibold">{loja.regemLojaNome}</b>
        <small className="text-xs text-farol-suave">{comEmpresa ? `${loja.regemEmpresaNome}, no Regem` : 'no Regem'}</small>
      </div>
      <ArrowRight className="hidden h-4 w-4 shrink-0 text-farol-suave sm:block" aria-hidden />
      <div className="flex min-w-0 flex-col gap-[5px]">
        <label htmlFor={id} className={ROTULO}>
          No Farol
        </label>
        <select
          id={id}
          className="entrada"
          value={valor ?? 'escolha'}
          disabled={travado}
          aria-invalid={repetida || undefined}
          aria-describedby={repetida ? `${id}-erro` : undefined}
          onChange={(ev) => aoMudar(ev.target.value)}
        >
          {valor === undefined && (
            <option value="escolha" disabled>
              Escolha a loja…
            </option>
          )}
          {livres.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
          <option value={NAO_USAR}>Não usar esta loja agora</option>
        </select>
        {repetida && (
          <small id={`${id}-erro`} role="alert" className="text-xs text-farol-critico">
            Duas lojas do Regem na mesma loja do Farol. Escolha outra.
          </small>
        )}
        {livres.length === 0 && <small className={AJUDA}>Todas as lojas do Farol já têm par.</small>}
      </div>
    </div>
  );
}

// ───────────────────────── conectado ─────────────────────────

/** Como vai a leitura das fichas da loja, numa pastilha e uma frase curta. */
function SituacaoDaLeitura({ l }: { l: LojaDoRegemLigada }) {
  const { leitura, fuso } = l;
  if (leitura.acessoTiradoEm) {
    return (
      <>
        <Chip tom="critico">acesso tirado no Regem</Chip>
        <span className="text-xs text-farol-suave">{diaFaladoNaLoja(leitura.acessoTiradoEm, fuso)}</span>
      </>
    );
  }
  if (leitura.falhou) {
    return (
      <>
        <Chip tom="critico">a última busca falhou</Chip>
        <span className="text-xs text-farol-suave">tenta de novo sozinho</span>
      </>
    );
  }
  if (leitura.lidaEm) return <Chip tom="ok">atualizado {diaFaladoNaLoja(leitura.lidaEm, fuso)}</Chip>;
  return <Chip>buscando as fichas…</Chip>;
}

/** "7 produtos · 3 com ficha" — ou o que houve com as fichas. */
function oQueABaseTem(l: LojaDoRegemLigada): string {
  if (l.leitura.acessoTiradoEm) return 'as fichas foram apagadas';
  if (l.produtos === null) return '';
  const fichas = l.comFicha ? `${l.comFicha} com ficha` : 'nenhuma ficha';
  return `${plural(l.produtos, 'produto', 'produtos')} · ${fichas}`;
}

function Conectadas({
  c,
  indo,
  erro,
  aoConectar,
  aoPedirParaDesconectar,
}: {
  c: ConexaoComORegem;
  indo: boolean;
  erro: string | null;
  aoConectar: () => void;
  aoPedirParaDesconectar: (l: LojaDoRegemLigada) => void;
}) {
  const id = useId();
  const idLibera = useId();
  const empresas = [...new Set(c.ligadas.map((l) => l.regemEmpresaNome))];

  return (
    <>
      <section className={CARTAO} aria-labelledby={id} data-cartao="conectadas">
        <CabecaDoCartao id={id} titulo="Regem">
          <Chip tom="ok">conectado</Chip>
          {empresas.length === 1 && <span className="min-w-0 break-words text-[13px] text-farol-suave">{empresas[0]}</span>}
          {c.podeConectar && c.disponivel && (
            <span className="ml-auto">
              <Botao mini ocupado={indo} onClick={aoConectar}>
                {!indo && <Plus className="h-[15px] w-[15px]" aria-hidden />}
                {indo ? 'Indo para o Regem…' : 'Autorizar outra loja'}
              </Botao>
            </span>
          )}
        </CabecaDoCartao>
        {erro && (
          <div className="px-[18px] pt-3.5">
            <Alerta tom="critico" icone={TriangleAlert} papel="alert">
              {erro}
            </Alerta>
          </div>
        )}
        <ul className="flex flex-col">
          {c.ligadas.map((l) => (
            <li
              key={l.id}
              data-ligada={l.id}
              className="grid grid-cols-1 items-center gap-x-4 gap-y-2.5 border-b border-farol-borda px-[18px] py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <b className="block break-words font-semibold">{l.lojaNome}</b>
                <small className="block break-words text-xs text-farol-suave">
                  {l.regemLojaNome}
                  {empresas.length > 1 ? ` · ${l.regemEmpresaNome}` : ''}, no Regem
                </small>
              </div>
              <div className="flex min-w-0 flex-col items-start gap-1" data-estado>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <SituacaoDaLeitura l={l} />
                </span>
                <span className="font-mono text-xs text-farol-suave">{oQueABaseTem(l)}</span>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {!l.leitura.acessoTiradoEm && (
                  <Link href={`/lojas/${l.lojaId}/fichas`} className={classesDoBotao({ mini: true })}>
                    Ver fichas
                  </Link>
                )}
                {c.podeConectar && l.leitura.acessoTiradoEm && c.disponivel && (
                  <Botao mini ocupado={indo} onClick={aoConectar}>
                    {!indo && <ExternalLink className="h-[15px] w-[15px]" aria-hidden />}
                    Conectar de novo
                  </Botao>
                )}
                {c.podeConectar && (
                  <Botao mini variante="perigo-leve" data-desconectar={l.id} onClick={() => aoPedirParaDesconectar(l)}>
                    Desconectar
                  </Botao>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={CARTAO} aria-labelledby={idLibera} data-cartao="libera">
        <CabecaDoCartao id={idLibera} titulo="O que esta conexão libera" />
        <div className="flex flex-col gap-3.5 p-[18px]">
          <OQueLibera />
          <p className={AJUDA}>
            O Farol busca as fichas quando a loja é ligada e, depois, uma vez por dia — ficha técnica não muda a toda hora. Para
            trazer uma mudança na hora, a tela Fichas tem o “Buscar agora”.
          </p>
          <p className={AJUDA}>
            O acesso também pode ser tirado pelo Regem, em <b className="font-semibold text-farol-tinta">Configurações → Aplicativos conectados</b>.
            Aqui ele aparece como “acesso tirado no Regem”, e as fichas daquela loja são apagadas.
          </p>
        </div>
      </section>
    </>
  );
}

// ───────────────────────── a tela ─────────────────────────

export default function Conexoes() {
  const router = useRouter();
  const avisar = useAvisar();

  const [c, setC] = useState<ConexaoComORegem | null>(null);
  const [acessos, setAcessos] = useState<AcessosDaConta | null>(null);
  const [falha, setFalha] = useState<{ semPermissao: boolean; texto: string } | null>(null);
  const [recado, setRecado] = useState<Recado | null>(null);
  const [indo, setIndo] = useState(false);
  const [erroAoConectar, setErroAoConectar] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<LojaDoRegemLigada | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  const [erroAoDesconectar, setErroAoDesconectar] = useState<string | null>(null);

  const buscar = useCallback(async (): Promise<ConexaoComORegem | null> => {
    try {
      // As duas metades da tela: a conexão com o Regem e os acessos de outro sistema (com a origem de cada loja).
      const [r, a] = await Promise.all([regemApi.obter(), acessosApi.obter()]);
      setC(r);
      setAcessos(a);
      setFalha(null);
      return r;
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 401) {
        router.replace('/entrar');
        return null;
      }
      setFalha({ semPermissao: e instanceof ErroDaApi && e.status === 403, texto: mensagemDe(e) });
      return null;
    }
  }, [router]);

  // A volta do Regem chega pelo endereço (`?regem=…`). Lido uma vez, sai
  // da barra: recarregar a tela não repete o recado.
  useEffect(() => {
    const volta = new URLSearchParams(window.location.search).get('regem') as VoltaDoRegem | null;
    if (volta) {
      if (volta === 'autorizado') avisar('Autorizado no Regem.');
      else setRecado(RECADO_DA_VOLTA[volta] ?? null);
      router.replace('/conexoes');
    }
    void buscar();
    // Só na chegada: o endereço é lido uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function conectar() {
    setIndo(true);
    setErroAoConectar(null);
    setRecado(null);
    try {
      const { url } = await regemApi.conectar();
      // Sai do console: a página de autorização é do Regem. `indo` fica
      // ligado de propósito — a tela está de saída.
      window.location.assign(url);
    } catch (e) {
      setErroAoConectar(frase(mensagemDe(e)));
      setIndo(false);
    }
  }

  async function salvarPares(pares: Array<{ id: string; lojaId: string | null }>): Promise<string | null> {
    setRecado(null);
    try {
      const r = await regemApi.ligar(pares);
      await buscar();
      const devolvidas = r.descartadas > 0 ? ` O acesso de ${plural(r.descartadas, 'loja foi devolvido', 'lojas foi devolvido')} ao Regem.` : '';
      if (r.ligadas > 0) avisar(`${plural(r.ligadas, 'loja ligada', 'lojas ligadas')}. O Farol está buscando as fichas agora.${devolvidas}`);
      else if (r.descartadas > 0) avisar('Nenhuma loja foi ligada: o acesso foi devolvido ao Regem.');
      if (r.naoDescartadas.length > 0) {
        const nomes = r.naoDescartadas.map((l) => l.regemLojaNome).join(', ');
        return `O Regem não respondeu agora: o acesso de ${nomes} não foi devolvido, e ${
          r.naoDescartadas.length === 1 ? 'ela continua' : 'elas continuam'
        } esperando. Tente de novo em instantes.`;
      }
      return null;
    } catch (e) {
      // A lista pode ter mudado por baixo (outra pessoa ligou): mostra o que vale agora.
      await buscar();
      return frase(mensagemDe(e));
    }
  }

  async function desconectar() {
    if (!alvo) return;
    setDesconectando(true);
    setErroAoDesconectar(null);
    try {
      const r = await regemApi.desconectar(alvo.id);
      await buscar();
      setAlvo(null);
      if (r.devolvido) avisar(`A ${alvo.lojaNome} foi desconectada do Regem.${r.fichasApagadas ? ' As fichas dela foram apagadas.' : ''}`);
      else {
        // Pede providência: fica na página, não num aviso que some.
        setRecado({
          tom: 'atencao',
          texto: `A ${alvo.lojaNome} foi desconectada, mas o acesso dela ainda aparece no Regem. Tire-o por lá, em Configurações → Aplicativos conectados.`,
        });
      }
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 404) {
        // Outra pessoa já desconectou: o que se queria já aconteceu.
        await buscar();
        setAlvo(null);
      } else {
        setErroAoDesconectar(frase(mensagemDe(e)));
      }
    } finally {
      setDesconectando(false);
    }
  }

  const temEsperando = (c?.esperando.length ?? 0) > 0;
  const temLigadas = (c?.ligadas.length ?? 0) > 0;

  // Loja recém-ligada: a primeira busca das fichas corre no servidor. A
  // tela pergunta de novo de tempos em tempos até ela terminar (bem ou
  // mal) — e para sozinha.
  const perguntas = useRef(0);
  const haPrimeiraBusca = (c?.ligadas ?? []).some((l) => !l.leitura.lidaEm && !l.leitura.falhou && !l.leitura.acessoTiradoEm);
  useEffect(() => {
    if (!haPrimeiraBusca) {
      perguntas.current = 0;
      return;
    }
    const t = setInterval(() => {
      perguntas.current += 1;
      if (perguntas.current > MAX_PERGUNTAS) return clearInterval(t);
      if (document.visibilityState === 'visible') void buscar();
    }, ESPERA_DA_BUSCA_MS);
    return () => clearInterval(t);
  }, [haPrimeiraBusca, buscar]);

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Building2 className="h-[15px] w-[15px]" aria-hidden />
            Sua conta
          </>
        }
        titulo="Conexões"
      >
        De onde o Farol recebe o que as lojas vendem e produzem. Vale para a conta inteira; cada loja recebe as fichas de um lugar só.
      </Cabecalho>

      {recado && (
        <div data-recado>
          <Alerta tom={recado.tom} icone={recado.tom === 'neutro' ? undefined : TriangleAlert} papel={recado.tom === 'critico' ? 'alert' : 'status'}>
            {recado.texto}
          </Alerta>
        </div>
      )}

      {!c && !falha && <Ossos alturas={[56, 300]} />}

      {falha &&
        (falha.semPermissao ? (
          <Vazio icone={Lock} titulo="Esta tela é de quem configura a conta">
            Seu perfil não vê as conexões da conta.
          </Vazio>
        ) : (
          <Vazio
            icone={TriangleAlert}
            titulo="O console não respondeu"
            acao={
              <Botao
                variante="primario"
                onClick={() => {
                  setFalha(null);
                  setC(null);
                  void buscar();
                }}
              >
                Tentar de novo
              </Botao>
            }
          >
            Não deu para carregar esta tela ({falha.texto}). Nada foi perdido.
          </Vazio>
        ))}

      {c && !falha && (
        <>
          {/* O que os outros da diretoria fizeram nos acessos de outro sistema, até "Entendi". */}
          {acessos && <AvisoDosAcessos a={acessos} aoMudar={buscar} />}
          {temEsperando && <LigarAsLojas c={c} aoSalvar={salvarPares} />}
          {temLigadas && (
            <Conectadas
              c={c}
              indo={indo}
              erro={erroAoConectar}
              aoConectar={conectar}
              aoPedirParaDesconectar={(l) => {
                setErroAoDesconectar(null);
                setAlvo(l);
              }}
            />
          )}
          {!temEsperando && !temLigadas && <SemConexao c={c} indo={indo} erro={erroAoConectar} aoConectar={conectar} />}
          {/* As outras origens: o Regem é uma delas, não a única. */}
          {acessos && <OutroSistema a={acessos} aoMudar={buscar} />}
          {acessos && <Planilha a={acessos} />}
        </>
      )}

      {alvo && (
        <Dialogo
          titulo={`Desconectar a ${alvo.lojaNome} do Regem?`}
          rotuloConfirmar="Desconectar"
          rotuloOcupado="Desconectando…"
          rotuloCancelar="Manter"
          ocupado={desconectando}
          erro={erroAoDesconectar}
          aoConfirmar={desconectar}
          aoCancelar={() => setAlvo(null)}
        >
          {alvo.leitura.acessoTiradoEm ? (
            <p>
              O acesso desta loja já foi tirado no Regem, e as fichas dela já foram apagadas. Desconectar tira a ligação daqui: a
              loja do Farol fica livre para ser ligada de novo.
            </p>
          ) : (
            <p>
              O Farol para de ler o Regem desta loja agora, devolve o acesso e <strong>apaga as fichas que vieram de lá</strong>. Para
              ter as fichas de volta, é preciso autorizar outra vez no Regem.
            </p>
          )}
        </Dialogo>
      )}
    </>
  );
}
