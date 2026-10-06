// O motor de dimensionamento, sem banco.
//
// Os números de referência saíram de medição real em 05/10/2026: TWG
// TW-7327, sensor 1/2.7" (5,37 mm), lente 2,8 mm, objeto a 60 cm, canal
// entregando 1920×1080. Testar contra dado de campo vale mais que contra
// exemplo inventado — e trava a conta contra regressão silenciosa.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dimensionar, larguraEnquadrada, pxPorCm } from '../src/dimensionamento.js';

const SENSOR_27 = 5.37;
const FOCAL_28 = 2.8;

describe('óptica', () => {
  it('reproduz a medição de campo da TWG a 60 cm', () => {
    const largura = larguraEnquadrada(60, SENSOR_27, FOCAL_28);
    assert.ok(Math.abs(largura - 115.07) < 0.1, `deu ${largura}`);
    assert.ok(Math.abs(pxPorCm(1920, largura) - 16.69) < 0.05);
  });

  it('a MESMA câmera a 1,5 m não sustenta a montagem', () => {
    // A diferença não é a câmera, é a distância — e é por isso que o
    // projeto mede px/cm no objeto em vez de olhar megapixel.
    const largura = larguraEnquadrada(150, SENSOR_27, FOCAL_28);
    assert.ok(Math.abs(largura - 287.7) < 0.5);
    assert.ok(pxPorCm(1920, largura) < 12.8);
  });

  it('acha a distância limite para a montagem', () => {
    // 1920 ÷ 12,8 = 150 cm de largura máxima → 78 cm de distância.
    const limite = larguraEnquadrada(78, SENSOR_27, FOCAL_28);
    assert.ok(pxPorCm(1920, limite) >= 12.8, 'a 78 cm ainda sustenta');

    const alem = larguraEnquadrada(80, SENSOR_27, FOCAL_28);
    assert.ok(pxPorCm(1920, alem) < 12.8, 'a 80 cm já não sustenta');
  });

  it('recusa entrada sem sentido em vez de devolver número errado', () => {
    assert.throws(() => larguraEnquadrada(0, 5, 2.8), /positivos/);
    assert.throws(() => larguraEnquadrada(60, 5, 0), /positivos/);
  });
});

describe('dimensionar o envio', () => {
  const CAMERA = 16.69; // px/cm medidos na TWG a 60 cm

  it('zona estreita sustenta a montagem com envio pequeno', () => {
    // A zona da montagem cobre 40 cm. 12,8 px/cm × 40 = 512 px — cabe em
    // r640, não precisa de 1080. É essa diferença que torna uma rede de
    // lojas viável.
    const v = dimensionar(12.8, 40, CAMERA);

    assert.equal(v.sustenta, true);
    assert.equal(v.minima, 'r640');
    assert.equal(v.recomendada, 'r640');
    assert.equal(v.pxNecessarios, 512);
  });

  it('a mesma exigência numa zona larga exige envio maior', () => {
    // 12,8 × 100 cm = 1280 px → já não cabe em r1mp (1000).
    const v = dimensionar(12.8, 100, CAMERA);
    assert.equal(v.minima, 'r1080');
  });

  it('o recomendado é o MÍNIMO que atende, não o maior possível', () => {
    // Subir de degrau sem ganho de acurácia é multiplicar a conta no fim
    // do mês. O máximo existe para informar, não para usar.
    const v = dimensionar(3.0, 50, CAMERA);
    assert.equal(v.recomendada, v.minima);
    assert.notEqual(v.maxima, v.recomendada, 'há folga, e ela fica visível');
  });

  it('estado comum cabe no degrau mais barato', () => {
    // 3 px/cm × 100 cm = 300 px → r384.
    const v = dimensionar(3.0, 100, CAMERA);
    assert.equal(v.minima, 'r384');
  });

  it('quando a física não permite, diz quanto falta', () => {
    // Montagem numa zona de 200 cm: precisaria de 2560 px e a câmera só
    // entrega 3338... na verdade entrega. Use uma zona onde não entregue:
    const v = dimensionar(30, 200, CAMERA);

    assert.equal(v.sustenta, false);
    assert.match(String(v.motivo), /Aproxime a câmera|aumente a focal/);
    assert.match(String(v.motivo), /×/, 'tem que dizer o fator, não só que falhou');
  });

  it('não recomenda enviar mais do que a câmera tem', () => {
    // Câmera fraca: 2 px/cm. Numa zona de 100 cm ela entrega 200 px.
    const v = dimensionar(1.5, 100, 2);

    assert.equal(v.sustenta, true);
    assert.equal(v.pxDisponiveis, 200);
    // r384 é o menor degrau; mandar mais que 200 px seria ampliar, e
    // ampliar não cria detalhe — só custo.
    assert.equal(v.maxima, 'r384');
  });

  it('zona larga demais estoura o maior degrau', () => {
    const v = dimensionar(12.8, 300, 50);
    assert.equal(v.sustenta, false);
    assert.match(String(v.motivo), /Estreite a zona/);
  });

  it('informa px/cm que o MODELO vai ver, não o da câmera', () => {
    // É esse o número que decide o veredito — a câmera pode ter muito
    // mais, e nada disso chega se o envio for pequeno.
    const v = dimensionar(12.8, 40, CAMERA);
    assert.equal(v.pxPorCmNoModelo, 16); // 640 ÷ 40
  });
});
