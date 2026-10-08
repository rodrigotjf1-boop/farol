// A situação de um canal AGORA: é o que pinta a câmera e o campo de visão
// dela na planta ("Situação agora").
//
// Vem dos mesmos lugares que o resto do console: o cadastro do canal
// (pausado), os sinais do painel (sem imagem), os critérios (ligados, e
// com a loja aberta ou fechada) e as ocorrências (aviso recente). O que o
// perfil não vê, ou o que não chegou, não é afirmado: sem os sinais do
// painel a câmera é "ativa", e não "conferindo" — como na lista de canais.

// Caminho relativo, e os outros só de tipo: é o que deixa `api/testes/planta.test.ts`
// importar este arquivo e conferir a regra (o console não tem corredor de teste).
import { desdeAHora } from '../formatos';
import type { Tom } from '@/componentes/ui/pecas';
import type { Ocorrencia, Ponto, Regra, Sinal } from '@/lib/api';

export type ChaveDaSituacao = 'ok' | 'alerta' | 'semcrit' | 'semimagem' | 'pausado';
export type Situacao = { chave: ChaveDaSituacao; texto: string; tom: Tom };

/** Quanto tempo um aviso mantém a câmera acesa na planta. */
export const JANELA_DO_AVISO_MS = 10 * 60_000;

export type OQueSeSabe = {
  regras: Regra[];
  /** Os sinais do painel. Nulo = este perfil não vê resultados, ou ainda não chegaram. */
  sinais: Sinal[] | null;
  ocorrencias: Ocorrencia[] | null;
  /** O relógio do servidor na hora em que as ocorrências foram lidas. */
  agora: string | null;
  fuso: string;
  /** A loja está aberta agora? Nulo = sem horário informado: vale como sempre aberta. */
  abertaAgora: boolean | null;
  /** O computador da loja está batendo? Sem ele ninguém confere nada. */
  agenteAtivo: boolean;
};

export function situacaoDoCanal(ponto: Ponto, s: OQueSeSabe): Situacao {
  if (!ponto.ativo) return { chave: 'pausado', texto: 'pausado', tom: 'atencao' };

  const semImagem = s.agenteAtivo ? s.sinais?.find((x) => x.tipo === 'canal_sem_imagem' && x.pontoId === ponto.id) : undefined;
  if (semImagem) {
    const desde = desdeAHora(semImagem.desde, s.fuso);
    return { chave: 'semimagem', texto: `sem imagem${desde ? ` ${desde}` : ''}`, tom: 'critico' };
  }

  const doCanal = s.regras.filter((r) => r.alvos.some((a) => a.ponto_id === ponto.id));
  if (doCanal.length === 0) return { chave: 'semcrit', texto: 'sem critério', tom: 'neutro' };
  const ligados = doCanal.filter((r) => r.ativa);
  if (ligados.length === 0) return { chave: 'semcrit', texto: 'nenhum critério ligado', tom: 'neutro' };

  // Loja sem horário informado é tratada como sempre aberta.
  const aberta = s.abertaAgora !== false;
  const valendo = ligados.filter((r) => r.quando === 'sempre' || (r.quando === 'fora_do_horario') !== aberta);
  if (valendo.length === 0) {
    return { chave: 'semcrit', texto: aberta ? 'só confere com a loja fechada' : 'só confere com a loja aberta', tom: 'neutro' };
  }

  if (!s.agenteAtivo) return { chave: 'semcrit', texto: 'computador da loja sem sinal', tom: 'neutro' };

  const agora = s.agora ? Date.parse(s.agora) : Number.NaN;
  const recente =
    Number.isFinite(agora) &&
    (s.ocorrencias ?? []).some((o) => o.pontoId === ponto.id && agora - Date.parse(o.ocorridoEm) <= JANELA_DO_AVISO_MS);
  return recente
    ? { chave: 'alerta', texto: 'aviso nos últimos 10 min', tom: 'critico' }
    : // Sem os sinais não dá para dizer que a câmera tem imagem: fica só o que o cadastro garante.
      { chave: 'ok', texto: s.sinais === null ? 'ativo' : 'conferindo', tom: 'ok' };
}

/** Canal sem imagem ou pausado não cobre nada: é o que a camada de cobertura desconta. */
export const cobre = (s: Situacao | undefined): boolean => !s || (s.chave !== 'semimagem' && s.chave !== 'pausado');

/** "04", "13" — como o canal é conhecido no gravador. Câmera IP direta não tem número. */
export const numeroDoCanal = (p: Pick<Ponto, 'canal'>): string => (p.canal != null ? String(p.canal).padStart(2, '0') : 'IP');
