'use client';

// =====================================================================
// A gaveta de um ingrediente: as fotos de referência dele
// =====================================================================
// A21, fatia T2. Pedido do dono (15/10/2026): "já providencie a opção de
// agregar imagens nas fichas em cada ingrediente". Do protótipo aprovado
// no mesmo dia (`mockups/farol-conexoes-e-fichas.html`, tela Fichas).
//
// A foto fica presa ao NOME do ingrediente na loja (a ficha não tem número
// de ingrediente) e vale para todos os produtos que o usam. É guardada na
// hora, como no inventário: não há "Salvar".
//
// Quem pode — a API decide; aqui só se escolhe entre o botão e a frase:
//   • mandar foto: quem acompanha a loja (supervisão para cima);
//   • tirar foto, "não se vê de cima", juntar e apagar o órfão: quem
//     configura a loja.
//
// O ÓRFÃO é o ingrediente que saiu das fichas (mudou de nome, ou o produto
// saiu) e ainda tem fotos: elas esperam alguém dizer de qual ingrediente
// são — ou ser apagadas. Juntar nunca descarta foto: passando do máximo, a
// API recusa e diz quantas tirar.
//
// O que ainda não tem serviço não aparece: os exemplos da bancada e o
// reconhecimento chegam com o treinamento (fatias T4 e T5).
// =====================================================================

import { Camera, ChevronLeft, ImagePlus, Info, TriangleAlert, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { diaFaladoNaLoja, frase, plural } from '@/componentes/formatos';
import { reduzirParaEnvio } from '@/componentes/inventario/imagem';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { Alerta, Chip, Liga } from '@/componentes/ui/pecas';
import { Dialogo, Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, ingredientesApi, type FotoDoIngrediente, type IngredienteDaLoja, type IngredientesDaLoja } from '@/lib/api';

export type Orfao = IngredientesDaLoja['orfaos'][number];
export type AlvoDaGaveta = { tipo: 'ingrediente'; ingrediente: IngredienteDaLoja } | { tipo: 'orfao'; orfao: Orfao };

const mensagemDe = (e: unknown, padrao: string): string => frase(e instanceof ErroDaApi || e instanceof Error ? e.message : padrao);

const DICAS = [
  'De cima, como a câmera da bancada vê.',
  'Na bancada ou sobre o pão, com a luz de sempre.',
  'Uma foto da porção inteira e outra de perto.',
  'Se ele muda no preparo (cru e grelhado, inteiro e em fatias), uma foto de cada jeito.',
  'Sem pessoas na foto: só o ingrediente.',
];

/** As palavras que só ligam as partes do nome, e o plural que não é só tirar o "s" — os da API. */
const LIGACAO = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'c', 'a', 'o', 'as', 'os']);
const PLURAL_IRREGULAR: Record<string, string> = { paes: 'pao', aneis: 'anel', graos: 'grao', limoes: 'limao', mamoes: 'mamao' };

/**
 * A chave do ingrediente: a MESMA regra da API (`api/src/ingredientes.ts` — mudou lá, muda aqui). O mesmo ingrediente
 * escrito de jeitos diferentes tem a mesma chave: sem maiúscula e sem acento, sem as palavras que só ligam, no
 * singular, o peso junto do número. "Pão de Brioche" = "Pão Brioche" (o dono, 19/10/2026).
 */
export function chaveDoIngrediente(nome: string): string {
  const simples = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const comPeso = simples.replace(/(\d+(?:[.,]\d+)?)\s*(gramas?|grs?|g)(?![a-z])/g, (_, n: string) => `${n.replace(',', '.')}g`);
  const palavras = comPeso
    .split(/[^a-z0-9.]+/)
    .map((p) => p.replace(/^\.+|\.+$/g, ''))
    .filter((p) => p && !LIGACAO.has(p))
    .map((p) => PLURAL_IRREGULAR[p] ?? (p.length > 3 && p.endsWith('s') && !/\d/.test(p) ? p.slice(0, -1) : p));
  return palavras.length ? palavras.join(' ') : nome.trim().toLowerCase();
}

/** O botão das fotos, na linha do ingrediente da ficha (e do adicional que acrescenta um). */
export function BotaoDasFotos({ ingrediente, aoAbrir }: { ingrediente: IngredienteDaLoja; aoAbrir: () => void }) {
  const n = ingrediente.fotos.length;
  const texto = !ingrediente.visivel ? 'não se vê' : n ? String(n) : 'sem foto';
  const rotulo = !ingrediente.visivel
    ? `${ingrediente.nome}: não se vê de cima. Ver as fotos`
    : `${n ? plural(n, 'foto', 'fotos') : 'Sem foto'} de ${ingrediente.nome}. Ver as fotos`;
  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={rotulo}
      title={rotulo}
      data-fotos-de={ingrediente.nome}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11.5px] text-farol-suave transition-colors hover:text-farol-tinta ${
        n || !ingrediente.visivel ? 'shadow-[inset_0_0_0_1px_rgb(var(--borda-forte))]' : 'border border-dashed border-farol-borda-forte'
      }`}
    >
      <Camera className="h-[13px] w-[13px]" aria-hidden />
      <span aria-hidden>{texto}</span>
    </button>
  );
}

/** Onde o ingrediente entra, dito numa linha: "X-Burger e X-Salada (adicional)". */
function ondeEntra(i: IngredienteDaLoja): string {
  const nomes = i.produtos.map((p) => (p.adicional ? `${p.produto} (adicional)` : p.produto));
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

export function GavetaDoIngrediente({
  lojaId,
  fuso,
  alvo,
  limiteDeFotos,
  podeConfigurar,
  nomesNasFichas,
  voltarPara,
  aoMudar,
  aoFechar,
}: {
  lojaId: string;
  /** O relógio da loja: é nele que a foto diz "hoje, 10:12". */
  fuso: string;
  alvo: AlvoDaGaveta;
  limiteDeFotos: number;
  podeConfigurar: boolean;
  /** Os ingredientes das fichas, para dizer de qual o órfão é. */
  nomesNasFichas: string[];
  /** Veio da gaveta de um produto: o botão de voltar a ela. */
  voltarPara: { nome: string; aoVoltar: () => void } | null;
  /** Recarrega a lista de ingredientes (a gaveta mostra o que veio de lá). */
  aoMudar: () => Promise<void>;
  aoFechar: () => void;
}) {
  const p = useId();
  const avisar = useAvisar();
  const campoDeArquivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<null | 'foto' | 'tirar' | 'visivel' | 'juntar' | 'apagar'>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tirando, setTirando] = useState<FotoDoIngrediente | null>(null);
  const [apagando, setApagando] = useState(false);
  const [destino, setDestino] = useState('');

  const orfao = alvo.tipo === 'orfao' ? alvo.orfao : null;
  const ingrediente = alvo.tipo === 'ingrediente' ? alvo.ingrediente : null;
  const nome = orfao ? orfao.nome : ingrediente!.nome;
  const fotos = orfao ? orfao.fotos : ingrediente!.fotos;
  const cheio = fotos.length >= limiteDeFotos;

  async function fazer(qual: NonNullable<typeof ocupado>, acao: () => Promise<void>, padrao: string) {
    setErro(null);
    setOcupado(qual);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDe(e, padrao));
    } finally {
      setOcupado(null);
    }
  }

  const enviarFoto = (arquivo: File | undefined) => {
    if (!arquivo) return;
    void fazer(
      'foto',
      async () => {
        try {
          await ingredientesApi.mandarFoto(lojaId, nome, await reduzirParaEnvio(arquivo));
          await aoMudar();
          avisar('Foto enviada.');
        } finally {
          // Para o mesmo arquivo poder ser escolhido de novo.
          if (campoDeArquivo.current) campoDeArquivo.current.value = '';
        }
      },
      'não consegui enviar a foto',
    );
  };

  const tirarFoto = (f: FotoDoIngrediente) =>
    void fazer(
      'tirar',
      async () => {
        await ingredientesApi.tirarFoto(f.id);
        setTirando(null);
        await aoMudar();
        avisar(`Foto tirada do ${nome}.`);
      },
      'não consegui tirar a foto',
    );

  const marcarVisivel = (visivel: boolean) =>
    void fazer(
      'visivel',
      async () => {
        await ingredientesApi.visivel(lojaId, nome, visivel);
        await aoMudar();
        avisar(visivel ? `${nome}: volta a ser esperado na bancada.` : `${nome}: marcado como “não se vê de cima”.`);
      },
      'não consegui guardar',
    );

  const juntar = () =>
    void fazer(
      'juntar',
      async () => {
        if (!orfao) return;
        if (!destino) throw new Error('escolha de qual ingrediente são as fotos');
        const r = await ingredientesApi.juntar(orfao.itemId, destino);
        await aoMudar();
        avisar(`As fotos de “${r.de}” agora são do ${r.nome}.`);
        aoFechar();
      },
      'não consegui juntar as fotos',
    );

  const apagar = () =>
    void fazer(
      'apagar',
      async () => {
        if (!orfao) return;
        await ingredientesApi.apagar(orfao.itemId);
        setApagando(false);
        await aoMudar();
        avisar(`As fotos de “${orfao.nome}” foram apagadas.`);
        aoFechar();
      },
      'não consegui apagar as fotos',
    );

  return (
    <Gaveta
      titulo={nome}
      descricao={orfao ? 'saiu das fichas da loja' : `entra em ${ondeEntra(ingrediente!)}`}
      ocupado={ocupado !== null}
      aoFechar={aoFechar}
      rodape={
        <>
          {voltarPara && (
            <Botao onClick={voltarPara.aoVoltar} disabled={ocupado !== null}>
              <ChevronLeft className="h-[16px] w-[16px]" aria-hidden />
              Voltar ao {voltarPara.nome}
            </Botao>
          )}
          <Botao onClick={aoFechar} disabled={ocupado !== null}>
            Fechar
          </Botao>
        </>
      }
    >
      <div data-ingrediente={nome} className="flex flex-col gap-4">
        {orfao && (
          <Alerta tom="atencao" icone={Info} papel="status">
            <b className="font-semibold">Este ingrediente saiu das fichas.</b> As fotos dele esperam aqui: se ele só mudou de nome,
            diga qual é o nome novo e elas vão junto.
          </Alerta>
        )}

        {ingrediente && (
          <div className="flex flex-wrap gap-1.5" data-contas-do-ingrediente>
            <Chip>{fotos.length ? plural(fotos.length, 'foto sua', 'fotos suas') : 'nenhuma foto sua'}</Chip>
            {!ingrediente.visivel && <Chip tom="vazado">não se vê de cima</Chip>}
            {ingrediente.exemplos > 0 && <Chip>{plural(ingrediente.exemplos, 'exemplo da bancada', 'exemplos da bancada')}</Chip>}
          </div>
        )}

        {erro && (
          <Alerta tom="critico" icone={TriangleAlert} papel="alert">
            {erro}
          </Alerta>
        )}

        {/* ───────────── as fotos ───────────── */}
        <section className="flex min-w-0 flex-col gap-2" aria-labelledby={`${p}-fotos`}>
          <h3 id={`${p}-fotos`} className={ROTULO}>
            Fotos de referência{' '}
            <span className="font-normal text-farol-suave" data-conta-de-fotos>
              · {fotos.length} de {limiteDeFotos}
            </span>
          </h3>
          {ingrediente && (
            <p className={AJUDA}>Fotos suas, do ingrediente como ele entra no lanche. Valem para todos os produtos que o usam.</p>
          )}
          {fotos.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-fotos-do-ingrediente>
              {fotos.map((f, i) => (
                <li key={f.id} className="flex min-w-0 flex-col gap-1">
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-farol-realce shadow-[inset_0_0_0_1px_rgb(var(--borda-forte))]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a imagem vem da API, por id, e o navegador a guarda */}
                    <img src={ingredientesApi.urlDaFoto(f.id)} alt={`Foto ${i + 1} de ${nome}`} className="h-full w-full object-cover" loading="lazy" />
                    {podeConfigurar && ingrediente && (
                      <button
                        type="button"
                        aria-label={`Tirar a foto ${i + 1} de ${nome}`}
                        disabled={ocupado !== null}
                        onClick={() => setTirando(f)}
                        className="absolute right-[3px] top-[3px] grid h-7 w-7 place-items-center rounded-md bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </div>
                  <span className="truncate font-mono text-[11.5px] text-farol-suave">{f.legenda ?? diaFaladoNaLoja(f.criadoEm, fuso)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-farol-borda-forte px-3 py-4 text-center text-[13px] text-farol-suave">
              Nenhuma foto ainda.
            </p>
          )}

          {ingrediente && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-2">
                <Botao
                  mini
                  disabled={cheio || ocupado !== null}
                  title={cheio ? `${nome} já tem ${limiteDeFotos} fotos: tire uma para pôr outra` : undefined}
                  ocupado={ocupado === 'foto'}
                  onClick={() => campoDeArquivo.current?.click()}
                >
                  {ocupado !== 'foto' && <ImagePlus className="h-[15px] w-[15px]" aria-hidden />}
                  {ocupado === 'foto' ? 'Enviando…' : 'Enviar foto'}
                </Botao>
                <input
                  ref={campoDeArquivo}
                  type="file"
                  accept="image/*"
                  hidden
                  tabIndex={-1}
                  data-arquivo-da-foto
                  onChange={(e) => enviarFoto(e.target.files?.[0])}
                />
              </div>
              <p className={AJUDA}>
                {cheio
                  ? `Chegou ao limite de ${limiteDeFotos} fotos.${podeConfigurar ? ' Para enviar outra, tire uma.' : ' Quem configura a loja tira uma, se for o caso.'}`
                  : 'A foto é reduzida no seu aparelho antes de ir, como as do inventário.'}
              </p>
            </div>
          )}
        </section>

        {/* ───────────── o órfão: juntar ou apagar ───────────── */}
        {orfao &&
          (podeConfigurar ? (
            <section className="flex flex-col gap-2" aria-labelledby={`${p}-juntar`}>
              <h3 id={`${p}-juntar`} className={ROTULO}>
                De qual ingrediente são estas fotos
              </h3>
              <label htmlFor={`${p}-destino`} className="sr-only">
                É o mesmo ingrediente que
              </label>
              <select id={`${p}-destino`} className="entrada" value={destino} onChange={(e) => setDestino(e.target.value)} disabled={ocupado !== null}>
                <option value="">É o mesmo ingrediente que…</option>
                {nomesNasFichas.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <Botao variante="primario" mini onClick={juntar} ocupado={ocupado === 'juntar'} disabled={ocupado !== null || !destino}>
                  Juntar as fotos
                </Botao>
                <Botao variante="perigo-leve" mini onClick={() => setApagando(true)} disabled={ocupado !== null}>
                  Apagar as fotos
                </Botao>
              </div>
            </section>
          ) : (
            <p className={AJUDA}>Quem configura a loja diz de qual ingrediente elas são.</p>
          ))}

        {ingrediente && (
          <>
            <section className="flex flex-col gap-2" aria-labelledby={`${p}-dicas`}>
              <h3 id={`${p}-dicas`} className={ROTULO}>
                Como fotografar
              </h3>
              <ul className="flex flex-col gap-1.5">
                {DICAS.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-[13px]">
                    <Camera className="mt-0.5 h-[14px] w-[14px] shrink-0 text-farol-suave" aria-hidden />
                    <span className="min-w-0">{d}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-1.5" aria-labelledby={`${p}-camera`}>
              <h3 id={`${p}-camera`} className={ROTULO}>
                Na câmera
              </h3>
              {podeConfigurar ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Liga
                    ligado={!ingrediente.visivel}
                    aoMudar={(naoSeVe) => marcarVisivel(!naoSeVe)}
                    descricao={`${nome}: não se vê de cima`}
                    rotulo="Não se vê de cima"
                    desabilitado={ocupado !== null}
                  />
                </div>
              ) : (
                !ingrediente.visivel && <p className="text-[13px]">Marcado como “não se vê de cima”.</p>
              )}
              <p className={AJUDA}>
                Para sal, tempero e o que fica escondido por baixo. É a marca que o treinamento da bancada vai usar para não esperar
                vê-lo.
              </p>
            </section>
          </>
        )}
      </div>

      {tirando && (
        <Dialogo
          titulo={`Tirar esta foto do ${nome}?`}
          rotuloConfirmar="Tirar"
          rotuloCancelar="Manter"
          ocupado={ocupado === 'tirar'}
          rotuloOcupado="Tirando…"
          erro={ocupado === null ? erro : null}
          aoConfirmar={() => tirarFoto(tirando)}
          aoCancelar={() => setTirando(null)}
        >
          <p>O Farol deixa de usá-la como referência deste ingrediente.</p>
        </Dialogo>
      )}
      {apagando && orfao && (
        <Dialogo
          titulo={`Apagar as fotos de “${orfao.nome}”?`}
          rotuloConfirmar="Apagar as fotos"
          rotuloCancelar="Manter"
          ocupado={ocupado === 'apagar'}
          rotuloOcupado="Apagando…"
          erro={ocupado === null ? erro : null}
          aoConfirmar={apagar}
          aoCancelar={() => setApagando(false)}
        >
          <p>
            {plural(orfao.fotos.length, 'foto sai', 'fotos saem')} do Farol de vez. Se o ingrediente só mudou de nome, junte as fotos ao
            nome novo em vez de apagar.
          </p>
        </Dialogo>
      )}
    </Gaveta>
  );
}
