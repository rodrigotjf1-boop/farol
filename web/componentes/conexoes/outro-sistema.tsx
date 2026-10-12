'use client';

// =====================================================================
// Conexões — o acesso de outro sistema, e a planilha
// =====================================================================
// Do protótipo aprovado em 11/10/2026 (`mockups/farol-conexoes-e-fichas.html`).
// Pedido do dono: o Farol é para distribuição — a operação que não usa o
// Regem manda as fichas dela por uma porta documentada, com o acesso criado
// PELO PRÓPRIO USUÁRIO, aqui. Ninguém da distribuição cola credencial.
//
// O ACESSO deixa um sistema enviar as fichas de UMA loja. Só a diretoria
// cria e revoga; quem configura vê. Quem decide é a API: aqui só se
// escolhe entre o botão e a frase.
//
// O CÓDIGO aparece UMA vez, na gaveta de quem criou. Ele não fica em
// estado nenhum fora dela, não vai para o endereço, e sai da memória da
// tela quando a gaveta fecha. O servidor não o guarda: perdeu, é revogar
// e criar outro.
// =====================================================================

import { Check, Copy, Download, FileSpreadsheet, Info, KeyRound, Lock, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { diaFaladoNaLoja, frase, plural } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta, CARTAO, Chip } from '@/componentes/ui/pecas';
import { Dialogo, Gaveta } from '@/componentes/ui/sobreposto';
import { acessosApi, ErroDaApi, fichasApi, type AcessoCriado, type AcessoDeOutroSistema, type AcessosDaConta, type OrigemDaLoja } from '@/lib/api';
import { baixarArquivo, escreverXlsx } from '@/lib/planilha';

const MAX_DO_NOME = 40;
const FUSO_PADRAO = 'America/Sao_Paulo';
const mensagemDe = (e: unknown): string => (e instanceof ErroDaApi ? e.message : 'não deu certo');

/** O endereço da documentação da porta, como a pessoa o lê e copia: o deste console, sem o "https://". */
function useEnderecoDaDocumentacao(): string {
  const [endereco, setEndereco] = useState('');
  // Depois de montar: o endereço é o da janela, que o servidor não conhece ao desenhar a página.
  useEffect(() => setEndereco(`${window.location.host}/integracao`), []);
  return endereco;
}

function Documentacao({ endereco }: { endereco: string }) {
  return (
    // Inteiro numa linha só sempre que couber (desce para a linha de baixo antes de partir); só parte se nem assim couber.
    <Link
      href="/integracao"
      target="_blank"
      rel="noopener"
      className="inline-block max-w-full align-bottom font-mono text-[12.5px] text-farol-tinta underline decoration-farol-borda-forte underline-offset-2 [overflow-wrap:anywhere]"
    >
      {endereco || '/integracao'}
    </Link>
  );
}

function Cabeca({ id, titulo, children }: { id: string; titulo: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-farol-borda px-[18px] py-3.5">
      <h2 id={id} className="font-display text-lg font-semibold leading-tight tracking-tight">
        {titulo}
      </h2>
      {children}
    </header>
  );
}

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

function OQueRecebe() {
  const forte = (t: string) => <b className="font-semibold text-farol-tinta">{t}</b>;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Lista
        titulo="O que o outro sistema envia"
        icone={Check}
        tom="text-farol-ok"
        itens={[<>{forte('O cardápio')} — produtos, variações e adicionais</>, <>{forte('As fichas técnicas')} — os ingredientes de cada uma, na ordem</>]}
      />
      <Lista titulo="O que o Farol não recebe" icone={Lock} tom="text-farol-suave" itens={['Preço, custo e margem', 'Quem é o cliente', 'Vendas, caixa, estoque e equipe']} />
    </div>
  );
}

// ───────────────────────── criar o acesso ─────────────────────────

const POR_QUE_NAO: Record<OrigemDaLoja, string> = { livre: '', planilha: ' — hoje com fichas de planilha', regem: ' — já recebe do Regem', sistema: ' — já tem um acesso' };
const podeGanhar = (o: OrigemDaLoja): boolean => o === 'livre' || o === 'planilha';

function NovoAcesso({ lojas, aoFechar, aoCriar }: { lojas: AcessosDaConta['lojas']; aoFechar: () => void; aoCriar: () => void }) {
  const idNome = useId();
  const idLoja = useId();
  const idErro = useId();
  const documentacao = useEnderecoDaDocumentacao();
  const livres = lojas.filter((l) => podeGanhar(l.origem));

  const [nome, setNome] = useState('');
  const [lojaId, setLojaId] = useState(livres[0]?.id ?? '');
  const [erroDoNome, setErroDoNome] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  // O acesso criado, COM o código. Só existe enquanto esta gaveta está aberta.
  const [criado, setCriado] = useState<AcessoCriado | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [saindoSemCopiar, setSaindoSemCopiar] = useState(false);
  const campoDoCodigo = useRef<HTMLElement>(null);

  const escolhida = lojas.find((l) => l.id === lojaId);

  async function criar() {
    const limpo = nome.replace(/\s+/g, ' ').trim();
    if (!limpo) return setErroDoNome('Diga o nome do sistema.');
    setErroDoNome(null);
    setErro(null);
    setCriando(true);
    try {
      setCriado(await acessosApi.criar(limpo, lojaId));
      // A lista de trás já mostra o acesso novo (sem o código, que só existe aqui).
      aoCriar();
    } catch (e) {
      setErro(frase(mensagemDe(e)));
    } finally {
      setCriando(false);
    }
  }

  async function copiar() {
    if (!criado) return;
    try {
      await navigator.clipboard.writeText(criado.codigo);
      setCopiado(true);
    } catch {
      // Sem permissão de copiar (um navegador antigo, uma janela embutida): o código fica selecionado, e a pessoa copia à mão.
      if (campoDoCodigo.current) window.getSelection()?.selectAllChildren(campoDoCodigo.current);
    }
  }

  // Fechar com o código ainda não copiado pede confirmação: depois de fechar ele não aparece de novo.
  const fechar = () => (criado && !copiado && !saindoSemCopiar ? setSaindoSemCopiar(true) : aoFechar());

  if (!criado && livres.length === 0) {
    return (
      <Gaveta titulo="Criar acesso para outro sistema" descricao="O acesso deixa um sistema enviar as fichas de uma loja." aoFechar={aoFechar} rodape={<Botao onClick={aoFechar}>Fechar</Botao>}>
        <Alerta icone={Info}>
          <b className="font-semibold text-farol-tinta">Todas as lojas já recebem as fichas de outro lugar.</b> Uma loja recebe de um lugar só: para outro sistema
          enviar, desconecte a loja de onde ela recebe hoje.
        </Alerta>
      </Gaveta>
    );
  }

  if (criado) {
    return (
      <Gaveta
        titulo="Acesso criado"
        descricao={`${criado.nome} → ${criado.lojaNome}`}
        aoFechar={fechar}
        rodape={
          saindoSemCopiar ? (
            <>
              <Botao onClick={() => setSaindoSemCopiar(false)}>Voltar ao código</Botao>
              <Botao variante="perigo-leve" onClick={aoFechar}>
                Fechar sem copiar
              </Botao>
            </>
          ) : (
            <Botao variante="primario" onClick={fechar}>
              Concluir
            </Botao>
          )
        }
      >
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">O código de acesso</h3>
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-farol-borda bg-farol-painel-2 px-3 py-2.5" data-codigo>
            {/* Inteiro à vista, quebrando a linha: num campo de uma linha só, o fim do código ficava escondido no celular.
                Um toque seleciona tudo (`select-all`), para quem copia à mão. */}
            <code ref={campoDoCodigo} aria-label="O código de acesso" className="min-w-0 flex-[1_1_220px] select-all break-all font-mono text-[13px] leading-relaxed">
              {criado.codigo}
            </code>
            <Botao mini onClick={copiar}>
              {copiado ? <Check className="h-[15px] w-[15px]" aria-hidden /> : <Copy className="h-[15px] w-[15px]" aria-hidden />}
              {copiado ? 'Copiado' : 'Copiar'}
            </Botao>
          </div>
        </section>

        {saindoSemCopiar ? (
          <Alerta tom="atencao" icone={TriangleAlert} papel="alert">
            <b className="font-semibold">Você ainda não copiou o código.</b> Depois de fechar, o Farol não o mostra de novo: será preciso revogar este acesso e criar
            outro.
          </Alerta>
        ) : (
          <Alerta tom="atencao" icone={Info} papel="status">
            <b className="font-semibold">Este código aparece só agora.</b> Depois de fechar, o Farol não o mostra de novo. Se perder, revogue este acesso e crie outro.
          </Alerta>
        )}

        {criado.temPlanilha && (
          <Alerta icone={Info}>
            A {criado.lojaNome} tem fichas de planilha. Elas ficam até o sistema enviar as dele; aí as do sistema entram no lugar.
          </Alerta>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">O que entregar a quem cuida do sistema</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] marker:font-semibold" data-entregar>
            <li>O código de acesso acima.</li>
            <li>
              O endereço da documentação: <Documentacao endereco={documentacao} />
            </li>
            <li>Mais nada: nenhuma senha sua e nenhuma entrada no console.</li>
          </ol>
        </section>
      </Gaveta>
    );
  }

  return (
    <Gaveta
      titulo="Criar acesso para outro sistema"
      descricao="O acesso deixa um sistema enviar as fichas de uma loja."
      ocupado={criando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao onClick={aoFechar} disabled={criando}>
            Cancelar
          </Botao>
          <Botao variante="primario" ocupado={criando} onClick={criar}>
            Criar acesso
          </Botao>
        </>
      }
    >
      {erro && (
        <Alerta tom="critico" icone={TriangleAlert} papel="alert">
          {erro}
        </Alerta>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={idNome} className={ROTULO}>
          Nome do sistema
        </label>
        <input
          id={idNome}
          type="text"
          className="entrada"
          maxLength={MAX_DO_NOME}
          autoComplete="off"
          value={nome}
          aria-invalid={erroDoNome ? true : undefined}
          aria-describedby={erroDoNome ? idErro : undefined}
          onChange={(e) => {
            setNome(e.target.value);
            setErroDoNome(null);
          }}
        />
        <small className={AJUDA}>Como vocês o chamam. É o nome que aparece na tela Fichas da loja.</small>
        {erroDoNome && (
          <span id={idErro} role="alert" className="text-xs font-medium text-farol-critico">
            {erroDoNome}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={idLoja} className={ROTULO}>
          Loja que vai receber
        </label>
        <select id={idLoja} className="entrada" value={lojaId} onChange={(e) => setLojaId(e.target.value)}>
          {lojas.map((l) => (
            <option key={l.id} value={l.id} disabled={!podeGanhar(l.origem)}>
              {l.nome}
              {POR_QUE_NAO[l.origem]}
            </option>
          ))}
        </select>
        <small className={AJUDA}>O acesso vale para uma loja. Para outra loja, crie outro.</small>
      </div>

      {escolhida?.origem === 'planilha' && (
        <Alerta tom="atencao" icone={Info} papel="status">
          A {escolhida.nome} tem fichas de planilha. Elas ficam até o sistema enviar as dele; aí as do sistema entram no lugar.
        </Alerta>
      )}
    </Gaveta>
  );
}

// ───────────────────────── o cartão "Outro sistema" ─────────────────────────

function LinhaDoAcesso({ a, podeRevogar, aoRevogar }: { a: AcessoDeOutroSistema; podeRevogar: boolean; aoRevogar: () => void }) {
  const fuso = a.fuso ?? FUSO_PADRAO;
  return (
    <li
      data-acesso={a.id}
      className="grid grid-cols-1 items-center gap-x-4 gap-y-2.5 border-b border-farol-borda px-[18px] py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <b className="block break-words font-semibold">{a.nome}</b>
        <small className="block break-words text-xs text-farol-suave">envia para a {a.lojaNome}</small>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1" data-estado>
        {a.recebidoEm ? <Chip tom="ok">recebido {diaFaladoNaLoja(a.recebidoEm, fuso)}</Chip> : <Chip>ainda não enviou nada</Chip>}
        <span className="font-mono text-xs text-farol-suave">
          {a.recebidoEm && a.produtos !== null
            ? `${plural(a.produtos, 'produto', 'produtos')} · ${a.comFicha ? `${a.comFicha} com ficha` : 'nenhuma ficha'}`
            : `criado ${diaFaladoNaLoja(a.criadoEm, fuso)}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {a.recebidoEm && (
          <Link href={`/lojas/${a.lojaId}/fichas`} className={classesDoBotao({ mini: true })}>
            Ver fichas
          </Link>
        )}
        {podeRevogar && (
          <Botao mini variante="perigo-leve" onClick={aoRevogar}>
            Revogar
          </Botao>
        )}
      </div>
    </li>
  );
}

export function OutroSistema({ a, aoMudar }: { a: AcessosDaConta; aoMudar: () => Promise<unknown> }) {
  const id = useId();
  const avisar = useAvisar();
  const documentacao = useEnderecoDaDocumentacao();
  const [criando, setCriando] = useState(false);
  const [alvo, setAlvo] = useState<AcessoDeOutroSistema | null>(null);
  const [revogando, setRevogando] = useState(false);
  const [erroAoRevogar, setErroAoRevogar] = useState<string | null>(null);
  const n = a.acessos.length;

  async function revogar() {
    if (!alvo) return;
    setRevogando(true);
    setErroAoRevogar(null);
    try {
      const r = await acessosApi.revogar(alvo.id);
      await aoMudar();
      setAlvo(null);
      avisar(`O acesso do ${alvo.nome} foi revogado.${r.fichasApagadas ? ` As fichas que ele mandou para a ${alvo.lojaNome} foram apagadas.` : ''}`);
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 404) {
        // Outra pessoa já revogou: o que se queria já aconteceu.
        await aoMudar();
        setAlvo(null);
      } else setErroAoRevogar(frase(mensagemDe(e)));
    } finally {
      setRevogando(false);
    }
  }

  return (
    <>
      <section className={CARTAO} aria-labelledby={id} data-cartao="outro-sistema">
        <Cabeca id={id} titulo="Outro sistema">
          <Chip tom={n > 0 ? 'ok' : undefined}>{n > 0 ? plural(n, 'acesso', 'acessos') : 'nenhum acesso'}</Chip>
          {a.podeCriar && (
            <span className="ml-auto">
              <Botao mini onClick={() => setCriando(true)}>
                <KeyRound className="h-[15px] w-[15px]" aria-hidden />
                Criar acesso
              </Botao>
            </span>
          )}
        </Cabeca>

        {n > 0 ? (
          <>
            <ul className="flex flex-col">
              {a.acessos.map((acesso) => (
                <LinhaDoAcesso
                  key={acesso.id}
                  a={acesso}
                  podeRevogar={a.podeCriar}
                  aoRevogar={() => {
                    setErroAoRevogar(null);
                    setAlvo(acesso);
                  }}
                />
              ))}
            </ul>
            <div className="border-t border-farol-borda p-[18px]">
              <p className={AJUDA}>
                O código de acesso aparece uma vez, quando é criado. Perdeu? Revogue e crie outro. A documentação para quem cuida do sistema fica em{' '}
                <Documentacao endereco={documentacao} />.
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4 p-[18px]">
            <p className="max-w-[68ch]">
              A loja usa outro sistema para o cardápio e as fichas? Ele pode enviá-las ao Farol. Você cria um acesso aqui e entrega a quem cuida desse sistema — com
              o endereço da documentação.
            </p>
            <OQueRecebe />
            <div>
              <h3 className="text-[13px] font-semibold">Como funciona</h3>
              <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-farol-suave marker:font-semibold marker:text-farol-tinta">
                <li>Você cria o acesso aqui e escolhe a loja.</li>
                <li>Entrega o código e o endereço da documentação a quem cuida do sistema.</li>
                <li>O sistema passa a enviar as fichas, e elas aparecem na tela Fichas da loja.</li>
              </ol>
            </div>
            <p className={AJUDA}>
              A documentação fica em <Documentacao endereco={documentacao} />.
            </p>
            {!a.podeCriar && (
              <Alerta icone={Lock}>
                <b className="font-semibold text-farol-tinta">Só a diretoria cria acesso para outro sistema.</b> Deixar outro sistema escrever aqui é decisão dela.
              </Alerta>
            )}
          </div>
        )}
      </section>

      {criando && <NovoAcesso lojas={a.lojas} aoFechar={() => setCriando(false)} aoCriar={() => void aoMudar()} />}

      {alvo && (
        <Dialogo
          titulo={`Revogar o acesso do ${alvo.nome}?`}
          rotuloConfirmar="Revogar"
          rotuloOcupado="Revogando…"
          rotuloCancelar="Manter"
          ocupado={revogando}
          erro={erroAoRevogar}
          aoConfirmar={revogar}
          aoCancelar={() => setAlvo(null)}
        >
          <p>
            O sistema deixa de conseguir enviar na hora
            {alvo.recebidoEm ? (
              <>
                , e o Farol <strong>apaga as fichas que ele mandou</strong> para a {alvo.lojaNome}
              </>
            ) : null}
            . Para voltar, é criar outro acesso e entregar o código novo.
          </p>
        </Dialogo>
      )}
    </>
  );
}

// ───────────────────────── o cartão "Planilha" ─────────────────────────

export function Planilha({ a }: { a: AcessosDaConta }) {
  const id = useId();
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // As lojas que podem receber por planilha: as livres e as que já têm fichas de planilha.
  const lojas = a.lojas.filter((l) => l.origem === 'livre' || l.origem === 'planilha');
  const comPlanilha = a.lojas.filter((l) => l.origem === 'planilha');

  async function baixarModelo() {
    setBaixando(true);
    setErro(null);
    try {
      const m = await fichasApi.modelo();
      baixarArquivo(escreverXlsx((['fichas', 'variacoes', 'adicionais', 'combos'] as const).map((q) => ({ nome: m.nomes[q], linhas: m.abas[q] }))), 'modelo-de-fichas.xlsx');
    } catch (e) {
      setErro(frase(mensagemDe(e)));
    } finally {
      setBaixando(false);
    }
  }

  return (
    <section className={CARTAO} aria-labelledby={id} data-cartao="planilha">
      <Cabeca id={id} titulo="Planilha">
        {comPlanilha.map((l) => (
          <Chip key={l.id} tom="ok">
            {l.nome}
          </Chip>
        ))}
      </Cabeca>
      <div className="flex flex-col gap-3.5 p-[18px]">
        <p className="max-w-[68ch]">
          Sem sistema, ou com as fichas no Excel? Dá para importar por planilha, loja por loja, na tela Fichas de cada uma. O modelo já vem com as colunas.
        </p>
        {erro && (
          <Alerta tom="critico" icone={TriangleAlert} papel="alert">
            {erro}
          </Alerta>
        )}
        <div className="flex flex-wrap gap-2.5">
          {lojas.map((l) => (
            <Link key={l.id} href={`/lojas/${l.id}/fichas`} className={classesDoBotao()}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Ir para Fichas da {l.nome}
            </Link>
          ))}
          <Botao ocupado={baixando} onClick={baixarModelo}>
            {!baixando && <Download className="h-4 w-4" aria-hidden />}
            Baixar o modelo
          </Botao>
        </div>
        {lojas.length === 0 && <p className={AJUDA}>Todas as lojas da conta já recebem as fichas de outro lugar. Uma loja recebe de um lugar só.</p>}
      </div>
    </section>
  );
}
