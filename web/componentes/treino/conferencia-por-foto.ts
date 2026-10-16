// =====================================================================
// A conferência por foto: as contas da gaveta, sem tela
// =====================================================================
// A21. Do protótipo aprovado pelo dono em 15/10/2026 (`mockups/farol-
// conexoes-e-fichas.html`, tela Treinamento, "Conferência do lanche: nova"),
// com as três escolhas que ele confirmou no mesmo dia: sobrando uma ficha nas
// perguntas, ela já fica marcada; o trio conta como acerto; o lanche sem
// palpite conta como não acertado (as duas últimas, na API).
//
//   • as PERGUNTAS que separam as fichas plausíveis: os ingredientes da ficha
//     do palpite que as outras não têm, o mais raro primeiro. O "não" de um
//     ingrediente que o cliente pode mandar tirar ("Sem cebola") e o "sim" de
//     um adicional não tiram a ficha;
//   • o ATALHO "Marcar o que o Farol leu": em cada foto em que toda leitura dá
//     UM nome — o que ela disse, ou, quando ficou entre dois, o que está na
//     ficha do lanche (o dono: o pão "se define pela ficha, mesmo sem ver o
//     outro lado dele");
//   • a CONTA DA FICHA pelas marcas: a marca diz que o ingrediente está na
//     foto (a carne aparece de novo na foto do ovo) — conta uma vez; quantas
//     fatias, quem diz é a leitura. A mesma conta da API
//     (`vistosDaConferencia`).
// =====================================================================

import type { EtapaDoLanche, FotoDoLanche, PalpiteDoLanche } from '@/lib/api';

export const chave = (s: string) => s.trim().toLowerCase();
const tem = (lista: string[], nome: string) => lista.some((n) => chave(n) === chave(nome));

/** No máximo tantas perguntas ao mesmo tempo (as respondidas sempre ficam, para dar para desfazer). */
export const MAX_PERGUNTAS = 3;

/** A ficha aceita a resposta? O "não" do que o cliente pode tirar e o "sim" de um adicional não tiram a ficha. */
export function bateComResposta(p: PalpiteDoLanche, nome: string, v: 'sim' | 'nao'): boolean {
  const naFicha = p.ingredientes.some((i) => chave(i.nome) === chave(nome));
  return v === 'sim' ? naFicha || tem(p.adicionais, nome) : !naFicha || tem(p.tira, nome);
}

/**
 * As perguntas que separam as fichas plausíveis, e as que sobram com as respostas dadas. A ordem não muda sob o dedo:
 * cada pergunta no lugar da raridade; só a respondida que deixou de separar (a ficha-alvo mudou) sobe para o topo.
 */
export function perguntasDoLanche(palpites: PalpiteDoLanche[], respostas: Record<string, 'sim' | 'nao'>) {
  const plausiveis = palpites.filter((p) => p.plausivel);
  const feitas = Object.keys(respostas);
  const sobram = plausiveis.filter((p) => feitas.every((n) => bateComResposta(p, n, respostas[n]!)));
  const alvo = sobram[0] ?? plausiveis[0];
  if (!alvo || plausiveis.length < 2) return { plausiveis, sobram, perguntas: feitas };
  const outras = plausiveis.filter((p) => p !== alvo);
  const separam = alvo.ingredientes
    .filter((i) => outras.some((o) => !o.ingredientes.some((x) => chave(x.nome) === chave(i.nome))))
    .sort((a, b) => a.usos - b.usos || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((i) => i.nome);
  const fora = feitas.filter((f) => !tem(separam, f));
  const novas = separam.filter((n) => !tem(feitas, n)).slice(0, Math.max(0, MAX_PERGUNTAS - feitas.length));
  return { plausiveis, sobram, perguntas: [...fora, ...separam.filter((n) => tem(feitas, n) || novas.includes(n))] };
}

/** Por que a ficha segue, quando a resposta contraria o que ela diz: o cliente pode pedir assim. */
export function ressalvas(p: PalpiteDoLanche, respostas: Record<string, 'sim' | 'nao'>): string[] {
  const saida: string[] = [];
  for (const [nome, v] of Object.entries(respostas)) {
    const naFicha = p.ingredientes.some((i) => chave(i.nome) === chave(nome));
    if (v === 'nao' && naFicha) saida.push(`sem ${nome.toLowerCase()}, que o cliente pode mandar tirar`);
    if (v === 'sim' && !naFicha) saida.push(`com ${nome.toLowerCase()}, que é adicional dele`);
  }
  return saida;
}

/** O nome que a leitura da etapa dá: o único candidato; entre vários, o único que está na ficha. Sem nome: nulo. */
export function nomeDaLeitura(e: EtapaDoLanche, ficha: string[]): string | null {
  if (e.candidatos.length === 1) return e.candidatos[0]!;
  const naFicha = e.candidatos.filter((c) => tem(ficha, c));
  return e.candidatos.length > 1 && naFicha.length === 1 ? naFicha[0]! : null;
}

/** A foto em que toda leitura dá um nome: o atalho marca por ela. A etapa sem leitura nenhuma é dúvida. */
export function fotoSemDuvida(f: FotoDoLanche, etapas: EtapaDoLanche[], ficha: string[]): boolean {
  return f.etapas.every((i) => nomeDaLeitura(etapas[i]!, ficha) !== null);
}

/** O que "Marcar o que o Farol leu" marca na foto. */
export function lidosParaMarcar(f: FotoDoLanche, etapas: EtapaDoLanche[], ficha: string[]): string[] {
  const nomes: string[] = [];
  for (const i of f.etapas) {
    const n = nomeDaLeitura(etapas[i]!, ficha);
    if (n && !tem(nomes, n)) nomes.push(n);
  }
  return nomes;
}

/** Os nomes que as leituras da foto acham possíveis (os botões com ponto). */
export function sugeridosNaFoto(f: FotoDoLanche, etapas: EtapaDoLanche[]): string[] {
  const nomes: string[] = [];
  for (const i of f.etapas) for (const c of etapas[i]!.candidatos) if (!tem(nomes, c)) nomes.push(c);
  return nomes;
}

export type MarcasDaFoto = { marcados: string[]; ruim: boolean };

/**
 * O que a bancada pôs, para a conta da ficha: as marcas das fotos, quando há alguma; senão, a leitura (só a etapa que
 * disse um nome). A marca é presença — a mesma em duas fotos conta uma vez —, e as fatias vêm da leitura que o achou.
 */
export function vistosNaConferencia(fotos: FotoDoLanche[], etapas: EtapaDoLanche[], marcas: MarcasDaFoto[]): Map<string, { nome: string; vezes: number }> {
  const conta = new Map<string, { nome: string; vezes: number }>();
  fotos.forEach((f, j) => {
    const m = marcas[j];
    if (!m || m.ruim) return;
    for (const nome of m.marcados) {
      const k = chave(nome);
      let vezes = 1;
      for (const i of f.etapas) if (etapas[i]!.candidatos.some((c) => chave(c) === k)) vezes = Math.max(vezes, etapas[i]!.vezes);
      const ja = conta.get(k);
      conta.set(k, { nome: ja?.nome ?? nome, vezes: Math.max(ja?.vezes ?? 0, vezes) });
    }
  });
  if (conta.size) return conta;
  for (const e of etapas) {
    if (e.candidatos.length !== 1) continue;
    const k = chave(e.candidatos[0]!);
    const ja = conta.get(k);
    conta.set(k, { nome: ja?.nome ?? e.candidatos[0]!, vezes: (ja?.vezes ?? 0) + e.vezes });
  }
  return conta;
}

/**
 * A resposta guardada volta para as fotos de agora: a por foto, pelas etapas (o agrupamento pode ter mudado — o quadro
 * apagado depois de 30 dias); a antiga, por etapa, vira a marca da foto dela.
 */
export function marcasGuardadas(
  fotos: FotoDoLanche[],
  etapas: EtapaDoLanche[],
  resposta: { fotos?: Array<{ etapas?: number[]; marcados: string[]; ruim: boolean; obs: string | null }>; etapas?: Array<{ v: string; nome?: string | null } | null> },
): Array<MarcasDaFoto & { obs: string }> {
  const daEtapa = new Map<number, { marcados: string[]; ruim: boolean; obs: string }>();
  if (resposta.fotos) {
    resposta.fotos.forEach((f, j) => {
      for (const i of f.etapas ?? fotos[j]?.etapas ?? []) daEtapa.set(i, { marcados: f.marcados, ruim: f.ruim, obs: f.obs ?? '' });
    });
  } else {
    (resposta.etapas ?? []).forEach((r, i) => {
      const nome = r?.v === 'certo' ? (etapas[i]?.candidatos[0] ?? null) : r?.v === 'outro' ? (r.nome ?? null) : null;
      if (nome) daEtapa.set(i, { marcados: [nome], ruim: false, obs: '' });
    });
  }
  return fotos.map((f) => {
    const marcados: string[] = [];
    let ruim = false;
    let obs = '';
    for (const i of f.etapas) {
      const x = daEtapa.get(i);
      if (!x) continue;
      for (const n of x.marcados) if (!tem(marcados, n)) marcados.push(n);
      ruim = ruim || x.ruim;
      obs = obs || x.obs;
    }
    return { marcados, ruim, obs };
  });
}
