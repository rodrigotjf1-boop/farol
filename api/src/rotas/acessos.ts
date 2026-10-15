// =====================================================================
// A porta para outro sistema — o acesso, e o envio das fichas
// =====================================================================
// Pedido do dono em 11/10/2026: a operação que não usa o Regem manda as
// fichas dela ao Farol por uma porta documentada, e o acesso é criado PELO
// PRÓPRIO USUÁRIO, no console — ninguém da distribuição cola credencial por
// cliente. Protótipo aprovado no mesmo dia.
//
// Dois lados moram aqui:
//
//   O CONSOLE (com sessão)
//     GET    /v1/acessos       os acessos da conta, e as lojas com a origem
//                              das fichas de cada uma (quem configura vê);
//     POST   /v1/acessos       cria o acesso de uma loja (só a diretoria): a
//                              resposta traz o CÓDIGO, e é a única vez;
//     DELETE /v1/acessos/:id   revoga (só a diretoria): o sistema deixa de
//                              conseguir enviar na hora, e as fichas que ele
//                              mandou são apagadas.
//
//   A PORTA (sem sessão; `Authorization: Bearer <código de acesso>`)
//     PUT    /v1/integracao/fichas   o sistema envia as fichas da loja. O
//                                    envio é a base INTEIRA: troca o que
//                                    havia;
//     GET    /v1/integracao/fichas   o que o Farol tem desse sistema — para
//                                    quem integra conferir o código e o envio.
//
// O CÓDIGO É SEGREDO. O banco guarda só a impressão dele: quem lê o banco
// não envia nada, e nem a distribuição vê o código de um acesso já criado.
// Ele não entra em registro. A loja e a conta saem DO ACESSO, nunca do corpo
// do envio — trocar um campo não escreve na loja do vizinho.
//
// UMA LOJA RECEBE AS FICHAS DE UM LUGAR SÓ. A loja ligada ao Regem não ganha
// acesso, e a loja com acesso não é ligada ao Regem nem importa planilha. As
// duas pontas travam a linha da loja antes de conferir, para duas pessoas ao
// mesmo tempo não deixarem a loja com as duas origens. A loja com fichas de
// PLANILHA pode ganhar acesso: as da planilha ficam até o sistema enviar as
// dele, e aí as do sistema entram no lugar.
//
// O QUE ENTRA. A forma errada recusa o envio inteiro (422, com o caminho do
// campo). O conteúdo errado deixa aquele produto de fora, e os outros entram
// — a mesma regra da planilha (decisão do dono: "entra o que está certo e a
// tela lista o que ficou de fora"). A resposta diz o que ficou de fora.
//
// A PORTA SEGUE O PADRÃO DMS (Hub DMS, aprovado pelo dono em 14/10/2026):
// erro em `application/problem+json` (com `erro` e `mensagem` do Farol como
// extensão, `porta-problema.ts`); o código revogado responde IGUAL ao que
// nunca existiu; limite de chamadas por acesso e por conta (429 com
// `Retry-After`); código novo no formato `dms_ap_farol_…` com dígitos de
// conferência (o `farol_…` de antes continua valendo); e
// `?somente_validar=true` no envio, que confere sem gravar.
//
// PARTE 2 (protótipo aprovado pelo dono em 15/10/2026, migration 048): o
// código vale 12 meses; renovar troca o código, e o de antes vale mais 7
// dias; 90 dias sem uso, fica suspenso, e reativar é um clique; quem cria
// confirma a senha e aceita o termo (`termo-do-acesso.ts`); a conta tem no
// máximo 10 acessos valendo; os outros da diretoria veem um aviso do que
// alguém fez. Vencido e suspenso não apagam as fichas: só revogar apaga.
// Na porta, os campos seguem o Padrão em snake_case (`com_ficha`).
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { hashDoToken } from '../auth.js';
import { JanelaFixa, POLITICA_CHAVE_PROPRIA, cabecalhoWwwAuthenticate, gerarChave, lerChave, situacaoChave } from '../dms/integracao-dms.js';
import { impressaoDaBase } from '../fichas.js';
import { lerEnvio, type Envio } from '../porta-fichas.js';
import { responderNaPorta } from '../porta-problema.js';
import { ehDiretoria, exigirDiretoria, podeConfigurar } from '../rbac.js';
import { conferirSenha } from '../senha.js';
import { TERMO_DO_ACESSO } from '../termo-do-acesso.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O maior envio que a porta aceita: as fichas de uma loja cabem com folga. */
const MAX_DO_ENVIO = 8 * 1024 * 1024;
/** O tamanho do nome que a conta dá ao sistema (a mesma regra está no banco). */
const MAX_DO_NOME = 40;
// O código de acesso NOVO segue o Padrão DMS: `dms_ap_farol_` + 43 + `_` + 6 dígitos de conferência (`gerarChave`). O
// começo fixo é o que um caça-segredos reconhece num arquivo, e os dígitos recusam o código colado errado sem ir ao banco.
/** O código de antes do Padrão DMS (até 14/10/2026): continua valendo até ser revogado. */
const CODIGO_ANTIGO = /^farol_[A-Za-z0-9_-]{43}$/;

/** Consultas (GET) por minuto, por acesso. */
export const LIMITE_DE_CONSULTAS_POR_MINUTO = 60;
/** Envios (PUT) por hora, por acesso: a ficha muda pouco, e a documentação manda enviar quando muda ou uma vez por dia. */
export const LIMITE_DE_ENVIOS_POR_HORA = 12;
/** Os limites somados da conta inteira (várias lojas, vários acessos). */
export const LIMITE_DE_CONSULTAS_DA_CONTA_POR_MINUTO = 240;
export const LIMITE_DE_ENVIOS_DA_CONTA_POR_HORA = 60;
/**
 * Conferências com `?somente_validar=true` por hora, por acesso. Têm cota própria: não gravam nem fazem o agente da loja
 * baixar nada, e quem está montando a integração confere várias vezes seguidas — na cota dos envios, travaria em 12.
 */
export const LIMITE_DE_VALIDACOES_POR_HORA = 60;

/** A resposta ao código que não vale: a MESMA para o que nunca existiu, o colado errado e o revogado (Padrão DMS §7). */
const CODIGO_QUE_NAO_VALE =
  'código de acesso inválido ou revogado. Confira se foi copiado inteiro; se foi revogado, peça outro a quem cuida da conta no Farol';

/** De onde vêm as fichas de uma loja, para a tela dizer por que ela pode (ou não) ganhar um acesso. */
export type OrigemDaLoja = 'livre' | 'planilha' | 'regem' | 'sistema';

/** O registro do último envio, como fica guardado junto da base (`fichas_da_loja.importacao`). */
export type UltimoEnvio = {
  arquivo: '';
  em: string;
  por: { id: string; nome: string };
  contas: Envio['contas'];
  semFicha: Envio['semFicha'];
  deFora: Envio['deFora'];
  soltos: Envio['soltos'];
  problemas: number;
};

/**
 * Senhas ERRADAS na confirmação (criar e renovar), por pessoa, a cada 15 minutos. Só o erro conta: quem confirma certo
 * nunca é barrado; quem tem uma sessão roubada e tenta adivinhar a senha para no 11º palpite, até a janela passar.
 */
export const ERROS_DE_SENHA_POR_15_MIN = 10;
const JANELA_DOS_ERROS_MS = 15 * 60_000;

/** Os erros de senha de cada pessoa na janela de agora. Vale por processo, como os limites da porta. */
function contadorDeErros(agora: () => number = Date.now) {
  const erros = new Map<string, { inicio: number; n: number }>();
  const daJanela = (id: string) => {
    const e = erros.get(id);
    return e && agora() - e.inicio < JANELA_DOS_ERROS_MS ? e : null;
  };
  return {
    /** Segundos até poder tentar de novo; nulo = pode tentar agora. */
    bloqueado(id: string): number | null {
      const e = daJanela(id);
      return e && e.n >= ERROS_DE_SENHA_POR_15_MIN ? Math.max(1, Math.ceil((e.inicio + JANELA_DOS_ERROS_MS - agora()) / 1000)) : null;
    },
    anotar(id: string): void {
      const e = daJanela(id);
      if (e) e.n += 1;
      else erros.set(id, { inicio: agora(), n: 1 });
      if (erros.size > 10_000) for (const [k, v] of erros) if (agora() - v.inicio >= JANELA_DOS_ERROS_MS) erros.delete(k);
    },
  };
}

/** Em que pé está um acesso que vale: a tela diz isso em cada linha, e a porta recusa o vencido e o suspenso. */
export type SituacaoDoAcesso = 'valendo' | 'vence' | 'vencido' | 'suspenso';

/** O que decide a situação: vem das colunas do acesso (`acesso_externo`). */
export type DatasDoAcesso = { criado_em: Date; renovado_em: Date | null; vence_em: Date; ultimo_uso_em: Date | null; reativado_em: Date | null };

/**
 * A situação pelas regras do Padrão DMS (§2.4, `situacaoChave` do pacote comum): vencido primeiro; depois suspenso (90
 * dias desde o último uso, a reativação ou o código de agora — o da renovação ou o da criação); e "vence" nos 15 dias
 * antes de vencer.
 */
export function situacaoDoAcesso(a: DatasDoAcesso, agora: Date = new Date()): SituacaoDoAcesso {
  const { situacao, avisarVencimento } = situacaoChave(
    { criadaEm: a.renovado_em ?? a.criado_em, venceEm: a.vence_em, revogadaEm: null, ultimoUsoEm: a.ultimo_uso_em, reativadaEm: a.reativado_em },
    agora,
  );
  if (situacao === 'vencida') return 'vencido';
  if (situacao === 'suspensa') return 'suspenso';
  return avisarVencimento ? 'vence' : 'valendo';
}

/** A data no relógio da loja, como a frase diz ("27/10/2026"). O fuso da loja nunca é nulo (o banco garante). */
function dataNaLoja(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

type AcessoQueEnvia = { id: string; tenant_id: string; loja_id: string; nome: string; loja_nome: string; vence_do_codigo: Date };

/** O nome do sistema, como a conta o escreveu: sem espaço sobrando e sem caractere de controle. Nulo = não serve. */
function nomeDoSistema(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const limpo = [...v]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.length >= 1 && limpo.length <= MAX_DO_NOME ? limpo : null;
}

export function rotasDeAcessos(app: FastifyInstance, pool: pg.Pool): void {
  // Os limites da porta valem por processo (a API do Farol roda numa cópia só); cada `criarApp` começa do zero.
  const consultas = new JanelaFixa(LIMITE_DE_CONSULTAS_POR_MINUTO, 60_000);
  const consultasDaConta = new JanelaFixa(LIMITE_DE_CONSULTAS_DA_CONTA_POR_MINUTO, 60_000);
  const envios = new JanelaFixa(LIMITE_DE_ENVIOS_POR_HORA, 3_600_000);
  const enviosDaConta = new JanelaFixa(LIMITE_DE_ENVIOS_DA_CONTA_POR_HORA, 3_600_000);
  const validacoes = new JanelaFixa(LIMITE_DE_VALIDACOES_POR_HORA, 3_600_000);
  /** Cada uso da porta: a cota do acesso, a da conta (nula = sem cota da conta) e como a frase do 429 a descreve. */
  const COTAS = {
    consulta: { doAcesso: consultas, daConta: consultasDaConta, porAcesso: `${LIMITE_DE_CONSULTAS_POR_MINUTO} consultas por minuto`, porConta: `${LIMITE_DE_CONSULTAS_DA_CONTA_POR_MINUTO} consultas por minuto` },
    envio: { doAcesso: envios, daConta: enviosDaConta, porAcesso: `${LIMITE_DE_ENVIOS_POR_HORA} envios por hora`, porConta: `${LIMITE_DE_ENVIOS_DA_CONTA_POR_HORA} envios por hora` },
    validacao: { doAcesso: validacoes, daConta: null, porAcesso: `${LIMITE_DE_VALIDACOES_POR_HORA} conferências por hora`, porConta: '' },
  } as const;

  const errosDeSenha = contadorDeErros();

  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }

  /**
   * Quem cria ou renova confirma a própria senha: é a pessoa, e não alguém com o console dela aberto. A senha errada é
   * 403, não 401 — a sessão continua valendo, e o console não manda ninguém para a tela de entrar.
   */
  async function senhaConfere(req: FastifyRequest, resposta: FastifyReply, s: Sessao, senha: unknown): Promise<boolean> {
    if (typeof senha !== 'string' || senha.length === 0) {
      resposta.status(422).send({ erro: 'validacao', mensagem: 'digite a sua senha para confirmar' });
      return false;
    }
    const espera = errosDeSenha.bloqueado(s.usuarioId);
    if (espera !== null) {
      resposta
        .status(429)
        .header('retry-after', String(espera))
        .send({ erro: 'devagar', mensagem: `senha errada vezes demais. Tente de novo em ${espera} s` });
      return false;
    }
    const { rows } = await pool.query<{ senha_hash: string }>('select senha_hash from usuario where id = $1', [s.usuarioId]);
    if (!rows[0] || !(await conferirSenha(senha, rows[0].senha_hash))) {
      errosDeSenha.anotar(s.usuarioId);
      req.log.warn({ usuario: s.usuarioId }, 'porta: a senha não conferiu');
      resposta.status(403).send({ erro: 'senha_nao_confere', mensagem: 'a senha não confere. Tente de novo' });
      return false;
    }
    return true;
  }

  // ───────────────────────── o console: os acessos da conta ─────────────────────────

  app.get('/v1/acessos', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!podeConfigurar(s)) {
      return resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não vê as conexões da conta' });
    }

    type LinhaDaLista = DatasDoAcesso & {
      id: string;
      nome: string;
      loja_id: string;
      loja_nome: string;
      fuso: string | null;
      recebido_em: Date | null;
      anterior_vale_ate: Date | null;
      criado_por_nome: string | null;
      produtos: number | null;
      com_ficha: number | null;
    };
    type Aviso = { acao: 'criou' | 'renovou' | 'reativou' | 'revogou'; em: Date; por: string; sistema: string; loja: string; anterior_vale_ate: Date | null };
    const [acessos, lojas, avisos] = await Promise.all([
      // A impressão do código NÃO entra nesta consulta: o que a tela não mostra, a rota nem busca.
      pool.query<LinhaDaLista>(
        `select a.id, a.nome, a.loja_id, l.nome as loja_nome, l.timezone as fuso, a.criado_em, a.recebido_em,
                a.vence_em, a.ultimo_uso_em, a.renovado_em, a.reativado_em,
                case when a.anterior_vale_ate > now() then a.anterior_vale_ate end as anterior_vale_ate,
                u.nome as criado_por_nome, f.produtos, f.com_ficha
           from acesso_externo a
           join loja l on l.id = a.loja_id
           left join usuario u on u.id = a.criado_por
           left join fichas_da_loja f on f.loja_id = a.loja_id and f.fonte = 'sistema'
          where a.tenant_id = $1 and a.revogado_em is null
          order by l.nome, a.id`,
        [s.tenantId],
      ),
      pool.query<{ id: string; nome: string; do_regem: boolean; com_acesso: boolean; fonte: string | null }>(
        `select l.id, l.nome,
                exists (select 1 from regem_loja r where r.loja_id = l.id) as do_regem,
                exists (select 1 from acesso_externo a where a.loja_id = l.id and a.revogado_em is null) as com_acesso,
                (select f.fonte from fichas_da_loja f where f.loja_id = l.id) as fonte
           from loja l
          where l.tenant_id = $1
          order by l.nome, l.id`,
        [s.tenantId],
      ),
      // O que os OUTROS da diretoria fizeram nos acessos nos últimos 7 dias e que esta pessoa ainda não viu. Sai das
      // colunas de cada acesso (quem e quando criou, renovou, reativou, revogou): não há tabela de eventos à parte.
      ehDiretoria(s)
        ? pool.query<Aviso>(
            `select e.acao, e.em, u.nome as por, e.sistema, e.loja, e.anterior_vale_ate
               from (
                 select 'criou' as acao, a.criado_em as em, a.criado_por as por_id, a.nome as sistema, l.nome as loja, null::timestamptz as anterior_vale_ate
                   from acesso_externo a join loja l on l.id = a.loja_id where a.tenant_id = $1
                 union all
                 select 'renovou', a.renovado_em, a.renovado_por, a.nome, l.nome, a.anterior_vale_ate
                   from acesso_externo a join loja l on l.id = a.loja_id where a.tenant_id = $1 and a.renovado_em is not null
                 union all
                 select 'reativou', a.reativado_em, a.reativado_por, a.nome, l.nome, null
                   from acesso_externo a join loja l on l.id = a.loja_id where a.tenant_id = $1 and a.reativado_em is not null
                 union all
                 select 'revogou', a.revogado_em, a.revogado_por, a.nome, l.nome, null
                   from acesso_externo a join loja l on l.id = a.loja_id where a.tenant_id = $1 and a.revogado_em is not null
               ) e
               join usuario u on u.id = e.por_id
               join usuario eu on eu.id = $2
              where e.por_id <> $2
                and e.em > greatest(coalesce(eu.acessos_vistos_em, '-infinity'::timestamptz), now() - interval '7 days')
              order by e.em desc
              limit 10`,
            [s.tenantId, s.usuarioId],
          )
        : Promise.resolve({ rows: [] as Aviso[] }),
    ]);

    const agora = new Date();
    return {
      /** Só a diretoria cria, renova, reativa e revoga: a tela mostra o botão ou a frase. */
      podeCriar: ehDiretoria(s),
      /** A conta tem no máximo 10 acessos valendo (Padrão DMS §2.4). No teto, a tela troca o botão pelo aviso. */
      teto: { maximo: POLITICA_CHAVE_PROPRIA.maximoAtivasPorEmpresaEProduto, ativos: acessos.rows.length },
      /** O termo de uso que quem cria aceita (o texto e a versão vêm daqui, não da tela). */
      termo: TERMO_DO_ACESSO,
      /** O que os outros da diretoria fizeram nos acessos e esta pessoa ainda não viu (só para a diretoria). */
      avisos: avisos.rows.map((v) => ({ acao: v.acao, em: v.em, por: v.por, sistema: v.sistema, loja: v.loja, anteriorValeAte: v.anterior_vale_ate })),
      acessos: acessos.rows.map((a) => ({
        id: a.id,
        nome: a.nome,
        lojaId: a.loja_id,
        lojaNome: a.loja_nome,
        /** O relógio da loja: é nele que a tela diz "hoje, 14:02". */
        fuso: a.fuso,
        criadoEm: a.criado_em,
        /** Quem criou (o nome de agora; nulo se a pessoa foi apagada). */
        criadoPor: a.criado_por_nome,
        /** O último envio que o Farol aceitou. Nulo = o sistema ainda não enviou nada. */
        recebidoEm: a.recebido_em,
        /** O que a base da loja tem DESTE sistema. Nulo = ainda não há (a loja pode ter fichas de planilha). */
        produtos: a.produtos,
        comFicha: a.com_ficha,
        /** `valendo`, `vence` (nos 15 dias antes de vencer), `vencido` ou `suspenso` (90 dias sem uso). */
        situacao: situacaoDoAcesso(a, agora),
        /** Até quando o código de agora vale. */
        venceEm: a.vence_em,
        /** A última chamada aceita na porta (anotada no máximo uma vez por hora). */
        ultimoUsoEm: a.ultimo_uso_em,
        renovadoEm: a.renovado_em,
        /** Renovado há pouco: até quando o código de antes ainda vale. Nulo = não há código antigo valendo. */
        anteriorValeAte: a.anterior_vale_ate,
      })),
      /** As lojas da conta e de onde cada uma recebe as fichas: só a livre e a de planilha podem ganhar acesso. */
      lojas: lojas.rows.map((l) => ({
        id: l.id,
        nome: l.nome,
        origem: (l.do_regem ? 'regem' : l.com_acesso ? 'sistema' : l.fonte === 'planilha' ? 'planilha' : 'livre') satisfies OrigemDaLoja,
      })),
    };
  });

  // ───────────────────────── o console: criar ─────────────────────────

  app.post('/v1/acessos', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;

    const corpo = (req.body ?? {}) as { nome?: unknown; lojaId?: unknown; termoVersao?: unknown; senha?: unknown };
    const nome = nomeDoSistema(corpo.nome);
    if (nome === null) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: `diga o nome do sistema, com até ${MAX_DO_NOME} letras` });
    }
    if (typeof corpo.lojaId !== 'string' || !UUID.test(corpo.lojaId)) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: 'escolha a loja que vai receber' });
    }
    const lojaId = corpo.lojaId.toLowerCase();
    // O termo é o de AGORA: quem aceitou uma versão antiga (a tela aberta antes da mudança) lê a nova antes.
    if (corpo.termoVersao !== TERMO_DO_ACESSO.versao) {
      return resposta.status(422).send({ erro: 'termo', mensagem: 'para criar o acesso, aceite o termo de uso do acesso, na versão de agora' });
    }
    // A senha por último: as conferências baratas não gastam tentativa de senha.
    if (!(await senhaConfere(req, resposta, s, corpo.senha))) return;

    const codigo = gerarChave('ap', 'farol').chave;
    // Client dedicado: a trava da loja e as conferências só valem na MESMA conexão.
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // A linha da CONTA fica travada antes: duas pessoas criando ao mesmo tempo, em lojas diferentes, não passam juntas do
      // teto de acessos. A conferência vem na instrução seguinte (V105).
      await cliente.query('select 1 from tenant where id = $1 for no key update', [s.tenantId]);
      // A linha da loja fica travada até o fim: quem estiver ligando esta loja ao Regem espera aqui (e vice-versa).
      // A trava é a que NÃO barra quem só aponta para a loja (`no key update`): gravar um evento dela continua passando.
      const loja = await cliente.query<{ nome: string }>('select nome from loja where id = $1 and tenant_id = $2 for no key update', [lojaId, s.tenantId]);
      if (loja.rows.length === 0) {
        await cliente.query('rollback');
        return resposta.status(404).send({ erro: 'loja_nao_encontrada', mensagem: 'não existe essa loja' });
      }
      const [doRegem, jaTem, base, valendo] = [
        await cliente.query('select 1 from regem_loja where loja_id = $1', [lojaId]),
        await cliente.query<{ nome: string }>('select nome from acesso_externo where loja_id = $1 and revogado_em is null', [lojaId]),
        await cliente.query<{ fonte: string }>('select fonte from fichas_da_loja where loja_id = $1', [lojaId]),
        await cliente.query<{ n: number }>('select count(*)::int as n from acesso_externo where tenant_id = $1 and revogado_em is null', [s.tenantId]),
      ];
      if (doRegem.rows.length > 0) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'origem_ocupada',
          mensagem: 'esta loja recebe as fichas do Regem. Uma loja recebe de um lugar só: para outro sistema enviar, desconecte a loja do Regem antes',
        });
      }
      if (jaTem.rows.length > 0) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'ja_tem_acesso',
          mensagem: `esta loja já tem um acesso (${jaTem.rows[0]!.nome}). O acesso vale para uma loja: para trocar de sistema, revogue o que existe e crie outro`,
        });
      }
      if (valendo.rows[0]!.n >= POLITICA_CHAVE_PROPRIA.maximoAtivasPorEmpresaEProduto) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'teto_de_acessos',
          mensagem: `a conta chegou a ${POLITICA_CHAVE_PROPRIA.maximoAtivasPorEmpresaEProduto} acessos, o máximo. Para criar outro, revogue um que não se usa mais`,
        });
      }
      const criado = await cliente.query<{ id: string; criado_em: Date; vence_em: Date }>(
        `insert into acesso_externo (tenant_id, loja_id, nome, token_hash, criado_por, vence_em, termo_versao, termo_aceito_em)
         values ($1, $2, $3, $4, $5, now() + make_interval(months => $6), $7, now())
         returning id, criado_em, vence_em`,
        [s.tenantId, lojaId, nome, hashDoToken(codigo), s.usuarioId, POLITICA_CHAVE_PROPRIA.validadeMeses, TERMO_DO_ACESSO.versao],
      );
      await cliente.query('commit');

      // Sem o código: ele não entra em registro nenhum.
      req.log.info({ acesso: criado.rows[0]!.id, loja: lojaId, usuario: s.usuarioId }, 'porta: acesso criado');
      return resposta
        .status(201)
        .header('cache-control', 'no-store')
        .send({
          id: criado.rows[0]!.id,
          nome,
          lojaId,
          lojaNome: loja.rows[0]!.nome,
          criadoEm: criado.rows[0]!.criado_em,
          /** Até quando o código vale (12 meses). */
          venceEm: criado.rows[0]!.vence_em,
          /** O código de acesso. Aparece AQUI, uma vez: o Farol não o guarda, e não o mostra de novo. */
          codigo,
          /** A loja tem fichas de planilha: elas ficam até o sistema enviar as dele. */
          temPlanilha: base.rows[0]?.fonte === 'planilha',
        });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────────────── o console: revogar ─────────────────────────

  app.delete('/v1/acessos/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });

    // Uma instrução só: o acesso deixa de valer e as fichas que ele mandou saem juntos. As de planilha (a loja
    // que ganhou o acesso e o sistema ainda não enviou nada) ficam: não foi ele que as mandou.
    const { rows } = await pool.query<{ loja_id: string; apagadas: number }>(
      `with revogado as (
         update acesso_externo
            set revogado_em = now(), revogado_por = $3
          where id = $1 and tenant_id = $2 and revogado_em is null
          returning loja_id
       ), apagadas as (
         delete from fichas_da_loja f using revogado r
          where f.loja_id = r.loja_id and f.fonte = 'sistema'
          returning f.loja_id
       )
       select r.loja_id, (select count(*)::int from apagadas) as apagadas from revogado r`,
      [id.toLowerCase(), s.tenantId, s.usuarioId],
    );
    if (rows.length === 0) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'não existe esse acesso' });

    req.log.info({ acesso: id, loja: rows[0]!.loja_id, usuario: s.usuarioId, fichasApagadas: rows[0]!.apagadas > 0 }, 'porta: acesso revogado');
    return { revogado: true, /** As fichas que o sistema tinha mandado foram apagadas. */ fichasApagadas: rows[0]!.apagadas > 0 };
  });

  // ───────────────────────── o console: renovar ─────────────────────────

  // Sai um código novo, que vale 12 meses. O de antes vale mais 7 dias — o tempo de trocar no sistema —, a não ser que já
  // tenha vencido. Renovar de novo dentro desses 7 dias troca o "de antes" pelo de agora: o mais velho para na hora.
  app.post('/v1/acessos/:id/renovar', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    if (!(await senhaConfere(req, resposta, s, ((req.body ?? {}) as { senha?: unknown }).senha))) return;

    const codigo = gerarChave('ap', 'farol').chave;
    // Uma instrução só: no `set`, `a.vence_em` e `a.token_hash` são os de ANTES da troca.
    const { rows } = await pool.query<{ id: string; nome: string; loja_nome: string; vence_em: Date; anterior_vale_ate: Date | null }>(
      `update acesso_externo a
          set token_hash_anterior = case when a.vence_em > now() then a.token_hash end,
              anterior_vale_ate = case when a.vence_em > now() then now() + make_interval(days => $5) end,
              token_hash = $4,
              vence_em = now() + make_interval(months => $6),
              renovado_em = now(),
              renovado_por = $3
         from loja l
        where a.id = $1 and a.tenant_id = $2 and a.revogado_em is null and l.id = a.loja_id
        returning a.id, a.nome, l.nome as loja_nome, a.vence_em, a.anterior_vale_ate`,
      [id.toLowerCase(), s.tenantId, s.usuarioId, hashDoToken(codigo), POLITICA_CHAVE_PROPRIA.sobreposicaoNaTrocaDias, POLITICA_CHAVE_PROPRIA.validadeMeses],
    );
    if (rows.length === 0) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'não existe esse acesso' });
    const r = rows[0]!;

    // Sem o código: ele não entra em registro nenhum.
    req.log.info({ acesso: r.id, usuario: s.usuarioId, comAnterior: r.anterior_vale_ate !== null }, 'porta: acesso renovado');
    return resposta.header('cache-control', 'no-store').send({
      id: r.id,
      nome: r.nome,
      lojaNome: r.loja_nome,
      /** O código novo. Aparece AQUI, uma vez. */
      codigo,
      venceEm: r.vence_em,
      /** Até quando o código de antes ainda vale. Nulo = ele já tinha vencido, e não vale mais. */
      anteriorValeAte: r.anterior_vale_ate,
    });
  });

  // ───────────────────────── o console: reativar ─────────────────────────

  // O suspenso volta a valer com o MESMO código: reativar conta como uso, e a contagem dos 90 dias recomeça. O vencido não
  // se reativa: o que ele precisa é de um código novo (renovar).
  app.post('/v1/acessos/:id/reativar', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirDiretoria(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });

    const { rows } = await pool.query<{ reativado: boolean }>(
      `with alvo as (
         select id, vence_em > now() as vale from acesso_externo where id = $1 and tenant_id = $2 and revogado_em is null
       ), feito as (
         update acesso_externo a set reativado_em = now(), reativado_por = $3 from alvo where a.id = alvo.id and alvo.vale returning a.id
       )
       select exists (select 1 from feito) as reativado from alvo`,
      [id.toLowerCase(), s.tenantId, s.usuarioId],
    );
    if (rows.length === 0) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'não existe esse acesso' });
    if (!rows[0]!.reativado) {
      return resposta.status(409).send({ erro: 'acesso_vencido', mensagem: 'este acesso venceu. Para ele voltar a valer, renove: sai um código novo' });
    }
    req.log.info({ acesso: id, usuario: s.usuarioId }, 'porta: acesso reativado');
    return { reativado: true };
  });

  // ───────────────────────── o console: os avisos já vistos ─────────────────────────

  // "Entendi" no aviso do que os outros da diretoria fizeram: o que veio até agora some para esta pessoa.
  app.post('/v1/acessos/avisos/vistos', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    await pool.query('update usuario set acessos_vistos_em = now() where id = $1', [s.usuarioId]);
    return { visto: true };
  });

  // ───────────────────────── a porta: quem está enviando ─────────────────────────

  /** O código que não vale: 401, sempre o mesmo corpo. */
  function recusarCodigo(req: FastifyRequest, resposta: FastifyReply): null {
    responderNaPorta(req, resposta, 401, 'token-invalido', 'credencial_invalida', CODIGO_QUE_NAO_VALE, {
      wwwAuthenticate: cabecalhoWwwAuthenticate({ erro: 'invalid_token' }),
    });
    return null;
  }

  async function quemEnvia(req: FastifyRequest, resposta: FastifyReply, uso: keyof typeof COTAS): Promise<AcessoQueEnvia | null> {
    const cabecalho = req.headers.authorization;
    const [esquema, valor] = (cabecalho ?? '').split(' ');
    if (!cabecalho || esquema?.toLowerCase() !== 'bearer' || !valor?.trim()) {
      responderNaPorta(req, resposta, 401, 'token-invalido', 'sem_credencial', 'envie o código de acesso no cabeçalho Authorization: Bearer <código>', {
        wwwAuthenticate: cabecalhoWwwAuthenticate(),
      });
      return null;
    }
    const codigo = valor.trim();
    // Formato que não serve nem vai ao banco: o código colado pela metade ou com um caractere trocado (os dígitos de
    // conferência do formato novo pegam) recebe a mesma resposta do que nunca existiu.
    const lido = lerChave(codigo);
    if (!CODIGO_ANTIGO.test(codigo) && !(lido?.tipo === 'ap' && lido.produto === 'farol')) return recusarCodigo(req, resposta);
    // O código de agora, ou o de antes da renovação enquanto ainda vale (os 7 dias de trocar no sistema).
    const { rows } = await pool.query<
      DatasDoAcesso & { id: string; tenant_id: string; loja_id: string; nome: string; loja_nome: string; fuso: string; revogado_em: Date | null; pelo_anterior: boolean; anterior_vale_ate: Date | null }
    >(
      `select a.id, a.tenant_id, a.loja_id, a.nome, a.revogado_em, l.nome as loja_nome, l.timezone as fuso,
              a.criado_em, a.renovado_em, a.vence_em, a.ultimo_uso_em, a.reativado_em,
              a.token_hash <> $1 as pelo_anterior, a.anterior_vale_ate
         from acesso_externo a
         join loja l on l.id = a.loja_id
        where a.token_hash = $1 or (a.token_hash_anterior = $1 and a.anterior_vale_ate > now())`,
      [hashDoToken(codigo)],
    );
    const a = rows[0];
    // O revogado responde IGUAL ao que nunca existiu (Padrão DMS §7): quem tem um código revogado não fica sabendo
    // que ele existiu. A frase diz o que fazer nos dois casos. O código de antes, passados os 7 dias, também.
    if (!a || a.revogado_em !== null) return recusarCodigo(req, resposta);

    // Vencido e suspenso têm resposta própria (Padrão DMS §2.4): quem integra precisa saber o que pedir à diretoria. A
    // chamada recusada NÃO conta como uso — senão o sistema que insiste se reativaria sozinho.
    const situacao = situacaoDoAcesso(a);
    if (situacao === 'vencido') {
      responderNaPorta(req, resposta, 401, 'chave-vencida', 'acesso_vencido', `este acesso venceu em ${dataNaLoja(a.vence_em, a.fuso)}. Peça a quem cuida da conta no Farol para renová-lo: sai um código novo`, {
        wwwAuthenticate: cabecalhoWwwAuthenticate({ erro: 'invalid_token' }),
      });
      return null;
    }
    if (situacao === 'suspenso') {
      responderNaPorta(req, resposta, 403, 'chave-suspensa', 'acesso_suspenso', 'este acesso está suspenso: ficou 90 dias sem uso. Peça a quem cuida da conta no Farol para reativá-lo — o código continua o mesmo');
      return null;
    }

    // O limite conta só a chamada de acesso válido, por acesso e pela conta inteira. A cota da conta só conta o que
    // passou na do acesso: um sistema preso num laço de 429 não gasta a cota das outras lojas da conta.
    const cota = COTAS[uso];
    const doAcesso = cota.doAcesso.contar(a.id);
    const daConta = doAcesso.ok && cota.daConta ? cota.daConta.contar(a.tenant_id) : null;
    const estourou = !doAcesso.ok ? { quanto: `${cota.porAcesso} por acesso`, ...doAcesso } : daConta && !daConta.ok ? { quanto: `${cota.porConta} somando os acessos da conta`, ...daConta } : null;
    if (estourou) {
      responderNaPorta(req, resposta, 429, 'limite-de-chamadas', 'limite_de_chamadas', `chamadas demais em pouco tempo (até ${estourou.quanto}). Tente de novo em ${estourou.retryAfterSeg} s`, {
        retryAfterSeg: estourou.retryAfterSeg,
      });
      return null;
    }
    // O uso, para a suspensão dos 90 dias: no máximo uma escrita por hora, para a porta não virar uma escrita por chamada.
    await pool.query(`update acesso_externo set ultimo_uso_em = now() where id = $1 and (ultimo_uso_em is null or ultimo_uso_em < now() - interval '1 hour')`, [a.id]);
    return {
      id: a.id,
      tenant_id: a.tenant_id,
      loja_id: a.loja_id,
      nome: a.nome,
      loja_nome: a.loja_nome,
      /** Até quando vale O CÓDIGO USADO: o de antes da renovação para nos 7 dias; o de agora, em 12 meses. */
      vence_do_codigo: a.pelo_anterior && a.anterior_vale_ate ? a.anterior_vale_ate : a.vence_em,
    };
  }

  // ───────────────────────── a porta: o envio ─────────────────────────

  app.put('/v1/integracao/fichas', { bodyLimit: MAX_DO_ENVIO }, async (req, resposta) => {
    // Só validar (Padrão DMS §5): confere tudo e diz o que entraria, sem gravar nada — nem a data do último envio. Só
    // `true` e `false` valem: quem escreveu `somente_validar=1` queria conferir, e gravar seria o engano que dói.
    const pedido = (req.query as Record<string, unknown> | undefined)?.somente_validar;
    const soValidar = pedido === 'true';
    const acesso = await quemEnvia(req, resposta, soValidar ? 'validacao' : 'envio');
    if (!acesso) return;
    if (pedido !== undefined && pedido !== 'true' && pedido !== 'false') {
      return responderNaPorta(req, resposta, 400, 'parametro-invalido', 'parametro_invalido', 'somente_validar aceita true ou false. Nada foi recebido');
    }

    const envio = lerEnvio(req.body);
    if (envio.impede !== null) return responderNaPorta(req, resposta, 422, 'regra-invalida', 'envio_invalido', envio.impede);

    // Na porta, os nomes seguem o Padrão DMS (snake_case). O registro guardado junto da base continua o do console.
    const relatorio = { produtos: envio.contas.produtos, com_ficha: envio.contas.comFicha, sem_ficha: envio.semFicha, de_fora: envio.deFora, soltos: envio.soltos, problemas: envio.problemas };
    if (envio.contas.produtos === 0) {
      return responderNaPorta(
        req,
        resposta,
        422,
        'regra-invalida',
        'nada_a_receber',
        'nenhum produto do envio está certo, e nada foi recebido. As fichas que a loja tem continuam como estavam',
        { campos: relatorio },
      );
    }

    if (soValidar) return { resultado: 'so_validado', gravado: false, ...relatorio };

    const impressao = impressaoDaBase(envio.base);
    const antes = await pool.query<{ impressao: string }>('select impressao from fichas_da_loja where loja_id = $1', [acesso.loja_id]);
    const registro: UltimoEnvio = {
      arquivo: '',
      em: new Date().toISOString(),
      por: { id: acesso.id, nome: acesso.nome },
      contas: envio.contas,
      semFicha: envio.semFicha,
      deFora: envio.deFora,
      soltos: envio.soltos,
      problemas: envio.problemas,
    };
    // A base é trocada INTEIRA, numa instrução só — e só se o acesso continua valendo (alguém pode tê-lo
    // revogado entre a conferência do código e agora). A data da base só anda se o documento mudou.
    const gravou = await pool.query(
      `with valendo as (
         update acesso_externo set recebido_em = now()
          where id = $1 and revogado_em is null
          returning loja_id, tenant_id
       )
       insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha, atualizada_em, importacao)
       select v.loja_id, v.tenant_id, 'sistema', $2::jsonb, $3, $4, $5, now(), $6::jsonb
         from valendo v
       on conflict (loja_id) do update
          set tenant_id = excluded.tenant_id, fonte = excluded.fonte, conteudo = excluded.conteudo, impressao = excluded.impressao,
              produtos = excluded.produtos, com_ficha = excluded.com_ficha, importacao = excluded.importacao,
              atualizada_em = case when fichas_da_loja.impressao is distinct from excluded.impressao then now() else fichas_da_loja.atualizada_em end`,
      [acesso.id, JSON.stringify(envio.base), impressao, envio.contas.produtos, envio.contas.comFicha, JSON.stringify(registro)],
    );
    if ((gravou.rowCount ?? 0) === 0) return recusarCodigo(req, resposta);

    req.log.info({ acesso: acesso.id, loja: acesso.loja_id, ...envio.contas, deFora: envio.deFora.length, problemas: envio.problemas }, 'porta: fichas recebidas');
    return {
      /** `atualizada`: as fichas da loja mudaram. `nada_mudou`: o envio traz o que a loja já tinha. */
      resultado: antes.rows[0]?.impressao === impressao ? 'nada_mudou' : 'atualizada',
      ...relatorio,
    };
  });

  // O que o Farol tem deste sistema: para quem integra conferir o código e o último envio.
  app.get('/v1/integracao/fichas', async (req, resposta) => {
    const acesso = await quemEnvia(req, resposta, 'consulta');
    if (!acesso) return;
    const { rows } = await pool.query<{ recebido_em: Date | null; produtos: number | null; com_ficha: number | null }>(
      `select a.recebido_em, f.produtos, f.com_ficha
         from acesso_externo a
         left join fichas_da_loja f on f.loja_id = a.loja_id and f.fonte = 'sistema'
        where a.id = $1`,
      [acesso.id],
    );
    return resposta.header('cache-control', 'no-store').send({
      /** O nome que a conta deu a este sistema. */
      sistema: acesso.nome,
      /** A loja para a qual este código envia. */
      loja: acesso.loja_nome,
      /** O último envio aceito. Nulo = ainda não houve. */
      recebido_em: rows[0]?.recebido_em ?? null,
      produtos: rows[0]?.produtos ?? null,
      com_ficha: rows[0]?.com_ficha ?? null,
      /** Até quando o código usado nesta chamada vale. Quem integra confere isto, e avisa antes de vencer. */
      vence_em: acesso.vence_do_codigo,
    });
  });
}
