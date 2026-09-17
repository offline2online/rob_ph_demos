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
//
// Long blocks start collapsed: anything taller than COLLAPSE_LINES rendered
// lines (4 by default) is cut off behind a fade with a "Show more" control, so
// a long prompt does not push the rest of the article off screen. Copy always
// copies the whole block, expanded or not. Per block: data-collapse-lines="8"
// changes the threshold, data-collapse="false" switches collapsing off.
import { iconSvg } from "./icons.js";
import { escapeHTML } from "./faq-data.js";

const DEFAULT_LABEL = "Copy";
const COPIED_LABEL = "Copied";
const MANUAL_LABEL = "Selected — press Ctrl+C or ⌘C";
const RESET_MS = 2000;
const COLLAPSE_LINES = 4;
const MORE_LABEL = "Show more";
const LESS_LABEL = "Show less";
let blockSeq = 0;

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
    const body = document.createElement("div");
    body.className = "copy-block-body";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(bar);
    wrap.appendChild(body);
    body.appendChild(pre);
    initCollapse(wrap, pre);

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

// Collapse a block that renders taller than its line threshold. Measured
// after the block is in the DOM (page-article.js calls enhanceCopyBlocks on a
// rendered body), and re-checked on resize while the reader has not expanded
// it, because wrapping changes with the viewport width.
function initCollapse(wrap, pre) {
  if ((pre.dataset.collapse || "").trim().toLowerCase() === "false") return;
  const lines = parseInt(pre.dataset.collapseLines, 10) || COLLAPSE_LINES;
  const cs = getComputedStyle(pre);
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
  const maxPx = Math.round(lines * lineHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
  pre.style.setProperty("--copy-collapsed-max", `${maxPx}px`);
  if (!pre.id) pre.id = `copy-block-${++blockSeq}`;

  const foot = document.createElement("div");
  foot.className = "copy-block-foot";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "copy-btn copy-toggle";
  toggle.setAttribute("aria-controls", pre.id);
  foot.appendChild(toggle);
  wrap.appendChild(foot);

  let expanded = false;
  const paint = () => {
    wrap.classList.toggle("is-expanded", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.innerHTML = `${iconSvg(expanded ? "expand_less" : "expand_more", 16)}<span class="copy-btn-label">${escapeHTML(expanded ? LESS_LABEL : MORE_LABEL)}</span>`;
  };
  const measure = () => {
    if (expanded) return;
    // Measure the natural height with the cap lifted, then restore it.
    wrap.classList.remove("is-collapsible");
    const tall = pre.scrollHeight > maxPx + 2;
    wrap.classList.toggle("is-collapsible", tall);
  };
  toggle.addEventListener("click", () => {
    expanded = !expanded;
    paint();
    if (!expanded) {
      measure();
      // Keep the top of the block in view when it shrinks back.
      const top = wrap.getBoundingClientRect().top;
      if (top < 0) wrap.scrollIntoView({ block: "start" });
    }
  });
  paint();
  measure();
  if ("ResizeObserver" in window) new ResizeObserver(measure).observe(wrap);
  else window.addEventListener("resize", measure);
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
