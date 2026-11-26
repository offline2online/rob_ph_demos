// Panel geometry and copy auto-fit for the pharmacy screen, shared with the admin editor's preview.
//
// Portrait (1080x1920): a brand triangle panel across the top, its tip at y=920 (830 on the hours template).
// Landscape (1920x1080): a narrow brand arrow panel on the left (580px wide, its tip at x=780), so the content on the
// right has most of the screen; the headline wraps inside the panel's straight-sided part, centred in it (css/screen.css).
// fitText() shrinks the headline block (--k) until every line sits inside the panel with a 24px margin,
// and the content block (--kb) until it fits its box. auditScene() re-checks the result with no margin.
// Seasonal templates (js/occasions.js) fill the screen with no panel: fitOccasion() shrinks each beat's copy (--k) until every
// line sits inside the template's text box (.txt), and auditScene() checks the beat on screen against that box.

export function geom(land, hours) {
  if (!land) {
    const tip = hours ? 830 : 920;
    return {
      W: 1080, H: 1920,
      pts: [[0, 0], [1080, 0], [1080, 300], [540, tip], [0, 300]],
      edge: [[0, 300], [540, tip], [1080, 300]],
      chev: `left:50%;top:${tip - 120}px`,
      inside: (x, y, m) => (y <= 300 ? x >= m && x <= 1080 - m && y >= 0 : Math.abs(x - 540) <= (540 * (tip - y)) / (tip - 300) - m && y <= tip - 150),
    };
  }
  const ph = hours ? 1080 : 960, c = ph / 2, w1 = 580, tip = 780;
  return {
    W: 1920, H: 1080,
    pts: [[0, 0], [w1, 0], [tip, c], [w1, ph], [0, ph]],
    edge: [[w1, 0], [tip, c], [w1, ph]],
    chev: `left:${tip - 150}px;top:${c - 25}px;transform:rotate(-90deg)`,
    inside: (x, y, m) => x >= m && x <= w1 - m && y >= m && y <= ph - m,
  };
}

export const ptsPath = (pts) => 'M' + pts.map((p) => p.join(' ')).join(' L');
export const ptsClip = (pts) => 'polygon(' + pts.map((p) => p[0] + 'px ' + p[1] + 'px').join(',') + ')';

// Element rects in screen pixels, whatever scale the screen is drawn at.
function toScreen(el, G) {
  const sr = el.getBoundingClientRect(), sc = sr.width / G.W;
  return (r) => ({ l: (r.left - sr.left) / sc, r: (r.right - sr.left) / sc, t: (r.top - sr.top) / sc, b: (r.bottom - sr.top) / sc });
}

function headFits(el, G, toS, m) {
  const head = el.querySelector('.s-head');
  if (!head) return true;
  const rg = el.ownerDocument.createRange();
  for (const n of head.querySelectorAll('h2,p')) {
    rg.selectNodeContents(n);
    for (const r0 of rg.getClientRects()) {
      const r = toS(r0);
      if (r.r - r.l < 1) continue;
      if (![[r.l, r.t], [r.r, r.t], [r.l, r.b], [r.r, r.b]].every(([x, y]) => G.inside(x, y, m))) return false;
    }
  }
  return true;
}

function bodyFits(el, toS) {
  const body = el.querySelector('.s-body');
  if (!body) return true;
  const br = toS(body.getBoundingClientRect());
  for (const c of body.querySelectorAll('.s-title,.s-sub,.s-tiles')) {
    const r = toS(c.getBoundingClientRect());
    if (r.l < br.l - 1 || r.r > br.r + 1) return false;
  }
  const kids = [...body.children].map((c) => toS(c.getBoundingClientRect()));
  return !(kids.length && (Math.min(...kids.map((r) => r.t)) < br.t - 1 || Math.max(...kids.map((r) => r.b)) > br.b + 1));
}

/** Shrink the headline and content to fit. `el` is the .screen element, already rendered. */
export function fitText(el, G) {
  el.classList.add('measure');
  const toS = toScreen(el, G);
  const head = el.querySelector('.s-head');
  let k = 1, ok = true;
  if (head) {
    for (k = 1; k >= 0.42; k -= 0.04) {
      head.style.setProperty('--k', k);
      ok = headFits(el, G, toS, 24);
      if (ok) break;
    }
  }
  const body = el.querySelector('.s-body');
  let kb = 1, okb = true;
  if (body) {
    for (kb = 1; kb >= 0.5; kb -= 0.05) {
      body.style.setProperty('--kb', kb);
      okb = bodyFits(el, toS);
      if (okb) break;
    }
  }
  el.classList.remove('measure');
  return { k: +k.toFixed(2), ok, kb: +kb.toFixed(2), okb };
}

// The rects of every line of text under `root`, in screen pixels.
function textRects(root, toS) {
  const doc = root.ownerDocument, rg = doc.createRange(), out = [];
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let t;
  while ((t = walker.nextNode())) {
    if (!t.nodeValue.trim()) continue;
    rg.selectNodeContents(t);
    for (const r0 of rg.getClientRects()) { const r = toS(r0); if (r.r - r.l >= 1) out.push({ r, text: t.nodeValue.trim() }); }
  }
  return out;
}
// The first line of a beat that leaves the occasion's text box, or null.
function beatOverflow(beat, box, toS) {
  return textRects(beat, toS).find(({ r }) => r.l < box.l - 1 || r.r > box.r + 1 || r.t < box.t - 1 || r.b > box.b + 1) || null;
}

/** Shrink each beat of an occasion (el: the .screen, already rendered) until its copy fits the text box. */
export function fitOccasion(el, G) {
  const txt = el.querySelector('.occ .txt');
  if (!txt) return { k: [], ok: true };
  el.classList.add('measure');
  const toS = toScreen(el, G);
  const box = toS(txt.getBoundingClientRect());
  const ks = [];
  let ok = true;
  for (const beat of txt.querySelectorAll('.b')) {
    let k = 1, fits = false;
    for (; k >= 0.4; k -= 0.04) {
      beat.style.setProperty('--k', k.toFixed(2));
      if ((fits = !beatOverflow(beat, box, toS))) break;
    }
    ks.push(+Math.max(k, 0.4).toFixed(2));
    ok = ok && fits;
  }
  el.classList.remove('measure');
  return { k: ks, ok };
}

/**
 * Overflow audit of the scene on screen: every headline line inside the brand panel, the content inside
 * its box, and every other piece of copy (hours card, notes, footer) inside the screen. Returns problems[].
 */
export function auditScene(el, G) {
  el.classList.add('measure');
  const toS = toScreen(el, G);
  const problems = [];
  // An occasion: the beat on screen (a held one, or every beat while the loop plays) inside the text box.
  const txt = el.querySelector('.occ .txt');
  if (txt) {
    const box = toS(txt.getBoundingClientRect());
    const held = txt.querySelectorAll('.b.on');
    for (const beat of held.length ? held : txt.querySelectorAll('.b')) {
      const over = beatOverflow(beat, box, toS);
      if (over) problems.push(`"${over.text.slice(0, 40)}" leaves the text box`);
    }
    if (box.l < -1 || box.t < -1 || box.r > G.W + 1 || box.b > G.H + 1) problems.push('the text box leaves the screen');
  }
  if (!headFits(el, G, toS, 0)) problems.push('headline leaves the brand panel');
  if (!bodyFits(el, toS)) problems.push('content leaves its box');
  const rg = el.ownerDocument.createRange();
  for (const n of el.querySelectorAll('.s-card, .s-note, .s-foot, .s-body')) {
    const walker = el.ownerDocument.createTreeWalker(n, 4 /* NodeFilter.SHOW_TEXT */);
    let t;
    while ((t = walker.nextNode())) {
      if (!t.nodeValue.trim()) continue;
      rg.selectNodeContents(t);
      for (const r0 of rg.getClientRects()) {
        const r = toS(r0);
        if (r.r - r.l < 1) continue;
        if (r.l < -1 || r.t < -1 || r.r > G.W + 1 || r.b > G.H + 1) { problems.push(`"${t.nodeValue.trim().slice(0, 40)}" leaves the screen`); break; }
      }
    }
  }
  // the hours card and the note under it must not overlap
  const card = el.querySelector('.s-card'), note = el.querySelector('.s-note');
  if (card && note && note.textContent.trim()) {
    const a = toS(card.getBoundingClientRect()), b = toS(note.getBoundingClientRect());
    if (b.t < a.b - 1 && b.b > a.t + 1) problems.push('hours card overlaps the holiday note');
  }
  el.classList.remove('measure');
  return problems;
}

/**
 * Fit the sale template (js/render.js renderSale; el: the .screen, already rendered). Scene 1: the headline inside the
 * wedge and the cards and captions inside their box (fitText), then each brand name to its card's width (--kn).
 * Scene 2: the offer value to about 80% of the width (portrait; its column in landscape, --kv), then the whole offer
 * into its box (--k2). Both: each footer line to the screen's width (--kf). Measured in layout pixels, so the scale
 * the screen is drawn at does not matter.
 */
export function fitSale(el, G) {
  const base = el.querySelector('.s-head') || el.querySelector('.s-body') ? fitText(el, G) : { k: 1, ok: true, kb: 1, okb: true };
  el.classList.add('measure');
  const shrink = (node, prop, fits, min = 0.3, step = 0.04) => {
    let k = 1;
    for (; k > min; k -= step) { node.style.setProperty(prop, k.toFixed(2)); if (fits()) return +k.toFixed(2); }
    node.style.setProperty(prop, min.toFixed(2));
    return min;
  };
  const kn = [...el.querySelectorAll('.sl-nm')].map((nm) => shrink(nm, '--kn', () => nm.offsetWidth <= nm.parentElement.clientWidth - 48));
  const foot = el.querySelector('.sl-foot');
  const kf = foot ? shrink(foot, '--kf', () => [...foot.children].every((x) => x.offsetWidth <= G.W - 80), 0.4) : 1;
  let kv = 1, k2 = 1, ok2 = true;
  const offer = el.querySelector('.sl-offer');
  if (offer) {
    const big = offer.querySelector('.sl-big'), vw = offer.querySelector('.sl-valw');
    const room = () => (G.W > G.H ? big.clientWidth : G.W * 0.8);
    kv = shrink(offer, '--kv', () => vw.offsetWidth <= room(), 0.3, 0.02);
    const inner = offer.querySelector('.sl-in');
    const inBox = () => inner.offsetHeight <= offer.clientHeight + 1 && inner.offsetWidth <= offer.clientWidth + 1 && [...offer.querySelectorAll('.sl-big > *, .sl-fin > *')].every((x) => x.offsetWidth <= x.parentElement.clientWidth + 1);
    k2 = shrink(offer, '--k2', inBox, 0.4);
    ok2 = inBox();
  }
  el.classList.remove('measure');
  return { ...base, kn, kf, kv, k2, ok2 };
}
