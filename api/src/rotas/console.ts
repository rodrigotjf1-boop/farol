// =====================================================================
// Rotas do console — lojas, setores e pontos
// =====================================================================
// Tudo aqui é autenticado por **sessão de usuário**, não pelo token de
// distribuição. E tudo é filtrado pelo `tenant_id` da sessão, sempre
// atravessando a corrente `ponto → setor → loja → tenant`.
//
// Nenhuma rota aceita `tenantId` do cliente. Se aceitasse, bastaria
// trocar um campo para ler a loja do vizinho — e multi-tenant viraria
// promessa de multi-tenant.
//
// A lacuna que estas rotas fecham: até agora só dava para criar a loja
// INTEIRA de uma vez, pela distribuição. Acrescentar um ponto a uma loja
// que já existe — o que acontece toda vez que uma câmera nova é
// instalada — não tinha caminho.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { exigirConfigurar } from '../rbac.js';
import { acharCampoProibido } from './lojas.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGENS = ['dvr', 'ip'];

export function rotasDoConsole(app: FastifyInstance, pool: pg.Pool): void {
  /** Toda rota começa por aqui: sem sessão, nada acontece. */
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

  // ───────────────────────────── lojas ─────────────────────────────

  app.get('/v1/lojas', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;

    const { rows } = await pool.query(
      `select l.id, l.nome, l.timezone, l.modo_julgamento, l.resolucao_padrao, l.ativa,
              (select count(*)::int from setor st where st.loja_id = l.id) as setores,
              (select count(*)::int
                 from ponto p
                 join setor st2 on st2.id = p.setor_id
                where st2.loja_id = l.id) as pontos
         from loja l
        where l.tenant_id = $1
        order by l.nome`,
      [s.tenantId],
    );
    return { lojas: rows };
  });

  app.get('/v1/lojas/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;

    const { id } = req.params as { id: string };
    if (!UUID.test(id)) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    }

    // O filtro por tenant vai na MESMA consulta. Buscar primeiro e
    // conferir depois é como nasce vazamento entre clientes.
    const l = await pool.query(
      `select id, nome, timezone, modo_julgamento, resolucao_padrao, ativa
         from loja where id = $1 and tenant_id = $2`,
      [id, s.tenantId],
    );
    if (l.rowCount === 0) {
      // 404, não 403: dizer "existe, mas não é sua" já entrega que ela
      // existe — e isso é informação sobre outro cliente.
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    }

    const st = await pool.query(
      `select st.id, st.nome, st.ordem,
              p.id as ponto_id, p.nome as ponto_nome, p.origem, p.fabricante,
              p.canal, p.host, p.porta, p.usuario, p.ativo,
              -- as zonas vem junto: a tela de regras precisa saber ONDE a
              -- regra vai morar, e uma ida a mais ao servidor para isso
              -- seria gasto a toa.
              coalesce(
                (select jsonb_agg(jsonb_build_object('id', z.id, 'nome', z.nome)
                                  order by z.nome)
                   from zona z where z.ponto_id = p.id),
                '[]'::jsonb) as zonas
         from setor st
         left join ponto p on p.setor_id = st.id
        where st.loja_id = $1
        order by st.ordem, st.nome, p.nome`,
      [id],
    );

    const setores = new Map<string, Record<string, unknown>>();
    for (const r of st.rows) {
      if (!setores.has(r.id)) {
        setores.set(r.id, { id: r.id, nome: r.nome, ordem: r.ordem, pontos: [] });
      }
      if (r.ponto_id) {
        (setores.get(r.id)!.pontos as unknown[]).push({
          id: r.ponto_id,
          nome: r.ponto_nome,
          origem: r.origem,
          fabricante: r.fabricante,
          canal: r.canal,
          host: r.host,
          porta: r.porta,
          usuario: r.usuario,
          ativo: r.ativo,
          zonas: r.zonas ?? [],
        });
      }
    }

    return { loja: l.rows[0], setores: [...setores.values()] };
  });

  // ──────────────────────────── setores ────────────────────────────

  app.post('/v1/lojas/:id/setores', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const corpo = (req.body ?? {}) as { nome?: string; ordem?: number };
    if (!corpo.nome?.trim()) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'nome é obrigatório' });
    }

    // `where tenant_id` no SELECT da loja: é o que amarra a criação ao
    // dono. Sem ele, um id adivinhado criaria setor na loja de outro.
    const { rows } = await pool.query(
      `insert into setor (loja_id, nome, ordem)
       select l.id, $2, coalesce($3, 0)
         from loja l where l.id = $1 and l.tenant_id = $4
       returning id, nome, ordem`,
      [id, corpo.nome.trim(), corpo.ordem ?? null, s.tenantId],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    }
    return resposta.status(201).send({ ...rows[0], pontos: [] });
  });

  // ───────────────────────────── pontos ────────────────────────────

  app.post('/v1/setores/:id/pontos', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const corpo = (req.body ?? {}) as Record<string, unknown>;

    const proibido = acharCampoProibido(corpo);
    if (proibido) {
      return resposta.status(422).send({
        erro: 'segredo_no_cadastro',
        mensagem:
          `o campo '${proibido}' não entra por aqui. Senha de câmera ou gravador fica ` +
          'no cofre do agente, na loja — o cadastro guarda só o usuário.',
      });
    }

    const nome = String(corpo.nome ?? '').trim();
    if (!nome) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'nome é obrigatório' });
    }
    const origem = String(corpo.origem ?? 'dvr');
    if (!ORIGENS.includes(origem)) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: `origem: um de ${ORIGENS.join(', ')}`,
      });
    }
    if (origem === 'dvr' && corpo.canal == null) {
      // Sem canal não se resolve URL nenhuma. Melhor dizer agora do que
      // o agente descobrir na loja, com o técnico parado.
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: 'canal é obrigatório quando origem = dvr',
      });
    }

    // Ponto e zona nascem juntos, numa transacao so. Regra exige zona, e
    // obrigar a desenhar um poligono antes de escrever o primeiro
    // criterio travaria a instalacao por nada: o quadro inteiro ja e uma
    // zona valida, e recortar vem depois, quando houver imagem para ver.
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const { rows } = await cliente.query(
        `insert into ponto (setor_id, nome, origem, fabricante, canal, host, porta, usuario)
         select st.id, $2, $3, $4, $5, $6, coalesce($7, 554), $8
           from setor st
           join loja l on l.id = st.loja_id
          where st.id = $1 and l.tenant_id = $9
         returning id, nome, origem, fabricante, canal, host, porta, usuario, ativo`,
        [
          id, nome, origem,
          corpo.fabricante ?? null, corpo.canal ?? null, corpo.host ?? null,
          corpo.porta ?? null, corpo.usuario ?? null, s.tenantId,
        ],
      );
      if (rows.length === 0) {
        await cliente.query('rollback');
        return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'setor não encontrado' });
      }
      const z = await cliente.query(
        // Nasce como o corte PRINCIPAL do canal. Na falta de desenho do
        // usuário, o padrão do sistema é o quadro inteiro — o sistema não
        // adivinha recorte, porque corte automático erraria calado,
        // cortando justamente o que importa, e o veredito sairia confiante
        // sobre o pedaço errado.
        `insert into zona (ponto_id, nome, poligono, principal)
         values ($1, 'Quadro inteiro', '[[0,0],[1,0],[1,1],[0,1]]'::jsonb, true)
         returning id, nome, poligono, principal`,
        [rows[0].id],
      );
      await cliente.query('commit');
      return resposta.status(201).send({ ...rows[0], zonas: [z.rows[0]] });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  app.patch('/v1/pontos/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const corpo = (req.body ?? {}) as Record<string, unknown>;

    const proibido = acharCampoProibido(corpo);
    if (proibido) {
      return resposta.status(422).send({
        erro: 'segredo_no_cadastro',
        mensagem: `o campo '${proibido}' não entra por aqui.`,
      });
    }
    if (corpo.origem != null && !ORIGENS.includes(String(corpo.origem))) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: `origem: um de ${ORIGENS.join(', ')}`,
      });
    }

    // `coalesce($n, coluna)`: campo ausente MANTÉM o valor, não apaga.
    // Um PATCH que zera o que não foi mandado destrói configuração a
    // cada edição parcial da tela.
    const { rows } = await pool.query(
      `update ponto p
          set nome       = coalesce($2, p.nome),
              origem     = coalesce($3, p.origem),
              fabricante = coalesce($4, p.fabricante),
              canal      = coalesce($5, p.canal),
              host       = coalesce($6, p.host),
              porta      = coalesce($7, p.porta),
              usuario    = coalesce($8, p.usuario),
              ativo      = coalesce($9, p.ativo),
              sensor_pol      = coalesce($11, p.sensor_pol),
              focal_mm        = coalesce($12, p.focal_mm),
              distancia_cm    = coalesce($13, p.distancia_cm),
              resolucao_h     = coalesce($14, p.resolucao_h),
              largura_cena_cm = coalesce($15, p.largura_cena_cm),
              optica_medida_em = case when $15 is not null then now()
                                      else p.optica_medida_em end,
              atualizado_em = now()
         from setor st, loja l
        where p.id = $1
          and st.id = p.setor_id
          and l.id = st.loja_id
          and l.tenant_id = $10
       returning p.id, p.nome, p.origem, p.fabricante, p.canal, p.host,
                 p.porta, p.usuario, p.ativo, p.sensor_pol, p.focal_mm,
                 p.distancia_cm, p.resolucao_h, p.largura_cena_cm`,
      [
        id,
        corpo.nome ?? null, corpo.origem ?? null, corpo.fabricante ?? null,
        corpo.canal ?? null, corpo.host ?? null, corpo.porta ?? null,
        corpo.usuario ?? null,
        typeof corpo.ativo === 'boolean' ? corpo.ativo : null,
        s.tenantId,
        corpo.sensorPol ?? null, corpo.focalMm ?? null, corpo.distanciaCm ?? null,
        corpo.resolucaoH ?? null, corpo.larguraCenaCm ?? null,
      ],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }
    return rows[0];
  });

  app.delete('/v1/pontos/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };

    // DESATIVA, não apaga. Evento histórico aponta para a zona, que
    // aponta para o ponto: apagar quebraria a linha do tempo da loja —
    // e é justamente o histórico que o produto existe para guardar.
    const { rows } = await pool.query(
      `update ponto p set ativo = false, atualizado_em = now()
         from setor st, loja l
        where p.id = $1 and st.id = p.setor_id and l.id = st.loja_id
          and l.tenant_id = $2
       returning p.id, p.ativo`,
      [id, s.tenantId],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }
    return { ...rows[0], aviso: 'ponto desativado; o histórico dele continua no sistema' };
  });
}
