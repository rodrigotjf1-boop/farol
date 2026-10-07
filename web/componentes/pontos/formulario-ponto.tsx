'use client';

// =====================================================================
// O cadastro do canal — criar e editar, numa gaveta
// =====================================================================
// O mesmo formulário serve aos dois. Até 07/10/2026 só existia o de criar:
// a API já editava, e a tela não. Um endereço de gravador digitado errado
// ficava errado para sempre — foi o que aconteceu com o ponto "Bancada",
// preso no IP antigo depois que o gravador ganhou endereço fixo.
//
// Ele abre numa gaveta, com a lista de canais à vista atrás. Antes abria no
// topo do setor, fora da vista de quem tinha clicado lá embaixo.
//
// Não existe campo de senha aqui, e isso é desenho, não esquecimento: a
// senha do gravador fica no cofre do agente, dentro da loja.
// =====================================================================

import { HardDrive, LockKeyhole, Video } from 'lucide-react';
import { useId, useState } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { Campo, Escolhas, GRADE } from '@/componentes/ui/campo';
import { Alerta, Liga } from '@/componentes/ui/pecas';
import { Gaveta } from '@/componentes/ui/sobreposto';
import { consoleApi, ErroDaApi, type Importancia, type Ponto, type Setor } from '@/lib/api';

/** O valor da opção "cadastrar novo setor" na lista. */
const SETOR_NOVO = '__novo__';

const ORIGENS = [
  { valor: 'dvr', titulo: 'Gravador', ajuda: 'DVR ou NVR, por número de canal', icone: HardDrive },
  { valor: 'ip', titulo: 'Câmera IP', ajuda: 'ligada direto na rede', icone: Video },
] as const;

type Props = {
  lojaId: string;
  setores: Setor[];
  /** Em qual setor o canal novo nasce, se a pessoa clicou dentro de um. */
  setorId?: string;
  /** Presente = editando este canal. */
  ponto?: Ponto;
  aoSalvar: (mensagem: string) => Promise<void>;
  aoFechar: () => void;
};

export function GavetaDoCanal({ lojaId, setores, setorId, ponto, aoSalvar, aoFechar }: Props) {
  const editando = !!ponto;
  const p = useId();
  const [nome, setNome] = useState(ponto?.nome ?? '');
  const [setor, setSetor] = useState(setorId ?? setores[0]?.id ?? SETOR_NOVO);
  const [novoSetor, setNovoSetor] = useState('');
  const [origem, setOrigem] = useState<Ponto['origem']>(ponto?.origem ?? 'dvr');
  const [canal, setCanal] = useState(ponto?.canal != null ? String(ponto.canal) : '');
  const [host, setHost] = useState(ponto?.host ?? '');
  const [usuario, setUsuario] = useState(ponto?.usuario ?? '');
  const [fabricante, setFabricante] = useState(ponto?.fabricante ?? '');
  const [ativo, setAtivo] = useState(ponto?.ativo ?? true);
  const [importancia, setImportancia] = useState<Importancia>(ponto?.importancia ?? 'normal');
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
        await consoleApi.editarPonto(ponto.id, { ...dados, ativo, importancia });
        await aoSalvar(
          ativo
            ? `Canal “${dados.nome}” salvo.`
            : `Canal “${dados.nome}” salvo e pausado: nada é verificado nele até voltar.`,
        );
      } else {
        // Setor que ainda não existe é criado junto: quem está cadastrando
        // a primeira câmera não deveria ter que sair daqui para isso.
        let destino = setor;
        if (setor === SETOR_NOVO) {
          destino = (await consoleApi.criarSetor(lojaId, novoSetor.trim())).id;
        }
        await consoleApi.criarPonto(destino, { ...dados, porta: 554 });
        await aoSalvar(`Canal “${dados.nome}” criado.`);
      }
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={editando ? `Editar o canal “${ponto.nome}”` : 'Novo canal'}
      descricao="Uma câmera do gravador ou uma câmera IP direta."
      ocupado={salvando}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao type="submit" form={`${p}-form`} variante="primario" ocupado={salvando}>
            {salvando ? 'Salvando…' : editando ? 'Salvar canal' : 'Criar canal'}
          </Botao>
          <Botao onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
        </>
      }
    >
      <form id={`${p}-form`} onSubmit={enviar} className="flex flex-col gap-4">
        <Campo rotulo="Nome do canal" htmlFor={`${p}-nome`}>
          <input
            id={`${p}-nome`}
            required
            autoFocus
            className="entrada"
            placeholder="Montagem"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </Campo>

        {!editando && (
          <>
            <Campo rotulo="Setor" htmlFor={`${p}-setor`}>
              <select id={`${p}-setor`} className="entrada" value={setor} onChange={(e) => setSetor(e.target.value)}>
                {setores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
                <option value={SETOR_NOVO}>＋ cadastrar novo setor</option>
              </select>
            </Campo>
            {setor === SETOR_NOVO && (
              <Campo rotulo="Nome do novo setor" htmlFor={`${p}-novo-setor`}>
                <input
                  id={`${p}-novo-setor`}
                  required
                  className="entrada"
                  placeholder="Cozinha, Salão, Estoque…"
                  value={novoSetor}
                  onChange={(e) => setNovoSetor(e.target.value)}
                />
              </Campo>
            )}
          </>
        )}

        <Escolhas
          nome={`${p}-origem`}
          rotulo="De onde vem a imagem"
          opcoes={ORIGENS}
          valor={origem}
          aoMudar={setOrigem}
        />

        <div className={GRADE}>
          {origem === 'dvr' && (
            <Campo rotulo="Canal no gravador" htmlFor={`${p}-canal`}>
              <input
                id={`${p}-canal`}
                type="number"
                min={1}
                required
                className="entrada font-mono"
                placeholder="11"
                value={canal}
                onChange={(e) => setCanal(e.target.value)}
              />
            </Campo>
          )}
          <Campo rotulo="Endereço na rede" htmlFor={`${p}-host`}>
            <input
              id={`${p}-host`}
              className="entrada font-mono"
              placeholder="192.168.1.108"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Usuário" htmlFor={`${p}-usuario`}>
            <input
              id={`${p}-usuario`}
              className="entrada"
              placeholder="admin"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Fabricante" htmlFor={`${p}-fabricante`}>
            <input
              id={`${p}-fabricante`}
              className="entrada"
              placeholder="intelbras"
              value={fabricante}
              onChange={(e) => setFabricante(e.target.value)}
            />
          </Campo>
        </div>

        {editando && (
          <div className={GRADE}>
            <Campo rotulo="Importância" htmlFor={`${p}-importancia`} ajuda="Ordena o orçamento; não muda o que o canal precisa.">
              <select
                id={`${p}-importancia`}
                className="entrada"
                value={importancia}
                onChange={(e) => setImportancia(e.target.value as Importancia)}
              >
                <option value="critico">crítica — resolver primeiro</option>
                <option value="normal">normal</option>
                <option value="baixo">baixa — por último</option>
              </select>
            </Campo>
            <Campo rotulo="Situação">
              <Liga
                ligado={ativo}
                aoMudar={setAtivo}
                descricao="Canal ativo"
                rotulo={ativo ? 'ativo — é verificado' : 'pausado — fica guardado, sem verificar'}
              />
            </Campo>
          </div>
        )}

        <Alerta icone={LockKeyhole}>
          A senha do gravador não se cadastra aqui. Ela fica no cofre do agente, dentro da loja; o console guarda só
          o usuário.
        </Alerta>

        {erro && (
          <Alerta tom="critico" papel="alert">
            {erro}
          </Alerta>
        )}
      </form>
    </Gaveta>
  );
}
