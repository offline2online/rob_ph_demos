// Renders each slide at its settled moment and checks: type fitted (lines and size), the slide
// inside the safe area (below the logo, above y 1270, inside the side margins), the wipe gone,
// and the logo matching the surface. Writes one PNG per slide to the output folder.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [file, outDir] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve(file) + '?render');
  await page.evaluate(() => document.fonts.ready);
  const scenes = await page.evaluate(() => window.SCENES);
  const problems = [];
  for (const [i, s] of scenes.entries()) {
    const last = i === scenes.length - 1;
    const t = last ? s.start + 2.6 : s.end - 0.4;
    await page.evaluate((t) => window.renderAt(t), t);
    await page.screenshot({ path: `${outDir}/${s.id}.png` });
    const m = await page.evaluate((id) => {
      const sc = document.getElementById(id);
      const rs = [...sc.querySelectorAll('.ln .li, .rule, .loop, .cta')].map((e) => e.getBoundingClientRect());
      const r = { top: Math.min(...rs.map((x) => x.top)), bottom: Math.max(...rs.map((x) => x.bottom)),
        left: Math.min(...rs.map((x) => x.left)), right: Math.max(...rs.map((x) => x.right)) };
      const txt = sc.querySelector('.txt');
      const lines = [...sc.querySelectorAll('.ln')].map((l) => l.textContent);
      const ink = getComputedStyle(document.getElementById('stage')).getPropertyValue('--paper').trim();
      return { lines, fontSize: parseFloat(txt.style.fontSize), top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right), wipe: getComputedStyle(document.getElementById('wipe')).visibility,
        paper: ink, logoDark: document.getElementById('logoDark').style.opacity, opacity: sc.querySelector('.grp').style.opacity };
    }, s.id);
    console.log(s.id, `t=${t.toFixed(2)}`, JSON.stringify(m));
    if (m.top < 210) problems.push(`${s.id}: top ${m.top} < 210 (crowds the logo)`);
    if (m.bottom > 1270) problems.push(`${s.id}: bottom ${m.bottom} > 1270`);
    if (m.left < 88 || m.right > 1000) problems.push(`${s.id}: horizontal ${m.left}..${m.right}`);
    if (m.wipe !== 'hidden') problems.push(`${s.id}: wipe still showing`);
    if (m.fontSize < 80) problems.push(`${s.id}: type only ${m.fontSize}px`);
    if ((m.paper === '#0F1424') !== (m.logoDark === '1')) problems.push(`${s.id}: logo does not match surface`);
    if (parseFloat(m.opacity) < 0.99) problems.push(`${s.id}: not settled at t=${t}`);
  }
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'All checks passed');
  await browser.close();
})();
