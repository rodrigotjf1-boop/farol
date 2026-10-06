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

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { areaDoCanal, rotuloDoCanal } from '@/componentes/criterios/canais';
import { Confirmar } from '@/componentes/criterios/confirmar';
import { Explorador } from '@/componentes/criterios/explorador';
import { FormularioCriterio } from '@/componentes/criterios/formulario-criterio';
import { podeConfigurar, Shell } from '@/componentes/shell';
import {
  api,
  consoleApi,
  ErroDaApi,
  regrasApi,
  type Eu,
  type Ponto,
  type Regra,
  type Setor,
} from '@/lib/api';

/** O formulário aberto: criando (com canais já marcados) ou editando. */
type Aberto = { chave: string; regra?: Regra; marcadas: string[] };

/** A pergunta aberta antes de tirar um critério de um canal. */
type Tirando = { regra: Regra; ponto: Ponto; zonaId: string };

export default function Criterios() {
  const { id } = useParams<{ id: string }>();
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [tirando, setTirando] = useState<Tirando | null>(null);
  const [tirandoAgora, setTirandoAgora] = useState(false);
  const [erroAoTirar, setErroAoTirar] = useState<string | null>(null);
  const topoDoFormulario = useRef<HTMLDivElement>(null);

  async function recarregar() {
    const [r, l] = await Promise.all([regrasApi.listar(id), consoleApi.loja(id)]);
    setRegras(r.regras);
    setSetores(l.setores);
  }

  useEffect(() => {
    Promise.all([regrasApi.listar(id), consoleApi.loja(id), api.eu()])
      .then(([r, l, u]) => {
        setRegras(r.regras);
        setSetores(l.setores);
        setEu(u);
      })
      .catch((e) => setErro(e instanceof ErroDaApi ? e.message : 'não deu certo'));
  }, [id]);

  // O formulário abre no topo. Em tela pequena o canal clicado pode estar
  // três rolagens abaixo, e o formulário abriria fora da vista.
  useEffect(() => {
    if (aberto) topoDoFormulario.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [aberto]);

  const configura = podeConfigurar(eu);
  const temCanal = setores.some((s) => s.pontos.some((p) => p.zonas.length > 0));

  function abrir(novo: Omit<Aberto, 'chave'>) {
    setErro(null);
    setAviso(null);
    // A chave muda a cada abertura: o formulário é remontado com os valores
    // de AGORA, em vez de reaproveitar o estado do critério anterior.
    setAberto({ ...novo, chave: `${novo.regra?.id ?? 'novo'}-${Date.now()}` });
  }

  async function alternar(r: Regra) {
    setErro(null);
    setAviso(null);
    try {
      await regrasApi.editar(r.id, { ativa: !r.ativa });
      await recarregar();
      setAviso(`“${r.nome}” ${r.ativa ? 'desligado' : 'ligado'}.`);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
    }
  }

  async function confirmarRetirada() {
    if (!tirando) return;
    setTirandoAgora(true);
    setErroAoTirar(null);
    try {
      const r = await regrasApi.tirarDoCanal(tirando.regra.id, tirando.zonaId);
      await recarregar();
      setAviso(
        r.restantes === 0
          ? `“${tirando.regra.nome}” saiu de ${rotuloDoCanal(tirando.ponto)}. Era o último canal: ` +
              'o critério foi desligado e está em “Sem canal”.'
          : `“${tirando.regra.nome}” saiu de ${rotuloDoCanal(tirando.ponto)}. ` +
              `Continua valendo em ${r.restantes} ${r.restantes === 1 ? 'canal' : 'canais'}.`,
      );
      setTirando(null);
    } catch (e) {
      // O erro fica DENTRO da pergunta: fechá-la esconderia que a retirada
      // não aconteceu.
      setErroAoTirar(e instanceof ErroDaApi ? e.message : 'não deu certo');
    } finally {
      setTirandoAgora(false);
    }
  }

  const outrosCanais = tirando
    ? tirando.regra.alvos.filter((a) => a.zona_id !== tirando.zonaId)
    : [];

  return (
    <Shell>
      <Link href={`/lojas/${id}`} className="text-sm text-farol-suave hover:text-farol-tinta">
        ← Loja
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Critérios de análise</h1>
        {configura && temCanal && !aberto && (
          <button
            type="button"
            onClick={() => abrir({ marcadas: [] })}
            className="ml-auto rounded-lg border border-farol-borda px-3 py-1.5 text-sm transition hover:border-farol-facho/50"
          >
            ＋ Critério
          </button>
        )}
      </div>
      <p className="mt-1 max-w-prose text-sm text-farol-suave">
        Um critério é cadastrado uma vez e vale nos canais que você marcar. Editar muda em
        todos; tirar de um canal não mexe nos outros.
      </p>

      {erro && (
        <p role="alert" className="mt-4 rounded-lg bg-farol-critico/10 p-3 text-sm text-farol-critico">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="mt-4 rounded-lg bg-farol-ok/10 p-3 text-sm text-farol-ok">
          {aviso}
        </p>
      )}

      <div ref={topoDoFormulario} className="scroll-mt-4">
        {aberto && (
          <FormularioCriterio
            key={aberto.chave}
            lojaId={id}
            setores={setores}
            regra={aberto.regra}
            marcadasDeInicio={aberto.marcadas}
            aoCancelar={() => setAberto(null)}
            aoSalvar={async (mensagem) => {
              setAberto(null);
              await recarregar();
              setAviso(mensagem);
            }}
          />
        )}
      </div>

      {regras !== null && !temCanal && (
        <div className="mt-6 rounded-xl border border-dashed border-farol-borda p-8 text-center">
          <p className="text-farol-suave">Esta loja ainda não tem câmera cadastrada.</p>
          <Link href={`/lojas/${id}`} className="mt-2 inline-block text-sm text-farol-facho">
            Cadastrar um ponto primeiro →
          </Link>
        </div>
      )}

      {regras !== null && temCanal && regras.length === 0 && !aberto && (
        <div className="mt-6 rounded-xl border border-dashed border-farol-borda p-6">
          <p className="text-farol-suave">Nenhum critério ainda.</p>
          <p className="mt-2 max-w-prose text-sm text-farol-suave">
            Um critério descreve, em português, o que é <em>conforme</em> naquela câmera. O
            agente usa esse texto como pergunta — então escreva como você explicaria a alguém
            que acabou de chegar. Abra um setor abaixo e use <strong>＋ critério</strong> no
            canal.
          </p>
        </div>
      )}

      {regras !== null && temCanal && (
        <Explorador
          setores={setores}
          regras={regras}
          configura={configura}
          aoAdicionar={(ponto) => {
            const area = areaDoCanal(ponto);
            abrir({ marcadas: area ? [area] : [] });
          }}
          aoEditar={(regra) => abrir({ regra, marcadas: regra.alvos.map((a) => a.zona_id) })}
          aoTirar={(regra, ponto, zonaId) => {
            setErroAoTirar(null);
            setTirando({ regra, ponto, zonaId });
          }}
          aoAlternar={alternar}
        />
      )}

      {tirando && (
        <Confirmar
          titulo={`Tirar “${tirando.regra.nome}” deste canal?`}
          rotuloConfirmar="Tirar do canal"
          ocupado={tirandoAgora}
          erro={erroAoTirar}
          aoConfirmar={confirmarRetirada}
          aoCancelar={() => setTirando(null)}
        >
          <p>
            A análise deste critério{' '}
            <strong className="text-farol-tinta">deixará de ser verificada</strong> em{' '}
            <strong className="text-farol-tinta">{rotuloDoCanal(tirando.ponto)}</strong>.
          </p>
          {outrosCanais.length > 0 ? (
            <p>
              Ele continua valendo em:{' '}
              {outrosCanais
                .map((a) => rotuloDoCanal({ nome: a.ponto_nome, canal: a.canal }))
                .join(', ')}
              .
            </p>
          ) : (
            <p>
              Este é o <strong className="text-farol-tinta">único canal</strong> deste critério.
              Ele deixa de ser verificado em qualquer lugar, é desligado e fica guardado em “Sem
              canal” — o histórico de vereditos continua.
            </p>
          )}
        </Confirmar>
      )}
    </Shell>
  );
}
