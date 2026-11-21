// The Pharmacy Screen admin editor: the concept prototype's editor (v41), saving to the config API instead of
// browser storage. Every change is written to the server as you edit (debounced), so another admin sees it
// after a reload; the server checks the admin role and writes an audit entry for every save.
//
// Live preview: the screen's own render engine (../../js/render.js), fed the same config the screen gets.

import CONFIG from '../config.js';
import { signIn, showBlocked, hideGate } from './auth.js';
import { createClient } from './api.js';
import { createSaveQueue } from './save-queue.js';
import { rt, bindRichText } from './rich-text.js';
import { openPicker, closePicker } from './icon-picker.js';
import * as M from './model.js';
import { storeModel, resolvePromotion, sequence, sceneName, renderScene, renderMessage, DEFAULT_HTML, footerConfig, boost, tileTop, occasionOf, occasionFieldName, beatSeconds, seasonDates, seasonDatesOf, fmtMonthDay } from '../../js/render.js';
import { esc, TEMPLATE_TOKENS } from '../../js/tokens.js';
import { geom } from '../../js/fit-text.js';
import { nowInState, storeNow } from '../../js/hours.js';

const $ = (id) => document.getElementById(id);
const pref = {
  get(k) { try { return localStorage.getItem('ps-admin-' + k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('ps-admin-' + k); else localStorage.setItem('ps-admin-' + k, v); } catch {} },
};

let api = null, session = null;
const S = {
  pharmacies: [], // list rows (no content)
  promotions: [],
  templates: [],
  services: [],
  cur: null, // the selected pharmacy, full record with content; id null while it is a new, unsaved pharmacy;
             // {isMaster: true, …} while the master template is selected (its content is each promotion's master)
  masterSrc: null, // the pharmacy record a promotion without a master starts from, in the master template view
  note: null, // {promotionId, sec}: the section just set to be managed separately, to say so on it
  dpTab: null, // selected promotion's record id
  phApi: null,
  sample: null, // seed fixtures for Reset, if this deployment serves them
  lock: null, // pharmacy view: the store code an admin/?store=<code> link locks the editor to (null: the admin view)
};
let orient = pref.get('orient') === 'landscape' ? 'landscape' : 'portrait';

// ───────────────────────── saving ─────────────────────────
// The write queue lives in save-queue.js; this file only says what each save does.

const Save = createSaveQueue((state) => {
  const el = $('saveState');
  el.hidden = state.hidden;
  el.classList.toggle('err', !!state.error);
  if (state.error) {
    el.innerHTML = `<span class="ms" style="font-size:16px">error</span>${esc(state.error)} <button type="button" class="text" id="saveReload">Reload</button>`;
    $('saveReload').onclick = () => location.reload();
  } else el.innerHTML = state.busy ? '<span class="ms" style="font-size:16px">sync</span>Saving…' : '<span class="ms" style="font-size:16px">cloud_done</span>All changes saved';
});

addEventListener('beforeunload', (e) => { if (Save.pending()) { e.preventDefault(); e.returnValue = ''; } });

// ───────────────────────── model helpers ─────────────────────────

const promo = (id = S.dpTab) => S.promotions.find((p) => p.id === id) || S.promotions[0];
const baseOf = (id = S.dpTab) => (promo(id) ? M.baseOfTemplate(S.templates, promo(id).templateId) : 'scenes');
const isHours = (id = S.dpTab) => baseOf(id) === 'hours';
const isOcc = (id = S.dpTab) => baseOf(id) === 'occasion';
// The season on screen for a Seasonal promotion: the pharmacy's own (M.seasonOf); in the master template view, the
// promotion's (where a new pharmacy starts).
const seasonOf = (p = promo()) => M.seasonOf(p, S.cur && !S.cur.isMaster && S.cur.content ? S.cur.content[p.id] : null);
const tmpl = (id) => M.findTemplate(S.templates, id);
const curT = () => tmpl(promo().templateId);
/** Templates are shared by every pharmacy: read-only for built-ins, and for everything in the pharmacy view. */
const tplRO = (T) => !!(T && T.builtIn) || !!S.lock;

/** This pharmacy's content for a promotion, with the fields its current template needs. In the master template
 *  view, the promotion's master (or, until one is saved, the starting pharmacy's content). For a pharmacy, the
 *  sections it inherits are kept equal to the master, so the editor and preview show what its screens play. */
function content(id = S.dpTab) {
  const p = promo(id);
  const all = S.cur.content || (S.cur.content = {});
  if (S.cur.isMaster && !all[p.id]) all[p.id] = p.master || M.clone((S.masterSrc && S.masterSrc.content && S.masterSrc.content[p.id]) || M.newContentFor({ promoId: p.promoId }, baseOf(id)));
  const b = baseOf(id), c = all[p.id];
  const fits = b === 'occasion' ? c && c.occasions && M.OCCASION_CHOICES.every((o) => c.occasions[o.id] && Array.isArray(c.occasions[o.id].beats) && c.occasions[o.id].beats.length === occasionOf(o.id).beats.length)
    : b === 'hours' ? c && Array.isArray(c.headlines) && c.headlines.length >= 3 : c && Array.isArray(c.slots) && c.close && typeof c.greeting === 'string';
  if (!fits) all[p.id] = c ? M.ensureContent(c, b) : M.newContentFor(p, b);
  if (!S.cur.isMaster && p.master) {
    // In place, so the editor's bindings keep pointing at this object.
    const det = M.detachedOf(S.cur, p.id), key = `${p.version}|${det.join(',')}`, syn = S.cur._syn || (S.cur._syn = {});
    if (syn[p.id] !== key) { syn[p.id] = key; Object.assign(all[p.id], M.ensureContent(M.syncInherited(all[p.id], p.master, det), b)); }
  }
  return all[p.id];
}

const previewCode = () => S.cur.storeCode || 'NEW';

function previewModel() {
  // The master template previews its ${Suburb} / ${StoreName} / ${Phone} tokens as written (M.previewPharmacy).
  const ph = { ...M.previewPharmacy(S.cur), storeCode: previewCode() };
  const cfg = M.renderConfig({ pharmacies: [ph], promotions: S.promotions, templates: S.templates });
  content();
  const store = storeModel(M.campaignForPreview(null, previewCode(), ph.name), cfg);
  const play = resolvePromotion(cfg, store, promo().promoId);
  return { cfg, store, play };
}

// ───────────────────────── preview ─────────────────────────

let ver = 0, scene = 0, elapsed = 0, playing = true, last = performance.now(), lastKey = '', model = null;
const seq = () => (model ? sequence(model.play) : [{ k: 0, t: 3 }]);

// "Open today bar in the preview": which message the preview's bar shows. null follows the store's clock (what the
// screen does); otherwise the preview is drawn at a store time today in that state (hours.js nowInState). Editor only.
const BAR_STATES = [
  { k: null, label: "Store's time" },
  { k: 'open', label: 'While open', box: 'ftOpen' },
  { k: 'closing', label: 'Last 30 minutes', box: 'ftClosing' },
  { k: 'before', label: 'Before opening', box: 'ftBefore' },
  { k: 'closed', label: 'After closing', box: 'ftClosed' },
];
let barState = null, barFor = '';
function previewNow(store) {
  if (!barState || !store) return undefined;
  return nowInState(store.sessions, barState, storeNow(store.tz)) || undefined;
}
function markBar() {
  BAR_STATES.forEach((x) => { const b = x.box && $(x.box); if (b) b.closest('.rtf').classList.toggle('focus', x.k === barState); });
  document.querySelectorAll('#barTabs button').forEach((b) => b.setAttribute('aria-selected', String((b.dataset.st || null) === barState)));
}
function setBarState(k) {
  if (k === barState) return;
  barState = k; lastKey = ''; renderScreen(true); markBar();
}

function fit() {
  const st = $('stage'), w = st.clientWidth;
  $('screen').style.transform = `scale(${w / (orient === 'landscape' ? 1920 : 1080)})`;
}
new ResizeObserver(fit).observe($('stage'));

function renderScreen(force) {
  if (!S.cur || !S.promotions.length) return;
  // An occasion plays as one CSS loop: while playing it is drawn once (and again only when its copy, orientation or
  // promotion changes, restarting the loop and the timeline with it); paused, the selected beat is held still.
  const occLoop = isOcc() && playing;
  const minute = occLoop ? 0 : Math.floor(Date.now() / 60000);
  const key = [S.cur.id, S.dpTab, occLoop ? 'loop' : scene, ver, orient, minute, barState].join('|');
  if (key === lastKey && !force) return;
  if (occLoop) { scene = 0; elapsed = 0; }
  const sceneChanged = !lastKey.startsWith([S.cur.id, S.dpTab, scene].join('|') + '|');
  lastKey = key;
  const el = $('screen');
  try {
    model = previewModel();
    if (scene >= sequence(model.play).length) scene = 0;
    renderScene(el, { store: model.store, play: model.play, orientation: orient, scene, now: previewNow(model.store), enter: sceneChanged, loop: occLoop });
  } catch (e) {
    model = null;
    renderMessage(el, orient, 'Preview unavailable', (e && (e.detail || e.message)) || String(e));
  }
  fit();
  renderSceneBtns();
  if (sceneChanged) markEditor(false);
}

function sceneLabel(i) { return model ? sceneName(model.play, i) : ''; }
function renderSceneBtns() {
  $('tl').innerHTML = seq().map((x, i) => `<button role="tab" aria-current="${i === scene}" data-i="${i}" style="--w:${x.t}" title="${esc(sceneLabel(i))} · ${x.t}s"><span class="bar"><i></i></span><span class="lb"><b>${i + 1}</b>${esc(sceneLabel(i))}</span></button>`).join('');
}
const secs = (t) => (Math.round(t * 10) / 10).toFixed(1) + 's';
function setPlaying(v) { playing = v; $('playIc').textContent = v ? 'pause' : 'play_arrow'; $('playTx').textContent = v ? 'Pause' : 'Play'; }

function editorTarget(i) {
  if (isOcc()) return document.querySelector(`#occList .slot[data-o="${i}"]`);
  if (isHours()) return document.querySelector(`#hlSec .slot[data-h="${i}"]`);
  const s = seq()[i];
  if (!s) return null;
  if (s.k === 'intro') return $('dg') && $('dg').closest('.slot');
  if (s.k === 'close') return $('cdur') && $('cdur').closest('.slot');
  return document.querySelector(`#slotList .slot[data-i="${s.k}"]`);
}
function markEditor() {
  document.querySelectorAll('.focus').forEach((x) => x.classList.remove('focus'));
  const el = editorTarget(scene);
  if (el) el.classList.add('focus');
  markBar();
  return el;
}
function goScene(i, scroll) {
  scene = i; elapsed = 0; setPlaying(false); lastKey = ''; renderScreen(true);
  const el = markEditor();
  if (!el || !scroll) return;
  if ($('contentView').hidden) $('setBtn').click();
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
}
$('tl').onclick = (e) => { const b = e.target.closest('button'); if (b) goScene(+b.dataset.i, true); };
$('playBtn').onclick = () => setPlaying(!playing);
$('stage').onclick = () => goScene(scene, true);
$('dpBody').addEventListener('focusin', (e) => {
  if (e.target.closest('.icp-pop')) return;
  // Into an Open today bar message: the preview shows that message. Anywhere else in the promotion except the bar
  // and its tabs: back to the store's clock.
  const box = BAR_STATES.find((x) => x.box && e.target.closest('#' + x.box));
  if (box) setBarState(box.k);
  else if (!e.target.closest('#footSlot, .bartabs, .inh[data-sec="footer"]')) setBarState(null);
  let i = -1;
  const sl = e.target.closest('.slot');
  if (isOcc()) { if (sl && sl.dataset.o !== undefined) i = +sl.dataset.o; }
  else if (isHours()) { if (sl && sl.dataset.h !== undefined) i = +sl.dataset.h; }
  else if (sl) { if (sl.dataset.i !== undefined) i = +sl.dataset.i + 1; else if (sl.querySelector('#dg')) i = 0; else if (sl.querySelector('#cdur')) i = content().slots.length + 1; }
  if (i < 0) return;
  if (i !== scene || playing) goScene(i, false);
});

function loop(now) {
  const dt = (now - last) / 1000; last = now;
  const s = seq();
  if (playing && s.length) { elapsed += dt; if (elapsed >= s[scene].t) { elapsed = 0; scene = (scene + 1) % s.length; } }
  $('screen').classList.toggle('leaving', playing && s.length > 0 && elapsed > ((s[scene] && s[scene].t) || 2) - 0.25);
  renderScreen();
  const tot = s.reduce((a, b) => a + b.t, 0), pos = s.slice(0, scene).reduce((a, b) => a + b.t, 0) + Math.min(elapsed, (s[scene] && s[scene].t) || 0);
  $('tl').querySelectorAll('.bar i').forEach((f, i) => { f.style.width = (i < scene ? 100 : i > scene ? 0 : Math.min(1, elapsed / ((s[scene] && s[scene].t) || 1)) * 100) + '%'; });
  $('tlTime').innerHTML = `<b>${secs(pos)}</b> / ${secs(tot)} · ${s.length} scenes`;
  renderPlayback(tot);
  requestAnimationFrame(loop);
}

function setOrient(o) {
  orient = o; pref.set('orient', o);
  document.querySelectorAll('#orTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.or === o));
  document.querySelector('.wrap').classList.toggle('isLand', o === 'landscape');
  renderUrl(); lastKey = '';
  requestAnimationFrame(() => { fit(); lastKey = ''; });
}
$('orTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setOrient(b.dataset.or); };

// ───────────────────────── pharmacy content edits ─────────────────────────

/** Save one promotion's content for pharmacy `ph` (a new pharmacy's content goes with its create). */
function saveContent(ph, promotionId) {
  if (!ph.id) return;
  const id = ph.id;
  Save.later(`content:${id}:${promotionId}`, `ph:${id}`, async () => {
    const res = await api.setContent(id, promotionId, ph.content[promotionId], ph.version);
    ph.version = res.version;
    if (S.cur === ph) syncListRow();
  });
}

/** Save the master template of promotion `p` (the content the master view edits). */
function saveMaster(p) {
  p.master = S.cur.content[p.id];
  const start = $('msStart'); if (start) start.remove();
  Save.later(`master:${p.id}`, `promo:${p.id}`, async () => {
    const res = await api.updatePromotion(p.id, { master: p.master }, p.version);
    p.version = res.version;
  });
}

/** Something in the selected promotion's content changed. */
function changed() {
  ver++;
  if (S.cur.isMaster) saveMaster(promo()); else saveContent(S.cur, promo().id);
  renderJson();
}

function renderUrl() { $('cpTip').textContent = urlText(); }
/** "Playback duration: Ns" beside Copy experience URL, and its setup tooltip (runs every frame; writes on change). */
let pbLast = -1;
function renderPlayback(tot) {
  const n = M.playbackSeconds(tot);
  if (n === pbLast) return;
  pbLast = n;
  $('pbSecs').textContent = `${n}s`;
  $('pbTip').textContent = M.playbackHelp(n);
}
function screenPage() { return CONFIG.screenPage || new URL('../pharmacy-screen.html', location.href).href; }
function urlText() { return M.templateUrl(screenPage(), promo() ? promo().promoId : '', orient); }
function renderJson() {
  if (!S.cur) return;
  const ph = { ...S.cur, storeCode: S.cur.storeCode };
  const cfg = M.renderConfig({ pharmacies: [ph], promotions: S.promotions, templates: S.templates });
  const p = cfg.pharmacies[0];
  $('cfgJson').textContent = JSON.stringify({ storeCode: p.storeCode, name: p.name, colours: S.cur.colours, logo: p.logo,
    promotions: S.promotions.map((x) => ({ name: x.name, promo: x.promoId, template: (tmpl(x.templateId) || {}).name, content: S.cur.content && S.cur.content[x.id] })) }, null, 2);
}

// rich text (headlines, bar messages): rich-text.js. Every edit there is a content change.
const bindRt = (id, set) => bindRichText(id, set, changed);

// icon picker: searchable Material Symbols, icon-picker.js

/** A scene's "seconds on screen" control (1-60) for its card's header. */
const durInput = (id, v, step = 0.1) => `<label class="dur" style="margin-left:auto" title="How long this shows on screen"><span class="ms">timer</span><input type="number" id="${id}" min="1" max="60" step="${step}" value="${v}" aria-label="Seconds on screen">s</label>`;
const loopText = (t) => `Loop ${t % 1 ? t.toFixed(1) : t}s`;
/** Promotion slots a promotion can hold: 6 in the admin view; 3 in the pharmacy view, where Add promotion is hidden
 *  at the limit. */
const MAX_SLOTS = 6, PHARMACY_MAX_SLOTS = 3;
const maxSlots = () => (S.lock ? PHARMACY_MAX_SLOTS : MAX_SLOTS);
/** Pharmacy view: scene timings are set by an administrator only, so every "seconds on screen" control is hidden
 *  (the slots can still be reordered and deleted). */
function hideTimings(B) { if (S.lock) B.querySelectorAll('.dur').forEach((e) => { e.hidden = true; }); }

// Promotion slots added since the page loaded: deleting one of these needs no confirmation.
const justAdded = new WeakSet();

function renderDp() {
  closePicker(); setTimeout(() => markEditor());
  renderPromoTabs(); renderPromoMeta();
  const bf = S.cur ? `${S.cur.id}|${S.dpTab}` : '';
  if (bf !== barFor) { barFor = bf; barState = null; lastKey = ''; }
  const B = $('dpBody');
  if (!S.promotions.length) { B.innerHTML = '<span class="hint">No promotions yet. Add one with New promotion.</span>'; return; }
  const s = S.cur, d = content();
  if (isHours()) {
    // Each headline is a scene with its own seconds on screen (headlineDurs[i]; blank: the default).
    const hs = M.headlineSeconds(d);
    B.innerHTML = `<span class="pill" id="loopLen" style="justify-self:start"></span><div id="hlSec" style="display:grid;gap:12px">${d.headlines.map((h, i) => `<div class="slot" data-h="${i}"><div class="slot-h">Headline ${i + 1}${durInput(`h${i}dur`, hs[i])}</div>${rt('ch' + i, 'Text', h, 'Headline ' + (i + 1))}</div>`).join('')}</div>
     <label class="chk"><input type="checkbox" id="cAddr" ${d.showAddress ? 'checked' : ''}>Show address under phone</label>`;
    const total = () => { $('loopLen').textContent = loopText(M.loopSeconds(d, 'hours')); };
    d.headlines.forEach((h, i) => {
      bindRt('ch' + i, (v) => { d.headlines[i] = v; });
      $(`h${i}dur`).oninput = (e) => {
        const durs = Array.isArray(d.headlineDurs) ? d.headlineDurs : (d.headlineDurs = []);
        while (durs.length < d.headlines.length) durs.push(null);
        durs[i] = M.clampDur(e.target.value) ?? null;
        changed(); total();
      };
    });
    total();
    $('cAddr').onchange = (e) => { d.showAddress = e.target.checked; changed(); };
    hideTimings(B); decorateSections(B);
    return;
  }
  if (isOcc()) { renderOccasion(B, d); hideTimings(B); decorateSections(B); return; }
  const f = (id, lab, val) => `<label class="f"><span>${lab}</span><input id="${id}" value="${esc(val)}"></label>`;
  const F = footerConfig(d);
  B.innerHTML = `<span class="pill" id="loopLen" style="justify-self:start"></span><div><div class="slot"><div class="slot-h">Top: Greeting<label class="dur" style="margin-left:auto" title="How long this shows on screen"><span class="ms">timer</span><input type="number" id="ddur" min="1" max="60" step="0.5" value="${+d.introDur || 3}" aria-label="Seconds on screen">s</label></div><div class="stack">${rt('dg', 'Headline', d.greeting)}${f('dit', 'Line 1', d.introTitle)}${f('dis', 'Line 2', d.introSub)}</div></div></div>
   <div id="slotsSec" style="display:grid;gap:12px"><div id="slotList" style="display:grid;gap:12px">${d.slots.map((x, i) => `<div class="slot" data-i="${i}"><div class="slot-h"><span class="ms drag" title="Drag to reorder" aria-label="Drag to reorder">drag_indicator</span><span class="ic" style="background:${esc(s.colours.primary)}"><span class="ms">${esc(x.icon)}</span></span>Promotion ${i + 1}<span class="hint" style="font-weight:400">· ${esc(x.label)}</span>
      <span style="margin-left:auto;display:flex;gap:2px;align-items:center"><label class="dur" title="How long this shows on screen"><span class="ms">timer</span><input type="number" id="s${i}dur" min="1" max="60" step="0.5" value="${+x.dur || 2}" aria-label="Seconds on screen">s</label><button type="button" class="text mv" data-mv="-1" ${i ? '' : 'disabled'} title="Move up" aria-label="Move up"><span class="ms">arrow_upward</span></button><button type="button" class="text mv" data-mv="1" ${i < d.slots.length - 1 ? '' : 'disabled'} title="Move down" aria-label="Move down"><span class="ms">arrow_downward</span></button>
      <button type="button" class="text del" ${d.slots.length > 1 ? '' : 'disabled'} style="color:var(--err)" title="Delete promotion" aria-label="Delete promotion ${i + 1}"><span class="ms">delete</span><span class="delt"></span></button></span></div>
     <div class="stack">${rt(`s${i}title`, 'Headline', x.title)}
     ${f(`s${i}sub`, 'Accent line', x.sub)}
     <div class="grid2">${f(`s${i}label`, 'Service chip label', x.label)}<div class="f icp-wrap"><span style="font-size:12px;color:var(--muted)">Icon</span><button type="button" class="icp" id="s${i}icon" aria-haspopup="listbox" aria-expanded="false"><span class="cur"><span class="ms">${esc(x.icon)}</span><span>${esc(String(x.icon).replace(/_/g, ' '))}</span></span><span class="ms">expand_more</span></button></div></div>
     ${f(`s${i}line1`, 'Line 1', x.line1)}
     ${f(`s${i}line2`, 'Line 2', x.line2)}</div></div>`).join('')}</div>
   <button type="button" id="addSlot" ${d.slots.length < maxSlots() ? '' : S.lock ? 'hidden' : 'disabled'} style="justify-self:start" aria-expanded="false"><span class="ms">add</span>Add promotion</button>
   <div class="svcpick" id="svcPick" hidden>
     <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="search" id="svcQ" placeholder="Search ${S.services.length} services" style="flex:1;min-width:180px" autocomplete="off">
       <button type="button" class="text" id="svcBlank"><span class="ms">edit_note</span>Blank promotion</button>
       <button type="button" class="text" id="svcClose" title="Close without adding" aria-label="Close without adding"><span class="ms">close</span>Close</button></div>
     <div class="svclist" id="svcList"></div></div></div>
   <div class="slot"><div class="slot-h">Tail: Walk-in close<label class="dur" style="margin-left:auto" title="How long this shows on screen"><span class="ms">timer</span><input type="number" id="cdur" min="1" max="60" step="0.5" value="${+d.close.dur || 2}" aria-label="Seconds on screen">s</label></div><div class="stack">${rt('cl1', 'Headline', d.close.title)}${f('cl2', 'Accent line', d.close.sub)}${f('cl3', 'Line 1', d.close.line1)}${f('cl4', 'Line 2', d.close.line2)}</div></div>
   <div class="slot" id="footSlot"><div class="slot-h">Footer: Open today bar<label class="chk" style="margin-left:auto;font-weight:400"><input type="checkbox" id="ftShow" ${F.show !== false ? 'checked' : ''}>Show</label></div>
     <div class="stack">${rt('ftOpen', 'While open', F.open)}${rt('ftClosing', 'Last 30 minutes', F.closing)}${rt('ftBefore', 'Before opening', F.before)}${rt('ftClosed', 'After closing', F.closed)}</div>
     <span class="hint">Use \${CloseTime} and \${OpenTime} for today's hours.</span></div>`;
  const on = (id, fn) => { $(id).oninput = (e) => { fn(e.target.value); changed(); }; };
  const total = () => { $('loopLen').textContent = loopText(M.loopSeconds(d)); };
  $('ddur').oninput = (e) => { d.introDur = M.clampDur(e.target.value); changed(); total(); };
  $('cdur').oninput = (e) => { d.close.dur = M.clampDur(e.target.value); changed(); total(); };
  d.slots.forEach((x, i) => { $(`s${i}dur`).oninput = (e) => { x.dur = M.clampDur(e.target.value); changed(); total(); }; });
  total();
  bindRt('dg', (v) => { d.greeting = v; }); on('dit', (v) => { d.introTitle = v; }); on('dis', (v) => { d.introSub = v; });
  const reflow = () => { scene = 0; elapsed = 0; lastKey = ''; changed(); renderDp(); };
  const drawSvc = () => {
    const used = new Set(d.slots.map((x) => x.svc));
    // Every service in the library, whatever the pharmacy: its own service list may be out of date.
    const groups = M.filterServices(S.services, { q: $('svcQ').value, mine: false });
    $('svcList').innerHTML = groups.length ? groups.map((g) => `<div class="svccat">${esc(g.category)}</div>` + g.services.map((v) => `<button type="button" class="svc" data-id="${esc(v.id)}" ${used.has(v.id) ? 'aria-pressed="true"' : ''}>
      <span class="ic" style="background:linear-gradient(145deg,${tileTop(s.colours.primary)},${esc(s.colours.primary)})"><span class="ms">${esc(v.icon)}</span></span>
      <span class="svct"><b>${esc(v.headline || v.label)}</b><span>${esc(v.accent)}</span></span>
      ${used.has(v.id) ? '<span class="hint">Added</span>' : ''}</button>`).join('')).join('')
      : '<div class="hint">No services match. Clear the search.</div>';
  };
  const showPick = (open) => { $('svcPick').hidden = !open; $('addSlot').setAttribute('aria-expanded', open); if (open) { $('svcQ').value = ''; drawSvc(); $('svcQ').focus(); } };
  $('addSlot').onclick = () => showPick($('svcPick').hidden);
  // Closing the picker adds nothing.
  $('svcClose').onclick = () => { showPick(false); $('addSlot').focus(); };
  $('svcPick').onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); showPick(false); $('addSlot').focus(); } };
  $('svcQ').oninput = drawSvc;
  const addSlot = (x) => { if (d.slots.length >= maxSlots()) return; justAdded.add(x); d.slots.push(x); reflow(); };
  $('svcBlank').onclick = () => addSlot(M.blankSlot());
  $('svcList').onclick = (e) => { const b = e.target.closest('.svc'); if (!b) return; const v = S.services.find((x) => x.id === b.dataset.id); if (v) addSlot(M.serviceToSlot(v)); };
  const SL = $('slotList'); let dragFrom = null;
  SL.querySelectorAll('.slot').forEach((el) => {
    const i = +el.dataset.i, h = el.querySelector('.drag');
    h.onmousedown = h.ontouchstart = () => { el.draggable = true; }; h.onmouseup = () => { el.draggable = false; };
    el.ondragstart = (e) => { dragFrom = i; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {} };
    el.ondragend = () => { el.draggable = false; el.classList.remove('dragging'); SL.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); };
    el.ondragover = (e) => { if (dragFrom === null) return; e.preventDefault(); SL.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); if (i !== dragFrom) el.classList.add('drop'); };
    el.ondrop = (e) => { e.preventDefault(); if (dragFrom === null || dragFrom === i) return; const [m] = d.slots.splice(dragFrom, 1); d.slots.splice(i, 0, m); dragFrom = null; reflow(); };
    el.querySelectorAll('.mv').forEach((b) => { b.onclick = () => { const j = i + +b.dataset.mv; [d.slots[i], d.slots[j]] = [d.slots[j], d.slots[i]]; reflow(); }; });
    const del = el.querySelector('.del'); let armed = false;
    del.onclick = () => {
      // A slot added in this session is discarded with one click; an existing one asks to confirm.
      if (!armed && !justAdded.has(d.slots[i])) { armed = true; del.querySelector('.delt').textContent = 'Confirm'; setTimeout(() => { armed = false; if (del.isConnected) del.querySelector('.delt').textContent = ''; }, 3000); return; }
      d.slots.splice(i, 1); reflow();
    };
  });
  d.slots.forEach((x, i) => {
    ['label', 'sub', 'line1', 'line2'].forEach((k) => on(`s${i}${k}`, (v) => { x[k] = v; }));
    bindRt(`s${i}title`, (v) => { x.title = v; });
    $(`s${i}icon`).onclick = (e) => { e.stopPropagation(); openPicker($(`s${i}icon`), x.icon, (v) => { x.icon = v; changed(); renderDp(); }); };
  });
  const fset = (k, v) => { d.footer = Object.assign({}, footerConfig(d), { [k]: v }); };
  bindRt('ftOpen', (v) => fset('open', v)); bindRt('ftClosing', (v) => fset('closing', v)); bindRt('ftBefore', (v) => fset('before', v)); bindRt('ftClosed', (v) => fset('closed', v));
  $('ftShow').onchange = (e) => { fset('show', e.target.checked); changed(); };
  bindRt('cl1', (v) => { d.close.title = v; }); on('cl2', (v) => { d.close.sub = v; }); on('cl3', (v) => { d.close.line1 = v; }); on('cl4', (v) => { d.close.line2 = v; });
  hideTimings(B); decorateSections(B); renderBarTabs();
}

/** The "Open today bar in the preview" tabs, just under the bar's messages. They sit outside the section, so they
 *  work while it is inherited from the master (read-only). Preview only: nothing is saved. */
function renderBarTabs() {
  const foot = $('footSlot');
  if (!foot) return;
  const row = document.createElement('div');
  row.className = 'bartabs';
  row.innerHTML = `<span class="bartabs-h">Open today bar in the preview<span class="ms help" tabindex="0" role="img" aria-label="About this preview" title="Shows the bar's message for each time of day in the preview only. Screens always show the message for the store's own time.">info</span></span>
    <div class="tabs" role="tablist" id="barTabs" aria-label="Open today bar in the preview">${BAR_STATES.map((x) => `<button type="button" role="tab" ${x.k ? `data-st="${x.k}"` : ''} aria-selected="${x.k === barState}">${esc(x.label)}</button>`).join('')}</div>`;
  foot.after(row);
  $('barTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setBarState(b.dataset.st || null); };
  markBar();
}

// ───────────────────────── master template (requirement 23) ─────────────────────────
// Each promotion's master template holds the content every pharmacy uses by default. On a pharmacy, every section
// of a promotion that has a master shows whether it is inherited (read-only here, edited in the master template)
// or managed separately for this pharmacy, with the action to switch. Branding is always per pharmacy.

/** The element that holds each master section of the promotion just drawn in `B`. */
function sectionEls(B) {
  const by = (id) => B.querySelector('#' + id);
  const up = (id, sel) => { const e = by(id); return e && e.closest(sel); };
  return { greeting: up('dg', '.slot'), slots: by('slotsSec'), close: up('cdur', '.slot'), footer: by('footSlot'),
    headlines: by('hlSec'), address: up('cAddr', 'label'), occasions: by('occList') };
}

function decorateSections(B) {
  const p = promo();
  if (S.cur.isMaster) { renderMasterStart(B, p); return; }
  if (!p || !p.master) return;
  const det = new Set(M.detachedOf(S.cur, p.id)), els = sectionEls(B), canEdit = !!S.cur.id;
  for (const sec of M.sectionsForBase(baseOf())) {
    const el = els[sec];
    if (!el) continue;
    if (sec === 'occasions') {
      // Seasonal content is always the pharmacy's own; the master only reaches it when the pharmacy copies it.
      const wrap = document.createElement('div');
      wrap.className = 'inh own';
      wrap.dataset.sec = sec;
      wrap.innerHTML = `<div class="inh-bar"><span class="pill inh-pill"><span class="ms">storefront</span>This pharmacy's own</span>
        <span class="ms help" tabindex="0" role="img" aria-label="About seasonal content" title="The season, its copy and its dates are this pharmacy's own. Changes to the master template never reach its screens. Copy from master replaces this season's copy and dates with the master's as they are now.">info</span>
        <button type="button" class="text" id="occCopyMaster" style="margin-left:auto;min-height:28px;padding:0 6px;white-space:nowrap" ${canEdit && p.master.occasions ? '' : 'disabled'}><span class="ms">content_copy</span>${cmArm ? 'Click again to copy' : 'Copy from master'}</button></div>`;
      el.replaceWith(wrap);
      wrap.append(el);
      wrap.querySelector('#occCopyMaster').onclick = copySeasonFromMaster;
      continue;
    }
    const own = det.has(sec), name = M.SECTION_NAMES[sec];
    const wrap = document.createElement('div');
    wrap.className = 'inh' + (own ? ' own' : '');
    wrap.dataset.sec = sec;
    wrap.innerHTML = `<div class="inh-bar"><span class="pill inh-pill"><span class="ms">${own ? 'edit_note' : 'account_tree'}</span>${own ? 'Managed separately' : 'Inherited from master'}</span>
      <span class="ms help" title="${own ? `${esc(name)} is this pharmacy's own. Changes to the master template no longer reach it.` : S.lock ? `${esc(name)} comes from the master template. Choose Edit to change it for this pharmacy.` : `${esc(name)} comes from the master template. Edit it there, or manage it separately for this pharmacy.`}">info</span>
      <button type="button" class="text inh-act" data-sec="${sec}" data-own="${own ? 1 : 0}" ${canEdit ? '' : 'disabled title="Add the pharmacy name and store code first"'}><span class="ms">${own ? 'undo' : 'edit'}</span>${own ? 'Revert to master' : S.lock ? 'Edit' : 'Edit for this pharmacy'}</button></div>`;
    if (own && S.note && S.note.promotionId === p.id && S.note.sec === sec) {
      wrap.insertAdjacentHTML('beforeend', `<div class="inh-alert" role="status"><span class="ms">info</span><span><b>${esc(name)}</b> is now managed separately for ${esc(S.cur.name)}. Changes to the master template no longer reach it until you revert it to the master.</span><button type="button" class="text inh-x" aria-label="Dismiss"><span class="ms">close</span></button></div>`);
    }
    el.replaceWith(wrap);
    wrap.append(el);
    if (!own) { el.inert = true; el.classList.add('inh-ro'); }
  }
  B.querySelectorAll('.inh-act').forEach((b) => { b.onclick = () => setSection(b.dataset.sec, b.dataset.own !== '1').catch(Save.fail); });
  B.querySelectorAll('.inh-x').forEach((b) => { b.onclick = () => { S.note = null; b.closest('.inh-alert').remove(); }; });
}

/** Run `redraw` without moving the page: the element `sel` names (found again after the redraw) stays at the same
 *  height on screen, and takes the focus back if it had it, so the page never jumps away from where you clicked.
 *  Without an element to hold on to, the page keeps its scroll position. */
function keepPlace(sel, redraw) {
  const se = document.scrollingElement || document.documentElement;
  const was = document.querySelector(sel), x = se.scrollLeft, y = se.scrollTop;
  const top = was ? was.getBoundingClientRect().top : null;
  const hadFocus = !!was && (document.activeElement === was || was.contains(document.activeElement));
  redraw();
  const now = document.querySelector(sel);
  if (hadFocus && now) now.focus({ preventScroll: true });
  se.scrollTop = y; se.scrollLeft = x; // the redraw may have dropped it (a shorter page, focus lost to the body)
  if (now && top !== null) se.scrollTop += now.getBoundingClientRect().top - top;
}

/** Manage section `sec` of the selected promotion separately for this pharmacy (on), or inherit it again (off). */
async function setSection(sec, on) {
  const ph = S.cur, p = promo();
  if (!ph.id || ph.isMaster) return;
  await Save.flush();
  ph.detached = M.setDetached(ph, p.id, sec, on);
  S.note = on ? { promotionId: p.id, sec } : null;
  // renderDp → content(): an inherited section takes the master's copy again. It redraws the whole panel, so
  // keep the section's Edit / Revert button where it was on screen, and focused.
  keepPlace(`#dpBody .inh[data-sec="${sec}"] .inh-act`, () => { ver++; lastKey = ''; renderDp(); renderJson(); renderRestore(); });
  const id = ph.id;
  await Save.queue(`ph:${id}`, async () => {
    // Its own copy first (the master's, until edited), then the switch, so the screen never plays an empty section.
    const a = await api.setContent(id, p.id, ph.content[p.id], ph.version); ph.version = a.version;
    const b = await api.updatePharmacy(id, { detached: ph.detached }, ph.version); ph.version = b.version;
    if (S.cur === ph) syncListRow();
  });
}

/** Pharmacy view: "Restore to default" at the top of the page, in place of "shared by all pharmacies". It puts
 *  every section of every promotion back to the master template; available while any section is managed
 *  separately, and asks for a second click before it discards this pharmacy's own changes. */
let rsArm = false;
// Seasonal content is always the pharmacy's own and is not part of Restore to default: its own "Copy from master"
// brings one season back, when the pharmacy asks.
const ownSections = (ph) => Object.values((ph && ph.detached) || {}).some((l) => Array.isArray(l) && l.some((s) => s !== 'occasions'));
const seasonalOnly = (detached) => Object.fromEntries(Object.entries(detached || {}).filter(([, l]) => Array.isArray(l) && l.includes('occasions')).map(([id]) => [id, ['occasions']]));
function renderRestore() {
  $('restoreWrap').hidden = !S.lock; $('promoShared').hidden = !!S.lock;
  if (!S.lock || !S.cur) return;
  const any = ownSections(S.cur);
  if (!any) rsArm = false;
  $('restoreBtn').disabled = !any || !S.cur.id;
  $('restoreBtn').title = any ? '' : 'Every section already uses the master template';
  $('restoreTx').textContent = rsArm ? 'Click again to restore' : 'Restore to default';
}
async function restoreDefaults() {
  const ph = S.cur;
  if (!S.lock || !ph.id || !ownSections(ph)) return;
  if (!rsArm) { rsArm = true; renderRestore(); setTimeout(() => { rsArm = false; renderRestore(); }, 4000); return; }
  rsArm = false;
  await Save.flush();
  ph.detached = seasonalOnly(ph.detached);
  S.note = null;
  const ids = S.promotions.filter((p) => p.master && !isOcc(p.id)).map((p) => p.id);
  for (const id of ids) content(id); // each inherited section takes the master's copy again
  ver++; lastKey = ''; scene = 0; elapsed = 0; renderDp(); renderJson(); renderRestore();
  const id = ph.id;
  await Save.queue(`ph:${id}`, async () => {
    for (const pid of ids) { const a = await api.setContent(id, pid, ph.content[pid], ph.version); ph.version = a.version; }
    const b = await api.updatePharmacy(id, { detached: ph.detached }, ph.version); ph.version = b.version;
    if (S.cur === ph) syncListRow();
  });
}

/** Seasonal: put the master's copy, dates and timings of the season on screen into this pharmacy's own, as they are
 *  now. The pharmacy's act, asked for twice; nothing else ever brings a master change to it. */
let cmArm = false;
function copySeasonFromMaster() {
  const ph = S.cur, p = promo();
  if (!ph || ph.isMaster || !ph.id || !isOcc() || !p.master || !p.master.occasions) return;
  if (!cmArm) { cmArm = true; renderDp(); setTimeout(() => { if (cmArm) { cmArm = false; renderDp(); } }, 4000); return; }
  cmArm = false;
  const id = seasonOf(p), from = p.master.occasions[id];
  if (from) { content().occasions[id] = M.clone(from); delete ph._syn; content(); }
  changed();
  scene = 0; elapsed = 0; lastKey = ''; renderDp(); renderJson();
}
$('restoreBtn').onclick = () => restoreDefaults().catch(Save.fail);

/** Master view, promotion with no master saved yet: which pharmacy it starts from, and Save as master. */
function renderMasterStart(B, p) {
  if (!p || p.master) return;
  const opts = S.pharmacies.map((x) => `<option value="${esc(x.id)}" ${S.masterSrc && S.masterSrc.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  B.insertAdjacentHTML('afterbegin', `<div class="inh-alert warn" id="msStart"><span class="ms">info</span><span>No master saved for this promotion yet.${opts ? ' Starting from' : ''}</span>
    ${opts ? `<select id="msSrc" aria-label="Start from pharmacy">${opts}</select>` : ''}<button type="button" class="primary" id="msSave">Save as master</button></div>`);
  if ($('msSrc')) $('msSrc').onchange = async (e) => { S.masterSrc = await api.getPharmacy(e.target.value); delete S.cur.content[p.id]; ver++; lastKey = ''; renderDp(); renderJson(); };
  $('msSave').onclick = () => { saveMaster(p); ver++; renderDp(); renderJson(); };
}

const MASTER_ID = '__master';
/** Open the master template: the promotions' masters, previewed with the default branding. */
async function selectMaster() {
  await Save.flush();
  if (!S.masterSrc && S.pharmacies.length && S.promotions.some((p) => !p.master)) S.masterSrc = await api.getPharmacy(S.pharmacies[0].id);
  S.cur = { id: '', isMaster: true, name: 'Master template', storeCode: '', colours: { primary: '#0f1050', accent: '#5ee6b0' }, logo: null,
    content: Object.fromEntries(S.promotions.filter((p) => p.master).map((p) => [p.id, p.master])) };
  S.note = null;
  pref.set('pharmacy', MASTER_ID);
  renderStoreSel(); loadStore();
}

/** The master view says what the master is, above the promotions. */
function showMasterChrome(on) {
  let card = $('masterCard');
  if (!card && on) {
    card = document.createElement('div');
    card.className = 'card'; card.id = 'masterCard';
    card.innerHTML = `<div class="sect">Master template <span class="ms help" title="Every pharmacy, including each new one, uses these promotions by default. A pharmacy can manage any section separately, and keeps its own name, logo and colours.">info</span></div>
      <span class="lockmsg"><span class="ms">account_tree</span><span>Default content for every pharmacy</span></span>`;
    const promoCard = document.querySelector('.promo-mod');
    if (promoCard) promoCard.before(card);
  }
  if (card) card.hidden = !on;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** A day and month picker for one end of a season's dates ("MM-DD"). */
function monthDayPick(id, label, md) {
  const [m, d] = md.split('-').map(Number);
  return `<label class="f"><span>${label}</span><span class="mdpick"><select id="${id}d" aria-label="${label}: day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${i + 1 === d ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
    <select id="${id}m" aria-label="${label}: month">${MONTHS.map((x, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${x}</option>`).join('')}</select></span></label>`;
}
const readMonthDay = (id) => { const m = +$(id + 'm').value, d = Math.min(+$(id + 'd').value, DAYS_IN[m - 1]); return String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); };

// A promotion's Schedule: No schedule (the default) or Annual, which shows a start and an end date that repeat every
// year. Drawn into #npSched (New promotion) and #pmSched (the selected promotion), with ids prefixed np / pm.
const SCHEDULE_HELP = 'When this promotion runs. No schedule (the default): it plays whenever Personalisation Hub Core plays its promo ID. Annual: from the start date to the end date every year, inclusive; the dates are saved with the promotion and go out in its screen config.';
function scheduleFields(prefix, s) {
  const x = M.scheduleOf({ schedule: s }), annual = x.type === 'annual';
  return `<label class="f"><span>Schedule <span class="ms help" title="${esc(SCHEDULE_HELP)}">info</span></span><select id="${prefix}Sch" aria-label="Schedule">${M.SCHEDULE_TYPES.map((t) => `<option value="${t.id}" ${t.id === x.type ? 'selected' : ''}>${t.name}</option>`).join('')}</select></label>`
    + (annual ? monthDayPick(prefix + 'From', 'Starts', x.from) + monthDayPick(prefix + 'To', 'Ends', x.to) : '');
}
const readSchedule = (prefix) => ($(prefix + 'Sch').value === 'annual' ? { type: 'annual', from: readMonthDay(prefix + 'From'), to: readMonthDay(prefix + 'To') } : { type: 'none' });
function drawSchedule(prefix, s, onChange) {
  const el = $(prefix + 'Sched');
  el.innerHTML = scheduleFields(prefix, s);
  el.onchange = (e) => {
    if (e.target.id === prefix + 'Sch') {
      // Switching to Annual shows its dates (today to 31 Dec until changed); back to No schedule hides them.
      el.innerHTML = scheduleFields(prefix, e.target.value === 'annual' ? M.defaultAnnual() : null);
      $(prefix + 'Sch').focus();
    }
    if (onChange) onChange(readSchedule(prefix));
  };
}

/**
 * A seasonal promotion: this pharmacy's dates and copy for the season the promotion is set to. The dates card says
 * (in both views, as "Every year: <start> to <end>"; read-only in the pharmacy view) when the screen plays this season
 * by itself each year (from and to, inclusive, in the store's time zone; Easter
 * moves each year, so its dates are worked out: Good Friday to Easter Monday). Then one card per beat of the design (a
 * main line, and a small label line where the design has one), each with its own seconds on screen (the loop is their
 * sum; at the defaults, an equal share of the design's 12 s). The season itself is picked in the Season drop-down
 * above (the pharmacy's own; what plays outside every season's dates); each season keeps its own copy and dates.
 */
function renderOccasion(B, d) {
  const occ = occasionOf(seasonOf());
  const o = d.occasions[occ.id];
  const f = (id, lab, val) => `<label class="f"><span>${lab}</span><input id="${id}" value="${esc(val)}"></label>`;
  const field = (layout, x, i, key) => (key === 'label' ? f(`o${i}label`, occasionFieldName(layout, 'label'), x.label) : rt(`o${i}text`, occasionFieldName(layout, 'text'), x.text));
  const year = new Date().getFullYear(), r = seasonDates(occ.id, o, year), movable = occ.season && occ.season.easter && !seasonDatesOf(o).from;
  const span = (from, to) => fmtMonthDay(from) + (to !== from ? ' to ' + fmtMonthDay(to) : '');
  // Both views show the start and end dates as a yearly schedule ("Every year: 15 Dec to 27 Dec"). The admin view can
  // change them; the pharmacy view shows them read-only (an administrator sets them, like the seconds on screen).
  const datesHelp = `The screen plays ${occ.name} by itself from the start date to the end date every year, in the store's time zone. Outside every season's dates it plays the season picked above.`;
  const pickers = movable ? `<span class="hint" id="occEaster">Good Friday to Easter Monday, worked out each year</span>`
    : `<div class="grid2">${monthDayPick('occFrom', 'Starts', r.from)}${monthDayPick('occTo', 'Ends', r.to)}</div>`;
  const dates = `<div class="slot" id="occDates"><div class="slot-h">Dates<span class="ms help" title="${esc(datesHelp)}">info</span><span class="pill" id="occYearly" style="margin-left:auto;font-weight:400"><span class="ms" style="font-size:14px" aria-hidden="true">event_repeat</span><span>Every year:</span><span id="occWhen">${esc(span(r.from, r.to))}${movable ? ' this year' : ''}</span></span></div>
    ${pickers}</div>`;
  B.innerHTML = `<span class="pill" id="loopLen" style="justify-self:start">${loopText(M.loopSeconds(o))}</span>
   <div id="occList" style="display:grid;gap:12px">${dates}${occ.beats.map((layout, i) => {
    const x = o.beats[i], keys = layout.label ? (layout.label.pos === 'below' ? ['text', 'label'] : ['label', 'text']) : ['text'];
    return `<div class="slot" data-o="${i}"><div class="slot-h">Beat ${i + 1}${durInput(`o${i}dur`, beatSeconds(x, occ.beats.length))}</div>
     <div class="stack">${keys.map((k) => field(layout, x, i, k)).join('')}</div></div>`;
  }).join('')}</div>`;
  if (!movable) {
    const setDates = () => {
      o.from = readMonthDay('occFrom'); o.to = readMonthDay('occTo');
      $('occWhen').textContent = span(o.from, o.to);
      relabelSeasons();
      changed();
    };
    ['occFromd', 'occFromm', 'occTod', 'occTom'].forEach((id) => { $(id).onchange = setDates; });
  }
  occ.beats.forEach((layout, i) => {
    const x = o.beats[i];
    bindRt(`o${i}text`, (v) => { x.text = v; });
    if (layout.label) $(`o${i}label`).oninput = (e) => { x.label = e.target.value; changed(); };
    $(`o${i}dur`).oninput = (e) => {
      const v = M.clampDur(e.target.value);
      if (v === undefined) delete x.dur; else x.dur = v;
      changed(); $('loopLen').textContent = loopText(M.loopSeconds(o));
    };
  });
}

// ───────────────────────── promotions (shared) ─────────────────────────

function selectPromo(id) {
  S.dpTab = id; $('newPromo').hidden = true; S.note = null; renderDp();
  scene = 0; elapsed = 0; renderUrl(); renderJson(); lastKey = '';
}
$('dpTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) selectPromo(b.dataset.dp); };
function renderPromoTabs() {
  $('dpTabs').innerHTML = S.promotions.map((x) => `<button role="tab" data-dp="${esc(x.id)}" aria-selected="${x.id === S.dpTab}" title="promo=${esc(x.promoId)}"><span class="ms" style="font-size:16px">${isHours(x.id) ? 'schedule' : isOcc(x.id) ? 'celebration' : 'campaign'}</span>${esc(x.name)}</button>`).join('');
  tabsActiveIntoView();
}

// The promotion tabs stay on one line whatever the width of the frame (Personalisation Hub's left menu expanded or
// collapsed): when they don't fit they scroll sideways, the arrows appear, and the selected tab is kept in view,
// including when the frame is resized.
function tabsSync() {
  const el = $('dpTabs'), max = el.scrollWidth - el.clientWidth, over = max > 1;
  $('dpScroll').classList.toggle('over', over);
  $('dpPrev').hidden = !over; $('dpNext').hidden = !over;
  $('dpPrev').disabled = el.scrollLeft <= 1; $('dpNext').disabled = el.scrollLeft >= max - 1;
}
function tabsActiveIntoView() {
  const el = $('dpTabs');
  tabsSync();
  const b = el.querySelector('[aria-selected="true"]');
  if (b) {
    const r = b.getBoundingClientRect(), c = el.getBoundingClientRect(), pad = 16;
    if (r.left < c.left + pad) el.scrollLeft -= c.left + pad - r.left;
    else if (r.right > c.right - pad) el.scrollLeft += r.right - (c.right - pad);
  }
  tabsSync();
}
const tabsStep = (dir) => { const el = $('dpTabs'); el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7) }); };
$('dpPrev').onclick = () => tabsStep(-1);
$('dpNext').onclick = () => tabsStep(1);
$('dpTabs').addEventListener('scroll', tabsSync, { passive: true });
new ResizeObserver(tabsActiveIntoView).observe($('dpTabs'));
// The template drop-down: built-ins and custom templates. Seasonal templates are picked in the Season
// drop-down of a seasonal promotion instead (occasionOptions); a new promotion can start as one (withOccasions).
function tplOptions(sel, withOccasions) {
  const g = (lab, arr) => (arr.length ? `<optgroup label="${lab}">${arr.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>` : '');
  const occ = (t) => t.kind === 'occasion';
  return g('Built-in', S.templates.filter((t) => t.builtIn && !occ(t))) + g('Custom', S.templates.filter((t) => !t.builtIn)) + (withOccasions ? g('Seasonal', S.templates.filter(occ)) : '');
}
// Each season shows its start and end dates after its name ("Christmas (15 Dec – 27 Dec)"), in both views: the dates
// of the pharmacy (or master template) on screen, the same ones as its Dates card, so they follow a change there.
const seasonOccasions = () => (S.cur && isOcc() ? content().occasions : null);
function occasionOptions(sel) {
  const occs = seasonOccasions();
  return M.OCCASION_CHOICES.map((o) => `<option value="${esc(o.templateId)}" ${o.templateId === sel ? 'selected' : ''}>${esc(M.seasonOptionLabel(o.id, occs))}</option>`).join('');
}
function relabelSeasons() {
  const occs = seasonOccasions();
  for (const opt of $('pmTpl').options) { const id = M.occasionOfTemplate(opt.value); if (id) opt.textContent = M.seasonOptionLabel(id, occs); }
}
let pmArm = false;
function renderPromoMeta() {
  const x = promo();
  const occ = !!x && isOcc(x.id);
  // Pharmacy view: the grey promotion section (name, promo ID, template, promo= line) is not shown on Morning,
  // Afternoon, Closed or any other non-seasonal promotion; Seasonal keeps only its Season drop-down.
  $('promoMeta').hidden = !x || (!!S.lock && !occ);
  if (!x) return;
  $('pmName').value = x.name; $('pmToken').value = x.promoId; $('pmTpl').innerHTML = occ ? occasionOptions(M.occasionTemplateId(seasonOf(x))) : tplOptions(x.templateId);
  // Pharmacy view: the promotion's name, promo ID and template are shared by every pharmacy, so read-only (and the
  // section hidden, above). On the Seasonal promotion it shows only the Season drop-down, which can be changed.
  const occOnly = !!S.lock && occ;
  $('pmName').readOnly = $('pmToken').readOnly = !!S.lock; $('pmTpl').disabled = !!S.lock && !occ;
  $('pmName').closest('label').hidden = $('pmToken').closest('label').hidden = $('pmUrl').hidden = occOnly;
  // A seasonal promotion picks its season here (read-only built-ins: nothing to edit or clone).
  $('pmTpl').closest('label').querySelector('span').textContent = occ ? 'Season' : 'Template';
  $('pmTpl').setAttribute('aria-label', occ ? 'Season' : 'Template');
  $('pmHtml').hidden = occ;
  // Schedule: not on Seasonal (its seasons have their own dates, in the Dates card).
  $('pmSched').hidden = occ;
  if (!occ) drawSchedule('pm', x.schedule, (sch) => { if (S.lock) return; const p = promo(); p.schedule = sch; savePromotion(p); });
  $('pmUrl').textContent = 'promo=' + x.promoId; $('pmErr').hidden = true; $('pmDel').hidden = !!S.lock || S.promotions.length < 2;
  pmArm = false; $('pmDelTx').textContent = 'Delete promotion';
}
function showPmErr(msg) { $('pmErr').textContent = msg; $('pmErr').hidden = !msg; }

async function reloadPromotions() {
  S.promotions = M.orderPromotions(await api.listPromotions());
  if (S.cur && S.cur.isMaster) for (const p of S.promotions) if (p.master) S.cur.content[p.id] = p.master;
  if (!S.promotions.some((p) => p.id === S.dpTab)) S.dpTab = S.promotions[0] && S.promotions[0].id;
}

function savePromotion(p) {
  Save.later(`promo:${p.id}`, `promo:${p.id}`, async () => {
    try {
      const res = await api.updatePromotion(p.id, { name: p.name, promoId: p.promoId, templateId: p.templateId, schedule: M.scheduleOf(p) }, p.version);
      p.version = res.version;
      showPmErr('');
    } catch (e) {
      if (e.code === 'duplicate-promo-id' || e.status === 400) {
        showPmErr(e.message);
        await reloadPromotions(); renderPromoTabs(); renderUrl(); lastKey = '';
        return;
      }
      throw e;
    }
  }, 500);
}
$('pmHtml').onclick = () => openHtml();
$('pmTpl').onchange = (e) => {
  if (S.lock && !isOcc()) return; // the pharmacy view changes only the Seasonal promotion's season
  const p = promo();
  if (isOcc() && !S.cur.isMaster) {
    // A pharmacy's season is its own: saved with its content, and only its screens follow.
    content().season = M.occasionOfTemplate(e.target.value) || seasonOf(p);
    changed();
    scene = 0; elapsed = 0; renderDp(); renderJson();
    return;
  }
  p.templateId = e.target.value;
  savePromotion(p);
  scene = 0; elapsed = 0; ver++; renderDp(); renderJson();
};
$('pmName').oninput = (e) => { if (S.lock) return; const p = promo(); p.name = e.target.value || 'Untitled'; savePromotion(p); renderPromoTabs(); lastKey = ''; };
$('pmToken').oninput = (e) => {
  if (S.lock) return;
  const t = M.slug(e.target.value), er = M.promoIdError(t, S.promotions, S.dpTab);
  showPmErr(er); $('pmUrl').textContent = 'promo=' + t;
  if (!er) { promo().promoId = t; savePromotion(promo()); renderUrl(); renderPromoTabs(); ver++; }
};
$('pmToken').onblur = () => { $('pmToken').value = promo().promoId; };
$('pmDel').onclick = async () => {
  if (S.lock) return;
  if (!pmArm) { pmArm = true; $('pmDelTx').textContent = 'Click again to delete for all pharmacies'; setTimeout(() => { pmArm = false; $('pmDelTx').textContent = 'Delete promotion'; }, 4000); return; }
  const p = promo();
  await Save.flush();
  try {
    await Save.queue(`promo:${p.id}`, () => api.deletePromotion(p.id, p.version));
    S.promotions = S.promotions.filter((x) => x.id !== p.id);
    selectPromo(S.promotions[0] && S.promotions[0].id);
  } catch (e) { showPmErr(e.message); }
};
let npTouched = false;
$('newPromoBtn').onclick = () => { if (S.lock) return; $('npType').innerHTML = tplOptions(M.BUILTIN_SCENES, true); $('newPromo').hidden = false; $('npName').value = ''; $('npToken').value = ''; $('npErr').hidden = true; drawSchedule('np', null); $('npSched').hidden = false; npTouched = false; $('npName').focus(); };
$('npCancel').onclick = () => { $('newPromo').hidden = true; };
// A seasonal template's dates are its seasons' own (the Dates card), so a new seasonal promotion has no Schedule.
$('npType').onchange = (e) => { $('npSched').hidden = !!M.occasionOfTemplate(e.target.value); };
$('npName').oninput = (e) => { if (!npTouched) $('npToken').value = M.slug(e.target.value); };
$('npToken').oninput = () => { npTouched = true; };
$('npCreate').onclick = async () => {
  if (S.lock) return;
  const name = $('npName').value.trim(), t = M.slug($('npToken').value);
  const er = name ? M.promoIdError(t, S.promotions) : 'Add a name.';
  const show = (m) => { $('npErr').textContent = m; $('npErr').hidden = !m; };
  show(er); if (er) return;
  $('npCreate').disabled = true;
  try {
    const schedule = $('npSched').hidden ? { type: 'none' } : readSchedule('np');
    const rec = await Save.queue('promo:new', () => api.createPromotion({ name, promoId: t, templateId: $('npType').value, ...(schedule.type === 'annual' ? { schedule } : {}) }));
    S.promotions.push(rec);
    $('newPromo').hidden = true;
    selectPromo(rec.id);
  } catch (e) { show(e.message); }
  finally { $('npCreate').disabled = false; }
};

// ───────────────────────── templates (Edit HTML modal) ─────────────────────────

let tmArm = false;
function hdErr(msg) { $('hdErr').textContent = msg || ''; $('hdErr').hidden = !msg; }
function openHtml() { renderTmeta(); hdTab('bg'); hdErr(''); $('htmlDlg').showModal(); }
function renderTmeta() {
  const T = curT(), ro = tplRO(T), base = M.baseOfKind(T.kind);
  $('hdTitle').textContent = 'Template';
  $('tmName').value = T.name; $('tmName').disabled = ro; $('tmLock').hidden = !ro; $('tmDel').hidden = ro;
  // Pharmacy view: no Clone either, since a clone is a new shared template.
  $('tmClone').hidden = !!S.lock;
  $('tmLockTx').textContent = S.lock ? 'Shared by every pharmacy. Only an administrator can change it.' : 'Built-in template. Clone it to make your own version.';
  tmArm = false; $('tmDelTx').textContent = 'Delete';
  const used = S.promotions.filter((x) => x.templateId === T.id).map((x) => x.name);
  $('tmUsed').textContent = used.length ? 'Used by: ' + used.join(', ') : 'Not used by any promotion';
  $('hdHtml').value = T.html || DEFAULT_HTML[base]; $('hdCss').value = T.css || '';
  $('hdHtml').readOnly = $('hdCss').readOnly = ro;
  $('hdTokens').innerHTML = TEMPLATE_TOKENS[base].map((t) => `<button type="button" data-t="${t}" ${ro ? 'disabled' : ''} title="Insert \${${t}}">\${${t}}</button>`).join('');
  ['bgPbtn', 'bgLbtn', 'bgPrm', 'bgLrm', 'hdReset'].forEach((i) => { $(i).disabled = ro; });
  renderBgs();
}
function hdTab(t) {
  document.querySelectorAll('#hdTabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.t === t));
  document.querySelectorAll('#htmlDlg .dlg-b').forEach((p) => { p.hidden = p.dataset.p !== t; });
  $('hdNote').textContent = tplRO(curT()) ? '' : 'Changes apply to every promotion using this template.';
}
function bgSvg(land, img) {
  const G = geom(land, curT().kind === 'opening-hours'), b = S.cur.colours, p2 = boost(b.primary, 1.8);
  return `<svg viewBox="0 0 ${G.W} ${G.H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block" aria-hidden="true">
   <defs><linearGradient id="bgg${land ? 1 : 0}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f8"/><stop offset="1" stop-color="#e6eaf3"/></linearGradient>
   <linearGradient id="pg${land ? 1 : 0}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${esc(b.primary)}"/><stop offset=".45" stop-color="${p2}"/></linearGradient></defs>
   ${img ? `<image href="${esc(img)}" x="0" y="0" width="${G.W}" height="${G.H}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${G.W}" height="${G.H}" fill="url(#bgg${land ? 1 : 0})"/>`}
   <polygon points="${G.pts.map((p) => p.join(',')).join(' ')}" fill="url(#pg${land ? 1 : 0})"/>
   <polyline points="${G.edge.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${esc(b.accent)}" stroke-width="${land ? 8 : 6}"/></svg>`;
}
const bgUrl = (T, o) => (T.backgrounds && T.backgrounds[o] && T.backgrounds[o].url) || null;
function renderBgs() {
  const T = curT();
  [['P', 'portrait', false], ['L', 'landscape', true]].forEach(([k, o, land]) => {
    const v = bgUrl(T, o), other = bgUrl(T, land ? 'portrait' : 'landscape'), pv = $('bg' + k + 'prev');
    pv.innerHTML = bgSvg(land, v || other) + `<span class="bgcap">${v ? 'Uploaded image' : other ? 'Using the other image' : 'Default: light gradient'}</span>`;
    $('bg' + k + 'rm').hidden = !v;
    $('bg' + k + 'btn').lastChild.textContent = v ? 'Replace' : 'Upload';
  });
}
function shrinkImg(file, W, H) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const sc = Math.min(1, Math.max(W / im.width, H / im.height));
      const c = document.createElement('canvas'); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob((b) => (b ? res(b) : rej(new Error('The image could not be read'))), 'image/webp', 0.82);
    };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('The image could not be read')); };
    im.src = u;
  });
}
/** Put a template record the server returned in place, keeping any local edit still waiting to save. */
function takeTemplate(res, keepText) {
  const i = S.templates.findIndex((t) => t.id === res.id);
  if (i < 0) { S.templates.push(res); return res; }
  const t = S.templates[i];
  const next = keepText ? { ...res, name: t.name, html: t.html, css: t.css } : res;
  S.templates[i] = Object.assign(t, next);
  return t;
}
const tChanged = () => { ver++; lastKey = ''; renderJson(); };
function saveTemplate(T, fields) {
  Save.later(`tpl:${T.id}:${Object.keys(fields).join(',')}`, `tpl:${T.id}`, async () => {
    const body = {}; for (const k of Object.keys(fields)) body[k] = T[k];
    try {
      const res = await api.updateTemplate(T.id, body, T.version);
      T.version = res.version; hdErr('');
    } catch (e) {
      if (e.status === 400) { hdErr(e.message); return; }
      throw e;
    }
  }, 400);
}
$('hdClose').onclick = $('hdDone').onclick = () => $('htmlDlg').close();
$('hdTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) hdTab(b.dataset.t); };
$('tmName').oninput = (e) => { const T = curT(); if (tplRO(T)) return; T.name = e.target.value || 'Untitled template'; saveTemplate(T, { name: 1 }); renderPromoMeta(); renderJson(); };
$('tmClone').onclick = async () => {
  if (S.lock) return;
  const T = curT(), p = promo();
  try {
    const rec = await Save.queue(`tpl:${T.id}`, () => api.cloneTemplate(T.id, `${T.name} copy`));
    S.templates.push(rec);
    p.templateId = rec.id; savePromotion(p);
    tChanged(); renderPromoMeta(); renderTmeta(); renderDp(); $('tmName').focus(); $('tmName').select();
  } catch (e) { hdErr(e.message); }
};
$('tmDel').onclick = async () => {
  const T = curT(); if (tplRO(T)) return;
  if (!tmArm) { tmArm = true; $('tmDelTx').textContent = 'Click again to delete'; setTimeout(() => { tmArm = false; $('tmDelTx').textContent = 'Delete'; }, 4000); return; }
  await Save.flush();
  try {
    await Save.queue(`tpl:${T.id}`, () => api.deleteTemplate(T.id, T.version));
    S.templates = S.templates.filter((t) => t.id !== T.id);
    await reloadPromotions(); // promotions that used it now use the built-in of the same kind
    tChanged(); renderPromoMeta(); renderTmeta(); renderDp();
  } catch (e) { hdErr(e.message); }
};
[['P', 'portrait', 1080, 1920], ['L', 'landscape', 1920, 1080]].forEach(([k, o, W, H]) => {
  $('bg' + k + 'btn').onclick = () => { if (!tplRO(curT())) $('bg' + k + 'in').click(); };
  $('bg' + k + 'in').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const T = curT(); if (tplRO(T)) return;
    try {
      const blob = await shrinkImg(f, W, H);
      const res = await Save.queue(`tpl:${T.id}`, () => api.setBackground(T.id, o, blob));
      takeTemplate(res, true); tChanged(); renderBgs(); hdErr('');
    } catch (err) { hdErr(err.message); }
  };
  $('bg' + k + 'rm').onclick = async () => {
    const T = curT(); if (tplRO(T)) return;
    try { takeTemplate(await Save.queue(`tpl:${T.id}`, () => api.removeBackground(T.id, o)), true); tChanged(); renderBgs(); } catch (err) { hdErr(err.message); }
  };
});
$('hdHtml').oninput = (e) => { const T = curT(); if (tplRO(T)) return; const base = M.baseOfKind(T.kind); T.html = e.target.value.trim() === DEFAULT_HTML[base].trim() ? '' : e.target.value; saveTemplate(T, { html: 1 }); tChanged(); };
$('hdCss').oninput = (e) => { const T = curT(); if (tplRO(T)) return; T.css = e.target.value; saveTemplate(T, { css: 1 }); tChanged(); };
$('hdTokens').onclick = (e) => { const b = e.target.closest('button'); if (!b || tplRO(curT())) return; const ta = $('hdHtml'), v = '${' + b.dataset.t + '}'; ta.setRangeText(v, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
$('hdHtml').onkeydown = $('hdCss').onkeydown = (e) => { if (e.key === 'Tab' && !e.target.readOnly) { e.preventDefault(); e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end'); } };
$('hdReset').onclick = async () => {
  const T = curT(); if (tplRO(T)) return;
  const t = document.querySelector('#hdTabs [aria-selected=true]').dataset.t;
  if (t === 'bg') {
    try {
      for (const o of ['portrait', 'landscape']) if (bgUrl(T, o)) takeTemplate(await Save.queue(`tpl:${T.id}`, () => api.removeBackground(T.id, o)), true);
      renderBgs();
    } catch (err) { hdErr(err.message); }
  } else if (t === 'html') { T.html = ''; $('hdHtml').value = DEFAULT_HTML[M.baseOfKind(T.kind)]; saveTemplate(T, { html: 1 }); }
  else { T.css = ''; $('hdCss').value = ''; saveTemplate(T, { css: 1 }); }
  tChanged();
};

// ───────────────────────── pharmacies ─────────────────────────

function renderStoreSel() {
  const rows = S.pharmacies.map((s) => `<option value="${esc(s.id)}">${esc(s.name || 'New pharmacy')}${s.storeCode ? ' · ' + esc(s.storeCode) : ''}</option>`);
  if (!S.cur.id && !S.cur.isMaster) rows.push(`<option value="">${esc(S.cur.name || 'New pharmacy')}${S.cur.storeCode ? ' · ' + esc(S.cur.storeCode) : ''} (not saved yet)</option>`);
  // The same list feeds Settings' pharmacy picker and the promotions page's Promo preview drop-down; Promo preview
  // also offers the master template, first.
  if (S.lock) {
    // Pharmacy view: only this pharmacy, and it cannot be changed.
    const one = rows.filter((r, i) => S.pharmacies[i] && S.pharmacies[i].id === S.cur.id).join('');
    $('storeSel').innerHTML = $('pvSel').innerHTML = one;
    $('storeSel').disabled = $('pvSel').disabled = true;
  } else {
    $('storeSel').innerHTML = rows.join('');
    $('pvSel').innerHTML = [`<option value="${MASTER_ID}">Master template</option>`, ...rows].join('');
  }
  $('storeSel').value = S.cur.id || '';
  $('pvSel').value = S.cur.isMaster ? MASTER_ID : S.cur.id || '';
  $('resetBtn').hidden = S.cur.isMaster || !sampleFor(S.cur.storeCode);
  $('delBtn').hidden = S.cur.isMaster || S.pharmacies.length < 1 || (S.pharmacies.length < 2 && !!S.cur.id);
  delArm = false; $('delTx').textContent = 'Delete';
}
function detailsError() {
  const msg = !S.cur.name.trim() ? 'Add a pharmacy name.' : M.storeCodeError(S.cur.storeCode, S.pharmacies, S.cur.id);
  return msg;
}
function showCodeErr(msg) { $('codeErr').textContent = msg; $('codeErr').hidden = !msg; $('sCode').style.borderColor = msg && /code/i.test(msg) ? 'var(--err)' : ''; }
function syncListRow() {
  const row = S.pharmacies.find((p) => p.id === S.cur.id);
  if (row) Object.assign(row, { name: S.cur.name, storeCode: S.cur.storeCode, colours: S.cur.colours, logo: S.cur.logo, version: S.cur.version });
}

/** Pharmacy details or branding changed: create the pharmacy once it is valid, or save the change. */
function detailsChanged() {
  ver++; renderJson();
  const er = detailsError();
  showCodeErr(er);
  if (er) return;
  if (!S.cur.id) {
    Save.later('ph:create', 'ph:create', createPharmacy, 700);
    return;
  }
  saveDetails(S.cur);
}

/** Save pharmacy `ph`'s name, store code and colours. */
function saveDetails(ph) {
  const id = ph.id;
  Save.later(`ph:${id}:details`, `ph:${id}`, async () => {
    try {
      const res = await api.updatePharmacy(id, { name: ph.name, storeCode: ph.storeCode, colours: ph.colours }, ph.version);
      ph.version = res.version;
      if (S.cur === ph) { syncListRow(); renderStoreSel(); }
    } catch (e) {
      if (e.code === 'duplicate-store-code' || e.status === 400) { if (S.cur === ph) showCodeErr(e.message); return; }
      throw e;
    }
  });
}

// A new pharmacy is created once its name and store code are valid. The editor stays live while the create is
// in flight, so the create posts a copy of the draft and, when it resolves, saves whatever was edited in the
// meantime (details, and each promotion's content) on the new pharmacy's own chain. Those saves are queued
// before the create's own write finishes, so the status pill reads "Saving…" until they land.
async function createPharmacy() {
  const draft = S.cur;
  if (draft.id || detailsError()) return;
  const sent = M.clone({ storeCode: draft.storeCode, name: draft.name, colours: draft.colours, content: draft.content || {} });
  try {
    const rec = await api.createPharmacy(sent);
    draft.id = rec.id; draft.version = rec.version;
    S.pharmacies.push({ ...rec, content: undefined });
    if (S.cur === draft) { pref.set('pharmacy', rec.id); renderStoreSel(); renderLogo(); renderTokens(); lastKey = ''; }
    saveEditsMadeDuring(draft, sent);
  } catch (e) {
    if (e.code === 'duplicate-store-code' || e.status === 400) { showCodeErr(e.message); return; }
    throw e;
  }
}

/** Save what changed on `ph` since `sent` was posted (see createPharmacy). */
function saveEditsMadeDuring(ph, sent) {
  const edits = M.editsSince(sent, ph);
  if (edits.details) saveDetails(ph);
  for (const promotionId of edits.content) saveContent(ph, promotionId);
}

function bindVal(id, get, set) { const e = $(id); e.value = get() ?? ''; e.oninput = () => { set(e.value); detailsChanged(); }; }
function loadStore() {
  const s = S.cur;
  showMasterChrome(!!s.isMaster);
  bindVal('sName', () => s.name, (v) => { s.name = v; renderStoreSel(); });
  $('sCode').readOnly = !!S.lock;
  bindVal('sCode', () => s.storeCode, (v) => { if (S.lock) return; s.storeCode = M.normStoreCode(v); $('sCode').value = s.storeCode; renderStoreSel(); });
  bindVal('cP', () => s.colours.primary, (v) => { s.colours.primary = v.toLowerCase(); renderLogo(); renderDp(); });
  bindVal('cA', () => s.colours.accent, (v) => { s.colours.accent = v.toLowerCase(); });
  showCodeErr(s.id ? '' : detailsError());
  $('logoIn').value = ''; $('logoErr').hidden = true;
  renderLogo(); renderTokens(); renderDp(); renderUrl(); renderJson(); renderRestore();
  scene = 0; elapsed = 0; lastKey = '';
}
// Tokens set by hand: every token this pharmacy's promotions and templates use (master template included), each
// with a value that, when set, shows on its screens instead of the store's data.
function renderTokens() {
  const s = S.cur, list = M.usedTokens(s, S.promotions, S.templates);
  $('tokEmpty').hidden = list.length > 0;
  $('tokList').innerHTML = list.map((t) => {
    const ph = t.data ? M.TOKEN_SOURCES[t.name] : 'Not set, shows nothing';
    const used = t.promotions.length ? `Used in ${t.promotions.join(', ')}` : 'Not used by any promotion';
    return `<label class="f"><span>\${${esc(t.name)}}</span><input data-token="${esc(t.name)}" value="${esc(t.value)}" placeholder="${esc(ph)}" maxlength="200" autocomplete="off"${s.id ? '' : ' disabled title="Add the pharmacy name and store code first"'}><span class="hint">${esc(used)}</span></label>`;
  }).join('');
  for (const e of $('tokList').querySelectorAll('input[data-token]')) e.oninput = () => {
    s.tokens = M.setToken(s, e.dataset.token, e.value);
    ver++; lastKey = ''; renderJson(); saveTokens(s);
  };
}
/** Save pharmacy `ph`'s hand-set token values. */
function saveTokens(ph) {
  const id = ph.id; if (!id) return;
  Save.later(`ph:${id}:tokens`, `ph:${id}`, async () => {
    const res = await api.updatePharmacy(id, { tokens: ph.tokens || {} }, ph.version);
    ph.version = res.version;
    if (S.cur === ph) syncListRow();
  });
}
function renderLogo() {
  const s = S.cur, url = s.logo && s.logo.url;
  $('logoPrev').innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<span class="hint" style="color:#fff">No logo</span>';
  $('logoPrev').style.background = s.colours.primary;
  $('logoRm').hidden = !url; $('logoBtnTx').textContent = url ? 'Replace logo' : 'Upload logo';
  $('logoBtn').disabled = !s.id; $('logoBtn').title = s.id ? '' : 'Add the pharmacy name and store code first';
}
function logoErr(m) { $('logoErr').textContent = m || ''; $('logoErr').hidden = !m; }
$('logoBtn').onclick = () => $('logoIn').click();
$('logoRm').onclick = async () => {
  const id = S.cur.id;
  try {
    const res = await Save.queue(`ph:${id}`, () => api.removeLogo(id));
    if (S.cur.id === id) { S.cur.logo = null; S.cur.version = res.version; syncListRow(); renderLogo(); ver++; renderJson(); }
  } catch (e) { logoErr(e.message); }
};
$('logoIn').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.type !== 'image/png') { logoErr('Upload a transparent PNG.'); return; }
  const id = S.cur.id;
  try {
    const res = await Save.queue(`ph:${id}`, () => api.setLogo(id, f));
    if (S.cur.id === id) { S.cur.logo = res.logo; S.cur.version = res.version; syncListRow(); renderLogo(); logoErr(''); ver++; renderJson(); }
  } catch (err) { logoErr(err.message); }
};

async function selectPharmacy(id) {
  await Save.flush();
  const rec = await api.getPharmacy(id);
  S.cur = M.ownSeasonal({ ...rec, content: rec.content || {} }, S.promotions);
  S.note = null;
  if (!S.lock) pref.set('pharmacy', id); // the pharmacy view never changes the admin view's remembered pharmacy
  renderStoreSel(); loadStore();
}
function newDraft() {
  // A new pharmacy starts with each promotion's master template and inherits every section of it.
  return M.ownSeasonal({ id: null, storeCode: '', name: '', colours: { primary: '#0f1050', accent: '#5ee6b0' }, logo: null, content: M.newPharmacyContent(S.promotions, S.templates) }, S.promotions);
}
let delArm = false;
$('storeSel').onchange = $('pvSel').onchange = (e) => { if (S.lock) return; if (e.target.value === MASTER_ID) selectMaster().catch(Save.fail); else if (e.target.value) selectPharmacy(e.target.value).catch(Save.fail); };
// Adding a pharmacy, and its details and branding, live in Settings.
$('addBtn').onclick = async () => {
  if (S.lock) return;
  await Save.flush();
  S.cur = newDraft(); renderStoreSel(); loadStore();
  if ($('settingsView').hidden) $('setBtn').click();
  $('sName').focus();
};
$('delBtn').onclick = async () => {
  if (S.lock) return;
  if (!delArm) { delArm = true; $('delTx').textContent = 'Click again to delete'; setTimeout(() => { delArm = false; $('delTx').textContent = 'Delete'; }, 4000); return; }
  await Save.flush();
  const s = S.cur;
  try {
    if (s.id) await Save.queue(`ph:${s.id}`, () => api.deletePharmacy(s.id, s.version));
    S.pharmacies = S.pharmacies.filter((p) => p.id !== s.id);
    if (S.pharmacies.length) await selectPharmacy(S.pharmacies[0].id);
    else { S.cur = newDraft(); renderStoreSel(); loadStore(); }
  } catch (e) { Save.fail(e); }
};

// Reset: put a launch pharmacy back to its sample (seed) content, when this deployment serves the seed fixtures.
const sampleFor = (code) => (S.sample && code ? S.sample.find((p) => p.storeCode === code) : null);
async function loadSample() {
  try {
    const r = await fetch(new URL('../seed/fixtures/pharmacies.json', location.href), { cache: 'no-store' });
    if (r.ok) S.sample = (await r.json()).pharmacies || null;
  } catch { S.sample = null; }
}
$('resetBtn').onclick = async () => {
  const s = S.cur, o = sampleFor(s.storeCode); if (!o || !s.id || S.lock) return;
  await Save.flush();
  const contentNext = { ...(s.content || {}) };
  for (const p of S.promotions) if (o.content && o.content[p.promoId]) contentNext[p.id] = JSON.parse(JSON.stringify(o.content[p.promoId]));
  try {
    await Save.queue(`ph:${s.id}`, async () => {
      const res = await api.updatePharmacy(s.id, { name: o.name, colours: o.colours, content: contentNext }, s.version);
      s.version = res.version;
      if (o.logo && o.logo.file) {
        const b64 = (await (await fetch(new URL(`../seed/fixtures/${o.logo.file}`, location.href))).text()).replace(/\s+/g, '');
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await api.setLogo(s.id, new Blob([bytes], { type: o.logo.contentType }));
      }
    });
    await selectPharmacy(s.id);
    const row = S.pharmacies.find((p) => p.id === s.id); if (row) Object.assign(row, { name: S.cur.name }); renderStoreSel();
  } catch (e) { Save.fail(e); }
};

// ───────────────────────── settings ─────────────────────────

$('setBtn').onclick = () => {
  const on = $('settingsView').hidden;
  $('settingsView').hidden = !on; $('contentView').hidden = on; $('toolbar').classList.toggle('inSettings', on);
  $('setBtn').setAttribute('aria-pressed', on); $('setTx').textContent = on ? 'Back to promotions' : 'Settings';
  $('setBtn').firstChild.textContent = on ? 'arrow_back' : 'settings';
  if (on) { if (!S.lock) loadPhApi(); if (!S.cur.isMaster) renderTokens(); }
  // Settings works on pharmacies, never the master template: show the first pharmacy there.
  if (on && S.cur && S.cur.isMaster && S.pharmacies[0]) selectPharmacy(S.pharmacies[0].id).catch(Save.fail);
};

function apiErr(m) { $('apiErr').textContent = m || ''; $('apiErr').hidden = !m; }
function renderApi({ clearToken = false } = {}) {
  const a = S.phApi; if (!a) return;
  if (document.activeElement !== $('apiBase')) $('apiBase').value = (a.baseUrls || []).join(', ');
  if (clearToken) $('apiTok').value = '';
  const t = a.token || {};
  $('apiTok').placeholder = t.set ? 'Paste a new token to replace it' : 'Paste token';
  $('apiState').innerHTML = t.set ? `<span class="dot" style="background:var(--ok)"></span>Token saved, encrypted · ••••${esc(t.last4)}` : '<span class="dot" style="background:var(--warn)"></span>No token saved';
  $('apiRm').hidden = !t.set;
  $('apiSave').lastChild.textContent = t.set ? 'Replace token' : 'Save token';
}
async function loadPhApi() {
  try { S.phApi = await api.getPhApi(); renderApi({ clearToken: true }); apiErr(''); } catch (e) { apiErr(e.message); }
}
const baseUrls = () => $('apiBase').value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
$('apiBase').onchange = async () => {
  if (S.lock) return;
  const list = baseUrls(); if (!list.length) { apiErr('Add the API base URL, starting with https://.'); return; }
  try { S.phApi = await Save.queue('phapi', () => api.savePhApi({ baseUrls: list })); renderApi(); apiErr(''); } catch (e) { apiErr(e.message); }
};
$('apiSave').onclick = async () => {
  if (S.lock) return;
  const t = $('apiTok').value.trim(), list = baseUrls();
  if (!list.length || !list.every((u) => /^https:\/\/[^\s/]+/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(u))) { apiErr('Add the API base URL, starting with https://.'); return; }
  if (!t) { apiErr('Paste the full API token.'); return; }
  try {
    S.phApi = await Save.queue('phapi', () => api.savePhApi({ baseUrls: list, token: t }));
    $('apiTok').value = ''; renderApi({ clearToken: true }); apiErr('');
  } catch (e) { $('apiTok').value = ''; apiErr(e.message); }
};
$('apiRm').onclick = async () => {
  if (S.lock) return;
  try { S.phApi = await Save.queue('phapi', () => api.removePhApiToken()); renderApi({ clearToken: true }); apiErr(''); } catch (e) { apiErr(e.message); }
};

$('cpUrl').onclick = async () => {
  const t = urlText(); let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch (e) {}
  $('cpTx').textContent = ok ? 'Copied' : 'Copy failed, select it from the tooltip';
  setTimeout(() => { $('cpTx').textContent = 'Copy experience URL'; }, 1600);
};

// ───────────────────────── start ─────────────────────────

async function main() {
  session = await signIn({ ...(CONFIG.auth || {}), apiBase: CONFIG.apiBase });
  api = createClient({ apiBase: CONFIG.apiBase, getToken: session.getToken });
  let me;
  try {
    me = await api.me();
  } catch (e) {
    if (session.ph) showBlocked('Access denied', e.status === 403 ? 'Your Personalisation Hub account cannot open this page.' : 'Your Personalisation Hub session was not accepted. Sign in to Personalisation Hub again.');
    else if (e.status === 403) showBlocked('Admin role required', 'You are signed in, but this account does not have the admin role, so it cannot open the editor. Ask an administrator to grant it.', { signOut: session.signOut });
    else if (e.status === 401) showBlocked('Not signed in', 'Your sign-in was not accepted. Sign out and sign in again.', { signOut: session.signOut });
    else showBlocked('The editor could not load', e.message, { signOut: session.signOut });
    return;
  }
  const [pharmacies, promotions, templates, services] = await Promise.all([api.listPharmacies(), api.listPromotions(), api.listTemplates(), api.listServices(), loadSample()]);
  S.pharmacies = pharmacies; S.promotions = M.orderPromotions(promotions); S.templates = templates; S.services = services;
  S.dpTab = S.promotions[0] && S.promotions[0].id;
  // Pharmacy view: admin/?store=<store code> (or ?storeCode=) opens the editor locked to that one pharmacy.
  // A store user (a Retail Admin session) is always locked to one of their own stores: the server only ever
  // returns and accepts those (config-api/src/service.js), and ?store= is just which of them to open. A store
  // code that is not theirs is refused here rather than quietly swapped for their own.
  const asked = M.storeFromQuery(location.search);
  const mineOnly = !!me && me.admin !== true;
  const own = mineOnly ? (Array.isArray(me.stores) ? me.stores : []) : null;
  if (mineOnly && (!own.length || (asked && !own.includes(asked)))) {
    showBlocked('Access denied', asked ? `Your Personalisation Hub sign-in does not include the store ${asked}.` : 'Your Personalisation Hub sign-in has no store to edit.');
    return;
  }
  const lock = asked || (mineOnly ? own.find((c) => S.pharmacies.some((p) => p.storeCode === c)) || own[0] : null);
  if (lock) {
    const mine = S.pharmacies.find((p) => p.storeCode === lock);
    if (!mine && mineOnly) { showBlocked('Pharmacy not set up', `The store ${lock} has no display promotions yet. Ask your administrator to add it.`); return; }
    if (!mine) { showBlocked('Pharmacy not found', `No pharmacy has the store code ${lock}. Check the link, or open the editor without a store code.`, { signOut: session.signOut }); return; }
    S.lock = lock;
    applyLock();
    hideGate(); $('app').hidden = false;
    await selectPharmacy(mine.id);
    setOrient(orient); fit();
    requestAnimationFrame(loop);
    try { document.fonts.ready.then(() => { lastKey = ''; }); document.fonts.addEventListener('loadingdone', () => { lastKey = ''; }); } catch (e) {}
    return;
  }
  hideGate(); $('app').hidden = false;
  const want = pref.get('pharmacy');
  const first = S.pharmacies.find((p) => p.id === want) || S.pharmacies[0];
  if (want === MASTER_ID) await selectMaster();
  else if (first) await selectPharmacy(first.id);
  else { S.cur = newDraft(); renderStoreSel(); loadStore(); }
  setOrient(orient); fit();
  requestAnimationFrame(loop);
  try { document.fonts.ready.then(() => { lastKey = ''; }); document.fonts.addEventListener('loadingdone', () => { lastKey = ''; }); } catch (e) {}
}

/** Pharmacy view: titled "Display Promotions" and showing only the promotions. The administrator's controls are
 *  hidden: the Promo preview drop-down, Settings (other pharmacies, details, tokens, branding, the PH API), the
 *  master template, creating or deleting promotions, every scene timing (hideTimings), the ${Suburb} hint, the
 *  remote config, and Copy experience URL with the playback duration. "Restore to default"
 *  replaces "shared by all pharmacies" (renderRestore), and Add promotion stops at 3 slots (maxSlots). Every write
 *  handler checks S.lock as well. */
function applyLock() {
  document.title = $('pageTitle').textContent = 'Display Promotions';
  $('toolbar').hidden = true; // Promo preview, the lock pill and Settings
  for (const id of ['newPromoBtn', 'newPromo', 'settingsView']) $(id).hidden = true;
  // Administrator-only page furniture: the ${Suburb} hint, the remote config, and Copy experience URL with the
  // playback duration and its tooltip (the campaign is set up by an administrator in the full editor).
  for (const id of ['dpHint', 'cfgBox', 'cpRow']) $(id).hidden = true;
}

// Hook for the editor's end-to-end tests.
window.pharmacyAdmin = { get ready() { return !!S.cur; }, state: S, flush: () => Save.flush(), pending: () => Save.pending() };

main().catch((e) => showBlocked('The editor could not load', (e && e.message) || String(e), session ? { signOut: session.signOut } : {}));
