// Overflow audit: renders every store x promotion x scene x orientation from the fixtures in headless
// Chromium, at each "Open today" bar state, and fails if any copy leaves the brand panel, its content box
// or the screen. Usage: node tools/overflow-audit.mjs   (exit 1 on any problem)
// Uses the sandbox's preinstalled Playwright/Chromium; set CHROMIUM_PATH to use another browser binary.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devices = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/campaign-data.json'), 'utf8')).devices).filter((d) => d !== 'TEST');
// one store-local time per bar state for the fixture hours (weekday 08:30-19:00 at most stores)
const TIMES = { open: 'wed-12:00', closing: 'wed-18:45', before: 'wed-07:00', closed: 'wed-22:00' };

const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/pharmacy-screen.html`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let checked = 0;
const failures = [];
try {
  for (const orientation of ['portrait', 'landscape']) {
    const page = await browser.newPage({ viewport: orientation === 'landscape' ? { width: 960, height: 540 } : { width: 540, height: 960 } });
    page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
    for (const device of devices) {
      for (const [label, now] of Object.entries(TIMES)) {
        await page.goto(`${base}?device=${device}&orientation=${orientation}&scene=0&now=${now}`);
        await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready);
        await page.evaluate(() => document.fonts.ready);
        const promos = await page.evaluate(() => window.pharmacyScreen.promotions());
        for (const promo of promos) {
          const info = await page.evaluate((p) => window.pharmacyScreen.show(p, 0), promo);
          if (label !== 'open' && info.base === 'hours') continue; // no bar on the hours template
          for (let i = 0; i < info.scenes.length; i++) {
            const r = await page.evaluate(([p, n]) => { const inf = window.pharmacyScreen.show(p, n); return { inf, problems: window.pharmacyScreen.audit() }; }, [promo, i]);
            checked++;
            for (const pr of r.problems) failures.push(`${device} ${r.inf.store} ${promo} ${orientation} scene ${i + 1} (${r.inf.scenes[i]}) bar=${label}: ${pr}`);
          }
        }
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`Overflow audit: ${failures.length} problem(s) in ${checked} scenes\n` + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(`Overflow audit: ${checked} scenes checked, no copy outside the panel.`);
