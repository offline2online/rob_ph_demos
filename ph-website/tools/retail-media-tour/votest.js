// Voiceover tests for the retail media tour: audio off and on, full flows, stepping back and forth, pause, toggle,
// flow switch and reload. Fails on overlapping audio, a line that doesn't belong to the step on screen, slow starts,
// lines that start before their on-screen cue or after the screen has moved past it, steps that advance before their
// narration ends, or captions that differ from the script. Reports the quiet time between lines.
//   node votest.js off | full 0 | full 1 | full 2 | nav | reload        (MOTION=normal for real-speed timing; PORT=…)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'tourart');
const SCRIPT = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'voiceover-script.json'), 'utf8')).steps.map(s => [s.id, s.lines.map(l => l.text)]));
const MAN = JSON.parse(fs.readFileSync(path.join(root, 'vo', 'manifest.json'), 'utf8'));
const TYPES = { '.html': 'text/html', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.json': 'application/json' };
const PORT = +(process.env.PORT || 8793);
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(f); res.writeHead(200, { 'content-type': TYPES[ext] || 'text/plain' });
  if (ext === '.html') res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(f, 'utf8') + '</body></html>');
  else fs.createReadStream(f).pipe(res);
}).listen(PORT);
const fails = [];
const check = (ok, msg) => { if (!ok) { fails.push(msg); console.log('  FAIL', msg); } };
(async () => {
  const [mode, arg] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: process.env.MOTION === 'normal' ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(() => {
    window.PH_TOUR_VO_DEBUG = true; window.__maxConc = 0; window.__media = new Set();
    const op = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const el = this;
      if (!el.__tracked) {
        el.__tracked = true;
        el.addEventListener('playing', () => { window.__media.add(el); window.__maxConc = Math.max(window.__maxConc, window.__media.size); });
        ['pause', 'ended', 'emptied', 'abort'].forEach(e => el.addEventListener(e, () => window.__media.delete(el)));
      }
      window.__lastMedia = el; return op.call(this);
    };
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' }); await p.waitForTimeout(800);
  const state = () => p.evaluate(() => {
    const flow = [...document.querySelectorAll('#flows .chip')].findIndex(c => c.getAttribute('aria-current') === 'true');
    const step = [...document.querySelectorAll('#dots .dot')].findIndex(d => d.getAttribute('aria-current') === 'true');
    const el = window.__lastMedia;
    return { flow, step, key: step < 0 ? null : `f${flow + 1}-${String(step + 1).padStart(2, '0')}`, cap: document.getElementById('capS').textContent,
      src: el ? decodeURIComponent(el.currentSrc || el.src).split('/').pop() : null, playing: window.__media.size, conc: window.__maxConc,
      paused: el ? el.paused : true, ended: !document.getElementById('card').hidden && /complete/i.test(document.getElementById('card').textContent),
      pressed: document.getElementById('vo').getAttribute('aria-pressed'), log: window.__voLog || [] };
  });
  const pickFlow = async k => { await p.evaluate(k => document.querySelectorAll('#flows .chip')[k].click(), k); await p.waitForTimeout(400); };
  const start = async () => { await p.click('#start'); };
  const expectClip = async (label) => {   // the line playing belongs to the step on screen
    await p.waitForTimeout(450); const s = await state();
    check(s.src && (MAN[s.key] || []).some(l => l.file === s.src), `${label}: step ${s.key} but line ${s.src}`);
    check(s.playing <= 1 && s.conc <= 1, `${label}: ${s.conc} lines at once`);
    return s;
  };

  if (mode === 'off' || mode === 'reload') {
    const s0 = await state();
    check(s0.pressed === 'false', 'voiceover should start off');
    check(await p.$eval('#vo', e => e.getAttribute('aria-label')) === 'Turn voiceover on', 'accessible label');
    check(!(await p.$('.voinfo, #votip')), 'no tooltip next to the speaker');
    await pickFlow(0); await start();
    const seen = new Set();
    for (let t = 0; t < 160 && seen.size < 6; t++) {
      await p.waitForTimeout(250); const s = await state();
      if (s.key && !seen.has(s.cap)) { seen.add(s.cap); check((SCRIPT[s.key] || []).includes(s.cap), `caption on ${s.key} is a line from its script: ${s.cap}`); console.log('  caption', s.key, '|', s.cap); }
    }
    const s1 = await state();
    check(!s1.src, 'no audio while off');
    if (mode === 'reload') {
      await p.click('#vo'); await p.waitForTimeout(300);
      check(await p.evaluate(() => localStorage.getItem('ph_tour_voiceover')) === 'on', 'choice saved');
      await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
      const s2 = await state();
      check(s2.pressed === 'true', 'choice restored after reload');
      check(!s2.log.some(l => l.ev === 'start') && !s2.src, 'nothing plays before the visitor starts the tour');
      await pickFlow(0); await start(); await expectClip('after reload, start');
      await p.click('#vo'); await p.waitForTimeout(300);
      const s3 = await state();
      check(s3.paused && s3.playing === 0, 'toggling off silences at once');
      check(await p.evaluate(() => localStorage.getItem('ph_tour_voiceover')) === 'off', 'off saved');
    }
  }

  if (mode === 'full') {
    const k = +arg;
    await p.click('#vo'); await pickFlow(k); await start();
    let last = '';
    for (let t = 0; t < 3000; t++) {
      await p.waitForTimeout(200); const s = await state();
      if (s.key !== last) { last = s.key; console.log('  step', s.key); }
      if (s.ended) break;
    }
    const s = await state(), log = s.log;
    check(s.ended, `flow ${k} reached its end card`);
    check(s.conc <= 1, `flow ${k}: at most one line at a time (saw ${s.conc})`);
    const starts = log.filter(l => l.ev === 'start'), keys = Object.keys(MAN).filter(x => x.startsWith(`f${k + 1}-`));
    const want = keys.flatMap(x => MAN[x].map((_, j) => `${x}.${j}`)), got = starts.map(l => `${l.k}.${l.j}`);
    check(JSON.stringify(got) === JSON.stringify(want), `flow ${k}: every line once, in order\n    want ${want.join(' ')}\n    got  ${got.join(' ')}`);
    let quiet = 0, worst = [0, ''], holds = log.filter(l => l.ev === 'hold').length;
    starts.forEach((st, n) => {
      const pl = log.find(l => l.ev === 'playing' && l.k === st.k && l.j === st.j && l.t >= st.t);
      const en = log.find(l => l.ev === 'ended' && l.k === st.k && l.j === st.j && l.t >= st.t);
      check(pl && pl.t - st.t < 400, `${st.k}.${st.j}: starts within 400 ms (${pl ? pl.t - st.t : 'never'} ms)`);
      check(en, `${st.k}.${st.j}: line played to the end`);
      const L = MAN[st.k][st.j];
      if (L.cue) {   // in step with the screen: after its tip, and before the screen moves on to a later tip
        const cu = log.find(l => l.ev === 'cue' && l.k === st.k && l.j === st.j);
        check(cu && st.t >= cu.t, `${st.k}.${st.j}: waits for its tip "${L.cue}"`);
        const ahead = cu && log.find(l => l.ev === 'cue' && l.k === st.k && l.j > st.j && l.t > cu.t && l.t < st.t);
        check(!ahead, `${st.k}.${st.j}: the screen did not run ahead to "${ahead && ahead.title}" before this line`);
      }
      const nx = starts[n + 1];
      if (en && nx) { const g = nx.t - en.t; check(g >= -5, `${st.k}.${st.j}: next line started before this one ended`); quiet += Math.max(0, g); if (g > worst[0]) worst = [g, `${st.k}.${st.j} → ${nx.k}.${nx.j}`]; }
    });
    const first = starts[0], lastEnd = log.filter(l => l.ev === 'ended').pop();
    const total = lastEnd && first ? lastEnd.t - first.t : 0;
    console.log(`  flow ${k}: ${got.length} lines, ${holds} holds, quiet ${(quiet / 1000).toFixed(1)} s of ${(total / 1000).toFixed(1)} s (${(100 * quiet / total).toFixed(0)}%), longest gap ${(worst[0] / 1000).toFixed(1)} s at ${worst[1]}`);
    const gaps = []; starts.forEach((st, n) => { const en = log.find(l => l.ev === 'ended' && l.k === st.k && l.j === st.j && l.t >= st.t), nx = starts[n + 1]; if (en && nx && nx.t - en.t > 1200) gaps.push(`${st.k}.${st.j}→${nx.k}.${nx.j} ${((nx.t - en.t) / 1000).toFixed(1)}s`); });
    if (gaps.length) console.log('  gaps over 1.2 s:', gaps.join(', '));
  }

  if (mode === 'nav') {
    await p.click('#vo'); await pickFlow(0); await start();
    await expectClip('start');
    await p.waitForTimeout(1200); await p.click('#next'); await expectClip('next');
    await p.waitForTimeout(300); await p.click('#next'); await expectClip('next again, quickly');
    await p.waitForTimeout(300); await p.click('#prev'); await expectClip('previous');
    await p.click('#prev'); await expectClip('previous again, at once');
    for (let i = 0; i < 6; i++) await p.click('#next');
    let s = await expectClip('six nexts in a row');
    check(s.key === 'f1-07', `six nexts land on step 7 (${s.key})`);
    await p.click('#play'); await p.waitForTimeout(600); s = await state();
    check(s.paused && s.playing === 0, 'pause silences the line');
    const tp = await p.evaluate(() => window.__lastMedia.currentTime); await p.waitForTimeout(800);
    check(await p.evaluate(() => window.__lastMedia.currentTime) === tp, 'line holds its place while paused');
    await p.click('#play'); await p.waitForTimeout(500); s = await state();
    check(!s.paused && s.playing === 1 && (await p.evaluate(() => window.__lastMedia.currentTime)) > tp, 'resume carries on from the same place');
    await p.click('#vo'); await p.waitForTimeout(200); s = await state();
    check(s.paused && s.playing === 0, 'toggle off mid-line silences it');
    await p.click('#vo'); await expectClip('toggle back on');
    await p.evaluate(() => document.querySelectorAll('#dots .dot')[2].click()); await expectClip('jump to a step with the dots');
    await pickFlow(1); await p.waitForTimeout(400); s = await state();
    check(s.paused && s.playing === 0 && s.step < 0, 'switching flow stops the line');
    await start(); await expectClip('new flow starts its own line');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(300); s = await state(); check(s.paused, 'hiding the page pauses the line');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(400); s = await state(); check(!s.paused, 'coming back resumes it');
    s = await state(); check(s.conc <= 1, `never more than one line (saw ${s.conc})`);
    check(!(await p.evaluate(() => window.S && window.S.voHold)), 'no hold left behind');
  }

  check(errs.length === 0, 'page errors: ' + JSON.stringify(errs));
  console.log(mode, arg || '', fails.length ? `FAILED ${fails.length}` : 'PASSED');
  await b.close(); srv.close(); process.exit(fails.length ? 1 : 0);
})();
