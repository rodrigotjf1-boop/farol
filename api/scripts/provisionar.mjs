#!/usr/bin/env node
// =====================================================================
// Farol · provisionamento pela linha de comando
// =====================================================================
// Roda DENTRO do contêiner do farol-api e fala com a própria API em
// 127.0.0.1. Serve enquanto o console não tem as telas de cadastro — e
// continua útil depois, para instalar loja nova sem depender do navegador.
//
//   npm run provisionar -- loja     <arquivo.json>
//   npm run provisionar -- agente   <lojaId> <nome>
//   npm run provisionar -- usuario  <tenantId> <email> <nome>
//   npm run provisionar -- contexto <lojaId> ligar|desligar [--mesmo-assim]
//   npm run provisionar -- conta-ia <lojaId> <provedor>|tirar
//   npm run provisionar -- balcao   <lojaId> [ligar|desligar]
//   npm run provisionar -- teto     <lojaId> <reais por dia>
//   npm run provisionar -- transporte <nome> <tipos separados por vírgula>
//   npm run provisionar -- transportes
//   npm run provisionar -- transporte-revogar <transporteId>
//
// **Nenhum segredo é digitado como argumento.** O token de distribuição
// sai do ambiente do serviço; a senha do usuário e a chave da conta de IA
// vêm de um prompt que não ecoa. Argumento aparece no histórico do shell e
// na lista de processos.
//
// Fala com a rota HTTP de verdade, não com o banco direto: um atalho que
// fosse direto ao banco teria as próprias regras — validação, transação,
// a guarda contra senha no cadastro — e um dia elas divergiriam da rota.
// =====================================================================

import { readFileSync } from 'node:fs';

const PORTA = process.env.PORT ?? '3000';
const BASE = `http://127.0.0.1:${PORTA}`;
const ADMIN = process.env.FAROL_ADMIN_TOKEN;

function morrer(mensagem) {
  console.error(`\n  ERRO: ${mensagem}\n`);
  process.exit(1);
}

/**
 * `aceitar` são os status de erro que quem chama quer TRATAR em vez de
 * morrer neles: aí a resposta volta com `recusado: true` e o corpo da API.
 */
async function chamar(caminho, corpo, sensivel = {}, { metodo = 'POST', aceitar = [] } = {}) {
  // Conferido aqui, e não na carga do arquivo, para `npm run provisionar`
  // sem argumentos ainda conseguir mostrar a ajuda.
  if (!ADMIN) {
    morrer(
      'FAROL_ADMIN_TOKEN ausente no ambiente do serviço.\n' +
        '  EasyPanel → farol-api → Ambiente → acrescente a variável → Implantar.',
    );
  }

  // Ler e apagar não levam corpo — e a API recusa "é JSON" sem nada dentro.
  const semCorpo = metodo === 'GET' || metodo === 'DELETE';
  let r;
  try {
    r = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: { ...(semCorpo ? {} : { 'content-type': 'application/json' }), 'x-farol-admin': ADMIN },
      // O que é sensível entra só aqui, nunca no objeto que se registra.
      ...(semCorpo ? {} : { body: JSON.stringify({ ...corpo, ...sensivel }) }),
    });
  } catch (e) {
    morrer(`não alcancei a API em ${BASE}: ${e.message}\n  O serviço está de pé?`);
  }

  const texto = await r.text();
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    morrer(`resposta inesperada (HTTP ${r.status}): ${texto.slice(0, 300)}`);
  }

  if (!r.ok) {
    if (aceitar.includes(r.status)) return { ...dados, recusado: true };
    morrer(`HTTP ${r.status} · ${dados.erro ?? ''}\n  ${dados.mensagem ?? texto.slice(0, 300)}`);
  }
  return dados;
}

/**
 * Lê a senha SEM ECO.
 *
 * Senha em argumento aparece no histórico do shell e na lista de
 * processos; em variável de ambiente, vaza para todo processo filho. O
 * prompt mudo é o único caminho que não deixa rastro.
 */
function perguntarSenha(oQue = 'senha do novo usuário') {
  return new Promise((resolver, rejeitar) => {
    const entrada = process.stdin;
    process.stdout.write(`  ${oQue} (não aparece ao digitar): `);

    if (!entrada.isTTY) {
      // Sem terminal (pipe, script): lê a linha inteira e segue.
      let acumulado = '';
      entrada.setEncoding('utf8');
      entrada.on('data', (p) => {
        acumulado += p;
      });
      entrada.on('end', () => resolver(acumulado.trim()));
      return;
    }

    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let senha = '';

    const aoDigitar = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        entrada.setRawMode(false);
        entrada.pause();
        entrada.removeListener('data', aoDigitar);
        process.stdout.write('\n');
        resolver(senha);
      } else if (ch === '\u0003') {
        entrada.setRawMode(false);
        entrada.pause();
        process.stdout.write('\n');
        rejeitar(new Error('cancelado'));
      } else if (ch === '\u007f' || ch === '\b') {
        senha = senha.slice(0, -1);
      } else {
        senha += ch;
      }
    };
    entrada.on('data', aoDigitar);
  });
}

const [comando, ...resto] = process.argv.slice(2);

if (comando === 'loja') {
  const arquivo = resto[0];
  if (!arquivo) morrer('uso: npm run provisionar -- loja <arquivo.json>');

  let corpo;
  try {
    corpo = JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch (e) {
    morrer(`não li ${arquivo}: ${e.message}`);
  }

  const r = await chamar('/v1/distribuicao/lojas', corpo);
  console.log(`\n  loja criada: ${r.loja.nome}`);
  console.log(`  lojaId:   ${r.loja.id}`);
  console.log(`  tenantId: ${r.tenantId}`);
  console.log(`  modo de julgamento: ${r.loja.modoJulgamento}`);
  for (const s of r.setores ?? []) {
    console.log(`    setor ${s.nome}`);
    for (const p of s.pontos ?? []) {
      console.log(`      ponto ${p.nome} (${p.origem}${p.canal ? ` canal ${p.canal}` : ''})`);
    }
  }
  console.log(`\n  próximo: npm run provisionar -- agente ${r.loja.id} "agente da loja"\n`);
  //
} else if (comando === 'agente') {
  const [lojaId, ...nome] = resto;
  if (!lojaId || nome.length === 0) {
    morrer('uso: npm run provisionar -- agente <lojaId> <nome>');
  }

  const r = await chamar('/v1/distribuicao/agentes', { lojaId, nome: nome.join(' ') });
  console.log(`\n  agente criado: ${r.nome}  (${r.estado})`);
  console.log(`  agenteId: ${r.id}\n`);
  console.log('  ┌─────────────────────────────────────────────────────────────');
  console.log('  │ TOKEN — aparece UMA vez. Copie agora.');
  console.log('  │');
  console.log(`  │   ${r.token}`);
  console.log('  │');
  console.log('  │ Vai no config do agente, na loja. O banco guarda só o hash,');
  console.log('  │ então nem eu nem você conseguimos recuperá-lo depois.');
  console.log('  └─────────────────────────────────────────────────────────────\n');
  //
} else if (comando === 'usuario') {
  const [tenantId, email, ...nome] = resto;
  if (!tenantId || !email || nome.length === 0) {
    morrer('uso: npm run provisionar -- usuario <tenantId> <email> <nome>');
  }

  const senha = await perguntarSenha();
  if (!senha) morrer('senha vazia');

  const r = await chamar(
    '/v1/distribuicao/usuarios',
    {
      tenantId,
      email,
      nome: nome.join(' '),
      nivel: process.env.FAROL_NIVEL ?? 'presidente',
    },
    { senha },
  );

  console.log(`\n  usuário criado: ${r.nome} <${r.email}>  (${r.nivel})`);
  console.log(`  id: ${r.id}\n`);
  console.log('  Já dá para entrar no console com esse e-mail e essa senha.\n');
  //
} else if (comando === 'contexto') {
  // A chave INTERNA do pedido com contexto, loja por loja. Ligada, toda
  // pergunta que o agente faz à nuvem leva a cena e o mapa do canal — e
  // canal sem cena escrita não manda imagem para fora. Não existe botão no
  // console da loja para isto, de propósito: é lógica interna do Farol.
  const [lojaId, acao, ...opcoes] = resto;
  const mesmoAssim = opcoes.includes('--mesmo-assim');
  const estranhas = opcoes.filter((o) => o !== '--mesmo-assim');
  if (!lojaId || !['ligar', 'desligar'].includes(acao) || estranhas.length > 0) {
    morrer('uso: npm run provisionar -- contexto <lojaId> ligar|desligar [--mesmo-assim]');
  }

  const r = await chamar(
    `/v1/distribuicao/lojas/${lojaId}`,
    { pedidoComContexto: acao === 'ligar', ...(mesmoAssim ? { mesmoAssim: true } : {}) },
    {},
    { metodo: 'PATCH', aceitar: [409] },
  );

  if (r.recusado && r.erro === 'balcao_ligado') {
    // A API não desligou: o balcão desta loja está ligado, e ele só fala o pedido com contexto.
    console.error(`\n  NÃO DESLIGUEI. ${r.mensagem}`);
    console.error('\n  A ordem da volta:');
    console.error(`    npm run provisionar -- balcao ${lojaId} desligar`);
    console.error(`    npm run provisionar -- contexto ${lojaId} desligar\n`);
    process.exit(2);
  }

  if (r.recusado) {
    // A API não ligou: há canal sem cena, e ligar tiraria análise dele.
    console.error('\n  NÃO LIGUEI. Estes canais têm critério que depende da cena, e a cena está em branco:\n');
    for (const nome of r.canaisSemCena ?? []) console.error(`    · ${nome}`);
    console.error('\n  Com a chave ligada, esses critérios deixam de ser analisados até a cena ser escrita.');
    console.error('\n  Escreva a cena de cada um e rode de novo — ou, para ligar assim mesmo:');
    console.error(`    npm run provisionar -- contexto ${lojaId} ligar --mesmo-assim\n`);
    process.exit(2);
  }

  console.log(`\n  loja: ${r.nome}`);
  console.log(`  pedido com contexto: ${r.pedidoComContexto ? 'LIGADO' : 'desligado'}`);
  console.log(`  versão da configuração: ${r.configVersao}`);
  if (r.pedidoComContexto) {
    console.log('\n  O agente da loja puxa a configuração na próxima batida. A partir daí, toda pergunta');
    console.log('  à nuvem leva a cena e o mapa do canal.');
    if ((r.canaisSemCena ?? []).length > 0) {
      console.log('\n  Canais com critério PARADO até a cena ser escrita:');
      for (const nome of r.canaisSemCena) console.log(`    · ${nome}`);
    }
    console.log(`\n  Para voltar atrás: npm run provisionar -- contexto ${lojaId} desligar\n`);
  } else {
    console.log('\n  O agente da loja puxa a configuração na próxima batida e pergunta como sempre perguntou.\n');
  }
  //
} else if (comando === 'conta-ia') {
  // A conta de IA DA LOJA: de que plataforma é, e a chave dela. O servidor
  // guarda a chave cifrada e nunca a devolve — nem aqui. A chave é
  // perguntada sem aparecer na tela: em argumento ela ficaria no histórico
  // do terminal e na lista de processos.
  const [lojaId, provedor, ...sobra] = resto;
  if (!lojaId || !provedor || sobra.length > 0) {
    morrer('uso: npm run provisionar -- conta-ia <lojaId> <provedor>   (ex.: anthropic)\n       npm run provisionar -- conta-ia <lojaId> tirar');
  }

  if (provedor === 'tirar') {
    const r = await chamar(`/v1/distribuicao/lojas/${lojaId}/conta-ia`, {}, {}, { metodo: 'DELETE', aceitar: [404, 409] });
    if (r.recusado) {
      console.error(`\n  NÃO TIREI. ${r.mensagem}\n`);
      process.exit(2);
    }
    console.log('\n  conta de IA tirada desta loja.\n');
  } else {
    const chave = await perguntarSenha(`chave da conta de IA da loja, na ${provedor}`);
    if (!chave) morrer('chave vazia');
    const r = await chamar(`/v1/distribuicao/lojas/${lojaId}/conta-ia`, { provedor }, { chave }, { metodo: 'PUT' });
    console.log(`\n  conta de IA gravada: ${r.provedor}`);
    console.log('  A chave ficou guardada cifrada. O servidor não a mostra de volta — nem aqui.');
    console.log(`\n  próximo: npm run provisionar -- balcao ${lojaId} ligar\n`);
  }
  //
} else if (comando === 'balcao') {
  // A chave INTERNA do balcão, loja por loja. Ligada, a dúvida do agente é
  // entregue ao servidor, que pergunta à plataforma com a conta de IA
  // daquela loja. Sem ação, só mostra como está.
  const [lojaId, acao, ...sobra] = resto;
  if (!lojaId || (acao !== undefined && !['ligar', 'desligar'].includes(acao)) || sobra.length > 0) {
    morrer('uso: npm run provisionar -- balcao <lojaId> [ligar|desligar]');
  }

  const r = acao
    ? await chamar(`/v1/distribuicao/lojas/${lojaId}/balcao`, { ligado: acao === 'ligar' }, {}, { metodo: 'PATCH', aceitar: [409] })
    : await chamar(`/v1/distribuicao/lojas/${lojaId}/balcao`, {}, {}, { metodo: 'GET' });

  if (r.recusado) {
    console.error(`\n  NÃO LIGUEI. ${r.mensagem}\n`);
    if (r.erro === 'sem_conta_de_ia') console.error(`  Cadastre a conta: npm run provisionar -- conta-ia ${lojaId} anthropic\n`);
    if (r.erro === 'sem_pedido_com_contexto') console.error(`  Ligue antes: npm run provisionar -- contexto ${lojaId} ligar\n`);
    process.exit(2);
  }

  console.log(`\n  loja: ${r.nome}`);
  console.log(`  balcão (a dúvida pelo servidor): ${r.ligado ? 'LIGADO' : 'desligado'}`);
  console.log(`  teto de gasto por dia: R$ ${(r.tetoCentavosDia / 100).toFixed(2).replace('.', ',')}`);
  console.log(`  conta de IA: ${r.contaDeIa ? r.contaDeIa.provedor : 'não cadastrada'}`);
  console.log(`  pedido com contexto: ${r.pedidoComContexto ? 'ligado' : 'desligado'}`);
  console.log(`  versão da configuração: ${r.configVersao}`);
  if (r.hoje) {
    // O dia é o da operação da loja: a madrugada pertence à noite anterior.
    const reais = (centavos) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
    console.log(`\n  hoje (${r.hoje.dia}): ${r.hoje.duvidas} dúvida(s) — ${r.hoje.respondidas} respondida(s), ${r.hoje.falharam} sem resposta`);
    console.log(`  reconsultas ao modelo forte: ${r.hoje.reconsultas}`);
    console.log(`  gasto de hoje: ${reais(r.hoje.custoCentavos)} de ${reais(r.tetoCentavosDia)}`);
  }
  console.log('');
  //
} else if (comando === 'teto') {
  // Quanto a loja pode gastar POR DIA com a dúvida. O servidor corta antes
  // de perguntar. Em reais: 40 ou 40,00.
  const [lojaId, valor, ...sobra] = resto;
  const lido = /^\d{1,5}([.,]\d{1,2})?$/.test(valor ?? '') ? Math.round(Number(valor.replace(',', '.')) * 100) : null;
  if (!lojaId || lido === null || sobra.length > 0) {
    morrer('uso: npm run provisionar -- teto <lojaId> <reais por dia>   (ex.: 40 ou 40,00)');
  }

  const r = await chamar(`/v1/distribuicao/lojas/${lojaId}/balcao`, { tetoCentavosDia: lido }, {}, { metodo: 'PATCH' });
  console.log(`\n  loja: ${r.nome}`);
  console.log(`  teto de gasto por dia: R$ ${(r.tetoCentavosDia / 100).toFixed(2).replace('.', ',')}\n`);
  //
} else if (comando === 'transporte') {
  // Quem ENTREGA os alertas (o n8n, o Regem) tem token próprio, que só reivindica e devolve envios dos tipos dados —
  // a chave geral não vale nas rotas de envio (migration 046).
  const [nome, tiposTexto, ...sobra] = resto;
  if (!nome || !tiposTexto || sobra.length > 0) {
    morrer('uso: npm run provisionar -- transporte <nome> <tipos separados por vírgula>\n  ex.: transporte n8n whatsapp,email');
  }
  const tipos = tiposTexto.split(',').map((x) => x.trim()).filter(Boolean);

  const r = await chamar('/v1/distribuicao/transportes', { nome, tipos });
  console.log(`\n  transporte criado: ${r.nome}  (entrega: ${r.tipos.join(', ')})`);
  console.log(`  transporteId: ${r.id}\n`);
  console.log('  ┌─────────────────────────────────────────────────────────────');
  console.log('  │ TOKEN — aparece UMA vez. Copie agora.');
  console.log('  │');
  console.log(`  │   ${r.token}`);
  console.log('  │');
  console.log('  │ Vai no transporte (n8n, Regem), no cabeçalho');
  console.log('  │   Authorization: Bearer <token>');
  console.log('  │ O banco guarda só o resumo: ninguém o recupera depois.');
  console.log('  └─────────────────────────────────────────────────────────────\n');
  //
} else if (comando === 'transportes') {
  const r = await chamar('/v1/distribuicao/transportes', {}, {}, { metodo: 'GET' });
  if (r.transportes.length === 0) console.log('\n  nenhum transporte emitido\n');
  for (const t of r.transportes) {
    const situacao = t.revogado_em ? `revogado em ${t.revogado_em}` : t.usado_em ? `usado em ${t.usado_em}` : 'nunca usado';
    console.log(`  ${t.id}  ${t.nome}  (${t.tipos.join(', ')})  · ${situacao}`);
  }
  //
} else if (comando === 'transporte-revogar') {
  const [id, ...sobra] = resto;
  if (!id || sobra.length > 0) {
    morrer('uso: npm run provisionar -- transporte-revogar <transporteId>   (o id sai de: transportes)');
  }
  const r = await chamar(`/v1/distribuicao/transportes/${id}/revogar`, {});
  console.log(`\n  revogado: ${r.transporte.nome}  em ${r.transporte.revogado_em}`);
  console.log('  Os outros transportes seguem valendo.\n');
  //
} else {
  console.log(`
  uso:
    npm run provisionar -- loja     <arquivo.json>
    npm run provisionar -- agente   <lojaId> <nome>
    npm run provisionar -- usuario  <tenantId> <email> <nome>
    npm run provisionar -- contexto <lojaId> ligar|desligar [--mesmo-assim]
    npm run provisionar -- conta-ia <lojaId> <provedor>|tirar
    npm run provisionar -- balcao   <lojaId> [ligar|desligar]
    npm run provisionar -- teto     <lojaId> <reais por dia>
    npm run provisionar -- transporte <nome> <tipos separados por vírgula>
    npm run provisionar -- transportes
    npm run provisionar -- transporte-revogar <transporteId>

  O nível do usuário sai de FAROL_NIVEL (padrão: presidente).
  O lojaId é o que aparece no endereço da tela da loja, no console.
  A chave da conta de IA é perguntada sem aparecer na tela.
`);
  process.exit(comando ? 1 : 0);
}
