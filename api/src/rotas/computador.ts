// =====================================================================
// O computador da loja: quando ele dorme e acorda sozinho (A22, fatia P2)
// =====================================================================
// GET  /v1/lojas/:id/computador           o horário, a semana desenhada, a
//                                          sugestão e como ele está agora
// POST /v1/lojas/:id/computador/conferir  a semana de um RASCUNHO, sem
//                                          salvar (a gaveta redesenha a cada
//                                          mudança)
// PUT  /v1/lojas/:id/computador           salva; recusa dormir com a loja
//                                          aberta
//
// Toda a conta é de `computador.ts`: a tela não repete a conta, pede. Assim
// existe um jeito só de dizer "ele dormiria com a loja aberta", e ele é o
// mesmo que o contrato confere com o agente.
//
// Quem vê: qualquer perfil da conta (como a página da loja). Quem muda:
// quem configura (`exigirConfigurar`).
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import {
  lerHorarioDoComputador,
  SABE_DORMIR,
  semanaDesenhada,
  silencioDoAgente,
  situacaoDoComputador,
  sugestao,
  type HorarioDoComputador,
  type Trecho,
} from '../computador.js';
import type { Faixa } from '../horario.js';
import { exigirConfigurar, podeConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Os choques como a tela os diz: o dia e o trecho ("das 19:00 às 19:30"). O fim de um dia inteiro é "24:00". */
export function choquesPorDia(h: HorarioDoComputador | null, faixas: Faixa[] | null): { dia: number; de: string; ate: string }[] {
  const texto = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  // Desligado não dorme (`trechosDormindo`), então não choca.
  return semanaDesenhada(h, faixas).flatMap((d) => d.choques.map(([i, f]: Trecho) => ({ dia: d.dia, de: texto(i), ate: texto(f) })));
}

const NOMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/** "Na segunda, das 19:00 às 24:00; na terça, das 00:00 às 03:01." */
function fraseDosChoques(lista: { dia: number; de: string; ate: string }[]): string {
  return lista.map((c) => `na ${NOMES[c.dia - 1]}, das ${c.de} às ${c.ate}`).join('; ');
}

export function rotasDoComputador(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: Parameters<typeof sessaoDe>[1], resposta: {
    status: (n: number) => { send: (o: unknown) => unknown };
  }): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }

  /** A loja da conta (o filtro do tenant na MESMA consulta), com o agente que bateu por último. */
  async function aLoja(id: string, tenantId: string) {
    const { rows } = await pool.query<{
      id: string; timezone: string; horario_funcionamento: Faixa[] | null; horario_computador: HorarioDoComputador | null;
    }>(
      `select id, timezone, horario_funcionamento, horario_computador
         from loja where id = $1 and tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) return null;
    // O agente que bateu por último é o que dorme e acorda (como em `inventario.ts`).
    const ag = await pool.query<{ versao: string | null; sabe: string[] | null; ultimo_heartbeat: Date | null; segundos_sem_bater: number | null }>(
      `select versao, sabe, ultimo_heartbeat,
              extract(epoch from (now() - ultimo_heartbeat))::integer as segundos_sem_bater
         from agente
        where loja_id = $1 and estado = 'ativo'
        order by ultimo_heartbeat desc nulls last
        limit 1`,
      [id],
    );
    return { loja: rows[0]!, agente: ag.rows[0] ?? null };
  }

  /** O que a tela recebe: o horário salvo, a semana dele, a sugestão e como ele está agora. */
  function oQueATelaVe(
    loja: { timezone: string; horario_funcionamento: Faixa[] | null; horario_computador: HorarioDoComputador | null },
    agente: { versao: string | null; sabe: string[] | null; ultimo_heartbeat: Date | null; segundos_sem_bater: number | null } | null,
    configura: boolean,
  ) {
    const agora = new Date();
    const faixas = loja.horario_funcionamento ?? [];
    const h = loja.horario_computador;
    return {
      horario: h,
      temHorarioDaLoja: faixas.length > 0,
      sugestao: sugestao(faixas),
      semana: semanaDesenhada(h, faixas),
      choques: choquesPorDia(h, faixas),
      situacao: situacaoDoComputador(h, agora, loja.timezone),
      agente: agente
        ? {
          versao: agente.versao,
          sabeDormir: (agente.sabe ?? []).includes(SABE_DORMIR),
          segundosSemBater: agente.segundos_sem_bater,
          ...silencioDoAgente({ horario: h, fuso: loja.timezone, sabe: agente.sabe, ultimaBatida: agente.ultimo_heartbeat, agora }),
        }
        : null,
      configura,
    };
  }

  app.get('/v1/lojas/:id/computador', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    const achou = await aLoja(id, s.tenantId);
    if (!achou) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    return oQueATelaVe(achou.loja, achou.agente, podeConfigurar(s));
  });

  // O rascunho da gaveta: a semana e os choques, sem salvar nada. Só quem configura edita, então só ele confere.
  app.post('/v1/lojas/:id/computador/conferir', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    const lido = lerHorarioDoComputador((req.body ?? {}) as unknown);
    if (lido.problema || !lido.horario) return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
    const { rows } = await pool.query<{ horario_funcionamento: Faixa[] | null }>(
      'select horario_funcionamento from loja where id = $1 and tenant_id = $2',
      [id, s.tenantId],
    );
    if (rows.length === 0) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    const faixas = rows[0]!.horario_funcionamento ?? [];
    return { semana: semanaDesenhada(lido.horario, faixas), choques: choquesPorDia(lido.horario, faixas) };
  });

  // PUT e não PATCH: o corpo é o horário inteiro (os sete dias e o liga/desliga), e mandar de novo dá no mesmo.
  app.put('/v1/lojas/:id/computador', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    const lido = lerHorarioDoComputador((req.body ?? {}) as unknown);
    if (lido.problema || !lido.horario) return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
    const h = lido.horario;

    const achou = await aLoja(id, s.tenantId);
    if (!achou) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    const faixas = achou.loja.horario_funcionamento ?? [];
    // Ligado, ele NÃO pode dormir com a loja aberta (decisão do protótipo aprovado em 16/10/2026). Sem o horário da
    // loja ela vale como sempre aberta — e todo sono choca. Desligado, o que foi preenchido fica guardado.
    if (h.ligado && faixas.length === 0) {
      return resposta.status(422).send({
        erro: 'sem_horario_da_loja',
        mensagem: 'informe antes o horário de funcionamento da loja (em Critérios): sem ele, a loja vale como sempre aberta',
      });
    }
    const lista = choquesPorDia(h, faixas);
    if (lista.length > 0) {
      return resposta.status(422).send({
        erro: 'dorme_com_a_loja_aberta',
        mensagem: `ele dormiria com a loja aberta: ${fraseDosChoques(lista)}`,
        choques: lista,
      });
    }

    // A versão da configuração sobe NA MESMA linha: é por ela que o agente sabe que precisa puxar de novo.
    const { rows } = await pool.query(
      `update loja
          set horario_computador = $3::jsonb,
              config_versao = config_versao + 1,
              atualizado_em = now()
        where id = $1 and tenant_id = $2
        returning id`,
      [id, s.tenantId, JSON.stringify(h)],
    );
    if (rows.length === 0) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    const depois = await aLoja(id, s.tenantId);
    return oQueATelaVe(depois!.loja, depois!.agente, true);
  });
}
