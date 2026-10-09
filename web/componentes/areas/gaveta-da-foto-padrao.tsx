'use client';

// =====================================================================
// Guardar o quadro de agora como foto padrão
// =====================================================================
// Não há envio de imagem: a foto padrão é o quadro que o canal já tem, no
// instante em que alguém olhou e disse "é assim que deve ficar". Por isso
// a gaveta diz de QUANDO é o quadro — ele pode ser de horas atrás — e o
// que o detector viu nele.
// =====================================================================

import { Users } from 'lucide-react';
import { useId, useState } from 'react';

import { diaEHora, plural } from '@/componentes/formatos';
import { Botao } from '@/componentes/ui/botao';
import { Campo, ROTULO } from '@/componentes/ui/campo';
import { Alerta } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, padroesApi, type FotoPadrao } from '@/lib/api';

const CONFERIR = [
  'O ambiente está limpo e organizado, como deve ficar',
  'Não há ninguém na frente do que importa',
  'A luz é a de costume neste horário',
];

type Props = {
  pontoId: string;
  /** De quando é o quadro que vai ser guardado. */
  capturadoEm: string | null;
  /** Pessoas que o detector da loja viu nele. Nulo = não medido. */
  pessoas: number | null;
  aoGuardar: (foto: FotoPadrao) => Promise<void>;
  aoFechar: () => void;
};

export function GavetaDaFotoPadrao({ pontoId, capturadoEm, pessoas, aoGuardar, aoFechar }: Props) {
  const p = useId();
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await aoGuardar(await padroesApi.guardar(pontoId, nome.trim()));
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui guardar a foto padrão');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo="Guardar como foto padrão"
      descricao="A imagem de agora passa a ser uma referência deste canal."
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando}>
            {salvando ? 'Guardando…' : 'Guardar foto padrão'}
          </Botao>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={enviar} className="flex flex-col gap-4" aria-label="Guardar como foto padrão">
        {pessoas !== null && pessoas > 0 && (
          <Alerta tom="atencao" icone={Users}>
            <strong className="font-semibold">
              O detector vê {plural(pessoas, 'pessoa', 'pessoas')} na imagem de agora.
            </strong>{' '}
            A foto padrão fica melhor sem ninguém na frente do que importa: se der, espere esvaziar e use “Atualizar quadro”.
          </Alerta>
        )}

        <Campo
          rotulo="Nome desta foto"
          htmlFor={`${p}-nome`}
          ajuda="Guarde uma para cada situação de luz: dia, noite, loja fechada."
        >
          <input
            id={`${p}-nome`}
            required
            autoFocus
            maxLength={60}
            className="entrada"
            placeholder="Noite, loja aberta"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </Campo>

        <div className="flex min-w-0 flex-col gap-2">
          <span className={ROTULO}>Antes de guardar, confira</span>
          <ul className="flex flex-col gap-2">
            {CONFERIR.map((texto, i) => (
              <li key={texto}>
                <label htmlFor={`${p}-c${i}`} className="flex cursor-pointer items-start gap-2.5">
                  <input id={`${p}-c${i}`} type="checkbox" className="mt-0.5 h-[17px] w-[17px] shrink-0 accent-farol-marca" />
                  {texto}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[12.5px] text-farol-suave">
          Vai ser guardada a imagem de <span className="font-mono">{diaEHora(capturadoEm)}</span>, a que está na tela.
          Se a cena mudou desde então, feche e use <strong className="font-semibold text-farol-tinta">Atualizar quadro</strong>{' '}
          antes.
        </p>

        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}
