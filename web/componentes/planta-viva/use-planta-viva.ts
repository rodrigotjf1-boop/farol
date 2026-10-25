'use client';

// O que as três telas da planta viva leem juntas: a planta, os canais da loja (o nome e a cor de cada câmera) e as
// calibrações. Só a resposta do pedido mais novo vale.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { corDaCamera } from '@/componentes/planta-viva/planta-de-cima';
import { calibracaoApi, consoleApi, ErroDaApi, plantaApi, type Ponto } from '@/lib/api';
import type { Planta } from '@/lib/planta';
import type { Calibracao } from '@/lib/planta-viva';

export type DadosDaPlantaViva = {
  planta: Planta | null;
  versaoDaPlanta: number | null;
  canais: Ponto[];
  calibracoes: Map<string, Calibracao>;
};

export function usePlantaViva(lojaId: string) {
  const [dados, setDados] = useState<DadosDaPlantaViva | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const [p, l, c] = await Promise.all([plantaApi.obter(lojaId), consoleApi.loja(lojaId), calibracaoApi.lista(lojaId)]);
      if (meu !== pedido.current) return;
      const canais = l.setores.flatMap((s) => s.pontos).sort((a, b) => (a.canal ?? 999) - (b.canal ?? 999) || a.nome.localeCompare(b.nome));
      setDados({ planta: p.planta, versaoDaPlanta: p.versao, canais, calibracoes: new Map(c.calibracoes.map((x) => [x.pontoId, x])) });
      setErro(null);
    } catch (e) {
      if (meu === pedido.current) setErro(e instanceof ErroDaApi ? e.message : 'não consegui carregar a planta');
    }
  }, [lojaId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const indice = useMemo(() => new Map((dados?.canais ?? []).map((c, i) => [c.id, i])), [dados]);
  const nomeDaCamera = useCallback(
    (pontoId: string) => {
      const c = dados?.canais.find((x) => x.id === pontoId);
      return c ? (c.canal != null ? `Canal ${c.canal}` : c.nome) : 'Câmera';
    },
    [dados],
  );
  const nomeLongo = useCallback(
    (pontoId: string) => {
      const c = dados?.canais.find((x) => x.id === pontoId);
      return c ? (c.canal != null ? `Canal ${c.canal} · ${c.nome}` : c.nome) : 'Câmera';
    },
    [dados],
  );
  const corDe = useCallback((pontoId: string) => corDaCamera(indice.get(pontoId) ?? 0), [indice]);

  return { dados, erro, carregar, nomeDaCamera, nomeLongo, corDe };
}
