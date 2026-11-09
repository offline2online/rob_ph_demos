// Console-wide modal rules (ticket Ilf6OOZPUwFyjZCgZ6VX). Every dialog and side
// drawer (.modal-panel inside a .modal-backdrop) follows the same three rules:
//   1. its Save / Create / Add button is only enabled once something has changed
//      (a new, empty form starts disabled; an edit form starts disabled until a
//      value differs from what it opened with);
//   2. its action row is sticky, so Save stays in view however long the form is;
//   3. its × is the last control in the header, top right, and always closes it.
// Presentation and enablement only: no field, id or handler is removed, so the
// page's own code keeps working. A button can opt out with data-no-dirty.
const SAVE_TEXT = /^(save|create|add|post|submit|update|send|apply|publish|invite|convert)\b/i;
const SAVE_ID = /-(save|create|submit)(-btn)?$/;
const FIELDS = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="file"]):not([type="search"]), textarea, select, [contenteditable="true"]';
const states = new WeakMap(); // panel -> { snap, touched }

const visible = (el) => !!el && !el.hidden && !el.closest("[hidden]");

function saveButtons(panel) {
  return [...panel.querySelectorAll("button.btn-primary, button[type=submit]")].filter((b) =>
    !b.hasAttribute("data-no-dirty") && !b.classList.contains("modal-close") &&
    (SAVE_ID.test(b.id || "") || SAVE_TEXT.test((b.textContent || "").trim())));
}

function serialise(panel) {
  return [...panel.querySelectorAll(FIELDS)].map((f, i) => {
    const key = f.id || f.name || i;
    if (f.isContentEditable && f.tagName !== "INPUT") return key + "=" + f.innerHTML;
    if (f.type === "checkbox" || f.type === "radio") return key + "=" + f.checked;
    return key + "=" + f.value;
  }).join("\u0001");
}

function footerOf(panel, btn) {
  return btn.closest(".form-row, .lead-sum-actions, .modal-footer") || btn.parentElement;
}

function refresh(panel) {
  const st = states.get(panel);
  const btns = saveButtons(panel);
  if (!st || !btns.length) return;
  const dirty = serialise(panel) !== st.snap;
  for (const b of btns) {
    if (!visible(b)) continue;
    b.disabled = !dirty;
    b.setAttribute("aria-disabled", String(!dirty));
    if (!dirty) b.title = "No changes to save"; else if (b.title === "No changes to save") b.removeAttribute("title");
  }
}

function baseline(panel) {
  states.set(panel, { snap: serialise(panel), touched: false });
  refresh(panel);
}

function prepare(panel) {
  if (panel.dataset.mpDone) return;
  const btns = saveButtons(panel);
  panel.dataset.mpDone = "1";
  panel.classList.add("ap-sheet");
  for (const b of btns) { const f = footerOf(panel, b); if (f && f !== panel) f.classList.add("ap-sticky-footer"); }
  panel.querySelectorAll(".lead-sum-actions").forEach((f) => f.classList.add("ap-sticky-footer"));
  if (!btns.length || !panel.querySelector(FIELDS)) return;
  panel.dataset.mpTrack = "1";
  const touch = () => { const st = states.get(panel); if (st) st.touched = true; refresh(panel); };
  panel.addEventListener("input", touch);
  panel.addEventListener("change", touch);
  // rows added or removed by the page (a second contact) and a Save that becomes
  // visible (Edit pressed in a drawer) both start a fresh comparison / re-check
  new MutationObserver((muts) => {
    const st = states.get(panel);
    if (!st) return;
    if (muts.some((m) => m.type === "attributes")) { if (!st.touched) baseline(panel); else refresh(panel); }
    else { st.touched = true; refresh(panel); }
  }).observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  const backdrop = panel.closest(".modal-backdrop");
  if (backdrop) new MutationObserver(() => { if (!backdrop.hidden) { baseline(panel); setTimeout(() => { const s = states.get(panel); if (s && !s.touched) baseline(panel); }, 200); } })
    .observe(backdrop, { attributes: true, attributeFilter: ["hidden"] });
  baseline(panel);
}

function scan(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches && root.matches(".modal-panel")) prepare(root);
  root.querySelectorAll && root.querySelectorAll(".modal-panel").forEach(prepare);
}

function init() {
  scan(document.body);
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  // A × must always close its dialog. The page's own handler runs first; if the
  // backdrop is still open afterwards, close it here.
  document.addEventListener("click", (e) => {
    const x = e.target.closest && e.target.closest(".modal-panel .modal-close");
    if (!x) return;
    const backdrop = x.closest(".modal-backdrop");
    if (!backdrop) return;
    setTimeout(() => { if (!backdrop.hidden && backdrop.isConnected) backdrop.hidden = true; }, 0);
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
export { scan, serialise };
