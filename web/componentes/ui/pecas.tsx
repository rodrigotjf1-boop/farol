// Peças pequenas que aparecem em toda tela: pastilha, ponto de estado,
// interruptor, controle segmentado, aviso em linha, vazio e esqueleto.

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// ───────────────────────── pastilha ─────────────────────────

export type Tom = 'neutro' | 'ok' | 'atencao' | 'critico' | 'vazado';

const TOM: Record<Tom, string> = {
  neutro: 'bg-farol-realce text-farol-suave',
  ok: 'bg-farol-ok-leve text-farol-ok',
  atencao: 'bg-farol-facho-leve text-farol-facho-tinta',
  critico: 'bg-farol-critico-leve text-farol-critico',
  vazado: 'text-farol-suave shadow-[inset_0_0_0_1px_rgb(var(--borda-forte))]',
};

export function Chip({
  tom = 'neutro',
  icone: Icone,
  title,
  quebra = false,
  children,
}: {
  tom?: Tom;
  icone?: LucideIcon;
  title?: string;
  /** O texto pode quebrar a linha (um nome de produto, que não tem tamanho certo); o padrão é numa linha só. */
  quebra?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${quebra ? 'max-w-full break-words' : 'whitespace-nowrap'} ${TOM[tom]}`}
    >
      {Icone && <Icone className="h-[13px] w-[13px] shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

/** O ponto colorido de estado. `pulsa` é o único movimento em laço do
 *  console, e só existe para dizer "ao vivo". */
export function Ponto({ tom = 'neutro', pulsa = false }: { tom?: 'neutro' | 'ok' | 'atencao' | 'critico'; pulsa?: boolean }) {
  const cor = { neutro: 'bg-farol-suave', ok: 'bg-farol-ok', atencao: 'bg-farol-facho', critico: 'bg-farol-critico' }[tom];
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${cor} ${pulsa ? 'animate-onda' : ''}`} />;
}

// ───────────────────────── interruptor ─────────────────────────

export function Liga({
  ligado,
  aoMudar,
  descricao,
  rotulo,
  desabilitado = false,
  title,
}: {
  ligado: boolean;
  aoMudar: (novo: boolean) => void;
  /** O que este interruptor liga, para quem não vê a tela. */
  descricao: string;
  /** Texto ao lado do interruptor ("Ligado"). */
  rotulo?: string;
  desabilitado?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={descricao}
      title={title}
      disabled={desabilitado}
      onClick={() => aoMudar(!ligado)}
      className={`inline-flex items-center gap-2 py-1 text-[12.5px] font-medium disabled:opacity-60 ${
        ligado ? 'text-farol-ok' : 'text-farol-suave'
      }`}
    >
      <span
        aria-hidden
        className={`relative h-[22px] w-9 shrink-0 rounded-full transition-colors duration-200 ${
          ligado ? 'bg-farol-ok' : 'bg-farol-borda-forte'
        }`}
      >
        <span
          className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-farol-painel shadow-farol-1 transition-transform duration-200 ease-farol ${
            ligado ? 'translate-x-[14px]' : ''
          }`}
        />
      </span>
      {rotulo && <span>{rotulo}</span>}
    </button>
  );
}

// ───────────────────── controle segmentado ─────────────────────

export function Segmentado<T extends string>({
  rotulo,
  opcoes,
  valor,
  aoMudar,
}: {
  rotulo: string;
  /** `desativada` leva o motivo: aparece ao passar o mouse na opção apagada. */
  opcoes: ReadonlyArray<{ valor: T; rotulo: string; icone?: LucideIcon; desativada?: string | null }>;
  valor: T;
  aoMudar: (novo: T) => void;
}) {
  return (
    // Pílulas soltas (caminho "Comanda"): a escolhida desce um pouco e fica na cor da chapa. A borda segura o
    // contorno quando o grupo está sobre um cartão da mesma cor; no estreito, as pílulas quebram a linha.
    <div role="group" aria-label={rotulo} className="inline-flex max-w-full flex-wrap gap-1.5">
      {opcoes.map(({ icone: Icone, ...o }) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={o.valor === valor}
          disabled={Boolean(o.desativada)}
          title={o.desativada ?? undefined}
          onClick={() => aoMudar(o.valor)}
          className={`inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-full border px-3.5 font-display text-[15px] font-extrabold uppercase leading-none tracking-[.05em] transition duration-300 ease-mola disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-10 ${
            o.valor === valor
              ? 'translate-y-[2px] border-farol-marca bg-farol-marca text-farol-sobre-marca'
              : 'border-farol-borda bg-farol-painel text-farol-tinta shadow-farol-1 enabled:hover:-translate-y-px'
          }`}
        >
          {Icone && <Icone className="h-[15px] w-[15px] shrink-0" aria-hidden />}
          {/* `truncate` corta o que sai da caixa da linha: com `leading-none`, o acento das MAIÚSCULAS ("ÚLTIMAS",
              "MEMÓRIA") sumia. A linha de 1,25 dá lugar ao acento; a pílula tem altura mínima e não cresce. */}
          <span className="truncate py-px leading-[1.25]">{o.rotulo}</span>
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── aviso em linha ─────────────────────────

/** Recado que fica na página. Erro que pede ação mora aqui, não num aviso
 *  que some sozinho. */
export function Alerta({
  tom = 'neutro',
  icone: Icone,
  papel,
  children,
}: {
  tom?: 'neutro' | 'atencao' | 'critico' | 'ok';
  icone?: LucideIcon;
  /** `alert` interrompe o leitor de tela; `status` espera a vez. */
  papel?: 'alert' | 'status';
  children: ReactNode;
}) {
  const cor = {
    neutro: 'border border-farol-borda bg-farol-painel-2 text-farol-suave',
    atencao: 'bg-farol-facho-leve text-farol-facho-tinta',
    critico: 'bg-farol-critico-leve text-farol-critico',
    ok: 'bg-farol-ok-leve text-farol-ok',
  }[tom];
  return (
    <div role={papel} className={`flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] ${cor}`}>
      {Icone && <Icone className="mt-px h-[18px] w-[18px] shrink-0" aria-hidden />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ───────────────────────── vazio ─────────────────────────

/** Tela sem nada ainda: diz o que é e qual o primeiro passo. */
export function Vazio({
  icone: Icone,
  titulo,
  children,
  acao,
}: {
  icone: LucideIcon;
  titulo: string;
  children: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-farol-borda-forte px-5 py-11 text-center">
      <span className="mb-1 grid h-[52px] w-[52px] place-items-center rounded-2xl bg-farol-realce text-farol-marca">
        <Icone className="h-[22px] w-[22px]" aria-hidden />
      </span>
      <h2 className="text-balance font-display text-[28px] font-black uppercase leading-[.95] md:text-[34px]">{titulo}</h2>
      <p className="max-w-[52ch] text-farol-suave">{children}</p>
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

// ───────────────────────── esqueleto ─────────────────────────

/** Blocos do tamanho do que vai chegar, para nada pular quando carregar. */
export function Ossos({ alturas }: { alturas: Array<number | number[]> }) {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {alturas.map((a, i) =>
        Array.isArray(a) ? (
          <div key={i} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {a.map((h, j) => (
              <div key={j} className="osso" style={{ height: h }} />
            ))}
          </div>
        ) : (
          <div key={i} className="osso" style={{ height: a }} />
        ),
      )}
    </div>
  );
}

// ───────────────────────── cabeçalho da tela ─────────────────────────

export function Cabecalho({
  sobre,
  titulo,
  children,
  acoes,
}: {
  /** A linha pequena acima do título: de quem é esta tela. */
  sobre?: ReactNode;
  titulo: ReactNode;
  /** A frase que diz o que se resolve aqui. */
  children?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-5 gap-y-3.5">
      <div className="min-w-0 flex-[1_1_320px]">
        {sobre && (
          // A linha de cima, em letra de recibo: de quem é esta tela.
          <p className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[.08em] text-farol-suave">
            {sobre}
          </p>
        )}
        {/* O título da placa de cardápio: alto, estreito e em maiúsculas (caminho "Comanda"). */}
        <h1 className="mt-1 text-balance font-display text-[40px] font-black uppercase leading-[.9] tracking-[.005em] md:text-[56px]">
          {titulo}
        </h1>
        {children && <p className="mt-1 max-w-[62ch] text-farol-suave">{children}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2 max-md:w-full max-md:[&>*]:flex-auto">{acoes}</div>}
    </header>
  );
}

/** O cartão: o papel sobre a bancada — sombra leve e a borda quase sumindo (ela segura o contorno no tema escuro). */
export const CARTAO = 'min-w-0 rounded-[22px] border border-farol-borda/60 bg-farol-painel shadow-farol-1';

/** Título de seção, com contador opcional. */
export function Titulo({ id, children, conta }: { id?: string; children: ReactNode; conta?: number }) {
  return (
    <h2 id={id} className="flex items-center gap-2 font-display text-[19px] font-extrabold uppercase leading-tight tracking-[.04em]">
      {children}
      {conta !== undefined && conta > 0 && (
        // O número em letra mono: na letra do título, o "1" parece um "I".
        <span className="min-w-5 rounded-full bg-farol-facho-leve px-1.5 text-center font-mono text-xs font-semibold leading-5 text-farol-facho-tinta">
          {conta}
        </span>
      )}
    </h2>
  );
}
