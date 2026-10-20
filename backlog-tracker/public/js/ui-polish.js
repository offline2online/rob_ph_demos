// Presentation-only helper (ticket 5TbkrO71BsFoaKiclUvO): moves descriptive
// helper copy out of the page flow into an (i) tooltip beside the label or
// heading it explains. The original paragraph stays in the DOM (visually
// hidden, linked by aria-describedby), so no text, field or id is removed.
// Status/progress lines (anything with a live id, or hidden at the time) are
// left alone — they carry state, not explanation.
const HELPER = ".field-hint, .faq-tree-hint, .faq-cat-heading-desc, .in-development-hint, .train-locked-hint, .merge-pending-hint, .options-menu-sub, .preview-state-sub";
const STATUS_ID = /(attach-hint|readonly-hint|preview-count|count)$/;
let seq = 0;

function anchorFor(el) {
  // the label/heading this paragraph explains: nearest previous label, heading
  // or field container's first label; else just before the paragraph.
  let prev = el.previousElementSibling;
  while (prev) {
    if (/^(LABEL|H1|H2|H3|H4|LEGEND|SUMMARY)$/.test(prev.tagName)) return { host: prev, inside: true };
    if (prev.querySelector && prev.matches("input, select, textarea, div, span")) {
      const lbl = prev.matches("label") ? prev : prev.querySelector("label");
      if (lbl) return { host: lbl, inside: true };
    }
    prev = prev.previousElementSibling;
  }
  const parentLabel = el.parentElement && el.parentElement.querySelector(":scope > label, :scope > h3, :scope > h4");
  return parentLabel ? { host: parentLabel, inside: true } : { host: el, inside: false };
}

function convert(el) {
  if (el.dataset.tipDone || el.closest(".info-tip")) return;
  if (el.hidden || STATUS_ID.test(el.id || "")) return;
  const text = (el.textContent || "").trim();
  if (!text) return;
  el.dataset.tipDone = "1";
  const id = el.id || (el.id = "tip-src-" + ++seq);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "info-tip";
  btn.textContent = "i";
  btn.dataset.tip = text;
  btn.setAttribute("aria-label", "More information");
  btn.setAttribute("aria-describedby", id);
  const { host, inside } = anchorFor(el);
  if (inside) host.appendChild(btn); else el.before(btn);
  el.classList.add("tip-source");
}

function scan(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches && root.matches(HELPER)) convert(root);
  root.querySelectorAll && root.querySelectorAll(HELPER).forEach(convert);
}

function placeTip(btn) {
  btn.classList.remove("edge-left", "edge-right");
  const r = btn.getBoundingClientRect();
  if (r.left < 150) btn.classList.add("edge-left");
  else if (window.innerWidth - r.right < 150) btn.classList.add("edge-right");
}

function init() {
  scan(document.body);
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerover", (e) => { const b = e.target.closest && e.target.closest(".info-tip"); if (b) placeTip(b); });
  document.addEventListener("focusin", (e) => { const b = e.target.closest && e.target.closest(".info-tip"); if (b) placeTip(b); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".info-tip");
    document.querySelectorAll(".info-tip.open").forEach((o) => { if (o !== b) o.classList.remove("open"); });
    if (b) { e.preventDefault(); e.stopPropagation(); placeTip(b); b.classList.toggle("open"); }
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".info-tip.open").forEach((o) => o.classList.remove("open")); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
export { scan };
