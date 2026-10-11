// A leitura das fichas: quando acontece e o que cada desfecho deixa no banco.
//
// Do outro lado está o Regem de teste (um servidor de verdade), respondendo
// a amostra gravada do Regem real. O que se protege:
//
//   • a base da loja só muda quando o que o Farol guarda mudou;
//   • falha na leitura NÃO apaga a base: a de ontem continua valendo;
//   • acesso tirado no Regem apaga a base da loja na hora — e só a dela;
//   • uma leitura por loja de cada vez, e nenhuma grava depois que a
//     conexão saiu;
//   • a agenda: uma vez por dia, de madrugada no relógio DA LOJA.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import pg from 'pg';

import { criarApp } from '../src/app.js';
import { cifrar } from '../src/cifra.js';
import { impressaoDaBase } from '../src/fichas.js';
import {
  ESPERA_DEPOIS_DA_FALHA_MIN,
  lerAsLojasDaVez,
  lerEmSegundoPlano,
  lerFichasDaLoja,
  minutoDaLoja,
  proximaLeitura,
  semLeituraEmCurso,
  voltaDaLeitura,
} from '../src/leitura.js';
import { novoPedido, trocarCodigo, type ConfigDoRegem } from '../src/regem.js';
import { baseDoRegem } from '../src/regem-fichas.js';
import { subirRegemFalso, type Cardapio, type RegemFalso } from './regem-falso.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-lei-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-leitura';
const mudo = { warn: () => {}, info: () => {}, error: () => {} };

/** A hora e o minuto no relógio de um fuso. */
function relogio(instante: Date, fuso: string): { dia: string; hora: number; minuto: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  );
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), minuto: Number(p.minute) };
}

describe('leitura: a agenda', () => {
  const loja = '3f0c0c0e-1b1a-4c7e-9d55-0a1b2c3d4e5f';
  const mm = minutoDaLoja(loja);

  it('cada loja tem o seu minuto, sempre o mesmo', () => {
    assert.ok(mm >= 0 && mm <= 59);
    assert.equal(minutoDaLoja(loja), mm);
    const minutos = new Set(Array.from({ length: 300 }, () => minutoDaLoja(randomUUID())));
    assert.ok(minutos.size >= 40, `as lojas se espalham pelos minutos (${minutos.size} de 60)`);
    assert.ok([...minutos].every((m) => Number.isInteger(m) && m >= 0 && m <= 59));
  });

  it('é às 04:MM do relógio da loja — hoje, se ainda não passou; amanhã, se já passou', () => {
    // São Paulo está 3 horas atrás do UTC: 04:MM lá são 07:MM aqui.
    const cedo = proximaLeitura(new Date('2026-10-11T05:00:00Z'), 'America/Sao_Paulo', loja);
    assert.equal(cedo.toISOString(), new Date(Date.UTC(2026, 9, 11, 7, mm)).toISOString());
    const tarde = proximaLeitura(new Date('2026-10-11T10:00:00Z'), 'America/Sao_Paulo', loja);
    assert.equal(tarde.toISOString(), new Date(Date.UTC(2026, 9, 12, 7, mm)).toISOString());
    // Manaus está 4 horas atrás.
    const manaus = proximaLeitura(new Date('2026-10-11T10:00:00Z'), 'America/Manaus', loja);
    assert.equal(manaus.toISOString(), new Date(Date.UTC(2026, 9, 12, 8, mm)).toISOString());
  });

  it('é sempre DEPOIS de agora — no instante exato da leitura, a próxima é a do dia seguinte', () => {
    const naHora = new Date(Date.UTC(2026, 9, 11, 7, mm));
    assert.equal(proximaLeitura(naHora, 'America/Sao_Paulo', loja).toISOString(), new Date(Date.UTC(2026, 9, 12, 7, mm)).toISOString());
    const umSegundoAntes = new Date(naHora.getTime() - 1000);
    assert.equal(proximaLeitura(umSegundoAntes, 'America/Sao_Paulo', loja).toISOString(), naHora.toISOString());
  });

  it('em qualquer fuso cai às 04:MM de lá — inclusive na virada do horário de verão', () => {
    const agoras = ['2026-01-15T00:30:00Z', '2026-03-28T22:00:00Z', '2026-06-30T13:00:00Z', '2026-10-24T12:00:00Z', '2026-12-31T23:59:00Z'];
    for (const fuso of ['America/Sao_Paulo', 'America/Manaus', 'America/Noronha', 'Europe/Lisbon', 'Asia/Tokyo', 'UTC', 'Asia/Kolkata']) {
      for (const texto of agoras) {
        const agora = new Date(texto);
        const prox = proximaLeitura(agora, fuso, loja);
        const r = relogio(prox, fuso);
        assert.deepEqual([r.hora, r.minuto], [4, mm], `${fuso} a partir de ${texto}: ${prox.toISOString()}`);
        assert.ok(prox.getTime() > agora.getTime());
        assert.ok(prox.getTime() - agora.getTime() <= 25 * 3600_000, 'no máximo um dia adiante (25 h na virada)');
      }
    }
    // Lisboa atrasa o relógio em 25/10/2026: às 04:MM de lá já é UTC puro.
    const lisboa = proximaLeitura(new Date('2026-10-24T12:00:00Z'), 'Europe/Lisbon', loja);
    assert.equal(lisboa.toISOString(), new Date(Date.UTC(2026, 9, 25, 4, mm)).toISOString());
  });

  it('fuso que o sistema não conhece não derruba a agenda: vale daqui a 24 horas', () => {
    const agora = new Date('2026-10-11T10:00:00Z');
    for (const fuso of ['Marte/Olympus', '', 'nao e fuso']) {
      assert.equal(proximaLeitura(agora, fuso, loja).toISOString(), '2026-10-12T10:00:00.000Z', fuso);
    }
  });
});

describe('leitura: a volta da rotina, sem banco', () => {
  const cfgCom = { chave: randomBytes(32) } as ConfigDoRegem;
  /** Um banco de mentira que conta as consultas e responde (ou quebra) como o teste mandar. */
  function banco(responder: () => unknown) {
    const consultas: string[] = [];
    return {
      consultas,
      pool: { query: async (sql: string) => (consultas.push(sql), responder()) } as unknown as pg.Pool,
    };
  }
  function registro() {
    const linhas: Array<[string, string]> = [];
    return {
      linhas,
      log: {
        warn: (_o: object, m: string) => void linhas.push(['warn', m]),
        info: (_o: object, m: string) => void linhas.push(['info', m]),
        error: (_o: object, m: string) => void linhas.push(['error', m]),
      },
    };
  }

  it('com a porta do serviço recusando, ou sem a chave dos acessos, nem consulta o banco', async () => {
    const b = banco(() => ({ rows: [] }));
    const r = registro();
    await voltaDaLeitura(b.pool, cfgCom, r.log, () => false, { avisouQueFaltaMigrar: false });
    await voltaDaLeitura(b.pool, { ...cfgCom, chave: null }, r.log, () => true, { avisouQueFaltaMigrar: false });
    assert.deepEqual([b.consultas.length, r.linhas], [0, []]);
    await voltaDaLeitura(b.pool, cfgCom, r.log, () => true, { avisouQueFaltaMigrar: false });
    assert.equal(b.consultas.length, 1, 'com tudo no lugar, consulta');
    assert.deepEqual(r.linhas, [], 'sem loja na vez, não escreve nada');
  });

  it('tabela ou coluna que ainda não existe: avisa UMA vez, e volta a avisar só depois de ter funcionado', async () => {
    for (const codigo of ['42P01', '42703']) {
      let quebrado = true;
      const b = banco(() => {
        if (quebrado) throw Object.assign(new Error('relation does not exist'), { code: codigo });
        return { rows: [] };
      });
      const r = registro();
      const memoria = { avisouQueFaltaMigrar: false };
      for (let i = 0; i < 4; i += 1) await voltaDaLeitura(b.pool, cfgCom, r.log, () => true, memoria);
      assert.deepEqual(r.linhas.map((l) => l[0]), ['warn'], `${codigo}: quatro voltas, um aviso`);
      assert.match(r.linhas[0]![1], /falta aplicar as migrations/);
      quebrado = false;
      await voltaDaLeitura(b.pool, cfgCom, r.log, () => true, memoria);
      assert.equal(memoria.avisouQueFaltaMigrar, false, 'funcionou: a memória do aviso zera');
      quebrado = true;
      await voltaDaLeitura(b.pool, cfgCom, r.log, () => true, memoria);
      assert.equal(r.linhas.length, 2, 'quebrou de novo: avisa de novo');
    }
  });

  it('uma loja que quebra não segura as outras: as duas da vez são tentadas, e a rotina não rejeita', async () => {
    let consulta = 0;
    const b = banco(() => {
      consulta += 1;
      // A primeira consulta é a lista das lojas da vez; daí em diante, o banco "cai".
      if (consulta === 1) return { rows: [{ id: 'a' }, { id: 'b' }] };
      throw new Error('o banco caiu no meio');
    });
    const r = registro();
    const feito = await lerAsLojasDaVez(b.pool, cfgCom, r.log);
    assert.deepEqual(feito, { lidas: 2, desfechos: { falhou: 2 } });
    assert.deepEqual(r.linhas.map((l) => l[0]), ['error', 'error'], 'cada uma com o seu erro no registro');
  });

  it('qualquer outro erro vai para o registro, a cada volta — e a rotina nunca rejeita', async () => {
    const b = banco(() => {
      throw Object.assign(new Error('conexão recusada'), { code: '08006' });
    });
    const r = registro();
    const memoria = { avisouQueFaltaMigrar: false };
    await voltaDaLeitura(b.pool, cfgCom, r.log, () => true, memoria);
    await voltaDaLeitura(b.pool, cfgCom, r.log, () => true, memoria);
    assert.deepEqual(r.linhas.map((l) => l[0]), ['error', 'error']);
    assert.equal(memoria.avisouQueFaltaMigrar, false);
  });
});

describe('leitura: as fichas de uma loja', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { segredo: string; chave: Buffer };
  let adminAntes: string | undefined;
  const minha = { tenantId: '', centro: '', barra: '' };
  const vizinha = { tenantId: '', loja: '' };
  const contas = () => [minha.tenantId, vizinha.tenantId];

  /** Uma loja ligada, com um acesso que vale no Regem de teste. */
  async function ligada(tenantId: string, lojaId: string, nome = 'Loja de lá') {
    const regemLojaId = randomUUID();
    const p = novoPedido();
    const codigo = falso.autorizar({ lojas: [{ id: regemLojaId, nome }], desafio: p.desafio, redirectUri: cfg.retornoUrl });
    const [l] = await trocarCodigo(cfg, { codigo, verificador: p.verificador });
    const { rows } = await pool.query(
      `insert into regem_loja (tenant_id, loja_id, regem_loja_id, regem_loja_nome, regem_empresa_nome, acesso_cifrado, ligado_em)
       values ($1, $2, $3, $4, 'Empresa de lá', $5, now()) returning id`,
      [tenantId, lojaId, regemLojaId, nome, cifrar(l!.acesso, cfg.chave, `acesso:${tenantId}:${regemLojaId}`)],
    );
    falso.chamadas.length = 0;
    return { id: rows[0].id as string, regemLojaId, acesso: l!.acesso };
  }
  const estado = async (id: string) => (await pool.query('select * from regem_loja where id = $1', [id])).rows[0];
  const baseDe = async (lojaId: string) => (await pool.query('select * from fichas_da_loja where loja_id = $1', [lojaId])).rows[0] ?? null;
  const ler = (id: string, c: ConfigDoRegem = cfg) => lerFichasDaLoja(pool, c, id, mudo);
  const leituras = () => falso.chamadas.filter((c) => /^\/integracao\/(catalogo|fichas)/.test(c.caminho)).map((c) => c.caminho);
  /** A amostra com uma mudança: o teste diz o que o Regem passa a responder para uma loja. */
  function mudado(mudar: (c: Cardapio & { produtos: any[]; fichas: any[] }) => void): Cardapio {
    const c = structuredClone(falso.amostra) as Cardapio & { produtos: any[]; fichas: any[] };
    mudar(c);
    return c;
  }
  const esperarSeguradas = async (n: number) => {
    const limite = Date.now() + 5000;
    while (falso.seguradas() < n) {
      assert.ok(Date.now() < limite, `as ${n} leituras não chegaram ao Regem`);
      await new Promise((ok) => setTimeout(ok, 15));
    }
  };

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    falso = await subirRegemFalso();
    cfg = {
      apiUrl: falso.url,
      appUrl: 'https://regem.exemplo',
      retornoUrl: 'https://console.exemplo/api/regem/retorno',
      consoleUrl: 'https://console.exemplo',
      segredo: falso.segredo,
      chave: randomBytes(32),
      buscar: fetch,
      prazoMs: 400,
      agente: 'farol-api/teste (+https://monitorfarol.com.br)',
    };
    const app = criarApp(pool, { logger: false, regem: cfg });
    await app.ready();
    const criar = async (nome: string, conta: object) => {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/distribuicao/lojas',
        headers: { 'x-farol-admin': ADMIN },
        payload: { ...conta, loja: { nome }, setores: [{ nome: 'Cozinha' }] },
      });
      assert.equal(r.statusCode, 201, r.body);
      return { tenantId: r.json().tenantId as string, lojaId: r.json().loja.id as string };
    };
    const centro = await criar('Loja Centro', { tenant: { nome: `${marca}-minha` } });
    minha.tenantId = centro.tenantId;
    minha.centro = centro.lojaId;
    minha.barra = (await criar('Loja Barra', { tenantId: minha.tenantId })).lojaId;
    const outra = await criar('Loja Vizinha', { tenant: { nome: `${marca}-vizinha` } });
    vizinha.tenantId = outra.tenantId;
    vizinha.loja = outra.lojaId;
    // A Barra fica em outro fuso: a agenda é pelo relógio de cada loja.
    await pool.query("update loja set timezone = 'America/Manaus' where id = $1", [minha.barra]);
    await app.close();
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    falso?.soltar();
    await semLeituraEmCurso();
    await falso?.fechar();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  beforeEach(async () => {
    falso.modo = 'normal';
    falso.leituraTorta = null;
    falso.soltar();
    await semLeituraEmCurso();
    falso.chamadas.length = 0;
    await pool.query('delete from fichas_da_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_loja where tenant_id = any($1::uuid[])', [contas()]);
  });

  // ───────────────────────── a primeira leitura e as seguintes ─────────────────────────

  it('a primeira leitura guarda a base da loja e marca a próxima para a madrugada de lá', async () => {
    const c = await ligada(minha.tenantId, minha.barra);
    const antes = Date.now();
    assert.deepEqual(await ler(c.id), { desfecho: 'atualizada' });

    const esperada = baseDoRegem(
      { categorias: falso.amostra.categorias, setores: falso.amostra.setores, produtos: falso.amostra.produtos },
      { fichas: falso.amostra.fichas },
    );
    const b = await baseDe(minha.barra);
    assert.deepEqual(b.conteudo, esperada, 'o documento guardado é o do adaptador, inteiro');
    assert.deepEqual([b.fonte, b.produtos, b.com_ficha, b.tenant_id, b.impressao], ['regem', 4, 1, minha.tenantId, impressaoDaBase(esperada)]);

    const e = await estado(c.id);
    assert.ok(e.lida_em >= new Date(antes - 1000) && e.tentada_em >= new Date(antes - 1000));
    assert.deepEqual([e.falha, e.lendo_desde, e.acesso_tirado_em], [null, null, null]);
    assert.match(e.versao_catalogo, /^[0-9a-f]{32}$/);
    assert.match(e.versao_fichas, /^[0-9a-f]{32}$/);
    // A próxima: amanhã (ou hoje mais tarde), às 04:MM de MANAUS.
    const r = relogio(e.proxima_em, 'America/Manaus');
    assert.deepEqual([r.hora, r.minuto], [4, minutoDaLoja(minha.barra)]);
    assert.ok(e.proxima_em > new Date() && e.proxima_em.getTime() - Date.now() <= 25 * 3600_000);

    // Duas chamadas, sem versão (não havia base), com o acesso e o nome próprio.
    assert.deepEqual(leituras().sort(), ['/integracao/catalogo', '/integracao/fichas']);
    assert.ok(falso.chamadas.every((x) => x.comAcesso && x.agente === cfg.agente && x.tipo === null));
  });

  it('a seguinte pergunta com a versão que tem: se nada mudou, a base nem é tocada', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    const b1 = await baseDe(minha.centro);
    const e1 = await estado(c.id);
    falso.chamadas.length = 0;
    await pool.query("update regem_loja set lida_em = now() - interval '1 day', proxima_em = now() - interval '1 minute' where id = $1", [c.id]);

    assert.deepEqual(await ler(c.id), { desfecho: 'nada_mudou' });
    assert.deepEqual(leituras().sort(), [`/integracao/catalogo?versao=${e1.versao_catalogo}`, `/integracao/fichas?versao=${e1.versao_fichas}`]);
    const b2 = await baseDe(minha.centro);
    assert.equal(b2.atualizada_em.getTime(), b1.atualizada_em.getTime(), 'a base não foi regravada');
    const e2 = await estado(c.id);
    assert.ok(Date.now() - e2.lida_em.getTime() < 10_000, 'a hora da leitura andou');
    assert.ok(e2.proxima_em > new Date(), 'e a agenda foi para a frente');
    assert.deepEqual([e2.versao_catalogo, e2.versao_fichas, e2.falha], [e1.versao_catalogo, e1.versao_fichas, null]);
    assert.equal(e2.lendo_desde, null, 'a vez foi solta: a leitura seguinte não encontra a loja "ocupada"');
    assert.deepEqual(await ler(c.id), { desfecho: 'nada_mudou' });
  });

  it('mudou só o cardápio: o Farol busca os DOIS inteiros e troca a base', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    const b1 = await baseDe(minha.centro);
    const e1 = await estado(c.id);
    falso.chamadas.length = 0;
    falso.cardapio(c.regemLojaId, mudado((m) => void (m.produtos.find((p) => p.nome === 'Só da matriz').nome = 'Prato do dia')));

    assert.deepEqual(await ler(c.id), { desfecho: 'atualizada' });
    // As duas perguntas com versão e, porque o cardápio mudou, as fichas inteiras de novo.
    assert.deepEqual(
      [...leituras()].sort(),
      ['/integracao/fichas', `/integracao/catalogo?versao=${e1.versao_catalogo}`, `/integracao/fichas?versao=${e1.versao_fichas}`].sort(),
    );
    const b2 = await baseDe(minha.centro);
    assert.ok(b2.conteudo.produtos.some((p: { nome: string }) => p.nome === 'Prato do dia'));
    assert.notEqual(b2.impressao, b1.impressao);
    assert.ok(b2.atualizada_em > b1.atualizada_em);
    const e2 = await estado(c.id);
    assert.notEqual(e2.versao_catalogo, e1.versao_catalogo);
    assert.equal(e2.versao_fichas, e1.versao_fichas, 'as fichas não mudaram: a versão delas é a mesma');
  });

  it('mudou só as fichas: a mesma coisa, pelo outro lado', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    falso.chamadas.length = 0;
    falso.cardapio(c.regemLojaId, mudado((m) => void (m.fichas.find((f) => f.nome === 'X-Burger').ingredientes[2].quantidade = 3)));

    assert.deepEqual(await ler(c.id), { desfecho: 'atualizada' });
    assert.equal(leituras().length, 3);
    assert.ok(leituras().includes('/integracao/catalogo'), 'o cardápio inteiro de novo');
    const xb = (await baseDe(minha.centro)).conteudo.produtos.find((p: { nome: string }) => p.nome === 'X-Burger');
    assert.equal(xb.ficha.ingredientes.find((i: { nome: string }) => i.nome === 'Queijo prato').quantidade, 3);
  });

  it('o Regem mudou o que a base não guarda (os ids que trocam a cada salvamento): nada muda aqui, e a versão nova fica anotada', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    const b1 = await baseDe(minha.centro);
    const e1 = await estado(c.id);
    falso.cardapio(c.regemLojaId, mudado((m) => {
      for (const v of m.produtos.find((p) => p.nome === 'X-Burger').variacoes) v.id = randomUUID();
    }));

    assert.deepEqual(await ler(c.id), { desfecho: 'nada_mudou' });
    const b2 = await baseDe(minha.centro);
    assert.deepEqual([b2.impressao, b2.atualizada_em.getTime()], [b1.impressao, b1.atualizada_em.getTime()]);
    const e2 = await estado(c.id);
    assert.notEqual(e2.versao_catalogo, e1.versao_catalogo, 'a versão de lá mudou, e é a nova que o Farol guarda');
    // …e por isso a leitura seguinte volta a ser a barata: duas perguntas, "nada mudou".
    falso.chamadas.length = 0;
    assert.deepEqual(await ler(c.id), { desfecho: 'nada_mudou' });
    assert.equal(leituras().length, 2);
  });

  it('duas lojas: cada uma com o seu cardápio, sem misturar', async () => {
    const centro = await ligada(minha.tenantId, minha.centro, 'Centro de lá');
    const barra = await ligada(minha.tenantId, minha.barra, 'Barra de lá');
    falso.cardapio(barra.regemLojaId, { categorias: [], setores: [], produtos: [{ id: randomUUID(), nome: 'Açaí 300 ml', ativo: true }], fichas: [] });
    assert.deepEqual([await ler(centro.id), await ler(barra.id)], [{ desfecho: 'atualizada' }, { desfecho: 'atualizada' }]);

    const [c, b] = [await baseDe(minha.centro), await baseDe(minha.barra)];
    assert.deepEqual([c.produtos, c.com_ficha], [4, 1]);
    assert.deepEqual([b.produtos, b.com_ficha, b.conteudo.produtos.map((p: { nome: string }) => p.nome)], [1, 0, ['Açaí 300 ml']]);
    assert.equal(await baseDe(vizinha.loja), null);
  });

  // ───────────────────────── quando dá errado ─────────────────────────

  it('falha na leitura: a base de ontem continua valendo, o motivo fica guardado, e a próxima tentativa é em meia hora', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    const b1 = await baseDe(minha.centro);
    const e1 = await estado(c.id);

    const casos: Array<[string, () => void, string]> = [
      ['fora do ar', () => void (falso.modo = 'fora'), 'sem_resposta'],
      ['pedindo calma', () => void (falso.modo = 'devagar'), 'sem_resposta'],
      ['mudo', () => void (falso.modo = 'mudo'), 'sem_resposta'],
      ['uma página no lugar do JSON', () => void (falso.modo = 'pagina'), 'resposta_torta'],
      ['recusa que não é do acesso (403)', () => void (falso.modo = 'proibido'), 'recusado'],
      ['sem a versão', () => void (falso.leituraTorta = (_q, corpo) => ({ ...corpo, versao: undefined })), 'resposta_torta'],
      ['versão que não é versão', () => void (falso.leituraTorta = (_q, corpo) => ({ ...corpo, versao: 'ontem' })), 'resposta_torta'],
      ['sem dizer se mudou', () => void (falso.leituraTorta = (_q, corpo) => ({ ...corpo, atualizado: 'sim' })), 'resposta_torta'],
      ['nulo', () => void (falso.leituraTorta = () => null), 'resposta_torta'],
    ];
    for (const [nome, preparar, falha] of casos) {
      falso.modo = 'normal';
      falso.leituraTorta = null;
      preparar();
      const comeco = Date.now();
      assert.deepEqual(await ler(c.id), { desfecho: 'falhou', falha }, nome);
      assert.ok(Date.now() - comeco < 4000, `${nome}: não ficou preso`);
      const e = await estado(c.id);
      assert.deepEqual([e.falha, e.lendo_desde], [falha, null], nome);
      assert.equal(e.lida_em.getTime(), e1.lida_em.getTime(), `${nome}: a última leitura BOA é a de antes`);
      const espera = (e.proxima_em.getTime() - Date.now()) / 60_000;
      assert.ok(Math.abs(espera - ESPERA_DEPOIS_DA_FALHA_MIN) < 1, `${nome}: tenta de novo em meia hora (${espera.toFixed(1)} min)`);
      const b = await baseDe(minha.centro);
      assert.deepEqual([b.impressao, b.atualizada_em.getTime()], [b1.impressao, b1.atualizada_em.getTime()], `${nome}: a base é a de antes`);
    }
    assert.equal(ESPERA_DEPOIS_DA_FALHA_MIN, 30);

    // A recuperação: o Regem voltou, a leitura passa e o motivo some.
    falso.modo = 'normal';
    falso.leituraTorta = null;
    assert.deepEqual(await ler(c.id), { desfecho: 'nada_mudou' });
    const depois = await estado(c.id);
    assert.equal(depois.falha, null);
    assert.ok(depois.lida_em > e1.lida_em);
  });

  it('resposta que chega inteira mas não é a de uma loja (produto sem nome): a base de ontem fica', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    const b1 = await baseDe(minha.centro);
    falso.cardapio(c.regemLojaId, mudado((m) => void (m.produtos[0].nome = null)));

    assert.deepEqual(await ler(c.id), { desfecho: 'falhou', falha: 'resposta_torta' });
    assert.equal((await baseDe(minha.centro)).impressao, b1.impressao);
    assert.equal((await estado(c.id)).falha, 'resposta_torta');
  });

  it('"nada mudou" como resposta a quem NÃO perguntou com versão não vale: sem base, não há o que manter', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    falso.leituraTorta = (_q, corpo) => ({ versao: corpo.versao, atualizado: false });
    assert.deepEqual(await ler(c.id), { desfecho: 'falhou', falha: 'resposta_torta' });
    assert.equal(await baseDe(minha.centro), null);
    assert.deepEqual(leituras().sort(), ['/integracao/catalogo', '/integracao/fichas'], 'a pergunta foi sem versão');
  });

  it('resposta inteira, mas sem dizer direito se mudou ("atualizado" que não é sim nem não): não vale', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    // O corpo vem completo — produtos, fichas, versão —, e só o `atualizado` não é o que o contrato diz.
    falso.leituraTorta = (_q, corpo) => ({ ...corpo, atualizado: 'sim' });
    assert.deepEqual(await ler(c.id), { desfecho: 'falhou', falha: 'resposta_torta' });
    assert.equal(await baseDe(minha.centro), null, 'nenhuma base nasce de uma resposta fora do contrato');
  });

  it('a loja tirou produtos do cardápio: a contagem da base acompanha', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    assert.deepEqual([(await baseDe(minha.centro)).produtos, (await baseDe(minha.centro)).com_ficha], [4, 1]);
    falso.cardapio(c.regemLojaId, mudado((m) => void (m.produtos = m.produtos.filter((p) => p.nome === 'Refrigerante lata'))));
    assert.deepEqual(await ler(c.id), { desfecho: 'atualizada' });
    const b = await baseDe(minha.centro);
    assert.deepEqual([b.produtos, b.com_ficha, b.conteudo.produtos.length], [1, 0, 1]);
  });

  it('a base sumiu e a versão ficou anotada: a leitura não pergunta "mudou?" — traz tudo de novo', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    await pool.query('delete from fichas_da_loja where loja_id = $1', [minha.centro]);
    falso.chamadas.length = 0;
    assert.deepEqual(await ler(c.id), { desfecho: 'atualizada' });
    assert.deepEqual(leituras().sort(), ['/integracao/catalogo', '/integracao/fichas'], 'sem versão: "nada mudou" não traria base nenhuma');
    assert.equal((await baseDe(minha.centro)).produtos, 4);
  });

  it('primeira leitura que falha: a loja fica sem base, com o motivo — e a seguinte, boa, a cria', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    falso.modo = 'fora';
    assert.deepEqual(await ler(c.id), { desfecho: 'falhou', falha: 'sem_resposta' });
    assert.equal(await baseDe(minha.centro), null);
    assert.deepEqual([(await estado(c.id)).lida_em, (await estado(c.id)).falha], [null, 'sem_resposta']);
    falso.modo = 'normal';
    assert.deepEqual(await ler(c.id), { desfecho: 'atualizada' });
    assert.equal((await baseDe(minha.centro)).produtos, 4);
    // A leitura boa que TROCA a base também limpa o motivo da falha de antes.
    const e = await estado(c.id);
    assert.deepEqual([e.falha, e.lendo_desde], [null, null]);
    assert.ok(e.lida_em && e.proxima_em > new Date());
  });

  it('acesso tirado no Regem: a base da loja é apagada na hora — e só a dela', async () => {
    const centro = await ligada(minha.tenantId, minha.centro);
    const barra = await ligada(minha.tenantId, minha.barra);
    await ler(centro.id);
    await ler(barra.id);
    falso.tirar(centro.acesso);
    falso.chamadas.length = 0;

    assert.deepEqual(await ler(centro.id), { desfecho: 'acesso_tirado' });
    assert.equal(await baseDe(minha.centro), null, 'sem acesso, sem fichas');
    assert.equal((await baseDe(minha.barra)).produtos, 4, 'a da outra loja não foi tocada');
    const e = await estado(centro.id);
    assert.ok(Date.now() - e.acesso_tirado_em.getTime() < 10_000);
    assert.deepEqual([e.falha, e.lendo_desde, e.proxima_em, e.versao_catalogo, e.versao_fichas], [null, null, null, null, null]);
    assert.equal(e.loja_id, minha.centro, 'a ligação fica, para a tela dizer o que houve');

    // Daí em diante não há o que ler: nem chama o Regem.
    falso.chamadas.length = 0;
    assert.deepEqual(await ler(centro.id), { desfecho: 'nao_ligada' });
    assert.equal(falso.chamadas.length, 0);
    assert.deepEqual((await lerAsLojasDaVez(pool, cfg, mudo, { contas: contas() })).lidas, 0, 'e a rotina não a pega (a Barra já tem a agenda para amanhã)');
  });

  it('acesso tirado no meio da leitura (as fichas já tinham vindo): vale o que o Regem disse por último', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    falso.cardapio(c.regemLojaId, mudado((m) => void (m.produtos[0].nome = 'Outro nome')));
    // O cardápio mudou, as fichas não: a terceira chamada (as fichas inteiras) já encontra o acesso tirado.
    falso.segurar();
    const lendo = ler(c.id);
    await esperarSeguradas(2);
    falso.soltar();
    await new Promise((ok) => setTimeout(ok, 30));
    falso.tirar(c.acesso);
    const r = await lendo;
    // As duas primeiras respostas podem ter saído antes do "tirar"; a terceira, não.
    assert.ok(r.desfecho === 'acesso_tirado' || r.desfecho === 'atualizada', r.desfecho);
    if (r.desfecho === 'acesso_tirado') assert.equal(await baseDe(minha.centro), null);
  });

  it('o acesso guardado não dá para ler (a chave do ambiente mudou): falha, sem chamar o Regem, e a base fica', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    falso.chamadas.length = 0;
    assert.deepEqual(await ler(c.id, { ...cfg, chave: randomBytes(32) }), { desfecho: 'falhou', falha: 'acesso_ilegivel' });
    assert.deepEqual(await ler(c.id, { ...cfg, chave: null }), { desfecho: 'falhou', falha: 'acesso_ilegivel' });
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await baseDe(minha.centro)).produtos, 4);
    assert.equal((await estado(c.id)).falha, 'acesso_ilegivel');
  });

  // ───────────────────────── uma de cada vez ─────────────────────────

  it('uma leitura por loja de cada vez: a segunda encontra a vez ocupada e nem chama o Regem', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    falso.segurar();
    const primeira = ler(c.id);
    await esperarSeguradas(2);
    assert.deepEqual(await ler(c.id), { desfecho: 'ocupada' });
    assert.equal(leituras().length, 2, 'só as duas chamadas da primeira');
    falso.soltar();
    assert.deepEqual(await primeira, { desfecho: 'atualizada' });
    assert.equal((await estado(c.id)).lendo_desde, null, 'terminou: a vez está livre');
    assert.deepEqual(await ler(c.id), { desfecho: 'nada_mudou' });
  });

  it('leitura que morreu no meio solta a vez em três minutos', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await pool.query("update regem_loja set lendo_desde = now() - interval '2 minutes 50 seconds' where id = $1", [c.id]);
    assert.deepEqual(await ler(c.id), { desfecho: 'ocupada' }, 'antes dos três minutos, ainda é dela');
    await pool.query("update regem_loja set lendo_desde = now() - interval '3 minutes 10 seconds' where id = $1", [c.id]);
    assert.deepEqual(await ler(c.id), { desfecho: 'atualizada' });
  });

  it('desconectada no meio da leitura: a base NÃO volta', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    await ler(c.id);
    falso.cardapio(c.regemLojaId, mudado((m) => void (m.produtos[0].nome = 'Nome novo')));
    falso.segurar();
    const lendo = ler(c.id);
    await esperarSeguradas(2);
    // O que a rota de desconectar faz: a ligação e a base saem juntas.
    await pool.query(
      `with saiu as (delete from regem_loja where id = $1 returning loja_id)
       delete from fichas_da_loja f using saiu where f.loja_id = saiu.loja_id`,
      [c.id],
    );
    falso.soltar();
    assert.deepEqual(await lendo, { desfecho: 'nao_ligada' });
    assert.equal(await baseDe(minha.centro), null, 'quem desconectou não vê as fichas reaparecerem');
  });

  it('não há o que ler: conexão que não existe, e loja autorizada que ainda não foi ligada', async () => {
    assert.deepEqual(await ler(randomUUID()), { desfecho: 'nao_ligada' });
    const c = await ligada(minha.tenantId, minha.centro);
    await pool.query('update regem_loja set loja_id = null where id = $1', [c.id]);
    assert.deepEqual(await ler(c.id), { desfecho: 'nao_ligada' });
    assert.equal(falso.chamadas.length, 0);
  });

  // ───────────────────────── a rotina ─────────────────────────

  it('a rotina lê quem está na vez — a agenda vazia primeiro — e deixa quem ainda não chegou', async () => {
    const nova = await ligada(minha.tenantId, minha.centro);
    const vencida = await ligada(minha.tenantId, minha.barra);
    const futura = await ligada(vizinha.tenantId, vizinha.loja);
    await pool.query("update regem_loja set proxima_em = now() - interval '1 minute' where id = $1", [vencida.id]);
    await pool.query("update regem_loja set proxima_em = now() + interval '5 hours' where id = $1", [futura.id]);

    // Com limite 1: só a de agenda vazia (recém-ligada).
    const uma = await lerAsLojasDaVez(pool, cfg, mudo, { limite: 1, contas: contas() });
    assert.deepEqual(uma, { lidas: 1, desfechos: { atualizada: 1 } });
    assert.ok(await baseDe(minha.centro));
    assert.equal(await baseDe(minha.barra), null);

    const resto = await lerAsLojasDaVez(pool, cfg, mudo, { contas: contas() });
    assert.deepEqual(resto, { lidas: 1, desfechos: { atualizada: 1 } });
    assert.ok(await baseDe(minha.barra));
    assert.equal(await baseDe(vizinha.loja), null, 'a que tem a agenda para daqui a cinco horas não foi lida');

    // Todas com a agenda para a frente: a volta seguinte não acha ninguém.
    falso.chamadas.length = 0;
    assert.deepEqual(await lerAsLojasDaVez(pool, cfg, mudo, { contas: contas() }), { lidas: 0, desfechos: {} });
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await estado(nova.id)).falha, null);
  });

  it('a rotina não pega loja com leitura em curso, sem par ou com o acesso tirado — e conta os desfechos', async () => {
    const emCurso = await ligada(minha.tenantId, minha.centro);
    const boa = await ligada(minha.tenantId, minha.barra);
    const cai = await ligada(vizinha.tenantId, vizinha.loja);
    await pool.query('update regem_loja set lendo_desde = now() where id = $1', [emCurso.id]);
    falso.tirar(cai.acesso);

    const r = await lerAsLojasDaVez(pool, cfg, mudo, { contas: contas() });
    assert.deepEqual(r, { lidas: 2, desfechos: { atualizada: 1, acesso_tirado: 1 } });
    assert.ok(await baseDe(minha.barra));
    assert.equal((await estado(boa.id)).falha, null);
    assert.equal(await baseDe(minha.centro), null, 'a que estava em leitura ficou de fora');
    // Com o acesso tirado, sai da agenda de vez.
    await pool.query('update regem_loja set lendo_desde = null where id = $1', [emCurso.id]);
    assert.deepEqual((await lerAsLojasDaVez(pool, cfg, mudo, { contas: contas() })).desfechos, { atualizada: 1 });
  });

  it('a volta da rotina, com banco: lê as lojas da vez e não rejeita quando o Regem está fora', async () => {
    const c = await ligada(minha.tenantId, minha.centro);
    falso.modo = 'fora';
    const memoria = { avisouQueFaltaMigrar: true };
    await voltaDaLeitura(pool, cfg, mudo, () => true, memoria, { contas: contas() });
    assert.equal((await estado(c.id)).falha, 'sem_resposta');
    assert.equal(memoria.avisouQueFaltaMigrar, false);
    // A falha adiou a loja meia hora: a volta seguinte não insiste.
    falso.modo = 'normal';
    falso.chamadas.length = 0;
    await voltaDaLeitura(pool, cfg, mudo, () => true, memoria, { contas: contas() });
    assert.equal(falso.chamadas.length, 0);
    assert.equal(await baseDe(minha.centro), null);
  });

  it('em segundo plano: quem chamou não espera, e as duas lojas acabam lidas', async () => {
    const a = await ligada(minha.tenantId, minha.centro);
    const b = await ligada(minha.tenantId, minha.barra);
    falso.segurar();
    lerEmSegundoPlano(pool, cfg, [a.id, b.id], mudo);
    lerEmSegundoPlano(pool, cfg, [], mudo);
    await esperarSeguradas(2);
    assert.equal(await baseDe(minha.centro), null, 'ainda lendo: quem chamou já seguiu');
    falso.soltar();
    await semLeituraEmCurso();
    assert.deepEqual([(await baseDe(minha.centro)).produtos, (await baseDe(minha.barra)).produtos], [4, 4]);
  });
});
