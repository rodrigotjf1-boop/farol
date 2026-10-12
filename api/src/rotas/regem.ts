// =====================================================================
// A conexão da conta com o Regem
// =====================================================================
// O Regem é onde a loja cadastra o cardápio e as fichas técnicas. Aqui a
// CONTA do Farol se conecta a ele, e cada loja de lá é ligada a uma loja
// daqui. O que se lê por essa conexão (fichas, produtos, fila) fica para
// quem lê — este arquivo só cuida de conectar, ligar e desconectar.
//
// O caminho:
//
//   1. `POST /v1/regem/conectar` — a diretoria pede; nasce um pedido (o
//      `state` e o verificador do PKCE) e volta o endereço da página de
//      autorização do Regem;
//   2. a pessoa autoriza lá e o Regem a devolve a `GET /v1/regem/retorno`,
//      com o código. O servidor troca o código pelo acesso de cada loja
//      autorizada e guarda cada um, cifrado, ainda sem loja do Farol;
//   3. `PUT /v1/regem/lojas` — a diretoria diz qual loja do Farol é cada
//      uma. A que ficar sem par tem o acesso devolvido;
//   4. `POST /v1/regem/lojas/:id/desconectar` — devolve o acesso de uma loja
//      e apaga a ligação.
//
// E uma rota que NÃO é do console: `POST /v1/regem/avisos/:conexaoId`, por
// onde o Regem avisa "algo mudou nesta loja" (`aviso.ts`). Quem chama é o
// servidor do Regem, sem sessão: o que a protege é a assinatura do aviso.
//
// QUEM PODE. Ver a conexão: quem configura a conta (gerente para cima, e o
// suporte). Conectar, ligar e desconectar: **só a diretoria** — nem o
// suporte. Deixar outro sistema ser lido é decisão do dono do negócio
// (decisão dele, 11/10/2026).
//
// O QUE NUNCA SAI DAQUI. O acesso de uma loja no Regem não é devolvido por
// rota nenhuma, não desce para o agente e não entra em registro — nem o
// código da autorização, nem o `state`. A rota da volta tem o registro de
// pedidos desligado por isso: o endereço dela carrega os dois.
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { chaveDoSegredo, conferirAviso, contextoDoAviso } from '../aviso.js';
import { cifrar, decifrar } from '../cifra.js';
import { LEITURA_MORTA_MIN, lerEmSegundoPlano } from '../leitura.js';
import { sugerirPares } from '../pares.js';
import { ehDiretoria, exigirDiretoria, podeConfigurar } from '../rbac.js';
import {
  conexaoDisponivel,
  contextoDoAcesso,
  devolverAcesso,
  ErroDoRegem,
  impressao,
  novoPedido,
  trocarCodigo,
  urlDeAutorizacao,
  type ConfigDoRegem,
} from '../regem.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quanto vale um pedido de conexão, da ida ao Regem até a volta. O código de lá vale o mesmo. */
export const VALIDADE_DO_PEDIDO_MIN = 10;
/** Quantas lojas uma chamada liga ou descarta — o mesmo teto de uma autorização do Regem. */
const MAX_PARES = 200;
/** Quantos acessos são devolvidos ao Regem ao mesmo tempo. */
const DEVOLUCOES_JUNTAS = 4;

// O que volta do Regem na barra de endereço. Só caracteres visíveis: o que
// não tem essa cara nem é procurado.
const ESTADO = /^[\x21-\x7E]{16,200}$/;
const CODIGO = /^[\x21-\x7E]{8,300}$/;

/** Como a volta terminou. É o que o console lê em `/conexoes?regem=…`. */
export type DesfechoDaVolta =
  | 'autorizado'
  | 'cancelado'
  | 'vencido'
  | 'outra_conta'
  | 'sem_sessao'
  | 'sem_permissao'
  | 'invalido'
  | 'falhou';

const contextoDoPedido = (estadoHash: string) => `pedido:${estadoHash}`;

/** O maior aviso que se aceita ler. O do Regem tem menos de 200 bytes. */
const MAX_DO_AVISO = 4096;
/** Aviso que chega com a última leitura mais recente do que isto só marca a loja: quem lê é a rotina, em até um minuto. */
const FOLGA_ENTRE_LEITURAS_S = 15;

type Linha = {
  id: string;
  loja_id: string | null;
  loja_nome: string | null;
  regem_loja_id: string;
  regem_loja_nome: string;
  regem_empresa_nome: string;
  acesso_cifrado: string;
  conectado_em: Date;
  ligado_em: Date | null;
};

/** O estado da leitura das fichas, como vem do banco. */
export type LeituraDaLinha = {
  fuso: string | null;
  lida_em: Date | null;
  falha: string | null;
  acesso_tirado_em: Date | null;
  lendo: boolean;
  produtos: number | null;
  com_ficha: number | null;
};

/**
 * O estado da leitura, como a tela o diz. O MOTIVO da falha não vai: é
 * assunto de quem cuida do sistema (está no registro), e para quem olha a
 * tela a consequência é uma só — a busca falhou, e ele tenta de novo.
 */
export function leituraParaTela(r: Pick<LeituraDaLinha, 'lida_em' | 'falha' | 'acesso_tirado_em' | 'lendo'>) {
  return {
    /** A última busca que deu certo. Nulo = ainda não conseguiu ler. */
    lidaEm: r.lida_em,
    /** A última tentativa falhou: o que a loja tem é o da última busca boa. */
    falhou: r.falha !== null,
    /** Há uma busca em curso agora. */
    lendo: r.lendo,
    /** O Regem tirou o acesso desta loja: as fichas dela foram apagadas. */
    acessoTiradoEm: r.acesso_tirado_em,
  };
}

const INDISPONIVEL = {
  erro: 'conexao_indisponivel',
  mensagem: 'a conexão com o Regem ainda não está disponível nesta instalação. Fale com quem cuida do Farol',
};

export function rotasDoRegem(app: FastifyInstance, pool: pg.Pool, cfg: ConfigDoRegem): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }

  /**
   * Devolve ao Regem o acesso de uma linha. Três desfechos, e só o último
   * mantém a linha:
   *
   *   devolvido     o Regem aceitou (ou o acesso já não valia lá);
   *   sem_devolver  não há o que tentar de novo — o acesso guardado não dá
   *                 para ler, ou o Regem recusou o pedido. A ligação sai
   *                 daqui, e o acesso se tira pelo próprio Regem;
   *   sem_resposta  o Regem não respondeu (ou quem respondeu não foi ele).
   *                 Vale tentar de novo: a linha fica.
   */
  async function devolver(
    tenantId: string,
    l: Pick<Linha, 'id' | 'regem_loja_id' | 'acesso_cifrado'>,
    log: FastifyRequest['log'],
  ): Promise<'devolvido' | 'sem_devolver' | 'sem_resposta'> {
    const acesso = cfg.chave ? decifrar(l.acesso_cifrado, cfg.chave, contextoDoAcesso(tenantId, l.regem_loja_id)) : null;
    if (!acesso) {
      log.error({ regemLoja: l.id }, 'regem: o acesso guardado não pôde ser lido (a chave do ambiente mudou?)');
      return 'sem_devolver';
    }
    try {
      await devolverAcesso(cfg, acesso);
      return 'devolvido';
    } catch (e) {
      if (!(e instanceof ErroDoRegem)) throw e;
      log.warn({ regemLoja: l.id, motivo: e.motivo, status: e.status }, 'regem: o acesso não foi devolvido');
      // Só a recusa DO REGEM encerra o assunto. Resposta que não é dele
      // (uma página da borda no lugar do JSON) é como não ter respondido.
      return e.motivo === 'recusado' ? 'sem_devolver' : 'sem_resposta';
    }
  }

  // ─────────────────────── como está a conexão ───────────────────────

  app.get('/v1/regem', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!podeConfigurar(s)) {
      return resposta.status(403).send({
        erro: 'sem_permissao',
        mensagem: 'seu perfil não vê as conexões da conta',
      });
    }

    const [lojas, linhas] = await Promise.all([
      // A loja que recebe as fichas de OUTRO sistema não é opção para ligar: uma loja recebe de um lugar só.
      pool.query<{ id: string; nome: string }>(
        `select l.id, l.nome
           from loja l
          where l.tenant_id = $1
            and not exists (select 1 from acesso_externo a where a.loja_id = l.id and a.revogado_em is null)
          order by l.nome, l.id`,
        [s.tenantId],
      ),
      // O acesso cifrado NÃO entra nesta consulta: o que a tela não mostra,
      // a rota nem busca.
      pool.query<Omit<Linha, 'acesso_cifrado'> & LeituraDaLinha>(
        `select r.id, r.loja_id, l.nome as loja_nome, r.regem_loja_id, r.regem_loja_nome,
                r.regem_empresa_nome, r.conectado_em, r.ligado_em,
                l.timezone as fuso, r.lida_em, r.falha, r.acesso_tirado_em,
                (r.lendo_desde is not null and r.lendo_desde > now() - make_interval(mins => $2)) as lendo,
                f.produtos, f.com_ficha
           from regem_loja r
           left join loja l on l.id = r.loja_id
           -- Só a base que veio DO REGEM: a loja que tinha fichas de planilha e acabou de ser ligada ainda não tem.
           left join fichas_da_loja f on f.loja_id = r.loja_id and f.fonte = 'regem'
          where r.tenant_id = $1
          order by r.regem_empresa_nome, r.regem_loja_nome, r.id`,
        [s.tenantId, LEITURA_MORTA_MIN],
      ),
    ]);

    const ligadas = linhas.rows.filter((r) => r.loja_id !== null);
    const esperando = linhas.rows.filter((r) => r.loja_id === null);
    const comPar = new Set(ligadas.map((r) => r.loja_id));
    const livres = lojas.rows.filter((l) => !comPar.has(l.id));
    const sugestao = sugerirPares(
      esperando.map((r) => ({ id: r.id, nome: r.regem_loja_nome })),
      livres,
    );

    return {
      /** A instalação tem o que precisa para conectar. Sem isso, o botão nem aparece. */
      disponivel: conexaoDisponivel(cfg),
      /** Só a diretoria conecta, liga e desconecta. */
      podeConectar: ehDiretoria(s),
      /** As lojas do Farol que ainda não têm par: as opções de quem vai ligar. */
      lojasLivres: livres,
      /** Autorizadas no Regem, esperando alguém dizer qual loja do Farol é cada uma. */
      esperando: esperando.map((r) => ({
        id: r.id,
        regemLojaNome: r.regem_loja_nome,
        regemEmpresaNome: r.regem_empresa_nome,
        autorizadaEm: r.conectado_em,
        sugestaoLojaId: sugestao.get(r.id) ?? null,
      })),
      ligadas: ligadas.map((r) => ({
        id: r.id,
        lojaId: r.loja_id,
        lojaNome: r.loja_nome,
        regemLojaNome: r.regem_loja_nome,
        regemEmpresaNome: r.regem_empresa_nome,
        ligadaEm: r.ligado_em,
        /** O relógio da loja: é nele que a tela diz "hoje, 04:10". */
        fuso: r.fuso,
        leitura: leituraParaTela(r),
        /** O que a base da loja tem. Nulo = ainda não há base (nunca leu, ou foi apagada). */
        produtos: r.produtos,
        comFicha: r.com_ficha,
      })),
    };
  });

  // ───────────────────────────── a ida ─────────────────────────────

  app.post('/v1/regem/conectar', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;
    if (!conexaoDisponivel(cfg)) return resposta.status(503).send(INDISPONIVEL);

    const p = novoPedido();
    const estadoHash = impressao(p.state);

    // Um pedido em curso por pessoa: o que ela largou no meio deixa de
    // valer. De passagem, saem os vencidos de qualquer conta — é aqui que
    // a tabela se limpa, sem rotina à parte.
    await pool.query('delete from regem_pedido where usuario_id = $1 or expira_em < now()', [s.usuarioId]);
    await pool.query(
      `insert into regem_pedido (tenant_id, usuario_id, estado_hash, verificador_cifrado, expira_em)
       values ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
      [s.tenantId, s.usuarioId, estadoHash, cifrar(p.verificador, cfg.chave, contextoDoPedido(estadoHash)), VALIDADE_DO_PEDIDO_MIN],
    );

    return { url: urlDeAutorizacao(cfg, p) };
  });

  // ───────────────────────────── a volta ─────────────────────────────
  // É uma NAVEGAÇÃO do navegador, não uma chamada da tela: a resposta é
  // sempre um redirecionamento para o console, com o desfecho. Chega pelo
  // endereço do console (que repassa para cá), e por isso traz a sessão de
  // quem começou — é o que prende a volta à pessoa que pediu.
  //
  // `logLevel: 'warn'`: o registro de pedidos anotaria o endereço, e o
  // endereço traz o código e o `state`.

  app.get('/v1/regem/retorno', { logLevel: 'warn' }, async (req, resposta) => {
    const paraOConsole = (como: DesfechoDaVolta) =>
      resposta
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .redirect(`${cfg.consoleUrl}/conexoes?regem=${como}`, 303);

    try {
      return paraOConsole(await desfechoDaVolta(req));
    } catch (e) {
      // Quem está aqui é uma pessoa no meio de uma navegação: um erro em
      // JSON na tela não diz nada a ela. O erro inteiro vai para o
      // registro (ele não leva o endereço), e ela volta ao console.
      req.log.error({ err: e }, 'regem: a volta falhou de um jeito que não devia');
      return paraOConsole('falhou');
    }
  });

  async function desfechoDaVolta(req: FastifyRequest): Promise<DesfechoDaVolta> {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const estado = typeof q.state === 'string' && ESTADO.test(q.state) ? q.state : null;
    if (!estado) return 'invalido';

    // Sem sessão o pedido NÃO é gasto: quem chega aqui sem estar logado não
    // é, que se saiba, quem começou.
    const s = await sessaoDe(pool, req);
    if (!s) return 'sem_sessao';

    // O pedido é gasto AGORA, numa instrução só, qualquer que seja o
    // desfecho daqui para baixo: duas voltas com o mesmo `state` (a aba
    // recarregada, o endereço reaproveitado) não passam as duas.
    const estadoHash = impressao(estado);
    const gasto = await pool.query<{
      tenant_id: string;
      usuario_id: string;
      verificador_cifrado: string;
      de_pe: boolean;
    }>(
      `update regem_pedido set usado_em = now()
        where estado_hash = $1 and usado_em is null
        returning tenant_id, usuario_id, verificador_cifrado, expira_em > now() as de_pe`,
      [estadoHash],
    );
    const pedido = gasto.rows[0];
    if (!pedido) return 'invalido';
    if (pedido.usuario_id !== s.usuarioId || pedido.tenant_id !== s.tenantId) return 'outra_conta';
    if (!pedido.de_pe) return 'vencido';
    // Quem começou pode ter deixado de ser da diretoria no caminho.
    if (!ehDiretoria(s)) return 'sem_permissao';

    // A pessoa desistiu lá (ou o Regem recusou o pedido): não há código.
    if (q.error !== undefined) return 'cancelado';
    const codigo = typeof q.code === 'string' && CODIGO.test(q.code) ? q.code : null;
    if (!codigo) return 'invalido';

    if (!conexaoDisponivel(cfg)) return 'falhou';
    const verificador = decifrar(pedido.verificador_cifrado, cfg.chave, contextoDoPedido(estadoHash));
    if (!verificador) {
      req.log.error('regem: o verificador do pedido não pôde ser lido (a chave do ambiente mudou no meio do caminho?)');
      return 'falhou';
    }

    let lojas;
    try {
      lojas = await trocarCodigo(cfg, { codigo, verificador });
    } catch (e) {
      if (!(e instanceof ErroDoRegem)) throw e;
      // O MOTIVO, sem o conteúdo. `cliente_invalido` é defeito da
      // instalação (o segredo daqui não é o de lá), e ninguém na tela
      // resolve: por isso o nível de erro.
      const registro = { motivo: e.motivo, status: e.status };
      if (e.motivo === 'cliente_invalido') req.log.error(registro, 'regem: o segredo do aplicativo não confere com o do Regem');
      else req.log.warn(registro, 'regem: a troca do código falhou');
      return 'falhou';
    }

    // Uma linha por loja autorizada, numa instrução só. A loja que já
    // estava na conta troca o acesso e MANTÉM o par: autorizar de novo não
    // desfaz o que a diretoria já ligou. (O acesso antigo deixou de valer
    // no Regem no instante da troca.) Com o acesso novo, o estado da
    // leitura recomeça: "acesso tirado" e a falha de antes deixam de valer,
    // e a agenda vazia põe a loja na frente da fila.
    const gravadas = await pool.query<{ id: string; loja_id: string | null }>(
      `insert into regem_loja (tenant_id, regem_loja_id, regem_loja_nome, regem_empresa_nome, acesso_cifrado, conectado_por)
       select $1, v.regem_loja_id, v.nome, v.empresa, v.acesso, $2
         from unnest($3::uuid[], $4::text[], $5::text[], $6::text[]) as v(regem_loja_id, nome, empresa, acesso)
       on conflict (tenant_id, regem_loja_id) do update
          set regem_loja_nome = excluded.regem_loja_nome,
              regem_empresa_nome = excluded.regem_empresa_nome,
              acesso_cifrado = excluded.acesso_cifrado,
              conectado_por = excluded.conectado_por,
              conectado_em = now(),
              acesso_tirado_em = null, falha = null, proxima_em = null, lendo_desde = null,
              versao_catalogo = null, versao_fichas = null,
              -- o aviso era do acesso de antes: com o novo, registra-se de novo (o segredo guardado serve)
              aviso_registrado_em = null, aviso_tentado_em = null
       returning id, loja_id`,
      [
        s.tenantId,
        s.usuarioId,
        lojas.map((l) => l.regemLojaId),
        lojas.map((l) => l.nome),
        lojas.map((l) => l.empresa),
        lojas.map((l) => cifrar(l.acesso, cfg.chave, contextoDoAcesso(s.tenantId, l.regemLojaId))),
      ],
    );
    // A loja que já tinha par volta a ser lida agora, sem esperar a rotina.
    lerEmSegundoPlano(
      pool,
      cfg,
      gravadas.rows.filter((g) => g.loja_id !== null).map((g) => g.id),
      app.log,
    );
    // Pelo registro da APLICAÇÃO: o desta rota só fala de aviso para cima.
    app.log.info({ lojas: lojas.length }, 'regem: lojas autorizadas');
    return 'autorizado';
  }

  // ─────────────────────── ligar (ou não usar) ───────────────────────

  app.put('/v1/regem/lojas', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;

    const corpo = (req.body ?? {}) as { pares?: unknown };
    const invalido = (mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });
    if (!Array.isArray(corpo.pares) || corpo.pares.length === 0) return invalido('informe os pares: qual loja do Farol é cada loja do Regem');
    if (corpo.pares.length > MAX_PARES) return invalido(`lojas demais numa chamada só (até ${MAX_PARES})`);

    const pares: Array<{ id: string; lojaId: string | null }> = [];
    for (const bruto of corpo.pares as Array<{ id?: unknown; lojaId?: unknown }>) {
      const id = typeof bruto?.id === 'string' && UUID.test(bruto.id) ? bruto.id.toLowerCase() : null;
      const semPar = bruto?.lojaId === null;
      const lojaId = typeof bruto?.lojaId === 'string' && UUID.test(bruto.lojaId) ? bruto.lojaId.toLowerCase() : null;
      if (!id || (!semPar && !lojaId)) return invalido('cada par leva o id da loja do Regem e a loja do Farol (ou nulo, para não usar)');
      pares.push({ id, lojaId });
    }
    if (new Set(pares.map((p) => p.id)).size !== pares.length) return invalido('a mesma loja do Regem veio duas vezes');
    const ligar = pares.filter((p): p is { id: string; lojaId: string } => p.lojaId !== null);
    const descartar = pares.filter((p) => p.lojaId === null);
    if (new Set(ligar.map((p) => p.lojaId)).size !== ligar.length) {
      return resposta.status(422).send({
        erro: 'loja_repetida',
        mensagem: 'duas lojas do Regem na mesma loja do Farol. Cada loja do Farol é par de uma só',
      });
    }

    // Tudo conferido ANTES de mexer em qualquer coisa: as linhas são desta
    // conta e ainda esperam par; as lojas do Farol são desta conta.
    const [esperando, daConta] = await Promise.all([
      pool.query<Pick<Linha, 'id' | 'regem_loja_id' | 'regem_loja_nome' | 'acesso_cifrado'>>(
        `select id, regem_loja_id, regem_loja_nome, acesso_cifrado
           from regem_loja
          where tenant_id = $1 and id = any($2::uuid[]) and loja_id is null`,
        [s.tenantId, pares.map((p) => p.id)],
      ),
      pool.query('select id from loja where tenant_id = $1 and id = any($2::uuid[])', [s.tenantId, ligar.map((p) => p.lojaId)]),
    ]);
    if (esperando.rowCount !== pares.length) {
      return resposta.status(404).send({
        erro: 'nao_encontrado',
        mensagem: 'uma dessas lojas do Regem não está esperando para ser ligada. Recarregue a tela',
      });
    }
    if (daConta.rowCount !== ligar.length) {
      return resposta.status(404).send({ erro: 'loja_nao_encontrada', mensagem: 'não existe essa loja do Farol' });
    }

    // ── ligar: todas ou nenhuma ──
    if (ligar.length > 0) {
      // Client dedicado: transação só vale na MESMA conexão.
      const cliente = await pool.connect();
      try {
        await cliente.query('begin');
        // Uma loja recebe as fichas de um lugar só. A linha de cada loja fica travada até o fim (quem estiver
        // criando um acesso de outro sistema para ela espera aqui, e vice-versa), e a que já tem acesso não é ligada.
        // A trava é a que NÃO barra quem só aponta para a loja (`no key update`): gravar uma ficha ou um evento
        // dela continua passando.
        //
        // DUAS instruções, de propósito: primeiro a trava, depois a conferência. Numa instrução só, quem ficou
        // esperando a trava confere com o retrato de ANTES da espera — e não vê o acesso que a outra pessoa
        // acabou de criar (o teste das duas pessoas ao mesmo tempo pegou isso).
        await cliente.query('select id from loja where tenant_id = $1 and id = any($2::uuid[]) order by id for no key update', [s.tenantId, ligar.map((p) => p.lojaId)]);
        const comAcesso = await cliente.query<{ nome: string; sistema: string }>(
          `select l.nome, a.nome as sistema
             from loja l
             join acesso_externo a on a.loja_id = l.id and a.revogado_em is null
            where l.tenant_id = $1 and l.id = any($2::uuid[])
            order by l.nome, l.id`,
          [s.tenantId, ligar.map((p) => p.lojaId)],
        );
        const ocupada = comAcesso.rows[0];
        if (ocupada) {
          await cliente.query('rollback');
          return resposta.status(409).send({
            erro: 'origem_ocupada',
            mensagem: `a ${ocupada.nome} recebe as fichas de outro sistema (${ocupada.sistema}). Uma loja recebe de um lugar só: revogue o acesso dele antes de ligá-la ao Regem`,
          });
        }
        const r = await cliente.query(
          `update regem_loja r
              set loja_id = v.loja_id, ligado_em = now()
             from unnest($2::uuid[], $3::uuid[]) as v(id, loja_id)
            where r.id = v.id and r.tenant_id = $1 and r.loja_id is null`,
          [s.tenantId, ligar.map((p) => p.id), ligar.map((p) => p.lojaId)],
        );
        // Alguém ligou ou descartou uma delas entre a conferência e aqui.
        if (r.rowCount !== ligar.length) {
          await cliente.query('rollback');
          return resposta.status(409).send({
            erro: 'mudou',
            mensagem: 'a lista de lojas mudou enquanto você escolhia. Recarregue a tela',
          });
        }
        await cliente.query('commit');
      } catch (e) {
        await cliente.query('rollback').catch(() => {});
        // A regra "uma loja do Farol, um par" é do banco (índice único):
        // quem chegou depois numa corrida recebe o motivo, não um 500.
        if ((e as { code?: string }).code === '23505') {
          return resposta.status(409).send({
            erro: 'loja_ja_ligada',
            mensagem: 'uma dessas lojas do Farol já está ligada a outra loja do Regem',
          });
        }
        throw e;
      } finally {
        cliente.release();
      }
    }

    // A loja que acabou de ser ligada é lida agora, sem segurar a resposta:
    // a tela diz "o Farol está buscando as fichas" e pergunta de novo em seguida.
    lerEmSegundoPlano(
      pool,
      cfg,
      ligar.map((p) => p.id),
      app.log,
    );

    // ── não usar: devolve o acesso e apaga a linha ──
    // Depois de ligar, e loja a loja: cada devolução é uma chamada ao
    // Regem. A que ele não responder FICA esperando — a resposta diz qual.
    const alvos = esperando.rows.filter((l) => descartar.some((p) => p.id === l.id));
    const sair: string[] = [];
    const ficaram: Array<{ id: string; regemLojaNome: string }> = [];
    for (let i = 0; i < alvos.length; i += DEVOLUCOES_JUNTAS) {
      const leva = alvos.slice(i, i + DEVOLUCOES_JUNTAS);
      const desfechos = await Promise.all(leva.map((l) => devolver(s.tenantId, l, req.log)));
      leva.forEach((l, j) => {
        if (desfechos[j] === 'sem_resposta') ficaram.push({ id: l.id, regemLojaNome: l.regem_loja_nome });
        else sair.push(l.id);
      });
    }
    if (sair.length > 0) {
      await pool.query('delete from regem_loja where tenant_id = $1 and id = any($2::uuid[]) and loja_id is null', [s.tenantId, sair]);
    }

    req.log.info({ ligadas: ligar.length, descartadas: sair.length, ficaram: ficaram.length }, 'regem: lojas ligadas');
    return {
      ligadas: ligar.length,
      descartadas: sair.length,
      /** O Regem não respondeu: o acesso destas não foi devolvido, e elas seguem esperando. */
      naoDescartadas: ficaram,
    };
  });

  // ─────────────────────────── desconectar ───────────────────────────

  app.post('/v1/regem/lojas/:id/desconectar', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;

    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });

    // O filtro por conta vai na MESMA consulta: a ligação do vizinho é 404.
    const { rows } = await pool.query<Pick<Linha, 'id' | 'regem_loja_id' | 'regem_loja_nome' | 'acesso_cifrado' | 'loja_nome'>>(
      `select r.id, r.regem_loja_id, r.regem_loja_nome, r.acesso_cifrado, l.nome as loja_nome
         from regem_loja r
         left join loja l on l.id = r.loja_id
        where r.id = $1 and r.tenant_id = $2`,
      [id, s.tenantId],
    );
    const linha = rows[0];
    if (!linha) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'não existe essa conexão' });

    const desfecho = await devolver(s.tenantId, linha, req.log);
    if (desfecho === 'sem_resposta') {
      return resposta.status(502).send({
        erro: 'regem_sem_resposta',
        mensagem: 'o Regem não respondeu agora, e a loja continua conectada. Tente de novo em instantes',
      });
    }

    // A ligação e as fichas que vieram por ela saem JUNTAS, numa instrução
    // só (decisão do dono, 11/10: "ao desconectar, as fichas são apagadas
    // na hora"). Uma leitura que estivesse no meio não as traz de volta: ela
    // só grava com a ligação ainda de pé.
    const apagadas = await pool.query(
      `with saiu as (
         delete from regem_loja where id = $1 and tenant_id = $2 returning loja_id
       )
       delete from fichas_da_loja f using saiu where f.loja_id = saiu.loja_id and f.fonte = 'regem'`,
      [id, s.tenantId],
    );
    const fichasApagadas = (apagadas.rowCount ?? 0) > 0;
    req.log.info({ regemLoja: id, devolvido: desfecho === 'devolvido', fichasApagadas }, 'regem: loja desconectada');
    return {
      desconectada: true,
      /** Falso: a ligação saiu daqui, mas o acesso ainda aparece no Regem — é lá que se tira. */
      devolvido: desfecho === 'devolvido',
      /** A loja tinha fichas vindas do Regem, e elas foram apagadas agora. */
      fichasApagadas,
      lojaNome: linha.loja_nome,
      regemLojaNome: linha.regem_loja_nome,
    };
  });

  // ─────────────────────── o aviso do Regem ───────────────────────
  // Quem chama é o servidor do Regem, sem sessão e sem cookie. O que vale é a
  // assinatura: o segredo é o que ESTE servidor sorteou para esta conexão e
  // entregou ao Regem no registro.
  //
  // Num contexto à parte, porque a assinatura é conferida sobre o texto
  // EXATO que chegou: aqui o corpo não é interpretado, só lido como texto.
  //
  // O que cada resposta diz ao Regem:
  //   204  recebido (a leitura acontece depois, em segundo plano);
  //   401  a assinatura não confere — ele tenta de novo, com recuo;
  //   404  esta conexão não existe (ou não tem aviso): se ficar assim por
  //        uma hora, o Regem para de avisar. É o que se quer depois de
  //        desconectar;
  //   503  esta instalação não tem como conferir agora.
  void app.register(async (escopo) => {
    escopo.removeAllContentTypeParsers();
    escopo.addContentTypeParser('*', { parseAs: 'string', bodyLimit: MAX_DO_AVISO }, (_req, corpo, feito) => feito(null, corpo));

    const umSo = (v: string | string[] | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
    const naoExiste = (resposta: FastifyReply) => resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'não existe esse aviso' });

    escopo.post('/v1/regem/avisos/:conexaoId', { bodyLimit: MAX_DO_AVISO }, async (req, resposta) => {
      const { conexaoId } = req.params as { conexaoId: string };
      if (!UUID.test(conexaoId)) return naoExiste(resposta);
      if (cfg.chave === null) return resposta.status(503).send(INDISPONIVEL);

      const { rows } = await pool.query<{ tenant_id: string; regem_loja_id: string; aviso_segredo_cifrado: string | null }>(
        `select tenant_id, regem_loja_id, aviso_segredo_cifrado
           from regem_loja
          where id = $1 and loja_id is not null and acesso_tirado_em is null`,
        [conexaoId],
      );
      const linha = rows[0];
      const segredo = linha?.aviso_segredo_cifrado ? decifrar(linha.aviso_segredo_cifrado, cfg.chave, contextoDoAviso(linha.tenant_id, linha.regem_loja_id)) : null;
      const chave = segredo ? chaveDoSegredo(segredo) : null;
      // Sem ligação, sem segredo guardado, ou com um que não abre mais: para o Regem é a mesma coisa.
      if (!chave) return naoExiste(resposta);

      const conferencia = conferirAviso({
        id: umSo(req.headers['webhook-id']),
        timestamp: umSo(req.headers['webhook-timestamp']),
        assinatura: umSo(req.headers['webhook-signature']),
        corpo: typeof req.body === 'string' ? req.body : '',
        chave,
        agora: new Date(),
      });
      if (conferencia !== 'ok') {
        req.log.warn({ regemLoja: conexaoId, motivo: conferencia }, 'regem: aviso recusado');
        return resposta.status(401).send({ erro: 'aviso_invalido', mensagem: 'o aviso não tem assinatura válida' });
      }

      // O aviso só MARCA a loja; quem busca é a leitura. Com uma leitura
      // recém-começada, fica para a rotina (em até um minuto): um aviso
      // repetido de propósito não vira uma leitura por pedido.
      const marcada = await pool.query<{ ja: boolean }>(
        `update regem_loja
            set aviso_recebido_em = now(), aviso_pendente_desde = now()
          where id = $1 and loja_id is not null and acesso_tirado_em is null
          returning (tentada_em is null or tentada_em < now() - make_interval(secs => $2)) as ja`,
        [conexaoId, FOLGA_ENTRE_LEITURAS_S],
      );
      if (marcada.rows[0]?.ja) lerEmSegundoPlano(pool, cfg, [conexaoId], app.log);
      return resposta.status(204).send();
    });
  });
}
