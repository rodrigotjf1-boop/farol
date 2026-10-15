// =====================================================================
// As fichas da loja — o que ela vende e do que cada produto é feito
// =====================================================================
// A tela Fichas lê daqui. O que ela mostra é a BASE DO FAROL (a cópia que
// o servidor guarda), nunca o Regem direto: a tela abre com o Regem fora do
// ar, e mostra o que valia na última leitura boa.
//
// Não se edita por aqui: as fichas são da fonte. O que dá para fazer é pedir
// uma leitura na hora ("Buscar agora") — ou, na loja que não usa o Regem,
// IMPORTAR UMA PLANILHA no modelo do Farol (`planilha-fichas.ts`).
//
// A PLANILHA. Quem abre o arquivo é o navegador; para cá vêm as células, e
// toda regra é daqui. `POST …/fichas/importar` confere e diz o que entraria
// e o que ficaria de fora; com `gravar: true`, troca a base da loja pelo que
// está certo (decisão do dono, 11/10/2026: "entra o que está certo e a tela
// lista o que ficou de fora"). O registro da última importação fica
// guardado, com a lista do que ficou de fora. Uma loja recebe as fichas de
// um lugar só: loja ligada ao Regem não importa planilha.
//
// QUEM. Ver: quem acompanha a loja (supervisão para cima e o suporte —
// decisão do dono em 11/10/2026). Pedir a busca e importar: quem configura a
// loja (gerente para cima e o suporte). Conectar é da diretoria, e mora em
// `rotas/regem.ts`.
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
import { impressaoDaBase, lerBase, resumoDoProduto } from '../fichas.js';
import { LEITURA_MORTA_MIN, lerFichasDaLoja } from '../leitura.js';
import { COLUNAS, lerPlanilha, linhasDaBase, MODELO, NOME_DA_ABA, UNIDADES, type Contas, type Leitura } from '../planilha-fichas.js';
import { ehDiretoria, podeAcompanhar, podeConfigurar } from '../rbac.js';
import type { ConfigDoRegem } from '../regem.js';
import { situacaoDoAcesso, type UltimoEnvio } from './acessos.js';
import { leituraParaTela, type LeituraDaLinha } from './regem.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O maior corpo que a importação aceita: as células de uma planilha de loja cabem com folga. */
const MAX_DA_PLANILHA = 8 * 1024 * 1024;
/** Quantos nomes de produto que ficou de fora vão no resumo da lista. */
const QUAIS_DE_FORA = 6;

/** O registro da última importação por planilha, como fica guardado. */
export type Importacao = {
  arquivo: string;
  em: string;
  por: { id: string; nome: string };
  contas: Contas;
  semFicha: Leitura['semFicha'];
  deFora: Leitura['deFora'];
  soltos: Leitura['soltos'];
  problemas: number;
};

/** O nome do arquivo, só para a tela dizer qual foi: sem pasta e sem caractere de controle. */
function nomeDoArquivo(v: unknown): string {
  if (typeof v !== 'string') return '';
  const semPasta = v.split(/[\\/]/).pop() ?? '';
  const visivel = [...semPasta].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('');
  return visivel.trim().slice(0, 120);
}

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
  fonte: 'regem' | 'planilha' | 'sistema' | null;
  impressao: string | null;
  /** O registro da última importação por planilha — ou do último envio de outro sistema (`rotas/acessos.ts`). */
  importacao: Importacao | UltimoEnvio | null;
  /** O acesso de outro sistema que VALE para esta loja (um, no máximo). */
  acesso_id: string | null;
  acesso_nome: string | null;
  acesso_criado_em: Date | null;
  acesso_recebido_em: Date | null;
  acesso_vence_em: Date | null;
  acesso_ultimo_uso_em: Date | null;
  acesso_renovado_em: Date | null;
  acesso_reativado_em: Date | null;
};

export function rotasDeFichas(app: FastifyInstance, pool: pg.Pool, cfg: ConfigDoRegem): void {
  /** `paraBuscar`: a rota MEXE na base (lê a fonte, importa) — é de quem configura, não de quem só vê. */
  async function quem(req: FastifyRequest, resposta: FastifyReply, paraBuscar = false, oQue = 'pede a busca'): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    if (!podeAcompanhar(s)) {
      resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não vê as fichas da loja' });
      return null;
    }
    if (paraBuscar && !podeConfigurar(s)) {
      resposta.status(403).send({ erro: 'sem_permissao', mensagem: `seu perfil vê as fichas, mas quem ${oQue} é quem configura a loja` });
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
              f.produtos, f.com_ficha, f.atualizada_em, f.fonte, f.impressao, f.importacao,
              ${comConteudo ? 'f.conteudo' : 'null::jsonb as conteudo'},
              a.id as acesso_id, a.nome as acesso_nome, a.criado_em as acesso_criado_em, a.recebido_em as acesso_recebido_em,
              a.vence_em as acesso_vence_em, a.ultimo_uso_em as acesso_ultimo_uso_em, a.renovado_em as acesso_renovado_em, a.reativado_em as acesso_reativado_em,
              (select count(*)::int from regem_loja e where e.tenant_id = l.tenant_id and e.loja_id is null) as esperando
         from loja l
         left join regem_loja r on r.loja_id = l.id
         left join fichas_da_loja f on f.loja_id = l.id
         left join acesso_externo a on a.loja_id = l.id and a.revogado_em is null
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
      /** Quem configura a loja pede a busca na hora; a supervisão só vê. */
      podeBuscar: podeConfigurar(s),
      /** Quem configura importa planilha — na loja que não recebe as fichas de outro lugar (uma origem por loja). */
      podeImportar: podeConfigurar(s) && l.conexao_id === null && l.acesso_id === null,
      /** De onde as fichas vieram: `regem`, `planilha` ou `sistema`. Nulo = a loja não tem base. */
      fonte: base ? l.fonte : null,
      /** O sistema que tem acesso para enviar as fichas desta loja (pode ainda não ter enviado nada). Nulo = nenhum. */
      sistema:
        l.acesso_id && l.acesso_criado_em && l.acesso_vence_em
          ? {
              nome: l.acesso_nome,
              criadoEm: l.acesso_criado_em,
              recebidoEm: l.acesso_recebido_em,
              /** `valendo`, `vence` (15 dias antes), `vencido` ou `suspenso`: vencido e suspenso não apagam as fichas. */
              situacao: situacaoDoAcesso({
                criado_em: l.acesso_criado_em,
                renovado_em: l.acesso_renovado_em,
                vence_em: l.acesso_vence_em,
                ultimo_uso_em: l.acesso_ultimo_uso_em,
                reativado_em: l.acesso_reativado_em,
              }),
              venceEm: l.acesso_vence_em,
              /** A última chamada aceita na porta: o suspenso diz desde quando ninguém usa o código. */
              ultimoUsoEm: l.acesso_ultimo_uso_em,
            }
          : null,
      /**
       * A última importação por planilha — ou o último envio do sistema: qual arquivo (a planilha), quando, quem,
       * e quantos produtos ficaram de fora.
       */
      importacao:
        base && (l.fonte === 'planilha' || l.fonte === 'sistema') && l.importacao
          ? {
              arquivo: l.importacao.arquivo,
              em: l.importacao.em,
              por: l.importacao.por.nome,
              deFora: l.importacao.deFora.length,
              /** Os primeiros nomes, para a tela dizer quais — o motivo de cada um fica no registro da importação. */
              quais: l.importacao.deFora.slice(0, QUAIS_DE_FORA).map((d) => d.produto),
              problemas: l.importacao.problemas,
            }
          : null,
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
    const s = await quem(req, resposta, true);
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

  // ─────────────────────── a planilha ───────────────────────

  // O modelo: os títulos das colunas, a lista de unidades e um exemplo
  // pequeno. Sai DAQUI, e não de um arquivo guardado no console, para o
  // modelo que a pessoa baixa ser sempre o que o servidor lê.
  app.get('/v1/fichas/modelo', async (req, resposta) => {
    const s = await quem(req, resposta, true, 'importa a planilha');
    if (!s) return;
    return { abas: MODELO, nomes: NOME_DA_ABA, colunas: COLUNAS, unidades: UNIDADES };
  });

  // Confere a planilha e, com `gravar: true`, importa o que está certo.
  //
  // Sem `gravar`, nada é escrito: é a conferência, que diz o que entraria e
  // o que ficaria de fora, linha por linha. A planilha que não dá para ler
  // (sem a aba Fichas, sem uma coluna obrigatória) é 422, com o motivo.
  app.post('/v1/lojas/:id/fichas/importar', { bodyLimit: MAX_DA_PLANILHA }, async (req, resposta) => {
    const s = await quem(req, resposta, true, 'importa a planilha');
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    const corpo = req.body as { arquivo?: unknown; abas?: unknown; gravar?: unknown } | null;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'envie a planilha' });
    }
    // Liga-desliga é exato: "true" em texto não grava nada por engano.
    if (corpo.gravar !== undefined && typeof corpo.gravar !== 'boolean') {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'gravar: verdadeiro ou falso' });
    }

    const l = await daLoja(s, id, false);
    if (!l) return semLoja(resposta);
    const ocupada = () =>
      resposta.status(409).send({
        erro: 'origem_ocupada',
        mensagem: 'esta loja recebe as fichas do Regem. Uma loja recebe de um lugar só: para importar planilha, desconecte a loja do Regem antes',
      });
    if (l.conexao_id !== null) return ocupada();
    const doSistema = () =>
      resposta.status(409).send({
        erro: 'origem_ocupada',
        mensagem: 'esta loja recebe as fichas de outro sistema. Uma loja recebe de um lugar só: para importar planilha, a diretoria revoga o acesso dele antes, em Conexões',
      });
    if (l.acesso_id !== null) return doSistema();

    const lida = lerPlanilha(corpo.abas);
    if (lida.impede !== null) return resposta.status(422).send({ erro: 'planilha_invalida', mensagem: lida.impede });

    const relatorio = { contas: lida.contas, semFicha: lida.semFicha, deFora: lida.deFora, soltos: lida.soltos, problemas: lida.problemas };
    /** O que a loja tem hoje, e que a importação troca inteiro. Nulo = não tem nada. */
    const troca = l.fonte ? { produtos: l.produtos ?? 0, comFicha: l.com_ficha ?? 0 } : null;
    if (corpo.gravar !== true) return { gravado: false, ...relatorio, troca };

    if (lida.contas.produtos === 0) {
      return resposta.status(422).send({
        erro: 'nada_a_importar',
        mensagem: 'nenhum produto da planilha está certo, e nada foi importado. Corrija o que a lista aponta e envie de novo',
        ...relatorio,
      });
    }

    const impressao = impressaoDaBase(lida.base);
    const importacao: Importacao = { arquivo: nomeDoArquivo(corpo.arquivo), em: new Date().toISOString(), por: { id: s.usuarioId, nome: s.nome }, ...relatorio };
    // A base é trocada INTEIRA, numa instrução só — e só se a loja continua
    // sem ligação com o Regem (alguém pode ter ligado entre a conferência e
    // agora). A data da base só anda se o documento mudou.
    const gravou = await pool.query(
      `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha, atualizada_em, importacao)
       select $1, $2, 'planilha', $3::jsonb, $4, $5, $6, now(), $7::jsonb
        where not exists (select 1 from regem_loja where loja_id = $1)
          and not exists (select 1 from acesso_externo where loja_id = $1 and revogado_em is null)
       on conflict (loja_id) do update
          set tenant_id = excluded.tenant_id, fonte = excluded.fonte, conteudo = excluded.conteudo, impressao = excluded.impressao,
              produtos = excluded.produtos, com_ficha = excluded.com_ficha, importacao = excluded.importacao,
              atualizada_em = case when fichas_da_loja.impressao is distinct from excluded.impressao then now() else fichas_da_loja.atualizada_em end`,
      [id, s.tenantId, JSON.stringify(lida.base), impressao, lida.contas.produtos, lida.contas.comFicha, JSON.stringify(importacao)],
    );
    if ((gravou.rowCount ?? 0) === 0) return ocupada();

    req.log.info({ loja: id, usuario: s.usuarioId, ...lida.contas, deFora: lida.deFora.length, problemas: lida.problemas }, 'fichas: planilha importada');
    return {
      gravado: true,
      /** `atualizada`: as fichas da loja mudaram. `nada_mudou`: a planilha traz o que a loja já tinha. */
      resultado: l.impressao === impressao ? 'nada_mudou' : 'atualizada',
      ...relatorio,
      troca,
    };
  });

  // O registro da última importação, com a lista do que ficou de fora — para
  // quem vai corrigir a planilha depois de fechar a tela.
  app.get('/v1/lojas/:id/fichas/importacao', async (req, resposta) => {
    const s = await quem(req, resposta, true, 'importa a planilha');
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    const l = await daLoja(s, id, false);
    if (!l) return semLoja(resposta);
    if ((l.fonte !== 'planilha' && l.fonte !== 'sistema') || !l.importacao) {
      return resposta.status(404).send({ erro: 'sem_importacao', mensagem: 'esta loja não tem fichas de planilha nem de outro sistema' });
    }
    const i = l.importacao;
    return {
      /** `planilha`: cada problema diz a aba e a linha. `sistema`: diz o caminho no que foi enviado (`onde`). */
      origem: l.fonte,
      arquivo: i.arquivo,
      em: i.em,
      por: i.por.nome,
      contas: i.contas,
      semFicha: i.semFicha,
      deFora: i.deFora,
      soltos: i.soltos,
      problemas: i.problemas,
    };
  });

  // As fichas da loja de volta em planilha, no modelo: para corrigir e
  // importar de novo. Só da base que veio de planilha — a do Regem se muda lá.
  app.get('/v1/lojas/:id/fichas/planilha', async (req, resposta) => {
    const s = await quem(req, resposta, true, 'importa a planilha');
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    const l = await daLoja(s, id, true);
    if (!l) return semLoja(resposta);
    const base = l.fonte === 'planilha' ? lerBase(l.conteudo) : null;
    if (!base) return resposta.status(404).send({ erro: 'sem_importacao', mensagem: 'esta loja não tem fichas de planilha' });
    return { abas: linhasDaBase(base), nomes: NOME_DA_ABA };
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
