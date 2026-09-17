// One-click copy for code blocks.
//
// Every <pre> in an article body gets a "Copy" control (a prompt to paste into
// an AI assistant, a command, a snippet of JSON…). Article HTML is sanitised by
// DOMPurify at render time and <button> is on its forbid list, so the control
// is never authored in the article — it is added here, after the body has been
// rendered, by page-article.js. Nothing to do per article: any <pre><code>
// block gets the button automatically. An optional data-copy-label attribute
// on the <pre> changes the button text, e.g. data-copy-label="Copy prompt".
//
// Copying prefers the async Clipboard API and falls back to a hidden textarea
// + execCommand("copy"), which still works when the site is iframed into a
// page that does not grant clipboard-write to the frame. If both fail, the
// block's text is selected so the reader can copy it with the keyboard.
import { iconSvg } from "./icons.js";
import { escapeHTML } from "./faq-data.js";

const DEFAULT_LABEL = "Copy";
const COPIED_LABEL = "Copied";
const MANUAL_LABEL = "Selected — press Ctrl+C or ⌘C";
const RESET_MS = 2000;

export function enhanceCopyBlocks(container, { onCopy } = {}) {
  if (!container) return 0;
  let count = 0;
  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.closest(".copy-block")) return;
    const text = blockText(pre);
    if (!text.trim()) return;
    const label = (pre.dataset.copyLabel || "").trim() || DEFAULT_LABEL;

    const wrap = document.createElement("div");
    wrap.className = "copy-block";
    const bar = document.createElement("div");
    bar.className = "copy-block-bar";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.setAttribute("aria-label", `${label} to clipboard`);
    btn.innerHTML = `${iconSvg("content_copy", 16)}<span class="copy-btn-label" aria-live="polite">${escapeHTML(label)}</span>`;
    bar.appendChild(btn);
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(bar);
    wrap.appendChild(pre);

    let timer = null;
    btn.addEventListener("click", async () => {
      const ok = await copyText(blockText(pre), pre);
      btn.classList.toggle("is-copied", ok);
      btn.classList.toggle("is-manual", !ok);
      btn.innerHTML = `${iconSvg(ok ? "check" : "content_copy", 16)}<span class="copy-btn-label" aria-live="polite">${escapeHTML(ok ? COPIED_LABEL : MANUAL_LABEL)}</span>`;
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove("is-copied", "is-manual");
        btn.innerHTML = `${iconSvg("content_copy", 16)}<span class="copy-btn-label" aria-live="polite">${escapeHTML(label)}</span>`;
      }, ok ? RESET_MS : RESET_MS * 3);
      if (onCopy) onCopy({ ok, label, text: blockText(pre) });
    });
    count++;
  });
  return count;
}

// The text a reader expects to get: the code's content with a single trailing
// newline removed (the closing </code> usually sits on its own line).
function blockText(pre) {
  const code = pre.querySelector("code");
  return (code || pre).textContent.replace(/\n$/, "");
}

export async function copyText(text, sourceEl) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* permission denied (e.g. iframe without clipboard-write) — fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.className = "copy-scratch";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand("copy");
    ta.remove();
    if (ok) return true;
  } catch { /* fall through */ }
  try {
    if (sourceEl) {
      const range = document.createRange();
      range.selectNodeContents(sourceEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch { /* ignore */ }
  return false;
}
