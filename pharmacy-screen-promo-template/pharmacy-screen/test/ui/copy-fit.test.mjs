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
import { serve } from '../../tools/serve.mjs';

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
  // Occasions: every occasion, for every seeded store and orientation (and the no-suburb store), every beat
  // (Christmas has two, the others three).
  const OCC = ['christmas', 'new-year', 'australia-day', 'valentines-day', 'easter', 'anzac-day'];
  for (const device of [...seeded.map((c) => 'DEVICE-' + c), 'TEST-NO-SUBURB']) {
    for (const occasion of OCC) {
      for (const orientation of ['portrait', 'landscape']) {
        const n = r.scenes.filter((s) => s.device === device && s.promo === 'occasions' && s.occasion === occasion && s.orientation === orientation && s.bar === 'open').length;
        assert.equal(n, occasion === 'christmas' ? 2 : 3, `${device} occasions/${occasion} ${orientation}: ${n} scenes audited`);
      }
    }
  }
  assert.ok(DEVICES.includes('TEST-NO-SUBURB') && DEVICES.includes('TEST-LATE-NIGHT'), 'the edge-case fixtures are audited too');
  // Every bar state is exercised on the promotion templates.
  assert.deepEqual([...new Set(r.scenes.filter((s) => s.promo === 'morning').map((s) => s.bar))].sort(), ['before', 'closed', 'closing', 'open']);
});

test('occasion copy is shrunk to its text box; copy that cannot fit fails the audit and names the beat', async () => {
  // A long line on Easter: auto-fit shrinks it into the text box, so it passes.
  const ok = copy(CONFIG);
  const occ = ok.pharmacies.find((p) => p.storeCode === 'VIC-MP-001').content.occasions.occasions;
  occ.easter = { beats: [{ text: 'Happy Easter to everyone in ${Suburb} and the surrounding neighbourhoods' }, { text: 'Wishing you a restful long weekend' }, { text: 'Take time to recharge' }] };
  ok.promotions.find((p) => p.id === 'occasions').template = 't_occ_easter';
  const r = await runAudit({ browser, config: ok, devices: ['DEVICE-VIC-MP-001'], orientations: ['portrait', 'landscape'], times: { open: 'wed-12:00' } });
  assert.deepEqual(r.failures, []);
  // Far too much copy for any size: the beat is named.
  const bad = copy(ok);
  bad.pharmacies.find((p) => p.storeCode === 'VIC-MP-001').content.occasions.occasions.easter.beats[1].text = 'Wishing you a restful long weekend, '.repeat(20).trim();
  const r2 = await runAudit({ browser, config: bad, devices: ['DEVICE-VIC-MP-001'], orientations: ['portrait'], times: { open: 'wed-12:00' } });
  const occFails = r2.failures.filter((f) => / occasions\/easter /.test(f));
  assert.ok(occFails.length >= 1, 'the over-long beat was not caught: ' + r2.failures.join(' | '));
  for (const f of occFails) assert.match(f, /^DEVICE-VIC-MP-001 VIC-MP-001 occasions\/easter portrait scene 2 \(Beat 2\) bar=open: ".+" leaves the text box/);
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

test('landscape: the headline is centred in the brand panel and large (Morning, Afternoon, Closed)', async () => {
  // The panel's straight-sided part is 580px wide (js/fit-text.js geom()); its arrow tip is at y=480 (y=540 on Closed).
  const server = await serve(0);
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/pharmacy-screen.html?mockapi=1&device=DEVICE-VIC-MP-001&orientation=landscape&scene=0&now=wed-12:00`);
    await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready);
    await page.evaluate(() => document.fonts.ready);
    for (const [promo, tipY] of [['morning', 480], ['afternoon', 480], ['closed', 540]]) {
      const n = (await page.evaluate((p) => window.pharmacyScreen.show(p, 0), promo)).scenes.length;
      for (let i = 0; i < n; i++) {
        const m = await page.evaluate(async ([p, s]) => {
          window.pharmacyScreen.show(p, s);
          await window.pharmacyScreen.settled();
          const el = document.querySelector('.screen'), head = el.querySelector('.s-head');
          const sr = el.getBoundingClientRect(), sc = sr.width / 1920, rg = document.createRange();
          const lines = [];
          for (const node of head.querySelectorAll('h2,p')) {
            rg.selectNodeContents(node);
            for (const r of rg.getClientRects()) if (r.width >= 1) lines.push({ l: (r.left - sr.left) / sc, r: (r.right - sr.left) / sc, t: (r.top - sr.top) / sc, b: (r.bottom - sr.top) / sc });
          }
          const logo = el.querySelector('.s-logo img, .s-logo .s-mark'), lr = logo && logo.getBoundingClientRect();
          return {
            lines, h2: parseFloat(getComputedStyle(head.querySelector('h2')).fontSize), align: getComputedStyle(head).textAlign,
            logoMid: lr ? ((lr.left + lr.right) / 2 - sr.left) / sc : null,
          };
        }, [promo, i]);
        const at = `${promo} scene ${i + 1}`;
        assert.equal(m.align, 'center', `${at}: headline is not centre-aligned`);
        assert.ok(m.lines.length >= 1, `${at}: no headline lines`);
        // every line sits symmetrically about the panel's centre line (x=290) and inside the panel
        for (const ln of m.lines) {
          assert.ok(Math.abs((ln.l + ln.r) / 2 - 290) <= 3, `${at}: a headline line is centred on x=${Math.round((ln.l + ln.r) / 2)}, not 290`);
          assert.ok(ln.l >= 23 && ln.r <= 557, `${at}: a headline line leaves the panel (${Math.round(ln.l)}-${Math.round(ln.r)})`);
        }
        // the block is level with the arrow's point
        const mid = (Math.min(...m.lines.map((ln) => ln.t)) + Math.max(...m.lines.map((ln) => ln.b))) / 2;
        assert.ok(Math.abs(mid - tipY) <= 20, `${at}: headline block is centred on y=${Math.round(mid)}, not ${tipY}`);
        // larger than the 84px it was: 96px, less only where auto-fit shrinks a wide line
        assert.ok(m.h2 > 84 && m.h2 <= 96.5, `${at}: headline is ${m.h2.toFixed(1)}px`);
        if (m.logoMid != null) assert.ok(Math.abs(m.logoMid - 290) <= 3, `${at}: logo is centred on x=${Math.round(m.logoMid)}, not 290`);
      }
    }
  } finally {
    await ctx.close();
    server.close();
  }
});
