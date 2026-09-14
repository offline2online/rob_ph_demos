// Boot shared by every page: embed mode, version stamp, search box, icons.
import { initEmbedMode } from "./faq-data.js";
import { APP_VERSION } from "./version.js";
import { initSearchBox } from "./search-box.js";
import { iconSvg } from "./icons.js";

export function bootPage() {
  initEmbedMode();
  const v = document.getElementById("app-version");
  if (v) v.textContent = `v${APP_VERSION}`;
  const si = document.getElementById("search-icon");
  if (si) si.innerHTML = iconSvg("search", 20);
  initSearchBox().catch(() => { /* search is a progressive enhancement */ });
}

export function showLoadError() {
  const el = document.getElementById("load-error");
  if (el) el.hidden = false;
  document.querySelectorAll("[aria-busy]").forEach((n) => n.removeAttribute("aria-busy"));
}
