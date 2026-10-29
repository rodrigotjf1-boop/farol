'use client';

// =====================================================================
// O link só do ao vivo — a página que abre no celular (29/10/2026)
// =====================================================================
// Quem recebe o link vê SÓ o movimento ao vivo de uma loja: a planta (de
// cima ou em 3D) com os setores em cores, as pessoas andando pelo posto e
// quantas há em cada setor. Sem login, sem menu, sem imagem das câmeras,
// sem histórico, sem botão que mude alguma coisa — e o servidor nem manda o
// resto (`api/src/rotas/link-ao-vivo.ts`). Protótipo aprovado pelo dono:
// `mockups/farol-link-ao-vivo.html`.
//
// O código vem depois do "#" do endereço (`/ver#<código>`): o navegador
// nunca o manda a servidor; a página o lê aqui e o leva num cabeçalho. Por
// isso tudo começa depois de montar (no servidor não há endereço com "#").
//
// Desligado, vencido ou que nunca existiu: "Este link não vale mais", sem o
// nome da loja. Sem sinal (o computador da loja ou a internet de lá fora, ou
// a loja fechada): a planta fica, sem ninguém, com o aviso; volta sozinha.
// =====================================================================

import { Box, Lock, Map as MapaIcone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AoVivo3D } from '@/componentes/planta-viva/ao-vivo-3d';
import { AoVivoPlanta } from '@/componentes/planta-viva/ao-vivo-planta';
import { classeDaChave, LegendaDosLugares, ListaPorSetor, useLugares } from '@/componentes/planta-viva/lugares-ao-vivo';
import { useAoVivo } from '@/componentes/planta-viva/use-ao-vivo';
import { Alerta, CARTAO, Ossos, Ponto, Segmentado, Titulo } from '@/componentes/ui/pecas';
import { ErroDaApi, linkAoVivoApi, type PlantaDoLink } from '@/lib/api';
import type { Planta } from '@/lib/planta';
import type { AgoraDaPlanta } from '@/lib/planta-viva';

type Modo = 'planta' | '3d';
const MODOS: ReadonlyArray<{ valor: Modo; rotulo: string; icone: typeof MapaIcone }> = [
  { valor: 'planta', rotulo: 'Planta', icone: MapaIcone },
  { valor: '3d', rotulo: '3D', icone: Box },
];
const TENTAR_DE_NOVO_MS = 5000;
const naoVale = (e: unknown) => e instanceof ErroDaApi && e.status === 404;
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const semCamera = () => 'Câmera';
const nada = () => {};

export function AoVivoPorLink() {
  /** Nulo = ainda não leu o endereço (antes de montar). */
  const [codigo, setCodigo] = useState<string | null>(null);
  const [fim, setFim] = useState(false);
  const [dados, setDados] = useState<PlantaDoLink | null>(null);
  const [erroAoAbrir, setErroAoAbrir] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('3d');
  const [comCores, setComCores] = useState(true);
  const [comNomes, setComNomes] = useState(true);

  // o código, do fim do endereço; outro link colado na mesma aba recomeça do zero
  useEffect(() => {
    const ler = () => {
      const c = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
      setCodigo(c);
      setDados(null);
      setFim(!c);
    };
    ler();
    window.addEventListener('hashchange', ler);
    return () => window.removeEventListener('hashchange', ler);
  }, []);

  // a planta do link; sem rede, tenta de novo sozinha
  useEffect(() => {
    if (!codigo) return;
    let parado = false;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const abrir = async () => {
      try {
        const d = await linkAoVivoApi.planta(codigo);
        if (parado) return;
        setDados(d);
        setErroAoAbrir(null);
      } catch (e) {
        if (parado) return;
        if (naoVale(e)) {
          setFim(true);
          return;
        }
        setErroAoAbrir(e instanceof ErroDaApi ? e.message : 'não consegui abrir agora');
        espera = setTimeout(abrir, TENTAR_DE_NOVO_MS);
      }
    };
    void abrir();
    return () => {
      parado = true;
      if (espera) clearTimeout(espera);
    };
  }, [codigo]);

  useEffect(() => {
    document.title = fim ? 'Link do ao vivo — Farol' : dados ? `${dados.loja.nome} · ao vivo — Farol` : 'Ao vivo — Farol';
  }, [dados, fim]);

  // o desenho como as peças do console esperam: sem câmera, sem área, sem setor e sem equipamento do inventário
  const planta: Planta | null = useMemo(
    () =>
      dados
        ? {
            ambientes: dados.planta.ambientes.map((a) => ({ ...a, setorId: null })),
            moveis: dados.planta.moveis.map((m) => ({ ...m, itemId: null })),
            cameras: [],
            areas: [],
          }
        : null,
    [dados],
  );

  const ler = useCallback(async (): Promise<AgoraDaPlanta> => {
    const a = await linkAoVivoApi.agora(codigo ?? '');
    return { ...a, canais: [], pessoas: a.pessoas.map((p) => ({ ...p, canais: [] })) };
  }, [codigo]);
  const parar = useCallback((e: unknown) => {
    if (!naoVale(e)) return false;
    setFim(true);
    return true;
  }, []);
  const { agora, erro, figuras, mostradas } = useAoVivo({ planta: fim ? null : planta, ler, parar });
  const { lugares, porLugar } = useLugares(planta, figuras);

  if (fim) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center gap-3 px-4 py-10" data-link-nao-vale>
        <Lock className="h-11 w-11 text-farol-suave" aria-hidden />
        <h1 className="text-balance font-display text-[34px] font-black uppercase leading-[.95]">Este link não vale mais</h1>
        <p className="text-[15px] text-farol-suave">Quem criou o link desligou, ou o prazo acabou. Peça um link novo a quem mandou este.</p>
      </main>
    );
  }

  const situacao = agora?.situacao ?? 'sem_sinal';
  const semSinal = situacao === 'sem_sinal';
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-[780px] flex-col gap-3 px-4 pb-8 pt-[calc(16px+env(safe-area-inset-top,0px))]"
      data-link-ao-vivo
    >
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[.1em] text-farol-suave">Farol · ao vivo</p>
          <h1 className="break-words font-display text-[28px] font-black uppercase leading-[1.05]" data-nome-da-loja>
            {dados?.loja.nome ?? 'Ao vivo'}
          </h1>
        </div>
        {dados ? (
          <span
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-display text-[16px] font-extrabold uppercase tracking-[.06em]"
            aria-live="polite"
            data-situacao={situacao}
          >
            <Ponto tom={situacao === 'ao_vivo' ? 'critico' : situacao === 'parado' ? 'atencao' : 'neutro'} pulsa={situacao === 'ao_vivo'} />
            {situacao === 'ao_vivo' ? 'Ao vivo' : situacao === 'parado' ? 'Parado' : 'Sem sinal'}
          </span>
        ) : null}
      </header>

      {erroAoAbrir ? <Alerta tom="atencao" papel="status">{erroAoAbrir} — tentando de novo.</Alerta> : null}
      {!dados || !planta ? (
        <Ossos alturas={[360, [110, 110]]} />
      ) : (
        <>
          <Segmentado rotulo="Modo de ver" opcoes={MODOS} valor={modo} aoMudar={setModo} />
          {erro ? <Alerta tom="atencao" papel="status">{erro} — tentando de novo.</Alerta> : null}
          <section className="relative min-w-0 overflow-hidden rounded-[22px] bg-farol-cena shadow-farol-2" aria-label="A loja agora">
            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1 pt-3" data-chaves-da-cena>
              <button type="button" className={classeDaChave(comCores)} aria-pressed={comCores} onClick={() => setComCores((v) => !v)}>
                Cores
              </button>
              <button type="button" className={classeDaChave(comNomes)} aria-pressed={comNomes} onClick={() => setComNomes((v) => !v)}>
                Nomes
              </button>
              {comCores ? <LegendaDosLugares lugares={lugares} /> : null}
            </div>
            {modo === 'planta' ? (
              <AoVivoPlanta
                planta={planta}
                figuras={figuras}
                escolhida={null}
                aoEscolher={nada}
                numeroDoCanal={semCamera}
                comCores={comCores}
                comNomes={comNomes}
              />
            ) : (
              <AoVivo3D
                planta={planta}
                modo="3d"
                posicoes={mostradas}
                escolhida={null}
                nomeDaCamera={semCamera}
                comCores={comCores}
                comNomes={comNomes}
              />
            )}
            {semSinal ? (
              // embaixo da cena, acima da dica do 3D: em cima, cobria a segunda linha da legenda no celular
              <p className="absolute inset-x-3 bottom-12 rounded-xl bg-farol-cena/95 px-3 py-2 text-[13px] text-farol-cena-tinta" role="status" data-sem-sinal>
                <b className="block font-display text-[16px] font-extrabold uppercase tracking-[.04em]">Sem sinal da loja</b>
                O computador do Farol na loja, ou a internet de lá, está fora — ou a loja está fechada. A tela volta sozinha
                quando o sinal voltar.
              </p>
            ) : null}
          </section>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <section className={`${CARTAO} p-4`} aria-labelledby="t-na-loja">
              <Titulo id="t-na-loja">Na loja</Titulo>
              <div className="font-display text-[56px] font-black leading-[.85] tabular-nums" data-total>
                {semSinal ? '–' : figuras.length}
              </div>
            </section>
            <section className={`${CARTAO} p-4`} aria-labelledby="t-por-setor">
              <Titulo id="t-por-setor">Por setor</Titulo>
              <ListaPorSetor lugares={lugares} porLugar={porLugar} semNumero={semSinal} />
            </section>
          </div>
          <p className="text-[12.5px] text-farol-suave" data-rodape-do-link>
            Só o movimento ao vivo: sem nomes e sem imagem das câmeras.{' '}
            {dados.venceEm ? `Este link vale até ${dia(dados.venceEm)}.` : 'Este link vale até alguém desligar.'}
          </p>
        </>
      )}
    </main>
  );
}
