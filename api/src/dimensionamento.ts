// =====================================================================
// Motor de dimensionamento
// =====================================================================
// Responde a pergunta que decide tudo: **esta câmera, nesta posição,
// sustenta esta regra? E com que configuração?**
//
// ## A distinção que decide o custo do produto
//
// **Recortar NÃO muda px/cm.** Um recorte de metade do quadro tem metade
// dos pixels e cobre metade dos centímetros — a razão é a mesma.
//
// Quem muda px/cm é o **redimensionamento antes de enviar**. E é aí que
// está o dinheiro: o modelo não vê a zona em 1920 px, vê no tamanho que
// se mandou. Então:
//
//     px/cm no modelo = resolução_de_envio ÷ largura_da_zona_em_cm
//
// Uma zona estreita sustenta a mesma precisão com envio menor. Recortar
// bem é o que permite mandar 640 px onde seria preciso 1920 — e a conta
// de uma rede de lojas vive dessa diferença.
//
// ## Mínimo e máximo
//
// **Mínimo** é o que a regra exige: abaixo dele o veredito não vale.
// **Máximo** é o que a câmera tem para dar: acima dele não há detalhe
// nenhum a mais, só token pago por pixel inventado.
//
// Quando o mínimo passa do máximo, não é questão de configurar melhor —
// é a física. A saída é aproximar a câmera ou usar focal maior.
// =====================================================================

/** Lados maiores, em pixels, de cada degrau de envio. */
export const DEGRAUS = [
  { nome: 'r384', px: 384 },
  { nome: 'r640', px: 640 },
  { nome: 'r1mp', px: 1000 },
  { nome: 'r1080', px: 1920 },
] as const;

export type Degrau = (typeof DEGRAUS)[number]['nome'];

/**
 * Largura que a câmera enquadra, em cm.
 *
 *     largura = distância × largura_do_sensor ÷ focal
 *
 * É geometria simples, e é o cálculo que separa "câmera boa" de "câmera
 * no lugar certo": uma de 2 MP a meio metro vence uma de 8 MP na parede.
 */
export function larguraEnquadrada(
  distanciaCm: number,
  sensorMm: number,
  focalMm: number,
): number {
  if (distanciaCm <= 0 || sensorMm <= 0 || focalMm <= 0) {
    throw new Error('distância, sensor e focal precisam ser positivos');
  }
  return (distanciaCm * sensorMm) / focalMm;
}

export function pxPorCm(pixelsHorizontais: number, larguraCm: number): number {
  if (larguraCm <= 0) return 0;
  return pixelsHorizontais / larguraCm;
}

export type Veredito = {
  sustenta: boolean;
  motivo?: string;
  /** Pixels que a regra exige na largura da zona. */
  pxNecessarios: number;
  /** Pixels que a câmera entrega naquela zona. Teto real. */
  pxDisponiveis: number;
  minima: Degrau | null;
  recomendada: Degrau | null;
  maxima: Degrau | null;
  pxPorCmNoModelo: number | null;
};

/**
 * Qual resolução de envio usar para uma zona, dada a exigência da regra.
 *
 * `larguraZonaCm` é quanto do mundo real a zona cobre.
 * `pxPorCmDaCamera` é o que a câmera entrega naquele ponto.
 */
export function dimensionar(
  pxPorCmExigido: number,
  larguraZonaCm: number,
  pxPorCmDaCamera: number,
): Veredito {
  const pxNecessarios = pxPorCmExigido * larguraZonaCm;
  const pxDisponiveis = pxPorCmDaCamera * larguraZonaCm;

  const vazio = {
    pxNecessarios: Math.ceil(pxNecessarios),
    pxDisponiveis: Math.floor(pxDisponiveis),
    minima: null,
    recomendada: null,
    maxima: null,
    pxPorCmNoModelo: null,
  };

  if (pxNecessarios > pxDisponiveis) {
    // Não é configuração, é física: o detalhe não existe no sensor.
    const distanciaFator = pxNecessarios / pxDisponiveis;
    return {
      ...vazio,
      sustenta: false,
      motivo:
        `a câmera entrega ${Math.floor(pxDisponiveis)} px nessa zona e a regra ` +
        `precisa de ${Math.ceil(pxNecessarios)}. Aproxime a câmera ou aumente a ` +
        `focal em cerca de ${distanciaFator.toFixed(1)}×`,
    };
  }

  // Mínimo: o degrau mais barato que ainda entrega o exigido.
  const minima = DEGRAUS.find((d) => d.px >= pxNecessarios) ?? null;

  // Máximo: o maior degrau que ainda cabe no que a câmera tem. Acima
  // disso o pipeline nem amplia — ampliar não cria detalhe, só custo.
  const acimaDoTeto = [...DEGRAUS].reverse().find((d) => d.px <= pxDisponiveis) ?? null;

  if (!minima) {
    return {
      ...vazio,
      sustenta: false,
      motivo:
        `a zona precisaria de ${Math.ceil(pxNecessarios)} px de envio, acima do ` +
        'maior degrau (1920). Estreite a zona ou aproxime a câmera',
    };
  }

  // Quando o teto da câmera fica abaixo do mínimo exigido pela regra, o
  // degrau mínimo ainda "cabe" na lista mas não haveria pixel real para
  // preencher. `pxNecessarios <= pxDisponiveis` já garantiu que não é o
  // caso aqui — o máximo só pode ser igual ou maior que o mínimo.
  const maxima = acimaDoTeto && acimaDoTeto.px >= minima.px ? acimaDoTeto : minima;

  return {
    sustenta: true,
    pxNecessarios: Math.ceil(pxNecessarios),
    pxDisponiveis: Math.floor(pxDisponiveis),
    minima: minima.nome,
    // O recomendado é o MÍNIMO que atende. Subir de degrau sem ganho de
    // acurácia é só multiplicar a conta no fim do mês.
    recomendada: minima.nome,
    maxima: maxima.nome,
    pxPorCmNoModelo: Number((minima.px / larguraZonaCm).toFixed(2)),
  };
}
