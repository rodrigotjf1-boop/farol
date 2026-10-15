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

import { Bell, Check, Clock, Copy, Download, FileSpreadsheet, Info, KeyRound, Lock, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { dataNaLoja, diaFaladoNaLoja, frase, plural } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta, CARTAO, Chip } from '@/componentes/ui/pecas';
import { Dialogo, Gaveta } from '@/componentes/ui/sobreposto';
import { acessosApi, ErroDaApi, fichasApi, type AcessoCriado, type AcessoDeOutroSistema, type AcessoRenovado, type AcessosDaConta, type OrigemDaLoja } from '@/lib/api';
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

// ───────────────────────── a validade, em palavras ─────────────────────────

const DIA_MS = 86_400_000;
/** Quantos dias faltam (arredondado para cima): "vence em 12 dias". */
const diasAte = (iso: string): number => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / DIA_MS));
/** Daqui a 12 meses, para a gaveta dizer até quando o acesso novo vai valer (quem decide a data é a API). */
function dozeMesesDepois(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 12);
  return d.toISOString();
}

// ───────────────────────── o código que aparece uma vez ─────────────────────────

function CodigoUmaVez({ codigo, copiado, aoCopiar, campo }: { codigo: string; copiado: boolean; aoCopiar: () => void; campo: React.RefObject<HTMLElement | null> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-farol-borda bg-farol-painel-2 px-3 py-2.5" data-codigo>
      {/* Inteiro à vista, quebrando a linha: num campo de uma linha só, o fim do código ficava escondido no celular.
          Um toque seleciona tudo (`select-all`), para quem copia à mão. */}
      <code ref={campo} aria-label="O código de acesso" className="min-w-0 flex-[1_1_220px] select-all break-all font-mono text-[13px] leading-relaxed">
        {codigo}
      </code>
      <Botao mini onClick={aoCopiar}>
        {copiado ? <Check className="h-[15px] w-[15px]" aria-hidden /> : <Copy className="h-[15px] w-[15px]" aria-hidden />}
        {copiado ? 'Copiado' : 'Copiar'}
      </Botao>
    </div>
  );
}

/** Copiar o código, ou selecioná-lo para a pessoa copiar à mão quando o navegador não deixa. */
function useCopiar(codigo: string | null) {
  const [copiado, setCopiado] = useState(false);
  const campo = useRef<HTMLElement>(null);
  async function copiar() {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      // Sem permissão de copiar (um navegador antigo, uma janela embutida): o código fica selecionado, e a pessoa copia à mão.
      if (campo.current) window.getSelection()?.selectAllChildren(campo.current);
    }
  }
  return { copiado, copiar, campo };
}

/** A senha de quem cria ou renova: confirma que é a própria pessoa, e não alguém com o console dela aberto. */
function CampoDaSenha({ id, idErro, valor, erro, fazendo, aoMudar }: { id: string; idErro: string; valor: string; erro: string | null; fazendo: string; aoMudar: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={ROTULO}>
        Sua senha
      </label>
      <input
        id={id}
        type="password"
        className="entrada"
        autoComplete="current-password"
        value={valor}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? idErro : undefined}
        onChange={(e) => aoMudar(e.target.value)}
      />
      <small className={AJUDA}>Para confirmar que é você quem está {fazendo} o acesso.</small>
      {erro && (
        <span id={idErro} role="alert" className="text-xs font-medium text-farol-critico">
          {erro}
        </span>
      )}
    </div>
  );
}

// ───────────────────────── criar o acesso ─────────────────────────

const POR_QUE_NAO: Record<OrigemDaLoja, string> = { livre: '', planilha: ' — hoje com fichas de planilha', regem: ' — já recebe do Regem', sistema: ' — já tem um acesso' };
const podeGanhar = (o: OrigemDaLoja): boolean => o === 'livre' || o === 'planilha';
/** A data em que o termo passou a valer, como se lê ("15/10/2026"). */
const dataDoTermo = (de: string): string => de.split('-').reverse().join('/');

function NovoAcesso({ lojas, termo, aoFechar, aoCriar }: { lojas: AcessosDaConta['lojas']; termo: AcessosDaConta['termo']; aoFechar: () => void; aoCriar: () => void }) {
  const idNome = useId();
  const idLoja = useId();
  const idErro = useId();
  const idTermo = useId();
  const idErroDoTermo = useId();
  const idSenha = useId();
  const idErroDaSenha = useId();
  const documentacao = useEnderecoDaDocumentacao();
  const livres = lojas.filter((l) => podeGanhar(l.origem));

  const [nome, setNome] = useState('');
  const [lojaId, setLojaId] = useState(livres[0]?.id ?? '');
  const [aceitou, setAceitou] = useState(false);
  const [senha, setSenha] = useState('');
  const [erroDoNome, setErroDoNome] = useState<string | null>(null);
  const [erroDoTermo, setErroDoTermo] = useState<string | null>(null);
  const [erroDaSenha, setErroDaSenha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  // O acesso criado, COM o código. Só existe enquanto esta gaveta está aberta.
  const [criado, setCriado] = useState<AcessoCriado | null>(null);
  const { copiado, copiar, campo } = useCopiar(criado?.codigo ?? null);
  const [saindoSemCopiar, setSaindoSemCopiar] = useState(false);

  const escolhida = lojas.find((l) => l.id === lojaId);

  async function criar() {
    const limpo = nome.replace(/\s+/g, ' ').trim();
    const semNome = limpo ? null : 'Diga o nome do sistema.';
    const semTermo = aceitou ? null : 'Para criar o acesso, aceite o termo.';
    const semSenha = senha ? null : 'Digite a sua senha para confirmar.';
    setErroDoNome(semNome);
    setErroDoTermo(semTermo);
    setErroDaSenha(semSenha);
    setErro(null);
    if (semNome || semTermo || semSenha) return;
    setCriando(true);
    try {
      setCriado(await acessosApi.criar(limpo, lojaId, senha, termo.versao));
      setSenha('');
      // A lista de trás já mostra o acesso novo (sem o código, que só existe aqui).
      aoCriar();
    } catch (e) {
      if (e instanceof ErroDaApi && e.codigo === 'senha_nao_confere') setErroDaSenha(frase(mensagemDe(e)));
      else if (e instanceof ErroDaApi && e.codigo === 'termo') setErroDoTermo('O termo mudou desde que esta tela abriu. Feche, abra de novo e leia a versão nova.');
      else setErro(frase(mensagemDe(e)));
    } finally {
      setCriando(false);
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
          <CodigoUmaVez codigo={criado.codigo} copiado={copiado} aoCopiar={copiar} campo={campo} />
          <p className={AJUDA}>
            Vale até <b className="font-semibold text-farol-tinta">{dataNaLoja(criado.venceEm, FUSO_PADRAO)}</b>. Termo aceito: versão {termo.versao}, de{' '}
            {dataDoTermo(termo.de)}.
          </p>
        </section>

        {saindoSemCopiar ? (
          <Alerta tom="atencao" icone={TriangleAlert} papel="alert">
            <b className="font-semibold">Você ainda não copiou o código.</b> Depois de fechar, o Farol não o mostra de novo: será preciso renovar o acesso para ter
            outro.
          </Alerta>
        ) : (
          <Alerta tom="atencao" icone={Info} papel="status">
            <b className="font-semibold">Este código aparece só agora.</b> Depois de fechar, o Farol não o mostra de novo. Se perder, renove o acesso: sai um código
            novo.
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

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[13px] font-semibold">O que este acesso pode</h3>
        <p className="text-[13.5px] text-farol-suave">Enviar as fichas da loja escolhida e consultar o que o Farol tem desse sistema. Mais nada: nem câmeras, nem alertas, nem outra loja.</p>
        <p className="text-[13.5px] text-farol-suave">
          Vale 12 meses, até <b className="font-semibold text-farol-tinta">{dataNaLoja(dozeMesesDepois(), FUSO_PADRAO)}</b>. Quinze dias antes de vencer, o Farol avisa
          aqui e na tela Fichas.
        </p>
      </section>

      <section className="flex flex-col gap-2" data-termo>
        <h3 className="text-[13px] font-semibold">Termo de uso do acesso</h3>
        <details className="rounded-[10px] border border-farol-borda bg-farol-painel-2">
          <summary className="cursor-pointer rounded-[10px] px-3.5 py-2.5 text-[13.5px] font-medium">
            Ler o termo (versão {termo.versao}, de {dataDoTermo(termo.de)})
          </summary>
          <ol className="flex list-decimal flex-col gap-2 pb-3 pl-9 pr-3.5 text-[13px] text-farol-suave">
            {termo.itens.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </details>
        <label htmlFor={idTermo} className="flex cursor-pointer items-start gap-2.5 text-[13.5px]">
          <input
            id={idTermo}
            type="checkbox"
            className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-farol-facho"
            checked={aceitou}
            aria-invalid={erroDoTermo ? true : undefined}
            aria-describedby={erroDoTermo ? idErroDoTermo : undefined}
            onChange={(e) => {
              setAceitou(e.target.checked);
              setErroDoTermo(null);
            }}
          />
          <span className="min-w-0">Li e aceito o termo de uso do acesso</span>
        </label>
        {erroDoTermo && (
          <span id={idErroDoTermo} role="alert" className="text-xs font-medium text-farol-critico">
            {erroDoTermo}
          </span>
        )}
      </section>

      <CampoDaSenha
        id={idSenha}
        idErro={idErroDaSenha}
        valor={senha}
        erro={erroDaSenha}
        fazendo="criando"
        aoMudar={(v) => {
          setSenha(v);
          setErroDaSenha(null);
        }}
      />
      <p className={`flex items-start gap-1.5 ${AJUDA}`}>
        <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Os outros da diretoria veem um aviso de que você criou este acesso.</span>
      </p>
    </Gaveta>
  );
}

// ───────────────────────── renovar ─────────────────────────

function Renovar({ a, aoFechar, aoRenovar }: { a: AcessoDeOutroSistema; aoFechar: () => void; aoRenovar: () => void }) {
  const idSenha = useId();
  const idErroDaSenha = useId();
  const fuso = a.fuso ?? FUSO_PADRAO;
  const vencido = a.situacao === 'vencido';
  const [senha, setSenha] = useState('');
  const [erroDaSenha, setErroDaSenha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [renovando, setRenovando] = useState(false);
  // O código novo. Só existe enquanto esta gaveta está aberta.
  const [novo, setNovo] = useState<AcessoRenovado | null>(null);
  const { copiado, copiar, campo } = useCopiar(novo?.codigo ?? null);
  const [saindoSemCopiar, setSaindoSemCopiar] = useState(false);

  async function renovar() {
    if (!senha) return setErroDaSenha('Digite a sua senha para confirmar.');
    setErroDaSenha(null);
    setErro(null);
    setRenovando(true);
    try {
      setNovo(await acessosApi.renovar(a.id, senha));
      setSenha('');
      aoRenovar();
    } catch (e) {
      if (e instanceof ErroDaApi && e.codigo === 'senha_nao_confere') setErroDaSenha(frase(mensagemDe(e)));
      else setErro(frase(mensagemDe(e)));
    } finally {
      setRenovando(false);
    }
  }

  const fechar = () => (novo && !copiado && !saindoSemCopiar ? setSaindoSemCopiar(true) : aoFechar());

  if (novo) {
    return (
      <Gaveta
        titulo="Código novo"
        descricao={`${novo.nome} → ${novo.lojaNome}`}
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
          <h3 className="text-[13px] font-semibold">O código novo</h3>
          <CodigoUmaVez codigo={novo.codigo} copiado={copiado} aoCopiar={copiar} campo={campo} />
          <p className={AJUDA}>
            Vale até <b className="font-semibold text-farol-tinta">{dataNaLoja(novo.venceEm, fuso)}</b>.
          </p>
        </section>
        <Alerta tom="atencao" icone={saindoSemCopiar ? TriangleAlert : Info} papel={saindoSemCopiar ? 'alert' : 'status'}>
          {saindoSemCopiar ? (
            <>
              <b className="font-semibold">Você ainda não copiou o código.</b> Depois de fechar, o Farol não o mostra de novo: será preciso renovar outra vez.
            </>
          ) : (
            <>
              <b className="font-semibold">Este código aparece só agora.</b> Depois de fechar, o Farol não o mostra de novo. Se perder, renove outra vez.
            </>
          )}
        </Alerta>
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">O que fazer agora</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] marker:font-semibold">
            <li>
              Entregue o código novo a quem cuida do sistema, para ele trocar
              {novo.anteriorValeAte ? (
                <>
                  {' '}
                  antes de <b className="font-semibold">{dataNaLoja(novo.anteriorValeAte, fuso)}</b>, quando o antigo para.
                </>
              ) : (
                '.'
              )}
            </li>
            <li>Para conferir, o sistema consulta a porta: a resposta traz o nome do sistema, a loja e até quando o código vale.</li>
            <li>Mais nada: a documentação e as fichas não mudam.</li>
          </ol>
        </section>
      </Gaveta>
    );
  }

  return (
    <Gaveta
      titulo="Renovar o acesso"
      descricao={`${a.nome} → ${a.lojaNome}`}
      ocupado={renovando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao onClick={aoFechar} disabled={renovando}>
            Cancelar
          </Botao>
          <Botao variante="primario" ocupado={renovando} onClick={renovar}>
            Gerar o código novo
          </Botao>
        </>
      }
    >
      {erro && (
        <Alerta tom="critico" icone={TriangleAlert} papel="alert">
          {erro}
        </Alerta>
      )}
      <p>
        Sai um código novo, que vale 12 meses, até <b className="font-semibold">{dataNaLoja(dozeMesesDepois(), fuso)}</b>. É ele que vai para o sistema.
      </p>
      {vencido ? (
        <Alerta tom="critico" icone={TriangleAlert}>
          <b className="font-semibold">O código de hoje já venceu, em {dataNaLoja(a.venceEm, fuso)}.</b> O sistema volta a enviar assim que receber o novo.
        </Alerta>
      ) : (
        <Alerta tom="atencao" icone={Clock}>
          <b className="font-semibold">O código de hoje continua valendo por mais 7 dias,</b> para dar tempo de trocar no sistema. Depois, só o novo entra.
        </Alerta>
      )}
      <CampoDaSenha
        id={idSenha}
        idErro={idErroDaSenha}
        valor={senha}
        erro={erroDaSenha}
        fazendo="renovando"
        aoMudar={(v) => {
          setSenha(v);
          setErroDaSenha(null);
        }}
      />
      <p className={`flex items-start gap-1.5 ${AJUDA}`}>
        <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Os outros da diretoria veem um aviso de que você renovou este acesso.</span>
      </p>
    </Gaveta>
  );
}

// ───────────────────────── o cartão "Outro sistema" ─────────────────────────

/** Em que pé está o acesso, dito como o protótipo diz: o selo e a linha de baixo. */
function EstadoDoAcesso({ a }: { a: AcessoDeOutroSistema }) {
  const fuso = a.fuso ?? FUSO_PADRAO;
  const dia = (iso: string) => dataNaLoja(iso, fuso);
  const fichas = a.recebidoEm && a.produtos !== null ? `${plural(a.produtos, 'produto', 'produtos')} · ${a.comFicha ? `${a.comFicha} com ficha` : 'nenhuma ficha'}` : null;
  // Renovado e ainda sem envio com o código novo (o antigo já parou, ou nem havia): espera o primeiro envio com ele.
  const esperandoONovo = a.renovadoEm !== null && !a.anteriorValeAte && (!a.recebidoEm || Date.parse(a.recebidoEm) < Date.parse(a.renovadoEm));

  let selo: React.ReactNode;
  let linha: string;
  if (a.situacao === 'vencido') {
    selo = <Chip tom="critico">venceu em {dia(a.venceEm)}</Chip>;
    linha = a.recebidoEm ? `não recebe nada desde então · último envio em ${dia(a.recebidoEm)}` : 'não recebe nada desde então';
  } else if (a.situacao === 'suspenso') {
    selo = <Chip tom="critico">suspenso</Chip>;
    linha = `90 dias sem uso · o último foi em ${dia(a.ultimoUsoEm ?? a.renovadoEm ?? a.criadoEm)}`;
  } else if (a.anteriorValeAte && a.renovadoEm) {
    selo = <Chip tom="ok">renovado {diaFaladoNaLoja(a.renovadoEm, fuso)}</Chip>;
    linha = `o antigo vale até ${dia(a.anteriorValeAte)} · o novo, até ${dia(a.venceEm)}`;
  } else if (esperandoONovo && a.renovadoEm) {
    selo = <Chip tom="ok">renovado {diaFaladoNaLoja(a.renovadoEm, fuso)}</Chip>;
    linha = `esperando o primeiro envio com ele · vale até ${dia(a.venceEm)}`;
  } else if (a.situacao === 'vence') {
    selo = <Chip tom="atencao">vence em {plural(diasAte(a.venceEm), 'dia', 'dias')}</Chip>;
    linha = `${a.recebidoEm ? `recebido ${diaFaladoNaLoja(a.recebidoEm, fuso)}` : 'ainda não enviou nada'} · vale até ${dia(a.venceEm)}`;
  } else if (!a.recebidoEm) {
    selo = <Chip>ainda não enviou nada</Chip>;
    linha = `criado ${diaFaladoNaLoja(a.criadoEm, fuso)} · vale até ${dia(a.venceEm)}`;
  } else {
    selo = <Chip tom="ok">recebido {diaFaladoNaLoja(a.recebidoEm, fuso)}</Chip>;
    linha = `${fichas ?? 'nenhuma ficha'} · vale até ${dia(a.venceEm)}`;
  }
  return (
    <div className="flex min-w-0 flex-col items-start gap-1" data-estado={a.situacao}>
      {selo}
      <span className="break-words font-mono text-xs text-farol-suave">{linha}</span>
    </div>
  );
}

function LinhaDoAcesso({
  a,
  podeMexer,
  reativando,
  aoRenovar,
  aoReativar,
  aoRevogar,
}: {
  a: AcessoDeOutroSistema;
  podeMexer: boolean;
  reativando: boolean;
  aoRenovar: () => void;
  aoReativar: () => void;
  aoRevogar: () => void;
}) {
  const urgente = a.situacao === 'vence' || a.situacao === 'vencido';
  return (
    <li
      data-acesso={a.id}
      className="grid grid-cols-1 items-center gap-x-4 gap-y-2.5 border-b border-farol-borda px-[18px] py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <b className="block break-words font-semibold">{a.nome}</b>
        <small className="block break-words text-xs text-farol-suave">
          envia para a {a.lojaNome}
          {a.criadoPor ? ` · criado por ${a.criadoPor}` : ''}
        </small>
      </div>
      <EstadoDoAcesso a={a} />
      <div className="flex flex-wrap gap-2 md:justify-end">
        {a.recebidoEm && (
          <Link href={`/lojas/${a.lojaId}/fichas`} className={classesDoBotao({ mini: true })}>
            Ver fichas
          </Link>
        )}
        {podeMexer &&
          (a.situacao === 'suspenso' ? (
            // Reativar é um clique: o código é o mesmo, e nada sai do console.
            <Botao mini variante="primario" ocupado={reativando} onClick={aoReativar}>
              Reativar
            </Botao>
          ) : (
            !a.anteriorValeAte && (
              <Botao mini variante={urgente ? 'primario' : undefined} onClick={aoRenovar}>
                Renovar
              </Botao>
            )
          ))}
        {podeMexer && (
          <Botao mini variante="perigo-leve" onClick={aoRevogar}>
            Revogar
          </Botao>
        )}
      </div>
    </li>
  );
}

/** O que os outros da diretoria fizeram nos acessos e quem olha ainda não viu — no topo de Conexões, até "Entendi". */
export function AvisoDosAcessos({ a, aoMudar }: { a: AcessosDaConta; aoMudar: () => Promise<unknown> }) {
  const [vendo, setVendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (a.avisos.length === 0) return null;
  const quando = (iso: string) => diaFaladoNaLoja(iso, FUSO_PADRAO);
  const frases = a.avisos.map((v) => {
    if (v.acao === 'criou') return `${v.por} criou o acesso do ${v.sistema} para a ${v.loja} (${quando(v.em)}).`;
    if (v.acao === 'renovou') return `${v.por} renovou o acesso do ${v.sistema} (${quando(v.em)}).${v.anteriorValeAte ? ` O código antigo vale até ${dataNaLoja(v.anteriorValeAte, FUSO_PADRAO)}.` : ''}`;
    if (v.acao === 'reativou') return `${v.por} reativou o acesso do ${v.sistema} (${quando(v.em)}).`;
    return `${v.por} revogou o acesso do ${v.sistema}, da ${v.loja} (${quando(v.em)}).`;
  });

  async function entendi() {
    setVendo(true);
    setErro(null);
    try {
      await acessosApi.avisosVistos();
      await aoMudar();
    } catch (e) {
      setErro(frase(mensagemDe(e)));
    } finally {
      setVendo(false);
    }
  }

  return (
    <Alerta tom="atencao" icone={Bell} papel="status">
      <b className="font-semibold">{a.avisos.length === 1 ? 'Mudou um acesso de outro sistema.' : 'Mudaram acessos de outro sistema.'}</b>{' '}
      {frases.join(' ')} Não foi você? Revogue o acesso e fale com quem o fez.
      {erro && <span className="mt-1.5 block text-farol-critico">{erro}</span>}
      <span className="mt-2 block">
        <Botao mini ocupado={vendo} onClick={entendi}>
          Entendi
        </Botao>
      </span>
    </Alerta>
  );
}

export function OutroSistema({ a, aoMudar }: { a: AcessosDaConta; aoMudar: () => Promise<unknown> }) {
  const id = useId();
  const avisar = useAvisar();
  const documentacao = useEnderecoDaDocumentacao();
  const [criando, setCriando] = useState(false);
  const [renovando, setRenovando] = useState<AcessoDeOutroSistema | null>(null);
  const [reativando, setReativando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<AcessoDeOutroSistema | null>(null);
  const [revogando, setRevogando] = useState(false);
  const [erroAoRevogar, setErroAoRevogar] = useState<string | null>(null);
  const n = a.acessos.length;
  const noTeto = a.teto.maximo !== null && a.teto.ativos >= a.teto.maximo;

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

  async function reativar(acesso: AcessoDeOutroSistema) {
    setReativando(acesso.id);
    try {
      await acessosApi.reativar(acesso.id);
      await aoMudar();
      avisar(`Acesso reativado: o ${acesso.nome} volta a conseguir enviar agora, com o mesmo código. Se ficar mais 90 dias sem uso, é suspenso de novo.`);
    } catch (e) {
      avisar(frase(mensagemDe(e)));
      await aoMudar();
    } finally {
      setReativando(null);
    }
  }

  return (
    <>
      <section className={CARTAO} aria-labelledby={id} data-cartao="outro-sistema">
        <Cabeca id={id} titulo="Outro sistema">
          <Chip tom={noTeto ? 'atencao' : n > 0 ? 'ok' : undefined}>{n > 0 ? `${plural(n, 'acesso', 'acessos')}${noTeto ? ' · o máximo' : ''}` : 'nenhum acesso'}</Chip>
          {a.podeCriar && !noTeto && (
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
            {noTeto && a.podeCriar && (
              <div className="border-b border-farol-borda p-[18px]">
                <Alerta tom="atencao" icone={Info}>
                  <b className="font-semibold text-farol-tinta">A conta chegou a {a.teto.maximo} acessos, o máximo.</b> Para criar outro, revogue um que não se usa mais.
                </Alerta>
              </div>
            )}
            <ul className="flex flex-col">
              {a.acessos.map((acesso) => (
                <LinhaDoAcesso
                  key={acesso.id}
                  a={acesso}
                  podeMexer={a.podeCriar}
                  reativando={reativando === acesso.id}
                  aoRenovar={() => setRenovando(acesso)}
                  aoReativar={() => void reativar(acesso)}
                  aoRevogar={() => {
                    setErroAoRevogar(null);
                    setAlvo(acesso);
                  }}
                />
              ))}
            </ul>
            <div className="border-t border-farol-borda p-[18px]">
              <p className={AJUDA}>
                O código de acesso aparece uma vez, quando é criado ou renovado. Ele vale 12 meses, e 15 dias antes de vencer o Farol avisa aqui e na tela Fichas.
                Parado 90 dias, fica suspenso até alguém da diretoria reativar. Perdeu o código? Renove: sai um novo, e o antigo para em 7 dias. Desconfia que vazou?
                Revogue. A documentação para quem cuida do sistema fica em <Documentacao endereco={documentacao} />.
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

      {criando && <NovoAcesso lojas={a.lojas} termo={a.termo} aoFechar={() => setCriando(false)} aoCriar={() => void aoMudar()} />}

      {renovando && <Renovar a={renovando} aoFechar={() => setRenovando(null)} aoRenovar={() => void aoMudar()} />}

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
