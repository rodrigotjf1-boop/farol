'use client';

// =====================================================================
// Ao vivo › "Ver no celular" (29/10/2026, protótipo aprovado)
// =====================================================================
// O dono pediu "opção de acompanhar do celular por algum link" e escolheu
// o link COM login (opção A): o código QR abre esta mesma tela, no endereço
// do console; quem abre entra com o próprio usuário. Nada novo na API, nada
// de link que abre sem senha.
//
// O que a frase promete é o que existe hoje: a sessão do console vale um
// tempo e não se renova sozinha (`api/src/rotas/sessao.ts`), então a tela
// diz "quando o acesso vencer, o console pede a senha de novo" — e não "o
// celular fica lembrando" (o protótipo dizia; ver a entrega de 29/10).
// =====================================================================

import qrcode from 'qrcode-generator';
import { useMemo, useRef, useState } from 'react';

import { Dialogo } from '@/componentes/ui/sobreposto';

/**
 * O endereço num código QR, em SVG (nítido em qualquer tamanho). Preto no branco nos dois temas, de propósito: é o que
 * a câmera de celular lê melhor; a borda branca de 4 módulos é a que a norma pede.
 */
export function CodigoQr({ texto, rotulo }: { texto: string; rotulo: string }) {
  const { n, caminho } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(texto);
    q.make();
    const lado = q.getModuleCount();
    let d = '';
    for (let r = 0; r < lado; r += 1) for (let c = 0; c < lado; c += 1) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n: lado, caminho: d };
  }, [texto]);
  const borda = 4;
  return (
    <svg
      viewBox={`${-borda} ${-borda} ${n + 2 * borda} ${n + 2 * borda}`}
      className="block aspect-square h-auto w-full max-w-[220px] rounded-[12px]"
      shapeRendering="crispEdges"
      role="img"
      aria-label={rotulo}
      data-qr={n}
    >
      <rect x={-borda} y={-borda} width={n + 2 * borda} height={n + 2 * borda} fill="#ffffff" />
      <path d={caminho} fill="#000000" />
    </svg>
  );
}

export function VerNoCelular({ endereco, aoFechar }: { endereco: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState<'sim' | 'selecione' | null>(null);
  const texto = useRef<HTMLParagraphElement>(null);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado('sim');
    } catch {
      // Sem permissão de área de transferência: deixa o endereço selecionado, para copiar à mão.
      const el = texto.current;
      if (el) {
        const faixa = document.createRange();
        faixa.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(faixa);
      }
      setCopiado('selecione');
    }
  };

  return (
    <Dialogo
      titulo="Ver no celular"
      rotuloConfirmar={copiado === 'sim' ? 'Endereço copiado' : 'Copiar o endereço'}
      rotuloCancelar="Fechar"
      variante="secundario"
      aoConfirmar={() => void copiar()}
      aoCancelar={aoFechar}
    >
      <p>Aponte a câmera do celular para o código: ele abre esta mesma tela, ao vivo.</p>
      <div className="flex justify-center">
        <CodigoQr texto={endereco} rotulo="Código QR com o endereço desta tela" />
      </div>
      <p ref={texto} className="select-all break-all rounded-[10px] bg-farol-painel-2 px-3 py-2 font-mono text-[12px] text-farol-tinta" data-endereco>
        {endereco}
      </p>
      {copiado === 'selecione' ? (
        <p role="status" className="text-[13px]">
          Este navegador não deixou copiar sozinho: o endereço ficou selecionado — copie com Ctrl+C.
        </p>
      ) : null}
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13.5px]">
        <li>
          Entre com o seu usuário: o movimento ao vivo é de quem configura a loja (gerente para cima). Quando o acesso vencer, o
          console pede a senha de novo.
        </li>
        <li>No navegador do celular, use &ldquo;Adicionar à tela de início&rdquo;: fica um ícone que abre direto aqui.</li>
        <li>Com o celular de pé, a planta aparece grande e a lista vem embaixo.</li>
      </ol>
    </Dialogo>
  );
}
