// Overflow audit (copy fit): renders every store x promotion x scene x orientation from the fixtures in headless
// Chromium (an occasion promotion once per occasion: Christmas, New Year's, Australia Day, Valentine's Day, Easter,
// Anzac Day, each beat held with this store's copy for it, once its fonts are in), at each "Open today" bar state,
// and fails if any copy leaves the brand panel, its content box, an occasion's text box or the screen.
// Usage: node tools/overflow-audit.mjs   (exit 1 on any problem)
// Uses the sandbox's preinstalled Playwright/Chromium; set CHROMIUM_PATH to use another browser binary.
//
// Also a module: runAudit() is what test/ui/copy-fit.test.mjs runs, with a changed config to prove a headline that
// is too long fails and is named.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every fixture device except TEST (a copy of Beaumaris): the five launch stores, TEST-NO-SUBURB, TEST-LATE-NIGHT. */
export const DEVICES = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/campaign-data.json'), 'utf8')).devices).filter((d) => d !== 'TEST');
export const ORIENTATIONS = ['portrait', 'landscape'];
/** One store-local time per bar state for the fixture hours (weekday 08:30-19:00 at most stores). */
export const TIMES = { open: 'wed-12:00', closing: 'wed-18:45', before: 'wed-07:00', closed: 'wed-22:00' };

/**
 * Runs the audit. Returns { checked, scenes: [{device, store, promo, occasion, orientation, scene, name, bar}], failures: [string] }.
 * Each failure names the device, store, promo, orientation, scene number (and name) and bar state.
 *   config   - optional replacement for fixtures/config.json (the screen reads it with mockapi=1)
 *   browser  - optional Playwright browser to reuse (left open); otherwise one is launched and closed
 */
export async function runAudit({ devices = DEVICES, orientations = ORIENTATIONS, times = TIMES, config = null, browser = null } = {}) {
  const server = await serve(0);
  const base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
  const own = !browser;
  if (own) {
    const { chromium } = require('playwright');
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  }
  const scenes = [];
  const failures = [];
  try {
    for (const orientation of orientations) {
      const ctx = await browser.newContext({ viewport: orientation === 'landscape' ? { width: 960, height: 540 } : { width: 540, height: 960 } });
      if (config) {
        const body = JSON.stringify(config);
        await ctx.route('**/fixtures/config.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));
      }
      const page = await ctx.newPage();
      page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
      for (const device of devices) {
        for (const [label, now] of Object.entries(times)) {
          await page.goto(`${base}?mockapi=1&device=${device}&orientation=${orientation}&scene=0&now=${now}`);
          await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready);
          await page.evaluate(() => document.fonts.ready);
          const promos = await page.evaluate(() => window.pharmacyScreen.promotions());
          for (const promo of promos) {
            const info = await page.evaluate((p) => window.pharmacyScreen.show(p, 0), promo);
            if (label !== 'open' && info.base === 'hours') continue; // no bar on the hours template
            const occasions = info.base === 'occasion' ? await page.evaluate(() => window.pharmacyScreen.occasions()) : [null];
            for (const occasion of occasions) {
              const nScenes = occasion ? (await page.evaluate(([p, o]) => window.pharmacyScreen.show(p, 0, o), [promo, occasion])).scenes.length : info.scenes.length;
              const tag = occasion ? `${promo}/${occasion}` : promo;
              for (let i = 0; i < nScenes; i++) {
                const r = await page.evaluate(async ([p, n, o]) => { const inf = window.pharmacyScreen.show(p, n, o || undefined); await window.pharmacyScreen.settled(); return { inf, problems: window.pharmacyScreen.audit() }; }, [promo, i, occasion]);
                scenes.push({ device, store: r.inf.store, promo, occasion: r.inf.occasion, orientation, scene: i + 1, name: r.inf.scenes[i], bar: label });
                for (const pr of r.problems) failures.push(`${device} ${r.inf.store} ${tag} ${orientation} scene ${i + 1} (${r.inf.scenes[i]}) bar=${label}: ${pr}`);
              }
            }
          }
        }
      }
      await ctx.close();
    }
  } finally {
    if (own) await browser.close();
    server.close();
  }
  return { checked: scenes.length, scenes, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { checked, failures } = await runAudit();
  if (failures.length) {
    console.error(`Overflow audit: ${failures.length} problem(s) in ${checked} scenes\n` + failures.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  }
  console.log(`Overflow audit: ${checked} scenes checked, no copy outside the panel.`);
}
