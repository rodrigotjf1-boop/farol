'use client';

// =====================================================================
// O cadastro do canal — criar e editar
// =====================================================================
// O mesmo formulário serve aos dois. Até 07/10/2026 só existia o de criar:
// a API já editava, e a tela não. Um endereço de gravador digitado errado
// ficava errado para sempre — foi o que aconteceu com o ponto "Bancada",
// preso no IP antigo depois que o gravador ganhou endereço fixo.
//
// Não existe campo de senha aqui, e isso é desenho, não esquecimento: a
// senha do gravador fica no cofre do agente, dentro da loja.
// =====================================================================

import { useId, useState } from 'react';

import { consoleApi, ErroDaApi, type Ponto } from '@/lib/api';

const campo = 'w-full rounded-lg border border-farol-borda bg-farol-fundo px-3 py-2 text-sm';
const rotulo = 'block text-xs font-medium text-farol-suave';

type Props = {
  /** Onde o canal novo nasce. Ignorado na edição. */
  setorId: string;
  /** Presente = editando este canal. */
  ponto?: Ponto;
  aoSalvar: (mensagem: string) => Promise<void>;
  aoCancelar: () => void;
};

export function FormularioPonto({ setorId, ponto, aoSalvar, aoCancelar }: Props) {
  const editando = !!ponto;
  const prefixo = useId();
  const [nome, setNome] = useState(ponto?.nome ?? '');
  const [origem, setOrigem] = useState<Ponto['origem']>(ponto?.origem ?? 'dvr');
  const [canal, setCanal] = useState(ponto?.canal != null ? String(ponto.canal) : '');
  const [host, setHost] = useState(ponto?.host ?? '');
  const [usuario, setUsuario] = useState(ponto?.usuario ?? '');
  const [fabricante, setFabricante] = useState(ponto?.fabricante ?? '');
  const [ativo, setAtivo] = useState(ponto?.ativo ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);

    // Campo vazio não vai: na edição, ausente MANTÉM o que está gravado —
    // mandar texto vazio apagaria o endereço do gravador sem ninguém pedir.
    const dados: Partial<Ponto> = { nome: nome.trim(), origem };
    if (origem === 'dvr' && canal.trim()) dados.canal = Number(canal);
    if (host.trim()) dados.host = host.trim();
    if (usuario.trim()) dados.usuario = usuario.trim();
    if (fabricante.trim()) dados.fabricante = fabricante.trim();

    try {
      if (ponto) {
        await consoleApi.editarPonto(ponto.id, { ...dados, ativo });
        await aoSalvar(
          ativo
            ? `Canal “${dados.nome}” salvo.`
            : `Canal “${dados.nome}” salvo e pausado: nada é verificado nele até voltar.`,
        );
      } else {
        await consoleApi.criarPonto(setorId, { ...dados, porta: 554 });
        await aoSalvar(`Canal “${dados.nome}” criado.`);
      }
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="border-b border-farol-borda px-4 py-4">
      {editando && <h3 className="mb-3 text-sm font-medium">Editando o canal “{ponto.nome}”</h3>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={rotulo} htmlFor={`${prefixo}-nome`}>
            Nome do ponto
          </label>
          <input
            id={`${prefixo}-nome`}
            required
            className={`mt-1 ${campo}`}
            placeholder="Montagem"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-origem`}>
            Origem
          </label>
          <select
            id={`${prefixo}-origem`}
            className={`mt-1 ${campo}`}
            value={origem}
            onChange={(e) => setOrigem(e.target.value as Ponto['origem'])}
          >
            <option value="dvr">Gravador (DVR/NVR)</option>
            <option value="ip">Câmera IP direta</option>
          </select>
        </div>

        {origem === 'dvr' && (
          <div>
            <label className={rotulo} htmlFor={`${prefixo}-canal`}>
              Canal
            </label>
            <input
              id={`${prefixo}-canal`}
              type="number"
              min={1}
              required
              className={`mt-1 ${campo}`}
              placeholder="11"
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
            />
          </div>
        )}

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-host`}>
            Endereço na rede
          </label>
          <input
            id={`${prefixo}-host`}
            className={`mt-1 ${campo}`}
            placeholder="192.168.1.108"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-usuario`}>
            Usuário
          </label>
          <input
            id={`${prefixo}-usuario`}
            className={`mt-1 ${campo}`}
            placeholder="admin"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />
        </div>

        <div>
          <label className={rotulo} htmlFor={`${prefixo}-fabricante`}>
            Fabricante
          </label>
          <input
            id={`${prefixo}-fabricante`}
            className={`mt-1 ${campo}`}
            placeholder="intelbras"
            value={fabricante}
            onChange={(e) => setFabricante(e.target.value)}
          />
        </div>

        {editando && (
          <div>
            <label className={rotulo} htmlFor={`${prefixo}-situacao`}>
              Situação
            </label>
            <select
              id={`${prefixo}-situacao`}
              className={`mt-1 ${campo}`}
              value={ativo ? 'ativo' : 'pausado'}
              onChange={(e) => setAtivo(e.target.value === 'ativo')}
            >
              <option value="ativo">ativo — é verificado</option>
              <option value="pausado">pausado — fica guardado, sem verificar</option>
            </select>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-farol-suave">
        A senha do gravador não se cadastra aqui — ela fica no cofre do agente, dentro da loja. O
        console guarda só o usuário.
      </p>

      {erro && (
        <p role="alert" className="mt-3 text-sm text-farol-critico">
          {erro}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={salvando}
          className="rounded-lg bg-farol-facho px-4 py-2 text-sm font-semibold text-farol-fundo transition hover:brightness-110 disabled:opacity-60"
        >
          {salvando ? 'Salvando…' : editando ? 'Salvar canal' : 'Salvar ponto'}
        </button>
        <button
          type="button"
          onClick={aoCancelar}
          disabled={salvando}
          className="rounded-lg border border-farol-borda px-4 py-2 text-sm transition hover:border-farol-facho/50 disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
