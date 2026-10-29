// =====================================================================
// O link só do ao vivo (29/10/2026; migration 061)
// =====================================================================
// Pedido do dono: "a ideia de ver do celular não é ter acesso completo ao
// webapp, é ver somente a movimentação ao vivo". Protótipo aprovado no mesmo
// dia, com o recomendado: prazo de 30 dias por padrão, o código aparece só na
// hora de criar, e só quem configura a loja cria e desliga.
//
// Dois lados moram aqui:
//
//   O CONSOLE (com sessão; só quem configura a loja)
//     GET  /v1/lojas/:id/links-ao-vivo                os links da loja (sem código nem impressão)
//     POST /v1/lojas/:id/links-ao-vivo                cria: a resposta traz o CÓDIGO, e é a única vez
//     POST /v1/lojas/:id/links-ao-vivo/:link/desligar  para na hora (o de novo não muda nada)
//
//   O LINK (sem sessão; o código no cabeçalho `x-farol-link`)
//     GET  /v1/ver          o nome da loja e a planta SEM as câmeras e sem as áreas de medida
//     GET  /v1/ver/agora    as pessoas agora: número do dia, posição e velocidade — sem os canais
//
// O CÓDIGO É SEGREDO e não passa por registro nenhum: a página do celular o
// leva no fim do endereço, depois do "#" (`/ver#<código>`), que o navegador
// nunca manda a servidor; daqui ela o manda num CABEÇALHO, que o registro da
// API não guarda (o endereço guarda). O banco tem só a impressão (SHA-256).
//
// O código só abre estas duas rotas (V116): ele não é sessão, nem chave de
// agente, nem de distribuição — e nada daquilo abre o link. O que não vale
// (desligado, vencido, de loja ou conta desativada, nunca existiu) responde
// IGUAL, sem dizer de que loja era.
//
// A conferência do código fica 10 s na memória (a tela lê uma vez por
// segundo); desligar limpa na hora, neste processo. ⚠️ Como a última posição
// do ao vivo, vale enquanto a API roda numa instância só (ver
// `rotas/planta-viva.ts`).
// =====================================================================

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { hashDoToken } from '../auth.js';
import { JanelaFixa } from '../dms/integracao-dms.js';
import { podeConfigurar } from '../rbac.js';
import type { AoVivoDaApi } from './planta-viva.js';
import { plantaDaLoja } from './planta.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O código: 32 bytes aleatórios em base64url — 43 caracteres. A forma errada nem vai ao banco. */
const FORMA_DO_CODIGO = /^[A-Za-z0-9_-]{43}$/;
export const CABECALHO_DO_LINK = 'x-farol-link';

export const LINK_AO_VIVO = {
  /** Os prazos que a tela oferece, em dias. `null` (até desligar) também vale. */
  prazosEmDias: [1, 7, 30] as readonly number[],
  /** Links valendo ao mesmo tempo numa loja. */
  maximoValendoPorLoja: 20,
  nomeMaximo: 40,
  /** Leituras por minuto, por link: a tela lê uma vez por segundo; sobra para dois aparelhos e a planta. */
  leiturasPorMinuto: 240,
  /** Quanto tempo a conferência do código fica na memória. Desligar limpa na hora. */
  memoriaMs: 10_000,
  /** O último uso é anotado no banco no máximo uma vez por este intervalo. */
  anotarUsoACadaMs: 60_000,
  /** Códigos que não valem, por minuto, na API inteira: passou disso, o código desconhecido espera a janela virar. */
  codigosErradosPorMinuto: 600,
  /** Quantos links a lista traz: todos os que valem (no máximo 20) e os mais novos dos que pararam. */
  naLista: 50,
} as const;

/** A resposta a todo código que não abre: a MESMA para o desligado, o vencido e o que nunca existiu. */
const NAO_VALE = {
  erro: 'link_nao_vale',
  mensagem: 'este link não vale mais: foi desligado, passou do prazo, ou foi copiado pela metade',
} as const;

export type SituacaoDoLink = 'valendo' | 'vencido' | 'desligado';

type LinhaDoLink = {
  id: string;
  nome: string;
  criado_em: Date;
  vence_em: Date | null;
  ultimo_uso_em: Date | null;
  desligado_em: Date | null;
  criado_por_nome: string | null;
  desligado_por_nome: string | null;
  situacao: SituacaoDoLink;
};

const comoNaTela = (l: LinhaDoLink) => ({
  id: l.id,
  nome: l.nome,
  situacao: l.situacao,
  criadoEm: l.criado_em.toISOString(),
  criadoPor: l.criado_por_nome,
  venceEm: l.vence_em?.toISOString() ?? null,
  ultimoUsoEm: l.ultimo_uso_em?.toISOString() ?? null,
  desligadoEm: l.desligado_em?.toISOString() ?? null,
  desligadoPor: l.desligado_por_nome,
});

/** A situação é do SERVIDOR (o relógio do banco): a tela mostra o que vem, não refaz a conta. */
const SQL_DOS_LINKS = `
  select k.id, k.nome, k.criado_em, k.vence_em, k.ultimo_uso_em, k.desligado_em,
         cu.nome as criado_por_nome, du.nome as desligado_por_nome,
         case when k.desligado_em is not null then 'desligado'
              when k.vence_em is not null and k.vence_em <= now() then 'vencido'
              else 'valendo' end as situacao
    from link_ao_vivo k
    left join usuario cu on cu.id = k.criado_por
    left join usuario du on du.id = k.desligado_por
   where k.loja_id = $1 and k.tenant_id = $2`;

/** Gera o código do link. Exportado para o teste conferir a forma. */
export function gerarCodigoDoLink(): string {
  return randomBytes(32).toString('base64url');
}

type Conferido = { id: string; lojaId: string; venceEmMs: number | null; ate: number; usoAnotadoEm: number };

export function rotasDoLinkAoVivo(
  app: FastifyInstance,
  pool: pg.Pool,
  aoVivo: AoVivoDaApi,
  relogio: () => number = Date.now,
): void {
  const L = LINK_AO_VIVO;
  // ───────────── a conferência do código, com memória curta e limites ─────────────
  const memoria = new Map<string, Conferido>();
  const leituras = new JanelaFixa(L.leiturasPorMinuto, 60_000, relogio);
  let errados = { inicio: -Infinity, n: 0 };

  function esquecer(impressao: string): void {
    memoria.delete(impressao);
  }

  /** O link que o código abre — nulo = não vale; número = espere tantos segundos. */
  async function conferir(req: FastifyRequest): Promise<Conferido | null | { esperarSeg: number }> {
    const bruto = req.headers[CABECALHO_DO_LINK];
    const codigo = typeof bruto === 'string' ? bruto.trim() : '';
    if (!FORMA_DO_CODIGO.test(codigo)) return null;
    const impressao = hashDoToken(codigo);
    const agora = relogio();
    const limite = leituras.contar(impressao);
    if (!limite.ok) return { esperarSeg: limite.retryAfterSeg };

    let c = memoria.get(impressao);
    if (c && c.ate <= agora) {
      memoria.delete(impressao);
      c = undefined;
    }
    // Quem decide se vale: o BANCO, quando o código é lido de lá (desligado, prazo, loja e conta ativas); a MEMÓRIA,
    // enquanto guarda a conferência — aí o prazo é conferido pelo relógio, a cada leitura.
    const daMemoria = c !== undefined;
    if (!c) {
      if (agora - errados.inicio < 60_000 && errados.n >= L.codigosErradosPorMinuto) {
        return { esperarSeg: Math.max(1, Math.ceil((errados.inicio + 60_000 - agora) / 1000)) };
      }
      // Vale = não desligado, no prazo, e a loja e a conta ativas. A loja apagada leva o link junto (cascata).
      const { rows } = await pool.query<{ id: string; loja_id: string; vence_em: Date | null }>(
        `select k.id, k.loja_id, k.vence_em
           from link_ao_vivo k
           join loja l on l.id = k.loja_id and l.tenant_id = k.tenant_id
           join tenant t on t.id = k.tenant_id
          where k.token_hash = $1
            and k.desligado_em is null
            and (k.vence_em is null or k.vence_em > now())
            and l.ativa and t.ativo`,
        [impressao],
      );
      const l = rows[0];
      if (!l) {
        if (agora - errados.inicio >= 60_000) errados = { inicio: agora, n: 0 };
        errados.n += 1;
        return null;
      }
      c = { id: l.id, lojaId: l.loja_id, venceEmMs: l.vence_em ? l.vence_em.getTime() : null, ate: agora + L.memoriaMs, usoAnotadoEm: -Infinity };
      if (memoria.size > 5_000) for (const [k, v] of memoria) if (v.ate <= agora) memoria.delete(k);
      memoria.set(impressao, c);
    }
    // o prazo vale pelo relógio de verdade, mesmo com a conferência na memória
    if (daMemoria && c.venceEmMs !== null && c.venceEmMs <= Date.now()) {
      memoria.delete(impressao);
      return null;
    }
    if (agora - c.usoAnotadoEm >= L.anotarUsoACadaMs) {
      c.usoAnotadoEm = agora;
      try {
        await pool.query(
          `update link_ao_vivo set ultimo_uso_em = now()
            where id = $1 and (ultimo_uso_em is null or ultimo_uso_em < now() - interval '1 minute')`,
          [c.id],
        );
      } catch (e) {
        // anotar o uso é conforto da lista: não derruba a leitura
        req.log.warn({ err: e, link: c.id }, 'link do ao vivo: não consegui anotar o último uso');
      }
    }
    return c;
  }

  /** Responde o que não abriu. As respostas do link não ficam guardadas em lugar nenhum. */
  function recusar(resposta: FastifyReply, r: null | { esperarSeg: number }) {
    if (r && 'esperarSeg' in r) {
      return resposta
        .status(429)
        .header('retry-after', String(r.esperarSeg))
        .send({ erro: 'devagar', mensagem: `leituras demais por este link. Tente de novo em ${r.esperarSeg} s` });
    }
    return resposta.status(404).send(NAO_VALE);
  }
  const semGuardar = (resposta: FastifyReply) => resposta.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow');

  // ───────────────────────── o link: a planta e as pessoas ─────────────────────────

  app.get('/v1/ver', async (req, resposta) => {
    semGuardar(resposta);
    const c = await conferir(req);
    if (!c || 'esperarSeg' in c) return recusar(resposta, c);
    const loja = (await pool.query<{ nome: string; timezone: string }>('select nome, timezone from loja where id = $1', [c.lojaId])).rows[0];
    if (!loja) return recusar(resposta, null);
    const p = await plantaDaLoja(pool, c.lojaId);
    // Só o desenho: nada de câmera (onde fica e o que vê), de área de medida, do setor da loja nem do equipamento do
    // inventário. Campo a campo, de propósito: um campo novo na planta não sai por aqui sem alguém decidir.
    return {
      loja: { nome: loja.nome, fuso: loja.timezone },
      venceEm: c.venceEmMs === null ? null : new Date(c.venceEmMs).toISOString(),
      planta: {
        ambientes: (p?.planta.ambientes ?? []).map((a) => ({
          id: a.id, nome: a.nome, x: a.x, y: a.y, w: a.w, h: a.h, ...(a.tipo ? { tipo: a.tipo } : {}),
        })),
        moveis: (p?.planta.moveis ?? []).map((m) => ({
          id: m.id, nome: m.nome, x: m.x, y: m.y, w: m.w, h: m.h, alt: m.alt, ...(m.tipo ? { tipo: m.tipo } : {}),
        })),
      },
    };
  });

  app.get('/v1/ver/agora', async (req, resposta) => {
    semGuardar(resposta);
    const c = await conferir(req);
    if (!c || 'esperarSeg' in c) return recusar(resposta, c);
    const a = aoVivo.ler(c.lojaId);
    return {
      situacao: a.situacao,
      idadeS: a.idadeS,
      quando: a.quando,
      // sem os canais que viram cada pessoa: o link não diz onde ficam as câmeras
      pessoas: a.pessoas.map((p) => ({ n: p.n, x: p.x, y: p.y, vx: p.vx, vy: p.vy })),
    };
  });

  // ───────────────────────── o console: criar, listar, desligar ─────────────────────────

  /** A sessão, a loja da conta e a permissão; responde e devolve nulo quando não passa. */
  async function quemConfigura(req: FastifyRequest, resposta: FastifyReply): Promise<{ s: Sessao; lojaId: string } | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    const { id } = req.params as { id: string };
    if (!UUID.test(id) || (await pool.query('select 1 from loja where id = $1 and tenant_id = $2', [id, s.tenantId])).rowCount !== 1) {
      resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'loja não encontrada' });
      return null;
    }
    if (!podeConfigurar(s)) {
      resposta.status(403).send({
        erro: 'sem_permissao',
        mensagem: 'o link do ao vivo é criado e desligado por quem configura a loja (gerente para cima)',
      });
      return null;
    }
    return { s, lojaId: id };
  }

  app.get('/v1/lojas/:id/links-ao-vivo', async (req, resposta) => {
    const q = await quemConfigura(req, resposta);
    if (!q) return;
    // os que valem primeiro (no máximo 20, todos na lista), depois os mais novos dos que pararam
    const { rows } = await pool.query<LinhaDoLink>(
      `${SQL_DOS_LINKS}
       order by (k.desligado_em is null and (k.vence_em is null or k.vence_em > now())) desc, k.criado_em desc, k.id
       limit ${L.naLista}`,
      [q.lojaId, q.s.tenantId],
    );
    return { links: rows.map(comoNaTela), maximoValendo: L.maximoValendoPorLoja };
  });

  app.post('/v1/lojas/:id/links-ao-vivo', async (req, resposta) => {
    const q = await quemConfigura(req, resposta);
    if (!q) return;
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    // O código é a única coisa secreta aqui, e quem o gera é o servidor.
    const proibido = Object.keys(corpo).find((k) => ['codigo', 'código', 'token', 'token_hash', 'tokenhash', 'senha'].includes(k.toLowerCase()));
    if (proibido) {
      return resposta.status(400).send({ erro: 'segredo_no_corpo', mensagem: `campo "${proibido}" não entra aqui: o código do link é gerado pelo servidor` });
    }
    const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
    if (!nome || nome.length > L.nomeMaximo) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: `para quem é: de 1 a ${L.nomeMaximo} letras (ex.: Celular do gerente)` });
    }
    const dias = corpo.dias;
    if (!('dias' in corpo) || !(dias === null || (typeof dias === 'number' && L.prazosEmDias.includes(dias)))) {
      return resposta.status(422).send({
        erro: 'validacao',
        mensagem: `vale por: ${L.prazosEmDias.join(', ')} dias, ou nulo (até alguém desligar)`,
      });
    }

    const codigo = gerarCodigoDoLink();
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // duas pessoas criando ao mesmo tempo não passam juntas do máximo: a linha da loja fica presa até o fim
      await cliente.query('select 1 from loja where id = $1 for update', [q.lojaId]);
      const valendo = (await cliente.query<{ n: number }>(
        `select count(*)::int as n from link_ao_vivo
          where loja_id = $1 and desligado_em is null and (vence_em is null or vence_em > now())`,
        [q.lojaId],
      )).rows[0]!.n;
      if (valendo >= L.maximoValendoPorLoja) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'links_demais',
          mensagem: `esta loja já tem ${L.maximoValendoPorLoja} links valendo: desligue um antes de criar outro`,
        });
      }
      const { rows } = await cliente.query<{ id: string }>(
        `insert into link_ao_vivo (tenant_id, loja_id, nome, token_hash, criado_por, vence_em)
         values ($1, $2, $3, $4, $5, case when $6::int is null then null else now() + make_interval(days => $6::int) end)
         returning id`,
        [q.s.tenantId, q.lojaId, nome, hashDoToken(codigo), q.s.usuarioId, dias],
      );
      await cliente.query('commit');
      const linha = (await pool.query<LinhaDoLink>(`${SQL_DOS_LINKS} and k.id = $3`, [q.lojaId, q.s.tenantId, rows[0]!.id])).rows[0]!;
      // o registro diz quem criou e para quem; o código, nunca
      req.log.info({ loja: q.lojaId, link: linha.id, por: q.s.usuarioId }, 'link do ao vivo criado');
      return resposta.status(201).send({
        link: comoNaTela(linha),
        // Aparece UMA vez. O banco guarda só a impressão.
        codigo,
      });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  app.post('/v1/lojas/:id/links-ao-vivo/:link/desligar', async (req, resposta) => {
    const q = await quemConfigura(req, resposta);
    if (!q) return;
    const { link } = req.params as { link: string };
    if (!UUID.test(link)) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'link não encontrado' });
    // Desligar de novo não muda a hora nem quem desligou primeiro (o SET lê a linha de ANTES).
    const { rows } = await pool.query<{ token_hash: string }>(
      `update link_ao_vivo
          set desligado_em = coalesce(desligado_em, now()),
              desligado_por = case when desligado_em is null then $4::uuid else desligado_por end
        where id = $1 and loja_id = $2 and tenant_id = $3
      returning token_hash`,
      [link, q.lojaId, q.s.tenantId, q.s.usuarioId],
    );
    if (!rows[0]) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'link não encontrado' });
    // quem está com o link aberto para na próxima leitura, sem esperar a memória vencer
    esquecer(rows[0].token_hash);
    req.log.info({ loja: q.lojaId, link, por: q.s.usuarioId }, 'link do ao vivo desligado');
    const linha = (await pool.query<LinhaDoLink>(`${SQL_DOS_LINKS} and k.id = $3`, [q.lojaId, q.s.tenantId, link])).rows[0]!;
    return { link: comoNaTela(linha) };
  });
}
