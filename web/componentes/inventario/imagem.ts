// A foto enviada pelo console é reduzida AQUI, no navegador, antes de subir:
// foto de celular tem 4 a 12 MB, e a API só guarda — não tem biblioteca de
// imagem. O que sobe é sempre JPEG, com no máximo 1600 pontos no lado maior.

/** O que a API aceita, com folga (lá o limite é 1,5 MB). */
const LIMITE_DE_BYTES = 1_400_000;
/** Do maior para o menor: a primeira tentativa que couber vale. */
const TENTATIVAS: ReadonlyArray<readonly [lado: number, qualidade: number]> = [
  [1600, 0.85],
  [1280, 0.8],
  [1024, 0.72],
];

async function emBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let texto = '';
  // Em pedaços: `String.fromCharCode(...bytes)` de uma vez estoura a pilha.
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}

/**
 * A imagem escolhida, reduzida e em JPEG, pronta para subir (base64).
 * Lança `Error` com a frase que a tela mostra.
 */
export async function reduzirParaEnvio(arquivo: File): Promise<string> {
  let imagem: ImageBitmap;
  try {
    imagem = await createImageBitmap(arquivo);
  } catch {
    throw new Error('não consegui abrir esta imagem. Envie uma foto em JPEG ou PNG.');
  }
  try {
    for (const [lado, qualidade] of TENTATIVAS) {
      const escala = Math.min(1, lado / Math.max(imagem.width, imagem.height));
      const tela = document.createElement('canvas');
      tela.width = Math.max(1, Math.round(imagem.width * escala));
      tela.height = Math.max(1, Math.round(imagem.height * escala));
      const ctx = tela.getContext('2d');
      if (!ctx) throw new Error('este navegador não conseguiu preparar a imagem');
      // JPEG não tem transparência: sem o fundo, o que era transparente viraria preto.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, tela.width, tela.height);
      ctx.drawImage(imagem, 0, 0, tela.width, tela.height);
      const blob = await new Promise<Blob | null>((pronto) => tela.toBlob(pronto, 'image/jpeg', qualidade));
      if (blob && blob.size <= LIMITE_DE_BYTES) return emBase64(blob);
    }
    throw new Error('a foto ficou grande demais mesmo reduzida. Tente outra.');
  } finally {
    imagem.close();
  }
}
