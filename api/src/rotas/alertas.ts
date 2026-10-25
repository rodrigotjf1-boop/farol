// =====================================================================
// Destinos, política e a fila de envios
// =====================================================================
// Três superfícies, com públicos diferentes:
//
//   console    cadastra quem recebe e qual a regra de quem recebe o quê
//   transporte puxa os pendentes, entrega, e devolve o RESULTADO
//   console    pergunta "o alerta chegou?" — e tem resposta
//
// ## Por que o transporte PUXA em vez de a API empurrar
//
// Empurrar faria a API esperar o WhatsApp. Uma lentidão da Meta viraria
// lentidão na ingestão de eventos de todas as lojas — e a ingestão é o
// caminho que não pode parar, porque atrás dela tem agente com fila cheia
// esperando para drenar.
//
// Puxando, o transporte vai no ritmo dele, retenta no ritmo dele, e cai
// sem levar nada consigo: os envios ficam `pendente` até alguém buscar.
//
// ## Quem puxa é a DISTRIBUIÇÃO, não o agente
//
// Tentei primeiro autenticar o transporte com o token do agente, e o caso
// que mata essa ideia é o mais importante de todos: **o aviso de "o agente
// caiu" não pode ser entregue pelo agente** — ele está caído. O mesmo vale
// para queda de internet na loja, que é quando mais se precisa avisar.
//
// Então o transporte é infraestrutura do lado da distribuição e puxa de
// TODAS as lojas: um n8n serve a rede inteira. Isso também segue a divisão
// do produto — telemetria e painel de distribuição nunca são do usuário.
//
// ## A credencial é do TRANSPORTE, não a chave geral (migration 046)
//
// Até 14/10/2026 estas rotas aceitavam a credencial geral da distribuição
// (`x-farol-admin`), a que emite agente e cadastra loja: quem entregasse os
// alertas carregaria a chave mestra (pedido da sessão do Hub DMS, aprovado
// pelo dono). Agora cada transporte tem o token dele (`Bearer fart_…`, ver
// `auth.ts`), que só reivindica envios dos tipos que lhe cabem e só devolve
// o resultado do que ele mesmo reivindicou. A chave geral não vale aqui.
//
// ## `reivindicar` usa `skip locked`
//
// Dois trabalhadores do n8n rodando juntos — que é o normal, e também o
// que acontece sozinho quando um fica preso e o outro assume — pegariam o
// mesmo envio e mandariam a mesma mensagem duas vezes. `for update skip
// locked` faz cada um levar um pedaço distinto, sem fila e sem travar o
// outro.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { exigirConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';
import { acharCampoProibido } from './lojas.js';
import { autenticarTransporte, ErroDeAuth, type TransporteAutenticado } from '../auth.js';

const TIPOS = ['whatsapp', 'email', 'kds', 'webhook'];
const SEVERIDADES = ['info', 'atencao', 'critico', 'emergencia'];
const PRIORIDADES = ['urgente', 'intermediaria', 'leve'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_REIVINDICAR = 100;

/** Validação do endereço por tipo — e cada uma existe por um erro real. */
export function validarEndereco(tipo: string, endereco: string): string | null {
  const e = endereco.trim();
  if (!e) return 'endereco é obrigatório';

  if (tipo === 'whatsapp') {
    // E.164. Número sem o país chega à Meta e falha silenciosamente, com
    // a mensagem "enviada" e ninguém recebendo — o pior modo de falhar.
    if (!/^\+[1-9]\d{7,14}$/.test(e)) {
      return 'whatsapp: número em E.164, com + e país (ex.: +5521988887777)';
    }
    return null;
  }
  if (tipo === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'email: endereço inválido';
    return null;
  }
  if (tipo === 'webhook') {
    let u: URL;
    try {
      u = new URL(e);
    } catch {
      return 'webhook: URL inválida';
    }
    // `http` em claro levaria o alerta — e qualquer token no cabeçalho —
    // por uma rede onde qualquer um lê.
    if (u.protocol !== 'https:') return 'webhook: só https';
    // Um token na querystring vai para todo log de proxy no caminho.
    if (u.search) return 'webhook: sem querystring; segredo vai por segredoRef';
    return null;
  }
  if (tipo === 'kds') {
    // O KDS é integração direta Farol↔Regem: o endereço é a loja do Regem,
    // não uma URL que o usuário digita.
    if (!UUID.test(e)) return 'kds: o id da loja no Regem';
    return null;
  }
  return `tipo: um de ${TIPOS.join(', ')}`;
}

export function rotasDeAlertas(app: FastifyInstance, pool: pg.Pool): void {
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

  // ───────────────────────── destinos ─────────────────────────

  app.get('/v1/lojas/:id/destinos', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };

    const { rows } = await pool.query(
      `select d.id, d.tipo, d.nome, d.endereco, d.papel, d.ativo,
              d.loja_id is null as da_rede,
              d.segredo_ref is not null as tem_segredo
         from destino d
        where d.tenant_id = $2
          and (d.loja_id = $1 or d.loja_id is null)
        order by d.loja_id is null, d.tipo, d.nome`,
      [id, s.tenantId],
    );
    // `segredo_ref` não desce: o console mostra SE existe, nunca o nome da
    // variável. Saber o nome é meio caminho para procurá-la.
    return { destinos: rows };
  });

  app.post('/v1/lojas/:id/destinos', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const c = (req.body ?? {}) as Record<string, unknown>;

    // Recusar ALTO e claro, em vez de ignorar o campo. Ignorar deixaria
    // quem mandou acreditando que a senha foi guardada.
    const proibido = acharCampoProibido(c);
    if (proibido) {
      req.log.warn({ campo: proibido }, 'tentativa de mandar segredo no cadastro de destino');
      return resposta.status(400).send({
        erro: 'segredo_no_corpo',
        mensagem:
          `o campo "${proibido}" não entra aqui. Segredo de integração é ` +
          'guardado pela distribuição; o cadastro leva só o nome da ' +
          'referência, em segredoRef.',
      });
    }

    const tipo = String(c.tipo ?? '');
    if (!TIPOS.includes(tipo)) {
      return resposta.status(422).send({
        erro: 'validacao', mensagem: `tipo: um de ${TIPOS.join(', ')}`,
      });
    }
    const nome = String(c.nome ?? '').trim();
    if (!nome) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'nome é obrigatório' });
    }
    const problema = validarEndereco(tipo, String(c.endereco ?? ''));
    if (problema) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: problema });
    }

    // Loja da rede (`daRede: true`) exige nível de configurar no tenant, e
    // é o que `exigirConfigurar` já garantiu.
    const daRede = c.daRede === true;

    try {
      const { rows } = await pool.query(
        `insert into destino (tenant_id, loja_id, tipo, nome, endereco, papel, segredo_ref)
         select $1,
                case when $7::boolean then null else l.id end,
                $2, $3, $4, $5, $6
           from loja l
          where l.id = $8 and l.tenant_id = $1
        returning id, tipo, nome, endereco, papel, ativo, loja_id is null as da_rede`,
        [
          s.tenantId, tipo, nome, String(c.endereco).trim(),
          c.papel ? String(c.papel) : null,
          c.segredoRef ? String(c.segredoRef) : null,
          daRede, id,
        ],
      );
      if (rows.length === 0) {
        return resposta.status(404).send({
          erro: 'loja_nao_encontrada', mensagem: 'loja não encontrada nesta conta',
        });
      }
      return resposta.status(201).send({ destino: rows[0] });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        return resposta.status(409).send({
          erro: 'destino_repetido',
          mensagem:
            'este endereço já está cadastrado neste escopo. Dois cadastros ' +
            'iguais mandariam o mesmo aviso duas vezes.',
        });
      }
      throw e;
    }
  });

  app.patch('/v1/destinos/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const c = (req.body ?? {}) as Record<string, unknown>;

    const proibido = acharCampoProibido(c);
    if (proibido) {
      return resposta.status(400).send({
        erro: 'segredo_no_corpo', mensagem: `o campo "${proibido}" não entra aqui`,
      });
    }

    // Ausente mantém; `null` não é "apagar" por acidente. Só `ativo` e
    // `nome` mudam — trocar o endereço de um destino existente mascararia
    // o histórico de envios, que aponta para o destino, não para o texto.
    if (c.ativo !== undefined && typeof c.ativo !== 'boolean') {
      return resposta.status(422).send({
        erro: 'validacao', mensagem: 'ativo: true ou false',
      });
    }

    const { rows } = await pool.query(
      `update destino
          set nome  = coalesce($3, nome),
              ativo = coalesce($4, ativo),
              atualizado_em = now()
        where id = $1 and tenant_id = $2
      returning id, tipo, nome, endereco, papel, ativo`,
      [id, s.tenantId, c.nome != null ? String(c.nome).trim() : null,
       c.ativo === undefined ? null : c.ativo],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado' });
    }
    return { destino: rows[0] };
  });

  // ───────────────────────── política ─────────────────────────

  app.get('/v1/lojas/:id/politicas', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };

    const { rows } = await pool.query(
      `select p.id, p.severidade, p.prioridade, p.enviar, p.destino_id,
              p.loja_id is null as da_rede,
              d.nome as destino_nome, d.tipo as destino_tipo
         from politica_alerta p
         left join destino d on d.id = p.destino_id
        where p.tenant_id = $2 and (p.loja_id = $1 or p.loja_id is null)
        order by p.loja_id is null, p.enviar, p.severidade, p.prioridade`,
      [id, s.tenantId],
    );

    // A tela precisa dizer QUAL escopo está valendo, senão quem configura
    // não entende por que a linha da rede não tem efeito.
    const temDaLoja = rows.some((r) => r.da_rede === false);
    return {
      politicas: rows,
      escopo_vigente: temDaLoja ? 'loja' : 'rede',
      explicacao: temDaLoja
        ? 'esta loja tem política própria; as linhas da rede estão listadas mas não valem aqui'
        : 'esta loja segue o padrão da rede',
    };
  });

  app.post('/v1/lojas/:id/politicas', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const c = (req.body ?? {}) as Record<string, unknown>;

    if (c.severidade != null && !SEVERIDADES.includes(String(c.severidade))) {
      return resposta.status(422).send({
        erro: 'validacao', mensagem: `severidade: um de ${SEVERIDADES.join(', ')} ou nulo`,
      });
    }
    if (c.prioridade != null && !PRIORIDADES.includes(String(c.prioridade))) {
      return resposta.status(422).send({
        erro: 'validacao', mensagem: `prioridade: um de ${PRIORIDADES.join(', ')} ou nulo`,
      });
    }
    const enviar = c.enviar !== false;
    if (enviar && !UUID.test(String(c.destinoId ?? ''))) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: 'para enviar, destinoId é obrigatório — enviar para ninguém não quer dizer nada',
      });
    }
    if (!enviar && c.destinoId) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: 'veto não leva destino: ele silencia a combinação inteira',
      });
    }

    // O destino tem que ser do mesmo tenant: sem esta checagem, alguém
    // apontaria a política para o celular de outra conta.
    const { rows } = await pool.query(
      `insert into politica_alerta
            (tenant_id, loja_id, severidade, prioridade, enviar, destino_id)
       select $1,
              case when $6::boolean then null else l.id end,
              $2, $3, $4,
              case when $4::boolean then d.id else null end
         from loja l
         left join destino d on d.id = $5::uuid and d.tenant_id = $1
        where l.id = $7 and l.tenant_id = $1
          and ($4::boolean is false or d.id is not null)
      returning id, severidade, prioridade, enviar, destino_id`,
      [s.tenantId, c.severidade ?? null, c.prioridade ?? null, enviar,
       c.destinoId ?? null, c.daRede === true, id],
    );
    if (rows.length === 0) {
      return resposta.status(404).send({
        erro: 'nao_encontrado',
        mensagem: 'loja ou destino não encontrado nesta conta',
      });
    }
    return resposta.status(201).send({ politica: rows[0] });
  });

  app.delete('/v1/politicas/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    const r = await pool.query(
      'delete from politica_alerta where id = $1 and tenant_id = $2',
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return resposta.status(404).send({ erro: 'nao_encontrado' });
    return { removida: true };
  });

  // ──────────────── o console pergunta: chegou? ────────────────

  app.get('/v1/lojas/:id/envios', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    const q = req.query as { estado?: string; limite?: string };

    const limite = Math.min(Math.max(Number(q.limite ?? 50) || 50, 1), 200);

    const { rows } = await pool.query(
      `select e.id, e.motivo, e.estado, e.tentativas, e.erro,
              e.criado_em, e.despachado_em, e.confirmado_em,
              -- o aviso da máquina (migration 059): 'esquentando' ou 'sobrecarregado'
              case when e.motivo = 'computador' then e.payload->>'tipo' end as computador,
              d.tipo as destino_tipo, d.nome as destino_nome,
              ev.ocorrido_em, r.nome as regra_nome
         from envio e
         join destino d on d.id = e.destino_id
         left join evento ev on ev.id = e.evento_id
         left join regra r on r.id = ev.regra_id
        where e.tenant_id = $2 and e.loja_id = $1
          and ($3::text is null or e.estado = $3)
        order by e.criado_em desc
        limit $4`,
      [id, s.tenantId, q.estado ?? null, limite],
    );
    return { envios: rows };
  });

  // ──────────────── o transporte: puxa, entrega, responde ────────────────

  app.post('/v1/envios/reivindicar', async (req, resposta) => {
    // A credencial do TRANSPORTE: ver a nota no topo. Nem o agente (que não
    // pode entregar o aviso de que ele mesmo caiu) nem a chave geral.
    let t: TransporteAutenticado;
    try {
      t = await autenticarTransporte(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'transporte recusado');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const c = (req.body ?? {}) as { limite?: number; tipos?: unknown };
    const limite = Math.min(Math.max(Number(c.limite ?? 20) || 20, 1), MAX_REIVINDICAR);
    // Os tipos pedidos valem DENTRO dos que cabem a este transporte; sem
    // pedido, todos os dele. Pedir só tipo alheio é não levar nada.
    const pedidos = Array.isArray(c.tipos)
      ? c.tipos.filter((x): x is string => typeof x === 'string' && TIPOS.includes(x))
      : null;
    const tipos = pedidos ? t.tipos.filter((x) => pedidos.includes(x)) : t.tipos;

    // `skip locked` é o que permite dois trabalhadores do n8n rodarem
    // juntos sem mandar a mesma mensagem duas vezes — e sem um esperar o
    // outro, que é como uma fila de alertas vira atraso de alertas.
    //
    // A ordem é por severidade do aviso antes da data: numa volta de
    // internet com mil envios acumulados, o agente caído e a emergência
    // têm que sair antes do aviso leve de ontem.
    const { rows } = await pool.query(
      `with alvo as (
         select e.id
           from envio e
           join destino d on d.id = e.destino_id
          where e.estado in ('pendente','falhou')
            and e.tentativas < 5
            and d.tipo = any($1::text[])
          order by (e.motivo = 'agente_caiu') desc, e.criado_em
          limit $2
          for update of e skip locked
       )
       update envio e
          set estado = 'enviado',
              tentativas = e.tentativas + 1,
              despachado_em = now(),
              transporte_id = $3
         from alvo
        where e.id = alvo.id
      returning e.id, e.motivo, e.payload, e.tentativas, e.loja_id, e.evento_id,
                (select d.tipo from destino d where d.id = e.destino_id) as destino_tipo,
                (select d.endereco from destino d where d.id = e.destino_id) as destino_endereco,
                (select d.segredo_ref from destino d where d.id = e.destino_id) as segredo_ref`,
      [tipos, limite, t.transporteId],
    );
    if (rows.length > 0) req.log.info({ transporte: t.nome, levados: rows.length }, 'transporte reivindicou');

    return { envios: rows };
  });

  app.post('/v1/envios/:id/resultado', async (req, resposta) => {
    let t: TransporteAutenticado;
    try {
      t = await autenticarTransporte(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'transporte recusado');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const { id } = req.params as { id: string };
    // Id que não é uuid é envio que não existe: 404, e não um erro do banco.
    if (!UUID.test(id)) return resposta.status(404).send({ erro: 'nao_encontrado' });
    const c = (req.body ?? {}) as { entregue?: unknown; erro?: unknown };

    if (typeof c.entregue !== 'boolean') {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem:
          'entregue: true ou false. "Mandei" e "chegou" são fatos diferentes, ' +
          'e a diferença entre eles é o que explica um alerta que ninguém viu.',
      });
    }

    const { rows } = await pool.query(
      `update envio
          set estado = case when $2::boolean then 'entregue' else 'falhou' end,
              confirmado_em = case when $2::boolean then now() else confirmado_em end,
              erro = case when $2::boolean then null else $3 end
        where id = $1 and transporte_id = $4
      returning id, estado, tentativas`,
      [id, c.entregue, c.erro ? String(c.erro).slice(0, 500) : null, t.transporteId],
    );
    // O envio de OUTRO transporte (ou que ninguém reivindicou) é, para este, um envio que não existe.
    if (rows.length === 0) return resposta.status(404).send({ erro: 'nao_encontrado' });
    return { envio: rows[0] };
  });
}
