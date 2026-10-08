'use client';

// =====================================================================
// As duas respostas a uma saída do padrão
// =====================================================================
// "Era esperado": acontece sempre (o padrão passa a contar com isso) ou
// foi só desta vez (a hora fica de fora da conta do padrão).
//
// "É problema": o que aconteceu, o que foi feito e como não repetir — um
// critério novo com o costume daquela hora como limite, o ajuste de um
// que já existe, ou só o registro. O critério proposto nasce desligado.
//
// Quem grava é a API, que confere de novo se aquela hora ainda é uma saída
// do padrão e se ninguém respondeu antes.
// =====================================================================

import { Cctv, Clock } from 'lucide-react';
import { useId, useState } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { Campo, Escolhas } from '@/componentes/ui/campo';
import { Alerta, Chip } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, especialistaApi, type Padroes, type SaidaDoPadrao } from '@/lib/api';

import { ResumoDaSaida } from './pecas';

const MAX_TEXTO = 1000;

export function GavetaDeEsperado({
  lojaId,
  a,
  hoje,
  aoResponder,
  aoFechar,
}: {
  lojaId: string;
  a: SaidaDoPadrao;
  hoje: string;
  aoResponder: (padroes: Padroes, mensagem: string) => void;
  aoFechar: () => void;
}) {
  const p = useId();
  const [motivo, setMotivo] = useState<'sempre' | 'vez'>('sempre');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const novo = await especialistaApi.responder(lojaId, { anomaliaId: a.id, estado: 'esperado', soDestaVez: motivo === 'vez', nota: nota.trim() });
      aoResponder(novo, motivo === 'sempre' ? 'Marcado como esperado. O padrão passa a contar com isso.' : 'Marcado como esperado. Esta hora ficou de fora do padrão.');
    } catch (e) {
      // O erro fica na gaveta: fechá-la esconderia que a resposta não foi guardada.
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui guardar a resposta');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo="Era esperado"
      descricao="Conte ao padrão por que isso não é problema."
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando}>
            {salvando ? 'Guardando…' : 'Marcar como esperado'}
          </Botao>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={enviar} className="flex flex-col gap-4" aria-label="Era esperado">
        <ResumoDaSaida a={a} hoje={hoje} />
        <Escolhas
          nome={`${p}-motivo`}
          rotulo="Por que era esperado"
          valor={motivo}
          aoMudar={setMotivo}
          opcoes={[
            { valor: 'sempre', titulo: 'Acontece sempre neste dia e hora', ajuda: 'O padrão passa a contar com isso e deixa de apontar.' },
            { valor: 'vez', titulo: 'Foi só desta vez', ajuda: 'Feriado, evento, falta de luz. Esta hora fica de fora da conta do padrão.' },
          ]}
        />
        <Campo rotulo="Anotação (opcional)" htmlFor={`${p}-nota`}>
          <textarea
            id={`${p}-nota`}
            className="entrada"
            rows={2}
            maxLength={MAX_TEXTO}
            placeholder="Jogo na TV: reforcei o balcão."
            value={nota}
            onChange={(ev) => setNota(ev.target.value)}
          />
        </Campo>
        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}

export type Depois = 'criar' | 'ajustar' | 'nada';

export function GavetaDeCorrecao({
  lojaId,
  a,
  hoje,
  ajustesDoCriterio,
  aoResponder,
  aoFechar,
}: {
  lojaId: string;
  a: SaidaDoPadrao;
  hoje: string;
  /** Os ajustes de hoje do critério que pode ser ajustado, numa linha (quem sabe é a página, que tem os critérios). */
  ajustesDoCriterio?: string;
  /** `depois` diz o que abrir quando a gaveta fechar: o critério proposto, o que já existe, ou nada. */
  aoResponder: (padroes: Padroes, depois: Depois) => void;
  aoFechar: () => void;
}) {
  const p = useId();
  // cada saída do padrão oferece o que faz sentido para ela
  const [depois, setDepois] = useState<Depois>(a.criterio ? 'criar' : a.ajustar ? 'ajustar' : 'nada');
  const [houve, setHouve] = useState('');
  const [feito, setFeito] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!houve.trim() || !feito.trim()) {
      setErro('Conte o que aconteceu e o que foi feito.');
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const novo = await especialistaApi.responder(lojaId, { anomaliaId: a.id, estado: 'problema', oQueHouve: houve.trim(), oQueFoiFeito: feito.trim(), depois });
      aoResponder(novo, depois);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui registrar a correção');
      setSalvando(false);
    }
  }

  const c = a.criterio;
  return (
    <Gaveta
      titulo="Registrar correção"
      descricao="O que houve, o que foi feito e como não repetir."
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando}>
            {salvando ? 'Registrando…' : 'Registrar correção'}
          </Botao>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={enviar} className="flex flex-col gap-4" aria-label="Registrar correção" noValidate>
        <ResumoDaSaida a={a} hoje={hoje} />
        <Campo rotulo="O que aconteceu" htmlFor={`${p}-houve`}>
          <textarea
            id={`${p}-houve`}
            className="entrada"
            rows={2}
            maxLength={MAX_TEXTO}
            required
            placeholder="Ex.: um atendente faltou e o balcão ficou com uma pessoa só."
            value={houve}
            onChange={(ev) => setHouve(ev.target.value)}
          />
        </Campo>
        <Campo rotulo="O que foi feito" htmlFor={`${p}-feito`}>
          <textarea
            id={`${p}-feito`}
            className="entrada"
            rows={2}
            maxLength={MAX_TEXTO}
            required
            placeholder="Ex.: remanejei uma pessoa do salão das 20h às 22h."
            value={feito}
            onChange={(ev) => setFeito(ev.target.value)}
          />
        </Campo>
        <Escolhas
          nome={`${p}-depois`}
          rotulo="Para não repetir"
          valor={depois}
          aoMudar={setDepois}
          opcoes={[
            ...(c ? [{ valor: 'criar' as const, titulo: 'Criar um critério que avisa quando repetir', ajuda: 'Nasce desligado: você revisa e liga.' }] : []),
            ...(a.ajustar ? [{ valor: 'ajustar' as const, titulo: 'Ajustar um critério que já existe', ajuda: 'Abre o critério para você mudar o limite ou o silêncio.' }] : []),
            { valor: 'nada' as const, titulo: 'Só registrar', ajuda: 'Fica no histórico desta saída do padrão.' },
          ]}
        />
        {depois === 'criar' && c && (
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-farol-borda-forte p-3 text-[13px]" data-previa-do-criterio>
            <span className="text-farol-suave">Critério que vai ser proposto</span>
            <b className="text-sm font-semibold">{c.nome}</b>
            <div className="flex flex-wrap gap-1.5">
              <Chip tom="ok">{c.regra}</Chip>
              <Chip>contagem</Chip>
              <Chip tom="vazado" icone={Cctv}>
                {c.lugar}
              </Chip>
              <Chip tom="vazado" icone={Clock}>
                das {c.janela[0]} às {c.janela[1]}
              </Chip>
            </div>
            <span className="text-farol-suave">{c.texto} Julgado na loja, sem custo por análise.</span>
          </div>
        )}
        {depois === 'ajustar' && a.ajustar && (
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-farol-borda-forte p-3 text-[13px]" data-previa-do-criterio>
            <span className="text-farol-suave">Depois de registrar, abre para você ajustar</span>
            <b className="text-sm font-semibold">{a.ajustar.nome}</b>
            {ajustesDoCriterio && <span className="text-farol-suave">{ajustesDoCriterio}</span>}
          </div>
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
