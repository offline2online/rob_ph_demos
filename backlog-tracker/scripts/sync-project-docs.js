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
 *     --interface-file shared/interface-contract.md \
 *     --artifact-url https://claude.ai/artifact/2cc25ZNLFP5AtQk2KmeY98 \
 *     --rename-interface
 *
 * The interface record is matched by which projects it links, not by its name,
 * so a project rename does not silently stop it syncing. --rename-interface
 * also retitles the record from the contract's own H1.
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
  const renameInterface = has('rename-interface');
  const artifactUrl = arg('artifact-url');

  console.log(`repo -> board`);
  console.log(`  project        ${projectName}`);
  console.log(`  README.md      ${readmeMd.length} chars`);
  console.log(`  REQUIREMENTS   ${requirementsMd.length} chars`);
  if (interfaceMd) console.log(`  interface      ${interfaceMd.length} chars`);
  if (artifactUrl) console.log(`  artifactUrl    ${artifactUrl}`);

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

  // --- the interface record --------------------------------------------
  // Matched by PROJECT MEMBERSHIP, not by name. The record's name drifts
  // whenever a project is renamed, so a name match silently finds nothing
  // and the contract quietly stops being synced.
  if (interfaceMd) {
    const ifRes = await fetch(`${BOARD}/interfaces`, { headers: auth });
    const ifBody = await ifRes.json();
    if (!ifRes.ok) throw new Error(`list interfaces: ${ifBody.error?.message}`);
    const mine = (ifBody.documents || []).filter((d) =>
      (d.fields?.projectIds?.arrayValue?.values || []).some((v) => v.stringValue === projectId));

    if (mine.length === 0) {
      console.log(`  interface      no record links this project — create it from the ` +
        `project's Docs page first, then re-run.`);
    } else if (mine.length > 1 && !interfaceName) {
      console.log(`  interface      ${mine.length} records link this project; pass --interface ` +
        `to choose: ` + mine.map((d) => d.fields?.name?.stringValue).join(' | '));
    } else {
      const rec = interfaceName
        ? mine.find((d) => d.fields?.name?.stringValue === interfaceName) || mine[0]
        : mine[0];
      const ifId = rec.name.split('/').pop();
      const currentName = rec.fields?.name?.stringValue || '';
      const fields = {
        contentMd: { stringValue: interfaceMd },
        updatedAt: { timestampValue: new Date().toISOString() },
      };
      let mask = 'updateMask.fieldPaths=contentMd&updateMask.fieldPaths=updatedAt';
      // Take the title from the contract's own H1, so a renamed project does
      // not leave the record advertising the old name forever.
      const h1 = (interfaceMd.match(/^#\s+Interface Contract\s+[—-]\s+(.+)$/m) || [])[1];
      if (renameInterface && h1 && h1.trim() !== currentName) {
        fields.name = { stringValue: h1.trim() };
        mask += '&updateMask.fieldPaths=name';
        console.log(`  interface      renaming "${currentName}" -> "${h1.trim()}"`);
      } else if (h1 && h1.trim() !== currentName) {
        console.log(`  interface      name is "${currentName}", contract says "${h1.trim()}" ` +
          `— pass --rename-interface to update it`);
      }
      const r = await fetch(`${BOARD}/interfaces/${ifId}?${mask}`,
        { method: 'PATCH', headers: auth, body: JSON.stringify({ fields }) });
      if (!r.ok) throw new Error(`patch interface: ${(await r.json()).error?.message}`);
      console.log(`  interface      written (${ifId})`);
    }
  }

  // --- the project's artifact link --------------------------------------
  if (artifactUrl) {
    const r = await fetch(`${BOARD}/projects/${projectId}?updateMask.fieldPaths=artifactUrl`,
      { method: 'PATCH', headers: auth,
        body: JSON.stringify({ fields: { artifactUrl: { stringValue: artifactUrl } } }) });
    if (!r.ok) throw new Error(`patch artifactUrl: ${(await r.json()).error?.message}`);
    console.log('  artifactUrl    written');
  }

  console.log('\ndone');
}

main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(1); });
