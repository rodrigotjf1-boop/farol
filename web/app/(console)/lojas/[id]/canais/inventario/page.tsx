'use client';

// =====================================================================
// Inventário — os equipamentos da loja, por setor
// =====================================================================
// A chapa, a bancada, o caixa: como cada um fica quando está limpo e no
// lugar. Cada equipamento tem até quatro fotos, o lugar em que aparece (o
// canal e a área das fotos tiradas do quadro) e a descrição — que vai junto
// com cada pergunta feita à nuvem sobre aquela área.
//
// Não é o catálogo do que o Farol indica comprar: aqui tudo é da loja.
// =====================================================================

import { Folder, Info, Package, Plus, Store } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { GavetaDoCriterio } from '@/componentes/criterios/formulario-criterio';
import { plural } from '@/componentes/formatos';
import { CartaoDoEquipamento } from '@/componentes/inventario/cartao-do-equipamento';
import { GavetaDoEquipamento } from '@/componentes/inventario/gaveta-do-equipamento';
import { lugarEmTexto } from '@/componentes/inventario/rotulos';
import { abasDeCanais } from '@/componentes/pontos/abas-de-canais';
import { Abas } from '@/componentes/ui/abas';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { Alerta, Cabecalho, Ossos, Vazio } from '@/componentes/ui/pecas';
import { Dialogo } from '@/componentes/ui/sobreposto';
import {
  consoleApi,
  ErroDaApi,
  inventarioApi,
  regrasApi,
  resultadosApi,
  type Equipamento,
  type Setor,
} from '@/lib/api';

/** A gaveta aberta: um equipamento, ou um cadastro novo. A chave remonta o formulário a cada abertura. */
type Aberta = { item?: Equipamento; chave: string };
/** A gaveta de critério aberta a partir de um ponto a conferir. */
type CriterioSugerido = { item: Equipamento; frase: string; objetos: string[]; chave: string };

export default function Inventario() {
  const { id } = useParams<{ id: string }>();
  const { loja, configura, atualizar } = useConsole();
  const avisar = useAvisar();

  const [itens, setItens] = useState<Equipamento[] | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [maximoDeFotos, setMaximoDeFotos] = useState(4);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<Aberta | null>(null);
  const [excluindo, setExcluindo] = useState<Equipamento | null>(null);
  const [excluindoAgora, setExcluindoAgora] = useState(false);
  const [erroAoExcluir, setErroAoExcluir] = useState<string | null>(null);
  const [criterio, setCriterio] = useState<CriterioSugerido | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [inv, l] = await Promise.all([inventarioApi.listar(id), consoleApi.loja(id)]);
      setItens(inv.itens);
      setMaximoDeFotos(inv.maximoDeFotos);
      setSetores(l.setores);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui carregar o inventário');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = (item?: Equipamento) => setAberta({ item, chave: `${item?.id ?? 'novo'}-${Date.now()}` });

  /** O cadastro mudou no servidor com a gaveta aberta (criou, pôs ou tirou foto): a lista acompanha. */
  function acompanhar(item: Equipamento) {
    setItens((lista) => {
      if (!lista) return lista;
      return lista.some((x) => x.id === item.id) ? lista.map((x) => (x.id === item.id ? item : x)) : [...lista, item];
    });
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setExcluindoAgora(true);
    setErroAoExcluir(null);
    try {
      const r = await inventarioApi.excluir(excluindo.id);
      setExcluindo(null);
      setAberta(null);
      await carregar();
      avisar(`“${r.nome}” excluído do inventário.`);
    } catch (e) {
      // O erro fica DENTRO da pergunta: fechá-la esconderia que a ação não aconteceu.
      setErroAoExcluir(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setExcluindoAgora(false);
    }
  }

  /** "Criar critério" de um ponto a conferir: a gaveta de critério abre preenchida. */
  async function sugerirCriterio(item: Equipamento, frase: string) {
    setErro(null);
    try {
      const r = await regrasApi.listar(id);
      setAberta(null);
      setCriterio({ item, frase, objetos: r.detector?.objetos ?? [], chave: `${item.id}-${Date.now()}` });
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não consegui abrir o critério');
    }
  }

  const total = itens?.length ?? 0;
  const lugaresDoExcluido = excluindo?.aparece.map(lugarEmTexto) ?? [];

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Store className="h-[15px] w-[15px]" aria-hidden />
            {loja?.nome ?? 'Loja'}
          </>
        }
        titulo="Inventário"
        acoes={
          configura && (
            <Botao variante="primario" onClick={() => abrir()}>
              <Plus className="h-[18px] w-[18px]" aria-hidden />
              Novo equipamento
            </Botao>
          )
        }
      >
        Os equipamentos de cada setor, como ficam quando estão limpos e no lugar. O que a loja sabe de cada um vai junto
        com a pergunta feita à nuvem.
      </Cabecalho>

      <Abas rotulo="Vistas dos canais" abas={abasDeCanais(id)} />

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      )}

      {itens === null && !erro && <Ossos alturas={[22, [168, 168, 168, 168]]} />}

      {itens && total === 0 && (
        <Vazio
          icone={Package}
          titulo="Nenhum equipamento cadastrado"
          acao={
            configura && (
              <Botao variante="primario" onClick={() => abrir()}>
                <Plus className="h-[18px] w-[18px]" aria-hidden />
                Cadastrar o primeiro equipamento
              </Botao>
            )
          }
        >
          Comece pelo que mais importa conferir: a chapa, a bancada, o caixa. Para cada um, até {maximoDeFotos} fotos dele
          limpo e a descrição de como ele deve ficar.
        </Vazio>
      )}

      {itens && total > 0 && (
        <>
          <div className="flex flex-col gap-6" data-inventario>
            {setores.map((s, i) => {
              const doSetor = itens.filter((x) => x.setorId === s.id);
              return (
                <section key={s.id} aria-labelledby={`inv-${i}`} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                    <Folder className="h-[18px] w-[18px] text-farol-facho-icone" aria-hidden />
                    <h2 id={`inv-${i}`} className="font-display text-lg font-semibold">
                      {s.nome}
                    </h2>
                    <span className="text-[13px] text-farol-suave">
                      {doSetor.length > 0 ? plural(doSetor.length, 'equipamento', 'equipamentos') : 'nenhum equipamento'}
                    </span>
                  </div>
                  {doSetor.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,268px),1fr))] gap-3">
                      {doSetor.map((item) => (
                        <CartaoDoEquipamento key={item.id} item={item} maximoDeFotos={maximoDeFotos} aoAbrir={abrir} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-farol-suave">Nenhum equipamento cadastrado neste setor.</p>
                  )}
                </section>
              );
            })}
          </div>
          <Alerta icone={Info}>
            Para a loja comparar sozinha, o que vale é a <strong className="font-semibold text-farol-tinta">foto padrão do canal</strong>{' '}
            em que o equipamento aparece, guardada em “Quadro e área”. As fotos daqui dizem onde ele aparece e servem para
            descrever e identificar.
          </Alerta>
        </>
      )}

      {aberta && (
        <GavetaDoEquipamento
          key={aberta.chave}
          lojaId={id}
          setores={setores}
          item={aberta.item}
          configura={configura}
          maximoDeFotos={maximoDeFotos}
          aoMudar={acompanhar}
          aoSalvar={async (mensagem) => {
            setAberta(null);
            atualizar();
            await carregar();
            avisar(mensagem);
          }}
          aoCriarCriterio={(item, frase) => void sugerirCriterio(item, frase)}
          aoExcluir={(item) => {
            setErroAoExcluir(null);
            setExcluindo(item);
          }}
          aoFechar={() => {
            setAberta(null);
            // A gaveta pode ter criado um setor: a lista de setores acompanha.
            void carregar();
          }}
        />
      )}

      {criterio && (
        <GavetaDoCriterio
          key={criterio.chave}
          lojaId={id}
          setores={setores}
          marcadasDeInicio={criterio.item.aparece[0] ? [criterio.item.aparece[0].zonaId] : []}
          // Conferir limpeza e lugar pede a área livre, e a foto padrão ajuda a nuvem a ver o que mudou.
          inicial={{ nome: criterio.frase, criterio: `${criterio.frase}.`, porteiro: 'livre', comPadrao: true }}
          objetosDoDetector={criterio.objetos}
          horarioDaLoja={loja?.horario_funcionamento ?? []}
          aoFechar={() => setCriterio(null)}
          aoSalvar={async (mensagem) => {
            setCriterio(null);
            resultadosApi.esquecer(id);
            atualizar();
            avisar(mensagem);
          }}
        />
      )}

      {excluindo && (
        <Dialogo
          titulo={`Excluir o equipamento “${excluindo.nome}”?`}
          rotuloConfirmar="Excluir equipamento"
          rotuloOcupado="Excluindo…"
          ocupado={excluindoAgora}
          erro={erroAoExcluir}
          aoConfirmar={confirmarExclusao}
          aoCancelar={() => setExcluindo(null)}
        >
          <p>
            {excluindo.fotos.length > 0
              ? `${excluindo.fotos.length === 1 ? 'A foto dele é apagada' : `As ${excluindo.fotos.length} fotos dele são apagadas`}, junto com o cadastro.`
              : 'O cadastro é apagado. Ele ainda não tem foto.'}
          </p>
          {excluindo.descricao && lugaresDoExcluido.length > 0 && (
            <p>
              <strong>A descrição dele deixa de ir junto</strong> com as perguntas feitas à nuvem sobre{' '}
              {lugaresDoExcluido.join(' e ')}.
            </p>
          )}
          <p>Os critérios que já existem continuam como estão.</p>
        </Dialogo>
      )}
    </>
  );
}
