// The service chip's icon picker: a searchable list of Material Symbols (Outlined), pharmacy icons first.
// One picker is open at a time; a click outside it or Escape closes it.

import { ICONS } from './icons.js';

const $ = (id) => document.getElementById(id);

const SUGGESTED = ['monitor_heart', 'vital_signs', 'pill', 'medication', 'prescriptions', 'clinical_notes', 'vaccines', 'local_pharmacy', 'health_and_safety', 'medical_services', 'calendar_month', 'bedtime', 'hearing', 'bloodtype', 'glucose', 'nutrition', 'sick', 'allergy', 'healing', 'thermometer', 'stethoscope', 'masks', 'sanitizer', 'water_drop', 'wb_sunny', 'spa', 'face', 'child_care', 'pregnant_woman', 'elderly', 'dentistry', 'visibility', 'local_shipping', 'redeem', 'luggage', 'lunch_dining', 'sports_gymnastics', 'favorite'];
let pop = null; // {el, btn} of the open picker
export function closePicker() { if (pop) { pop.btn.setAttribute('aria-expanded', 'false'); pop.el.remove(); pop = null; } }
export function openPicker(btn, current, onPick) {
  if (pop && pop.btn === btn) { closePicker(); return; }
  closePicker();
  const el = document.createElement('div');
  el.className = 'icp-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Choose an icon');
  el.innerHTML = `<input id="icpQ" type="search" placeholder="Search ${ICONS.length.toLocaleString()} icons" autocomplete="off"><div class="icp-list" id="icpList"></div><div class="icp-name" id="icpName"></div>`;
  btn.parentElement.appendChild(el); btn.setAttribute('aria-expanded', 'true'); pop = { el, btn };
  const cell = (n) => `<button type="button" data-n="${n}" title="${n.replace(/_/g, ' ')}" aria-selected="${n === current}"><span class="ms">${n}</span></button>`;
  const draw = (q) => {
    q = q.trim().toLowerCase().replace(/\s+/g, '_');
    const all = q ? ICONS.filter((n) => n.includes(q)) : ICONS, sug = q ? SUGGESTED.filter((n) => n.includes(q)) : SUGGESTED;
    $('icpList').innerHTML = (sug.length ? `<div class="icp-grp">Pharmacy</div><div class="icp-grid">${sug.map(cell).join('')}</div>` : '') +
      (all.length ? `<div class="icp-grp">All icons · ${all.length.toLocaleString()}</div><div class="icp-grid">${all.map(cell).join('')}</div>` : '<div class="hint">No icons match. Try another word.</div>');
  };
  draw('');
  $('icpQ').oninput = (e) => draw(e.target.value);
  $('icpList').onmouseover = (e) => { const b = e.target.closest('button'); $('icpName').textContent = b ? b.dataset.n.replace(/_/g, ' ') : ''; };
  $('icpList').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const n = b.dataset.n; closePicker(); onPick(n); };
  el.onclick = (e) => e.stopPropagation();
  $('icpQ').focus();
}
document.addEventListener('click', closePicker);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

