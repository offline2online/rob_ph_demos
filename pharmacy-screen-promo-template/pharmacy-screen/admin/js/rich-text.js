// Copy fields. Rich text (headlines, Open today bar messages): bold, regular, italic, accent and line break, kept
// to the markup the screen's tokens.js `clean()` allows. Plain text (accent lines, Line 1 / Line 2, service chip
// labels, seasonal labels): one line, no styling. Every copy field, in the admin view and the pharmacy view alike,
// has "+ Add token" on its label row, as in PH's HQ Admin: a menu of the tokens copy can use (tokens.js ADD_TOKENS)
// that inserts ${TokenName} at the caret. Under the box, the ${Token}s the field's copy uses are shown as chips,
// updated as you type (any token, including one set by hand in Settings → Tokens that the menu does not offer).

import { clean, esc, ADD_TOKENS, tokensIn } from '../../js/tokens.js';

const $ = (id) => document.getElementById(id);

/** The label row's "+ Add token" button and its menu, for the field with id `id`. */
function tokenAdd(id) {
  const menu = ADD_TOKENS.map((t) => `<button type="button" role="menuitem" data-t="${t.name}" title="Insert \${${t.name}}"><span class="tok-l">${esc(t.label)}</span><code>\${${t.name}}</code>${t.source ? `<span class="tok-s">${esc(t.source)}</span>` : ''}</button>`).join('');
  return `<button type="button" class="text tok-add" data-tok-for="${id}" aria-haspopup="menu" aria-expanded="false"><span class="ms">add</span>Add token</button>
  <div class="tok-menu" role="menu" aria-label="Add token" data-tok-menu="${id}" hidden>${menu}</div>`;
}

/** The chips of the ${Token}s copy `val` uses, in order of first use (empty: none). */
export const tokenChips = (val) => tokensIn(val).map((n) => `<code class="tok">\${${esc(n)}}</code>`).join('');

/** The "tokens used" row under field `id`, hidden while its copy uses none. */
const usedRow = (id, val) => { const c = tokenChips(val); return `<div class="tok-used" data-tok-used="${id}" role="group" aria-label="Tokens used"${c ? '' : ' hidden'}>${c}</div>`; };

/** Refresh field `id`'s "tokens used" row from its copy `val`. */
function showUsed(id, val) {
  const row = document.querySelector(`[data-tok-used="${id}"]`); if (!row) return;
  const c = tokenChips(val);
  if (row.innerHTML !== c) row.innerHTML = c;
  row.hidden = !c;
}

/** A plain-text copy field: its label row with "+ Add token", a one-line input holding `val`, and its tokens used. */
export function pt(id, label, val) {
  return `<div class="f ptf"><div class="rt-lab"><label for="${id}">${label}</label>${tokenAdd(id)}</div><input id="${id}" value="${esc(val)}">${usedRow(id, val)}</div>`;
}

/** Wire the plain field rendered by pt(): its "+ Add token" menu and its tokens used (the input's own `oninput`,
 *  set by the caller, saves the value; an inserted token fires it too). */
export function bindPlainText(id) {
  const inp = $(id); if (!inp) return;
  inp.addEventListener('input', () => showUsed(id, inp.value));
  bindTokenMenu(inp, () => inp.dispatchEvent(new Event('input', { bubbles: true })));
}

/** The field's markup: a toolbar and a contenteditable box holding `val` (`aria`: its accessible name, else `label`). */
export function rt(id, label, val, aria = label) {
  return `<div class="f rtf"><div class="rt-lab"><span>${label}</span>${tokenAdd(id)}</div><div class="rt-box"><div class="rt-bar" data-for="${id}">
  <button type="button" data-cmd="bold" title="Bold"><b>B</b></button><button type="button" data-cmd="reg" title="Regular weight">Regular</button>
  <button type="button" data-cmd="italic" title="Italic"><i>I</i></button><button type="button" data-cmd="acc" title="Accent colour"><span class="ms" style="font-size:18px">format_color_text</span></button>
  <span class="sep"></span><button type="button" data-cmd="br" title="Line break (Enter)"><span class="ms" style="font-size:18px">keyboard_return</span></button>
  <button type="button" data-cmd="clear" title="Clear formatting"><span class="ms" style="font-size:18px">format_clear</span></button></div>
  <div class="rt" id="${id}" contenteditable="true" role="textbox" aria-label="${aria}" aria-multiline="true">${clean(val)}</div></div>${usedRow(id, val)}</div>`;
}

/** Wire the field rendered by rt(): `set(cleanHtml)` stores the value, then `onChange()` saves it. */
export function bindRichText(id, set, onChange) {
  const ed = $(id), bar = document.querySelector(`.rt-bar[data-for="${id}"]`);
  const commit = () => { const v = clean(ed.innerHTML); set(v); showUsed(id, v); onChange(); };
  ed.oninput = commit;
  ed.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); } };
  ed.onpaste = (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' ')); };
  bar.onmousedown = (e) => e.preventDefault(); // keep the selection in the box while a toolbar button is pressed
  bar.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    ed.focus();
    const c = b.dataset.cmd, sel = getSelection();
    if (c === 'bold' || c === 'italic') document.execCommand(c);
    else if (c === 'br') document.execCommand('insertLineBreak');
    else if (sel.rangeCount && !sel.isCollapsed && ed.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0), frag = r.extractContents();
      if (c === 'clear') { const tmp = document.createElement('div'); tmp.appendChild(frag); tmp.querySelectorAll('br').forEach((x) => x.replaceWith('\n')); r.insertNode(document.createTextNode(tmp.textContent.replace(/\n/g, ' '))); }
      else { const sp = document.createElement('span'); sp.className = c; sp.appendChild(frag); sp.querySelectorAll('span.reg,span.acc').forEach((x) => x.replaceWith(...x.childNodes)); r.insertNode(sp); }
    }
    commit();
  };
  bindTokenMenu(ed, commit);
}

// Where the caret was when a rich-text field last lost focus, so a token goes in there and not at the start. For a
// plain input, whether it has had the focus yet (it keeps its own selectionStart / selectionEnd; never focused: the end).
const caret = new WeakMap();

/** The field's "+ Add token" menu: opens under its label row; a pick inserts ${Name} at the caret (else at the end).
 *  `ed` is the rich-text box or the plain input; `commit()` saves the field after the insert. */
function bindTokenMenu(ed, commit) {
  const add = document.querySelector(`.tok-add[data-tok-for="${ed.id}"]`), menu = document.querySelector(`[data-tok-menu="${ed.id}"]`);
  if (!add || !menu) return;
  const plain = ed.tagName === 'INPUT';
  if (plain) ed.addEventListener('focus', () => caret.set(ed, true)); // never focused yet: a token goes at the end
  else ed.addEventListener('blur', () => { const sel = getSelection(); if (sel.rangeCount && ed.contains(sel.anchorNode)) caret.set(ed, sel.getRangeAt(0).cloneRange()); });
  const show = (on) => {
    menu.hidden = !on; add.setAttribute('aria-expanded', String(on));
    if (on) { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true); }
    else { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); }
  };
  const away = (e) => { if (!menu.contains(e.target) && !add.contains(e.target)) show(false); };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); show(false); add.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };
  add.onclick = () => { const on = menu.hidden; show(on); if (on) menu.querySelector('button').focus(); };
  menu.onclick = (e) => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    show(false);
    const v = '${' + b.dataset.t + '}', was = caret.get(ed);
    ed.focus();
    if (plain) {
      const n = ed.value.length, a = was ? ed.selectionStart ?? n : n, z = was ? ed.selectionEnd ?? n : n;
      ed.setRangeText(v, a, z, 'end');
      commit();
      return;
    }
    const sel = getSelection(), r = was;
    sel.removeAllRanges();
    if (r && ed.contains(r.startContainer)) sel.addRange(r);
    else { const end = document.createRange(); end.selectNodeContents(ed); end.collapse(false); sel.addRange(end); }
    document.execCommand('insertText', false, v);
    commit();
  };
}
