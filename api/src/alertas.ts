// =====================================================================
// Política de alertas — quem recebe o quê
// =====================================================================
// O Farol decide; quem entrega é outro. Este módulo é o "decide".
//
// A decisão é separada do transporte de propósito: WhatsApp, e-mail e KDS
// têm filas, retentativas e formatos de template diferentes, e o Regem já
// resolveu isso uma vez. Repetir aqui amarraria um produto REVENDÁVEL a
// um provedor de mensageria — e dobraria o cadastro de números.
//
// ## Por que a resolução é em TypeScript e não em SQL
//
// As tabelas de política são configuração: uma loja tem punhado de linhas,
// não milhões. Trazer as linhas e decidir aqui custa uma consulta e deixa
// a regra legível e testável sem banco. A resolução em SQL seria uma
// consulta com três `coalesce` e um `not exists` — e a política que o dono
// descreveu em uma frase não deve precisar de arqueologia para conferir.
//
// Onde o volume existe de verdade — o despacho, um registro por envio — a
// escrita é set-based, e isso vive no `despacho`, não aqui.
// =====================================================================

export type Severidade = 'info' | 'atencao' | 'critico' | 'emergencia';
export type Prioridade = 'urgente' | 'intermediaria' | 'leve';

export interface LinhaPolitica {
  id: string;
  loja_id: string | null;
  severidade: Severidade | null;
  prioridade: Prioridade | null;
  enviar: boolean;
  destino_id: string | null;
}

export interface DestinoAtivo {
  id: string;
  tipo: 'whatsapp' | 'email' | 'kds' | 'webhook';
  loja_id: string | null;
  papel: string | null;
}

export interface Decisao {
  destinos: string[];
  /** Por que deu nisso — vai para o log e para a tela. */
  motivo: string;
}

/** Severidade e prioridade que NÃO podem ficar sem aviso. */
const SEMPRE_ALCANCA: { sev: Severidade[]; pri: Prioridade[] } = {
  sev: ['emergencia'],
  pri: ['urgente'],
};

function casa(l: LinhaPolitica, sev: Severidade, pri: Prioridade): boolean {
  // Nulo é curinga: "qualquer severidade" e "qualquer prioridade".
  return (
    (l.severidade === null || l.severidade === sev) &&
    (l.prioridade === null || l.prioridade === pri)
  );
}

/**
 * Para onde este alerta vai.
 *
 * ## O escopo mais específico GANHA inteiro
 *
 * Se a loja tem qualquer linha de política, só as linhas dela valem — as
 * da rede são ignoradas. A alternativa, somar os dois escopos, tornaria
 * impossível uma loja receber MENOS que o padrão da rede: todo veto local
 * seria desfeito por uma linha de rede. "Esta loja não quer aviso de
 * leve" tem que ser dizível.
 *
 * ## O veto ganha do envio
 *
 * Uma linha com `enviar: false` que case silencia a combinação inteira,
 * mesmo que outra linha mande enviar. É como se lê uma regra de firewall,
 * e é a única forma de "não me avise disso" não exigir apagar o resto.
 *
 * ## Sem política, a emergência AINDA alcança
 *
 * Nenhuma linha casando não quer dizer "mande para ninguém" quando a
 * cozinha está pegando fogo. Emergência e urgente alcançam todos os
 * destinos ativos; o resto fica calado. A assimetria é deliberada: um
 * alerta a mais incomoda alguém por um instante, uma emergência não vista
 * tira do produto a razão de existir. Quem não quer o alcance padrão
 * cadastra uma linha de veto — explicitamente.
 */
export function resolverDestinos(
  politicas: LinhaPolitica[],
  destinos: DestinoAtivo[],
  sev: Severidade,
  pri: Prioridade,
): Decisao {
  const daLoja = politicas.filter((p) => p.loja_id !== null);
  const escopo = daLoja.length > 0 ? daLoja : politicas;

  const casam = escopo.filter((p) => casa(p, sev, pri));

  const vetos = casam.filter((p) => !p.enviar);
  if (vetos.length > 0) {
    return {
      destinos: [],
      motivo: `silenciado por política (${sev}/${pri})`,
    };
  }

  const alvos = casam.filter((p) => p.enviar && p.destino_id);
  if (alvos.length > 0) {
    // Duas linhas podem apontar o mesmo destino — "crítico para o
    // gerente" e "qualquer severidade para o gerente". Mandar duas vezes
    // ensina quem recebe a ignorar as duas.
    const unicos = [...new Set(alvos.map((p) => p.destino_id as string))];
    return {
      destinos: unicos,
      motivo: `política (${sev}/${pri}): ${unicos.length} destino(s)`,
    };
  }

  const inegociavel =
    SEMPRE_ALCANCA.sev.includes(sev) || SEMPRE_ALCANCA.pri.includes(pri);

  if (!inegociavel) {
    return { destinos: [], motivo: `sem política para ${sev}/${pri}` };
  }

  if (destinos.length === 0) {
    // Não é silêncio: é falta de cadastro, e precisa aparecer como falta.
    return {
      destinos: [],
      motivo: `${sev}/${pri} exige aviso, mas a loja não tem destino cadastrado`,
    };
  }

  return {
    destinos: destinos.map((d) => d.id),
    motivo: `sem política; ${sev}/${pri} alcança todos os destinos ativos`,
  };
}

/**
 * Chave de idempotência do despacho.
 *
 * O agente já não duplica EVENTO. Isto impede duplicar o AVISO, que é
 * problema diferente: o mesmo evento pode ser despachado de novo depois
 * de uma falha de rede, e quem recebe não tem como saber que é o mesmo.
 */
export function chaveDeEnvio(
  motivo: 'evento' | 'agente_caiu' | 'busca_concluida',
  referencia: string,
  destinoId: string,
  faixa?: string,
): string {
  // A faixa de tempo só entra onde o aviso se REPETE de propósito: um
  // agente fora do ar por três dias deve avisar de novo periodicamente,
  // senão o primeiro aviso se perde e o silêncio parece normalidade.
  return [motivo, referencia, destinoId, faixa ?? ''].join(':');
}

/**
 * A faixa de um aviso recorrente, contada DESDE O COMEÇO do problema.
 *
 * A primeira versão disto contava faixas fixas desde a época do Unix, e um
 * teste mostrou o defeito: um agente que cai às 05:59 cruza a borda da
 * faixa um minuto depois e recebe o segundo aviso imediatamente. O
 * intervalo real virava sorteio entre um minuto e seis horas — exatamente
 * o ruído que a faixa existe para evitar.
 *
 * Contando desde `desde`, o primeiro aviso é a faixa 0 e o segundo sai seis
 * horas DENTRO da queda, para qualquer hora do dia.
 *
 * Seis horas: curto o bastante para o segundo aviso chegar no mesmo turno
 * de quem pode agir, longo o bastante para não virar ruído de madrugada.
 */
export function faixaDeRepeticao(desde: Date, agora: Date, horas = 6): string {
  const decorrido = agora.getTime() - desde.getTime();
  const n = Math.max(0, Math.floor(decorrido / (horas * 3600_000)));
  return `f${n}`;
}
