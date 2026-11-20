// The `?debug=1` panel on the player page: device, store code, last fetch, server used, and a test time
// override for the "Open today" bar. Styles in css/debug.css (loaded only with debug=1). Not used by the PH player.

import { DAYS, DAY_NAMES } from './hours.js';
import { esc } from './tokens.js';

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const RESULT = { ok: 'OK', 'not-found': 'Not found', invalid: 'Invalid device ID', down: 'No server answered' };
const STATE = { open: 'Open', closing: 'Last 30 minutes', before: 'Before opening', closed: 'After closing' };

function fetchLine(f) {
  if (!f) return '<span class="dbg-muted">Waiting…</span>';
  const kind = f.kind === 'ok' && f.stale ? 'OK (stale, from the proxy cache)' : RESULT[f.kind] || f.kind;
  return `${clock(f.at)} · ${esc(kind)}`;
}

/**
 * opts.onTestTime({day, min} | null) applies or clears the override.
 * Returns { update(info) } where info = { device, storeCode, source, lastStore, lastConfig, server, health,
 *   storeTime: {day, min} | null, barState, testTime: {day, min} | null }.
 */
export function createDebugPanel(doc, opts) {
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/debug.css';
  doc.head.appendChild(link);

  const el = doc.createElement('aside');
  el.className = 'dbg';
  el.setAttribute('aria-label', 'Debug panel');
  el.innerHTML = `<div class="dbg-h"><span class="dbg-dot" data-health="wait"></span><b>Debug</b></div>
<dl class="dbg-rows"></dl>
<div class="dbg-sec">TEST TIME</div>
<form class="dbg-tt">
  <select aria-label="Day">${DAYS.map((d) => `<option value="${d}">${DAY_NAMES[d]}</option>`).join('')}</select>
  <input type="time" aria-label="Store time" required>
  <button type="submit" class="dbg-btn dbg-primary">Apply</button>
  <button type="button" class="dbg-btn dbg-text" data-act="clear">Real time</button>
</form>`;
  doc.body.appendChild(el);

  const rows = el.querySelector('.dbg-rows');
  const form = el.querySelector('.dbg-tt');
  const day = form.querySelector('select');
  const time = form.querySelector('input');
  let primed = false;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const [h, m] = String(time.value || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    opts.onTestTime({ day: day.value, min: h * 60 + m });
  });
  form.querySelector('[data-act="clear"]').addEventListener('click', () => opts.onTestTime(null));

  return {
    el,
    update(info) {
      el.querySelector('.dbg-dot').dataset.health = info.health;
      const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
      rows.innerHTML = [
        row('Device', `<code>${esc(info.device || '—')}</code>`),
        row('Store code', info.storeCode ? `<code>${esc(info.storeCode)}</code>` : '<span class="dbg-muted">—</span>'),
        row('Source', esc(info.source)),
        row('Store data', fetchLine(info.lastStore)),
        row('Config', fetchLine(info.lastConfig)),
        row('Server', info.server === null || info.server === undefined ? '<span class="dbg-muted">—</span>' : `<code>${esc(info.server || location.origin)}</code>`),
        row('Store time', info.storeTime ? `${DAY_NAMES[info.storeTime.day]} ${hhmm(info.storeTime.min)}${info.testTime ? ' <span class="dbg-tag">TEST</span>' : ''}` : '<span class="dbg-muted">—</span>'),
        row('Bar', info.barState ? esc(STATE[info.barState] || info.barState) : '<span class="dbg-muted">—</span>'),
      ].join('');
      if (!primed && info.storeTime) {
        day.value = info.storeTime.day;
        time.value = hhmm(info.storeTime.min);
        primed = true;
      }
    },
  };
}
