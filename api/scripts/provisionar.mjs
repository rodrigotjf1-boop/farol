#!/usr/bin/env node
// =====================================================================
// Farol · provisionamento pela linha de comando
// =====================================================================
// Roda DENTRO do contêiner do farol-api e fala com a própria API em
// 127.0.0.1. Serve enquanto o console não existe — e continua útil depois,
// para instalar loja nova sem depender do navegador.
//
//   npm run provisionar -- loja   <arquivo.json>
//   npm run provisionar -- agente <lojaId> <nome>
//
// **O token de distribuição NÃO é digitado.** Sai do `FAROL_ADMIN_TOKEN`
// que já está no ambiente do serviço — então não passa por terminal, não
// fica no histórico do shell e não aparece em print.
//
// Usa a rota HTTP de verdade, não o banco direto: assim validação,
// transação e a guarda contra segredo no cadastro valem aqui também. Um
// atalho que falasse com o banco teria as próprias regras, e um dia elas
// divergiriam.
// =====================================================================

import { readFileSync } from 'node:fs';

const PORTA = process.env.PORT ?? '3000';
const BASE = `http://127.0.0.1:${PORTA}`;
const ADMIN = process.env.FAROL_ADMIN_TOKEN;

function morrer(mensagem) {
  console.error(`\n  ERRO: ${mensagem}\n`);
  process.exit(1);
}

async function chamar(caminho, corpo) {
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
      body: JSON.stringify(corpo),
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
} else {
  console.log(`
  uso:
    npm run provisionar -- loja   <arquivo.json>
    npm run provisionar -- agente <lojaId> <nome>
`);
  process.exit(comando ? 1 : 0);
}
