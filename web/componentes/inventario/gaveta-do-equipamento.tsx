'use client';

// =====================================================================
// O equipamento — cadastrar e editar, numa gaveta
// =====================================================================
// Nome, setor e tipo; até quatro fotos dele limpo e no lugar; onde aparece;
// e a descrição, que vai junto com cada pergunta feita à nuvem sobre a área
// em que ele aparece.
//
// **As fotos são guardadas na hora**, não no "Salvar": cada uma é um envio
// (ou a cópia do quadro de um canal), e segurá-las até o fim seria perder
// tudo num fechar de gaveta. Por isso, num equipamento novo, a primeira foto
// já cria o cadastro com o nome que estiver escrito.
//
// **Quem só vê abre para LER**: os campos ficam travados e os botões somem.
// =====================================================================

import { Cctv, Image as Imagem, ScanSearch, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useRef, useState } from 'react';

import { emOrdem, rotuloDoCanal } from '@/componentes/criterios/canais';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, Campo, GRADE, Grupo, ROTULO } from '@/componentes/ui/campo';
import { Alerta } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import {
  consoleApi,
  ErroDaApi,
  inventarioApi,
  type Equipamento,
  type Setor,
  type TipoDeEquipamento,
} from '@/lib/api';

import { FotoDoEquipamento } from './foto-do-equipamento';
import { reduzirParaEnvio } from './imagem';
import { numeroDoCanal, TIPOS_DE_EQUIPAMENTO } from './rotulos';

const SETOR_NOVO = '__novo__';

type Props = {
  lojaId: string;
  setores: Setor[];
  /** O equipamento em edição. Ausente = cadastrando um novo. */
  item?: Equipamento;
  configura: boolean;
  maximoDeFotos: number;
  /** O cadastro mudou no servidor (foi criado, ganhou ou perdeu foto): a lista atrás acompanha. */
  aoMudar: (item: Equipamento) => void;
  aoSalvar: (mensagem: string) => Promise<void>;
  /** "Criar critério" a partir de um ponto a conferir. */
  aoCriarCriterio: (item: Equipamento, frase: string) => void;
  aoExcluir: (item: Equipamento) => void;
  aoFechar: () => void;
};

export function GavetaDoEquipamento({
  lojaId,
  setores,
  item,
  configura,
  maximoDeFotos,
  aoMudar,
  aoSalvar,
  aoCriarCriterio,
  aoExcluir,
  aoFechar,
}: Props) {
  const p = useId();
  const avisar = useAvisar();
  const campoDoNome = useRef<HTMLInputElement>(null);
  const campoDeArquivo = useRef<HTMLInputElement>(null);

  /** O cadastro como está no servidor. `null` = ainda não foi criado. */
  const [atual, setAtual] = useState<Equipamento | null>(item ?? null);
  const [nome, setNome] = useState(item?.nome ?? '');
  const [setorId, setSetorId] = useState(item?.setorId ?? setores[0]?.id ?? SETOR_NOVO);
  const [setorNovo, setSetorNovo] = useState('');
  /** Setores criados daqui, para aparecerem na lista sem recarregar a página. */
  const [criados, setCriados] = useState<Setor[]>([]);
  const [tipo, setTipo] = useState<TipoDeEquipamento>(item?.tipo ?? 'chapa');
  const [descricao, setDescricao] = useState(item?.descricao ?? '');

  const [escolhendoCanal, setEscolhendoCanal] = useState(false);
  const [zonaEscolhida, setZonaEscolhida] = useState('');
  const [ocupado, setOcupado] = useState<'foto' | 'salvar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const todosOsSetores = useMemo(() => [...setores, ...criados], [setores, criados]);
  const fotos = atual?.fotos ?? [];
  const cheio = fotos.length >= maximoDeFotos;

  // Os canais em que dá para tirar a foto: os ativos, com a área. Os do
  // setor do equipamento vêm primeiro — é onde ele costuma aparecer.
  const quadros = useMemo(() => {
    const lista: { zonaId: string; rotulo: string; doSetor: boolean }[] = [];
    for (const s of todosOsSetores) {
      for (const ponto of emOrdem(s.pontos.filter((x) => x.ativo))) {
        for (const z of ponto.zonas) {
          lista.push({
            zonaId: z.id,
            rotulo: `${rotuloDoCanal(ponto)}${ponto.zonas.length > 1 ? ` — ${z.nome}` : ''}`,
            doSetor: s.id === setorId,
          });
        }
      }
    }
    return lista.sort((a, b) => Number(b.doSetor) - Number(a.doSetor));
  }, [todosOsSetores, setorId]);

  const dizer = (e: unknown, padrao: string) => setErro(e instanceof ErroDaApi || e instanceof Error ? e.message : padrao);

  /** O setor escolhido — criando-o antes, se foi "cadastrar novo setor". */
  async function oSetor(): Promise<string | null> {
    if (setorId !== SETOR_NOVO) return setorId;
    if (!setorNovo.trim()) {
      setErro('Diga o nome do setor novo.');
      return null;
    }
    const s = await consoleApi.criarSetor(lojaId, setorNovo.trim());
    setCriados((l) => [...l, { ...s, pontos: s.pontos ?? [] }]);
    setSetorId(s.id);
    setSetorNovo('');
    return s.id;
  }

  /** O cadastro no servidor — criando-o agora, se ainda não existe. */
  async function oCadastro(): Promise<Equipamento | null> {
    if (atual) return atual;
    if (!nome.trim()) {
      setErro('Dê um nome ao equipamento antes de pôr a foto.');
      campoDoNome.current?.focus();
      return null;
    }
    const setor = await oSetor();
    if (!setor) return null;
    const novo = await inventarioApi.criar(lojaId, { nome: nome.trim(), tipo, setorId: setor, descricao: descricao.trim() });
    setAtual(novo);
    aoMudar(novo);
    return novo;
  }

  function mudou(novo: Equipamento) {
    setAtual(novo);
    aoMudar(novo);
  }

  async function usarOQuadro() {
    if (!zonaEscolhida) return setErro('Escolha o canal de onde vem o quadro.');
    setErro(null);
    setOcupado('foto');
    try {
      const cadastro = await oCadastro();
      if (!cadastro) return;
      const r = await inventarioApi.fotoDoCanal(cadastro.id, zonaEscolhida);
      mudou(r.item);
      setEscolhendoCanal(false);
      avisar('Quadro do canal guardado como foto.');
    } catch (e) {
      dizer(e, 'não consegui guardar o quadro do canal');
    } finally {
      setOcupado(null);
    }
  }

  async function enviarFoto(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    setOcupado('foto');
    try {
      const cadastro = await oCadastro();
      if (!cadastro) return;
      const r = await inventarioApi.fotoEnviada(cadastro.id, await reduzirParaEnvio(arquivo));
      mudou(r.item);
      avisar('Foto enviada.');
    } catch (e) {
      dizer(e, 'não consegui enviar a foto');
    } finally {
      setOcupado(null);
      // Para o mesmo arquivo poder ser escolhido de novo.
      if (campoDeArquivo.current) campoDeArquivo.current.value = '';
    }
  }

  async function tirarFoto(fotoId: string) {
    setErro(null);
    setOcupado('foto');
    try {
      mudou((await inventarioApi.tirarFoto(fotoId)).item);
      avisar('Foto tirada.');
    } catch (e) {
      dizer(e, 'não consegui tirar a foto');
    } finally {
      setOcupado(null);
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado('salvar');
    try {
      const setor = await oSetor();
      if (!setor) return setOcupado(null);
      const campos = { nome: nome.trim(), tipo, setorId: setor, descricao: descricao.trim() };
      const salvo = atual ? await inventarioApi.editar(atual.id, campos) : await inventarioApi.criar(lojaId, campos);
      mudou(salvo);
      await aoSalvar(`“${salvo.nome}” salvo no inventário.`);
    } catch (e) {
      dizer(e, 'não consegui salvar o equipamento');
      setOcupado(null);
    }
  }

  return (
    <Gaveta
      titulo={atual ? atual.nome : 'Novo equipamento'}
      descricao="Como ele fica quando está limpo e no lugar."
      ocupado={ocupado !== null}
      aoFechar={aoFechar}
      rodape={
        <>
          {configura && (
            <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={ocupado === 'salvar'} disabled={ocupado !== null}>
              {ocupado === 'salvar' ? 'Salvando…' : 'Salvar equipamento'}
            </Botao>
          )}
          <Botao onClick={aoFechar} disabled={ocupado !== null}>
            Fechar
          </Botao>
          {configura && atual && (
            <Botao variante="perigo-leve" onClick={() => aoExcluir(atual)} disabled={ocupado !== null}>
              <Trash2 className="h-[16px] w-[16px]" aria-hidden />
              Excluir
            </Botao>
          )}
        </>
      }
    >
      <form
        id={`${p}-form`}
        onSubmit={enviar}
        className="flex flex-col gap-4"
        aria-label={atual ? `Equipamento ${atual.nome}` : 'Novo equipamento'}
        data-equipamento={atual?.id ?? ''}
      >
        <div className={GRADE}>
          <Campo rotulo="Nome" htmlFor={`${p}-nome`} largo>
            <input
              ref={campoDoNome}
              id={`${p}-nome`}
              required
              autoFocus={!item}
              maxLength={80}
              disabled={!configura}
              className="entrada"
              placeholder="Chapa"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Setor" htmlFor={`${p}-setor`}>
            <select id={`${p}-setor`} className="entrada" disabled={!configura} value={setorId} onChange={(e) => setSetorId(e.target.value)}>
              {todosOsSetores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
              {configura && <option value={SETOR_NOVO}>＋ cadastrar novo setor</option>}
            </select>
          </Campo>
          <Campo rotulo="Tipo" htmlFor={`${p}-tipo`}>
            <select
              id={`${p}-tipo`}
              className="entrada"
              disabled={!configura}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoDeEquipamento)}
            >
              {TIPOS_DE_EQUIPAMENTO.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </Campo>
          {setorId === SETOR_NOVO && (
            <Campo rotulo="Nome do setor novo" htmlFor={`${p}-setor-novo`} largo>
              <input
                id={`${p}-setor-novo`}
                className="entrada"
                placeholder="Cozinha, Salão, Estoque…"
                maxLength={60}
                value={setorNovo}
                onChange={(e) => setSetorNovo(e.target.value)}
              />
            </Campo>
          )}
        </div>

        {/* ───────────── as fotos ───────────── */}
        <div className="flex min-w-0 flex-col gap-2">
          <span className={ROTULO}>
            Fotos do equipamento limpo{' '}
            <span className="font-normal text-farol-suave" data-conta-de-fotos>
              · {fotos.length} de {maximoDeFotos}
            </span>
          </span>
          <ul className="grid grid-cols-4 gap-2" data-fotos-do-equipamento>
            {Array.from({ length: maximoDeFotos }, (_, i) => {
              const f = fotos[i];
              if (!f) {
                return (
                  <li
                    key={`vazia-${i}`}
                    className="grid aspect-[16/11] place-items-center rounded-lg border border-dashed border-farol-borda-forte px-1 text-center text-[10.5px] text-farol-suave"
                  >
                    {i === fotos.length ? 'próxima foto' : ''}
                  </li>
                );
              }
              return (
                <li
                  key={f.id}
                  title={f.origem === 'canal' ? 'Do quadro do canal' : 'Foto enviada'}
                  className="relative aspect-[16/11] overflow-hidden rounded-lg bg-farol-realce shadow-[inset_0_0_0_1px_rgb(var(--borda-forte))]"
                >
                  <FotoDoEquipamento foto={f} alt={`Foto ${i + 1} de ${nome || 'equipamento'}`} />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-0.5 text-[10.5px] text-[#DCE8F5]">
                    {f.origem === 'canal' ? 'do quadro do canal' : 'foto enviada'}
                  </span>
                  {configura && (
                    <button
                      type="button"
                      aria-label={`Tirar a foto ${i + 1}`}
                      disabled={ocupado !== null}
                      onClick={() => void tirarFoto(f.id)}
                      className="absolute right-[3px] top-[3px] grid h-7 w-7 place-items-center rounded-md bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {configura && (
            <div className="flex flex-wrap gap-2">
              <Botao
                mini
                disabled={cheio || ocupado !== null}
                title={cheio ? `O equipamento já tem ${maximoDeFotos} fotos: tire uma para pôr outra` : undefined}
                aria-expanded={escolhendoCanal}
                onClick={() => {
                  setErro(null);
                  setEscolhendoCanal((v) => !v);
                  if (!zonaEscolhida && quadros[0]) setZonaEscolhida(quadros[0].zonaId);
                }}
              >
                <Cctv className="h-[15px] w-[15px]" aria-hidden />
                Usar o quadro de um canal
              </Botao>
              <Botao
                mini
                disabled={cheio || ocupado !== null}
                title={cheio ? `O equipamento já tem ${maximoDeFotos} fotos: tire uma para pôr outra` : undefined}
                ocupado={ocupado === 'foto' && !escolhendoCanal}
                onClick={() => campoDeArquivo.current?.click()}
              >
                {!(ocupado === 'foto' && !escolhendoCanal) && <Imagem className="h-[15px] w-[15px]" aria-hidden />}
                Enviar foto
              </Botao>
              <input
                ref={campoDeArquivo}
                type="file"
                accept="image/*"
                hidden
                tabIndex={-1}
                data-arquivo-da-foto
                onChange={(e) => void enviarFoto(e.target.files?.[0])}
              />
            </div>
          )}

          {configura && escolhendoCanal && !cheio && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-farol-borda bg-farol-painel-2 p-3" data-escolher-canal>
              {quadros.length === 0 ? (
                <p className="text-[13px] text-farol-suave">
                  Esta loja ainda não tem canal ativo. Cadastre o canal em Canais e volte aqui.
                </p>
              ) : (
                <>
                  <Campo rotulo="De que canal" htmlFor={`${p}-quadro`} ajuda="É o quadro que o canal tem agora, no recorte da área. Para outra cena, atualize o quadro em “Quadro e área” antes.">
                    <select id={`${p}-quadro`} className="entrada" value={zonaEscolhida} onChange={(e) => setZonaEscolhida(e.target.value)}>
                      {quadros.map((q) => (
                        <option key={q.zonaId} value={q.zonaId}>
                          {q.rotulo}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <div className="flex flex-wrap gap-2">
                    <Botao mini variante="primario" onClick={() => void usarOQuadro()} ocupado={ocupado === 'foto'} disabled={ocupado !== null}>
                      Usar este quadro
                    </Botao>
                    <Botao mini onClick={() => setEscolhendoCanal(false)} disabled={ocupado !== null}>
                      Cancelar
                    </Botao>
                  </div>
                </>
              )}
            </div>
          )}

          <p className={AJUDA}>
            Sem ninguém na frente. A foto tirada do quadro do canal diz onde o equipamento aparece; a enviada, de perto,
            serve para descrever.
          </p>
        </div>

        {/* ───────────── onde aparece ───────────── */}
        <div className="flex min-w-0 flex-col gap-2">
          <span className={ROTULO}>Onde aparece</span>
          {atual && atual.aparece.length > 0 ? (
            <ul className="flex flex-col gap-2.5" data-onde-aparece>
              {atual.aparece.map((l) => (
                <li key={l.zonaId} className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-farol-realce text-farol-marca">
                    <Cctv className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block break-words font-semibold">{l.pontoNome}</b>
                    <small className="block text-xs text-farol-suave">
                      {numeroDoCanal(l.canal) ? `canal ${numeroDoCanal(l.canal)} · ` : ''}
                      {l.variasAreas ? l.zonaNome : 'quadro inteiro'}
                      {l.fotosPadrao > 0 ? ' · com foto padrão' : ''}
                    </small>
                  </span>
                  <Link href={`/pontos/${l.pontoId}/area`} className="elo shrink-0 text-[13px]">
                    Ver
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-farol-suave" data-onde-aparece>
              Nenhuma câmera marcada. Use “Usar o quadro de um canal” para dizer onde ele aparece.
            </p>
          )}
        </div>

        {/* ───────────── a descrição ───────────── */}
        <Grupo titulo="Descrição">
          <p className="text-[12.5px] text-farol-suave">
            Como ele é e como fica quando está limpo e no lugar. Vai junto com cada pergunta feita à nuvem sobre a área em
            que ele aparece.
          </p>
          <textarea
            id={`${p}-descricao`}
            rows={5}
            maxLength={2000}
            disabled={!configura}
            aria-label="Descrição do equipamento"
            className="entrada min-h-[112px] resize-y leading-normal"
            placeholder="Ainda sem descrição."
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
          {atual && atual.conferir.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2" data-o-que-conferir>
              <span className={ROTULO}>O que vale conferir neste equipamento</span>
              <ul className="flex flex-col gap-2.5">
                {atual.conferir.map((frase) => (
                  <li key={frase} className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-farol-realce text-farol-marca">
                      <ScanSearch className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <b className="min-w-0 flex-1 break-words font-semibold">{frase}</b>
                    {configura && (
                      <Botao mini onClick={() => aoCriarCriterio(atual, frase)}>
                        Criar critério
                      </Botao>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Grupo>

        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}
