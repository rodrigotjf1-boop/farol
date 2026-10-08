// =====================================================================
// O quadro de preview do canal — para desenhar a área de análise
// =====================================================================
// O usuário abre o canal, vê o que a câmera enquadra e desenha em cima
// a região que importa. Não há modelo envolvido: é caminho de dados.
//
// O fluxo atravessa o NAT da loja pelo único caminho que existe — a
// resposta do heartbeat:
//
//   console  POST /v1/pontos/:id/preview  →  comando pendente
//   agente   heartbeat                    ←  "capture o ponto X"
//   agente   POST .../resultado           →  o JPEG
//   console  GET /v1/pontos/:id/preview   →  a imagem, para desenhar
//
// O preview fica guardado NO PONTO: é imagem fixa do que o canal
// enquadra, e a bancada não muda de lugar. Reabrir a tela mostra o que
// já existe, sem esperar a loja. Capturar a cada abertura seria lentidão
// gratuita num dado que praticamente não muda.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import { exigirConfigurar } from '../rbac.js';
import { validarPoligono } from '../poligono.js';
import { sessaoDe } from './sessao.js';

// 1280 px de largura basta de sobra para desenhar um retângulo, e segura
// o JPEG em poucas centenas de kB. Mandar 1920 aqui seria pagar banda da
// loja por pixel que ninguém vai olhar.
const LIMITE_BYTES = 6 * 1024 * 1024;

const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function rotasDePreview(app: FastifyInstance, pool: pg.Pool): void {
  // ───────────── console: pede um quadro novo ao canal ─────────────

  app.post('/v1/pontos/:id/preview', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }

    const { id } = req.params as { id: string };

    // O tenant entra na MESMA consulta: ponto de outra empresa tem que
    // ser indistinguível de ponto inexistente, senão a resposta vira
    // oráculo de quais ids existem.
    const p = await pool.query(
      `select p.id, st.loja_id
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null and p.ativo`,
      [id, s.tenantId],
    );
    if (p.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }

    // Quem captura é um agente ATIVO da loja. Sem agente, o pedido falha
    // na hora com o motivo — melhor que uma tela girando para sempre
    // enquanto alguém espera por uma loja que está desligada.
    const a = await pool.query(
      `select id from agente
        where loja_id = $1 and estado = 'ativo'
        order by ultimo_heartbeat desc nulls last
        limit 1`,
      [p.rows[0].loja_id],
    );
    if (a.rowCount === 0) {
      return resposta.status(409).send({
        erro: 'sem_agente',
        mensagem:
          'nenhum agente ativo nesta loja. O preview é capturado pelo agente ' +
          'instalado na loja — sem ele não há como puxar um quadro.',
      });
    }

    // Pedido repetido não empilha comando: se já há um pendente para este
    // ponto, devolve o mesmo. Clicar duas vezes em "atualizar" não pode
    // virar duas capturas.
    const pendente = await pool.query(
      `select id from comando_agente
        where ponto_id = $1 and tipo = 'capturar_quadro'
          and estado = 'pendente' and expira_em > now()
        limit 1`,
      [id],
    );
    if ((pendente.rowCount ?? 0) > 0) {
      return resposta.status(202).send({ comandoId: pendente.rows[0].id, jaPedido: true });
    }

    const c = await pool.query(
      `insert into comando_agente (agente_id, tipo, ponto_id, criado_por)
       values ($1, 'capturar_quadro', $2, $3)
       returning id, expira_em`,
      [a.rows[0].id, id, s.usuarioId],
    );

    return resposta.status(202).send({
      comandoId: c.rows[0].id,
      expiraEm: c.rows[0].expira_em,
      jaPedido: false,
    });
  });

  // ───────────── console: a imagem, e o estado do pedido ─────────────

  app.get('/v1/pontos/:id/preview', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    const { id } = req.params as { id: string };

    const r = await pool.query(
      `select p.preview, p.preview_tipo
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0 || !r.rows[0].preview) {
      return resposta.status(404).send({
        erro: 'sem_preview',
        mensagem: 'este canal ainda não tem quadro. Peça um em POST /v1/pontos/:id/preview',
      });
    }

    return resposta
      .header('content-type', r.rows[0].preview_tipo || 'image/jpeg')
      // Sem cache: o usuário clica em atualizar para ver a cena de agora,
      // e um 304 do navegador mostraria a de antes — parecendo que o
      // botão não funciona.
      .header('cache-control', 'no-store')
      .send(r.rows[0].preview);
  });

  app.get('/v1/pontos/:id/preview/estado', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    const { id } = req.params as { id: string };

    const r = await pool.query(
      `select p.preview_em, p.preview_largura, p.preview_altura, p.preview_pessoas,
              (p.preview is not null) as tem_preview
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }

    // O último comando diz em que pé está o pedido: esperando a loja,
    // entregue, concluído ou falhado. É o que a tela mostra enquanto
    // espera, para não ser um spinner mudo.
    const c = await pool.query(
      `select id, estado, erro, criado_em, concluido_em, expira_em
         from comando_agente
        where ponto_id = $1 and tipo = 'capturar_quadro'
        order by criado_em desc
        limit 1`,
      [id],
    );

    const cmd = c.rows[0];
    return {
      temPreview: r.rows[0].tem_preview,
      capturadoEm: r.rows[0].preview_em,
      largura: r.rows[0].preview_largura,
      altura: r.rows[0].preview_altura,
      // Quantas pessoas o detector da loja viu neste quadro. Nulo = a loja
      // não mediu (agente antigo, ou sem detector): não é zero.
      pessoas: r.rows[0].preview_pessoas as number | null,
      pedido: cmd
        ? {
            id: cmd.id,
            // `pendente` com `expira_em` no passado é pedido que a loja
            // nunca buscou — e dizer "esperando" para sempre esconderia
            // um agente offline.
            estado:
              cmd.estado === 'pendente' && new Date(cmd.expira_em) < new Date()
                ? 'expirado'
                : cmd.estado,
            erro: cmd.erro,
            criadoEm: cmd.criado_em,
            concluidoEm: cmd.concluido_em,
          }
        : null,
    };
  });

  // ───────────── console: o canal, com as áreas que já tem ─────────────

  app.get('/v1/pontos/:id', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    const { id } = req.params as { id: string };

    // Sem `p.preview`: os bytes têm rota própria. Trazê-los aqui mandaria
    // algumas centenas de kB junto de um JSON de texto, em toda abertura
    // da tela.
    const p = await pool.query(
      `select p.id, p.nome, p.canal, p.host, p.porta, p.usuario,
              p.fabricante, p.origem, p.ativo, p.mac, p.mac_visto_em,
              p.sensor_pol, p.focal_mm, p.distancia_cm, p.resolucao_h,
              p.largura_cena_cm, p.preview_largura, p.preview_altura, p.preview_em,
              (p.preview is not null) as tem_preview,
              st.id as setor_id, st.nome as setor_nome, st.loja_id
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (p.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }

    // Cada área vem com os SEUS critérios: um canal pode ter mais de uma, e
    // o critério vale só dentro da área em que foi posto. Uma consulta para
    // o canal inteiro — nunca uma por área.
    const z = await pool.query(
      `select z.id, z.nome, z.poligono, z.principal, z.largura_cena_cm,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                         'id', r.id, 'nome', r.nome, 'tipo', r.tipo, 'ativa', r.ativa,
                         'quando', r.quando, 'parametros', r.parametros)
                       order by r.nome)
                  from regra_alvo ra
                  join regra r on r.id = ra.regra_id
                 where ra.zona_id = z.id and r.excluida_em is null
              ), '[]'::jsonb) as criterios
         from zona z
        where z.ponto_id = $1 and z.excluida_em is null
        order by z.principal desc, z.criado_em, z.nome`,
      [id],
    );

    return { ponto: p.rows[0], zonas: z.rows };
  });

  // ───────────── console: salva a área desenhada no preview ─────────────

  app.patch('/v1/zonas/:id', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }

    // A área decide o que o critério enxerga: mexer nela é configurar.
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const corpo = (req.body ?? {}) as {
      nome?: string;
      poligono?: unknown;
      larguraCenaCm?: number | null;
      principal?: boolean;
    };
    if (corpo.nome !== undefined) {
      const problema = nomeDeAreaInvalido(corpo.nome);
      if (problema) return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }

    const z = await pool.query(
      `select z.id, z.ponto_id
         from zona z
         join ponto p on p.id = z.ponto_id
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where z.id = $1 and l.tenant_id = $2 and p.excluido_em is null
          and z.excluida_em is null`,
      [id, s.tenantId],
    );
    if (z.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'zona não encontrada' });
    }

    if (corpo.poligono !== undefined) {
      const erro = validarPoligono(corpo.poligono);
      if (erro) {
        return resposta.status(422).send({ erro: 'poligono_invalido', mensagem: erro });
      }
    }
    if (
      corpo.larguraCenaCm !== undefined &&
      corpo.larguraCenaCm !== null &&
      !(Number(corpo.larguraCenaCm) > 0)
    ) {
      return resposta.status(422).send({
        erro: 'largura_invalida',
        mensagem: 'largura_cena_cm tem que ser maior que zero, ou nulo',
      });
    }

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      // Um canal tem um corte principal, e o índice único recusa dois.
      // Tirar o antigo ANTES de pôr o novo é o que impede o 23505 — a
      // alternativa seria o usuário ver "erro ao salvar" ao marcar a
      // segunda área como principal, sem entender por quê.
      if (corpo.principal === true) {
        await cliente.query(
          `update zona set principal = false where ponto_id = $1 and id <> $2 and principal`,
          [z.rows[0].ponto_id, id],
        );
      }

      const r = await cliente.query(
        `update zona
            set nome = coalesce($2, nome),
                poligono = coalesce($3::jsonb, poligono),
                largura_cena_cm = case when $4::boolean then $5::numeric else largura_cena_cm end,
                principal = coalesce($6::boolean, principal)
          where id = $1
        returning id, ponto_id, nome, poligono, principal, largura_cena_cm`,
        [
          id,
          corpo.nome === undefined ? null : String(corpo.nome).trim(),
          corpo.poligono === undefined ? null : JSON.stringify(corpo.poligono),
          // `largura` separada do valor: sem isto não há como gravar NULL
          // de propósito — `coalesce` trataria "apagar" como "não mexer".
          corpo.larguraCenaCm !== undefined,
          corpo.larguraCenaCm ?? null,
          corpo.principal ?? null,
        ],
      );
      await cliente.query('commit');
      return r.rows[0];
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      if (ehNomeRepetido(e)) return resposta.status(409).send(NOME_REPETIDO);
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────── console: mais uma área no mesmo canal ─────────────
  //
  // A mesma câmera do caixa confere presença DENTRO do balcão e fila do
  // lado do cliente: duas áreas, cada uma com os seus critérios.

  app.post('/v1/pontos/:id/zonas', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    if (!UUID.test(id)) return naoAchei();

    const corpo = (req.body ?? {}) as { nome?: unknown; poligono?: unknown };
    const problema = nomeDeAreaInvalido(corpo.nome);
    if (problema) return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    // Sem desenho, a área nasce no meio do quadro: dá para ver e arrastar.
    const poligono = corpo.poligono ?? AREA_DO_MEIO;
    const erro = validarPoligono(poligono);
    if (erro) return resposta.status(422).send({ erro: 'poligono_invalido', mensagem: erro });

    // O canal é desta conta e existe? E quantas áreas já tem? Numa consulta.
    const canal = await pool.query(
      `select p.id,
              (select count(*)::int from zona z
                where z.ponto_id = p.id and z.excluida_em is null) as areas
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (canal.rowCount === 0) return naoAchei();
    if (canal.rows[0].areas >= MAX_AREAS_POR_CANAL) {
      return resposta.status(409).send({
        erro: 'areas_demais',
        mensagem: `um canal tem no máximo ${MAX_AREAS_POR_CANAL} áreas`,
      });
    }

    try {
      // Nunca principal: o corte do canal continua sendo o que já era.
      const r = await pool.query(
        `insert into zona (ponto_id, nome, poligono, principal)
         values ($1, $2, $3::jsonb, false)
         returning id, ponto_id, nome, poligono, principal, largura_cena_cm`,
        [id, String(corpo.nome).trim(), JSON.stringify(poligono)],
      );
      return resposta.status(201).send({ ...r.rows[0], criterios: [] });
    } catch (e) {
      if (ehNomeRepetido(e)) return resposta.status(409).send(NOME_REPETIDO);
      throw e;
    }
  });

  // ───────────── console: excluir uma área do canal ─────────────
  //
  // Excluir é MARCAR. O resumo por hora aponta para a área, e apagar a
  // linha levaria junto tudo o que foi contado nela. O que deixa de existir
  // é o vínculo: os critérios dela saem deste canal.

  app.delete('/v1/zonas/:id', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'zona não encontrada' });
    if (!UUID.test(id)) return naoAchei();

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      // Trava o CANAL, não só a área: duas exclusões ao mesmo tempo não
      // podem ver, cada uma, "ainda sobra uma área".
      const z = await cliente.query(
        `select z.id, z.nome, z.ponto_id, z.principal
           from zona z
           join ponto p  on p.id  = z.ponto_id
           join setor st on st.id = p.setor_id
           join loja  l  on l.id  = st.loja_id
          where z.id = $1 and l.tenant_id = $2
            and p.excluido_em is null and z.excluida_em is null
            for update of p`,
        [id, s.tenantId],
      );
      if (z.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei();
      }
      const area = z.rows[0];

      const outras = await cliente.query(
        `select id from zona
          where ponto_id = $1 and id <> $2 and excluida_em is null
          order by criado_em, id`,
        [area.ponto_id, id],
      );
      if (outras.rowCount === 0) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'ultima_area',
          mensagem: 'o canal precisa de pelo menos uma área; para parar de verificar, pause ou exclua o canal',
        });
      }

      // Os critérios desta área, travados antes de mexer: "sobrou algum
      // lugar?" decide se o critério é desligado.
      const afetados = await cliente.query(
        `select r.id
           from regra r
          where r.id in (select ra.regra_id from regra_alvo ra where ra.zona_id = $1)
          order by r.id
            for update of r`,
        [id],
      );
      const ids: string[] = afetados.rows.map((r) => r.id);

      await cliente.query(`delete from regra_alvo where zona_id = $1`, [id]);

      // Uma instrução para todos, nunca um laço por critério.
      const desligados = await cliente.query(
        `update regra r
            set ativa = false, atualizado_em = now()
          where r.id = any($1::uuid[])
            and r.ativa
            and not exists (select 1 from regra_alvo ra where ra.regra_id = r.id)
        returning r.nome`,
        [ids],
      );

      // Sai de principal ANTES de outra entrar: o índice único recusa duas.
      await cliente.query(
        `update zona
            set excluida_em = now(), excluida_por = $2, principal = false, atualizado_em = now()
          where id = $1`,
        [id, s.usuarioId],
      );
      if (area.principal) {
        // O corte do canal passa para a área mais antiga que sobrou.
        await cliente.query(`update zona set principal = true where id = $1`, [outras.rows[0].id]);
      }

      await cliente.query('commit');

      req.log.info(
        { zona: id, ponto: area.ponto_id, por: s.usuarioId, criterios: ids.length, desligados: desligados.rowCount },
        'área EXCLUÍDA',
      );
      return {
        excluida: true,
        criteriosTirados: ids.length,
        criteriosDesligados: desligados.rows.map((r) => r.nome as string),
        aviso: 'área excluída; o que ela registrou continua no histórico',
      };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────── agente: entrega o que capturou ─────────────────

  app.post('/v1/agentes/comandos/:id/resultado', async (req, resposta) => {
    let quem;
    try {
      quem = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const { id } = req.params as { id: string };
    const corpo = (req.body ?? {}) as {
      imagemBase64?: string;
      tipo?: string;
      largura?: number;
      altura?: number;
      mac?: string;
      erro?: string;
      /** Pessoas que o detector da loja viu no quadro. Agente sem detector não manda. */
      pessoas?: number;
    };

    // O comando tem que ser DESTE agente. Sem isso, um token de loja
    // qualquer poderia gravar imagem no ponto de outra.
    const c = await pool.query(
      `select id, ponto_id, estado from comando_agente
        where id = $1 and agente_id = $2`,
      [id, quem.agenteId],
    );
    if (c.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'comando não é deste agente' });
    }
    if (c.rows[0].estado === 'concluido') {
      // Reenvio por retentativa do agente. Não é erro: responder 409
      // faria o agente tratar como falha e tentar de novo para sempre.
      return { ok: true, jaConcluido: true };
    }

    // Falha também responde. Comando que fracassa em silêncio deixa a
    // tela girando, e quem está lá não sabe se a câmera caiu ou se o
    // agente nem recebeu.
    if (corpo.erro) {
      await pool.query(
        `update comando_agente set estado='falhou', erro=$2, concluido_em=now() where id=$1`,
        [id, String(corpo.erro).slice(0, 500)],
      );
      return { ok: true, registrado: 'falha' };
    }

    if (!corpo.imagemBase64) {
      return resposta.status(422).send({
        erro: 'sem_imagem',
        mensagem: 'mande imagemBase64 ou erro',
      });
    }
    const tipo = corpo.tipo || 'image/jpeg';
    if (!TIPOS.has(tipo)) {
      return resposta.status(422).send({
        erro: 'tipo_invalido',
        mensagem: `tipo ${tipo} não aceito. Use ${[...TIPOS].join(', ')}`,
      });
    }

    // Opcional: agente antigo, ou sem detector, não manda. Valor torto não
    // derruba a entrega do quadro — fica como "não medido".
    const pessoas =
      typeof corpo.pessoas === 'number' && Number.isInteger(corpo.pessoas) && corpo.pessoas >= 0 && corpo.pessoas <= 1000
        ? corpo.pessoas
        : null;

    const bytes = Buffer.from(corpo.imagemBase64, 'base64');
    if (bytes.length === 0) {
      return resposta.status(422).send({ erro: 'imagem_vazia', mensagem: 'base64 não decodificou' });
    }
    if (bytes.length > LIMITE_BYTES) {
      return resposta.status(413).send({
        erro: 'imagem_grande',
        mensagem: `${Math.round(bytes.length / 1024)} kB acima do limite de ${LIMITE_BYTES / 1024 / 1024} MB`,
      });
    }

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // O MAC só é gravado quando vem: `coalesce` mantém o anterior em
      // vez de apagá-lo quando o agente não conseguiu ler. Perder o MAC
      // conhecido por causa de uma leitura falha seria trocar
      // informação boa por nenhuma.
      await cliente.query(
        `update ponto
            set preview = $2, preview_tipo = $3,
                preview_largura = $4, preview_altura = $5, preview_em = now(),
                -- É deste quadro, não do anterior: sem medida, fica nulo.
                preview_pessoas = $7,
                mac = coalesce($6, mac),
                mac_visto_em = case when $6 is not null then now() else mac_visto_em end,
                -- O quadro SABE a largura dele. Preenche resolucao_h
                -- quando ninguém informou: medir vence perguntar, e o
                -- diagnóstico deixa de pedir um número que o sistema
                -- tinha como descobrir sozinho.
                resolucao_h = coalesce(resolucao_h, $4)
          where id = $1`,
        [
          c.rows[0].ponto_id, bytes, tipo,
          corpo.largura ?? null, corpo.altura ?? null,
          corpo.mac ? String(corpo.mac).toLowerCase().slice(0, 32) : null,
          pessoas,
        ],
      );
      await cliente.query(
        `update comando_agente set estado='concluido', concluido_em=now(), erro=null where id=$1`,
        [id],
      );
      await cliente.query('commit');
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }

    return { ok: true, bytes: bytes.length };
  });
}

/**
 * O polígono é usado pelo agente para recortar antes de qualquer análise.
 * Polígono inválido não dá erro visível: dá recorte errado, e aí o modelo
 * responde com confiança sobre o lugar errado — a pior falha possível,
 * porque parece que funciona.
 *
 * Por isso recusa aqui, onde ainda há um humano na frente da tela para
 * ler a mensagem.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Uma câmera tem duas, três regiões que importam. O teto existe para um
// laço descontrolado não encher o canal de áreas.
const MAX_AREAS_POR_CANAL = 8;

/** Onde a área nova nasce quando ninguém a desenhou: o meio do quadro. */
const AREA_DO_MEIO = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];

const NOME_REPETIDO = {
  erro: 'nome_repetido',
  mensagem: 'já existe uma área com esse nome neste canal',
};

/** O índice `zona_nome_por_ponto_uk` recusou: o nome já está em uso no canal. */
function ehNomeRepetido(e: unknown): boolean {
  const erro = e as { code?: string; constraint?: string };
  return erro?.code === '23505' && erro.constraint === 'zona_nome_por_ponto_uk';
}

function nomeDeAreaInvalido(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor.trim()) return 'diga o nome da área';
  if (valor.trim().length > 60) return 'o nome da área tem no máximo 60 caracteres';
  return null;
}
