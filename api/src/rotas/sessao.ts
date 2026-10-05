// =====================================================================
// Sessão do console — entrar, sair, saber quem sou
// =====================================================================
// Cookie `httpOnly`, não token no `localStorage`. A diferença importa:
// token em `localStorage` é legível por qualquer script da página, e um
// XSS vira sessão roubada. Com `httpOnly` o navegador manda o cookie e
// o JavaScript nunca o vê.
//
// `sameSite=lax` para a sessão não acompanhar requisição vinda de outro
// site, que é o que impede CSRF nas rotas de escrita.
// =====================================================================

import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { conferirSenha, gerarHash, gerarTokenSessao } from '../senha.js';

const COOKIE = 'farol_sessao';
const DURACAO_HORAS = 12;

// Mensagem única para e-mail inexistente e senha errada. Dizer qual dos
// dois falhou entrega a quem tenta uma lista de e-mails válidos.
const CREDENCIAL_INVALIDA = { erro: 'credencial_invalida', mensagem: 'e-mail ou senha incorretos' };

export type Sessao = {
  usuarioId: string;
  tenantId: string;
  nivel: string;
  nome: string;
  email: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function lerCookie(req: FastifyRequest): string | null {
  const bruto = req.headers.cookie;
  if (!bruto) return null;
  for (const parte of bruto.split(';')) {
    const [nome, ...resto] = parte.trim().split('=');
    if (nome === COOKIE) return decodeURIComponent(resto.join('='));
  }
  return null;
}

export async function sessaoDe(pool: pg.Pool, req: FastifyRequest): Promise<Sessao | null> {
  const token = lerCookie(req);
  if (!token) return null;

  const { rows } = await pool.query(
    `select s.id, s.usuario_id, u.tenant_id, u.nivel, u.nome, u.email, u.ativo,
            u.senha_trocada_em, s.criada_em
       from sessao s
       join usuario u on u.id = s.usuario_id
      where s.token_hash = $1
        and s.revogada_em is null
        and s.expira_em > now()`,
    [hashToken(token)],
  );

  const s = rows[0];
  if (!s || !s.ativo) return null;

  // Troca de senha derruba o que já estava aberto. É exatamente no momento
  // em que alguém troca a senha que se quer expulsar quem a roubou.
  if (s.senha_trocada_em && new Date(s.senha_trocada_em) > new Date(s.criada_em)) {
    return null;
  }

  // Telemetria de uso; não pode segurar a resposta nem derrubá-la.
  void pool
    .query('update sessao set usada_em = now() where id = $1', [s.id])
    .catch(() => {});

  return {
    usuarioId: s.usuario_id,
    tenantId: s.tenant_id,
    nivel: s.nivel,
    nome: s.nome,
    email: s.email,
  };
}

export function rotasDeSessao(app: FastifyInstance, pool: pg.Pool): void {
  // ─────────────────────────── entrar ───────────────────────────

  app.post('/v1/sessao', async (req, resposta) => {
    const corpo = (req.body ?? {}) as { email?: string; senha?: string };
    const email = corpo.email?.trim().toLowerCase();
    if (!email || !corpo.senha) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: 'informe email e senha',
      });
    }

    const { rows } = await pool.query(
      `select id, tenant_id, nome, email, nivel, senha_hash, ativo
         from usuario where lower(email) = $1`,
      [email],
    );
    const u = rows[0];

    // Confere a senha MESMO quando o usuário não existe, contra um hash
    // descartável. Sem isso, a resposta volta mais rápido para e-mail
    // inexistente, e o tempo entrega quais e-mails existem.
    const guardado = u?.senha_hash ?? HASH_FALSO;
    const senhaBate = await conferirSenha(corpo.senha, guardado);

    if (!u || !senhaBate) {
      req.log.warn({ email, existe: Boolean(u) }, 'login recusado');
      return resposta.status(401).send(CREDENCIAL_INVALIDA);
    }
    if (!u.ativo) {
      req.log.warn({ usuario: u.id }, 'login de usuário inativo');
      return resposta.status(403).send({
        erro: 'usuario_inativo',
        mensagem: 'este acesso foi desativado',
      });
    }

    const token = gerarTokenSessao();
    const expira = new Date(Date.now() + DURACAO_HORAS * 3600_000);
    await pool.query(
      `insert into sessao (usuario_id, token_hash, expira_em, ip, agente_http)
       values ($1,$2,$3,$4,$5)`,
      [u.id, hashToken(token), expira, req.ip, (req.headers['user-agent'] ?? '').slice(0, 300)],
    );
    void pool
      .query('update usuario set ultimo_acesso_em = now() where id = $1', [u.id])
      .catch(() => {});

    return resposta
      .header(
        'set-cookie',
        [
          `${COOKIE}=${encodeURIComponent(token)}`,
          'Path=/',
          'HttpOnly',
          'SameSite=Lax',
          // Sem HTTPS em desenvolvimento o cookie com `Secure` não é
          // guardado, e o login "funciona" sem nunca autenticar.
          process.env.NODE_ENV === 'production' ? 'Secure' : '',
          `Max-Age=${DURACAO_HORAS * 3600}`,
        ]
          .filter(Boolean)
          .join('; '),
      )
      .send({
        usuarioId: u.id,
        nome: u.nome,
        email: u.email,
        nivel: u.nivel,
        expiraEm: expira.toISOString(),
      });
  });

  // ──────────────────────────── sair ────────────────────────────

  app.delete('/v1/sessao', async (req, resposta) => {
    const token = lerCookie(req);
    if (token) {
      // Revoga em vez de apagar: o registro de "onde estive conectado"
      // é o que permite a alguém perceber acesso que não reconhece.
      await pool.query(
        'update sessao set revogada_em = now() where token_hash = $1 and revogada_em is null',
        [hashToken(token)],
      );
    }
    return resposta
      .header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
      .send({ ok: true });
  });

  // ─────────────────────────── quem sou ──────────────────────────

  app.get('/v1/eu', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    return s;
  });

  // ────────────── distribuição: cria o primeiro usuário ──────────────

  app.post('/v1/distribuicao/usuarios', async (req, resposta) => {
    const { exigirAdmin, ErroDeAuth } = await import('../auth.js');
    try {
      exigirAdmin(req.headers['x-farol-admin'] as string | undefined);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const c = (req.body ?? {}) as {
      tenantId?: string;
      nome?: string;
      email?: string;
      senha?: string;
      nivel?: string;
    };
    if (!c.tenantId || !c.nome?.trim() || !c.email?.trim() || !c.senha) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: 'tenantId, nome, email e senha são obrigatórios',
      });
    }

    let hash: string;
    try {
      hash = await gerarHash(c.senha);
    } catch (e) {
      return resposta.status(422).send({
        erro: 'senha_fraca',
        mensagem: (e as Error).message,
      });
    }

    try {
      const { rows } = await pool.query(
        `insert into usuario (tenant_id, nome, email, senha_hash, nivel)
         values ($1,$2,$3,$4,coalesce($5,'execucao'))
         returning id, nome, email, nivel`,
        [c.tenantId, c.nome.trim(), c.email.trim(), hash, c.nivel ?? null],
      );
      return resposta.status(201).send(rows[0]);
    } catch (e) {
      const erro = e as { code?: string };
      if (erro.code === '23505') {
        return resposta.status(409).send({
          erro: 'email_repetido',
          mensagem: 'já existe usuário com este e-mail nesta empresa',
        });
      }
      if (erro.code === '23503') {
        return resposta.status(422).send({ erro: 'tenant_inexistente', mensagem: 'tenantId não existe' });
      }
      if (erro.code === '23514') {
        return resposta.status(422).send({
          erro: 'nivel_invalido',
          mensagem: 'nivel: presidente, gerente, supervisao, execucao ou suporte',
        });
      }
      throw e;
    }
  });
}

// Hash de uma senha que não é de ninguém, só para o caminho de e-mail
// inexistente custar o mesmo tempo que o de senha errada.
const HASH_FALSO =
  'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
