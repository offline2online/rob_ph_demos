// Quill (the rich-text editor, 211 KB) is only needed once a rich editor opens:
// the FAQ article editor, or the Staff Kanban ticket modal. index.html no
// longer loads it up front, so a first visit to any page doesn't download it.
// loadQuill() adds its stylesheet and script on first use and resolves with the
// global once it has run; later calls share the same promise. Failure clears the
// cache so the next open retries.
const QUILL_BASE = "https://cdnjs.cloudflare.com/ajax/libs/quill/1.3.7/";
let loading = null;

export function loadQuill() {
  if (window.Quill) return Promise.resolve(window.Quill);
  if (loading) return loading;
  if (!document.querySelector("link[data-quill-css]")) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = QUILL_BASE + "quill.snow.min.css";
    css.dataset.quillCss = "1";
    document.head.appendChild(css);
  }
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = QUILL_BASE + "quill.min.js";
    s.onload = () => (window.Quill ? resolve(window.Quill) : reject(new Error("Quill loaded without a global")));
    s.onerror = () => reject(new Error("Quill didn't load"));
    document.head.appendChild(s);
  }).catch((err) => { loading = null; throw err; });
  return loading;
}
