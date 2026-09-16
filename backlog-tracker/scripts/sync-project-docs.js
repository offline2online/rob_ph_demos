#!/usr/bin/env node
/**
 * Push a project's repo docs up to its board Docs page.
 *
 *   readmeMd        <- <project folder>/README.md
 *   requirementsMd  <- <project folder>/REQUIREMENTS.md
 *   interfaces/*    <- shared/interface-contract.md (matched by name)
 *
 * The repo file and the Firestore field are meant to be identical; this is the
 * direction that fixes a stale board. It never reads the board back into the
 * repo — do that by hand if the board is the fresher side.
 *
 *   BOARD_API_KEY=... node backlog-tracker/scripts/sync-project-docs.js \
 *     --project "Display Types & DSP Integration" \
 *     --folder display-types-dsp-integration \
 *     --interface "Live Visitor Profile ↔ Display Types" \
 *     --interface-file shared/interface-contract.md
 *
 * --dry-run prints exactly what would change and writes nothing.
 */

const fs = require('fs');
const path = require('path');

const FIREBASE_API_KEY = 'AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g';
const PROJECT_ID = 'backlog-tracker-e4ed2';
const BOARD = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTOMATION_EMAIL = 'board-automation@backlog-tracker-e4ed2.firebaseapp.com';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

const REPO = path.resolve(__dirname, '../..');
const dryRun = has('dry-run');

async function signIn(password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: AUTOMATION_EMAIL, password, returnSecureToken: true }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed: ${body.error?.message || res.status}`);
  return body.idToken;
}

const read = (rel) => {
  const f = path.join(REPO, rel);
  if (!fs.existsSync(f)) throw new Error(`missing file: ${rel}`);
  return fs.readFileSync(f, 'utf8');
};

async function main() {
  const projectName = arg('project');
  const folder = arg('folder');
  if (!projectName || !folder) throw new Error('--project and --folder are required');

  const readmeMd = read(`${folder}/README.md`);
  const requirementsMd = read(`${folder}/REQUIREMENTS.md`);
  const interfaceName = arg('interface');
  const interfaceMd = arg('interface-file') ? read(arg('interface-file')) : null;

  console.log(`repo -> board`);
  console.log(`  project        ${projectName}`);
  console.log(`  README.md      ${readmeMd.length} chars`);
  console.log(`  REQUIREMENTS   ${requirementsMd.length} chars`);
  if (interfaceMd) console.log(`  interface      ${interfaceName} (${interfaceMd.length} chars)`);

  const password = process.env.BOARD_API_KEY;
  if (!password) throw new Error('BOARD_API_KEY is not set — it is the board automation user password');

  const idToken = await signIn(password);
  const auth = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };

  // --- find the project doc by name -------------------------------------
  const projRes = await fetch(`${BOARD}/projects`, { headers: auth });
  const projBody = await projRes.json();
  if (!projRes.ok) throw new Error(`list projects: ${projBody.error?.message || projRes.status}`);
  const docs = projBody.documents || [];
  const match = docs.find((d) => d.fields?.name?.stringValue === projectName);
  if (!match) {
    throw new Error(`no project named "${projectName}". Found: ` +
      docs.map((d) => d.fields?.name?.stringValue).join(', '));
  }
  const projectId = match.name.split('/').pop();
  console.log(`  projectId      ${projectId}`);

  const before = {
    readmeMd: match.fields?.readmeMd?.stringValue || '',
    requirementsMd: match.fields?.requirementsMd?.stringValue || '',
  };
  const changed = (k, next) => (before[k] === next ? 'unchanged' : `${before[k].length} -> ${next.length}`);
  console.log(`  readmeMd       ${changed('readmeMd', readmeMd)}`);
  console.log(`  requirementsMd ${changed('requirementsMd', requirementsMd)}`);

  if (dryRun) { console.log('\n--dry-run: nothing written'); return; }

  // --- write the two doc fields in one PATCH ----------------------------
  const mask = 'updateMask.fieldPaths=readmeMd&updateMask.fieldPaths=requirementsMd';
  const patch = await fetch(`${BOARD}/projects/${projectId}?${mask}`, {
    method: 'PATCH', headers: auth,
    body: JSON.stringify({ fields: {
      readmeMd: { stringValue: readmeMd },
      requirementsMd: { stringValue: requirementsMd },
    } }),
  });
  if (!patch.ok) throw new Error(`patch project: ${(await patch.json()).error?.message}`);
  console.log('  project docs   written');

  // --- the interface record, matched by name ----------------------------
  if (interfaceMd && interfaceName) {
    const ifRes = await fetch(`${BOARD}/interfaces`, { headers: auth });
    const ifBody = await ifRes.json();
    if (!ifRes.ok) throw new Error(`list interfaces: ${ifBody.error?.message}`);
    const rec = (ifBody.documents || []).find((d) => d.fields?.name?.stringValue === interfaceName);
    if (!rec) {
      console.log(`  interface      no record named "${interfaceName}" — create it from the ` +
        `project's Docs page first, then re-run. Existing: ` +
        ((ifBody.documents || []).map((d) => d.fields?.name?.stringValue).join(', ') || 'none'));
    } else {
      const ifId = rec.name.split('/').pop();
      const r = await fetch(
        `${BOARD}/interfaces/${ifId}?updateMask.fieldPaths=contentMd&updateMask.fieldPaths=updatedAt`,
        { method: 'PATCH', headers: auth,
          body: JSON.stringify({ fields: {
            contentMd: { stringValue: interfaceMd },
            updatedAt: { timestampValue: new Date().toISOString() },
          } }) });
      if (!r.ok) throw new Error(`patch interface: ${(await r.json()).error?.message}`);
      console.log(`  interface      written (${ifId})`);
    }
  }

  console.log('\ndone');
}

main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(1); });
