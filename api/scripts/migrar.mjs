#!/usr/bin/env node
// =====================================================================
// Farol · aplicador de migrations, à mão
// =====================================================================
// Roda DENTRO do contêiner do farol-api, onde as migrations chegaram
// pelo deploy e o DATABASE_URL já existe no ambiente. É o que tira o SQL
// da área de transferência: migration passa a viajar pelo git, não pelo
// Ctrl+V num terminal de navegador.
//
//   npm run migrar              aplica as pendentes
//   npm run migrar:conferir     só lista, não aplica
//
// Desde 08/10/2026 o serviço aplica as pendentes sozinho ao subir (ver
// src/guarda.ts). Este comando continua existindo para quando a subida não
// conseguiu — e é o mesmo código: quem aplica é scripts/migrador.mjs.
//
// Mora em api/scripts/ e não junto das migrations porque precisa do `pg`,
// e o `pg` é dependência da API — resolver módulo a partir de uma pasta
// sem node_modules acima não funciona.
// =====================================================================

import { migrar } from './migrador.mjs';

const SO_CONFERIR = process.argv.includes('--conferir');

function dizer(e) {
  if (e.tipo === 'inicio') {
    console.log(`\n  ${e.pasta}`);
    console.log(`  ${e.total} migrations no repo · ${e.jaAplicadas} já aplicadas\n`);
  } else if (e.tipo === 'nada') {
    console.log('  nada pendente, banco em dia\n');
  } else if (e.tipo === 'pendentes') {
    console.log('  PENDENTES (modo --conferir, nada foi aplicado):');
    for (const nome of e.nomes) console.log(`    ${nome}`);
    console.log();
  } else if (e.tipo === 'aplicando') {
    process.stdout.write(`  aplicando ${e.nome} ... `);
  } else if (e.tipo === 'aplicada') {
    console.log('ok');
  } else if (e.tipo === 'falhou') {
    console.log('FALHOU');
  } else if (e.tipo === 'fim') {
    console.log(`\n  ${e.quantas} aplicada(s)\n`);
  } else if (e.tipo === 'ultima') {
    console.log(`  última: ${e.nome} em ${e.aplicadaEm}\n`);
  }
}

const r = await migrar({ url: process.env.DATABASE_URL, soConferir: SO_CONFERIR, dizer });
if (!r.ok) {
  console.error(`\n  ERRO: ${r.mensagem}\n`);
  process.exit(1);
}
