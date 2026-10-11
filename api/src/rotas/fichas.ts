// =====================================================================
// As fichas da loja — o que ela vende e do que cada produto é feito
// =====================================================================
// A tela Fichas lê daqui. O que ela mostra é a BASE DO FAROL (a cópia que
// o servidor guarda), nunca o Regem direto: a tela abre com o Regem fora do
// ar, e mostra o que valia na última leitura boa.
//
// Não se edita por aqui: as fichas são da fonte. O que dá para fazer é pedir
// uma leitura na hora ("Buscar agora").
//
// QUEM. Ver e buscar: quem configura a loja (gerente para cima e o
// suporte). Conectar é da diretoria, e mora em `rotas/regem.ts`.
//
// A loja do vizinho é 404, como em toda rota: o filtro pela conta vai na
// mesma consulta.
//
// O AGENTE da loja também lê daqui (`GET /v1/agentes/fichas`): é por onde a
// cópia da base chega ao computador da loja. A configuração diz a ele qual
// base a loja tem (a impressão); quando a cópia dele é outra, ele vem buscar.
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import { lerBase, resumoDoProduto } from '../fichas.js';
import { LEITURA_MORTA_MIN, lerFichasDaLoja } from '../leitura.js';
import { ehDiretoria, podeConfigurar } from '../rbac.js';
import type { ConfigDoRegem } from '../regem.js';
import { leituraParaTela, type LeituraDaLinha } from './regem.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Em que pé está a loja, do ponto de vista de quem quer ver as fichas. */
export type SituacaoDasFichas =
  /** A conta não tem conexão nenhuma para esta loja. */
  | 'sem_conexao'
  /** O Regem já autorizou lojas, mas falta dizer qual delas é esta. */
  | 'falta_ligar'
  /** A loja estava ligada e o Regem tirou o acesso: as fichas foram apagadas. */
  | 'acesso_tirado'
  /** Ligada: há (ou vai haver) base de fichas. */
  | 'ligada';

type Linha = LeituraDaLinha & {
  loja_nome: string;
  conexao_id: string | null;
  regem_loja_nome: string | null;
  esperando: number;
  atualizada_em: Date | null;
  conteudo: unknown;
};

export function rotasDeFichas(app: FastifyInstance, pool: pg.Pool, cfg: ConfigDoRegem): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    if (!podeConfigurar(s)) {
      resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não vê as fichas da loja' });
      return null;
    }
    return s;
  }

  /** A loja, a conexão dela e a base — numa consulta, já filtrada pela conta. */
  async function daLoja(s: Sessao, lojaId: string, comConteudo: boolean): Promise<Linha | null> {
    const { rows } = await pool.query<Linha>(
      `select l.nome as loja_nome, l.timezone as fuso,
              r.id as conexao_id, r.regem_loja_nome, r.lida_em, r.falha, r.acesso_tirado_em,
              (r.lendo_desde is not null and r.lendo_desde > now() - make_interval(mins => $3)) as lendo,
              f.produtos, f.com_ficha, f.atualizada_em,
              ${comConteudo ? 'f.conteudo' : 'null::jsonb as conteudo'},
              (select count(*)::int from regem_loja e where e.tenant_id = l.tenant_id and e.loja_id is null) as esperando
         from loja l
         left join regem_loja r on r.loja_id = l.id
         left join fichas_da_loja f on f.loja_id = l.id
        where l.id = $1 and l.tenant_id = $2`,
      [lojaId, s.tenantId, LEITURA_MORTA_MIN],
    );
    return rows[0] ?? null;
  }

  const situacaoDe = (l: Linha): SituacaoDasFichas =>
    l.conexao_id === null ? (l.esperando > 0 ? 'falta_ligar' : 'sem_conexao') : l.acesso_tirado_em ? 'acesso_tirado' : 'ligada';

  const semLoja = (resposta: FastifyReply) => resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'não existe essa loja' });

  // ───────────────────────────── a lista ─────────────────────────────

  app.get('/v1/lojas/:id/fichas', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });

    const l = await daLoja(s, id, true);
    if (!l) return semLoja(resposta);
    const base = lerBase(l.conteudo);

    return {
      situacao: situacaoDe(l),
      /** Só a diretoria conecta e liga: a tela mostra o botão ou a frase. */
      podeConectar: ehDiretoria(s),
      /** De onde as fichas vieram. Nulo = a loja não tem base. */
      fonte: base ? 'regem' : null,
      /** O nome da loja no Regem, para a tela dizer com qual loja de lá esta está ligada. */
      regemLojaNome: l.regem_loja_nome,
      leitura: l.conexao_id ? leituraParaTela(l) : null,
      totais: base ? { produtos: l.produtos ?? 0, comFicha: l.com_ficha ?? 0 } : null,
      produtos: base ? base.produtos.map(resumoDoProduto) : [],
    };
  });

  // ─────────────────────────── um produto ───────────────────────────

  app.get('/v1/lojas/:id/fichas/produtos/:produtoId', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id, produtoId } = req.params as { id: string; produtoId: string };
    if (!UUID.test(id) || !UUID.test(produtoId)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });

    const l = await daLoja(s, id, true);
    if (!l) return semLoja(resposta);
    const produto = lerBase(l.conteudo)?.produtos.find((p) => p.id.toLowerCase() === produtoId.toLowerCase());
    if (!produto) {
      // O produto saiu do cardápio entre a lista e o clique, ou as fichas foram apagadas.
      return resposta.status(404).send({ erro: 'produto_nao_encontrado', mensagem: 'este produto não está mais nas fichas da loja' });
    }
    return produto;
  });

  // ─────────────────────────── buscar agora ───────────────────────────

  app.post('/v1/lojas/:id/fichas/buscar', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });

    const l = await daLoja(s, id, false);
    if (!l) return semLoja(resposta);
    const situacao = situacaoDe(l);
    if (situacao !== 'ligada' || !l.conexao_id) {
      return resposta.status(409).send({
        erro: situacao === 'acesso_tirado' ? 'acesso_tirado' : 'sem_conexao',
        mensagem:
          situacao === 'acesso_tirado'
            ? 'o acesso desta loja foi tirado no Regem. Para buscar as fichas, é preciso conectar de novo'
            : 'esta loja não está ligada ao Regem',
      });
    }
    // Para LER basta a chave que abre o acesso guardado (o segredo do
    // aplicativo é só para conectar).
    if (cfg.chave === null) {
      return resposta.status(503).send({
        erro: 'conexao_indisponivel',
        mensagem: 'a conexão com o Regem não está disponível nesta instalação. Fale com quem cuida do Farol',
      });
    }

    const r = await lerFichasDaLoja(pool, cfg, l.conexao_id, req.log);
    if (r.desfecho === 'ocupada') {
      return resposta.status(409).send({ erro: 'buscando', mensagem: 'já há uma busca desta loja em andamento. Aguarde um instante' });
    }
    if (r.desfecho === 'acesso_tirado') {
      return resposta.status(409).send({
        erro: 'acesso_tirado',
        mensagem: 'o acesso desta loja foi tirado no Regem, e as fichas dela foram apagadas. Para tê-las de volta, é preciso conectar de novo',
      });
    }
    if (r.desfecho === 'nao_ligada') {
      return resposta.status(409).send({ erro: 'sem_conexao', mensagem: 'esta loja não está mais ligada ao Regem' });
    }
    if (r.desfecho === 'falhou') {
      return resposta.status(502).send({
        erro: 'regem_sem_resposta',
        mensagem: 'o Farol não conseguiu ler o Regem agora. As fichas que a loja já tem continuam valendo; tente de novo em instantes',
      });
    }

    // O que a base tem DEPOIS da busca: é o que deixa a tela dizer "continua sem fichas".
    const depois = await daLoja(s, id, false);
    return {
      /** `atualizada`: as fichas mudaram. `nada_mudou`: o que a loja tinha continua valendo. */
      resultado: r.desfecho,
      produtos: depois?.produtos ?? 0,
      comFicha: depois?.com_ficha ?? 0,
    };
  });

  // ─────────────────────── o agente baixa a base ───────────────────────
  // Quem pede é o agente, de dentro para fora, com o token dele — a loja é
  // a do token, e nenhum parâmetro escolhe outra.
  //
  // Vai o documento inteiro, como está guardado, com a impressão DELE: as
  // duas saem da mesma linha. Se a base mudou depois que a configuração
  // desceu, o agente recebe a de agora — e a configuração seguinte confirma.
  //
  // Sem preço, custo nem cliente: a base nunca os teve.
  app.get('/v1/agentes/fichas', async (req, resposta) => {
    let agente;
    try {
      agente = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const { rows } = await pool.query<{ impressao: string; conteudo: unknown }>(
      'select impressao, conteudo from fichas_da_loja where loja_id = $1',
      [agente.lojaId],
    );
    if (rows.length === 0) {
      // Desconectada (ou o acesso foi tirado) entre a configuração e o pedido.
      return resposta.status(404).send({ erro: 'sem_fichas', mensagem: 'esta loja não tem base de fichas' });
    }
    return resposta.header('cache-control', 'no-store').send({ impressao: rows[0]!.impressao, base: rows[0]!.conteudo });
  });
}
