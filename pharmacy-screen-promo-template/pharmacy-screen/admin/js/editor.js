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
import { storeModel, resolvePromotion, sequence, sceneName, renderScene, renderMessage, DEFAULT_HTML, footerConfig, boost, tileTop } from '../../js/render.js';
import { esc, TEMPLATE_TOKENS } from '../../js/tokens.js';
import { geom } from '../../js/fit-text.js';
import { parseOpeningHours, weeklyRows } from '../../js/hours.js';

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
  cur: null, // the selected pharmacy, full record with content; id null while it is a new, unsaved pharmacy
  dpTab: null, // selected promotion's record id
  record: null, // Location API campaign_data for the preview (looked up in Settings), or null for sample data
  recordDevice: '',
  phApi: null,
  sample: null, // seed fixtures for Reset, if this deployment serves them
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
const tmpl = (id) => M.findTemplate(S.templates, id);
const curT = () => tmpl(promo().templateId);

/** This pharmacy's content for a promotion, with the fields its current template needs. */
function content(id = S.dpTab) {
  const p = promo(id);
  const all = S.cur.content || (S.cur.content = {});
  const b = baseOf(id), c = all[p.id];
  const fits = b === 'hours' ? c && Array.isArray(c.headlines) && c.headlines.length >= 3 : c && Array.isArray(c.slots) && c.close && typeof c.greeting === 'string';
  if (!fits) all[p.id] = c ? M.ensureContent(c, b) : M.newContentFor(p, b);
  return all[p.id];
}

const previewCode = () => S.cur.storeCode || 'NEW';

function previewModel() {
  const ph = { ...S.cur, storeCode: previewCode() };
  const cfg = M.renderConfig({ pharmacies: [ph], promotions: S.promotions, templates: S.templates });
  content();
  const store = storeModel(M.campaignForPreview(S.record, previewCode(), S.cur.name), cfg);
  const play = resolvePromotion(cfg, store, promo().promoId);
  return { cfg, store, play };
}

// ───────────────────────── preview ─────────────────────────

let ver = 0, scene = 0, elapsed = 0, playing = true, last = performance.now(), lastKey = '', model = null;
const seq = () => (model ? sequence(model.play) : [{ k: 0, t: 3 }]);

function fit() {
  const st = $('stage'), w = st.clientWidth;
  $('screen').style.transform = `scale(${w / (orient === 'landscape' ? 1920 : 1080)})`;
}
new ResizeObserver(fit).observe($('stage'));

function renderScreen(force) {
  if (!S.cur || !S.promotions.length) return;
  const minute = Math.floor(Date.now() / 60000);
  const key = [S.cur.id, S.dpTab, scene, ver, orient, minute].join('|');
  if (key === lastKey && !force) return;
  const sceneChanged = !lastKey.startsWith([S.cur.id, S.dpTab, scene].join('|') + '|');
  lastKey = key;
  const el = $('screen');
  try {
    model = previewModel();
    if (scene >= sequence(model.play).length) scene = 0;
    renderScene(el, { store: model.store, play: model.play, orientation: orient, scene, enter: sceneChanged });
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
  if (isHours()) { const ed = $('ch' + i); return ed && ed.closest('.rtf'); }
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
  let i = -1;
  const r = e.target.closest('.rtf'), sl = e.target.closest('.slot');
  if (isHours() && r) { const ed = r.querySelector('.rt'); if (ed) i = +ed.id.slice(2); }
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

/** Something in the selected promotion's content changed. */
function changed() {
  ver++;
  saveContent(S.cur, promo().id);
  renderJson();
}

function renderUrl() { $('cpTip').textContent = urlText(); }
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

function renderDp() {
  closePicker(); setTimeout(() => markEditor());
  renderPromoTabs(); renderPromoMeta();
  const B = $('dpBody');
  if (!S.promotions.length) { B.innerHTML = '<span class="hint">No promotions yet. Add one with New promotion.</span>'; return; }
  const s = S.cur, d = content();
  if (isHours()) {
    B.innerHTML = `<div style="display:grid;gap:12px">${d.headlines.map((h, i) => rt('ch' + i, 'Headline ' + (i + 1), h)).join('')}</div>
     <label class="chk"><input type="checkbox" id="cAddr" ${d.showAddress ? 'checked' : ''}>Show address under phone</label>`;
    d.headlines.forEach((h, i) => bindRt('ch' + i, (v) => { d.headlines[i] = v; }));
    $('cAddr').onchange = (e) => { d.showAddress = e.target.checked; changed(); };
    return;
  }
  const f = (id, lab, val) => `<label class="f"><span>${lab}</span><input id="${id}" value="${esc(val)}"></label>`;
  const F = footerConfig(d);
  B.innerHTML = `<span class="pill" id="loopLen" style="justify-self:start"></span><div><div class="slot"><div class="slot-h">Greeting<label class="dur" style="margin-left:auto" title="How long this shows on screen"><span class="ms">timer</span><input type="number" id="ddur" min="1" max="60" step="0.5" value="${+d.introDur || 3}" aria-label="Seconds on screen">s</label></div><div class="stack">${rt('dg', 'Headline', d.greeting)}${f('dit', 'Line 1', d.introTitle)}${f('dis', 'Line 2', d.introSub)}</div></div></div>
   <div id="slotList" style="display:grid;gap:12px">${d.slots.map((x, i) => `<div class="slot" data-i="${i}"><div class="slot-h"><span class="ms drag" title="Drag to reorder" aria-label="Drag to reorder">drag_indicator</span><span class="ic" style="background:${esc(s.colours.primary)}"><span class="ms">${esc(x.icon)}</span></span>Promotion ${i + 1}<span class="hint" style="font-weight:400">· ${esc(x.label)}</span>
      <span style="margin-left:auto;display:flex;gap:2px;align-items:center"><label class="dur" title="How long this shows on screen"><span class="ms">timer</span><input type="number" id="s${i}dur" min="1" max="60" step="0.5" value="${+x.dur || 2}" aria-label="Seconds on screen">s</label><button type="button" class="text mv" data-mv="-1" ${i ? '' : 'disabled'} title="Move up" aria-label="Move up"><span class="ms">arrow_upward</span></button><button type="button" class="text mv" data-mv="1" ${i < d.slots.length - 1 ? '' : 'disabled'} title="Move down" aria-label="Move down"><span class="ms">arrow_downward</span></button>
      <button type="button" class="text del" ${d.slots.length > 1 ? '' : 'disabled'} style="color:var(--err)" title="Delete promotion" aria-label="Delete promotion ${i + 1}"><span class="ms">delete</span><span class="delt"></span></button></span></div>
     <div class="stack">${rt(`s${i}title`, 'Headline', x.title)}
     ${f(`s${i}sub`, 'Accent line', x.sub)}
     <div class="grid2">${f(`s${i}label`, 'Service chip label', x.label)}<div class="f icp-wrap"><span style="font-size:12px;color:var(--muted)">Icon</span><button type="button" class="icp" id="s${i}icon" aria-haspopup="listbox" aria-expanded="false"><span class="cur"><span class="ms">${esc(x.icon)}</span><span>${esc(String(x.icon).replace(/_/g, ' '))}</span></span><span class="ms">expand_more</span></button></div></div>
     ${f(`s${i}line1`, 'Line 1', x.line1)}
     ${f(`s${i}line2`, 'Line 2', x.line2)}</div></div>`).join('')}</div>
   <button type="button" id="addSlot" ${d.slots.length >= 6 ? 'disabled' : ''} style="justify-self:start" aria-expanded="false"><span class="ms">add</span>Add promotion</button>
   <div class="svcpick" id="svcPick" hidden>
     <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="search" id="svcQ" placeholder="Search ${S.services.length} services" style="flex:1;min-width:180px" autocomplete="off">
       <label class="chk"><input type="checkbox" id="svcMine" checked>Offered by ${esc(s.name || 'this pharmacy')}</label>
       <button type="button" class="text" id="svcBlank"><span class="ms">edit_note</span>Blank promotion</button></div>
     <div class="svclist" id="svcList"></div></div>
   <div class="slot"><div class="slot-h">Walk-in close<label class="dur" style="margin-left:auto" title="How long this shows on screen"><span class="ms">timer</span><input type="number" id="cdur" min="1" max="60" step="0.5" value="${+d.close.dur || 2}" aria-label="Seconds on screen">s</label></div><div class="stack">${rt('cl1', 'Headline', d.close.title)}${f('cl2', 'Accent line', d.close.sub)}${f('cl3', 'Line 1', d.close.line1)}${f('cl4', 'Line 2', d.close.line2)}</div></div>
   <div class="slot" id="footSlot"><div class="slot-h">Open today bar<label class="chk" style="margin-left:auto;font-weight:400"><input type="checkbox" id="ftShow" ${F.show !== false ? 'checked' : ''}>Show</label></div>
     <div class="stack">${rt('ftOpen', 'While open', F.open)}${rt('ftClosing', 'Last 30 minutes', F.closing)}${rt('ftBefore', 'Before opening', F.before)}${rt('ftClosed', 'After closing', F.closed)}</div>
     <span class="hint">Use \${CloseTime} and \${OpenTime} for today's hours.</span></div>`;
  const on = (id, fn) => { $(id).oninput = (e) => { fn(e.target.value); changed(); }; };
  const total = () => { const t = M.loopSeconds(d); $('loopLen').textContent = `Loop ${t % 1 ? t.toFixed(1) : t}s`; };
  $('ddur').oninput = (e) => { d.introDur = M.clampDur(e.target.value); changed(); total(); };
  $('cdur').oninput = (e) => { d.close.dur = M.clampDur(e.target.value); changed(); total(); };
  d.slots.forEach((x, i) => { $(`s${i}dur`).oninput = (e) => { x.dur = M.clampDur(e.target.value); changed(); total(); }; });
  total();
  bindRt('dg', (v) => { d.greeting = v; }); on('dit', (v) => { d.introTitle = v; }); on('dis', (v) => { d.introSub = v; });
  const reflow = () => { scene = 0; elapsed = 0; lastKey = ''; changed(); renderDp(); };
  const drawSvc = () => {
    const used = new Set(d.slots.map((x) => x.svc));
    const groups = M.filterServices(S.services, { q: $('svcQ').value, storeCode: s.storeCode, mine: $('svcMine').checked });
    const names = (codes) => (codes || []).map((c) => esc((S.pharmacies.find((p) => p.storeCode === c) || {}).name || c)).join(' · ');
    $('svcList').innerHTML = groups.length ? groups.map((g) => `<div class="svccat">${esc(g.category)}</div>` + g.services.map((v) => `<button type="button" class="svc" data-id="${esc(v.id)}" ${used.has(v.id) ? 'aria-pressed="true"' : ''}>
      <span class="ic" style="background:linear-gradient(145deg,${tileTop(s.colours.primary)},${esc(s.colours.primary)})"><span class="ms">${esc(v.icon)}</span></span>
      <span class="svct"><b>${esc(v.headline || v.label)}</b><span>${esc(v.accent)}</span><span class="svcat">${names(v.offeredBy)}</span></span>
      ${used.has(v.id) ? '<span class="hint">Added</span>' : ''}</button>`).join('')).join('')
      : `<div class="hint">No services match. Clear the search${$('svcMine').checked ? ' or untick the filter' : ''}.</div>`;
  };
  $('addSlot').onclick = () => { const p = $('svcPick'); p.hidden = !p.hidden; $('addSlot').setAttribute('aria-expanded', !p.hidden); if (!p.hidden) { drawSvc(); $('svcQ').focus(); } };
  $('svcQ').oninput = drawSvc; $('svcMine').onchange = drawSvc;
  $('svcBlank').onclick = () => { d.slots.push(M.blankSlot()); reflow(); };
  $('svcList').onclick = (e) => { const b = e.target.closest('.svc'); if (!b) return; const v = S.services.find((x) => x.id === b.dataset.id); if (v) { d.slots.push(M.serviceToSlot(v)); reflow(); } };
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
      if (!armed) { armed = true; del.querySelector('.delt').textContent = 'Confirm'; setTimeout(() => { armed = false; if (del.isConnected) del.querySelector('.delt').textContent = ''; }, 3000); return; }
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
}

// ───────────────────────── promotions (shared) ─────────────────────────

function selectPromo(id) {
  S.dpTab = id; $('newPromo').hidden = true; renderDp();
  scene = 0; elapsed = 0; renderUrl(); renderJson(); lastKey = '';
}
$('dpTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) selectPromo(b.dataset.dp); };
function renderPromoTabs() {
  $('dpTabs').innerHTML = S.promotions.map((x) => `<button role="tab" data-dp="${esc(x.id)}" aria-selected="${x.id === S.dpTab}" title="promo=${esc(x.promoId)}"><span class="ms" style="font-size:16px">${isHours(x.id) ? 'schedule' : 'campaign'}</span>${esc(x.name)}</button>`).join('');
}
function tplOptions(sel) {
  const g = (lab, arr) => (arr.length ? `<optgroup label="${lab}">${arr.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>` : '');
  return g('Built-in', S.templates.filter((t) => t.builtIn)) + g('Custom', S.templates.filter((t) => !t.builtIn));
}
let pmArm = false;
function renderPromoMeta() {
  const x = promo();
  $('promoMeta').hidden = !x;
  if (!x) return;
  $('pmName').value = x.name; $('pmToken').value = x.promoId; $('pmTpl').innerHTML = tplOptions(x.templateId);
  $('pmUrl').textContent = 'promo=' + x.promoId; $('pmErr').hidden = true; $('pmDel').hidden = S.promotions.length < 2;
  pmArm = false; $('pmDelTx').textContent = 'Delete promotion';
}
function showPmErr(msg) { $('pmErr').textContent = msg; $('pmErr').hidden = !msg; }

async function reloadPromotions() {
  S.promotions = M.orderPromotions(await api.listPromotions());
  if (!S.promotions.some((p) => p.id === S.dpTab)) S.dpTab = S.promotions[0] && S.promotions[0].id;
}

function savePromotion(p) {
  Save.later(`promo:${p.id}`, `promo:${p.id}`, async () => {
    try {
      const res = await api.updatePromotion(p.id, { name: p.name, promoId: p.promoId, templateId: p.templateId }, p.version);
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
  const p = promo(); p.templateId = e.target.value;
  savePromotion(p);
  scene = 0; elapsed = 0; ver++; renderDp(); renderJson();
};
$('pmName').oninput = (e) => { const p = promo(); p.name = e.target.value || 'Untitled'; savePromotion(p); renderPromoTabs(); lastKey = ''; };
$('pmToken').oninput = (e) => {
  const t = M.slug(e.target.value), er = M.promoIdError(t, S.promotions, S.dpTab);
  showPmErr(er); $('pmUrl').textContent = 'promo=' + t;
  if (!er) { promo().promoId = t; savePromotion(promo()); renderUrl(); renderPromoTabs(); ver++; }
};
$('pmToken').onblur = () => { $('pmToken').value = promo().promoId; };
$('pmDel').onclick = async () => {
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
$('newPromoBtn').onclick = () => { $('npType').innerHTML = tplOptions(M.BUILTIN_SCENES); $('newPromo').hidden = false; $('npName').value = ''; $('npToken').value = ''; $('npErr').hidden = true; npTouched = false; $('npName').focus(); };
$('npCancel').onclick = () => { $('newPromo').hidden = true; };
$('npName').oninput = (e) => { if (!npTouched) $('npToken').value = M.slug(e.target.value); };
$('npToken').oninput = () => { npTouched = true; };
$('npCreate').onclick = async () => {
  const name = $('npName').value.trim(), t = M.slug($('npToken').value);
  const er = name ? M.promoIdError(t, S.promotions) : 'Add a name.';
  const show = (m) => { $('npErr').textContent = m; $('npErr').hidden = !m; };
  show(er); if (er) return;
  $('npCreate').disabled = true;
  try {
    const rec = await Save.queue('promo:new', () => api.createPromotion({ name, promoId: t, templateId: $('npType').value }));
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
  const T = curT(), ro = !!T.builtIn, base = M.baseOfKind(T.kind);
  $('hdTitle').textContent = 'Template';
  $('tmName').value = T.name; $('tmName').disabled = ro; $('tmLock').hidden = !ro; $('tmDel').hidden = ro;
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
  $('hdNote').textContent = curT().builtIn ? '' : 'Changes apply to every promotion using this template.';
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
$('tmName').oninput = (e) => { const T = curT(); if (T.builtIn) return; T.name = e.target.value || 'Untitled template'; saveTemplate(T, { name: 1 }); renderPromoMeta(); renderJson(); };
$('tmClone').onclick = async () => {
  const T = curT(), p = promo();
  try {
    const rec = await Save.queue(`tpl:${T.id}`, () => api.cloneTemplate(T.id, `${T.name} copy`));
    S.templates.push(rec);
    p.templateId = rec.id; savePromotion(p);
    tChanged(); renderPromoMeta(); renderTmeta(); renderDp(); $('tmName').focus(); $('tmName').select();
  } catch (e) { hdErr(e.message); }
};
$('tmDel').onclick = async () => {
  const T = curT(); if (T.builtIn) return;
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
  $('bg' + k + 'btn').onclick = () => { if (!curT().builtIn) $('bg' + k + 'in').click(); };
  $('bg' + k + 'in').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const T = curT();
    try {
      const blob = await shrinkImg(f, W, H);
      const res = await Save.queue(`tpl:${T.id}`, () => api.setBackground(T.id, o, blob));
      takeTemplate(res, true); tChanged(); renderBgs(); hdErr('');
    } catch (err) { hdErr(err.message); }
  };
  $('bg' + k + 'rm').onclick = async () => {
    const T = curT();
    try { takeTemplate(await Save.queue(`tpl:${T.id}`, () => api.removeBackground(T.id, o)), true); tChanged(); renderBgs(); } catch (err) { hdErr(err.message); }
  };
});
$('hdHtml').oninput = (e) => { const T = curT(); if (T.builtIn) return; const base = M.baseOfKind(T.kind); T.html = e.target.value.trim() === DEFAULT_HTML[base].trim() ? '' : e.target.value; saveTemplate(T, { html: 1 }); tChanged(); };
$('hdCss').oninput = (e) => { const T = curT(); if (T.builtIn) return; T.css = e.target.value; saveTemplate(T, { css: 1 }); tChanged(); };
$('hdTokens').onclick = (e) => { const b = e.target.closest('button'); if (!b || curT().builtIn) return; const ta = $('hdHtml'), v = '${' + b.dataset.t + '}'; ta.setRangeText(v, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
$('hdHtml').onkeydown = $('hdCss').onkeydown = (e) => { if (e.key === 'Tab' && !e.target.readOnly) { e.preventDefault(); e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end'); } };
$('hdReset').onclick = async () => {
  const T = curT(); if (T.builtIn) return;
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
  if (!S.cur.id) rows.push(`<option value="">${esc(S.cur.name || 'New pharmacy')}${S.cur.storeCode ? ' · ' + esc(S.cur.storeCode) : ''} (not saved yet)</option>`);
  $('storeSel').innerHTML = rows.join('');
  $('storeSel').value = S.cur.id || '';
  $('resetBtn').hidden = !sampleFor(S.cur.storeCode);
  $('delBtn').hidden = S.pharmacies.length < 1 || (S.pharmacies.length < 2 && !!S.cur.id);
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
    if (S.cur === draft) { pref.set('pharmacy', rec.id); renderStoreSel(); renderLogo(); lastKey = ''; }
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
  bindVal('sName', () => s.name, (v) => { s.name = v; renderStoreSel(); });
  bindVal('sCode', () => s.storeCode, (v) => { s.storeCode = M.normStoreCode(v); $('sCode').value = s.storeCode; renderStoreSel(); });
  bindVal('cP', () => s.colours.primary, (v) => { s.colours.primary = v.toLowerCase(); renderLogo(); renderDp(); });
  bindVal('cA', () => s.colours.accent, (v) => { s.colours.accent = v.toLowerCase(); });
  showCodeErr(s.id ? '' : detailsError());
  $('logoIn').value = ''; $('logoErr').hidden = true;
  renderLogo(); renderDp(); renderUrl(); renderJson();
  scene = 0; elapsed = 0; lastKey = '';
  loadRecordFor(s);
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
  S.cur = { ...rec, content: rec.content || {} };
  pref.set('pharmacy', id);
  renderStoreSel(); loadStore();
}
function newDraft() {
  return { id: null, storeCode: '', name: '', colours: { primary: '#0f1050', accent: '#5ee6b0' }, logo: null, content: M.newPharmacyContent(S.promotions, S.templates) };
}
let delArm = false;
$('storeSel').onchange = (e) => { if (e.target.value) selectPharmacy(e.target.value).catch(Save.fail); };
$('addBtn').onclick = async () => {
  await Save.flush();
  S.cur = newDraft(); renderStoreSel(); loadStore();
  if (!$('settingsView').hidden) $('setBtn').click();
  $('sName').focus();
};
$('delBtn').onclick = async () => {
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
  const s = S.cur, o = sampleFor(s.storeCode); if (!o || !s.id) return;
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
  $('setBtn').setAttribute('aria-pressed', on); $('setTx').textContent = on ? 'Back to pharmacy content' : 'Settings';
  $('setBtn').firstChild.textContent = on ? 'arrow_back' : 'settings';
  if (on) loadPhApi();
};

const devKey = (code) => 'device-' + code;
function renderRecord() {
  const r = S.record;
  $('recBody').hidden = !r;
  $('pvData').hidden = false;
  $('pvData').textContent = r ? `Store data: ${S.recordDevice}` : 'Sample store data';
  $('pvData').title = r ? 'From the Location API, through the server-side proxy' : 'Look up one of this store’s devices in Settings to preview with its real store data';
  if (!r) return;
  $('recFields').innerHTML = M.storeFields(r).map((f) => `<div class="f${f.label === 'Address' ? '" style="grid-column:1/-1' : ''}"><span>${esc(f.label)} <code class="kp">${esc(f.path)}</code></span><div class="ro-val">${esc(f.value)}</div></div>`).join('');
  const rows = weeklyRows(parseOpeningHours((r.data || r).store_info && (r.data || r).store_info.opening_hours));
  $('hours').innerHTML = rows.map((x) => `<span class="d">${x.name}</span><span class="${x.text ? '' : 'off'}">${esc(x.text || 'Closed')}</span>`).join('');
  $('apiJson').textContent = JSON.stringify(r, null, 2);
}
function devErr(m) { $('devErr').textContent = m || ''; $('devErr').hidden = !m; }
async function lookUp(device, { quiet = false } = {}) {
  const forId = S.cur && S.cur.id;
  try {
    const r = await api.campaignData(device);
    if ((S.cur && S.cur.id) !== forId) return;
    S.record = { data: r.data };
    S.recordDevice = device;
    if (S.cur.storeCode) pref.set(devKey(S.cur.storeCode), device);
    const code = r.data && r.data.store_location && r.data.store_location.store_code;
    devErr(code && S.cur.storeCode && code.toUpperCase() !== S.cur.storeCode ? `This device belongs to store ${code}, not ${S.cur.storeCode}. The preview uses its store data anyway.` : '');
  } catch (e) {
    if ((S.cur && S.cur.id) !== forId) return;
    S.record = null; S.recordDevice = '';
    if (!quiet) devErr(e.message);
  }
  ver++; renderRecord();
}
function loadRecordFor(s) {
  S.record = null; S.recordDevice = '';
  const dev = s.storeCode ? pref.get(devKey(s.storeCode)) : null;
  $('devId').value = dev || ''; devErr('');
  renderRecord();
  if (dev) lookUp(dev, { quiet: true });
}
$('devGo').onclick = () => { const v = $('devId').value.trim(); if (!v) { devErr('Enter a device ID.'); return; } lookUp(v); };
$('devId').onkeydown = (e) => { if (e.key === 'Enter') $('devGo').click(); };

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
  const list = baseUrls(); if (!list.length) { apiErr('Add the API base URL, starting with https://.'); return; }
  try { S.phApi = await Save.queue('phapi', () => api.savePhApi({ baseUrls: list })); renderApi(); apiErr(''); } catch (e) { apiErr(e.message); }
};
$('apiSave').onclick = async () => {
  const t = $('apiTok').value.trim(), list = baseUrls();
  if (!list.length || !list.every((u) => /^https:\/\/[^\s/]+/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(u))) { apiErr('Add the API base URL, starting with https://.'); return; }
  if (!t) { apiErr('Paste the full API token.'); return; }
  try {
    S.phApi = await Save.queue('phapi', () => api.savePhApi({ baseUrls: list, token: t }));
    $('apiTok').value = ''; renderApi({ clearToken: true }); apiErr('');
  } catch (e) { $('apiTok').value = ''; apiErr(e.message); }
};
$('apiRm').onclick = async () => {
  try { S.phApi = await Save.queue('phapi', () => api.removePhApiToken()); renderApi({ clearToken: true }); apiErr(''); } catch (e) { apiErr(e.message); }
};

$('cpUrl').onclick = async () => {
  const t = urlText(); let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch (e) {}
  $('cpTx').textContent = ok ? 'Copied' : 'Copy failed, select it from the tooltip';
  setTimeout(() => { $('cpTx').textContent = 'Copy template URL'; }, 1600);
};

// ───────────────────────── start ─────────────────────────

async function main() {
  session = await signIn(CONFIG.auth || {});
  api = createClient({ apiBase: CONFIG.apiBase, getToken: session.getToken });
  try {
    await api.me();
  } catch (e) {
    if (e.status === 403) showBlocked('Admin role required', 'You are signed in, but this account does not have the admin role, so it cannot open the editor. Ask an administrator to grant it.', { signOut: session.signOut });
    else if (e.status === 401) showBlocked('Not signed in', 'Your sign-in was not accepted. Sign out and sign in again.', { signOut: session.signOut });
    else showBlocked('The editor could not load', e.message, { signOut: session.signOut });
    return;
  }
  const [pharmacies, promotions, templates, services] = await Promise.all([api.listPharmacies(), api.listPromotions(), api.listTemplates(), api.listServices(), loadSample()]);
  S.pharmacies = pharmacies; S.promotions = M.orderPromotions(promotions); S.templates = templates; S.services = services;
  S.dpTab = S.promotions[0] && S.promotions[0].id;
  hideGate(); $('app').hidden = false;
  const want = pref.get('pharmacy');
  const first = S.pharmacies.find((p) => p.id === want) || S.pharmacies[0];
  if (first) await selectPharmacy(first.id);
  else { S.cur = newDraft(); renderStoreSel(); loadStore(); }
  setOrient(orient); fit();
  requestAnimationFrame(loop);
  try { document.fonts.ready.then(() => { lastKey = ''; }); document.fonts.addEventListener('loadingdone', () => { lastKey = ''; }); } catch (e) {}
}

// Hook for the editor's end-to-end tests.
window.pharmacyAdmin = { get ready() { return !!S.cur; }, state: S, flush: () => Save.flush(), pending: () => Save.pending() };

main().catch((e) => showBlocked('The editor could not load', (e && e.message) || String(e), session ? { signOut: session.signOut } : {}));
