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
  for (const s of scenes) {
    const t = s.id === 's9' ? s.start + 2.6 : s.end - 0.45;
    await page.evaluate((t) => window.renderAt(t), t);
    await page.screenshot({ path: `${outDir}/${s.id}.png` });
    const m = await page.evaluate((id) => {
      const sc = document.getElementById(id);
      const lines = (el) => el ? Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) : 0;
      const h = sc.querySelector('.headline'), l = sc.querySelector('.lede'), e = sc.querySelector('.eyebrow');
      let maxBottom = 0, maxRight = 0, minLeft = 1e9;
      sc.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
        maxBottom = Math.max(maxBottom, r.bottom); maxRight = Math.max(maxRight, r.right); minLeft = Math.min(minLeft, r.left);
      });
      // overlap test between leaf visual boxes (chips, pills, nodes, hub, tiles, rows)
      const boxes = [...sc.querySelectorAll('.chip,.pill,.node,.hub,.tile,.job,.out,.device,.step,.cta,.lobe,.headline,.lede,.eyebrow')].map((el) => [el.className, el.getBoundingClientRect()]);
      const ov = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, A] = boxes[i], [b, B] = boxes[j];
        if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) {
          const nested = [...sc.querySelectorAll('*')].some(() => false);
          ov.push(a + ' x ' + b);
        }
      }
      return { eyebrowLines: lines(e), headlineLines: lines(h), ledeLines: lines(l), headline: h && h.textContent,
        maxBottom: Math.round(maxBottom), maxRight: Math.round(maxRight), minLeft: Math.round(minLeft), overlaps: ov };
    }, s.id);
    console.log(s.id, `t=${t.toFixed(2)}`, JSON.stringify(m));
    if (m.maxBottom > 1190) problems.push(`${s.id}: content bottom ${m.maxBottom} > 1190`);
    if (m.maxRight > 992 || m.minLeft < 88) problems.push(`${s.id}: horizontal overflow ${m.minLeft}..${m.maxRight}`);
    if (m.eyebrowLines > 1) problems.push(`${s.id}: eyebrow wraps`);
    if (m.headlineLines > 3) problems.push(`${s.id}: headline ${m.headlineLines} lines`);
    if (m.ledeLines > 3) problems.push(`${s.id}: lede ${m.ledeLines} lines`);
    if (m.overlaps.length) problems.push(`${s.id}: overlaps ${m.overlaps.join('; ')}`);
  }
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'All checks passed');
  await browser.close();
})();
