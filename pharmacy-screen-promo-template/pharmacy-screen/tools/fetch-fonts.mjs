// Self-hosted fonts for the screen: downloads them ONCE, at build time, from Google Fonts and writes them
// into the page's own stylesheets as data: URLs, so a screen behind a firewall never calls Google at runtime.
//
//   node tools/fetch-fonts.mjs              (rewrites css/fonts.css, css/material-symbols.css, the Roboto block of
//                                            css/debug.css and css/occasion-fonts.css)
//   node tools/fetch-fonts.mjs occasions    (only css/occasion-fonts.css; `screen` for the others)
//
// What is kept, and why:
//   css/fonts.css             Figtree 400-800 (variable, latin + latin-ext): the screen's typeface.
//   css/debug.css             Roboto 400-700 (variable, latin): the platform font, used by the debug panel only, so
//                             it is downloaded only with debug=1 (between the "Roboto" markers; the rest of the
//                             file is hand-written).
//   css/material-symbols.css  Material Symbols Outlined, the one instance the screen draws (FILL 1, wght 500,
//                             opsz 24, GRAD 0), cut down to the icons the screen can show: the editor's icon picker
//                             (admin/js/icons.js) and the screen's own (SCREEN_ICONS), by tools/subset-icons.py,
//                             which needs Python 3 with fontTools (pip install fonttools brotli). It is a static
//                             font, so it is registered for every weight and the screen's font-variation-settings
//                             have nothing to vary.
//   css/occasion-fonts.css    The Seasonal templates' display faces (js/occasions.js), latin subset, only the
//                             weights and styles the designs use: Playfair Display, Outfit, Big Shoulders Display,
//                             Archivo Black, Archivo, DM Serif Display, Fredoka and Cormorant Garamond.
// All are open source (Figtree, Roboto and the occasion faces: SIL Open Font License 1.1; Material Symbols: Apache 2.0).
// data: URLs keep these plain text files (the board's patch hand-over takes text only). The deploy
// (scripts/deploy.mjs buildShell) writes each one out as its own .woff2 file beside the fingerprinted stylesheets,
// so a player downloads and caches the fonts as files and a stylesheet change never re-downloads a font.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A desktop Chrome user agent: Google Fonts then answers with woff2.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function text(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}
async function bytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const b64 = async (url) => (await bytes(url)).toString('base64');

// The icons the screen draws besides the service tiles' (js/render.js: the message and not-set-up screens).
export const SCREEN_ICONS = ['tv_off'];
// The full icon font cut down to the editor's icons and SCREEN_ICONS (tools/subset-icons.py), as base64.
async function subsetIcons(url) {
  const { ICONS } = await import('../admin/js/icons.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-icons-'));
  try {
    fs.writeFileSync(path.join(dir, 'full.woff2'), await bytes(url));
    fs.writeFileSync(path.join(dir, 'names.txt'), [...ICONS, ...SCREEN_ICONS].join('\n'));
    const r = spawnSync('python3', [path.join(ROOT, 'tools/subset-icons.py'), path.join(dir, 'full.woff2'), path.join(dir, 'names.txt'), path.join(dir, 'icons.woff2')], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tools/subset-icons.py failed (needs Python 3 with fontTools: pip install fonttools brotli): ${(r.stderr || r.error || '').toString().trim()}`);
    console.log(`Material Symbols: ${r.stdout.trim()}`);
    return fs.readFileSync(path.join(dir, 'icons.woff2')).toString('base64');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Google's css2 answer -> [{subset, range, url, style, weight}]
async function faces(family) {
  const css = await text(`https://fonts.googleapis.com/css2?family=${family}&display=block`);
  const out = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[2];
    const url = (/src:\s*url\(([^)]+)\)/.exec(body) || [])[1];
    const range = (/unicode-range:\s*([^;]+);/.exec(body) || [])[1] || '';
    const style = (/font-style:\s*([^;]+);/.exec(body) || [])[1] || 'normal';
    const weight = (/font-weight:\s*([^;]+);/.exec(body) || [])[1] || '400';
    if (url) out.push({ subset: m[1] || '', range: range.trim(), url, style: style.trim(), weight: weight.trim() });
  }
  if (!out.length) throw new Error(`no @font-face for ${family}`);
  return out;
}

// weight: the font-weight to register (a variable font's whole range); null keeps Google's own per face.
// data: how a face's file becomes its base64 (default: downloaded as it is).
async function familyCss(name, family, subsets, weight, data = b64) {
  const all = await faces(family);
  const pick = subsets ? all.filter((f) => subsets.includes(f.subset)) : all;
  if (!pick.length) throw new Error(`${name}: none of ${subsets} in ${all.map((f) => f.subset)}`);
  const parts = [];
  for (const f of pick) {
    parts.push(`/* ${name}${f.style === 'italic' ? ' italic' : ''}${weight ? '' : ' ' + f.weight}${f.subset ? ' ' + f.subset : ''} */\n@font-face{font-family:"${name}";font-style:${f.style};font-weight:${weight || f.weight};font-display:block;src:url(data:font/woff2;base64,${await data(f.url)}) format("woff2")${f.range ? `;unicode-range:${f.range}` : ''}}`);
  }
  return parts.join('\n');
}

const header = (what) => `/* ${what}\n   Generated by tools/fetch-fonts.mjs from Google Fonts at build time; never fetched at runtime. Do not edit by hand. */\n`;

const only = process.argv[2] || 'all';
if (!['all', 'screen', 'occasions'].includes(only)) throw new Error(`usage: node tools/fetch-fonts.mjs [all|screen|occasions]`);
const written = [];

if (only !== 'occasions') {
  const fontsCss = header('Self-hosted fonts: Figtree (the screen; SIL OFL 1.1). Roboto (the debug panel) is in css/debug.css.')
    + await familyCss('Figtree', 'Figtree:wght@400..800', ['latin', 'latin-ext'], '400 800') + '\n';
  fs.writeFileSync(path.join(ROOT, 'css/fonts.css'), fontsCss);

  // Roboto goes between the markers in css/debug.css, so only the debug panel (debug=1) downloads it.
  const debugFile = path.join(ROOT, 'css/debug.css');
  const debugCss = fs.readFileSync(debugFile, 'utf8');
  const BEGIN = '/* Roboto (SIL OFL 1.1): generated by tools/fetch-fonts.mjs, do not edit by hand. */\n', END = '/* end Roboto */\n';
  const roboto = BEGIN + await familyCss('Roboto', 'Roboto:wght@400..700', ['latin'], '400 700') + '\n' + END;
  const a = debugCss.indexOf(BEGIN), b = debugCss.indexOf(END);
  if (a < 0 || b < a) throw new Error('css/debug.css has no Roboto markers');
  fs.writeFileSync(debugFile, debugCss.slice(0, a) + roboto + debugCss.slice(b + END.length));

  const iconsCss = header('Self-hosted icons: Material Symbols Outlined, FILL 1, wght 500, opsz 24 (Apache 2.0), only the icons the editor offers (admin/js/icons.js) and the screen\'s own.')
    + await familyCss('Material Symbols Outlined', 'Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,500,1,0', null, '100 900', subsetIcons) + '\n';
  fs.writeFileSync(path.join(ROOT, 'css/material-symbols.css'), iconsCss);

  written.push(`css/fonts.css ${(fontsCss.length / 1024).toFixed(0)} KB`, `css/debug.css (Roboto) ${(roboto.length / 1024).toFixed(0)} KB`, `css/material-symbols.css ${(iconsCss.length / 1024).toFixed(0)} KB`);
}

// The Seasonal templates (js/occasions.js): each family with exactly the weights and styles its design sets.
const OCCASION_FAMILIES = [
  ['Playfair Display', 'Playfair+Display:ital,wght@0,500;1,600'],
  ['Outfit', 'Outfit:wght@300..600'],
  ['Big Shoulders Display', 'Big+Shoulders+Display:wght@800..900'],
  ['Archivo Black', 'Archivo+Black'],
  ['Archivo', 'Archivo:wght@500;700'],
  ['DM Serif Display', 'DM+Serif+Display:ital@0;1'],
  ['Fredoka', 'Fredoka:wght@500..700'],
  ['Cormorant Garamond', 'Cormorant+Garamond:ital,wght@0,500;0,600;1,500'],
];
if (only !== 'screen') {
  let occCss = header('Self-hosted fonts for the Seasonal templates (js/occasions.js), latin subset; all SIL OFL 1.1.');
  for (const [name, family] of OCCASION_FAMILIES) occCss += await familyCss(name, family, ['latin'], null) + '\n';
  fs.writeFileSync(path.join(ROOT, 'css/occasion-fonts.css'), occCss);
  written.push(`css/occasion-fonts.css ${(occCss.length / 1024).toFixed(0)} KB`);
}

console.log(written.join(', '));
