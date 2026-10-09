'use client';

// =====================================================================
// Canais — as câmeras da loja, por setor
// =====================================================================
// Cada canal é um cartão que responde de relance: está sendo verificado?
// tem imagem? quantos quadros e critérios tem? a cena já foi descrita?
//
// "Tem imagem" não é chute: vem do que o agente contou nas últimas horas
// (os mesmos sinais do painel). Sem esse dado — canal sem critério ligado,
// ou perfil que não vê resultados — o cartão não afirma nada.
// =====================================================================

import {
  ArrowRight,
  Cctv,
  CircleMinus,
  Crop,
  Ellipsis,
  Folder,
  LockKeyhole,
  Pencil,
  Plus,
  Store,
  Trash2,
  VideoOff,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useConsole } from '@/componentes/console';
import { criteriosDoCanal, emOrdem } from '@/componentes/criterios/canais';
import { desdeAHora, plural } from '@/componentes/formatos';
import { abasDeCanais } from '@/componentes/pontos/abas-de-canais';
import { GavetaDoCanal } from '@/componentes/pontos/formulario-ponto';
import { Abas } from '@/componentes/ui/abas';
import { useAvisar } from '@/componentes/ui/avisos';
import { Botao } from '@/componentes/ui/botao';
import { Campo } from '@/componentes/ui/campo';
import { Alerta, Cabecalho, CARTAO, Chip, Ossos, Ponto as PontoDeEstado, Titulo, Vazio } from '@/componentes/ui/pecas';
import { Dialogo, DivisorDeMenu, ITEM_DE_MENU, Menu } from '@/componentes/ui/sobreposto';
import {
  consoleApi,
  ErroDaApi,
  regrasApi,
  resultadosApi,
  type Loja,
  type Ponto,
  type Regra,
  type Setor,
  type Sinal,
} from '@/lib/api';

/** Os tipos de critério que dependem de entender a imagem (os mesmos de `api/src/cena.ts`). */
const TIPOS_QUE_DEPENDEM_DA_CENA: readonly string[] = ['estado', 'acao', 'comparacao'];

/** A gaveta aberta: criando (talvez já num setor) ou editando um canal. */
type Aberta = { ponto?: Ponto; setorId?: string };

function numeroDoCanal(p: Ponto): string {
  return p.canal != null ? String(p.canal).padStart(2, '0') : 'IP';
}

function CartaoDoCanal({
  ponto,
  criterios,
  ligados,
  quadros,
  temCena,
  dependeDaCena,
  semImagem,
  fuso,
  sabeDaImagem,
  configura,
  aoEditar,
  aoExcluir,
}: {
  ponto: Ponto;
  criterios: number;
  ligados: number;
  /** Quantos quadros o canal tem marcados (a imagem completa não é quadro). */
  quadros: number;
  /** A cena do canal já foi escrita. */
  temCena: boolean;
  /** Há critério ligado que depende de entender a imagem: aí a cena em branco pesa mais. */
  dependeDaCena: boolean;
  semImagem: Sinal | undefined;
  fuso: string;
  /** Há dado do agente para afirmar que o canal tem imagem. */
  sabeDaImagem: boolean;
  configura: boolean;
  aoEditar: () => void;
  aoExcluir: () => void;
}) {
  return (
    <article
      className={`${CARTAO} flex flex-col gap-3 p-3.5 transition duration-200 ease-farol hover:-translate-y-0.5 hover:border-farol-borda-forte hover:shadow-farol-1 ${
        ponto.ativo ? '' : '!bg-farol-painel-2'
      }`}
    >
      <div className="flex items-start gap-[11px]">
        <span
          title={ponto.canal != null ? `Canal ${ponto.canal} do gravador` : 'Câmera IP'}
          className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] bg-farol-realce font-mono text-[13px] font-semibold ${
            ponto.ativo ? 'text-farol-marca' : 'text-farol-suave'
          }`}
        >
          {numeroDoCanal(ponto)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[15px] font-semibold leading-snug">{ponto.nome}</h3>
          <p className="break-words text-xs text-farol-suave">
            {ponto.origem === 'dvr' ? 'gravador' : 'câmera IP'}
            {ponto.host && (
              <>
                {' · '}
                <span className="font-mono">{ponto.host}</span>
              </>
            )}
          </p>
        </div>
        {configura && (
          <Menu
            alinhar="fim"
            gatilho={(p) => (
              <Botao variante="fantasma" mini quadrado aria-label={`Ações do canal ${ponto.nome}`} {...p}>
                <Ellipsis className="h-[18px] w-[18px]" aria-hidden />
              </Botao>
            )}
          >
            {(fechar) => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={ITEM_DE_MENU}
                  onClick={() => {
                    fechar();
                    aoEditar();
                  }}
                >
                  <Pencil className="h-[18px] w-[18px]" aria-hidden />
                  Editar
                </button>
                <Link href={`/pontos/${ponto.id}`} role="menuitem" className={ITEM_DE_MENU} onClick={fechar}>
                  <Crop className="h-[18px] w-[18px]" aria-hidden />
                  Abrir o canal
                </Link>
                <DivisorDeMenu />
                <button
                  type="button"
                  role="menuitem"
                  className={`${ITEM_DE_MENU} text-farol-critico`}
                  onClick={() => {
                    fechar();
                    aoExcluir();
                  }}
                >
                  <Trash2 className="h-[18px] w-[18px]" aria-hidden />
                  Excluir
                </button>
              </>
            )}
          </Menu>
        )}
      </div>

      <div className="flex flex-1 flex-wrap content-start gap-1.5">
        {!ponto.ativo ? (
          <Chip tom="atencao" icone={CircleMinus}>
            pausado
          </Chip>
        ) : semImagem ? (
          <Chip tom="critico" icone={VideoOff}>
            sem imagem {desdeAHora(semImagem.desde, fuso) ?? ''}
          </Chip>
        ) : ligados === 0 ? (
          <Chip>
            <PontoDeEstado />
            {criterios === 0 ? 'sem critério' : 'nenhum critério ligado'}
          </Chip>
        ) : sabeDaImagem ? (
          <Chip tom="ok">
            <PontoDeEstado tom="ok" />
            com imagem
          </Chip>
        ) : (
          <Chip tom="ok">
            <PontoDeEstado tom="ok" />
            ativo
          </Chip>
        )}
        {ponto.importancia === 'critico' && <Chip tom="atencao">importância crítica</Chip>}
        {ponto.importancia === 'baixo' && <Chip>importância baixa</Chip>}
        {quadros > 0 && <Chip tom="vazado">{plural(quadros, 'quadro', 'quadros')}</Chip>}
        {temCena ? (
          <Chip tom="ok">cena descrita</Chip>
        ) : (
          // Em branco é sempre um "falta"; pesa mais onde há critério que depende de entender a imagem.
          <Chip tom={dependeDaCena ? 'atencao' : 'vazado'}>falta a cena</Chip>
        )}
      </div>

      <div className="flex items-center justify-between gap-2.5 border-t border-farol-borda pt-[11px] text-[13px] text-farol-suave">
        <span className="min-w-0">
          {!ponto.ativo
            ? 'Fica guardado, sem verificar'
            : criterios === 0
              ? 'Nada é verificado aqui'
              : plural(criterios, 'critério', 'critérios')}
        </span>
        <Link href={`/pontos/${ponto.id}`} className="elo shrink-0 whitespace-nowrap">
          Abrir o canal
          <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

export default function Canais() {
  const { id } = useParams<{ id: string }>();
  const { configura, veResultados, saude, atualizar } = useConsole();
  const avisar = useAvisar();

  const [loja, setLoja] = useState<Loja | null>(null);
  const [setores, setSetores] = useState<Setor[] | null>(null);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [sinais, setSinais] = useState<Sinal[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [aberta, setAberta] = useState<Aberta | null>(null);
  const [excluindo, setExcluindo] = useState<Ponto | null>(null);
  const [excluindoAgora, setExcluindoAgora] = useState(false);
  const [erroAoExcluir, setErroAoExcluir] = useState<string | null>(null);
  const [novoSetor, setNovoSetor] = useState<string | null>(null);
  const [criandoSetor, setCriandoSetor] = useState(false);
  const [erroDoSetor, setErroDoSetor] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([consoleApi.loja(id), regrasApi.listar(id)]);
      setLoja(l.loja);
      setSetores(l.setores);
      setRegras(r.regras);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Qual câmera está sem imagem: os mesmos sinais do painel. Se não vier
  // (perfil sem acesso, rede), o cartão só deixa de afirmar.
  useEffect(() => {
    if (!veResultados) return;
    let vivo = true;
    resultadosApi
      .obter(id, '24h')
      .then((r) => vivo && setSinais(r.sinais))
      .catch(() => vivo && setSinais(null));
    return () => {
      vivo = false;
    };
  }, [id, veResultados]);

  /** Depois de mexer: a lista, a moldura e o que estava guardado do painel. */
  async function depoisDeMexer(mensagem: string) {
    resultadosApi.esquecer(id);
    atualizar();
    await carregar();
    avisar(mensagem);
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setExcluindoAgora(true);
    setErroAoExcluir(null);
    try {
      const r = await consoleApi.excluirPonto(excluindo.id);
      const desligados = r.criteriosDesligados.length;
      const nome = excluindo.nome;
      setExcluindo(null);
      await depoisDeMexer(
        `Canal “${nome}” excluído.` +
          (r.criteriosTirados > 0
            ? ` ${r.criteriosTirados} ${r.criteriosTirados === 1 ? 'critério saiu' : 'critérios saíram'} dele` +
              (desligados > 0
                ? `; ${desligados} ${desligados === 1 ? 'ficou' : 'ficaram'} sem canal e ${desligados === 1 ? 'foi desligado' : 'foram desligados'}.`
                : '.')
            : ''),
      );
    } catch (e) {
      // O erro fica DENTRO da pergunta: fechá-la esconderia que a exclusão
      // não aconteceu.
      setErroAoExcluir(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setExcluindoAgora(false);
    }
  }

  async function criarSetor() {
    const nome = (novoSetor ?? '').trim();
    if (!nome) {
      setErroDoSetor('Dê um nome ao setor.');
      return;
    }
    setCriandoSetor(true);
    setErroDoSetor(null);
    try {
      await consoleApi.criarSetor(id, nome);
      setNovoSetor(null);
      await depoisDeMexer(`Setor “${nome}” criado. Agora cadastre os canais dele.`);
    } catch (e) {
      setErroDoSetor(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setCriandoSetor(false);
    }
  }

  // O que deixa de ser verificado se o canal for excluído. A pergunta "tem
  // certeza?" sem dizer a consequência não é pergunta.
  const criteriosDoExcluido = excluindo
    ? regras
        .filter((r) => r.alvos.some((a) => a.ponto_id === excluindo.id))
        .map((r) => ({ nome: r.nome, soAqui: r.alvos.every((a) => a.ponto_id === excluindo.id) }))
    : [];
  const ficamSemCanal = criteriosDoExcluido.filter((c) => c.soAqui);
  const seguemEmOutros = criteriosDoExcluido.filter((c) => !c.soAqui);

  const semImagem = (pontoId: string) =>
    saude?.estado === 'ativo' ? sinais?.find((s) => s.tipo === 'canal_sem_imagem' && s.pontoId === pontoId) : undefined;
  const totalDeCanais = setores?.reduce((n, s) => n + s.pontos.length, 0) ?? 0;

  return (
    <>
      <Cabecalho
        sobre={
          <>
            <Store className="h-[15px] w-[15px]" aria-hidden />
            {loja?.nome ?? 'Loja'}
          </>
        }
        titulo="Canais"
        acoes={
          configura && (
            <>
              <Botao
                onClick={() => {
                  setErroDoSetor(null);
                  setNovoSetor('');
                }}
              >
                <Folder className="h-[18px] w-[18px]" aria-hidden />
                Novo setor
              </Botao>
              <Botao variante="primario" onClick={() => setAberta({})}>
                <Plus className="h-[18px] w-[18px]" aria-hidden />
                Novo canal
              </Botao>
            </>
          )
        }
      >
        As câmeras desta loja, por setor. Em cada canal: a imagem completa, os quadros e os critérios de cada um.
      </Cabecalho>

      <Abas rotulo="Vistas dos canais" abas={abasDeCanais(id)} />

      {erro && (
        <Alerta tom="critico" papel="alert">
          {erro}
        </Alerta>
      )}

      {setores === null && !erro && <Ossos alturas={[22, [138, 138, 138, 138], 22, [138, 138]]} />}

      {setores && totalDeCanais === 0 && setores.length === 0 && (
        <Vazio
          icone={Cctv}
          titulo="Nenhum canal cadastrado"
          acao={
            configura && (
              <Botao variante="primario" onClick={() => setAberta({})}>
                <Plus className="h-[18px] w-[18px]" aria-hidden />
                Cadastrar o primeiro canal
              </Botao>
            )
          }
        >
          Comece criando um setor (Cozinha, Salão, Estoque) e, dentro dele, os canais. Um canal é uma câmera do
          gravador ou uma câmera IP.
        </Vazio>
      )}

      {setores?.map((s) => {
        const canais = emOrdem(s.pontos);
        return (
          <section key={s.id} aria-labelledby={`setor-${s.id}`} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <Folder className="h-[18px] w-[18px] shrink-0 text-farol-facho-icone" aria-hidden />
              <Titulo id={`setor-${s.id}`}>{s.nome}</Titulo>
              <span className="text-farol-suave">{plural(canais.length, 'canal', 'canais')}</span>
              {configura && (
                <Botao variante="fantasma" mini className="ml-auto" onClick={() => setAberta({ setorId: s.id })}>
                  <Plus className="h-[15px] w-[15px]" aria-hidden />
                  Canal<span className="sr-only"> no setor {s.nome}</span>
                </Botao>
              )}
            </div>

            {canais.length === 0 ? (
              <p className={`${CARTAO} border-dashed px-4 py-5 text-farol-suave`}>
                Nenhum canal neste setor. Um canal é uma câmera — do gravador (com número) ou IP direta.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,268px),1fr))] gap-3">
                {canais.map((p) => {
                  const doCanal = criteriosDoCanal(regras, p.id);
                  const distintos = new Map(doCanal.map((c) => [c.regra.id, c.regra]));
                  const ligados = [...distintos.values()].filter((r) => r.ativa).length;
                  return (
                    <CartaoDoCanal
                      key={p.id}
                      ponto={p}
                      criterios={distintos.size}
                      ligados={ligados}
                      quadros={p.zonas.filter((z) => !z.principal).length}
                      temCena={p.tem_cena === true}
                      dependeDaCena={[...distintos.values()].some((r) => r.ativa && TIPOS_QUE_DEPENDEM_DA_CENA.includes(r.tipo))}
                      semImagem={semImagem(p.id)}
                      fuso={loja?.timezone ?? 'America/Sao_Paulo'}
                      sabeDaImagem={sinais !== null && saude?.estado === 'ativo'}
                      configura={configura}
                      aoEditar={() => setAberta({ ponto: p })}
                      aoExcluir={() => {
                        setErroAoExcluir(null);
                        setExcluindo(p);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {setores && setores.length > 0 && (
        <Alerta icone={LockKeyhole}>
          A senha do gravador não se cadastra aqui. Ela fica no cofre do agente, dentro da loja; o console guarda só
          o usuário.
        </Alerta>
      )}

      {aberta && setores && (
        <GavetaDoCanal
          // A chave remonta o formulário quando se troca de canal: sem ela
          // os campos ficariam com os valores do anterior.
          key={aberta.ponto?.id ?? `novo-${aberta.setorId ?? ''}`}
          lojaId={id}
          setores={setores}
          setorId={aberta.setorId}
          ponto={aberta.ponto}
          aoFechar={() => setAberta(null)}
          aoSalvar={async (mensagem) => {
            setAberta(null);
            await depoisDeMexer(mensagem);
          }}
        />
      )}

      {novoSetor !== null && (
        <Dialogo
          titulo="Novo setor"
          rotuloConfirmar="Criar setor"
          rotuloOcupado="Criando…"
          variante="primario"
          formulario
          ocupado={criandoSetor}
          erro={erroDoSetor}
          aoConfirmar={criarSetor}
          aoCancelar={() => setNovoSetor(null)}
        >
          <Campo rotulo="Nome do setor" htmlFor="novo-setor" ajuda="Um setor agrupa os canais de um lugar da loja.">
            <input
              id="novo-setor"
              autoFocus
              className="entrada"
              placeholder="Cozinha, Salão, Estoque…"
              value={novoSetor}
              onChange={(e) => setNovoSetor(e.target.value)}
            />
          </Campo>
        </Dialogo>
      )}

      {excluindo && (
        <Dialogo
          titulo={`Excluir o canal “${excluindo.nome}”?`}
          rotuloConfirmar="Excluir canal"
          rotuloOcupado="Excluindo…"
          ocupado={excluindoAgora}
          erro={erroAoExcluir}
          aoConfirmar={confirmarExclusao}
          aoCancelar={() => setExcluindo(null)}
        >
          <p>
            O canal some desta tela e <strong>deixa de ser verificado</strong>. O histórico do que já foi registrado
            nele continua.
          </p>
          {criteriosDoExcluido.length === 0 && <p>Nenhum critério vale neste canal.</p>}
          {ficamSemCanal.length > 0 && (
            <p>
              {ficamSemCanal.length === 1 ? 'Este critério só vale' : 'Estes critérios só valem'} aqui:{' '}
              {ficamSemCanal.length === 1 ? 'é desligado e vai' : 'são desligados e vão'} para “Sem canal”:{' '}
              <strong>{ficamSemCanal.map((c) => c.nome).join(', ')}</strong>.
            </p>
          )}
          {seguemEmOutros.length > 0 && (
            <p>
              {seguemEmOutros.length === 1 ? 'Sai' : 'Saem'} deste canal e{' '}
              {seguemEmOutros.length === 1 ? 'continua' : 'continuam'} nos outros:{' '}
              {seguemEmOutros.map((c) => c.nome).join(', ')}.
            </p>
          )}
          <p>
            Se a ideia é só parar por um tempo, use <strong>Editar</strong> e mude a situação para “pausado”.
          </p>
        </Dialogo>
      )}
    </>
  );
}
