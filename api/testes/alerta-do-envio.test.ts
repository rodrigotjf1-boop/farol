// =====================================================================
// O alerta que o transporte leva, caso a caso (sem banco)
// =====================================================================
// Pedido da sessão do Regem (11/11/2026): o envio reivindicado leva o que
// a tela da cozinha mostra. `contratos/transporte-dos-alertas.json` é o
// combinado com o Regem: a montagem tem de dar EXATAMENTE o envio de cada
// caso. A rota, com Postgres, está em `rotas-alertas.test.ts`.
// =====================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  alertaDoEnvio,
  ENDERECO_DO_KDS,
  envioReivindicado,
  ORDEM_DA_FILA_SQL,
  ORDEM_DA_PRIORIDADE,
  ORDEM_DA_SEVERIDADE,
  PRAZO_DO_RESULTADO_S,
  PRIORIDADE_DO_ENVIO_SQL,
  SEVERIDADE_DO_ENVIO_SQL,
  type LinhaDoEnvio,
} from '../src/alerta-do-envio.js';
import { GRAVIDADE } from '../src/aviso-da-maquina.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/transporte-dos-alertas.json', import.meta.url), 'utf8')) as {
  regras: { prazoDoResultadoS: number; severidades: string[]; prioridades: string[] };
  respostaNaOrdem: string[];
  casos: { _: string; linha: LinhaDoEnvio; envio: Record<string, unknown> }[];
};

const base = (mais: Partial<LinhaDoEnvio>): LinhaDoEnvio => ({
  ...CONTRATO.casos.find((c) => c.linha.motivo === 'evento')!.linha,
  ...mais,
});

describe('o contrato com o Regem', () => {
  for (const caso of CONTRATO.casos) {
    it(`monta exatamente o envio: ${caso.linha.motivo}`, () => {
      assert.deepEqual(envioReivindicado(caso.linha), caso.envio);
    });
  }

  it('as regras escritas no contrato são as do código', () => {
    assert.equal(CONTRATO.regras.prazoDoResultadoS, PRAZO_DO_RESULTADO_S);
    assert.deepEqual(CONTRATO.regras.severidades, [...ORDEM_DA_SEVERIDADE].reverse());
    assert.deepEqual(CONTRATO.regras.prioridades, [...ORDEM_DA_PRIORIDADE].reverse());
    assert.equal(ENDERECO_DO_KDS, 'regem');
  });

  it('a ordem da resposta no contrato é a do agente caído, depois a severidade e a chegada', () => {
    const peso = (l: LinhaDoEnvio) => [
      l.motivo === 'agente_caiu' ? 1 : 0,
      ORDEM_DA_SEVERIDADE.indexOf(l.severidade),
      ORDEM_DA_PRIORIDADE.indexOf(l.prioridade),
      -new Date(l.criado_em).getTime(),
    ];
    const ordenados = [...CONTRATO.casos.map((c) => c.linha)].sort((a, b) => {
      const [pa, pb] = [peso(a), peso(b)];
      for (let i = 0; i < pa.length; i += 1) if (pa[i] !== pb[i]) return pb[i]! - pa[i]!;
      return 0;
    });
    assert.deepEqual(ordenados.map((l) => l.id), CONTRATO.respostaNaOrdem);
  });
});

describe('o alerta de cada motivo', () => {
  it('a hora que vem do banco como Date sai igual à que vem como texto', () => {
    const comTexto = alertaDoEnvio(base({}));
    const comDate = alertaDoEnvio(base({ ocorrido_em: new Date('2026-11-11T23:14:02.000Z'), criado_em: new Date('2026-11-11T23:14:05.120Z') }));
    assert.deepEqual(comDate, comTexto);
  });

  it('o critério apagado e o evento sem motivo ainda dizem algo', () => {
    const a = alertaDoEnvio(base({ regra_nome: null, evento_motivo: '   ' }));
    assert.equal(a.titulo, 'Um critério ficou fora do combinado');
    assert.equal(a.detalhe, 'O critério ficou fora do combinado.');
  });

  it('o motivo que já termina em pontuação não ganha outro ponto, e espaços somem', () => {
    const a = alertaDoEnvio(base({ evento_motivo: 'sem   touca\nna chapa!' }));
    assert.equal(a.detalhe, 'Sem touca na chapa!');
  });

  it('onde: a imagem completa diz só o canal; sem área, nada', () => {
    assert.equal(alertaDoEnvio(base({ zona_principal: true })).onde, 'Chapa');
    assert.equal(alertaDoEnvio(base({ zona_principal: null })).onde, 'Chapa');
    assert.equal(alertaDoEnvio(base({ ponto_nome: null, zona_nome: null, zona_principal: null })).onde, null);
    assert.equal(alertaDoEnvio(base({ zona_principal: false })).onde, 'Chapa › Bancada');
    const sem = alertaDoEnvio(base({ ponto_nome: null, zona_nome: null, zona_principal: null }));
    assert.equal(sem.texto, 'Farol · Matriz: Touca na cozinha. Quem está na chapa está sem touca.', 'sem "()" vazio no texto');
  });

  it('a loja sem ligação com o Regem sai com o id do Regem vazio, e a loja sem nome não quebra o texto', () => {
    const a = alertaDoEnvio(base({ regem_loja_id: null, loja_nome: null }));
    assert.deepEqual(a.loja, { id: '0f0e6c1a-2b3c-4d5e-8f90-1a2b3c4d5e6f', nome: null, regem_loja_id: null });
    assert.match(a.texto, /^Farol · loja: /);
  });

  it('o agente caído sem nome e sem a hora: quando é a chegada do envio', () => {
    const a = alertaDoEnvio(base({ motivo: 'agente_caiu', payload: {}, regra_nome: null, evento_motivo: null, ocorrido_em: null }));
    assert.equal(a.titulo, 'O Farol parou de auditar esta loja');
    assert.equal(a.detalhe, 'O agente parou de mandar sinal: esta loja não está sendo auditada.');
    assert.equal(a.ocorrido_em, '2026-11-11T23:14:05.120Z');
  });

  it('o aviso da máquina de tipo novo ou sem o porquê ainda sai com título e detalhe', () => {
    const a = alertaDoEnvio(base({ motivo: 'computador', payload: { tipo: 'ventoinha' }, regra_nome: null }));
    assert.equal(a.titulo, 'O computador do Farol pede atenção');
    assert.equal(a.detalhe, 'Veja no console: Computador da loja › Saúde.');
    assert.match(a.texto, /^Farol · Matriz: O computador do Farol pede atenção/, 'sem o texto pronto, monta o dele');
    const disco = alertaDoEnvio(base({ motivo: 'computador', payload: { tipo: 'disco', porque: ['o disco tem 6 GB livres'] } }));
    assert.equal(disco.titulo, 'O disco do computador do Farol está quase cheio');
    assert.equal(disco.detalhe, 'O disco tem 6 GB livres.');
  });

  it('o motivo que o Farol não conhece mais (busca concluída) sai dizendo qual é', () => {
    const a = alertaDoEnvio(base({ motivo: 'busca_concluida', payload: null }));
    assert.equal(a.titulo, 'Aviso do Farol');
    assert.equal(a.detalhe, 'Aviso do tipo "busca_concluida".');
    assert.equal(a.ocorrido_em, '2026-11-11T23:14:05.120Z');
  });
});

describe('a gravidade e a ordem em SQL', () => {
  it('o aviso da máquina usa a MESMA gravidade do aviso (GRAVIDADE)', () => {
    for (const [tipo, g] of Object.entries(GRAVIDADE)) {
      assert.ok(SEVERIDADE_DO_ENVIO_SQL.includes(`when '${tipo}' then '${g.severidade}'`), `severidade de ${tipo}`);
      assert.ok(PRIORIDADE_DO_ENVIO_SQL.includes(`when '${tipo}' then '${g.prioridade}'`), `prioridade de ${tipo}`);
    }
  });

  it('o agente caído vem antes, e a gravidade antes da data', () => {
    const iCaido = ORDEM_DA_FILA_SQL.indexOf("(e.motivo = 'agente_caiu') desc");
    const iSev = ORDEM_DA_FILA_SQL.indexOf("array['info', 'atencao', 'critico', 'emergencia']");
    const iPri = ORDEM_DA_FILA_SQL.indexOf("array['leve', 'intermediaria', 'urgente']");
    const iData = ORDEM_DA_FILA_SQL.indexOf('e.criado_em');
    assert.ok(iCaido === 0 && iCaido < iSev && iSev < iPri && iPri < iData, ORDEM_DA_FILA_SQL);
  });
});
