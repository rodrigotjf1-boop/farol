'use client';

// =====================================================================
// Sugestões para as fichas: onde a ficha parece diferente da bancada
// =====================================================================
// A21, fatia T6. Do protótipo aprovado pelo dono em 15/10/2026 (tela
// Treinamento, aba "Sugestões para as fichas"):
//
//   • as sugestões nascem SÓ do que alguém conferiu (a API calcula);
//   • o Farol não muda a ficha: diz onde mudar, pela origem das fichas
//     (Regem, planilha ou o sistema que envia);
//   • quem configura responde — cada sugestão diz o que o "sim" e o "não"
//     querem dizer; os outros perfis veem, e a frase diz quem responde.
//
// Do protótipo ficou de fora a frase "quando a ficha chegar com a mudança,
// o Farol leva junto as fotos e os exemplos do nome antigo": isso ainda não
// existe (o órfão continua sendo juntado à mão, em Fichas).
// =====================================================================

import { Lightbulb } from 'lucide-react';
import { useState } from 'react';

import { diaFaladoNaLoja, frase } from '@/componentes/formatos';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';
import { CARTAO, Chip, Vazio } from '@/componentes/ui/pecas';
import { ErroDaApi, treinoApi, type SugestaoParaAFicha, type TreinoDaLoja } from '@/lib/api';

/** Onde mudar, pela origem das fichas (o protótipo: `ondeMudar`). */
export function ondeMudar(onde: string, fichasDe: TreinoDaLoja['fichasDe']): string {
  if (fichasDe === 'planilha') return `Na planilha, ${onde}, e importe de novo.`;
  if (fichasDe === 'sistema') return `No sistema que envia as fichas, ${onde}.`;
  if (fichasDe === 'regem') return `No Regem, em Estoque › Fichas técnicas, ${onde}.`;
  return frase(onde);
}

export function PainelDasSugestoes({
  lojaId,
  fuso,
  sugestoes,
  fichasDe,
  podeConfigurar,
  aoResponder,
}: {
  lojaId: string;
  fuso: string;
  sugestoes: SugestaoParaAFicha[];
  fichasDe: TreinoDaLoja['fichasDe'];
  podeConfigurar: boolean;
  /** Depois de responder: a tela recarrega. */
  aoResponder: () => Promise<void>;
}) {
  const avisar = useAvisar();
  const [respondendo, setRespondendo] = useState<string | null>(null);
  const abertas = sugestoes.filter((s) => s.decisao === null);
  const feitas = sugestoes.filter((s) => s.decisao !== null);

  async function responder(s: SugestaoParaAFicha, decisao: 'sim' | 'nao') {
    setRespondendo(`${s.chave}|${decisao}`);
    try {
      await treinoApi.responderSugestao(lojaId, s.chave, decisao);
      avisar(decisao === 'sim' ? `Anotado: “${s.sim}”.` : `Anotado: “${s.nao}”.`);
      await aoResponder();
    } catch (e) {
      avisar(frase(e instanceof ErroDaApi ? e.message : 'não consegui guardar a resposta'));
    } finally {
      setRespondendo(null);
    }
  }

  return (
    <>
      <p className={AJUDA}>
        As sugestões nascem só do que alguém conferiu, nunca de uma leitura sem conferência. O Farol não muda a ficha: quem muda é você, onde ela é
        cadastrada.
      </p>
      {sugestoes.length === 0 ? (
        <Vazio icone={Lightbulb} titulo="Nenhuma sugestão por enquanto">
          Elas aparecem quando os lanches conferidos mostram um nome que confunde ou uma ficha diferente do que a bancada faz.
        </Vazio>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-sugestoes>
          {[...abertas, ...feitas].map((s) => (
            <section key={s.chave} className={`${CARTAO} flex min-w-0 flex-col gap-2.5 px-4 py-3.5`} aria-labelledby={`sg-${s.chave}`} data-sugestao={s.chave}>
              <header className="flex flex-wrap items-center gap-1.5">
                <Chip>{s.rotulo}</Chip>
                {s.decisao && (
                  <span className="ml-auto">
                    <Chip tom={s.decisao === 'sim' ? 'atencao' : 'ok'}>{s.decisao === 'sim' ? 'a mudar na ficha' : 'fica como está'}</Chip>
                  </span>
                )}
              </header>
              <h3 id={`sg-${s.chave}`} className="break-words text-[15px] font-semibold leading-snug">
                {s.titulo}
              </h3>
              <p className="text-[13.5px]">
                <b className="font-semibold">O que a bancada mostrou.</b> {s.viu}
              </p>
              <p className="text-[13.5px]">
                <b className="font-semibold">A sugestão.</b> {s.propoe}
              </p>
              <p className={AJUDA}>{ondeMudar(s.onde, fichasDe)}</p>
              {!s.decisao && podeConfigurar && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Botao
                    variante="primario"
                    mini
                    onClick={() => void responder(s, 'sim')}
                    ocupado={respondendo === `${s.chave}|sim`}
                    disabled={respondendo !== null}
                  >
                    {s.sim}
                  </Botao>
                  <Botao mini onClick={() => void responder(s, 'nao')} ocupado={respondendo === `${s.chave}|nao`} disabled={respondendo !== null}>
                    {s.nao}
                  </Botao>
                </div>
              )}
              {!s.decisao && !podeConfigurar && <p className={AJUDA}>Quem configura a loja responde às sugestões.</p>}
              {s.decisao && (
                <p className={AJUDA}>
                  Respondida{s.decididoPor ? ` por ${s.decididoPor}` : ''}
                  {s.decididoEm ? `, ${diaFaladoNaLoja(s.decididoEm, fuso)}` : ''}: “{s.decisao === 'sim' ? s.sim : s.nao}”.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
