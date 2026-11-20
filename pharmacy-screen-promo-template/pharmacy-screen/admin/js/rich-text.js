// Rich-text fields (headlines, Open today bar messages): bold, regular, italic, accent and line break, kept
// to the markup the screen's tokens.js `clean()` allows.

import { clean } from '../../js/tokens.js';

const $ = (id) => document.getElementById(id);

/** The field's markup: a toolbar and a contenteditable box holding `val`. */
export function rt(id, label, val) {
  return `<div class="f rtf"><span>${label}</span><div class="rt-box"><div class="rt-bar" data-for="${id}">
  <button type="button" data-cmd="bold" title="Bold"><b>B</b></button><button type="button" data-cmd="reg" title="Regular weight">Regular</button>
  <button type="button" data-cmd="italic" title="Italic"><i>I</i></button><button type="button" data-cmd="acc" title="Accent colour"><span class="ms" style="font-size:18px">format_color_text</span></button>
  <span class="sep"></span><button type="button" data-cmd="br" title="Line break (Enter)"><span class="ms" style="font-size:18px">keyboard_return</span></button>
  <button type="button" data-cmd="clear" title="Clear formatting"><span class="ms" style="font-size:18px">format_clear</span></button></div>
  <div class="rt" id="${id}" contenteditable="true" role="textbox" aria-label="${label}" aria-multiline="true">${clean(val)}</div></div></div>`;
}

/** Wire the field rendered by rt(): `set(cleanHtml)` stores the value, then `onChange()` saves it. */
export function bindRichText(id, set, onChange) {
  const ed = $(id), bar = document.querySelector(`.rt-bar[data-for="${id}"]`);
  const commit = () => { set(clean(ed.innerHTML)); onChange(); };
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
}
