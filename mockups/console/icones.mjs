// Monta o sprite de ícones do protótipo a partir do Lucide (licença ISC).
//
//   node mockups/console/icones.mjs <pasta de ícones do lucide-react>
//
// A pasta é `node_modules/lucide-react/dist/esm/icons` de qualquer projeto
// que tenha o pacote instalado. Só precisa rodar de novo para acrescentar
// um ícone: o resultado (`partes/00-sprite.html`) fica no repositório.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ORIGEM = process.argv[2];
if (!ORIGEM) {
  console.error('uso: node icones.mjs <.../node_modules/lucide-react/dist/esm/icons>');
  process.exit(2);
}

const NOMES = `layout-dashboard cctv list-checks bell-ring calculator store chevrons-up-down
chevron-right chevron-down arrow-left arrow-right arrow-up-right plus x check ellipsis pencil
trash-2 log-out sun moon eye eye-off refresh-cw crop ruler plug cpu hard-drive video video-off
folder hash scan-search layers list-ordered user-round-check message-circle mail webhook monitor
triangle-alert circle-alert circle-check circle-x clock activity info send check-check hourglass
zap package badge-check lock-keyhole circle-help circle-minus sliders-horizontal bell-off
maximize building-2 loader-circle circle-slash unplug scan-eye history
chart-column cloud coins filter-x`
  .split(/\s+/)
  .filter(Boolean);

const atributos = (o) =>
  Object.entries(o)
    .filter(([k]) => k !== 'key')
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

let simbolos = '';
for (const nome of NOMES) {
  // O pacote publica `.js` em algumas versões e `.mjs` em outras.
  const achar = (n) => [`${n}.js`, `${n}.mjs`].map((a) => join(ORIGEM, a)).find((a) => existsSync(a));
  let arquivo = achar(nome);
  if (!arquivo) throw new Error(`não achei o ícone ${nome}`);
  let fonte = readFileSync(arquivo, 'utf8');
  // Ícone que mudou de nome vira um arquivo de uma linha apontando para o
  // novo (`export { default } from './trash.mjs'`): segue o apontamento.
  const apelido = fonte.match(/export \{ default \} from '\.\/([a-z0-9-]+)\.m?js'/);
  if (apelido) {
    arquivo = achar(apelido[1]);
    if (!arquivo) throw new Error(`o ícone ${nome} aponta para ${apelido[1]}, que não achei`);
    fonte = readFileSync(arquivo, 'utf8');
  }
  // O desenho é uma lista de nós. Nas versões novas ela mora em
  // `node: [[...]]`; nas antigas, é o segundo argumento de createLucideIcon.
  const marca = fonte.indexOf('node: [');
  let inicio;
  let fim;
  if (marca >= 0) {
    inicio = fonte.indexOf('[', marca);
    let fundo = 0;
    for (fim = inicio; fim < fonte.length; fim += 1) {
      if (fonte[fim] === '[') fundo += 1;
      else if (fonte[fim] === ']' && (fundo -= 1) === 0) break;
    }
    if (fim >= fonte.length) fim = -1;
  } else {
    inicio = fonte.indexOf('[', fonte.indexOf('createLucideIcon('));
    fim = fonte.lastIndexOf(']);');
  }
  if (inicio < 0 || fim < 0) throw new Error(`formato inesperado em ${nome}`);
  const nos = new Function(`return ${fonte.slice(inicio, fim + 1)}`)();
  if (!Array.isArray(nos) || nos.length === 0) throw new Error(`sem desenho em ${nome}`);
  const corpo = nos.map(([tag, a]) => `<${tag} ${atributos(a)}/>`).join('');
  simbolos += `<symbol id="i-${nome}" viewBox="0 0 24 24">${corpo}</symbol>\n`;
}

const sprite =
  '<!-- Ícones: Lucide (https://lucide.dev), licença ISC. Gerado por icones.mjs. -->\n' +
  '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n' +
  simbolos +
  '</svg>\n';

writeFileSync(join(AQUI, 'partes', '00-sprite.html'), sprite, 'utf8');
console.log(`${NOMES.length} ícones, ${sprite.length} bytes`);
