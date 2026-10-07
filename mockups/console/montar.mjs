// Junta as partes do protótipo num arquivo só.
//
//   node mockups/console/montar.mjs
//
// Sai:
//   mockups/farol-console.html             documento inteiro, abre com dois cliques
//   mockups/console/saida/console-do-farol.html   só o corpo, do jeito que a
//                                                  publicação como página espera
//                                                  (pasta fora do git)
//
// As partes entram em ordem de nome. CSS e script são embutidos: o protótipo
// não depende de servidor, só das fontes do Google — e sem internet ele abre
// com a fonte do sistema.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PARTES = join(AQUI, 'partes');
const SAIDA = join(AQUI, 'saida');
const ler = (nome) => readFileSync(join(PARTES, nome), 'utf8');

// As letras do logotipo vêm do kit de marca, sem redesenhar nada.
const letras = readFileSync(join(AQUI, 'letras.html'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('<path'))
  .join('');
if ((letras.match(/<path/g) ?? []).length !== 4) throw new Error('esperava as 4 letras do logotipo');

const css = ['01-estilo.css', '02-ajustes.css'].map(ler).join('\n');
const js = ler('90-comportamento.js');
const html = readdirSync(PARTES)
  .filter((f) => f.endsWith('.html'))
  .sort()
  .map(ler)
  .join('\n');
if (!html.includes('<!--LETRAS-->')) throw new Error('faltou o lugar das letras');
const corpo = html.replaceAll('<!--LETRAS-->', letras);

const TITULO = '<title>Console do Farol</title>';
const FONTES =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..700&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">';

const publicado = `${TITULO}\n${FONTES}\n<style>\n${css}\n</style>\n${corpo}\n<script>\n${js}\n</script>\n`;

const inteiro =
  '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  `${TITULO}\n${FONTES}\n<style>\n${css}\n</style>\n</head>\n<body>\n${corpo}\n<script>\n${js}\n</script>\n</body>\n</html>\n`;

mkdirSync(SAIDA, { recursive: true });
writeFileSync(join(SAIDA, 'console-do-farol.html'), publicado, 'utf8');
writeFileSync(join(AQUI, '..', 'farol-console.html'), inteiro, 'utf8');
console.log(`farol-console.html: ${inteiro.length} bytes`);
