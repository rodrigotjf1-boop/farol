'use client';

// =====================================================================
// O formulário do critério — criar e editar, numa gaveta
// =====================================================================
// O critério é cadastrado UMA vez e a árvore diz em quais canais ele vale.
// Editar aqui muda em todos: é o motivo de o cadastro ser um só.
// =====================================================================

import { TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { Campo, Escolhas, GRADE, Grupo, ROTULO } from '@/componentes/ui/campo';
import { Alerta } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { ErroDaApi, regrasApi, type Regra, type Setor } from '@/lib/api';

import { ArvoreDeCanais } from './arvore-de-canais';
import { contarCanais } from './canais';
import { nomeDaSeveridade, PRIORIDADES, SEVERIDADES, TIPOS, TIPOS_DO_DETECTOR } from './opcoes';

type Props = {
  lojaId: string;
  setores: Setor[];
  /** O critério em edição. Ausente = criando um novo. */
  regra?: Regra;
  /** Áreas que já vêm marcadas ao abrir — o canal onde se clicou "+ critério". */
  marcadasDeInicio: string[];
  /** O que o detector local sabe procurar. Vem da API, junto com os critérios. */
  objetosDoDetector: string[];
  aoSalvar: (mensagem: string) => Promise<void>;
  aoFechar: () => void;
};

export function GavetaDoCriterio({
  lojaId,
  setores,
  regra,
  marcadasDeInicio,
  objetosDoDetector,
  aoSalvar,
  aoFechar,
}: Props) {
  const editando = regra !== undefined;
  const p = useId();
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(marcadasDeInicio));
  const [nome, setNome] = useState(regra?.nome ?? '');
  const [tipo, setTipo] = useState<Regra['tipo']>(regra?.tipo ?? 'estado');
  const [criterio, setCriterio] = useState(regra?.criterio ?? '');
  const [prioridade, setPrioridade] = useState<string>(regra?.prioridade ?? 'intermediaria');
  const [severidade, setSeveridade] = useState<string>(regra?.severidade ?? 'atencao');
  const [confiancaMinima, setConfiancaMinima] = useState(regra ? Number(regra.confianca_minima) : 0.7);
  const [cooldownMin, setCooldownMin] = useState(regra?.cooldown_min ?? 15);

  // O que o detector procura. Só vale nos tipos julgados na loja.
  const [objeto, setObjeto] = useState(regra?.parametros?.objeto ?? 'pessoa');
  const [deveHaver, setDeveHaver] = useState(regra?.parametros?.maximo !== 0);
  const [minimo, setMinimo] = useState(String(regra?.parametros?.minimo ?? 0));
  const [maximo, setMaximo] = useState(regra?.parametros?.maximo == null ? '' : String(regra.parametros.maximo));

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const peloDetector = TIPOS_DO_DETECTOR.includes(tipo);

  /** Os parâmetros que sobem, ou `undefined` quando o tipo não usa detector. */
  function parametros(): Record<string, unknown> | undefined {
    if (!peloDetector) return undefined;
    if (tipo === 'presenca') {
      // "Deve haver" é pelo menos um; "não deve haver" é no máximo zero.
      return deveHaver ? { objeto, minimo: 1, maximo: null } : { objeto, minimo: 0, maximo: 0 };
    }
    return {
      objeto,
      minimo: minimo === '' ? 0 : Number(minimo),
      maximo: maximo === '' ? null : Number(maximo),
    };
  }

  const canais = contarCanais(setores, marcadas);
  const canaisAntes = regra ? new Set(regra.alvos.map((a) => a.ponto_id)).size : 0;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const corpo = {
        nome,
        tipo,
        criterio,
        prioridade,
        severidade,
        confiancaMinima,
        cooldownMin,
        zonaIds: [...marcadas],
        parametros: parametros(),
      };
      if (regra) {
        const r = await regrasApi.editar(regra.id, corpo);
        await aoSalvar(
          r.desligada
            ? 'Critério salvo. Sem canal marcado, ele foi desligado e fica em “Sem canal”.'
            : `Critério salvo. Vale em ${r.canais} ${r.canais === 1 ? 'canal' : 'canais'}.`,
        );
      } else {
        const r = await regrasApi.criar(lojaId, corpo);
        await aoSalvar(
          `Critério criado em ${r.canais} ${r.canais === 1 ? 'canal' : 'canais'}. ` +
            'Ele nasce desligado: ligue depois de conferir que acerta.',
        );
      }
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={editando ? `Editar o critério “${regra.nome}”` : 'Novo critério'}
      descricao={
        editando
          ? canaisAntes > 1
            ? `Este critério vale em ${canaisAntes} canais. O que você mudar aqui muda em todos.`
            : 'O que você mudar aqui muda em todos os canais em que ele vale.'
          : 'Cadastrado uma vez, vale nos canais que você marcar.'
      }
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao
            type="submit"
            form={`${p}-form`}
            variante="primario"
            ocupado={salvando}
            disabled={!editando && canais === 0}
          >
            {salvando ? 'Salvando…' : editando ? 'Salvar critério' : 'Criar critério'}
          </Botao>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          {!editando && (
            <p className="flex-[1_1_180px] text-[12.5px] text-farol-suave">
              {canais === 0 ? (
                'Marque ao menos um canal.'
              ) : (
                <>
                  O critério nasce <strong className="font-semibold text-farol-tinta">desligado</strong>. Ligue depois
                  de conferir que ele acerta.
                </>
              )}
            </p>
          )}
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={enviar} className="flex flex-col gap-4" aria-label={editando ? `Editar o critério ${regra.nome}` : 'Novo critério'}>
        <Campo rotulo="Nome do critério" htmlFor={`${p}-nome`}>
          <input
            id={`${p}-nome`}
            required
            autoFocus
            className="entrada"
            placeholder="Bancada limpa entre pedidos"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </Campo>

        <Escolhas nome={`${p}-tipo`} rotulo="O que conferir" opcoes={TIPOS} valor={tipo} aoMudar={setTipo} />

        {/* Presença e contagem são julgadas dentro da loja, pelo detector.
            Ele não lê o texto: trabalha com o objeto e a quantidade. Sem
            estes campos o critério fica cadastrado e não é verificado. */}
        {peloDetector && (
          <Grupo titulo="O que o detector procura">
            <p className="text-[12.5px] text-farol-suave">
              Este tipo é julgado <strong className="font-semibold text-farol-tinta">dentro da loja</strong>, sem
              internet e sem custo por análise. Quem decide são os campos abaixo.
            </p>
            <div className={GRADE}>
              {tipo === 'presenca' && (
                <Campo rotulo="Regra" htmlFor={`${p}-deve`}>
                  <select
                    id={`${p}-deve`}
                    className="entrada"
                    value={deveHaver ? 'sim' : 'nao'}
                    onChange={(e) => setDeveHaver(e.target.value === 'sim')}
                  >
                    <option value="sim">deve haver</option>
                    <option value="nao">não deve haver</option>
                  </select>
                </Campo>
              )}
              <Campo rotulo="O que procurar" htmlFor={`${p}-objeto`}>
                <select id={`${p}-objeto`} className="entrada" value={objeto} onChange={(e) => setObjeto(e.target.value)}>
                  {objetosDoDetector.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Campo>
              {tipo === 'contagem' && (
                <>
                  <Campo rotulo="Pelo menos" htmlFor={`${p}-minimo`}>
                    <input
                      id={`${p}-minimo`}
                      type="number"
                      min={0}
                      step={1}
                      className="entrada font-mono"
                      value={minimo}
                      onChange={(e) => setMinimo(e.target.value)}
                    />
                  </Campo>
                  <Campo rotulo="No máximo" htmlFor={`${p}-maximo`}>
                    <input
                      id={`${p}-maximo`}
                      type="number"
                      min={0}
                      step={1}
                      placeholder="sem limite"
                      className="entrada font-mono"
                      value={maximo}
                      onChange={(e) => setMaximo(e.target.value)}
                    />
                  </Campo>
                </>
              )}
            </div>
            <p className="text-[12.5px] text-farol-suave">
              O detector conhece só os objetos desta lista. Na dúvida ele responde “não deu para avaliar” em vez de
              avisar: um casaco pendurado não vira pessoa.
            </p>
          </Grupo>
        )}

        <Campo
          rotulo="O que é “conforme”"
          htmlFor={`${p}-criterio`}
          // Dois casos, e a dica não pode mentir em nenhum. Nos tipos de
          // texto, o critério VAI para o modelo como pergunta — vale dizer,
          // senão alguém escreve um rótulo e espera que funcione. Em
          // presença e contagem ele não vai a modelo nenhum.
          ajuda={
            peloDetector
              ? 'Aqui o texto não é enviado a modelo nenhum: ele descreve a regra para quem ler o aviso. Quem decide são os campos de “O que o detector procura”.'
              : 'Este texto vai direto ao modelo como pergunta. Descreva o que se vê, não o rótulo: “a superfície tem restos no canto” funciona melhor que “sujeira”.'
          }
        >
          <textarea
            id={`${p}-criterio`}
            required
            rows={3}
            className="entrada min-h-[84px] resize-y leading-normal"
            placeholder="A superfície de trabalho está livre de restos de alimento, embalagens descartadas e utensílios sujos."
            value={criterio}
            onChange={(e) => setCriterio(e.target.value)}
          />
        </Campo>

        <div className="flex min-w-0 flex-col gap-[5px]">
          <span className={ROTULO}>Onde vale</span>
          <p className="text-xs text-farol-suave">
            Marque o setor para valer em todos os canais dele, ou abra o setor e marque só os canais que quiser.
          </p>
          <ArvoreDeCanais setores={setores} marcadas={marcadas} aoMudar={setMarcadas} prefixo={p} />
          {editando && canais === 0 && (
            <Alerta tom="atencao" icone={TriangleAlert} papel="alert">
              Sem nenhum canal, este critério deixa de ser verificado em qualquer lugar e é desligado. Ele fica
              guardado em “Sem canal”.
            </Alerta>
          )}
        </div>

        <Grupo titulo="Quando avisar">
          <div className={GRADE}>
            <Campo rotulo="Prioridade" htmlFor={`${p}-prioridade`}>
              <select
                id={`${p}-prioridade`}
                className="entrada"
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value)}
              >
                {PRIORIDADES.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.r}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Gravidade" htmlFor={`${p}-severidade`}>
              <select
                id={`${p}-severidade`}
                className="entrada"
                value={severidade}
                onChange={(e) => setSeveridade(e.target.value)}
              >
                {SEVERIDADES.map((s) => (
                  <option key={s} value={s}>
                    {nomeDaSeveridade(s)}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              rotulo="Confiança mínima"
              htmlFor={`${p}-confianca`}
              ajuda="Abaixo disso o resultado é registrado, mas não vira aviso."
            >
              <input
                id={`${p}-confianca`}
                type="number"
                min={0}
                max={1}
                step={0.05}
                className="entrada font-mono"
                value={confiancaMinima}
                onChange={(e) => setConfiancaMinima(Number(e.target.value))}
              />
            </Campo>
            <Campo
              rotulo="Silêncio entre avisos, em minutos"
              htmlFor={`${p}-cooldown`}
              ajuda="Vale por canal: o aviso de um não cala os outros."
            >
              <input
                id={`${p}-cooldown`}
                type="number"
                min={0}
                className="entrada font-mono"
                value={cooldownMin}
                onChange={(e) => setCooldownMin(Number(e.target.value))}
              />
            </Campo>
          </div>
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
