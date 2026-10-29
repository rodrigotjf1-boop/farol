// =====================================================================
// As pessoas na planta (A26, P3; migration 058)
// =====================================================================
//   POST /v1/planta-viva/minutos      o agente: os minutos fechados, em lote
//   GET  /v1/lojas/:id/planta-viva    quem acompanha a loja: o calor, os postos e a média por hora do período;
//                                     os caminhos (replay) só num trecho de até 60 min e só para quem configura
//   POST /v1/planta-viva/agora        o agente: as pessoas do instante (P6); a resposta diz se alguém olha
//   GET  /v1/lojas/:id/planta-viva/agora   a tela "Ao vivo": a última posição de cada pessoa — só para quem
//                                     configura (é o caminho de cada um, como o replay)
//   GET  /v1/lojas/:id/planta-viva/atendimento   a aba "Atendimento" (28/10/2026): a espera em cada área de medida e
//                                     quem entra e sai por cada porta — agregado, para quem acompanha a loja
//
// A guarda é curta: no envio, os caminhos com mais de 7 dias são apagados e o minuto inteiro com mais de 90. O ao vivo
// não vai ao banco: a última posição de cada loja fica na memória desta API, por 30 s. ⚠️ Vale enquanto a API roda
// numa instância só (o EasyPanel de hoje); com duas, o agente e a tela podem cair em instâncias diferentes — aí a
// última posição vai para um lugar comum (Redis, ou uma tabela sem log).
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { ATENDIMENTO, atendimentoDoPeriodo, type MinutoComCaminhos } from '../atendimento.js';
import { autenticarAgente, ErroDeAuth } from '../auth.js';
import {
  AO_VIVO,
  LIMITES_DA_PLANTA_VIVA as L,
  caminhosDoTrecho,
  calorDoPeriodo,
  lerAgoraDaPlanta,
  lerMinutoDaPlanta,
  porHora,
  postosDoPeriodo,
  situacaoAoVivo,
  type AgoraDaPlanta,
  type MinutoDaPlanta,
  type MinutoGuardado,
} from '../planta-viva.js';
import { podeAcompanhar, podeConfigurar } from '../rbac.js';
import { plantaDaLoja } from './planta.js';
import { sessaoDe } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i;

export function rotasDaPlantaViva(app: FastifyInstance, pool: pg.Pool, relogio: () => number = Date.now): void {
  // o ao vivo de cada loja: a última posição (e quando chegou) e até quando alguém olha a tela
  const aoVivo = new Map<string, { agora: AgoraDaPlanta; recebidoEm: number }>();
  const olhandoAte = new Map<string, number>();

  app.post('/v1/planta-viva/agora', async (req, resposta) => {
    let autor;
    try {
      autor = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'agente recusado');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }
    const lido = lerAgoraDaPlanta(req.body);
    if (lido.problema) return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
    const agora = relogio();
    aoVivo.set(autor.lojaId, { agora: lido.agora!, recebidoEm: agora });
    // o que ficou para trás (loja que fechou, agente desligado) sai da memória
    for (const [loja, g] of aoVivo) if (agora - g.recebidoEm > AO_VIVO.validadeMs) aoVivo.delete(loja);
    for (const [loja, ate] of olhandoAte) if (ate < agora) olhandoAte.delete(loja);
    return { olhando: (olhandoAte.get(autor.lojaId) ?? 0) > agora };
  });

  app.get('/v1/lojas/:id/planta-viva/agora', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    const { id } = req.params as { id: string };
    if (!UUID.test(id) || (await pool.query('select 1 from loja where id = $1 and tenant_id = $2', [id, s.tenantId])).rowCount !== 1) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'loja não encontrada' });
    }
    if (!podeConfigurar(s)) {
      return resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'o movimento ao vivo é só para quem configura a loja' });
    }
    const agora = relogio();
    olhandoAte.set(id, agora + AO_VIVO.olhandoMs);
    const g = aoVivo.get(id);
    const situacao = situacaoAoVivo(g?.recebidoEm, agora);
    const vale = g !== undefined && situacao !== 'sem_sinal';
    return {
      situacao,
      /** Há quantos segundos a nuvem recebeu a última posição (nulo = nunca, ou faz tempo). */
      idadeS: vale ? Math.round((agora - g.recebidoEm) / 100) / 10 : null,
      quando: vale ? g.agora.quando : null,
      pessoas: vale ? g.agora.pessoas : [],
      canais: vale ? g.agora.canais : [],
    };
  });

  app.post('/v1/planta-viva/minutos', async (req, resposta) => {
    let autor;
    try {
      autor = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'agente recusado');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }
    const corpo = req.body as { minutos?: unknown };
    if (!Array.isArray(corpo?.minutos)) return resposta.status(400).send({ erro: 'corpo_invalido', mensagem: 'esperado { minutos: [...] }' });
    if (corpo.minutos.length > L.porLote) return resposta.status(413).send({ erro: 'lote_grande', mensagem: `máximo ${L.porLote} minutos por requisição` });
    const agora = new Date();
    const lidos: MinutoDaPlanta[] = [];
    const problemas: string[] = [];
    for (const [i, m] of corpo.minutos.entries()) {
      const r = lerMinutoDaPlanta(m, `minutos[${i}]`, agora);
      if (r.problema) problemas.push(r.problema);
      else lidos.push(r.minuto!);
    }
    if (problemas.length) return resposta.status(422).send({ erro: 'validacao', problemas });
    if (lidos.length === 0) return { aceitos: 0 };
    // UMA instrução para o lote; o mesmo minuto mandado de novo troca o de antes (vale o último do lote).
    const gravadas = await pool.query(
      `insert into planta_minuto (loja_id, minuto, tenant_id, agente_id, celula_m, calor, pico, caminhos)
       select distinct on (e.minuto) $1, e.minuto, $2, $3, e.celula_m, e.calor, e.pico, e.caminhos
         from jsonb_to_recordset($4::jsonb) as e(i integer, minuto timestamptz, celula_m numeric, calor jsonb, pico smallint, caminhos jsonb)
        order by e.minuto, e.i desc
       on conflict (loja_id, minuto) do update set
         agente_id = excluded.agente_id, celula_m = excluded.celula_m, calor = excluded.calor, pico = excluded.pico,
         caminhos = excluded.caminhos, recebido_em = now()
       returning minuto`,
      [
        autor.lojaId, autor.tenantId, autor.agenteId,
        JSON.stringify(lidos.map((m, i) => ({ i, minuto: m.minuto, celula_m: m.celulaM, calor: m.calor, pico: m.pico, caminhos: m.caminhos }))),
      ],
    );
    // a guarda curta, desta loja (barato: pela chave)
    await pool.query(
      `update planta_minuto set caminhos = null
        where loja_id = $1 and caminhos is not null and minuto < now() - make_interval(days => $2)`,
      [autor.lojaId, L.guardaDosCaminhosDias],
    );
    await pool.query('delete from planta_minuto where loja_id = $1 and minuto < now() - make_interval(days => $2)', [
      autor.lojaId, L.guardaDosMinutosDias,
    ]);
    return { aceitos: gravadas.rowCount ?? 0 };
  });

  app.get('/v1/lojas/:id/planta-viva', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    const { id } = req.params as { id: string };
    if (!UUID.test(id) || (await pool.query('select 1 from loja where id = $1 and tenant_id = $2', [id, s.tenantId])).rowCount !== 1) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'loja não encontrada' });
    }
    if (!podeAcompanhar(s)) return resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não acompanha a planta da loja' });
    const q = (req.query ?? {}) as { de?: string; ate?: string };
    const data = (x: string | undefined) => (x && COM_FUSO.test(x) && !Number.isNaN(Date.parse(x)) ? new Date(x) : null);
    const ate = q.ate === undefined ? new Date() : data(q.ate);
    const de = q.de === undefined && ate ? new Date(ate.getTime() - 3_600_000) : data(q.de);
    if (!de || !ate || de >= ate) return resposta.status(422).send({ erro: 'validacao', mensagem: 'de e ate: datas com fuso, de antes de ate' });
    if (ate.getTime() - de.getTime() > L.periodoMaximoDias * 86_400_000) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: `o período vai até ${L.periodoMaximoDias} dias` });
    }
    const replay = ate.getTime() - de.getTime() <= L.replayMaximoMin * 60_000 && podeConfigurar(s);
    const r = await pool.query<{ minuto: Date; celula_m: string; calor: [number, number, number][]; pico: number; caminhos: MinutoDaPlanta['caminhos'] }>(
      `select minuto, celula_m, calor, pico, ${replay ? 'caminhos' : 'null::jsonb as caminhos'}
         from planta_minuto
        where loja_id = $1 and minuto >= $2 and minuto < $3
        order by minuto`,
      [id, de.toISOString(), ate.toISOString()],
    );
    const minutos: MinutoGuardado[] = r.rows.map((l) => ({ minuto: l.minuto, celulaM: Number(l.celula_m), calor: l.calor, pico: l.pico, caminhos: l.caminhos }));
    const calor = calorDoPeriodo(minutos);
    const planta = await plantaDaLoja(pool, id);
    return {
      de: de.toISOString(),
      ate: ate.toISOString(),
      minutos: minutos.length,
      celulaM: calor.celulaM,
      calor: calor.calor,
      totalPessoaSegundos: calor.totalPessoaSegundos,
      postos: postosDoPeriodo(calor.calor, calor.celulaM, planta?.planta.moveis ?? []),
      porHora: porHora(minutos),
      pico: minutos.reduce((p, m) => Math.max(p, m.pico), 0),
      /** Nulo fora do replay: trecho de mais de 60 min, ou quem não configura a loja. */
      caminhos: replay ? caminhosDoTrecho(minutos) : null,
    };
  });

  // O atendimento (28/10/2026): a espera em cada área de medida e quem entra e sai por cada porta, contados dos
  // caminhos (`atendimento.ts`). Agregado e sem o caminho de cada um: para quem acompanha a loja, como o calor.
  app.get('/v1/lojas/:id/planta-viva/atendimento', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    const { id } = req.params as { id: string };
    if (!UUID.test(id) || (await pool.query('select 1 from loja where id = $1 and tenant_id = $2', [id, s.tenantId])).rowCount !== 1) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'loja não encontrada' });
    }
    if (!podeAcompanhar(s)) return resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não acompanha a planta da loja' });
    const q = (req.query ?? {}) as { de?: string; ate?: string };
    const data = (x: string | undefined) => (x && COM_FUSO.test(x) && !Number.isNaN(Date.parse(x)) ? new Date(x) : null);
    const agora = new Date();
    const ate = q.ate === undefined ? agora : data(q.ate);
    const de = q.de === undefined && ate ? new Date(ate.getTime() - 3_600_000) : data(q.de);
    if (!de || !ate || de >= ate) return resposta.status(422).send({ erro: 'validacao', mensagem: 'de e ate: datas com fuso, de antes de ate' });
    if (ate.getTime() - de.getTime() > ATENDIMENTO.periodoMaximoDias * 86_400_000) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: `o período vai até ${ATENDIMENTO.periodoMaximoDias} dias (o caminho de cada um fica ${L.guardaDosCaminhosDias})`,
      });
    }
    const planta = await plantaDaLoja(pool, id);
    const areas = planta?.planta.areas ?? [];
    if (!areas.length) return { de: de.toISOString(), ate: ate.toISOString(), minutos: 0, areas: [] };
    // um pouco antes e depois do período: onde cada caminho começou e terminou
    const margem = ATENDIMENTO.margemMin * 60_000;
    const fimDosDados = new Date(Math.min(agora.getTime(), ate.getTime() + margem));
    const r = await pool.query<{ minuto: Date; caminhos: MinutoComCaminhos['caminhos'] }>(
      `select minuto, caminhos from planta_minuto
        where loja_id = $1 and minuto >= $2 and minuto < $3 and caminhos is not null
        order by minuto`,
      [id, new Date(de.getTime() - margem).toISOString(), fimDosDados.toISOString()],
    );
    // "quantos estão lá agora": só quando o período chega ao agora e o ao vivo tem sinal
    const g = aoVivo.get(id);
    const comSinal = g !== undefined && situacaoAoVivo(g.recebidoEm, relogio()) !== 'sem_sinal';
    const agoraPessoas = comSinal && agora.getTime() - ate.getTime() < 60_000 ? g.agora.pessoas : null;
    return {
      de: de.toISOString(),
      ate: ate.toISOString(),
      minutos: r.rows.filter((l) => l.minuto >= de && l.minuto < ate).length,
      areas: atendimentoDoPeriodo(r.rows, areas, de, ate, { fimDosDados, agoraPessoas }),
    };
  });
}
