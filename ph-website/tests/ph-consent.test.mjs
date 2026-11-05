// Chromium test for PH Consent (consent.js + the real <head> defaults). No network: the page is served through route().
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('ph-consent.test.mjs: playwright not installed; skipping'); process.exit(0); }
const exe = ['/opt/pw-browsers/chromium', process.env.CHROME_BIN].find((p) => p && existsSync(p));
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.error('FAIL: ' + m); } };
const head = execFileSync('php', [join(here, 'ph-consent-head.php')], { encoding: 'utf8' });
const js = readFileSync(join(here, '../snippets/ph-consent/consent.js'), 'utf8');
const css = readFileSync(join(here, '../snippets/ph-consent/consent.css'), 'utf8');
/* a Hello-style theme reset that loads AFTER the snippet's CSS (as on the live site) and tries to restyle buttons and links */
const reset = 'button,[type=button]{background:transparent;border:1px solid #c36;color:#c36;border-radius:3px;text-transform:none}[type=button]:hover,[type=button]:focus{background-color:#c36;color:#fff}a{text-transform:capitalize;color:#c36}a:hover{color:#c36}';
const page = `<!doctype html><html><head><meta charset="utf-8">${head}<style>${css}</style><style>${reset}</style></head><body><main>Hello</main>
<script type="text/plain" data-ph-category="marketing">window.__mk=(window.__mk||0)+1</script>
<footer class="elementor-location-footer"><div class="row"><p class="copy" style="font-size:13px;color:rgb(90,90,90)">© Personalisation Hub 2026</p></div></footer></body></html>`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36';
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });

async function open(search = '', { trace = 'loc=DE', ctx } = {}) {
  const context = ctx || await browser.newContext({ userAgent: UA });
  const p = await context.newPage();
  const logs = []; p.logs = logs;
  await p.route('https://example.test/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/cdn-cgi/trace') return trace === 'fail' ? r.abort() : r.fulfill({ body: `fl=1\n${trace}\nts=1\n` });
    if (u.pathname === '/consent.js') return r.fulfill({ contentType: 'text/javascript', body: js });
    if (u.pathname.startsWith('/wp-json/')) { logs.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 201, body: '{"ok":true}', contentType: 'application/json' }); }
    return r.fulfill({ contentType: 'text/html', body: page.replace('</body>', '<script src="/consent.js" defer></script></body>') });
  });
  await p.goto('https://example.test/' + search);
  return p;
}
const consentCalls = (p) => p.evaluate(() => dataLayer.map((a) => [...a]).filter((a) => a[0] === 'consent'));
const bar = (p) => p.locator('.ph-cc');

// 1. EU visitor (override DE): bar shows, defaults denied, nothing granted
let p = await open('?ph_region=DE');
await bar(p).waitFor();
let calls = await consentCalls(p);
ok(calls[0][1] === 'default' && calls[0][2].analytics_storage === 'denied' && calls[0][2].ad_storage === 'denied' && calls[0][2].region.includes('DE'), 'EU default is denied via region');
ok(calls.some((c) => c[1] === 'update' && c[2].analytics_storage === 'denied'), 'EU explicit update keeps it denied');
ok(!calls.some((c) => c[1] === 'update' && c[2].analytics_storage === 'granted'), 'EU grants nothing before a choice');
const btns = await p.locator('.ph-cc-b').allTextContents();
ok(btns.join() === 'Accept all,Reject all', 'Accept all and Reject all are both there');
const [wa, wr] = await p.locator('.ph-cc-b').evaluateAll((e) => e.map((x) => [x.offsetWidth, x.offsetHeight, getComputedStyle(x).backgroundColor, getComputedStyle(x).fontSize].join()));
ok(wa === wr, 'Accept and Reject have identical size and colour');
ok(await bar(p).evaluate((e) => getComputedStyle(e).position) === 'fixed', 'bar is a fixed overlay (no layout shift)');
ok((await p.evaluate(() => document.cookie)).includes('ph_consent') === false, 'no cookie before a choice');
ok(await p.locator('.ph-cc-fl').count() === 1, 'footer Cookie settings link added');
ok(await p.evaluate(() => window.phConsent.has('marketing')) === false, 'phConsent.has(marketing) false');
ok(await p.evaluate(() => window.__mk || 0) === 0, 'marketing script not run before consent');

// 1b. the theme reset must not win: buttons navy and identical, Preferences a plain link, no capitalised links
const sty = (sel, f) => p.locator(sel).first().evaluate((e, f) => { const c = getComputedStyle(e); return f.map((k) => c[k]).join('|'); }, f);
const bstyle = ['backgroundColor', 'color', 'borderTopWidth', 'borderTopColor', 'textTransform'];
ok(await sty('.ph-cc-b', bstyle) === 'rgb(28, 37, 64)|rgb(255, 255, 255)|2px|rgb(28, 37, 64)|none', 'Accept is navy filled with a 2px navy border despite the theme');
ok(await sty('.ph-cc-b >> nth=1', bstyle) === await sty('.ph-cc-b', bstyle), 'Reject looks identical to Accept');
await p.locator('.ph-cc-b').first().hover();
const hov = await sty('.ph-cc-b', ['backgroundColor', 'color']);
ok(hov !== 'rgb(204, 51, 102)|rgb(255, 255, 255)' && !hov.startsWith('rgb(204, 51, 102)') && hov.endsWith('rgb(255, 255, 255)'), 'hover is a darker navy, never pink');
await p.locator('.ph-cc-b').first().focus();
ok((await sty('.ph-cc-b', ['backgroundColor'])) !== 'rgb(204, 51, 102)', 'focus is never pink');
const lstyle = ['backgroundColor', 'color', 'borderTopWidth', 'textDecorationLine', 'textTransform'];
const lexp = 'rgba(0, 0, 0, 0)|rgb(15, 122, 154)|0px|underline|none';
ok(await sty('.ph-cc-l', lstyle) === lexp, 'Preferences is a plain underlined #0F7A9A link-button');
await p.locator('.ph-cc-l').hover();
ok(await sty('.ph-cc-l', lstyle) === lexp, 'Preferences keeps that on hover');
await p.locator('.ph-cc-l').focus();
ok(await sty('.ph-cc-l', lstyle) === lexp, 'Preferences keeps that on focus');
ok(await sty('.ph-cc p a', ['textTransform', 'color']) === 'none|rgb(15, 122, 154)', 'Cookie policy link is not capitalised or pink');
const fl = await p.locator('.ph-cc-fl').evaluate((e) => ({ t: getComputedStyle(e).textTransform, fs: getComputedStyle(e).fontSize, c: getComputedStyle(e).color, ps: getComputedStyle(e.parentNode).fontSize, pc: getComputedStyle(e.parentNode).color, par: e.parentNode.className, prev: e.previousSibling.nodeValue, u: getComputedStyle(e).textDecorationLine }));
ok(fl.t === 'none' && fl.fs === fl.ps && fl.c === fl.pc && fl.u === 'underline', 'footer link: not capitalised, copyright size and colour, underlined');
ok(fl.par === 'copy' && fl.prev === ' \u00b7 ', 'footer link sits inline in the copyright row after " · "');

// 2. Reject all: one click, bar closes, logged
await p.getByRole('button', { name: 'Reject all' }).click();
await p.waitForTimeout(100);
ok(await bar(p).count() === 0, 'bar closes on Reject');
ok(p.logs.length === 1 && p.logs[0].a === false && p.logs[0].m === false && p.logs[0].action === 'reject' && p.logs[0].region === 'DE' && /^[a-f0-9]{24}$/.test(p.logs[0].id), 'reject logged with id, region and choices');
ok(!('ip' in p.logs[0]) && !('ua' in p.logs[0]), 'log carries no IP or user agent');
ok(await p.evaluate(() => window.__mk || 0) === 0, 'marketing script still not run after Reject');
const ctx2 = p.context();
await p.close();
// a repeat visit does not ask again
p = await open('?ph_region=DE', { ctx: ctx2 });
await p.waitForTimeout(300);
ok(await bar(p).count() === 0, 'stored choice: no banner on the next visit');
calls = await consentCalls(p);
ok(calls.some((c) => c[1] === 'update' && c[2].analytics_storage === 'denied'), 'stored Reject re-applied');
await ctx2.close();

// 3. Accept all
p = await open('?ph_region=FR');
await bar(p).waitFor();
await p.getByRole('button', { name: 'Accept all' }).click();
await p.waitForTimeout(100);
calls = await consentCalls(p);
ok(calls.some((c) => c[1] === 'update' && c[2].analytics_storage === 'granted' && c[2].ad_storage === 'granted' && c[2].ad_user_data === 'granted' && c[2].ad_personalization === 'granted'), 'Accept grants all four signals');
ok(await p.evaluate(() => window.phConsent.has('analytics') && window.phConsent.has('marketing')), 'phConsent.has true after Accept');
ok(await p.evaluate(() => window.__mk || 0) === 1, 'text/plain marketing script activated once consent is given');
ok(/ph_consent=v=[^&]+&id=[a-f0-9]+&a=1&m=1&d=0/.test(await p.evaluate(() => document.cookie)), 'consent cookie holds the choice');

// 4. footer link reopens Preferences; changing a category updates and logs again
let events = await p.evaluate(() => { window.__ev = []; document.addEventListener('ph:consent', (e) => window.__ev.push(e.detail)); return 0; });
await p.locator('.ph-cc-fl').click();
await bar(p).waitFor();
ok(await p.locator('.ph-cc-pn input[name=analytics]').isChecked() && await p.locator('.ph-cc-pn input[name=marketing]').isChecked(), 'Preferences reflects the stored choice');
ok(await p.evaluate(() => document.activeElement && document.activeElement.name) === 'analytics', 'focus moves into the panel');
await p.locator('input[name=marketing]').uncheck();
await p.getByRole('button', { name: 'Save preferences' }).click();
await p.waitForTimeout(100);
ok(p.logs.length === 2 && p.logs[1].a === true && p.logs[1].m === false && p.logs[1].action === 'save', 'second choice logged');
ok(await p.evaluate(() => window.__ev.length === 1 && window.__ev[0].marketing === false), 'ph:consent fired with the new choice');
calls = await consentCalls(p);
ok(calls.at(-1)[2].ad_storage === 'denied' && calls.at(-1)[2].analytics_storage === 'granted', 'withdrawing marketing updates Consent Mode');
await p.context().close();

// 4b. a fresh EU panel: nothing pre-ticked, Escape returns to the bar
p = await open('?ph_region=IE');
await bar(p).waitFor();
await p.getByRole('button', { name: 'Preferences' }).click();
ok(!(await p.locator('input[name=analytics]').isChecked()) && !(await p.locator('input[name=marketing]').isChecked()), 'nothing pre-ticked');
ok(await p.locator('input[disabled]').isChecked(), 'necessary shown on and fixed');
await p.keyboard.press('Escape');
ok(await p.locator('.ph-cc-pn').count() === 0 && await bar(p).count() === 1, 'Escape closes the panel, bar stays when undecided');
ok(await bar(p).getAttribute('aria-label') === 'Cookies', 'bar has an accessible name');
await p.context().close();

// 5. non-EU (AU): lighter notice, analytics granted by default, Preferences can opt out
p = await open('?ph_region=AU');
await bar(p).waitFor();
ok(await p.locator('.ph-cc-b').allTextContents().then((t) => t.join()) === 'OK', 'lighter notice has a single OK');
calls = await consentCalls(p);
ok(calls[1][1] === 'default' && calls[1][2].analytics_storage === 'granted', 'non-EU default is granted');
ok(calls.some((c) => c[1] === 'update' && c[2].analytics_storage === 'granted'), 'non-EU update granted');
await p.getByRole('button', { name: 'Preferences' }).click();
await p.locator('input[name=analytics]').uncheck();
await p.locator('input[name=marketing]').uncheck();
await p.getByRole('button', { name: 'Save preferences' }).click();
await p.waitForTimeout(100);
calls = await consentCalls(p);
ok(calls.at(-1)[2].analytics_storage === 'denied' && p.logs.at(-1).region === 'AU' && p.logs.at(-1).a === false, 'AU visitor can opt out; logged');
await p.context().close();

// 6. geo lookups: Cloudflare trace, cached; failure = EU
p = await open('', { trace: 'loc=DE' });
await bar(p).waitFor();
ok(await p.locator('.ph-cc-b').count() === 2, 'trace DE = full banner');
ok(JSON.parse(await p.evaluate(() => localStorage.getItem('ph_geo'))).l === 'DE', 'country cached on the device');
await p.context().close();
p = await open('', { trace: 'loc=AU' });
await bar(p).waitFor();
ok(await p.locator('.ph-cc-b').count() === 1, 'trace AU = lighter notice');
await p.context().close();
p = await open('', { trace: 'fail' });
await bar(p).waitFor({ timeout: 6000 });
ok(await p.locator('.ph-cc-b').count() === 2, 'failed lookup = treated as EU');
await p.context().close();

// 7. bots get no banner
const bot = await browser.newContext({ userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.0)' });
p = await open('?ph_region=DE', { ctx: bot });
await p.waitForTimeout(400);
ok(await bar(p).count() === 0, 'no banner for a known bot');
await bot.close();

await browser.close();
console.log(`ph-consent.test.mjs: ${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
