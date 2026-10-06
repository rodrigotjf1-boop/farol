// =====================================================================
// A política de alertas, frase por frase
// =====================================================================
// O dono descreveu a política assim: "urgentes sempre; intermediário só
// gerência/presidente; leve: não enviar / enviar / destino próprio".
//
// Cada uma dessas frases é um teste aqui. Se um deles cair, a política
// mudou sem ninguém decidir mudar.
// =====================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolverDestinos,
  chaveDeEnvio,
  faixaDeRepeticao,
  type LinhaPolitica,
  type DestinoAtivo,
} from '../src/alertas.js';

const GERENTE: DestinoAtivo = {
  id: 'd-gerente', tipo: 'whatsapp', loja_id: 'L1', papel: 'gerente',
};
const DONO: DestinoAtivo = {
  id: 'd-dono', tipo: 'whatsapp', loja_id: null, papel: 'presidente',
};
const KDS: DestinoAtivo = {
  id: 'd-kds', tipo: 'kds', loja_id: 'L1', papel: null,
};

function pol(p: Partial<LinhaPolitica>): LinhaPolitica {
  return {
    id: Math.random().toString(36).slice(2),
    loja_id: null,
    severidade: null,
    prioridade: null,
    enviar: true,
    destino_id: null,
    ...p,
  };
}

describe('política de alertas', () => {
  it('urgente vai para quem a política disser', () => {
    const d = resolverDestinos(
      [pol({ prioridade: 'urgente', destino_id: 'd-gerente' }),
       pol({ prioridade: 'urgente', destino_id: 'd-kds' })],
      [GERENTE, KDS],
      'critico', 'urgente',
    );
    assert.deepEqual(d.destinos.sort(), ['d-gerente', 'd-kds']);
  });

  it('intermediário só alcança a gerência quando a política é essa', () => {
    const politicas = [
      pol({ prioridade: 'urgente', destino_id: 'd-kds' }),
      pol({ prioridade: 'intermediaria', destino_id: 'd-gerente' }),
    ];
    const d = resolverDestinos(politicas, [GERENTE, KDS], 'atencao', 'intermediaria');
    assert.deepEqual(d.destinos, ['d-gerente'], 'o KDS não recebe intermediário');
  });

  it('leve pode ser SILENCIADO por uma linha de veto', () => {
    // "não enviar" tem que ser dizível em uma linha, sem apagar as outras.
    const d = resolverDestinos(
      [pol({ destino_id: 'd-gerente' }),          // curinga: tudo pro gerente
       pol({ prioridade: 'leve', enviar: false })], // menos leve
      [GERENTE],
      'info', 'leve',
    );
    assert.deepEqual(d.destinos, []);
    assert.match(d.motivo, /silenciado/);
  });

  it('o veto ganha do envio mesmo com várias linhas mandando enviar', () => {
    const d = resolverDestinos(
      [pol({ severidade: 'info', destino_id: 'd-gerente' }),
       pol({ prioridade: 'leve', destino_id: 'd-kds' }),
       pol({ severidade: 'info', prioridade: 'leve', enviar: false })],
      [GERENTE, KDS],
      'info', 'leve',
    );
    assert.deepEqual(d.destinos, [], 'uma linha de veto cala as duas de envio');
  });

  it('leve pode ter DESTINO PRÓPRIO, diferente do resto', () => {
    const d = resolverDestinos(
      [pol({ prioridade: 'urgente', destino_id: 'd-gerente' }),
       pol({ prioridade: 'leve', destino_id: 'd-kds' })],
      [GERENTE, KDS],
      'info', 'leve',
    );
    assert.deepEqual(d.destinos, ['d-kds']);
  });

  it('o mesmo destino em duas linhas recebe UMA vez', () => {
    // Mandar duas vezes ensina quem recebe a ignorar as duas.
    const d = resolverDestinos(
      [pol({ severidade: 'critico', destino_id: 'd-gerente' }),
       pol({ destino_id: 'd-gerente' })],
      [GERENTE],
      'critico', 'urgente',
    );
    assert.deepEqual(d.destinos, ['d-gerente']);
  });

  // ─────────────── escopo: a loja ganha da rede, inteiro ───────────────

  it('política da LOJA substitui a da rede, não soma', () => {
    // Somar tornaria impossível uma loja receber MENOS que o padrão da
    // rede: todo veto local seria desfeito por uma linha de rede.
    const d = resolverDestinos(
      [pol({ loja_id: null, destino_id: 'd-dono' }),          // rede: tudo pro dono
       pol({ loja_id: 'L1', destino_id: 'd-gerente' })],      // loja: tudo pro gerente
      [DONO, GERENTE],
      'atencao', 'intermediaria',
    );
    assert.deepEqual(d.destinos, ['d-gerente'], 'a linha de rede não entra');
  });

  it('a loja pode VETAR o que a rede manda enviar', () => {
    const d = resolverDestinos(
      [pol({ loja_id: null, destino_id: 'd-dono' }),
       pol({ loja_id: 'L1', prioridade: 'leve', enviar: false })],
      [DONO],
      'info', 'leve',
    );
    assert.deepEqual(d.destinos, [], 'sem isso, "não me avise" seria impossível');
  });

  it('loja SEM política nenhuma herda a da rede', () => {
    const d = resolverDestinos(
      [pol({ loja_id: null, destino_id: 'd-dono' })],
      [DONO],
      'atencao', 'intermediaria',
    );
    assert.deepEqual(d.destinos, ['d-dono']);
  });

  // ──────────── o que não pode ficar sem aviso ────────────

  it('EMERGÊNCIA sem política alcança todos os destinos ativos', () => {
    // A assimetria é deliberada: um alerta a mais incomoda por um
    // instante; uma emergência não vista tira a razão de ser do produto.
    const d = resolverDestinos([], [GERENTE, DONO, KDS], 'emergencia', 'leve');
    assert.deepEqual(d.destinos.sort(), ['d-dono', 'd-gerente', 'd-kds']);
    assert.match(d.motivo, /alcança todos/);
  });

  it('URGENTE sem política também alcança', () => {
    const d = resolverDestinos([], [GERENTE], 'info', 'urgente');
    assert.deepEqual(d.destinos, ['d-gerente']);
  });

  it('mas uma loja pode vetar até a emergência — explicitamente', () => {
    const d = resolverDestinos(
      [pol({ loja_id: 'L1', severidade: 'emergencia', enviar: false })],
      [GERENTE],
      'emergencia', 'urgente',
    );
    assert.deepEqual(d.destinos, [], 'o veto explícito é respeitado');
  });

  it('info/leve sem política NÃO sai', () => {
    const d = resolverDestinos([], [GERENTE], 'info', 'leve');
    assert.deepEqual(d.destinos, []);
    assert.match(d.motivo, /sem política/);
  });

  it('emergência sem destino cadastrado aparece como FALTA, não como silêncio', () => {
    // A diferença importa: "ninguém quis receber" e "ninguém cadastrou"
    // pedem ações opostas de quem lê o log.
    const d = resolverDestinos([], [], 'emergencia', 'urgente');
    assert.deepEqual(d.destinos, []);
    assert.match(d.motivo, /não tem destino cadastrado/);
  });

  // ──────────────────── idempotência do aviso ────────────────────

  it('a chave do envio distingue destino', () => {
    const a = chaveDeEnvio('evento', 'ev-1', 'd-gerente');
    const b = chaveDeEnvio('evento', 'ev-1', 'd-kds');
    assert.notEqual(a, b, 'dois destinos são dois envios');
  });

  it('o mesmo evento para o mesmo destino dá a MESMA chave', () => {
    assert.equal(
      chaveDeEnvio('evento', 'ev-1', 'd-gerente'),
      chaveDeEnvio('evento', 'ev-1', 'd-gerente'),
      'retentativa depois de queda de rede não pode avisar duas vezes',
    );
  });

  it('o aviso de agente caído REPETE a cada faixa, não a cada minuto', () => {
    const caiu = new Date('2026-10-06T05:00:00Z');
    const k = (agora: string) =>
      chaveDeEnvio('agente_caiu', 'ag-1', 'd-gerente',
                   faixaDeRepeticao(caiu, new Date(agora)));

    assert.equal(
      k('2026-10-06T05:00:00Z'), k('2026-10-06T06:00:00Z'),
      'uma hora depois ainda é o mesmo aviso',
    );
    assert.notEqual(
      k('2026-10-06T05:00:00Z'), k('2026-10-06T12:00:00Z'),
      'sete horas fora do ar avisa de novo: silêncio longo parece normalidade',
    );
  });

  it('a faixa conta desde a QUEDA, não desde a borda do relógio', () => {
    // O defeito que a primeira versão tinha: faixas fixas desde a época
    // faziam um agente que cai às 05:59 receber o segundo aviso um minuto
    // depois. O intervalo real virava sorteio entre 1 min e 6 h.
    const caiuTarde = new Date('2026-10-06T05:59:00Z');
    const k = (agora: string) =>
      faixaDeRepeticao(caiuTarde, new Date(agora));

    assert.equal(k('2026-10-06T05:59:00Z'), k('2026-10-06T06:01:00Z'),
                 'dois minutos de queda não são um segundo aviso');
    assert.equal(k('2026-10-06T05:59:00Z'), k('2026-10-06T11:58:00Z'),
                 'cinco horas e cinquenta e nove minutos ainda é a faixa 0');
    assert.equal(k('2026-10-06T11:59:00Z'), 'f1',
                 'a segunda faixa começa exatamente 6 h dentro da queda');
  });

  it('relógio para trás não produz faixa negativa', () => {
    // Acerto de NTP no servidor já fez isso em outro projeto.
    assert.equal(
      faixaDeRepeticao(new Date('2026-10-06T05:00:00Z'),
                       new Date('2026-10-06T04:00:00Z')),
      'f0',
    );
  });
});
