// Junta as partes do protótipo da cara nova num arquivo só.
//
//   node mockups/novo/montar.mjs
//
// Sai:
//   mockups/farol-console-novo.html          documento inteiro, abre com dois cliques
//   mockups/novo/saida/console-novo.html     só o corpo, do jeito que a publicação
//                                            como página espera (pasta fora do git)
//   mockups/novo/saida/console-onda2.html    o mesmo protótipo, abrindo direto na tela dos
//                                            exemplos (onda 2), com nome próprio de página
//
// CSS e script são embutidos: o protótipo não depende de servidor, só das
// fontes do Google — e sem internet ele abre com a fonte do sistema.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PARTES = join(AQUI, 'partes');
const SAIDA = join(AQUI, 'saida');
const nomes = readdirSync(PARTES).sort();
const juntar = (fim) => nomes.filter((f) => f.endsWith(fim)).map((f) => readFileSync(join(PARTES, f), 'utf8')).join('\n');

const css = juntar('.css');
const corpo = juntar('.html');
const js = juntar('.js');
if (!css || !corpo || !js) throw new Error('faltou parte: css, html ou js');

const TITULO = '<title>Canal e critérios do Farol</title>';
const FONTES =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">';

const publicado = `${TITULO}\n${FONTES}\n<style>\n${css}\n</style>\n${corpo}\n<script>\n${js}\n</script>\n`;
const inteiro =
  '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  `${TITULO}\n${FONTES}\n<style>\n${css}\n</style>\n</head>\n<body>\n${corpo}\n<script>\n${js}\n</script>\n</body>\n</html>\n`;

// A página da onda 2: o mesmo corpo, com a entrada na tela dos exemplos quando não vem âncora.
const ENTRADA = '<div class="app">';
if (corpo.split(ENTRADA).length !== 2) throw new Error('a moldura mudou: não achei a abertura do app uma vez');
const onda2 = publicado
  .replace(TITULO, '<title>Exemplos e acerto do Farol</title>')
  .replace(ENTRADA, '<div class="app" data-entrada="exemplos">');

mkdirSync(SAIDA, { recursive: true });
writeFileSync(join(SAIDA, 'console-novo.html'), publicado, 'utf8');
writeFileSync(join(SAIDA, 'console-onda2.html'), onda2, 'utf8');
writeFileSync(join(AQUI, '..', 'farol-console-novo.html'), inteiro, 'utf8');
console.log(`farol-console-novo.html: ${inteiro.length} bytes`);
