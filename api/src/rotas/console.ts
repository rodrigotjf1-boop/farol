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

import {
  lerCena,
  lerTipoDeNegocio,
  NOME_DA_IMAGEM_COMPLETA,
  POLIGONO_DA_IMAGEM_COMPLETA,
  SQL_NUMERO_DO_QUADRO,
} from '../cena.js';
import { lerHorario, situacaoAgora } from '../horario.js';
import { exigirConfigurar, peloMenos } from '../rbac.js';
import { acharCampoProibido } from './lojas.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGENS = ['dvr', 'ip'];
const IMPORTANCIAS = ['critico', 'normal', 'baixo'];
// Campos da loja que são lógica interna do Farol: só a distribuição muda.
const SO_NA_DISTRIBUICAO = [
  'pedidoComContexto', 'modoJulgamento', 'resolucaoPadrao',
  // O balcão (a dúvida pelo servidor): a chave interna, o teto e a conta de IA.
  'duvidaPeloServidor', 'tetoDuvidaCentavosDia', 'contaDeIa',
];

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

    // A lista traz, de cada loja, como vai o AGENTE dela. É o que a
    // moldura do console mostra em toda tela, e o que a lista de lojas
    // mostra antes de alguém entrar em uma: "esta aqui está sendo
    // verificada?" não pode depender de abrir loja por loja.
    //
    // `segundos_sem_bater` é o do agente que bateu por último, calculado
    // no BANCO (o relógio do navegador erra). Agente que nunca bateu não
    // entra na conta: loja só com agente por instalar fica com nulo.
    const { rows } = await pool.query(
      `select l.id, l.nome, l.timezone, l.modo_julgamento, l.resolucao_padrao, l.ativa,
              l.horario_funcionamento, l.tipo_negocio,
              (select count(*)::int from setor st where st.loja_id = l.id) as setores,
              (select count(*)::int
                 from ponto p
                 join setor st2 on st2.id = p.setor_id
                where st2.loja_id = l.id and p.excluido_em is null) as pontos,
              (select count(*)::int
                 from regra r
                where r.loja_id = l.id and r.excluida_em is null) as criterios,
              (select count(*)::int from agente a where a.loja_id = l.id) as agentes,
              (select min(extract(epoch from (now() - a.ultimo_heartbeat)))::int
                 from agente a
                where a.loja_id = l.id and a.estado = 'ativo'
                  and a.ultimo_heartbeat is not null) as segundos_sem_bater
         from loja l
        where l.tenant_id = $1
        order by l.nome`,
      [s.tenantId],
    );

    // O que foi julgado nas últimas 24 horas, numa consulta para TODAS as
    // lojas da conta. Resultado é informação de gestão: quem não pode ver
    // a tela de resultados não recebe o número por esta porta lateral.
    const veResultados = s.nivel === 'suporte' || peloMenos(s, 'supervisao');
    const porLoja = new Map<string, { conformes: number; naoConformes: number; naoAvaliaveis: number }>();
    if (veResultados && rows.length > 0) {
      const r = await pool.query(
        `select loja_id,
                sum(conformes)::int as conformes,
                sum(nao_conformes)::int as nao_conformes,
                sum(nao_avaliaveis)::int as nao_avaliaveis
           from resumo_hora
          where loja_id = any($1::uuid[]) and hora >= now() - interval '24 hours'
          group by loja_id`,
        // Pelos ids que ACABARAM de sair filtrados pelo tenant: é o índice
        // (loja_id, hora) que atende, e nenhuma loja de fora entra.
        [rows.map((l) => l.id)],
      );
      for (const x of r.rows) {
        porLoja.set(x.loja_id, {
          conformes: x.conformes,
          naoConformes: x.nao_conformes,
          naoAvaliaveis: x.nao_avaliaveis,
        });
      }
    }

    // `aberta_agora` sai do relógio do SERVIDOR, no fuso da loja — o do
    // navegador erra. `null` é "a loja não informou horário".
    const agora = new Date();
    return {
      lojas: rows.map((l) => ({
        ...l,
        ...situacaoAgora(l.horario_funcionamento, agora, l.timezone),
        resultado_24h: porLoja.get(l.id) ?? null,
      })),
    };
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
      `select id, nome, timezone, modo_julgamento, resolucao_padrao, ativa,
              horario_funcionamento, tipo_negocio
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
              p.canal, p.host, p.porta, p.usuario, p.ativo, p.importancia,
              -- A lista de canais diz, de cada um, se a cena ja foi escrita.
              (btrim(p.cena) <> '') as tem_cena,
              -- as zonas vem junto: a tela de regras precisa saber ONDE a
              -- regra vai morar, e uma ida a mais ao servidor para isso
              -- seria gasto a toa. A imagem completa (a principal) vem
              -- primeiro; depois os quadros, cada um com o numero e o papel.
              coalesce(
                (select jsonb_agg(jsonb_build_object(
                                    'id', q.id, 'nome', q.nome,
                                    -- Marcar o canal na arvore de criterios
                                    -- e marcar a IMAGEM COMPLETA dele.
                                    'principal', q.principal,
                                    'papel', q.papel, 'numero', q.numero)
                                  order by q.principal desc, q.numero)
                   from (select z.id, z.nome, z.principal, z.papel,
                                ${SQL_NUMERO_DO_QUADRO} as numero
                           from zona z
                          where z.ponto_id = p.id and z.excluida_em is null) q),
                '[]'::jsonb) as zonas
         from setor st
         left join ponto p on p.setor_id = st.id and p.excluido_em is null
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
          importancia: r.importancia,
          tem_cena: r.tem_cena === true,
          zonas: r.zonas ?? [],
        });
      }
    }

    // Os agentes da loja vêm junto: sem isto, a única forma de saber se
    // a loja está sendo auditada é tentar usar e esperar falhar.
    //
    // `segundos_sem_bater` é calculado no BANCO, não no cliente. O
    // relógio do navegador erra — fuso, horário de verão, máquina com a
    // hora solta — e um agente saudável apareceria como caído, ou pior,
    // um caído apareceria saudável.
    //
    // `sabe` é o que o agente declarou ao pedir a configuração pela última
    // vez (`sabe_em`; nulo = ainda não pediu desde que isto é guardado). É
    // por ele que a tela diz se o que foi configurado já vale na loja.
    const ag = await pool.query(
      `select id, nome, estado, versao, ultimo_heartbeat,
              extract(epoch from (now() - ultimo_heartbeat))::integer
                as segundos_sem_bater,
              sabe, sabe_em
         from agente
        where loja_id = $1
        order by ultimo_heartbeat desc nulls last`,
      [id],
    );

    return {
      loja: {
        ...l.rows[0],
        ...situacaoAgora(l.rows[0].horario_funcionamento, new Date(), l.rows[0].timezone),
      },
      setores: [...setores.values()],
      agentes: ag.rows,
    };
  });

  // ─────────────────────── horário de funcionamento ───────────────────────
  //
  // O horário é da LOJA. Cada critério só diz se é conferido com ela
  // aberta, fechada ou sempre (`regra.quando`). PUT e não PATCH: o corpo é
  // o horário inteiro, e mandar de novo dá no mesmo.

  app.put('/v1/lojas/:id/horario', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    if (!UUID.test(id)) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    }
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const lido = lerHorario(corpo.horario);
    if (lido.problema || !lido.faixas) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
    }

    // A versão da configuração sobe NA MESMA linha: é por ela que o agente
    // sabe que precisa puxar de novo. Em dois comandos, uma queda no meio
    // deixaria o horário novo no banco e o agente no antigo, sem motivo
    // para conferir.
    const { rows } = await pool.query(
      `update loja
          set horario_funcionamento = $3::jsonb,
              config_versao = config_versao + 1,
              atualizado_em = now()
        where id = $1 and tenant_id = $2
        returning horario_funcionamento, timezone`,
      [id, s.tenantId, JSON.stringify(lido.faixas)],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    }
    return {
      horario_funcionamento: rows[0].horario_funcionamento,
      ...situacaoAgora(rows[0].horario_funcionamento, new Date(), rows[0].timezone),
    };
  });

  // ───────────────────────── o tipo de negócio ─────────────────────────
  //
  // "Hamburgueria", "padaria": vale para a loja inteira e vai junto com a
  // cena de cada canal em toda pergunta feita a um modelo. Campo ausente
  // mantém o que estava; texto vazio apaga.
  //
  // O que NÃO entra por aqui: `pedido_com_contexto`, `modo_julgamento` e
  // `resolucao_padrao`. Como o Farol pergunta, e a quem, é lógica interna —
  // fica na distribuição. E é recusado com todas as letras, não ignorado em
  // silêncio: quem mandou ficaria achando que mudou.

  app.patch('/v1/lojas/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    if (!UUID.test(id)) return naoAchei();

    const corpo = (req.body ?? {}) as Record<string, unknown>;
    for (const interno of SO_NA_DISTRIBUICAO) {
      if (corpo[interno] !== undefined) {
        return resposta.status(422).send({
          erro: 'so_na_distribuicao',
          mensagem: `'${interno}' não se muda pelo console da loja`,
        });
      }
    }
    if (corpo.tipoNegocio === undefined) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'nada para mudar: mande tipoNegocio' });
    }
    const tipo = lerTipoDeNegocio(corpo.tipoNegocio);
    if (tipo.problema !== undefined) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: tipo.problema });
    }

    // A versão sobe na MESMA instrução (a `loja` não tem gatilho de versão),
    // e só quando o texto mudou: salvar sem mexer não faz o agente puxar a
    // configuração inteira de novo.
    const { rows } = await pool.query(
      `update loja
          set config_versao = config_versao + (tipo_negocio is distinct from $3)::int,
              atualizado_em = case when tipo_negocio is distinct from $3 then now() else atualizado_em end,
              tipo_negocio = $3
        where id = $1 and tenant_id = $2
        returning id, tipo_negocio`,
      [id, s.tenantId, tipo.valor],
    );
    if (rows.length === 0) return naoAchei();
    return rows[0];
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

    // O canal e a imagem completa dele nascem juntos, numa transacao so.
    // Criterio exige uma area, e obrigar a marcar um quadro antes de
    // escrever o primeiro criterio travaria a instalacao por nada: a imagem
    // completa ja e onde moram os criterios gerais, e marcar quadro vem
    // depois, quando houver imagem para ver.
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
        // A IMAGEM COMPLETA do canal: a área principal, sempre o canal
        // inteiro (migration 034). O sistema não adivinha recorte — corte
        // automático erraria calado, cortando justamente o que importa, e o
        // veredito sairia confiante sobre o pedaço errado. Quem quer conferir
        // só uma parte marca um quadro.
        `insert into zona (ponto_id, nome, poligono, principal)
         values ($1, $2, $3::jsonb, true)
         returning id, nome, poligono, principal, papel`,
        [rows[0].id, NOME_DA_IMAGEM_COMPLETA, JSON.stringify(POLIGONO_DA_IMAGEM_COMPLETA)],
      );
      await cliente.query('commit');
      // A imagem completa não é quadro: não tem número.
      return resposta.status(201).send({ ...rows[0], tem_cena: false, zonas: [{ ...z.rows[0], numero: null }] });
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
    if (corpo.importancia != null && !IMPORTANCIAS.includes(String(corpo.importancia))) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: `importancia: um de ${IMPORTANCIAS.join(', ')}`,
      });
    }
    // A cena: o que esta câmera vê e de onde olha. Quem configura escreve;
    // texto vazio apaga. Ausente, fica como estava.
    let cena: string | null = null;
    if (corpo.cena !== undefined) {
      const lida = lerCena(corpo.cena);
      if (lida.problema !== undefined) {
        return resposta.status(422).send({ erro: 'validacao', mensagem: lida.problema });
      }
      cena = lida.valor;
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
              importancia     = coalesce($16, p.importancia),
              sensor_pol      = coalesce($11, p.sensor_pol),
              focal_mm        = coalesce($12, p.focal_mm),
              distancia_cm    = coalesce($13, p.distancia_cm),
              resolucao_h     = coalesce($14, p.resolucao_h),
              largura_cena_cm = coalesce($15, p.largura_cena_cm),
              optica_medida_em = case when $15 is not null then now()
                                      else p.optica_medida_em end,
              -- Quem escreveu e quando só muda quando o TEXTO muda: salvar a
              -- tela sem mexer na cena não troca o autor. Apagada, fica sem autor.
              cena = coalesce($17::text, p.cena),
              cena_escrita_em = case
                when $17::text is null or $17::text = p.cena then p.cena_escrita_em
                when $17::text = '' then null
                else now() end,
              cena_escrita_por = case
                when $17::text is null or $17::text = p.cena then p.cena_escrita_por
                when $17::text = '' then null
                else $18::uuid end,
              atualizado_em = now()
         from setor st, loja l
        where p.id = $1
          and p.excluido_em is null
          and st.id = p.setor_id
          and l.id = st.loja_id
          and l.tenant_id = $10
       returning p.id, p.nome, p.origem, p.fabricante, p.canal, p.host,
                 p.porta, p.usuario, p.ativo, p.importancia, p.sensor_pol, p.focal_mm,
                 p.distancia_cm, p.resolucao_h, p.largura_cena_cm,
                 p.cena, p.cena_escrita_em`,
      [
        id,
        corpo.nome ?? null, corpo.origem ?? null, corpo.fabricante ?? null,
        corpo.canal ?? null, corpo.host ?? null, corpo.porta ?? null,
        corpo.usuario ?? null,
        typeof corpo.ativo === 'boolean' ? corpo.ativo : null,
        s.tenantId,
        corpo.sensorPol ?? null, corpo.focalMm ?? null, corpo.distanciaCm ?? null,
        corpo.resolucaoH ?? null, corpo.larguraCenaCm ?? null,
        corpo.importancia ?? null,
        cena, s.usuarioId,
      ],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }
    return rows[0];
  });

  // ─────────────────────────── excluir o canal ───────────────────────────
  // EXCLUIR não é PAUSAR. Pausar é `PATCH {ativo:false}`: o canal fica na
  // tela, marcado, com os critérios guardados. Excluir é para o canal que
  // não existe mais — some das telas e do que desce para o agente.
  //
  // A linha fica (migration 014): evento histórico aponta para a área, que
  // aponta para o canal. E os critérios NÃO são excluídos junto: saem só
  // deste canal. O que valia só aqui é desligado e vai para "Sem canal" —
  // a mesma regra de tirar o critério do último canal.

  app.delete('/v1/pontos/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    if (!UUID.test(id)) return naoAchei();

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      const p = await cliente.query(
        `select p.id, p.nome
           from ponto p
           join setor st on st.id = p.setor_id
           join loja  l  on l.id  = st.loja_id
          where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null
            for update of p`,
        [id, s.tenantId],
      );
      if (p.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei();
      }

      // Os critérios deste canal, travados antes de mexer: "sobrou algum
      // canal?" decide se o critério é desligado, e duas exclusões ao mesmo
      // tempo não podem ver, cada uma, "ainda sobra um".
      const afetados = await cliente.query(
        `select r.id
           from regra r
          where r.id in (select ra.regra_id
                           from regra_alvo ra
                           join zona z on z.id = ra.zona_id
                          where z.ponto_id = $1)
          order by r.id
            for update of r`,
        [id],
      );
      const ids: string[] = afetados.rows.map((r) => r.id);

      await cliente.query(
        `delete from regra_alvo ra
          using zona z
          where z.id = ra.zona_id and z.ponto_id = $1`,
        [id],
      );

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

      await cliente.query(
        `update ponto
            set excluido_em = now(), excluido_por = $2, ativo = false, atualizado_em = now()
          where id = $1`,
        [id, s.usuarioId],
      );

      await cliente.query('commit');

      // Excluir um canal muda o que a loja audita. Fica no log com quem fez.
      req.log.info(
        { ponto: id, por: s.usuarioId, criterios: ids.length, desligados: desligados.rowCount },
        'canal EXCLUÍDO',
      );
      return {
        excluido: true,
        criteriosTirados: ids.length,
        criteriosDesligados: desligados.rows.map((r) => r.nome as string),
        aviso: 'canal excluído; o histórico dele continua no sistema',
      };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });
}
