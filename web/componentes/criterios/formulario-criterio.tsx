'use client';

// =====================================================================
// O formulário do critério — criar e editar
// =====================================================================
// O critério é cadastrado UMA vez e a árvore diz em quais canais ele vale.
// Editar aqui muda em todos: é o motivo de o cadastro ser um só.
// =====================================================================

import { useId, useState } from 'react';

import { ErroDaApi, regrasApi, type Regra, type Setor } from '@/lib/api';

import { ArvoreDeCanais } from './arvore-de-canais';
import { contarCanais } from './canais';
import {
  campo,
  nomeDaSeveridade,
  PRIORIDADES,
  rotulo,
  SEVERIDADES,
  TIPOS,
  TIPOS_DO_DETECTOR,
} from './opcoes';

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
  aoCancelar: () => void;
};

export function FormularioCriterio({
  lojaId,
  setores,
  regra,
  marcadasDeInicio,
  objetosDoDetector,
  aoSalvar,
  aoCancelar,
}: Props) {
  const editando = regra !== undefined;
  const prefixo = useId();

  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(marcadasDeInicio));
  const [dados, setDados] = useState<Record<string, unknown>>(() => ({
    nome: regra?.nome ?? '',
    tipo: regra?.tipo ?? 'estado',
    criterio: regra?.criterio ?? '',
    prioridade: regra?.prioridade ?? 'intermediaria',
    severidade: regra?.severidade ?? 'atencao',
    confiancaMinima: regra ? Number(regra.confianca_minima) : 0.7,
    cooldownMin: regra?.cooldown_min ?? 15,
  }));
  // O que o detector procura. Só vale para presença e contagem; guardado
  // sempre, para não se perder se a pessoa trocar o tipo e voltar.
  const [objeto, setObjeto] = useState(regra?.parametros?.objeto ?? 'pessoa');
  const [deveHaver, setDeveHaver] = useState(regra?.parametros?.maximo !== 0);
  const [minimo, setMinimo] = useState(String(regra?.parametros?.minimo ?? 0));
  const [maximo, setMaximo] = useState(
    regra?.parametros?.maximo == null ? '' : String(regra.parametros.maximo),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const tipo = TIPOS.find((t) => t.v === dados.tipo);
  const peloDetector = TIPOS_DO_DETECTOR.includes(String(dados.tipo));

  /** Os campos do detector, do jeito que a API espera. */
  function parametros(): Record<string, unknown> | undefined {
    if (!peloDetector) return undefined;
    if (dados.tipo === 'presenca') {
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

  function muda(k: string, v: unknown) {
    setDados((d) => ({ ...d, [k]: v }));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const zonaIds = [...marcadas];
      const corpo = { ...dados, zonaIds, parametros: parametros() };
      if (regra) {
        const r = await regrasApi.editar(regra.id, corpo);
        await aoSalvar(
          r.desligada
            ? 'Critério salvo. Sem canal marcado, ele foi desligado e fica em "Sem canal".'
            : `Critério salvo — vale em ${r.canais} ${r.canais === 1 ? 'canal' : 'canais'}.`,
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
    <form
      onSubmit={enviar}
      className="mt-6 rounded-xl border border-farol-facho/40 bg-farol-painel p-4"
      aria-label={editando ? `Editar o critério ${regra.nome}` : 'Novo critério'}
    >
      <h2 className="text-base font-semibold">
        {editando ? `Editar “${regra.nome}”` : 'Novo critério'}
      </h2>
      {editando && canaisAntes > 1 && (
        <p className="mt-1 text-sm text-farol-atencao">
          Este critério vale em {canaisAntes} canais. O que você mudar aqui muda em todos.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <span className={rotulo}>Onde vale</span>
          <p className="mb-1 mt-0.5 text-xs text-farol-suave">
            Marque o setor para valer em todos os canais dele, ou abra o setor e marque
            só os canais que quiser.
          </p>
          <ArvoreDeCanais
            setores={setores}
            marcadas={marcadas}
            aoMudar={setMarcadas}
            prefixo={prefixo}
          />
          {editando && canais === 0 && (
            <p role="alert" className="mt-1 text-xs text-farol-atencao">
              Sem nenhum canal, este critério deixa de ser verificado em qualquer lugar e é
              desligado. Ele fica guardado em “Sem canal”.
            </p>
          )}
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-nome`}>
            Nome do critério
          </label>
          <input
            id={`${prefixo}-nome`}
            required
            className={`mt-1 ${campo}`}
            placeholder="Bancada limpa entre pedidos"
            value={String(dados.nome)}
            onChange={(e) => muda('nome', e.target.value)}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-tipo`}>
            Tipo
          </label>
          <select
            id={`${prefixo}-tipo`}
            className={`mt-1 ${campo}`}
            value={String(dados.tipo)}
            onChange={(e) => muda('tipo', e.target.value)}
          >
            {TIPOS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.r}
              </option>
            ))}
          </select>
          {tipo && <p className="mt-1 text-xs text-farol-suave">{tipo.ajuda}</p>}
        </div>

        {peloDetector && (
          <fieldset className="rounded-lg border border-farol-borda p-3 sm:col-span-2">
            <legend className="px-1 text-xs font-medium text-farol-suave">
              O que o detector procura
            </legend>
            <p className="mb-3 text-xs text-farol-suave">
              Este tipo é julgado <strong className="text-farol-tinta">dentro da loja</strong>,
              sem internet e sem custo por análise. Quem decide são os campos abaixo — o
              texto do critério é para a pessoa ler no alerta.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {dados.tipo === 'presenca' && (
                <div>
                  <label className={rotulo} htmlFor={`${prefixo}-deve`}>
                    Regra
                  </label>
                  <select
                    id={`${prefixo}-deve`}
                    className={`mt-1 ${campo}`}
                    value={deveHaver ? 'sim' : 'nao'}
                    onChange={(e) => setDeveHaver(e.target.value === 'sim')}
                  >
                    <option value="sim">deve haver</option>
                    <option value="nao">não deve haver</option>
                  </select>
                </div>
              )}

              <div>
                <label className={rotulo} htmlFor={`${prefixo}-objeto`}>
                  O que procurar
                </label>
                <select
                  id={`${prefixo}-objeto`}
                  className={`mt-1 ${campo}`}
                  value={objeto}
                  onChange={(e) => setObjeto(e.target.value)}
                >
                  {objetosDoDetector.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              {dados.tipo === 'contagem' && (
                <>
                  <div>
                    <label className={rotulo} htmlFor={`${prefixo}-minimo`}>
                      Pelo menos
                    </label>
                    <input
                      id={`${prefixo}-minimo`}
                      type="number"
                      min={0}
                      step={1}
                      className={`mt-1 ${campo}`}
                      value={minimo}
                      onChange={(e) => setMinimo(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={rotulo} htmlFor={`${prefixo}-maximo`}>
                      No máximo
                    </label>
                    <input
                      id={`${prefixo}-maximo`}
                      type="number"
                      min={0}
                      step={1}
                      placeholder="sem limite"
                      className={`mt-1 ${campo}`}
                      value={maximo}
                      onChange={(e) => setMaximo(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
            <p className="mt-3 text-xs text-farol-suave">
              O detector conhece só os objetos desta lista. Na dúvida ele responde “não
              avaliável” em vez de alertar: um casaco pendurado não vira pessoa.
            </p>
          </fieldset>
        )}

        <div className="sm:col-span-2">
          <label className={rotulo} htmlFor={`${prefixo}-criterio`}>
            O que é “conforme”
          </label>
          <textarea
            id={`${prefixo}-criterio`}
            required
            rows={3}
            className={`mt-1 ${campo}`}
            placeholder="A superfície de trabalho está livre de restos de alimento, embalagens descartadas e utensílios sujos."
            value={String(dados.criterio)}
            onChange={(e) => muda('criterio', e.target.value)}
          />
          {/* Dois casos, e a dica não pode mentir em nenhum. Nos tipos de
              texto, o critério VAI para o modelo como pergunta — vale dizer,
              senão alguém escreve um rótulo e espera que funcione. Em
              presença e contagem ele não vai a modelo nenhum: quem decide
              são os campos do detector. */}
          {peloDetector ? (
            <p className="mt-1 text-xs text-farol-suave">
              Aqui o texto não é enviado a modelo nenhum: ele descreve a regra para quem
              ler o alerta. O que decide são os campos de “O que o detector procura”.
            </p>
          ) : (
            <p className="mt-1 text-xs text-farol-suave">
              Este texto vai direto ao modelo como pergunta. Descreva o que se vê, não o
              rótulo — “a superfície tem restos no canto” funciona melhor que “sujeira”.
            </p>
          )}
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-prioridade`}>
            Prioridade
          </label>
          <select
            id={`${prefixo}-prioridade`}
            className={`mt-1 ${campo}`}
            value={String(dados.prioridade)}
            onChange={(e) => muda('prioridade', e.target.value)}
          >
            {PRIORIDADES.map((p) => (
              <option key={p.v} value={p.v}>
                {p.r}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-severidade`}>
            Severidade
          </label>
          <select
            id={`${prefixo}-severidade`}
            className={`mt-1 ${campo}`}
            value={String(dados.severidade)}
            onChange={(e) => muda('severidade', e.target.value)}
          >
            {SEVERIDADES.map((s) => (
              <option key={s} value={s}>
                {nomeDaSeveridade(s)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-confianca`}>
            Confiança mínima para alertar
          </label>
          <input
            id={`${prefixo}-confianca`}
            type="number"
            min={0}
            max={1}
            step={0.05}
            className={`mt-1 ${campo}`}
            value={Number(dados.confiancaMinima)}
            onChange={(e) => muda('confiancaMinima', Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-farol-suave">
            Abaixo disso o resultado é registrado, mas não vira alerta.
          </p>
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-cooldown`}>
            Silêncio entre alertas (min)
          </label>
          <input
            id={`${prefixo}-cooldown`}
            type="number"
            min={0}
            className={`mt-1 ${campo}`}
            value={Number(dados.cooldownMin)}
            onChange={(e) => muda('cooldownMin', Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-farol-suave">
            Vale por canal: o alerta de um não cala os outros.
          </p>
        </div>
      </div>

      {erro && (
        <p role="alert" className="mt-4 text-sm text-farol-critico">
          {erro}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={salvando || (!editando && canais === 0)}
          className="rounded-lg bg-farol-facho px-4 py-2 text-sm font-semibold text-farol-fundo transition hover:brightness-110 disabled:opacity-60"
        >
          {salvando ? 'Salvando…' : editando ? 'Salvar critério' : 'Criar critério'}
        </button>
        <button
          type="button"
          onClick={aoCancelar}
          className="rounded-lg border border-farol-borda px-4 py-2 text-sm transition hover:border-farol-facho/50"
        >
          Cancelar
        </button>
        {!editando && (
          <p className="text-xs text-farol-suave">
            {canais === 0 ? (
              'Marque ao menos um canal.'
            ) : (
              <>
                O critério nasce <strong className="text-farol-tinta">desligado</strong>. Ligue
                só depois de conferir que ele acerta.
              </>
            )}
          </p>
        )}
      </div>
    </form>
  );
}
