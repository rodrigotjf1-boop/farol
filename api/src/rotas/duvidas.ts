// =====================================================================
// POST /v1/agentes/duvidas — o balcão: a dúvida passa pelo nosso servidor
// =====================================================================
// O agente tem uma imagem que só um modelo de fora sabe julgar. Em vez de
// perguntar por conta própria — com a chave e as instruções na loja —, ele
// entrega a dúvida aqui: as imagens e de que critério, canal e área ela é.
// O servidor monta a pergunta (`balcao/pedido.ts`), pergunta à plataforma
// com a conta DA LOJA (`balcao/plataforma.ts`) e devolve o veredito.
//
// **Só para loja ligada** (`loja.duvida_pelo_servidor`, que é da
// distribuição). Desligada, a rota recusa, e o agente pergunta como sempre
// perguntou.
//
// O caminho de uma dúvida, na ordem:
//
//   1. quem pergunta        o agente, pelo token dele; a loja sai dali
//   2. o corpo              campo que não é o esperado é recusado
//   3. a loja está ligada?
//   4. a dúvida é repetida? a que já foi respondida recebe a resposta
//                           guardada, e não é paga de novo
//   5. a configuração       tem de ser a que a loja tem em mãos (a versão), e
//                           o critério, o que ela conferiu (a versão dele)
//   6. o pedido             montado aqui; o que nunca vai para fora é recusado
//   7. a reserva            sob a trava da loja: o limite por minuto e o TETO
//                           DO DIA, antes de perguntar
//   8. a pergunta           à plataforma, sem conexão com o banco na mão
//   9. o registro           o veredito e o custo — ou de que lado foi o erro
//
// **O teto não é passado nem por uma pergunta.** Cada dúvida em voo segura
// do teto o pior caso dela (`reservaDeUmaDuvida`); quando a resposta chega,
// a reserva vira o custo de verdade.
//
// **Nenhuma imagem é guardada, e o corpo não vai para o registro.** O
// servidor recebe as imagens, repassa à plataforma e esquece. Fica a linha
// em `duvida` (migration 045): de quem, de que critério, o veredito e o
// custo.
//
// O formato do corpo e das respostas é `contratos/duvida-do-agente.json`.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import {
  conteudoDoPedido,
  type ConfiguracaoDaLoja, type Imagem, type ImagensDaDuvida, type ItemDaDuvida,
} from '../balcao/pedido.js';
import {
  ErroDaPlataforma, perguntar, reservaDeUmaDuvida,
  type ClasseDoErro, type Transporte, type Veredito,
} from '../balcao/plataforma.js';
import { contaDeIaDaLoja } from './balcao.js';
import { configuracaoDaLoja } from './configuracao.js';
import { sqlDoDiaDaOperacao } from './especialista.js';

/** O corpo leva até três imagens em base64. */
export const MAX_DO_CORPO = 12 * 1024 * 1024;
/** Cada imagem, já em base64. A imagem a auditar vai na resolução da câmera. */
export const MAX_DA_IMAGEM = 6 * 1024 * 1024;
const TIPOS_DE_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Quantas dúvidas uma loja faz por minuto. Não é teto de gasto: é a válvula
 * contra o agente que disparou. (O agente pergunta no máximo dez por volta
 * do laço dele.)
 */
export const MAX_POR_MINUTO = 30;

/**
 * Depois disto, a dúvida que ficou "perguntando" é tida como perdida — o
 * servidor caiu no meio — e pode ser tentada de novo. É mais do que duas
 * chamadas no limite de tempo delas.
 */
export const DUVIDA_PERDIDA_APOS_S = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE = /^[0-9a-f]{32}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// ─────────────────────── o corpo ───────────────────────

export type DuvidaLida = {
  chave: string;
  configVersao: number;
  regraId: string;
  criterioVersao: number;
  pontoId: string;
  zonaId: string;
  foraDaArea: boolean;
  imagem: Imagem;
  mapa: { tipo: 'esquema' | 'foto'; imagem: Imagem } | null;
  fotoPadrao: { id: string; imagem: Imagem } | null;
};

type Objeto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v);
const sobra = (o: Objeto, aceitos: string[]): string | null => Object.keys(o).find((k) => !aceitos.includes(k)) ?? null;
const inteiroDe1 = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

function lerImagem(bruto: unknown, onde: string): Imagem | string {
  if (!ehObjeto(bruto)) return `${onde}: mande { tipo, dados }`;
  const estranho = sobra(bruto, ['tipo', 'dados']);
  if (estranho) return `${onde}: campo desconhecido '${estranho}'`;
  if (typeof bruto.tipo !== 'string' || !TIPOS_DE_IMAGEM.includes(bruto.tipo)) return `${onde}.tipo: um de ${TIPOS_DE_IMAGEM.join(', ')}`;
  const { dados } = bruto;
  if (typeof dados !== 'string' || dados.length === 0) return `${onde}.dados: a imagem, em base64`;
  if (dados.length > MAX_DA_IMAGEM) return `${onde}.dados: no máximo ${MAX_DA_IMAGEM} caracteres`;
  if (dados.length % 4 !== 0 || !BASE64.test(dados)) return `${onde}.dados: não é base64`;
  return { tipo: bruto.tipo, dados };
}

/** Lê o corpo da dúvida. `problema` nunca repete o que veio: as imagens não vão para mensagem de erro. */
export function lerDuvida(bruto: unknown): DuvidaLida | { problema: string } {
  if (!ehObjeto(bruto)) return { problema: 'mande um objeto' };
  const estranho = sobra(bruto, ['chave', 'configVersao', 'regraId', 'criterioVersao', 'pontoId', 'zonaId', 'foraDaArea', 'imagem', 'mapa', 'fotoPadrao']);
  if (estranho) return { problema: `campo desconhecido: '${estranho}'` };

  const { chave, configVersao, regraId, criterioVersao, pontoId, zonaId, foraDaArea } = bruto;
  if (typeof chave !== 'string' || !CHAVE.test(chave)) return { problema: 'chave: 32 letras de 0 a 9 e de a a f' };
  if (!inteiroDe1(configVersao)) return { problema: 'configVersao: um inteiro de 1 em diante' };
  if (!inteiroDe1(criterioVersao)) return { problema: 'criterioVersao: um inteiro de 1 em diante' };
  for (const [nome, valor] of [['regraId', regraId], ['pontoId', pontoId], ['zonaId', zonaId]] as const) {
    if (typeof valor !== 'string' || !UUID.test(valor)) return { problema: `${nome}: um id` };
  }
  if (typeof foraDaArea !== 'boolean') return { problema: 'foraDaArea: true ou false' };

  const imagem = lerImagem(bruto.imagem, 'imagem');
  if (typeof imagem === 'string') return { problema: imagem };

  let mapa: DuvidaLida['mapa'] = null;
  if (bruto.mapa !== null && bruto.mapa !== undefined) {
    if (!ehObjeto(bruto.mapa)) return { problema: 'mapa: mande { tipo, imagem } ou nulo' };
    const outro = sobra(bruto.mapa, ['tipo', 'imagem']);
    if (outro) return { problema: `mapa: campo desconhecido '${outro}'` };
    if (bruto.mapa.tipo !== 'esquema' && bruto.mapa.tipo !== 'foto') return { problema: 'mapa.tipo: esquema ou foto' };
    const doMapa = lerImagem(bruto.mapa.imagem, 'mapa.imagem');
    if (typeof doMapa === 'string') return { problema: doMapa };
    mapa = { tipo: bruto.mapa.tipo, imagem: doMapa };
  }

  let fotoPadrao: DuvidaLida['fotoPadrao'] = null;
  if (bruto.fotoPadrao !== null && bruto.fotoPadrao !== undefined) {
    if (!ehObjeto(bruto.fotoPadrao)) return { problema: 'fotoPadrao: mande { id, imagem } ou nulo' };
    const outro = sobra(bruto.fotoPadrao, ['id', 'imagem']);
    if (outro) return { problema: `fotoPadrao: campo desconhecido '${outro}'` };
    if (typeof bruto.fotoPadrao.id !== 'string' || !UUID.test(bruto.fotoPadrao.id)) return { problema: 'fotoPadrao.id: um id' };
    const daFoto = lerImagem(bruto.fotoPadrao.imagem, 'fotoPadrao.imagem');
    if (typeof daFoto === 'string') return { problema: daFoto };
    fotoPadrao = { id: bruto.fotoPadrao.id, imagem: daFoto };
  }

  return {
    chave, configVersao, regraId: regraId as string, criterioVersao, pontoId: pontoId as string, zonaId: zonaId as string,
    foraDaArea, imagem, mapa, fotoPadrao,
  };
}

// ─────────────────────── o registro ───────────────────────

type Guardada = {
  id: string;
  estado: 'perguntando' | 'respondida' | 'falhou';
  perdida: boolean;
  resultado: string | null;
  confianca: number | null;
  motivo: string | null;
  modelo: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  custo_centavos: number | null;
  latencia_ms: number | null;
  reconsultou: boolean;
};

const DA_GUARDADA = `id, estado, resultado, confianca, motivo, modelo, tokens_entrada, tokens_saida, custo_centavos,
       latencia_ms, reconsultou, tentada_em < now() - make_interval(secs => $3) as perdida`;

/** O que volta para o agente: o veredito, quanto custou e quanto demorou. */
const aResposta = (v: Veredito, latenciaMs: number | null, reconsultou: boolean, repetida: boolean) => ({
  resultado: v.resultado,
  confianca: v.confianca,
  motivo: v.motivo,
  modelo: v.modelo,
  tokensEntrada: v.tokensEntrada,
  tokensSaida: v.tokensSaida,
  custoCentavos: v.custoCentavos,
  latenciaMs,
  reconsultou,
  // A resposta saiu do que estava guardado: esta dúvida já tinha sido feita, e não foi paga de novo.
  repetida,
});

const daGuardada = (g: Guardada) =>
  aResposta(
    {
      resultado: g.resultado as Veredito['resultado'], confianca: g.confianca, motivo: g.motivo, modelo: g.modelo ?? '',
      tokensEntrada: g.tokens_entrada, tokensSaida: g.tokens_saida, custoCentavos: g.custo_centavos,
    },
    g.latencia_ms, g.reconsultou, true,
  );

type Recusa = 'desligado' | 'em_andamento' | 'limite' | 'teto';
type Reserva =
  | { tipo: 'reservada'; id: string }
  | { tipo: 'repetida'; guardada: Guardada }
  | { tipo: 'desligado' }
  | { tipo: 'em_andamento' }
  | { tipo: 'limite' }
  | { tipo: 'teto' };

/**
 * A reserva, sob a trava da loja: uma dúvida de cada vez passa por aqui, e é
 * aqui que o limite por minuto e o teto do dia são conferidos. A trava dura
 * estas poucas instruções — nunca a chamada à plataforma.
 */
async function reservar(
  pool: pg.Pool,
  quem: { agenteId: string; lojaId: string; tenantId: string },
  duvida: DuvidaLida,
  provedor: string,
  reserva: number,
): Promise<Reserva> {
  // Client dedicado: a trava da loja e as conferências só valem na MESMA conexão.
  const cliente = await pool.connect();
  try {
    await cliente.query('begin');
    const sair = async (tipo: Recusa): Promise<Reserva> => {
      await cliente.query('rollback');
      return { tipo } as Reserva;
    };

    // A trava numa instrução, as conferências nas seguintes: na mesma, quem esperou a trava
    // conferiria com o retrato de antes da espera (a dúvida que acabou de reservar ao lado).
    const trava = await cliente.query('select id from loja where id = $1 for no key update', [quem.lojaId]);
    if (trava.rows.length === 0) return await sair('desligado');
    const loja = (
      await cliente.query<{ ligado: boolean; teto: number; dia: string }>(
        `select duvida_pelo_servidor as ligado, teto_duvida_centavos_dia as teto,
                ${sqlDoDiaDaOperacao('now()', 'timezone')} as dia
           from loja where id = $1`,
        [quem.lojaId],
      )
    ).rows[0]!;
    // Desligaram o balcão enquanto esta dúvida vinha: não pergunta.
    if (!loja.ligado) return await sair('desligado');

    const guardada = (
      await cliente.query<Guardada>(`select ${DA_GUARDADA} from duvida where loja_id = $1 and chave = $2`, [
        quem.lojaId, duvida.chave, DUVIDA_PERDIDA_APOS_S,
      ])
    ).rows[0];
    if (guardada?.estado === 'respondida') {
      await cliente.query('rollback');
      return { tipo: 'repetida', guardada };
    }
    // A mesma dúvida está sendo perguntada agora por outra chamada: não se paga duas vezes.
    if (guardada?.estado === 'perguntando' && !guardada.perdida) return await sair('em_andamento');

    // O que as OUTRAS dúvidas da loja já seguram: as do último minuto, e o gasto do dia — o custo
    // de verdade das respondidas e a reserva das que estão em voo. A que falhou não segura nada.
    const conta = (
      await cliente.query<{ no_minuto: number; do_dia: number }>(
        `select count(*) filter (where tentada_em > now() - interval '60 seconds')::int as no_minuto,
                coalesce(sum(coalesce(custo_centavos, reservado_centavos))
                           filter (where dia = $2::date and estado <> 'falhou'), 0)::float8 as do_dia
           from duvida
          where loja_id = $1 and id is distinct from $3
            and (dia = $2::date or tentada_em > now() - interval '60 seconds')`,
        [quem.lojaId, loja.dia, guardada?.id ?? null],
      )
    ).rows[0]!;
    if (conta.no_minuto >= MAX_POR_MINUTO) return await sair('limite');
    if (conta.do_dia + reserva > loja.teto) return await sair('teto');

    let id: string;
    if (guardada) {
      // A dúvida que falhou, ou que ficou perdida: a mesma linha é tentada de novo.
      id = guardada.id;
      await cliente.query(
        `update duvida
            set estado = 'perguntando', falha = null, tentativas = tentativas + 1, tentada_em = now(),
                dia = $2::date, reservado_centavos = $3, config_versao = $4, criterio_versao = $5,
                agente_id = $6, provedor = $7
          where id = $1`,
        [id, loja.dia, reserva, duvida.configVersao, duvida.criterioVersao, quem.agenteId, provedor],
      );
    } else {
      id = (
        await cliente.query<{ id: string }>(
          `insert into duvida (tenant_id, loja_id, agente_id, chave, regra_id, criterio_versao, ponto_id, zona_id,
                               config_versao, dia, estado, reservado_centavos, provedor)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, 'perguntando', $11, $12)
           returning id`,
          [
            quem.tenantId, quem.lojaId, quem.agenteId, duvida.chave, duvida.regraId, duvida.criterioVersao,
            duvida.pontoId, duvida.zonaId, duvida.configVersao, loja.dia, reserva, provedor,
          ],
        )
      ).rows[0]!.id;
    }
    await cliente.query('commit');
    return { tipo: 'reservada', id };
  } catch (e) {
    await cliente.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    cliente.release();
  }
}

// ─────────────────────── a rota ───────────────────────

/** O que dizer a quem perguntou, conforme de que lado foi o erro. Nunca o que a plataforma escreveu. */
const DO_ERRO: Record<ClasseDoErro, string> = {
  conta: 'a plataforma recusou a conta de IA desta loja',
  pedido: 'a plataforma recusou o pedido',
  limite: 'a plataforma está segurando os pedidos desta conta',
  plataforma: 'a plataforma não respondeu',
  resposta: 'a plataforma respondeu de um jeito que não deu para ler',
};

export function rotasDeDuvidas(
  app: FastifyInstance,
  pool: pg.Pool,
  opcoes: { cofre: Buffer | null; enviar: Transporte; dolar: number },
): void {
  app.post('/v1/agentes/duvidas', { bodyLimit: MAX_DO_CORPO }, async (req, resposta) => {
    let quem;
    try {
      quem = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial recusada na dúvida');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const duvida = lerDuvida(req.body);
    if ('problema' in duvida) return resposta.status(422).send({ erro: 'validacao', mensagem: duvida.problema });

    const desligado = () =>
      resposta.status(409).send({ erro: 'balcao_desligado', mensagem: 'esta loja não pergunta pelo servidor' });

    const loja = await pool.query<{ ligado: boolean }>('select duvida_pelo_servidor as ligado from loja where id = $1', [quem.lojaId]);
    if (loja.rows[0]?.ligado !== true) return desligado();

    // A dúvida que já foi respondida recebe a resposta guardada — mesmo que a configuração tenha mudado
    // depois: a pergunta foi feita, e paga, com a de então.
    const jaFeita = await pool.query<Guardada>(`select ${DA_GUARDADA} from duvida where loja_id = $1 and chave = $2`, [
      quem.lojaId, duvida.chave, DUVIDA_PERDIDA_APOS_S,
    ]);
    if (jaFeita.rows[0]?.estado === 'respondida') return daGuardada(jaFeita.rows[0]);

    // A configuração, como o agente DESTA loja a recebeu (o que ele declarou saber decide o que desce).
    const sabe = await pool.query<{ sabe: string[] | null }>('select sabe from agente where id = $1', [quem.agenteId]);
    const configuracao = await configuracaoDaLoja(pool, quem.lojaId, new Set(sabe.rows[0]?.sabe ?? []));
    if (configuracao === null) return desligado();
    if (configuracao.versao !== duvida.configVersao) {
      return resposta.status(409).send({
        erro: 'configuracao_mudou',
        mensagem: 'a configuração da loja não é a desta dúvida: puxe a configuração e pergunte de novo',
        configVersao: configuracao.versao,
      });
    }

    // O critério, como o servidor o guarda: o texto dele não vem da loja.
    type DaConfiguracao = { id: string; zonas: { id: string; regras: { id: string; criterio: string; criterioVersao: number }[] }[] };
    const criterio = (configuracao.pontos as unknown as DaConfiguracao[])
      .find((p) => p.id === duvida.pontoId)
      ?.zonas.find((z) => z.id === duvida.zonaId)
      ?.regras.find((r) => r.id === duvida.regraId);
    const semPedido = (motivo: string) => resposta.status(422).send({ erro: 'sem_pedido', motivo });
    if (!criterio) return semPedido('criterio_fora_da_configuracao');
    if (criterio.criterioVersao !== duvida.criterioVersao) {
      return resposta.status(409).send({
        erro: 'criterio_mudou',
        mensagem: 'o critério mudou depois desta olhada: a dúvida não vale mais',
        criterioVersao: criterio.criterioVersao,
      });
    }

    const item: ItemDaDuvida = {
      pontoId: duvida.pontoId, zonaId: duvida.zonaId, regraId: duvida.regraId, criterio: criterio.criterio,
      foraDaArea: duvida.foraDaArea, mapa: duvida.mapa?.tipo ?? null, fotoPadrao: duvida.fotoPadrao?.id ?? null,
    };
    const imagens: ImagensDaDuvida = { auditada: duvida.imagem, mapa: duvida.mapa?.imagem ?? null, padrao: duvida.fotoPadrao?.imagem ?? null };
    const montagem = conteudoDoPedido(configuracao as unknown as ConfiguracaoDaLoja, item, imagens);
    if (montagem.semPedido) return semPedido(montagem.semPedido);

    const conta = await contaDeIaDaLoja(pool, opcoes.cofre, quem.lojaId);
    if (conta === null) {
      // Ligada e sem conta que abra: o cofre do servidor mudou, ou a linha foi mexida por fora.
      req.log.error({ loja: quem.lojaId }, 'balcão ligado e sem conta de IA que abra');
      return resposta.status(503).send({ erro: 'sem_conta_de_ia', mensagem: 'o servidor não tem a conta de IA desta loja' });
    }

    const reserva = await reservar(pool, quem, duvida, conta.provedor, reservaDeUmaDuvida(opcoes.dolar));
    if (reserva.tipo === 'repetida') return daGuardada(reserva.guardada);
    if (reserva.tipo === 'desligado') return desligado();
    if (reserva.tipo === 'em_andamento') {
      return resposta.status(409).send({ erro: 'em_andamento', mensagem: 'esta dúvida já está sendo perguntada' });
    }
    if (reserva.tipo === 'limite') {
      return resposta.status(429).header('retry-after', '60').send({ erro: 'limite_por_minuto', mensagem: `no máximo ${MAX_POR_MINUTO} dúvidas por minuto` });
    }
    if (reserva.tipo === 'teto') {
      req.log.warn({ loja: quem.lojaId }, 'teto do dia: a dúvida não foi perguntada');
      return resposta.status(429).send({ erro: 'teto_do_dia', mensagem: 'o teto de gasto de hoje desta loja foi alcançado' });
    }

    const inicio = Date.now();
    try {
      const { veredito, chamadas } = await perguntar({ chave: conta.chave, conteudo: montagem.conteudo, enviar: opcoes.enviar, dolar: opcoes.dolar });
      const latenciaMs = Date.now() - inicio;
      // A resposta é do modelo forte? (A reconsulta que falha não conta: ficou a resposta do de rotina.)
      const reconsultou = veredito.modelo !== chamadas[0];
      await pool.query(
        `update duvida
            set estado = 'respondida', modelo = $2, reconsultou = $3, resultado = $4, confianca = $5, motivo = $6,
                tokens_entrada = $7, tokens_saida = $8, custo_centavos = $9, latencia_ms = $10, respondida_em = now()
          where id = $1`,
        [
          reserva.id, veredito.modelo, reconsultou, veredito.resultado, veredito.confianca, veredito.motivo,
          veredito.tokensEntrada, veredito.tokensSaida, veredito.custoCentavos, latenciaMs,
        ],
      );
      // Quem, de que critério, o resultado e o custo — nunca a imagem, nem o pedido.
      req.log.info(
        { loja: quem.lojaId, regra: duvida.regraId, zona: duvida.zonaId, resultado: veredito.resultado, modelo: veredito.modelo, custoCentavos: veredito.custoCentavos, ms: latenciaMs, reconsultou },
        'dúvida respondida',
      );
      return aResposta(veredito, latenciaMs, reconsultou, false);
    } catch (e) {
      if (!(e instanceof ErroDaPlataforma)) throw e;
      await pool.query(`update duvida set estado = 'falhou', falha = $2, latencia_ms = $3 where id = $1`, [reserva.id, e.classe, Date.now() - inicio]);
      // O que a plataforma disse fica no registro do servidor (não leva a chave); a loja recebe só de que lado foi.
      req.log.warn({ loja: quem.lojaId, regra: duvida.regraId, classe: e.classe, status: e.status, erro: e.message }, 'dúvida sem veredito');
      return resposta.status(502).send({ erro: 'sem_veredito', classe: e.classe, recuperavel: e.recuperavel, mensagem: DO_ERRO[e.classe] });
    }
  });
}
