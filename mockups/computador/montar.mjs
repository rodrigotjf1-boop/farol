// Junta as partes do protótipo do COMPUTADOR DA LOJA (o horário em que ele dorme e acorda sozinho) num arquivo só.
//
//   node mockups/computador/montar.mjs
//
// O estilo de base é o da cara nova (`mockups/novo/partes/01-estilo.css`) e as peças do protótipo das fichas
// (`mockups/regem/partes/20-regem.css`: a gaveta, a chave de ligar, o diálogo); este só acrescenta o que é dele
// (`30-computador.css`).
//
// Sai:
//   mockups/farol-computador-da-loja.html        documento inteiro, abre com dois cliques
//   mockups/computador/saida/computador.html     só o corpo, do jeito que a publicação como página espera
//                                                (pasta fora do git)
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PARTES = join(AQUI, 'partes');
const SAIDA = join(AQUI, 'saida');
const nomes = readdirSync(PARTES).sort();
const juntar = (fim) => nomes.filter((f) => f.endsWith(fim)).map((f) => readFileSync(join(PARTES, f), 'utf8')).join('\n');

const base = readFileSync(join(AQUI, '..', 'novo', 'partes', '01-estilo.css'), 'utf8');
const pecas = readFileSync(join(AQUI, '..', 'regem', 'partes', '20-regem.css'), 'utf8');
const css = `${base}\n${pecas}\n${juntar('.css')}`;
const corpo = juntar('.html');
const js = juntar('.js');
if (!base || !pecas || !corpo || !js) throw new Error('faltou parte: estilo de base, peças, html ou js');

const TITULO = '<title>Computador da loja</title>';
const FONTES =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">';

const publicado = `${TITULO}\n${FONTES}\n<style>\n${css}\n</style>\n${corpo}\n<script>\n${js}\n</script>\n`;
const inteiro =
  '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  `${TITULO}\n${FONTES}\n<style>\n${css}\n</style>\n</head>\n<body>\n${corpo}\n<script>\n${js}\n</script>\n</body>\n</html>\n`;

mkdirSync(SAIDA, { recursive: true });
writeFileSync(join(SAIDA, 'computador.html'), publicado, 'utf8');
writeFileSync(join(AQUI, '..', 'farol-computador-da-loja.html'), inteiro, 'utf8');
console.log(`farol-computador-da-loja.html: ${inteiro.length} bytes`);
