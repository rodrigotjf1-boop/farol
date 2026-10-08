'use client';

// =====================================================================
// O formulário do critério — criar e editar, numa gaveta
// =====================================================================
// O critério é cadastrado UMA vez e a árvore diz em quais canais ele vale.
// Editar aqui muda em todos: é o motivo de o cadastro ser um só.
// =====================================================================

import { Image as Imagem, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { Campo, Escolhas, GRADE, Grupo, ROTULO } from '@/componentes/ui/campo';
import { Alerta } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { resumoDoHorario } from '@/componentes/horario/semana';
import {
  ErroDaApi,
  regrasApi,
  type FaixaDeHorario,
  type Porteiro,
  type Quando,
  type Regra,
  type Setor,
} from '@/lib/api';

import { ArvoreDeCanais } from './arvore-de-canais';
import { contarCanais } from './canais';
import {
  CONFIRMACOES,
  faixaDeTodosOsDias,
  faixaSimples,
  nomeDaSeveridade,
  porcentoExato,
  porteirosDoTipo,
  PRIORIDADES,
  QUANDOS,
  resumoDaFaixa,
  SEVERIDADES,
  TIPOS,
  TIPOS_DO_DETECTOR,
} from './opcoes';

type Props = {
  lojaId: string;
  setores: Setor[];
  /** O critério em edição. Ausente = criando um novo. */
  regra?: Regra;
  /** Num critério NOVO: as áreas que já vêm marcadas ao abrir — o canal onde se clicou "+ critério".
   *  Na edição não vale: os canais marcados são os do próprio critério. */
  marcadasDeInicio: string[];
  /** Um critério NOVO que já nasce preenchido (sugerido pelo inventário ou pelos padrões). Na edição não vale. */
  inicial?: {
    nome?: string;
    criterio?: string;
    porteiro?: Porteiro;
    comPadrao?: boolean;
    tipo?: Regra['tipo'];
    /** O que o detector procura e quantos são aceitáveis (presença e contagem). */
    objeto?: string;
    minimo?: number;
    maximo?: number | null;
    /** A faixa de horas em que ele é conferido. */
    faixa?: { de: string; ate: string };
  };
  /** Na EDIÇÃO: a opção de "quando vale conferir" que os padrões sugerem. Só entra se a pessoa salvar. */
  porteiroSugerido?: Porteiro;
  /** O que o detector local sabe procurar. Vem da API, junto com os critérios. */
  objetosDoDetector: string[];
  /** Quando a loja abre. É por ele que "no horário" e "fora do horário" valem. */
  horarioDaLoja: FaixaDeHorario[];
  aoSalvar: (mensagem: string) => Promise<void>;
  aoFechar: () => void;
};

export function GavetaDoCriterio({
  lojaId,
  setores,
  regra,
  marcadasDeInicio,
  inicial,
  porteiroSugerido,
  objetosDoDetector,
  horarioDaLoja,
  aoSalvar,
  aoFechar,
}: Props) {
  const editando = regra !== undefined;
  const p = useId();
  // Na edição, os canais são os do critério — nunca o que a tela que abriu a gaveta lembrou de passar: salvar
  // sem mexer em nada tem de deixar o critério onde ele está (sem isto, uma lista vazia o tirava de todos).
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(regra ? regra.alvos.map((a) => a.zona_id) : marcadasDeInicio));
  const [nome, setNome] = useState(regra?.nome ?? inicial?.nome ?? '');
  const [tipo, setTipo] = useState<Regra['tipo']>(regra?.tipo ?? inicial?.tipo ?? 'estado');
  const [criterio, setCriterio] = useState(regra?.criterio ?? inicial?.criterio ?? '');
  const [prioridade, setPrioridade] = useState<string>(regra?.prioridade ?? 'intermediaria');
  const [severidade, setSeveridade] = useState<string>(regra?.severidade ?? 'atencao');
  // Em porcento, como aparece na tela. A API guarda a fração, com três casas: a conversão é feita
  // ao salvar, e o que abre para editar não é arredondado (72,5% continua 72,5%).
  const [confiancaMinima, setConfiancaMinima] = useState(regra ? porcentoExato(regra.confianca_minima) : 70);
  const [cooldownMin, setCooldownMin] = useState(regra?.cooldown_min ?? 15);
  // Quase todo critério é de operação: nasce valendo com a loja aberta.
  const [quando, setQuando] = useState<Quando>(regra?.quando ?? 'no_horario');

  // A faixa de horas. A gaveta edita UMA faixa, todos os dias; o que foi
  // gravado com mais detalhe (dias diferentes) continua valendo até alguém
  // mexer aqui — por isso a faixa só sobe quando foi mexida.
  const faixaGuardada = faixaSimples(regra?.janelas);
  const faixaDetalhada = faixaGuardada === 'detalhada';
  const faixaInicial = regra ? undefined : inicial?.faixa;
  const [comFaixa, setComFaixa] = useState((faixaGuardada !== null && !faixaDetalhada) || Boolean(faixaInicial));
  const [faixaDe, setFaixaDe] = useState(faixaGuardada && !faixaDetalhada ? faixaGuardada.de : (faixaInicial?.de ?? '20:00'));
  const [faixaAte, setFaixaAte] = useState(faixaGuardada && !faixaDetalhada ? faixaGuardada.ate : (faixaInicial?.ate ?? '22:00'));
  const [mexeuNaFaixa, setMexeuNaFaixa] = useState(false);

  // Quando vale a pena conferir: a loja decide, com o detector, antes de
  // perguntar à nuvem.
  const [porteiro, setPorteiro] = useState<Porteiro>((regra ? (porteiroSugerido ?? regra.porteiro) : inicial?.porteiro) ?? 'sempre');
  // Em quantas olhadas seguidas fora do critério ele avisa.
  const [confirmarEm, setConfirmarEm] = useState(regra?.confirmar_em ?? 1);
  // Critério de estado: a foto padrão do canal vai junto à nuvem.
  const [comPadrao, setComPadrao] = useState(regra?.com_padrao ?? inicial?.comPadrao ?? false);

  // O que o detector procura. Só vale nos tipos julgados na loja.
  const doDetector = regra ? regra.parametros : inicial;
  const [objeto, setObjeto] = useState(doDetector?.objeto ?? 'pessoa');
  const [deveHaver, setDeveHaver] = useState(doDetector?.maximo !== 0);
  const [minimo, setMinimo] = useState(String(doDetector?.minimo ?? 0));
  const [maximo, setMaximo] = useState(doDetector?.maximo == null ? '' : String(doDetector.maximo));

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const peloDetector = TIPOS_DO_DETECTOR.includes(tipo);
  const porteiros = porteirosDoTipo(tipo);

  /** Trocar o tipo larga a escolha que não cabe no novo (a mesma regra do servidor). */
  function mudarTipo(novo: Regra['tipo']) {
    setTipo(novo);
    if (!porteirosDoTipo(novo).some((o) => o.valor === porteiro)) setPorteiro('sempre');
  }

  function mudarFaixa(parte: { com?: boolean; de?: string; ate?: string }) {
    if (parte.com !== undefined) setComFaixa(parte.com);
    if (parte.de !== undefined) setFaixaDe(parte.de);
    if (parte.ate !== undefined) setFaixaAte(parte.ate);
    setMexeuNaFaixa(true);
  }

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
  const resumoDaLoja = resumoDoHorario(horarioDaLoja);
  const canaisAntes = regra ? new Set(regra.alvos.map((a) => a.ponto_id)).size : 0;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    // A faixa só sobe quando é nova ou foi mexida: ausente, o servidor
    // mantém a que está guardada.
    const mandaFaixa = !regra || mexeuNaFaixa;
    if (mandaFaixa && comFaixa) {
      if (!faixaDe || !faixaAte) return setErro('Diga a hora de início e a de fim da faixa de horas.');
      if (faixaDe === faixaAte) {
        return setErro('A faixa de horas começa e termina na mesma hora. Escolha horas diferentes, ou desmarque a faixa.');
      }
    }
    setSalvando(true);
    try {
      const corpo = {
        nome,
        tipo,
        criterio,
        prioridade,
        severidade,
        confiancaMinima: Number((Math.min(100, Math.max(0, confiancaMinima)) / 100).toFixed(3)),
        cooldownMin,
        zonaIds: [...marcadas],
        parametros: parametros(),
        quando,
        // Vai sempre, já acertado para o tipo: o servidor recusa presença
        // ou contagem com outra coisa que não "em toda olhada".
        porteiro: porteiros.some((o) => o.valor === porteiro) ? porteiro : 'sempre',
        confirmarEm,
        // Só o critério de estado tem a escolha; nos outros tipos ela sobe
        // desmarcada, para não ficar valendo escondida depois de trocar o tipo.
        comPadrao: tipo === 'estado' && comPadrao,
        ...(mandaFaixa ? { janelas: comFaixa ? faixaDeTodosOsDias(faixaDe, faixaAte) : [] } : {}),
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

        <Escolhas nome={`${p}-tipo`} rotulo="O que conferir" opcoes={TIPOS} valor={tipo} aoMudar={mudarTipo} />

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

        {/* Comparação é julgada na loja, contra a foto padrão do canal. Só o
            que NÃO for igual a ela vai à nuvem, com a foto ao lado. */}
        {tipo === 'comparacao' && (
          <Grupo titulo="Com o que comparar">
            <p className="text-[12.5px] text-farol-suave">
              Com a <strong className="font-semibold text-farol-tinta">foto padrão</strong> do canal em que o critério
              valer. É julgado <strong className="font-semibold text-farol-tinta">dentro da loja</strong>: parecido com
              o padrão é conforme, sem custo. Só vai à nuvem — com a foto padrão ao lado — quando a loja ficar em
              dúvida.
            </p>
            <Alerta icone={Imagem}>
              Canal sem foto padrão não é conferido: o critério fica marcado com “falta a foto padrão” até ela existir.
              A foto se guarda em Canais, na tela “Quadro e área” do canal.
            </Alerta>
          </Grupo>
        )}

        <Campo
          rotulo="O que é “conforme”"
          htmlFor={`${p}-criterio`}
          // Três casos, e a dica não pode mentir em nenhum. Nos tipos de
          // texto, o critério VAI para o modelo como pergunta — vale dizer,
          // senão alguém escreve um rótulo e espera que funcione. Em
          // presença e contagem ele não vai a modelo nenhum. Em comparação
          // ele só vai quando a cena não é igual à foto padrão.
          ajuda={
            peloDetector
              ? 'Aqui o texto não é enviado a modelo nenhum: ele descreve a regra para quem ler o aviso. Quem decide são os campos de “O que o detector procura”.'
              : tipo === 'comparacao'
                ? 'Quando a cena não é igual à foto padrão, este texto vai ao modelo como pergunta, com a foto ao lado. Descreva o que se vê, não o rótulo: “a superfície tem restos no canto” funciona melhor que “sujeira”.'
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
            Canal com mais de uma área: marque a área em que o critério vale.
          </p>
          <ArvoreDeCanais setores={setores} marcadas={marcadas} aoMudar={setMarcadas} prefixo={p} />
          {editando && canais === 0 && (
            <Alerta tom="atencao" icone={TriangleAlert} papel="alert">
              Sem nenhum canal, este critério deixa de ser verificado em qualquer lugar e é desligado. Ele fica
              guardado em “Sem canal”.
            </Alerta>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[5px]">
          <Escolhas
            nome={`${p}-quando`}
            rotulo="Em que horário conferir"
            opcoes={QUANDOS}
            valor={quando}
            aoMudar={setQuando}
          />
          <p className="text-xs text-farol-suave">
            {resumoDaLoja
              ? `O horário é o da loja: ${resumoDaLoja}. Mudou lá, mudou para todos os critérios.`
              : 'A loja ainda não informou horário, então vale como sempre aberta.'}
          </p>
          {/* Sem horário a loja nunca está "fechada": este critério ficaria
              cadastrado, ligado e sem ser conferido — tem que estar dito. */}
          {!resumoDaLoja && quando === 'fora_do_horario' && (
            <Alerta tom="atencao" icone={TriangleAlert} papel="alert">
              Sem horário informado, a loja nunca está fechada: este critério só começa a ser conferido depois que
              o horário de funcionamento for informado, na tela de critérios.
            </Alerta>
          )}

          <label htmlFor={`${p}-faixa`} className="mt-1.5 flex cursor-pointer items-center gap-2.5">
            <input
              id={`${p}-faixa`}
              type="checkbox"
              checked={comFaixa}
              onChange={(e) => mudarFaixa({ com: e.target.checked })}
              className="h-[17px] w-[17px] shrink-0 accent-farol-marca"
            />
            Só numa faixa de horas
          </label>
          {comFaixa && (
            <>
              <div className="grid grid-cols-2 gap-3.5">
                <Campo rotulo="Das" htmlFor={`${p}-faixa-de`}>
                  <input
                    id={`${p}-faixa-de`}
                    type="time"
                    required
                    className="entrada font-mono"
                    value={faixaDe}
                    onChange={(e) => mudarFaixa({ de: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Às" htmlFor={`${p}-faixa-ate`}>
                  <input
                    id={`${p}-faixa-ate`}
                    type="time"
                    required
                    className="entrada font-mono"
                    value={faixaAte}
                    onChange={(e) => mudarFaixa({ ate: e.target.value })}
                  />
                </Campo>
              </div>
              <p className="text-xs text-farol-suave">
                Todos os dias, dentro do horário escolhido acima.
                {faixaDe && faixaAte && faixaAte < faixaDe && ` Passa da meia-noite: vai até as ${faixaAte} do dia seguinte.`}
              </p>
            </>
          )}
          {/* Faixa gravada com mais detalhe do que a gaveta edita: dita, e
              mantida enquanto ninguém mexer. */}
          {faixaDetalhada && !mexeuNaFaixa && (
            <Alerta>
              Este critério já tem uma faixa de horas com dias diferentes: {resumoDaFaixa(regra?.janelas)}. Ela continua
              valendo. Marcar a caixa acima troca por uma faixa só, igual em todos os dias.
            </Alerta>
          )}
        </div>

        {/* O porteiro vale para o que pode ir à nuvem. Presença e contagem
            já são julgadas na loja em toda olhada: não têm a escolha. */}
        {porteiros.length > 0 && (
          <Grupo titulo="Quando vale a pena conferir">
            <Escolhas
              nome={`${p}-porteiro`}
              rotulo="Quando vale a pena conferir"
              rotuloOculto
              opcoes={porteiros}
              valor={porteiro}
              aoMudar={setPorteiro}
            />
            <p className="text-[12.5px] text-farol-suave">
              Quem responde é o detector, dentro da loja e sem custo. Quando a condição não vale, a olhada conta como{' '}
              <strong className="font-semibold text-farol-tinta">“nada a conferir”</strong>: não vai à nuvem e não entra
              em “não deu para avaliar”.
            </p>
            {tipo === 'estado' && (
              <label htmlFor={`${p}-com-padrao`} className="flex cursor-pointer items-start gap-2.5">
                <input
                  id={`${p}-com-padrao`}
                  type="checkbox"
                  checked={comPadrao}
                  onChange={(e) => setComPadrao(e.target.checked)}
                  className="mt-0.5 h-[17px] w-[17px] shrink-0 accent-farol-marca"
                />
                Mandar a foto padrão do canal junto, para a nuvem comparar com ela
              </label>
            )}
          </Grupo>
        )}

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
              rotulo="Confiança mínima, em %"
              htmlFor={`${p}-confianca`}
              ajuda="Abaixo disso o resultado é registrado, mas não vira aviso."
            >
              <input
                id={`${p}-confianca`}
                type="number"
                min={0}
                max={100}
                step="any"
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
            <Campo
              rotulo="Avisar só se continuar"
              htmlFor={`${p}-continua`}
              ajuda="Evita aviso por algo que durou um instante."
              largo
            >
              <select
                id={`${p}-continua`}
                className="entrada"
                value={confirmarEm}
                onChange={(e) => setConfirmarEm(Number(e.target.value))}
              >
                {CONFIRMACOES.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.r}
                  </option>
                ))}
                {/* Valor gravado fora da lista (pela API): aparece, em vez de
                    a gaveta trocá-lo calada ao salvar. */}
                {!CONFIRMACOES.some((o) => o.v === confirmarEm) && (
                  <option value={confirmarEm}>por {confirmarEm} olhadas seguidas</option>
                )}
              </select>
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
