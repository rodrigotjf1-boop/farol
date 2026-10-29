'use client';

// =====================================================================
// Ao vivo › "Ver no celular" — o link só do ao vivo (29/10/2026)
// =====================================================================
// O dono: "a ideia de ver do celular não é ter acesso completo ao webapp, é
// ver somente a movimentação ao vivo". Protótipo aprovado no mesmo dia, com
// o recomendado (`mockups/farol-link-ao-vivo.html`):
//
//   • "Novo link": para quem é e por quanto tempo vale (1, 7, 30 dias — o
//     padrão — ou até desligar). Criar mostra o código QR e o endereço: o
//     código aparece SÓ agora (o servidor guarda a impressão);
//   • o que quem tem o link vê e não vê;
//   • os links da loja, com o prazo, quem criou e o último acesso, e
//     "Desligar" (com a pergunta ali mesmo): para na hora.
//
// O endereço leva o código depois do "#" (`/ver#<código>`): essa parte o
// navegador não manda a servidor nenhum, e o código não para em registro.
// Antes (#231) o QR abria o console inteiro, com login.
// =====================================================================

import { Check, Copy, X } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { AJUDA, Campo } from '@/componentes/ui/campo';
import { Botao } from '@/componentes/ui/botao';
import { Alerta, Segmentado } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, linkAoVivoApi, type LinkAoVivo } from '@/lib/api';
import { duracao } from '@/lib/planta-viva';

/**
 * O endereço num código QR, em SVG (nítido em qualquer tamanho). Preto no branco nos dois temas, de propósito: é o que
 * a câmera de celular lê melhor; a borda branca de 4 módulos é a que a norma pede.
 */
export function CodigoQr({ texto, rotulo }: { texto: string; rotulo: string }) {
  const { n, caminho } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(texto);
    q.make();
    const lado = q.getModuleCount();
    let d = '';
    for (let r = 0; r < lado; r += 1) for (let c = 0; c < lado; c += 1) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n: lado, caminho: d };
  }, [texto]);
  const borda = 4;
  return (
    <svg
      viewBox={`${-borda} ${-borda} ${n + 2 * borda} ${n + 2 * borda}`}
      className="block aspect-square h-auto w-full max-w-[200px] rounded-[12px]"
      shapeRendering="crispEdges"
      role="img"
      aria-label={rotulo}
      data-qr={n}
    >
      <rect x={-borda} y={-borda} width={n + 2 * borda} height={n + 2 * borda} fill="#ffffff" />
      <path d={caminho} fill="#000000" />
    </svg>
  );
}

type Prazo = '1' | '7' | '30' | 'sempre';
const PRAZOS: ReadonlyArray<{ valor: Prazo; rotulo: string }> = [
  { valor: '1', rotulo: '1 dia' },
  { valor: '7', rotulo: '7 dias' },
  { valor: '30', rotulo: '30 dias' },
  { valor: 'sempre', rotulo: 'Até eu desligar' },
];
const NOME_MAXIMO = 40;
const VE = ['A planta, de cima e em 3D, com os setores em cores', 'As pessoas andando, pelo posto (sem nome)', 'Quantas pessoas há agora em cada setor'];
const NAO_VE = ['Imagem das câmeras, nem onde elas ficam', 'Histórico, relatórios, alertas, outras lojas', 'Nenhum botão que muda alguma coisa'];
const TITULO_DA_SECAO = 'font-display text-[19px] font-extrabold uppercase tracking-[.04em]';

const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** O último acesso, pela anotação do servidor (no máximo uma por minuto). */
function quandoAbriu(iso: string | null, agoraMs: number): string {
  if (!iso) return 'ainda não abriu';
  const s = Math.max(0, (agoraMs - Date.parse(iso)) / 1000);
  if (s < 120) return 'aberto agora';
  if (s < 86_400) return `aberto há ${duracao(s)}`;
  return `aberto em ${dia(iso)}`;
}

/** A linha de baixo de cada link: a situação vem do servidor. */
function detalhe(l: LinkAoVivo, agoraMs: number): string {
  const por = l.criadoPor ? ` · criado por ${l.criadoPor}` : '';
  if (l.situacao === 'desligado') return `desligado em ${dia(l.desligadoEm ?? l.criadoEm)}${l.desligadoPor ? ` por ${l.desligadoPor}` : ''}`;
  if (l.situacao === 'vencido') return `venceu em ${dia(l.venceEm ?? l.criadoEm)}${por}`;
  return `${l.venceEm ? `vale até ${dia(l.venceEm)}` : 'sem prazo, até desligar'} · ${quandoAbriu(l.ultimoUsoEm, agoraMs)}${por}`;
}

const mensagem = (e: unknown, padrao: string) => (e instanceof ErroDaApi ? e.message : padrao);

export function VerNoCelular({ lojaId, aoFechar }: { lojaId: string; aoFechar: () => void }) {
  const id = useId();
  const [links, setLinks] = useState<LinkAoVivo[] | null>(null);
  const [erroDaLista, setErroDaLista] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [prazo, setPrazo] = useState<Prazo>('30');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ nome: string; endereco: string } | null>(null);
  const [copiado, setCopiado] = useState<'sim' | 'selecione' | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [desligando, setDesligando] = useState<string | null>(null);
  const [erroAoDesligar, setErroAoDesligar] = useState<string | null>(null);
  const pedido = useRef(0);
  const campoNome = useRef<HTMLInputElement>(null);
  const tituloDoCriado = useRef<HTMLParagraphElement>(null);
  const textoDoEndereco = useRef<HTMLParagraphElement>(null);

  // só a resposta da leitura mais nova vale (a lista é lida ao abrir, depois de criar e depois de desligar)
  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const r = await linkAoVivoApi.lista(lojaId);
      if (meu !== pedido.current) return;
      setLinks(r.links);
      setErroDaLista(null);
    } catch (e) {
      if (meu === pedido.current) setErroDaLista(mensagem(e, 'não consegui ler os links desta loja'));
    }
  }, [lojaId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  // o foco começa em "Para quem é", depois de a gaveta abrir
  useEffect(() => {
    const t = setTimeout(() => campoNome.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (criado) tituloDoCriado.current?.focus();
  }, [criado]);

  const criar = async () => {
    const limpo = nome.trim();
    if (!limpo || criando) return;
    setCriando(true);
    setErro(null);
    setCopiado(null);
    try {
      const r = await linkAoVivoApi.criar(lojaId, limpo, prazo === 'sempre' ? null : Number(prazo));
      setCriado({ nome: r.link.nome, endereco: `${window.location.origin}/ver#${r.codigo}` });
      setNome('');
      void carregar();
    } catch (e) {
      setErro(mensagem(e, 'não consegui criar o link'));
    } finally {
      setCriando(false);
    }
  };

  const copiar = async () => {
    if (!criado) return;
    try {
      await navigator.clipboard.writeText(criado.endereco);
      setCopiado('sim');
    } catch {
      // Sem permissão de área de transferência: deixa o endereço selecionado, para copiar à mão.
      const el = textoDoEndereco.current;
      if (el) {
        const faixa = document.createRange();
        faixa.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(faixa);
      }
      setCopiado('selecione');
    }
  };

  const desligar = async (linkId: string) => {
    setDesligando(linkId);
    setErroAoDesligar(null);
    try {
      await linkAoVivoApi.desligar(lojaId, linkId);
      setConfirmando(null);
      await carregar();
    } catch (e) {
      setErroAoDesligar(mensagem(e, 'não consegui desligar o link'));
    } finally {
      setDesligando(null);
    }
  };

  const agoraMs = Date.now();
  const valendo = (links ?? []).filter((l) => l.situacao === 'valendo').length;
  const ocupado = criando || desligando !== null;

  return (
    <Gaveta
      titulo="Ver no celular"
      descricao="Um link que abre só o movimento ao vivo desta loja no celular, sem login."
      ocupado={ocupado}
      aoFechar={aoFechar}
      rodape={
        <Botao onClick={aoFechar} disabled={ocupado}>
          Fechar
        </Botao>
      }
    >
      <section className="flex flex-col gap-3" aria-labelledby={`${id}-novo`} data-novo-link>
        <h3 id={`${id}-novo`} className={TITULO_DA_SECAO}>Novo link</h3>
        <Campo rotulo="Para quem é" htmlFor={`${id}-nome`} ajuda="Aparece na lista dos links, para você saber qual desligar.">
          <input
            ref={campoNome}
            id={`${id}-nome`}
            className="entrada"
            type="text"
            maxLength={NOME_MAXIMO}
            autoComplete="off"
            placeholder="Ex.: celular do gerente"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void criar();
              }
            }}
            data-para-quem
          />
        </Campo>
        <Campo rotulo="Vale por">
          <Segmentado rotulo="Vale por" opcoes={PRAZOS} valor={prazo} aoMudar={setPrazo} />
        </Campo>
        <div>
          <Botao variante="primario" onClick={() => void criar()} disabled={!nome.trim() || criando} data-criar-link>
            {criando ? 'Criando…' : 'Criar link'}
          </Botao>
        </div>
        {erro ? <Alerta tom="critico" papel="alert">{erro}</Alerta> : null}
        {criado ? (
          <div className="grid grid-cols-1 gap-3 rounded-[16px] bg-farol-painel-2 p-3.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center" data-link-criado>
            <div className="flex justify-center">
              <CodigoQr texto={criado.endereco} rotulo={`Código QR do link "${criado.nome}"`} />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              {/* o texto na cor da tinta (o verde sobre o painel fica abaixo de 4,5:1); o verde só no sinal de feito */}
              <p ref={tituloDoCriado} tabIndex={-1} className="flex items-start gap-1.5 font-semibold text-farol-tinta outline-none">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-farol-ok" aria-hidden />
                <span className="min-w-0 break-words">Link criado: {criado.nome}</span>
              </p>
              <p ref={textoDoEndereco} className="select-all break-all rounded-[10px] bg-farol-painel px-3 py-2 font-mono text-[12px] text-farol-tinta" data-endereco>
                {criado.endereco}
              </p>
              <div>
                <Botao mini onClick={() => void copiar()} data-copiar>
                  <Copy className="h-4 w-4" aria-hidden />
                  {copiado === 'sim' ? 'Link copiado' : 'Copiar o link'}
                </Botao>
              </div>
              {copiado === 'selecione' ? (
                <p role="status" className="text-[13px]">
                  Este navegador não deixou copiar sozinho: o link ficou selecionado — copie com Ctrl+C.
                </p>
              ) : null}
              <p className={AJUDA}>
                Aponte a câmera do celular para o código. O código aparece só agora: se perder, crie outro e desligue este.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2.5 border-t border-farol-borda pt-4" aria-labelledby={`${id}-ve`}>
        <h3 id={`${id}-ve`} className={TITULO_DA_SECAO}>O que quem tem o link vê</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-o-que-ve>
          <div>
            <p className="mb-1.5 text-[13px] font-bold">Vê</p>
            <ul className="flex flex-col gap-1.5 text-[13.5px]">
              {VE.map((t) => (
                <li key={t} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
                  <Check className="mt-px h-[18px] w-[18px] text-farol-ok" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-bold">Não vê</p>
            <ul className="flex flex-col gap-1.5 text-[13.5px]">
              {NAO_VE.map((t) => (
                <li key={t} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
                  <X className="mt-px h-[18px] w-[18px] text-farol-critico" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2.5 border-t border-farol-borda pt-4" aria-labelledby={`${id}-lista`}>
        <h3 id={`${id}-lista`} className={TITULO_DA_SECAO}>
          Links desta loja
          {links ? <span className="ml-1.5 font-mono text-[13px] font-semibold normal-case tracking-normal text-farol-suave">{valendo} valendo</span> : null}
        </h3>
        {erroDaLista ? <Alerta tom="atencao" papel="status">{erroDaLista}</Alerta> : null}
        {erroAoDesligar ? <Alerta tom="critico" papel="alert">{erroAoDesligar}</Alerta> : null}
        {links === null && !erroDaLista ? <p className="text-[13px] text-farol-suave">Lendo os links…</p> : null}
        {links && links.length === 0 ? <p className="text-[13px] text-farol-suave">Nenhum link ainda. Crie o primeiro acima.</p> : null}
        {links && links.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Os links desta loja" data-lista-de-links>
            {links.map((l) => (
              <li
                key={l.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-[14px] bg-farol-painel-2 px-3 py-2.5"
                data-link={l.id}
                data-situacao={l.situacao}
              >
                <div className="min-w-0">
                  <b className={`block break-words font-semibold ${l.situacao === 'valendo' ? '' : 'text-farol-suave line-through'}`}>{l.nome}</b>
                  <small className="block break-words font-mono text-[11.5px] leading-[1.45] text-farol-suave">{detalhe(l, agoraMs)}</small>
                </div>
                {l.situacao === 'valendo' ? (
                  <Botao mini onClick={() => setConfirmando(l.id)} disabled={ocupado} aria-expanded={confirmando === l.id} data-desligar={l.id}>
                    Desligar
                  </Botao>
                ) : (
                  <span className="whitespace-nowrap rounded-full bg-farol-painel px-2 py-1 font-mono text-[11px] text-farol-suave">{l.situacao}</span>
                )}
                {confirmando === l.id ? (
                  <div
                    role="group"
                    aria-label={`Desligar o link "${l.nome}"`}
                    className="col-span-2 flex flex-wrap items-center gap-2 rounded-[10px] bg-farol-painel px-3 py-2 text-[13.5px]"
                    data-confirmar-desligar
                  >
                    <span className="min-w-0 flex-[1_1_220px]">
                      Desligar este link? Quem estiver com ele aberto para de ver na hora. Não dá para religar: para voltar, crie outro.
                    </span>
                    <Botao mini variante="perigo" onClick={() => void desligar(l.id)} disabled={ocupado} data-confirmar={l.id}>
                      {desligando === l.id ? 'Desligando…' : 'Desligar o link'}
                    </Botao>
                    <Botao mini onClick={() => setConfirmando(null)} disabled={ocupado}>
                      Voltar
                    </Botao>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className={AJUDA}>Desligou, parou na hora: quem estiver com o link aberto vê &ldquo;Este link não vale mais&rdquo;.</p>
      </section>
    </Gaveta>
  );
}
