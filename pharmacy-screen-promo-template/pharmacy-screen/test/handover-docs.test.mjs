// The handover docs stay in step with the code (requirement 22).
//
// docs/CONFIGURATION.md must list every environment variable the code reads and every query parameter the
// screen page, the admin page and the config API read, and nothing the code does not read. Every variable in
// the two .env.example files must be in CONFIGURATION.md and in the code, and they hold placeholders only.
// Every handover document must exist, and every relative link in them must resolve.
//
// Runs with the screen's unit tests (`npm test` / `npm run test:units` here), so it runs in the train's
// "Pharmacy Screen tests" workflow and in `npm run check:all` / `npm run check:docs` one folder up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..'); // pharmacy-screen-promo-template/
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const HANDOVER = [
  'README.md', 'START-HERE.md', 'AGENTS.md', 'CLAUDE.md', '.env.example', 'CHANGELOG.md',
  'docs/DEPLOYMENT.md', 'docs/CONFIGURATION.md', 'docs/DATA-CONTRACT.md', 'docs/TEST-CHECKLIST.md', 'docs/USER-GUIDE.md',
];
const SKIP_DIRS = new Set(['node_modules', '.deploy', '.deploy-aws', 'cdk.out', '.git']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const SELF = fileURLToPath(import.meta.url); // this file names the patterns it looks for
const sourceFiles = () => walk(ROOT).filter((p) => ['.js', '.mjs', '.cjs'].includes(extname(p)) && p !== SELF);

// ── what the code reads ─────────────────────────────────────────────────────

/** Every NAME in process.env.NAME, process.env['NAME'], env.NAME or env['NAME'] (env being process.env passed on). */
export function envVarsInCode(files = sourceFiles()) {
  const re = /\b(?:process\.)?env\s*(?:\.\s*([A-Z][A-Z0-9_]*)\b|\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\])/g;
  const found = new Map();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) {
      const name = m[1] || m[2];
      if (!found.has(name)) found.set(name, relative(ROOT, f));
    }
  }
  return found;
}

/** URL parameters a page reads through URLSearchParams (q / params) or the player's flag(). */
function urlParamsIn(dir) {
  const out = new Set();
  for (const f of walk(join(ROOT, dir)).filter((p) => extname(p) === '.js')) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:q|params)\.(?:get|has)\(\s*['"]([A-Za-z_][\w-]*)['"]/g)) out.add(m[1]);
    for (const m of src.matchAll(/\bflag\(\s*['"]([A-Za-z_][\w-]*)['"]/g)) out.add(m[1]);
  }
  return out;
}

export function queryParamsInCode() {
  const api = read('pharmacy-screen/config-api/src/api.js');
  const service = read('pharmacy-screen/config-api/src/service.js');
  const apiParams = new Set([...api.matchAll(/\bquery\.([A-Za-z_]\w*)/g)].map((m) => m[1]));
  const audit = service.match(/function listAudit\(\{([^}]*)\}/);
  assert.ok(audit, 'listAudit({ … }) found in config-api/src/service.js');
  for (const part of audit[1].split(',')) apiParams.add(part.split('=')[0].trim());
  apiParams.delete('');
  return {
    screen: urlParamsIn('pharmacy-screen/js'),
    admin: urlParamsIn('pharmacy-screen/admin/js'),
    api: apiParams,
  };
}

// ── what the docs say ───────────────────────────────────────────────────────

/** The text of one "## Heading" section (up to the next "## "). */
function section(md, heading) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  assert.ok(start >= 0, `docs/CONFIGURATION.md has a "## ${heading}" section`);
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** "### Heading" subsections of a section: { heading: text }. */
function subsections(text) {
  const out = {};
  let cur = null;
  for (const l of text.split('\n')) {
    const h = l.match(/^### (.+)$/);
    if (h) { cur = h[1].trim(); out[cur] = ''; continue; }
    if (cur) out[cur] += l + '\n';
  }
  return out;
}

/** Names in the first cell of table rows: | `NAME` | … */
const firstCells = (text, re) => [...text.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]).filter((n) => re.test(n));

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const PARAM_NAME = /^[A-Za-z_][\w-]*$/;

function documentedEnv() {
  return firstCells(section(read('docs/CONFIGURATION.md'), 'Environment variables'), ENV_NAME);
}

function documentedParams() {
  const subs = subsections(section(read('docs/CONFIGURATION.md'), 'Query parameters'));
  const pick = (key) => {
    const name = Object.keys(subs).find((k) => k.toLowerCase().startsWith(key));
    assert.ok(name, `docs/CONFIGURATION.md → Query parameters has a "### ${key[0].toUpperCase() + key.slice(1)} …" subsection`);
    return new Set(firstCells(subs[name], PARAM_NAME));
  };
  return { screen: pick('screen'), admin: pick('admin'), api: pick('config api') };
}

function envExampleVars(path) {
  // NAME=value, and commented-out "# NAME=" lines (optional settings shown but not set).
  return [...read(path).matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => ({ name: m[1], value: m[2].trim() }));
}

// ── tests ───────────────────────────────────────────────────────────────────

test('every handover document exists', () => {
  for (const f of HANDOVER) assert.ok(existsSync(join(ROOT, f)), `${f} exists`);
});

test('every environment variable the code reads is documented in docs/CONFIGURATION.md, and vice versa', () => {
  const code = envVarsInCode();
  const docs = documentedEnv();
  assert.ok(code.size > 10, 'the scan found the code\'s environment variables');
  const dupes = docs.filter((n, i) => docs.indexOf(n) !== i);
  assert.deepEqual(dupes, [], 'each variable is listed once');
  const missing = [...code.keys()].filter((n) => !docs.includes(n)).map((n) => `${n} (read in ${code.get(n)})`);
  assert.deepEqual(missing, [], 'read by the code but not in docs/CONFIGURATION.md → Environment variables');
  const unread = docs.filter((n) => !code.has(n));
  assert.deepEqual(unread, [], 'in docs/CONFIGURATION.md → Environment variables but read nowhere in the code');
});

test('every query parameter the code reads is documented in docs/CONFIGURATION.md, and vice versa', () => {
  const code = queryParamsInCode();
  const docs = documentedParams();
  for (const page of ['screen', 'admin', 'api']) {
    const c = [...code[page]].sort(), d = [...docs[page]].sort();
    assert.deepEqual(c.filter((p) => !docs[page].has(p)), [], `${page}: read by the code but not documented`);
    assert.deepEqual(d.filter((p) => !code[page].has(p)), [], `${page}: documented but not read by the code`);
  }
  // The campaign URL's own parameters (the ticket names these).
  for (const p of ['device', 'promo', 'orientation', 'mockapi', 'debug']) assert.ok(code.screen.has(p), `the screen reads ${p}`);
});

test('every variable in .env.example is in docs/CONFIGURATION.md and in the code, with placeholders only', () => {
  const code = envVarsInCode();
  const docs = new Set(documentedEnv());
  for (const path of ['.env.example', 'pharmacy-screen/ph-proxy/.env.example']) {
    const vars = envExampleVars(path);
    assert.ok(vars.length > 5, `${path} lists the settings`);
    for (const { name, value } of vars) {
      assert.ok(docs.has(name), `${path}: ${name} is in docs/CONFIGURATION.md`);
      assert.ok(code.has(name), `${path}: ${name} is read by the code`);
      // No real secret: the token is never an env var, and secret-shaped values stay empty or <placeholders>.
      assert.doesNotMatch(name, /TOKEN$|API_KEY$|PASSWORD|SECRET$/, `${path}: ${name} must not hold a credential`);
      if (/LOCAL_KMS_KEY|ORIGIN_VERIFY/.test(name)) assert.ok(value === '' || /^<.*>$/.test(value), `${path}: ${name} is empty or a <placeholder>`);
    }
    assert.doesNotMatch(read(path), /x-api-key\s*[:=]\s*\S{8,}/i, `${path} holds no PH API key`);
  }
});

test('relative links in the handover documents resolve', () => {
  const broken = [];
  for (const f of HANDOVER.filter((p) => p.endsWith('.md'))) {
    const md = read(f);
    for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      if (!existsSync(join(ROOT, dirname(f), target))) broken.push(`${f} → ${m[1]}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('the template token list in docs/DATA-CONTRACT.md matches TEMPLATE_TOKENS', async () => {
  const { TEMPLATE_TOKENS } = await import('../js/tokens.js');
  const md = read('docs/DATA-CONTRACT.md');
  const all = new Set(Object.values(TEMPLATE_TOKENS).flat());
  for (const t of all) assert.ok(md.includes('`${' + t + '}`'), `DATA-CONTRACT.md lists \${${t}}`);
  for (const t of ['Suburb', 'StoreName', 'CloseTime', 'OpenTime']) assert.ok(md.includes('`${' + t + '}`'), `DATA-CONTRACT.md lists \${${t}}`);
});
