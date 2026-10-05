#!/usr/bin/env node
// =====================================================================
// Farol · provisionamento pela linha de comando
// =====================================================================
// Roda DENTRO do contêiner do farol-api e fala com a própria API em
// 127.0.0.1. Serve enquanto o console não tem as telas de cadastro — e
// continua útil depois, para instalar loja nova sem depender do navegador.
//
//   npm run provisionar -- loja    <arquivo.json>
//   npm run provisionar -- agente  <lojaId> <nome>
//   npm run provisionar -- usuario <tenantId> <email> <nome>
//
// **Nenhum segredo é digitado como argumento.** O token de distribuição
// sai do ambiente do serviço; a senha do usuário vem de um prompt que não
// ecoa. Argumento aparece no histórico do shell e na lista de processos.
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

async function chamar(caminho, corpo, sensivel = {}) {
  // Conferido aqui, e não na carga do arquivo, para `npm run provisionar`
  // sem argumentos ainda conseguir mostrar a ajuda.
  if (!ADMIN) {
    morrer(
      'FAROL_ADMIN_TOKEN ausente no ambiente do serviço.\n' +
        '  EasyPanel → farol-api → Ambiente → acrescente a variável → Implantar.',
    );
  }

  let r;
  try {
    r = await fetch(`${BASE}${caminho}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-farol-admin': ADMIN },
      // O que é sensível entra só aqui, nunca no objeto que se registra.
      body: JSON.stringify({ ...corpo, ...sensivel }),
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
function perguntarSenha() {
  return new Promise((resolver, rejeitar) => {
    const entrada = process.stdin;
    process.stdout.write('  senha do novo usuário (não aparece ao digitar): ');

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
} else {
  console.log(`
  uso:
    npm run provisionar -- loja    <arquivo.json>
    npm run provisionar -- agente  <lojaId> <nome>
    npm run provisionar -- usuario <tenantId> <email> <nome>

  O nível do usuário sai de FAROL_NIVEL (padrão: presidente).
`);
  process.exit(comando ? 1 : 0);
}
