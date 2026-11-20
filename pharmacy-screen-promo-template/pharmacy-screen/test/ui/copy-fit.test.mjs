// Copy-fit audit as a test: every seeded pharmacy x promotion x scene (every occasion of the Occasions promotion),
// portrait and landscape, at each "Open today"
// bar state, rendered headlessly; fails if any headline or content line leaves the brand panel or content area
// (tools/overflow-audit.mjs, the port of the prototype's audit). A self-test proves an over-long headline fails and
// that the failure names the scene.
//   npm run test:ui   (uses the sandbox's preinstalled Playwright/Chromium; CHROMIUM_PATH for another binary)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runAudit, DEVICES } from '../../tools/overflow-audit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/config.json'), 'utf8'));
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/fixtures/pharmacies.json'), 'utf8'));
const copy = (d) => JSON.parse(JSON.stringify(d));

let browser;
before(async () => { browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); });
after(async () => { await browser.close(); });

test('every seeded pharmacy x promotion x scene fits, in portrait and landscape', async () => {
  const r = await runAudit({ browser });
  assert.deepEqual(r.failures, [], r.failures.join('\n'));
  // At least the prototype's 130 scenes, and every seeded store x default promotion x orientation covered.
  assert.ok(r.checked >= 130, `only ${r.checked} scenes`);
  const seeded = (Array.isArray(SEED) ? SEED : SEED.pharmacies || []).map((p) => p.storeCode);
  assert.equal(seeded.length, 5);
  for (const store of seeded) {
    for (const promo of ['morning', 'afternoon', 'closed']) {
      for (const orientation of ['portrait', 'landscape']) {
        assert.ok(r.scenes.some((s) => s.store === store && s.promo === promo && s.orientation === orientation), `${store} ${promo} ${orientation} not audited`);
      }
    }
  }
  // Occasions: every occasion, for every seeded store and orientation (and the no-suburb store), all three scenes.
  const OCC = ['christmas', 'new-year', 'australia-day', 'valentines-day', 'easter', 'anzac-day'];
  for (const device of [...seeded.map((c) => 'DEVICE-' + c), 'TEST-NO-SUBURB']) {
    for (const occasion of OCC) {
      for (const orientation of ['portrait', 'landscape']) {
        const n = r.scenes.filter((s) => s.device === device && s.promo === 'occasions' && s.occasion === occasion && s.orientation === orientation && s.bar === 'open').length;
        assert.equal(n, 3, `${device} occasions/${occasion} ${orientation}: ${n} scenes audited`);
      }
    }
  }
  assert.ok(DEVICES.includes('TEST-NO-SUBURB') && DEVICES.includes('TEST-LATE-NIGHT'), 'the edge-case fixtures are audited too');
  // Every bar state is exercised on the promotion templates.
  assert.deepEqual([...new Set(r.scenes.filter((s) => s.promo === 'morning').map((s) => s.bar))].sort(), ['before', 'closed', 'closing', 'open']);
});

test('a headline too long to fit fails the audit and names the scene', async () => {
  const cfg = copy(CONFIG);
  const ph = cfg.pharmacies.find((p) => p.storeCode === 'VIC-MP-001');
  ph.content.morning.slots[0].title = 'Blood pressure checks, '.repeat(12).trim();
  const r = await runAudit({ browser, config: cfg, devices: ['DEVICE-VIC-MP-001'], orientations: ['portrait'], times: { open: 'wed-12:00' } });
  assert.ok(r.failures.length >= 1, 'the over-long headline was not caught');
  for (const f of r.failures) assert.match(f, /^DEVICE-VIC-MP-001 VIC-MP-001 morning portrait scene \d+ \(.+\) bar=open: headline leaves the brand panel/);
  const named = new Set(r.failures.map((f) => /scene (\d+)/.exec(f)[1]));
  assert.equal(named.size, 1, 'exactly one scene is named: ' + r.failures.join(' | '));
  // A long hyphenated word is not a failure: auto-fit wraps and shrinks it.
  const ok = copy(CONFIG);
  ok.pharmacies.find((p) => p.storeCode === 'VIC-MP-001').content.morning.slots[0].title = 'Blood-pressure-and-cholesterol checks';
  const r2 = await runAudit({ browser, config: ok, devices: ['DEVICE-VIC-MP-001'], orientations: ['portrait'], times: { open: 'wed-12:00' } });
  assert.deepEqual(r2.failures, []);
});
