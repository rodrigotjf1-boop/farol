// O que o Farol viu — a conta, sem banco.
//
// A tela existe para separar loja em ordem de sistema parado. Estes testes
// prendem os limiares que fazem essa separação, com números escolhidos à
// mão — e, para cada sinal, o caso vizinho que NÃO pode dispará-lo. Sinal
// que dispara à toa ensina a pessoa a parar de ler a tela.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canaisSemImagem,
  marcaDaLinha,
  montarLinhas,
  montarSinais,
  somarTotais,
  type CanalDaLoja,
  type CriterioDaLoja,
  type HoraDoCanal,
  type Linha,
} from '../src/resultados.js';

const AGORA = new Date('2026-10-07T15:20:00-03:00');
const hora = (h: number) => new Date(`2026-10-07T${String(h).padStart(2, '0')}:00:00-03:00`).toISOString();

const VIVO = [{ estado: 'ativo', segundos_sem_bater: 12 }];

function linha(mais: Partial<Linha> = {}): Linha {
  return {
    regraId: 'r1', regraNome: 'Bancada limpa', tipo: 'estado', regraLigada: true, regraExcluida: false,
    pontoId: 'p1', pontoNome: 'Montagem 1', canal: 4, setor: 'Cozinha', pontoAtivo: true, pontoExcluido: false,
    capturas: 100, semJuiz: 0, semQuadro: 0, semCena: 0, emSilencio: 0, repetidas: 60, jaJulgadas: 0,
    enfileiradas: 40, conformes: 36, naoConformes: 3, naoAvaliaveis: 1, falhas: 0, alertas: 2,
    somaConfianca: 34, comConfianca: 40, somaLatenciaMs: 80_000, comLatencia: 40,
    ultimaEm: hora(15), ultimoImpedimento: null,
    ...mais,
  };
}

const canal = (id = 'p1', nome = 'Montagem 1', n = 4, ligados = 1): CanalDaLoja => ({
  id, nome, canal: n, criteriosLigados: ligados,
});

const criterio = (mais: Partial<CriterioDaLoja> = {}): CriterioDaLoja => ({
  id: 'r1', nome: 'Bancada limpa', tipo: 'estado', ligado: true, canais: 1, temObjeto: false, valeSempre: true,
  ...mais,
});

const sinaisDe = (mais: Partial<Parameters<typeof montarSinais>[0]> = {}) =>
  montarSinais({
    agentes: VIVO, linhas: [linha()], horas: [], criterios: [criterio()], canais: [canal()], agora: AGORA,
    ...mais,
  });

const tipos = (s: ReturnType<typeof montarSinais>) => s.map((x) => x.tipo);

describe('loja em ordem não acende sinal nenhum', () => {
  it('agente de pé, câmera com imagem e critério julgando', () => {
    assert.deepEqual(sinaisDe(), []);
  });

  it('não conforme é RESULTADO, não sinal de defeito', () => {
    // Metade fora do critério é problema da cozinha. O Farol está
    // funcionando — e é exatamente por isso que ele viu.
    const l = linha({ conformes: 20, naoConformes: 20, naoAvaliaveis: 0 });
    assert.deepEqual(sinaisDe({ linhas: [l] }), []);
  });
});

describe('ninguém olhando', () => {
  it('loja sem agente nenhum', () => {
    assert.deepEqual(tipos(sinaisDe({ agentes: [] })), ['sem_agente']);
  });

  it('agente que parou de bater', () => {
    const s = sinaisDe({ agentes: [{ estado: 'ativo', segundos_sem_bater: 7200 }] });
    assert.equal(s[0]!.tipo, 'agente_fora');
    assert.equal(s[0]!.gravidade, 'critico');
    assert.equal(s[0]!.segundosSemBater, 7200);
  });

  it('um soluço de rede não é agente fora', () => {
    assert.deepEqual(sinaisDe({ agentes: [{ estado: 'ativo', segundos_sem_bater: 240 }] }), []);
  });

  it('com dois agentes, basta um de pé', () => {
    const agentes = [
      { estado: 'ativo', segundos_sem_bater: 9000 },
      { estado: 'ativo', segundos_sem_bater: 20 },
    ];
    assert.deepEqual(sinaisDe({ agentes }), []);
  });

  it('agente ainda não instalado não conta como de pé', () => {
    assert.deepEqual(tipos(sinaisDe({ agentes: [{ estado: 'novo', segundos_sem_bater: null }] })), ['agente_fora']);
  });
});

describe('câmera sem imagem', () => {
  const parada: HoraDoCanal[] = [
    { pontoId: 'p1', hora: hora(15), capturas: 40, semImagem: 40 },
    { pontoId: 'p1', hora: hora(14), capturas: 120, semImagem: 110 },
    { pontoId: 'p1', hora: hora(13), capturas: 120, semImagem: 2 },
  ];

  it('acusa o canal e diz desde quando', () => {
    const s = sinaisDe({ horas: parada });
    assert.deepEqual(tipos(s), ['canal_sem_imagem']);
    assert.equal(s[0]!.pontoNome, 'Montagem 1');
    assert.equal(s[0]!.desde, hora(14), 'começou na hora das 14, não na das 15');
    assert.equal(s[0]!.quantos, 1);
  });

  it('a hora que acabou de começar não decide sozinha', () => {
    // 15h01: duas olhadas sem imagem. Com a hora anterior boa, é soluço.
    const horas: HoraDoCanal[] = [
      { pontoId: 'p1', hora: hora(15), capturas: 2, semImagem: 2 },
      { pontoId: 'p1', hora: hora(14), capturas: 120, semImagem: 0 },
    ];
    assert.deepEqual(sinaisDe({ horas }), []);
  });

  it('câmera que falhou de manhã e voltou não fica acusada à tarde', () => {
    const horas: HoraDoCanal[] = [
      { pontoId: 'p1', hora: hora(15), capturas: 40, semImagem: 0 },
      { pontoId: 'p1', hora: hora(14), capturas: 120, semImagem: 1 },
      { pontoId: 'p1', hora: hora(9), capturas: 120, semImagem: 120 },
    ];
    assert.deepEqual(sinaisDe({ horas }), []);
  });

  it('resumo velho não acusa: sem dado recente, não se sabe', () => {
    const horas: HoraDoCanal[] = [{ pontoId: 'p1', hora: hora(9), capturas: 120, semImagem: 120 }];
    assert.equal(canaisSemImagem(horas, AGORA).size, 0);
  });

  it('com DOIS canais, só o parado é acusado', () => {
    const horas: HoraDoCanal[] = [
      ...parada,
      { pontoId: 'p2', hora: hora(15), capturas: 40, semImagem: 0 },
      { pontoId: 'p2', hora: hora(14), capturas: 120, semImagem: 3 },
    ];
    const s = sinaisDe({ horas, canais: [canal(), canal('p2', 'Chapa', 3)] });
    assert.deepEqual(s.map((x) => x.pontoId), ['p1']);
  });

  it('com o agente FORA, a câmera não leva a culpa', () => {
    // Sem agente, toda câmera "parou". Dizer as duas coisas manda a pessoa
    // olhar a câmera quando o problema é o computador.
    const s = sinaisDe({ horas: parada, agentes: [{ estado: 'ativo', segundos_sem_bater: 7200 }] });
    assert.deepEqual(tipos(s), ['agente_fora']);
  });
});

describe('critério que ninguém consegue julgar', () => {
  it('sem juiz: um sinal por CRITÉRIO, não por canal', () => {
    const semJuiz = (pontoId: string, pontoNome: string) =>
      linha({
        pontoId, pontoNome, capturas: 50, semJuiz: 50, repetidas: 0, enfileiradas: 0,
        conformes: 0, naoConformes: 0, naoAvaliaveis: 0,
        ultimoImpedimento: 'detector local não instalado',
      });
    const s = sinaisDe({ linhas: [semJuiz('p1', 'Montagem 1'), semJuiz('p2', 'Chapa'), semJuiz('p3', 'Balcão')] });

    assert.deepEqual(tipos(s), ['sem_juiz']);
    assert.equal(s[0]!.quantos, 3);
    assert.equal(s[0]!.impedimento, 'detector local não instalado');
  });

  it('juiz que não responde', () => {
    const l = linha({ enfileiradas: 30, conformes: 2, naoConformes: 0, naoAvaliaveis: 0, falhas: 28, ultimoImpedimento: 'o modelo não respondeu' });
    const s = sinaisDe({ linhas: [l] });
    assert.deepEqual(tipos(s), ['julgamento_falhando']);
    assert.equal(s[0]!.quantos, 28);
  });

  it('uma falha no meio de quarenta julgamentos não é defeito', () => {
    assert.deepEqual(sinaisDe({ linhas: [linha({ falhas: 1 })] }), []);
  });
});

describe('câmera que não mostra o bastante', () => {
  it('acusa por CANAL e diz a proporção', () => {
    const ruim = linha({ regraNome: 'Uso de touca', conformes: 44, naoConformes: 1, naoAvaliaveis: 51 });
    const boa = linha({ regraNome: 'Uso de touca', pontoId: 'p2', pontoNome: 'Chapa', conformes: 86, naoConformes: 0, naoAvaliaveis: 4 });
    const s = sinaisDe({ linhas: [ruim, boa] });

    assert.deepEqual(tipos(s), ['avalia_pouco']);
    assert.equal(s[0]!.pontoNome, 'Montagem 1');
    assert.equal(s[0]!.percentual, 53);
  });

  it('três "não deu para avaliar" em quatro julgamentos é pouco para afirmar', () => {
    const l = linha({ conformes: 1, naoConformes: 0, naoAvaliaveis: 3 });
    assert.deepEqual(sinaisDe({ linhas: [l] }), []);
  });
});

describe('critério sem rastro', () => {
  it('presença sem dizer o que procurar, mesmo desligado', () => {
    const c = criterio({ id: 'r9', nome: 'Produto', tipo: 'contagem', ligado: false, temObjeto: false });
    const s = sinaisDe({ criterios: [criterio(), c] });
    assert.deepEqual(tipos(s), ['falta_dizer_o_que_procurar']);
    assert.equal(s[0]!.regraNome, 'Produto');
  });

  it('ligado, com canal, e nunca olhado', () => {
    const c = criterio({ id: 'r9', nome: 'Porta fechada' });
    assert.deepEqual(tipos(sinaisDe({ criterios: [criterio(), c] })), ['nunca_olhado']);
  });

  it('critério com horário próprio não é cobrado fora dele', () => {
    const c = criterio({ id: 'r9', nome: 'Limpeza de sábado', valeSempre: false });
    assert.deepEqual(sinaisDe({ criterios: [criterio(), c] }), []);
  });

  it('desligado e sem canal não devem nada', () => {
    const desligado = criterio({ id: 'r8', ligado: false });
    const semCanal = criterio({ id: 'r9', canais: 0 });
    assert.deepEqual(sinaisDe({ criterios: [criterio(), desligado, semCanal] }), []);
  });

  it('com o agente fora, "nunca olhado" é consequência', () => {
    const c = criterio({ id: 'r9', nome: 'Porta fechada' });
    const s = sinaisDe({ criterios: [criterio(), c], agentes: [{ estado: 'ativo', segundos_sem_bater: 7200 }] });
    assert.deepEqual(tipos(s), ['agente_fora']);
  });
});

describe('ordem e histórico', () => {
  it('o crítico vem antes da atenção', () => {
    const horas: HoraDoCanal[] = [{ pontoId: 'p1', hora: hora(15), capturas: 40, semImagem: 40 }];
    const c = criterio({ id: 'r9', nome: 'Produto', tipo: 'contagem', ligado: false });
    const s = sinaisDe({ horas, criterios: [criterio(), c] });
    assert.deepEqual(s.map((x) => x.gravidade), ['critico', 'atencao']);
  });

  it('critério excluído não acende sinal, mas continua nos números', () => {
    const excluido = linha({ regraId: 'rx', regraExcluida: true, capturas: 50, semJuiz: 50, conformes: 0, naoConformes: 0, naoAvaliaveis: 0 });
    assert.deepEqual(sinaisDe({ linhas: [linha(), excluido] }), []);
    assert.equal(somarTotais([linha(), excluido]).capturas, 150);
    assert.equal(marcaDaLinha(excluido, false), null);
  });
});

describe('as linhas da tela', () => {
  it('calcula análises, médias e a marca', () => {
    const [l] = montarLinhas([linha()], new Set());
    assert.equal(l!.analises, 40);
    assert.equal(l!.confiancaMedia, 0.85);
    assert.equal(l!.latenciaMediaMs, 2000);
    assert.equal(l!.marca, null);
    assert.equal(l!.historico, false);
  });

  it('sem julgamento nenhum, a média é nula e não zero', () => {
    // Zero seria lido como "o modelo não confia em nada".
    const [l] = montarLinhas([linha({ comConfianca: 0, somaConfianca: 0, comLatencia: 0, somaLatenciaMs: 0 })], new Set());
    assert.equal(l!.confiancaMedia, null);
    assert.equal(l!.latenciaMediaMs, null);
  });

  it('do que mais ficou fora do critério para o que menos ficou', () => {
    const linhas = [
      linha({ regraNome: 'A', naoConformes: 1 }),
      linha({ regraNome: 'B', naoConformes: 9 }),
      linha({ regraNome: 'C', naoConformes: 4 }),
    ];
    assert.deepEqual(montarLinhas(linhas, new Set()).map((l) => l.regraNome), ['B', 'C', 'A']);
  });

  it('a linha do canal parado leva a marca de sem imagem', () => {
    const [l] = montarLinhas([linha({ semCena: 90 })], new Set(['p1']));
    assert.equal(l!.marca, 'sem_imagem');
    assert.equal(l!.semImagem, 90);
  });

  it('os totais fecham com a soma das linhas', () => {
    const t = somarTotais([linha(), linha({ conformes: 10, naoConformes: 0, naoAvaliaveis: 5, alertas: 0, capturas: 30 })]);
    assert.deepEqual(t, {
      capturas: 130, analises: 55, conformes: 46, naoConformes: 3, naoAvaliaveis: 6, falhas: 0, alertas: 2,
    });
  });
});
