'use client';

// =====================================================================
// Critérios de análise — o explorador
// =====================================================================
// Pedido do dono (06/10/2026): navegar como num explorador de arquivos.
// Setor é pasta, canal é o que está dentro, critério é o arquivo. Em cada
// canal, "+ critério"; em cada critério, editar ou tirar do canal.
//
// E um critério é cadastrado UMA vez: no formulário, a mesma árvore deixa
// marcar o setor inteiro ou só os canais que se quer. Três cadastros
// iguais em três câmeras eram três edições quando a redação mudava.
// =====================================================================

import { Cctv, ListChecks, Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { naArea, rotuloDaArea } from '@/componentes/canal/quadros';
import { areaDoCanal, rotuloDoCanal, temVariasAreas } from '@/componentes/criterios/canais';
import { Explorador, type Filtro } from '@/componentes/criterios/explorador';
import { GavetaDoCriterio } from '@/componentes/criterios/formulario-criterio';
import { FaixaDoHorario } from '@/componentes/horario/faixa-do-horario';
import { GavetaDoHorario } from '@/componentes/horario/gaveta-do-horario';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao, classesDoBotao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, Ossos, Segmentado, Vazio } from '@/componentes/ui/pecas';
import { Dialogo } from '@/componentes/ui/sobreposto';
import { consoleApi, ErroDaApi, regrasApi, resultadosApi, type Ponto, type Regra, type Setor } from '@/lib/api';

/** O formulário aberto: criando (com canais já marcados) ou editando. */
type Aberto = { chave: string; regra?: Regra; marcadas: string[] };

/** A pergunta aberta antes de tirar um critério de um canal. */
type Tirando = { regra: Regra; ponto: Ponto; zonaId: string };

const FILTROS = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'ligados', rotulo: 'Ligados' },
  { valor: 'desligados', rotulo: 'Desligados' },
] as const;

export default function Criterios() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura, atualizar } = useConsole();
  const avisar = useAvisar();

  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [objetosDoDetector, setObjetosDoDetector] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [tirando, setTirando] = useState<Tirando | null>(null);
  const [tirandoAgora, setTirandoAgora] = useState(false);
  const [erroAoTirar, setErroAoTirar] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<Regra | null>(null);
  const [excluindoAgora, setExcluindoAgora] = useState(false);
  const [erroAoExcluir, setErroAoExcluir] = useState<string | null>(null);
  const [horarioAberto, setHorarioAberto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([regrasApi.listar(id), consoleApi.loja(id)]);
      setRegras(r.regras);
      setObjetosDoDetector(r.detector?.objetos ?? []);
      setSetores(l.setores);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const temCanal = setores.some((s) => s.pontos.some((p) => p.zonas.length > 0));

  function abrir(novo: Omit<Aberto, 'chave'>) {
    setErro(null);
    // A chave remonta o formulário a cada abertura: sem ela, editar um
    // critério logo depois de outro mostraria os campos do anterior.
    setAberto({ ...novo, chave: `${novo.regra?.id ?? 'novo'}-${Date.now()}` });
  }

  /** Depois de mexer: a lista, a moldura e o que estava guardado do painel. */
  async function depoisDeMexer(mensagem: string) {
    resultadosApi.esquecer(id);
    atualizar();
    await carregar();
    avisar(mensagem);
  }

  // Ligar e desligar é só `ativa`: os canais ficam como estão.
  async function alternar(r: Regra) {
    setErro(null);
    try {
      await regrasApi.editar(r.id, { ativa: !r.ativa });
      const n = new Set(r.alvos.map((a) => a.ponto_id)).size;
      await depoisDeMexer(
        `“${r.nome}” ${r.ativa ? 'desligado' : 'ligado'}` + (n > 1 ? ` nos ${n} canais em que vale.` : '.'),
      );
    } catch (e) {
      // A API explica por que não ligou (falta o que procurar, falta canal):
      // esse recado fica na página, não some em quatro segundos.
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }

  async function confirmarRetirada() {
    if (!tirando) return;
    setTirandoAgora(true);
    setErroAoTirar(null);
    try {
      const r = await regrasApi.tirarDoCanal(tirando.regra.id, tirando.zonaId);
      const t = tirando;
      setTirando(null);
      await depoisDeMexer(
        r.restantes === 0
          ? `“${t.regra.nome}” saiu de ${rotuloDoCanal(t.ponto)}. Era o último canal: ` +
              'o critério foi desligado e está em “Sem canal”.'
          : `“${t.regra.nome}” saiu de ${rotuloDoCanal(t.ponto)}. ` +
              `Continua valendo em ${r.restantes} ${r.restantes === 1 ? 'canal' : 'canais'}.`,
      );
    } catch (e) {
      // O erro fica DENTRO da pergunta: fechá-la esconderia que a ação
      // não aconteceu.
      setErroAoTirar(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setTirandoAgora(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setExcluindoAgora(true);
    setErroAoExcluir(null);
    try {
      await regrasApi.excluir(excluindo.id);
      const nome = excluindo.nome;
      if (aberto?.regra?.id === excluindo.id) setAberto(null);
      setExcluindo(null);
      await depoisDeMexer(`“${nome}” excluído. O histórico do que ele já registrou continua.`);
    } catch (e) {
      setErroAoExcluir(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setExcluindoAgora(false);
    }
  }

  /** Os canais (não as áreas) em que o critério a excluir vale. */
  const canaisDoExcluido = excluindo ? [...new Map(excluindo.alvos.map((a) => [a.ponto_id, a])).values()] : [];
  /** Onde o critério continua valendo se for tirado deste canal. */
  const outrosCanais = tirando ? tirando.regra.alvos.filter((a) => a.zona_id !== tirando.zonaId) : [];
  /** O lugar de onde ele sai — a imagem completa ou um quadro —, só no canal que tem quadros. */
  const deOndeSai =
    tirando && temVariasAreas(tirando.ponto) ? (tirando.ponto.zonas.find((z) => z.id === tirando.zonaId) ?? null) : null;
  /** Em palavras: "Canal 1 · Balcão (Quadro 1 · Lado do cliente)". */
  const lugar = (a: { ponto_id: string; ponto_nome: string; canal: number | null; zona_id: string; zona_nome: string }) => {
    const ponto = setores.flatMap((s) => s.pontos).find((p) => p.id === a.ponto_id);
    const canal = rotuloDoCanal({ nome: a.ponto_nome, canal: a.canal });
    if (!ponto || !temVariasAreas(ponto)) return canal;
    const zona = ponto.zonas.find((z) => z.id === a.zona_id);
    return `${canal} (${zona ? rotuloDaArea(zona) : a.zona_nome})`;
  };

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Store className="h-[15px] w-[15px]" aria-hidden />
            {loja?.nome ?? 'Loja'}
          </>
        }
        titulo="Critérios"
        acoes={
          regras !== null &&
          temCanal && (
            <>
              <Segmentado rotulo="Mostrar" opcoes={FILTROS} valor={filtro} aoMudar={setFiltro} />
              {configura && (
                <Botao variante="primario" onClick={() => abrir({ marcadas: [] })}>
                  <Plus className="h-[18px] w-[18px]" aria-hidden />
                  Novo critério
                </Botao>
              )}
            </>
          )
        }
      >
        Um critério é cadastrado uma vez e vale nos canais que você marcar. Editar muda em todos; tirar de um canal
        não mexe nos outros.
      </Cabecalho>

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      )}

      {regras === null && !erro && <Ossos alturas={[52, 96, 96, 52]} />}

      {regras !== null && temCanal && loja && (
        <FaixaDoHorario loja={loja} configura={configura} aoEditar={() => setHorarioAberto(true)} />
      )}

      {regras !== null && !temCanal && (
        <Vazio
          icone={Cctv}
          titulo="Esta loja ainda não tem câmera cadastrada"
          acao={
            <Link href={`/lojas/${id}/canais`} className={classesDoBotao({ variante: 'primario' })}>
              Cadastrar um canal primeiro
            </Link>
          }
        >
          Um critério vale em canais. Cadastre pelo menos um canal e volte aqui.
        </Vazio>
      )}

      {regras !== null && temCanal && regras.length === 0 && (
        <Vazio
          icone={ListChecks}
          titulo="Nenhum critério ainda"
          acao={
            configura && (
              <Botao variante="primario" onClick={() => abrir({ marcadas: [] })}>
                <Plus className="h-[18px] w-[18px]" aria-hidden />
                Criar o primeiro critério
              </Botao>
            )
          }
        >
          Um critério descreve, em português, o que é “conforme” naquela câmera. Escreva como você explicaria a
          alguém que acabou de chegar.
        </Vazio>
      )}

      {regras !== null && temCanal && regras.length > 0 && (
        <Explorador
          setores={setores}
          regras={regras}
          filtro={filtro}
          configura={configura}
          aoAdicionar={(ponto, zonaId) => {
            // "+ critério" abre o formulário de novo critério com aquele lugar
            // já marcado: o quadro (ou a imagem completa) em que se clicou, ou o
            // canal sem quadros.
            const area = zonaId ?? areaDoCanal(ponto);
            abrir({ marcadas: area ? [area] : [] });
          }}
          aoEditar={(regra) => abrir({ regra, marcadas: regra.alvos.map((a) => a.zona_id) })}
          aoTirar={(regra, ponto, zonaId) => {
            setErroAoTirar(null);
            setTirando({ regra, ponto, zonaId });
          }}
          aoExcluir={(regra) => {
            setErro(null);
            setErroAoExcluir(null);
            setExcluindo(regra);
          }}
          aoAlternar={alternar}
        />
      )}

      {aberto && (
        <GavetaDoCriterio
          key={aberto.chave}
          lojaId={id}
          setores={setores}
          regra={aberto.regra}
          marcadasDeInicio={aberto.marcadas}
          objetosDoDetector={objetosDoDetector}
          horarioDaLoja={loja?.horario_funcionamento ?? []}
          aoFechar={() => setAberto(null)}
          aoSalvar={async (mensagem) => {
            setAberto(null);
            await depoisDeMexer(mensagem);
          }}
        />
      )}

      {horarioAberto && loja && (
        <GavetaDoHorario
          lojaId={id}
          horario={loja.horario_funcionamento}
          aoFechar={() => setHorarioAberto(false)}
          aoSalvar={async (mensagem) => {
            setHorarioAberto(false);
            await depoisDeMexer(mensagem);
          }}
        />
      )}

      {excluindo && (
        <Dialogo
          titulo={`Excluir o critério “${excluindo.nome}”?`}
          rotuloConfirmar="Excluir critério"
          rotuloOcupado="Excluindo…"
          ocupado={excluindoAgora}
          erro={erroAoExcluir}
          aoConfirmar={confirmarExclusao}
          aoCancelar={() => setExcluindo(null)}
        >
          {canaisDoExcluido.length > 0 ? (
            <p>
              A análise deste critério <strong>deixará de ser verificada</strong> em{' '}
              {canaisDoExcluido.length === 1 ? 'seu canal' : `todos os ${canaisDoExcluido.length} canais`}:{' '}
              <strong>
                {canaisDoExcluido.map((a) => rotuloDoCanal({ nome: a.ponto_nome, canal: a.canal })).join(', ')}
              </strong>
              .
            </p>
          ) : (
            <p>Este critério não vale em canal nenhum: nada deixa de ser verificado.</p>
          )}
          <p>Ele some desta tela. O histórico do que já registrou continua guardado.</p>
          {canaisDoExcluido.length > 1 && (
            <p>
              Para tirar de um canal só, use <strong>Tirar deste canal</strong>.
            </p>
          )}
        </Dialogo>
      )}

      {tirando && (
        <Dialogo
          titulo={`Tirar “${tirando.regra.nome}” ${!deOndeSai ? 'deste canal' : deOndeSai.principal ? 'da imagem completa' : 'deste quadro'}?`}
          rotuloConfirmar={!deOndeSai ? 'Tirar do canal' : deOndeSai.principal ? 'Tirar da imagem completa' : 'Tirar do quadro'}
          rotuloOcupado="Tirando…"
          ocupado={tirandoAgora}
          erro={erroAoTirar}
          aoConfirmar={confirmarRetirada}
          aoCancelar={() => setTirando(null)}
        >
          <p>
            A análise deste critério <strong>deixará de ser verificada</strong> em{' '}
            <strong>
              {rotuloDoCanal(tirando.ponto)}
              {deOndeSai ? `, ${naArea(deOndeSai)}` : ''}
            </strong>
            .
          </p>
          {outrosCanais.length > 0 ? (
            <p>Ele continua valendo em: {outrosCanais.map(lugar).join(', ')}.</p>
          ) : (
            <p>
              Este é o <strong>único lugar</strong> deste critério. Ele deixa de ser verificado em qualquer lugar, é
              desligado e fica guardado em “Sem canal”. O histórico continua.
            </p>
          )}
        </Dialogo>
      )}
    </>
  );
}
