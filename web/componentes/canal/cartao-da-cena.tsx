'use client';

// =====================================================================
// A cena deste canal
// =====================================================================
// O que esta câmera vê e de onde olha, escrito por quem configura o canal,
// com detalhes (decisão do dono, 09/10/2026: o sistema não propõe a partir
// da imagem). Junto, o tipo de negócio — que vale para a loja inteira.
//
// O que o Farol faz com este texto é lógica interna e não aparece aqui. O
// que aparece é RESULTADO: quando a cena em branco está deixando critério
// sem análise, o aviso diz — e só nesse caso (`cena_em_falta` vem do
// servidor).
// =====================================================================

import { TriangleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { Campo } from '@/componentes/ui/campo';
import { Alerta, CARTAO, Chip, Titulo } from '@/componentes/ui/pecas';
import { consoleApi, ErroDaApi, type PontoCompleto } from '@/lib/api';

/** Os mesmos tetos do servidor (`api/src/cena.ts`). */
const MAX_CENA = 2000;
const MAX_TIPO_DE_NEGOCIO = 80;

const umaLinha = (texto: string): string => texto.split(/\s+/).filter(Boolean).join(' ');

function diaEMes(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function CartaoDaCena({
  ponto,
  configura,
  aoSalvar,
  className = '',
}: {
  ponto: PontoCompleto;
  configura: boolean;
  /** Depois de gravar: a tela recarrega o canal e confirma com esta frase. */
  aoSalvar: (mensagem: string) => Promise<void>;
  className?: string;
}) {
  const p = useId();
  const campoDaCena = useRef<HTMLTextAreaElement>(null);
  const [cena, setCena] = useState(ponto.cena ?? '');
  const [negocio, setNegocio] = useState(ponto.loja_tipo_negocio ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const guardada = (ponto.cena ?? '').trim();
  const descrita = guardada !== '';
  const texto = cena.replace(/\r\n?/g, '\n').trim();
  const tipo = umaLinha(negocio);
  const mudouACena = texto !== guardada;
  const mudouONegocio = tipo !== (ponto.loja_tipo_negocio ?? '');

  async function salvar() {
    setErro(null);
    // Apagar a cena de um canal que já a tem não se faz por descuido: o
    // campo vazio é recusado aqui, com o motivo, e nada é gravado.
    if (descrita && texto === '') {
      setErro('A cena não pode ficar em branco: escreva o que esta câmera vê e de onde ela olha.');
      campoDaCena.current?.focus();
      return;
    }
    if (!mudouACena && !mudouONegocio) {
      if (!descrita) {
        setErro('Escreva o que esta câmera vê e de onde ela olha.');
        campoDaCena.current?.focus();
        return;
      }
      await aoSalvar('Nada mudou: a cena está como estava.');
      return;
    }
    setSalvando(true);
    try {
      // O tipo de negócio é da loja; a cena, do canal. Cada um só é gravado
      // se mudou: salvar sem mexer não faz o agente puxar a configuração.
      if (mudouONegocio) await consoleApi.salvarTipoDeNegocio(ponto.loja_id, tipo);
      if (mudouACena) await consoleApi.salvarCena(ponto.id, texto);
      const oQue = mudouACena ? (mudouONegocio ? 'Cena e tipo de negócio salvos.' : 'Cena salva.') : 'Tipo de negócio salvo.';
      await aoSalvar(
        `${oQue} O agente da loja recebe na próxima batida.` +
          (!mudouACena && !descrita ? ' A cena deste canal continua em branco.' : ''),
      );
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section aria-labelledby={`${p}-titulo`} className={`${CARTAO} flex flex-col ${className}`} data-cartao-da-cena>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-farol-borda px-4 py-3.5">
        <Titulo id={`${p}-titulo`}>A cena deste canal</Titulo>
        {descrita ? (
          <Chip tom="ok">
            descrita{ponto.cena_escrita_por_nome ? ` por ${ponto.cena_escrita_por_nome}` : ''}
            {ponto.cena_escrita_em ? ` em ${diaEMes(ponto.cena_escrita_em)}` : ''}
          </Chip>
        ) : (
          <Chip tom={ponto.cena_em_falta ? 'critico' : 'atencao'}>em branco</Chip>
        )}
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        {ponto.cena_em_falta && (
          <Alerta tom="critico" icone={TriangleAlert} papel="status">
            <b className="font-semibold">Falta descrever a cena.</b> Sem ela, os critérios deste canal que dependem de
            entender a imagem não são analisados: aparecem como “falta descrever a cena”, e não como análise feita.
          </Alerta>
        )}

        <Campo rotulo="Tipo de negócio — vale para a loja inteira" htmlFor={`${p}-negocio`}>
          <input
            id={`${p}-negocio`}
            className="entrada"
            value={negocio}
            maxLength={MAX_TIPO_DE_NEGOCIO}
            disabled={!configura}
            placeholder="hamburgueria"
            onChange={(e) => setNegocio(e.target.value)}
          />
        </Campo>

        <Campo rotulo="O que esta câmera vê, e de onde olha" htmlFor={`${p}-cena`}>
          <textarea
            ref={campoDaCena}
            id={`${p}-cena`}
            rows={6}
            maxLength={MAX_CENA}
            disabled={!configura}
            aria-describedby={`${p}-ajuda`}
            className="entrada min-h-[132px] resize-y leading-normal"
            placeholder="Bancada de montagem de lanches, vista de cima por uma câmera no teto. No alto ficam as cubas; no meio, a área onde os lanches são montados…"
            value={cena}
            onChange={(e) => setCena(e.target.value)}
          />
          <div
            id={`${p}-ajuda`}
            className="flex flex-col gap-1.5 rounded-r-md border-l-2 border-farol-borda-forte bg-farol-painel-2 px-3 py-2.5 text-[13px] text-farol-suave"
          >
            {/* A frase não promete uso: o que o Farol faz com o texto é lógica
                interna, e muda de loja para loja. Ela diz para que o texto serve. */}
            <p>
              <b className="font-semibold text-farol-tinta">Escreva com detalhes.</b> Este texto diz ao Farol o que a
              câmera está vendo. Vale dizer:
            </p>
            <ul className="flex list-disc flex-col gap-0.5 pl-[18px]">
              <li>que posto é este e o que se faz nele;</li>
              <li>de onde a câmera olha — do teto, de lado, de frente;</li>
              <li>o que aparece sempre, e em que parte da imagem — bancada, cubas, equipamentos, impressora;</li>
              <li>o que engana na imagem — brilho do inox, reflexo, vapor.</li>
            </ul>
            {configura && (
              <p className="font-mono text-[12px]">
                {texto.length} de {MAX_CENA} caracteres
              </p>
            )}
          </div>
        </Campo>

        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}

        {configura && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Botao variante="primario" onClick={salvar} ocupado={salvando}>
              {salvando ? 'Salvando…' : 'Salvar a cena'}
            </Botao>
          </div>
        )}
      </div>
    </section>
  );
}
