// =====================================================================
// A fila da cozinha desce para a loja
// =====================================================================
// A19, fatia 5. O agente da loja pergunta à nuvem a fila da cozinha — o que
// está em produção agora e o que ficou pronto há pouco — e a nuvem a lê do
// Regem com o acesso que a loja deu ao conectar (o escopo `producao.ler`).
// O agente nunca vê esse acesso: ele fica cifrado aqui, como o das fichas.
//
//   GET /v1/agentes/fila-da-cozinha?versao=<a que a loja já tem>
//
// Com o token do agente: a loja sai do token, nunca de um parâmetro. Desce
// a fila no formato do Farol (`fila-da-cozinha.ts`) com a versão DELA — a
// impressão do que desce, e não a do Regem: lá a versão muda quando muda o
// que não desce (o id da variação), e a loja baixaria a mesma fila à toa.
// Com a versão que a loja já tem, a resposta é só "nada mudou".
//
// UMA LEITURA DO REGEM POR LOJA A CADA 15 SEGUNDOS. O Regem aceita 60
// chamadas por minuto por acesso, somando as três leituras (cardápio, fichas
// e fila), e sugere ler a fila de 15 em 15 segundos. A última leitura de
// cada loja fica na memória: quem pergunta dentro dos 15 s recebe a mesma,
// e duas perguntas ao mesmo tempo esperam a MESMA leitura. Uma falha fica
// guardada por 30 s — o Regem fora do ar não recebe uma chamada a cada
// pergunta. Cada réplica da API tem a sua memória: com N réplicas, até N
// leituras por loja a cada 15 s.
//
// Toda resposta diz em quantos segundos perguntar de novo (`esperarS`): a
// nuvem regula o ritmo da loja sem pacote novo.
//
// O que pode dar errado (o contrato é `contratos/fila-da-cozinha.json`):
//   404 sem_regem    a loja não está ligada ao Regem, ou o acesso foi
//                    tirado lá;
//   409 sem_escopo   ligada, mas a autorização não inclui a fila: é preciso
//                    conectar de novo no console;
//   502 regem_fora   o Regem não respondeu, ou respondeu fora do contrato;
//   503 sem_chave    esta instalação não tem a chave que abre o acesso.
// =====================================================================

import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import { decifrar } from '../cifra.js';
import { filaParaOAgente, versaoDaFila, type FilaDaCozinha } from '../fila-da-cozinha.js';
import { lerEmSegundoPlano } from '../leitura.js';
import { contextoDoAcesso, ErroDoRegem, lerRetrato, type ConfigDoRegem } from '../regem.js';

/** Os tempos da fila, em milissegundos. */
export const FILA = {
  /** Quanto uma leitura do Regem vale para todas as perguntas da loja. */
  frescorMs: 15_000,
  /** Depois de uma falha, quanto esperar para perguntar ao Regem de novo. */
  esperaDaFalhaMs: 30_000,
  /** A loja sem leitura há este tempo sai da memória (quem pergunta é lido de novo a cada 15 ou 30 s). */
  esqueceMs: 10 * 60_000,
  /** De quanto em quanto tempo se procura quem sair da memória. */
  faxinaMs: 60_000,
};

const VERSAO = /^[0-9a-f]{64}$/;

type Lida = {
  /** A conexão (e a loja de lá) da leitura: a versão do Regem só vale para ela. */
  conexao: string;
  versaoDoRegem: string;
  versao: string;
  fila: FilaDaCozinha;
  lidaEm: Date;
};
type Falha = { status: 404 | 409 | 502; erro: string; mensagem: string; esperarS: number };
type Resultado = { lida: Lida } | { falha: Falha };

const SEM_REGEM: Falha = {
  status: 404,
  erro: 'sem_regem',
  mensagem: 'esta loja não está ligada ao Regem, ou o acesso dela foi tirado lá',
  esperarS: 600,
};
const SEM_ESCOPO: Falha = {
  status: 409,
  erro: 'sem_escopo',
  mensagem: 'a autorização desta loja no Regem não inclui a fila da cozinha. Conecte a loja de novo no console',
  esperarS: 600,
};
const REGEM_FORA: Falha = {
  status: 502,
  erro: 'regem_fora',
  mensagem: 'o Farol não conseguiu ler a fila no Regem agora',
  esperarS: FILA.esperaDaFalhaMs / 1000,
};

export function rotasDaFilaDaCozinha(app: FastifyInstance, pool: pg.Pool, cfg: ConfigDoRegem): void {
  /** loja → a última pergunta ao Regem, quando foi, e a última leitura que deu certo (para perguntar "mudou?"). */
  const guardado = new Map<string, { resultado: Resultado; em: number; lida: Lida | null }>();
  /** loja → a leitura em curso: quem chega no meio espera esta. */
  const emCurso = new Map<string, Promise<Resultado>>();
  let faxinaEm = 0;

  async function lerDoRegem(chave: Buffer, lojaId: string, anterior: Lida | null, log: FastifyBaseLogger): Promise<Resultado> {
    const { rows } = await pool.query<{ id: string; tenant_id: string; regem_loja_id: string; acesso_cifrado: string }>(
      'select id, tenant_id, regem_loja_id, acesso_cifrado from regem_loja where loja_id = $1 and acesso_tirado_em is null',
      [lojaId],
    );
    const linha = rows[0];
    if (!linha) return { falha: SEM_REGEM };
    const conexao = `${linha.id}:${linha.regem_loja_id}`;
    const acesso = decifrar(linha.acesso_cifrado, chave, contextoDoAcesso(linha.tenant_id, linha.regem_loja_id));
    if (!acesso) {
      log.error({ regemLoja: linha.id }, 'fila da cozinha: o acesso guardado não abre com a chave desta instalação');
      return { falha: REGEM_FORA };
    }
    const tenho = anterior && anterior.conexao === conexao ? anterior : null;
    try {
      const r = await lerRetrato(cfg, acesso, 'producao', tenho?.versaoDoRegem ?? null);
      if (!r.mudou) {
        // Só responde "nada mudou" quem perguntou com versão — e só pergunta quem tem a leitura de antes.
        if (!tenho) return { falha: REGEM_FORA };
        return { lida: { ...tenho, versaoDoRegem: r.versao, lidaEm: new Date() } };
      }
      const fila = filaParaOAgente(r.corpo);
      if (!fila) {
        log.warn({ regemLoja: linha.id }, 'fila da cozinha: o Regem respondeu fora do contrato');
        return { falha: REGEM_FORA };
      }
      if (fila.foraDoFormato > 0) {
        log.warn({ regemLoja: linha.id, foraDoFormato: fila.foraDoFormato }, 'fila da cozinha: pedidos ou itens fora do contrato ficaram de fora');
      }
      return { lida: { conexao, versaoDoRegem: r.versao, versao: versaoDaFila(fila), fila, lidaEm: new Date() } };
    } catch (e) {
      if (!(e instanceof ErroDoRegem)) throw e;
      if (e.motivo === 'acesso_tirado') {
        // O que fazer quando o acesso cai é a regra da leitura das fichas (a base sai na hora): ela confirma
        // com a chamada dela e aplica. A fila só avisa.
        log.warn({ regemLoja: linha.id }, 'fila da cozinha: o Regem disse que o acesso da loja não vale mais');
        lerEmSegundoPlano(pool, cfg, [linha.id], log);
        return { falha: SEM_REGEM };
      }
      if (e.motivo === 'recusado' && e.status === 403) {
        log.warn({ regemLoja: linha.id }, 'fila da cozinha: a autorização da loja não tem o escopo da fila (producao.ler)');
        return { falha: SEM_ESCOPO };
      }
      log.warn({ regemLoja: linha.id, motivo: e.motivo, status: e.status }, 'fila da cozinha: a leitura no Regem falhou');
      return { falha: REGEM_FORA };
    }
  }

  function faxina(agora: number): void {
    if (agora - faxinaEm < FILA.faxinaMs) return;
    faxinaEm = agora;
    for (const [loja, g] of guardado) if (agora - g.em > FILA.esqueceMs) guardado.delete(loja);
  }

  function filaDaLoja(chave: Buffer, lojaId: string, log: FastifyBaseLogger): Promise<Resultado> {
    const agora = Date.now();
    faxina(agora);
    const g = guardado.get(lojaId);
    if (g) {
      const vale = 'falha' in g.resultado ? FILA.esperaDaFalhaMs : FILA.frescorMs;
      if (agora - g.em < vale) return Promise.resolve(g.resultado);
    }
    const jaLendo = emCurso.get(lojaId);
    if (jaLendo) return jaLendo;
    const leitura = (async () => {
      try {
        const resultado = await lerDoRegem(chave, lojaId, g?.lida ?? null, log);
        // A falha de passagem não apaga a leitura boa de antes: a próxima pergunta "mudou?" ainda usa a versão dela.
        const lida = 'lida' in resultado ? resultado.lida : resultado.falha === REGEM_FORA ? (g?.lida ?? null) : null;
        guardado.set(lojaId, { resultado, em: Date.now(), lida });
        return resultado;
      } finally {
        emCurso.delete(lojaId);
      }
    })();
    emCurso.set(lojaId, leitura);
    return leitura;
  }

  app.get('/v1/agentes/fila-da-cozinha', async (req, resposta) => {
    let agente;
    try {
      agente = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial recusada na fila da cozinha');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }
    // Para LER basta a chave que abre o acesso guardado (o segredo do aplicativo é só para conectar).
    if (cfg.chave === null) {
      req.log.error('fila da cozinha: falta a chave dos acessos nesta instalação');
      return resposta.status(503).send({
        erro: 'sem_chave',
        mensagem: 'a conexão com o Regem não está disponível nesta instalação',
        esperarS: SEM_REGEM.esperarS,
      });
    }

    const r = await filaDaLoja(cfg.chave, agente.lojaId, req.log);
    resposta.header('cache-control', 'no-store');
    if ('falha' in r) {
      const { status, ...corpo } = r.falha;
      return resposta.status(status).send(corpo);
    }
    const { lida } = r;
    const versao = (req.query as { versao?: unknown }).versao;
    const lidaEm = lida.lidaEm.toISOString();
    const esperarS = FILA.frescorMs / 1000;
    if (typeof versao === 'string' && VERSAO.test(versao) && versao === lida.versao) {
      return { versao: lida.versao, atualizado: false, lidaEm, esperarS };
    }
    return { versao: lida.versao, atualizado: true, lidaEm, geradoEm: lida.fila.geradoEm, esperarS, pedidos: lida.fila.pedidos };
  });
}
