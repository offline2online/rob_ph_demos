// Inlines the brand font, the official logo files (white for dark slides, full colour for light), Material Symbols Rounded (400) icons
// and the ph-brand infinity-loop path into one self-contained HTML file.
import fs from 'node:fs';
import path from 'node:path';
const root = path.dirname(new URL(import.meta.url).pathname);
const nm = path.join(root, 'node_modules');
const logoWhite = path.join(root, 'assets/ph_logo_white.svg');
const logoColour = path.join(root, 'assets/ph_logo_full_color.svg');
const loopPath = path.join(root, 'assets/infinity-loop-path.txt');
const outPath = path.join(root, 'dist/run-your-own-rmn-launch.html');
let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const font = (w) => fs.readFileSync(`${nm}/@fontsource/kantumruy-pro/files/kantumruy-pro-latin-${w}-normal.woff2`).toString('base64');
const icon = (n) => fs.readFileSync(`${nm}/@material-symbols/svg-400/rounded/${n}.svg`, 'utf8')
  .replace(/\s*\n\s*/g, ' ').trim().replace('<svg ', '<svg class="ic" aria-hidden="true" ');
html = html.replace(/\{\{K(\d00)\}\}/g, (_, w) => font(w));
const svgUri = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(f).toString('base64');
html = html.replace('{{LOGO_WHITE}}', svgUri(logoWhite)).replace('{{LOGO_COLOUR}}', svgUri(logoColour));
html = html.replace(/\{\{icon:([a-z_]+)\}\}/g, (_, n) => icon(n));
html = html.replace(/\{\{LOOP\}\}/g, fs.readFileSync(loopPath, 'utf8').trim());
if (/\{\{/.test(html)) throw new Error('unreplaced placeholder');
if (/[–—]/.test(html.replace(/<style>[\s\S]*?<\/style>/, ''))) throw new Error('long dash found in copy');
fs.writeFileSync(outPath, html);
console.log('wrote', outPath, (html.length / 1024).toFixed(0) + ' KB');
