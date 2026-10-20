'use client';

// =====================================================================
// O cartão do "nome fora das fichas", com as três respostas
// =====================================================================
// Do protótipo aprovado pelo dono em 19/10/2026 (`mockups/farol-conexoes-e-
// fichas.html`, aba Sugestões). O pedido dele: "depois verificar se associa a
// algo já nas fichas ou ainda vai implementar em uma ficha que não existe".
// Quem configura diz o que o nome escrito à mão é:
//
//   • É um ingrediente das fichas → qual (os parecidos primeiro): o nome
//     vira um OUTRO NOME dele (migration 053) — os exemplos vão para ele, e a
//     conferência passa a entender sozinha;
//   • Vai entrar numa ficha nova → os exemplos ficam guardados com o nome e
//     se juntam ao ingrediente quando a ficha chegar com ele;
//   • Foi engano.
//
// Os outros perfis veem o cartão, e a frase diz quem responde.
// =====================================================================

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { diaFaladoNaLoja } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA, ROTULO } from '@/componentes/ui/campo';
import { CARTAO, Chip } from '@/componentes/ui/pecas';
import type { SugestaoParaAFicha } from '@/lib/api';

import { nasFichas } from './nome-nas-fichas';

export function CartaoDoNomeFora({
  s,
  fuso,
  podeConfigurar,
  ingredientesDasFichas,
  respondendo,
  aoResponder,
}: {
  s: SugestaoParaAFicha;
  fuso: string;
  podeConfigurar: boolean;
  /** Os ingredientes das fichas: a lista de "qual é". */
  ingredientesDasFichas: string[];
  /** A resposta que está indo agora (`chave|decisao`), para o botão mostrar que espera. */
  respondendo: string | null;
  aoResponder: (s: SugestaoParaAFicha, decisao: 'sim' | 'nao', junto?: string) => Promise<void>;
}) {
  const id = useId();
  const [escolhendo, setEscolhendo] = useState(false);
  const [qual, setQual] = useState('');
  const [erro, setErro] = useState(false);
  const lista = useRef<HTMLSelectElement>(null);
  // os parecidos primeiro (a mesma comparação da conferência, só com as fichas)
  const primeiros = useMemo(() => {
    const achado = nasFichas(s.ingrediente, { fichas: ingredientesDasFichas });
    return achado.mesmo ? [achado.mesmo.nome] : achado.parecidos.map((p) => p.nome);
  }, [s.ingrediente, ingredientesDasFichas]);
  const outros = ingredientesDasFichas.filter((n) => !primeiros.includes(n));
  useEffect(() => {
    if (escolhendo) lista.current?.focus();
  }, [escolhendo]);

  async function juntar() {
    if (!qual) {
      setErro(true);
      lista.current?.focus();
      return;
    }
    await aoResponder(s, 'sim', qual);
  }

  const ocupado = respondendo !== null;
  const situacao = s.juntoA ? `é o “${s.juntoA}”` : s.decisao === 'sim' ? 'espera a ficha nova' : s.decisao === 'nao' ? 'foi engano' : null;
  return (
    <section className={`${CARTAO} flex min-w-0 flex-col gap-2.5 px-4 py-3.5`} aria-labelledby={`sg-${s.chave}`} data-sugestao={s.chave}>
      <header className="flex flex-wrap items-center gap-1.5">
        <Chip>{s.rotulo}</Chip>
        {situacao && (
          <span className="ml-auto">
            <Chip tom={s.juntoA ? 'ok' : s.decisao === 'sim' ? 'atencao' : undefined}>{situacao}</Chip>
          </span>
        )}
      </header>
      <h3 id={`sg-${s.chave}`} className="break-words text-[15px] font-semibold leading-snug">
        {s.titulo}
      </h3>
      <p className="text-[13.5px]">
        <b className="font-semibold">O que a bancada mostrou.</b> {s.viu}
      </p>
      {!s.decisao && (
        <p className="text-[13.5px]">
          <b className="font-semibold">A sugestão.</b> {s.propoe}
        </p>
      )}
      {!s.decisao && podeConfigurar && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Botao
            mini
            aria-expanded={escolhendo}
            onClick={() => {
              setEscolhendo((x) => !x);
              setErro(false);
            }}
            disabled={ocupado}
            data-nome-fora="junto"
          >
            É um ingrediente das fichas
          </Botao>
          <Botao mini onClick={() => void aoResponder(s, 'sim')} ocupado={respondendo === `${s.chave}|sim`} disabled={ocupado} data-nome-fora="nova">
            Vai entrar numa ficha nova
          </Botao>
          <Botao variante="fantasma" mini onClick={() => void aoResponder(s, 'nao')} ocupado={respondendo === `${s.chave}|nao`} disabled={ocupado} data-nome-fora="engano">
            Foi engano
          </Botao>
        </div>
      )}
      {!s.decisao && podeConfigurar && escolhendo && (
        <div className="flex min-w-0 flex-col gap-1.5" data-nome-fora-qual>
          <label htmlFor={`${id}-qual`} className={ROTULO}>
            Qual ingrediente das fichas é o “{s.ingrediente}”?
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              id={`${id}-qual`}
              ref={lista}
              className="entrada min-w-0 flex-[1_1_200px]"
              value={qual}
              onChange={(e) => {
                setQual(e.target.value);
                setErro(false);
              }}
              aria-invalid={erro || undefined}
              aria-describedby={erro ? `${id}-erro` : undefined}
            >
              <option value="">Escolha o ingrediente</option>
              {primeiros.length > 0 ? (
                <>
                  <optgroup label="Parecidos">
                    {primeiros.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Os outros">
                    {outros.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                outros.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))
              )}
            </select>
            <Botao variante="primario" mini onClick={() => void juntar()} ocupado={respondendo === `${s.chave}|sim`} disabled={ocupado} data-nome-fora="juntar">
              Juntar
            </Botao>
          </div>
          {erro && (
            <p id={`${id}-erro`} role="alert" className="text-xs text-farol-critico">
              Escolha o ingrediente das fichas.
            </p>
          )}
          <small className={AJUDA}>
            Os exemplos de “{s.ingrediente}” vão para ele, e da próxima vez que alguém escrever “{s.ingrediente}” na conferência, o Farol já entende.
          </small>
        </div>
      )}
      {!s.decisao && !podeConfigurar && <p className={AJUDA}>Quem configura a loja responde às sugestões.</p>}
      {s.decisao && (
        <p className={AJUDA}>
          {s.juntoA
            ? `Os exemplos de “${s.ingrediente}” vão para o “${s.juntoA}”. Quando alguém escrever “${s.ingrediente}” na conferência, entra o “${s.juntoA}”.`
            : s.decisao === 'sim'
              ? `Os exemplos ficam guardados com o nome “${s.ingrediente}”. Quando a ficha chegar com ele — ou com o nome escrito de outro jeito —, eles se juntam sozinhos ao ingrediente dela.`
              : 'Fica como está.'}{' '}
          Respondida{s.decididoPor ? ` por ${s.decididoPor}` : ''}
          {s.decididoEm ? `, ${diaFaladoNaLoja(s.decididoEm, fuso)}` : ''}.
        </p>
      )}
    </section>
  );
}
