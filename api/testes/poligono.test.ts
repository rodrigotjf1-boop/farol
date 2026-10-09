// O desenho da área de análise: o que a API aceita e o que recusa.
//
// A área deixou de ser só retângulo (pedido do dono, 08/10/2026: "a marcação
// tem que ser flexível, para uma área não invadir outra"). O agente recorta
// o desenho e apaga o que fica fora dele — então desenho sem sentido não dá
// erro na tela: dá recorte errado. O que não faz sentido é recusado aqui.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { AREA_MINIMA, areaDoPoligono, contornoSeCruza, MAX_PONTOS, validarPoligono, type Ponto } from '../src/poligono.js';

const RET = (x1: number, y1: number, x2: number, y2: number): Ponto[] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
// Um "L": o quadrante de cima, à direita, fica de fora.
const EM_L: Ponto[] = [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5], [0.8, 0.5], [0.8, 0.8], [0.2, 0.8]];
// O mesmo retângulo com dois cantos trocados: vira um laço (gravata).
const LACO: Ponto[] = [[0.2, 0.2], [0.8, 0.8], [0.8, 0.2], [0.2, 0.8]];

// ───────────────── sem banco ─────────────────

describe('a conta do desenho (sem banco)', () => {
  it('a área sai em fração do quadro, em qualquer sentido do contorno', () => {
    assert.ok(Math.abs(areaDoPoligono(RET(0.25, 0.25, 0.75, 0.75)) - 0.25) < 1e-12);
    assert.ok(Math.abs(areaDoPoligono([...RET(0.25, 0.25, 0.75, 0.75)].reverse()) - 0.25) < 1e-12);
    assert.ok(Math.abs(areaDoPoligono([[0, 0], [1, 0], [0, 1]]) - 0.5) < 1e-12, 'meio quadro');
    // o L: um quadrado de 0,6 menos o quadrante de 0,3
    assert.ok(Math.abs(areaDoPoligono(EM_L) - (0.36 - 0.09)) < 1e-12);
  });

  it('retângulo, triângulo e L não se cruzam; o laço se cruza', () => {
    assert.equal(contornoSeCruza(RET(0.1, 0.1, 0.9, 0.9)), false);
    assert.equal(contornoSeCruza([[0, 0], [1, 0], [0, 1]]), false);
    assert.equal(contornoSeCruza(EM_L), false);
    assert.equal(contornoSeCruza(LACO), true);
  });

  it('o lado que fecha o contorno também é conferido', () => {
    // Um "Z": em cima, a diagonal, embaixo — e o lado que FECHA (do último
    // ponto de volta ao primeiro) é a outra diagonal. Só ele atravessa outro.
    const emZ: Ponto[] = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
    assert.equal(contornoSeCruza(emZ), true);
  });

  it('encostar na ponta não é cruzar', () => {
    // Dois lados que só se tocam num ponto do contorno (um "bico" para dentro).
    const comBico: Ponto[] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.5, 0.1001], [0.1, 0.9]];
    assert.equal(contornoSeCruza(comBico), false);
  });

  it('aceita o que é área', () => {
    assert.equal(validarPoligono(RET(0, 0, 1, 1)), null, 'o quadro inteiro');
    assert.equal(validarPoligono([[0.1, 0.1], [0.9, 0.2], [0.4, 0.8]]), null, 'triângulo');
    assert.equal(validarPoligono(EM_L), null);
    const comMuitos = Array.from({ length: MAX_PONTOS }, (_, i): Ponto => {
      const a = (2 * Math.PI * i) / MAX_PONTOS;
      return [0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a)];
    });
    assert.equal(validarPoligono(comMuitos), null, `${MAX_PONTOS} pontos, em roda`);
  });

  it('recusa o que não tem forma de lista de pontos', () => {
    assert.match(String(validarPoligono('0.1,0.1,0.9,0.9')), /lista de pontos/);
    assert.match(String(validarPoligono([[0, 0], [1, 1]])), /ao menos 3 pontos/);
    assert.match(String(validarPoligono([[0, 0], [1, 0], [1, 1, 1]])), /par \[x, y\]/);
    assert.match(String(validarPoligono([[0, 0], [1, 0], ['a', 1]])), /números/);
    assert.match(String(validarPoligono([[0, 0], [1920, 0], [1920, 1080], [0, 1080]])), /fração do quadro/);
    const demais = Array.from({ length: MAX_PONTOS + 1 }, (_, i): Ponto => [i / 100, (i * i) / 10000]);
    assert.match(String(validarPoligono(demais)), /pontos demais/);
  });

  it('recusa o desenho sem tamanho, dizendo por quê', () => {
    for (const ruim of [
      [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8]],          // três pontos em linha
      [[0.3, 0.3], [0.3, 0.3], [0.3, 0.3]],          // um em cima do outro
      RET(0.4, 0.4, 0.405, 0.405),                   // um quadradinho de meio por cento
    ]) {
      assert.match(String(validarPoligono(ruim)), /sem tamanho/, JSON.stringify(ruim));
    }
  });

  it('o menor desenho aceito é um quadradinho de 1% de lado', () => {
    assert.ok(Math.abs(AREA_MINIMA - 0.01 * 0.01) < 1e-15);
    assert.equal(validarPoligono(RET(0.4, 0.4, 0.411, 0.411)), null);
  });

  it('recusa o contorno que passa por cima dele mesmo', () => {
    assert.match(String(validarPoligono(LACO)), /passa por cima dele mesmo/);
  });
});

// ───────────────── com banco ─────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-poligono-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-poligono';
const SENHA = 'uma senha longa o bastante';

describe('o quadro desenhado por pontos (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let cookie = '';
  let token = '';
  let pontoId = '';
  let quadro = '';

  const salvar = (zonaId: string, corpo: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/v1/zonas/${zonaId}`, headers: { cookie }, payload: corpo });
  const criar = (corpo: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/v1/pontos/${pontoId}/zonas`, headers: { cookie }, payload: corpo });
  const noBanco = async (zonaId: string) => (await pool.query('select poligono from zona where id = $1', [zonaId])).rows[0].poligono;
  const noAgente = async (zonaId: string) => {
    const r = await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.statusCode, 200, r.body);
    for (const p of r.json().pontos) for (const z of p.zonas) if (z.id === zonaId) return z.poligono as number[][];
    return null;
  };

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Atendimento' }] },
    })).json();
    const email = `ger-${marca}@e.com`;
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: conta.tenantId, nome: 'X', email, senha: SENHA, nivel: 'gerente' },
    });
    const sessao = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = sessao.headers['set-cookie'];
    cookie = (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;

    const ponto = await app.inject({
      method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie },
      payload: { nome: 'Atendimento suporte', origem: 'dvr', canal: 15, host: '192.168.1.108' },
    });
    assert.equal(ponto.statusCode, 201, ponto.body);
    pontoId = ponto.json().id;
    // O desenho por pontos é de QUADRO: a imagem completa do canal não se redesenha.
    const novo = await criar({ nome: 'Balcão' });
    assert.equal(novo.statusCode, 201, novo.body);
    quadro = novo.json().id;

    const agente = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId: conta.loja.id, nome: 'PC da loja' },
    })).json();
    token = agente.token;
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${marca}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    // Um critério ligado no quadro, para ele ter o que conferir.
    const regra = await app.inject({
      method: 'POST', url: `/v1/zonas/${quadro}/regras`, headers: { cookie },
      payload: { nome: 'Balcão em ordem', tipo: 'estado', criterio: 'O balcão está em ordem.', quando: 'sempre' },
    });
    assert.equal(regra.statusCode, 201, regra.body);
    const ligar = await app.inject({ method: 'PATCH', url: `/v1/regras/${regra.json().id}`, headers: { cookie }, payload: { ativa: true } });
    assert.equal(ligar.statusCode, 200, ligar.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('o desenho de seis pontos é guardado como veio, e desce igual para o agente', async () => {
    const r = await salvar(quadro, { poligono: EM_L });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().poligono, EM_L);
    assert.deepEqual(await noBanco(quadro), EM_L);
    assert.deepEqual(await noAgente(quadro), EM_L, 'o agente recorta o mesmo desenho que a tela mostrou');
  });

  it('salvar o desenho sobe a versão da configuração: o agente busca o novo', async () => {
    const versao = async () => (await pool.query(
      'select l.config_versao from loja l join setor s on s.loja_id = l.id join ponto p on p.setor_id = s.id where p.id = $1', [pontoId],
    )).rows[0].config_versao as number;
    const antes = await versao();
    assert.equal((await salvar(quadro, { poligono: [[0.1, 0.1], [0.9, 0.2], [0.4, 0.8]] })).statusCode, 200);
    assert.ok((await versao()) > antes);
  });

  it('quadro novo pode nascer já com o desenho por pontos', async () => {
    const triangulo = [[0.1, 0.1], [0.5, 0.1], [0.1, 0.5]];
    const r = await criar({ nome: 'Lado do cliente', poligono: triangulo });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(r.json().poligono, triangulo);
  });

  it('desenho sem tamanho e contorno cruzado são recusados nas duas rotas, e nada muda', async () => {
    const antes = await noBanco(quadro);
    const semTamanho = [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8]];

    for (const [ruim, motivo] of [[semTamanho, /sem tamanho/], [LACO, /passa por cima dele mesmo/]] as const) {
      const s = await salvar(quadro, { poligono: ruim, nome: 'Nome que não pode entrar' });
      assert.equal(s.statusCode, 422, s.body);
      assert.equal(s.json().erro, 'poligono_invalido');
      assert.match(s.json().mensagem, motivo);

      const c = await criar({ nome: `Torta ${randomUUID().slice(0, 4)}`, poligono: ruim });
      assert.equal(c.statusCode, 422, c.body);
      assert.match(c.json().mensagem, motivo);
    }

    assert.deepEqual(await noBanco(quadro), antes);
    const { rows } = await pool.query('select nome from zona where ponto_id = $1 and excluida_em is null order by nome', [pontoId]);
    assert.ok(!rows.some((z) => z.nome.startsWith('Torta') || z.nome === 'Nome que não pode entrar'), JSON.stringify(rows));
  });
});
