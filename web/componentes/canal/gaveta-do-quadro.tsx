'use client';

// =====================================================================
// A gaveta do quadro — nome, papel, contorno e exclusão
// =====================================================================
// O quadro é um recorte da imagem do canal, com nome e PAPEL. O papel diz
// ao Farol o que há ali; um deles ("posição de montagem") também muda como
// a imagem é conferida, e a gaveta diz isso antes de alguém escolher.
//
// O contorno não se desenha aqui: "Redesenhar o contorno" leva à tela do
// desenho por pontos, já neste quadro.
// =====================================================================

import { Info, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { caixaDe } from '@/componentes/areas/poligono';
import { numero as emNumero, plural } from '@/componentes/formatos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { AJUDA, Campo } from '@/componentes/ui/campo';
import { Alerta } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, previewApi, type Papel, type PontoCompleto, type ZonaCompleta } from '@/lib/api';

import { O_QUE_O_PAPEL_MUDA, oQueEOPapel, PAPEIS } from './quadros';

/** Quantos pontos de imagem o quadro tem na câmera — ou `null` quando não se sabe a resolução dela. */
export function pixelsDoQuadro(zona: Pick<ZonaCompleta, 'poligono'>, ponto: Pick<PontoCompleto, 'resolucao_h' | 'preview_largura' | 'preview_altura'>): [number, number] | null {
  const largura = ponto.resolucao_h;
  if (!largura || !ponto.preview_largura || !ponto.preview_altura) return null;
  const altura = (largura * ponto.preview_altura) / ponto.preview_largura;
  const c = caixaDe(zona.poligono);
  return [Math.round((c.x2 - c.x1) * largura), Math.round((c.y2 - c.y1) * altura)];
}

export function GavetaDoQuadro({
  ponto,
  zona,
  paraExcluir,
  agenteSabeBancada,
  aoFechar,
  aoSalvar,
}: {
  ponto: PontoCompleto;
  zona: ZonaCompleta;
  /** Aberta pelo "Excluir o quadro" do menu: o foco começa no botão de excluir. */
  paraExcluir: boolean;
  /** O agente desta loja já sabe a regra do quadro de bancada? `null` = a loja não tem agente que tenha dito. */
  agenteSabeBancada: boolean | null;
  aoFechar: () => void;
  /** Depois de salvar ou de excluir: a tela recarrega o canal e confirma com esta frase. */
  aoSalvar: (mensagem: string, excluido: boolean) => Promise<void>;
}) {
  const p = useId();
  const [nome, setNome] = useState(zona.nome);
  const [papel, setPapel] = useState<Papel>(zona.papel ?? 'livre');
  const [salvando, setSalvando] = useState(false);
  const [certeza, setCerteza] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Onde o foco começa. `autoFocus` não serve aqui: a gaveta é um <dialog>
  // que só abre depois de montada, e o navegador põe o foco no primeiro
  // botão dela (o de fechar). Este efeito roda DEPOIS do que abre a gaveta
  // (os efeitos dos filhos vêm antes), então o foco pega.
  const campoDoNome = useRef<HTMLInputElement>(null);
  const botaoDeExcluir = useRef<HTMLButtonElement>(null);
  const nomeDeFabrica = /^quadro novo( \d+)?$/i.test(zona.nome.trim());
  useEffect(() => {
    if (paraExcluir) botaoDeExcluir.current?.focus();
    else if (nomeDeFabrica) {
      // O quadro acabou de nascer: o nome é a primeira coisa a acertar.
      campoDoNome.current?.focus();
      campoDoNome.current?.select();
    }
    // Só na abertura: depois o foco é de quem está usando a gaveta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ocupado = salvando || excluindo;
  const px = pixelsDoQuadro(zona, ponto);
  const muda = O_QUE_O_PAPEL_MUDA[papel];
  const criterios = zona.criterios.length;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const limpo = nome.trim();
    if (!limpo) return setErro('Dê um nome ao quadro.');
    setSalvando(true);
    try {
      await previewApi.salvarArea(zona.id, { nome: limpo, papel });
      await aoSalvar(
        papel !== (zona.papel ?? 'livre')
          ? 'Quadro salvo. O agente usa o papel novo na próxima batida.'
          : 'Quadro salvo.',
        false,
      );
    } catch (e2) {
      setErro(e2 instanceof ErroDaApi ? e2.message : 'não consegui salvar');
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!certeza) {
      setCerteza(true);
      return;
    }
    setErro(null);
    setExcluindo(true);
    try {
      const r = await previewApi.excluirArea(zona.id);
      const desligados = r.criteriosDesligados.length;
      await aoSalvar(
        `Quadro “${zona.nome}” excluído. Os outros foram renumerados.` +
          (r.criteriosTirados > 0
            ? ` ${r.criteriosTirados === 1 ? '1 critério saiu' : `${r.criteriosTirados} critérios saíram`} deste canal` +
              (desligados > 0
                ? `; ${desligados} ${desligados === 1 ? 'ficou' : 'ficaram'} sem lugar e ${desligados === 1 ? 'foi desligado' : 'foram desligados'}.`
                : '.')
            : ''),
        true,
      );
    } catch (e2) {
      // O erro fica na gaveta: fechá-la esconderia que a exclusão não aconteceu.
      setErro(e2 instanceof ErroDaApi ? e2.message : 'não consegui excluir');
      setExcluindo(false);
    }
  }

  return (
    <Gaveta
      titulo={`Quadro ${zona.numero ?? ''}`.trim()}
      descricao={
        <>
          {ponto.nome}
          {px && (
            <>
              {' · '}
              <span className="font-mono">
                {emNumero(px[0])} × {emNumero(px[1])} px
              </span>{' '}
              na câmera
            </>
          )}
        </>
      }
      ocupado={ocupado}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando} disabled={excluindo}>
            {salvando ? 'Salvando…' : 'Salvar quadro'}
          </Botao>
          <Botao onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={salvar} className="flex flex-col gap-4" aria-label={`Editar o Quadro ${zona.numero ?? ''}, ${zona.nome}`}>
        <Campo rotulo="Nome do quadro" htmlFor={`${p}-nome`}>
          <input
            ref={campoDoNome}
            id={`${p}-nome`}
            required
            maxLength={60}
            className="entrada"
            placeholder="Área de montagem"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </Campo>

        <Campo rotulo="Papel — o que este quadro é" htmlFor={`${p}-papel`} ajuda={<span id={`${p}-papel-nota`}>{oQueEOPapel(papel)}</span>}>
          <select
            id={`${p}-papel`}
            className="entrada"
            aria-describedby={`${p}-papel-nota`}
            value={papel}
            onChange={(e) => setPapel(e.target.value as Papel)}
          >
            {PAPEIS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.nome}
              </option>
            ))}
          </select>
        </Campo>

        {muda ? (
          <div className="flex flex-col gap-2.5" data-o-que-o-papel-muda>
            <Alerta icone={Info}>{muda.muda}</Alerta>
            <Alerta tom="atencao" icone={TriangleAlert}>
              {muda.cuidado}
              {agenteSabeBancada === false && (
                <> O computador desta loja ainda não tem esta regra: até ele ser atualizado, a imagem é conferida como sempre.</>
              )}
              {agenteSabeBancada === null && <> Esta loja ainda não tem agente instalado: a regra vale quando ele estiver lá.</>}
            </Alerta>
          </div>
        ) : (
          <Alerta icone={Info}>O papel diz ao Farol o que há neste quadro.</Alerta>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href={`/pontos/${ponto.id}/area?quadro=${zona.id}`} className={classesDoBotao()}>
            <Pencil className="h-[15px] w-[15px]" aria-hidden />
            Redesenhar o contorno
          </Link>
        </div>

        <div className="flex flex-col items-start gap-1.5 border-t border-farol-borda pt-4" data-excluir-quadro>
          <Botao ref={botaoDeExcluir} variante="perigo-leve" className="-ml-2" onClick={excluir} ocupado={excluindo} disabled={salvando}>
            {!excluindo && <Trash2 className="h-[15px] w-[15px]" aria-hidden />}
            {excluindo
              ? 'Excluindo…'
              : certeza
                ? `Excluir mesmo o Quadro ${zona.numero ?? ''} · ${zona.nome}`
                : 'Excluir este quadro'}
          </Botao>
          {certeza && (
            <p role="status" className={AJUDA}>
              {criterios > 0
                ? `${criterios === 1 ? 'O critério dele deixa' : `Os ${plural(criterios, 'critério', 'critérios')} dele deixam`} de valer aqui. ` +
                  'Se era o único lugar de algum, ele é desligado. O histórico fica.'
                : 'Nenhum critério depende dele. O histórico do que ele já registrou fica.'}
            </p>
          )}
        </div>

        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}
