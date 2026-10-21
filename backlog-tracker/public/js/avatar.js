// One avatar for every place a person appears in the console.
//
// avatarHTML(email, size) renders the member's uploaded photo when there is
// one and a coloured circle with their first-name initial otherwise. The
// markup carries data-avatar-email, and setAvatarMember() repaints every
// matching element already on the page — so a photo uploaded in this tab, or
// arriving through a consoleUsers listener from another, shows up without a
// reload or a re-render of the list that contains it.
//
// Lookup is a members cache keyed by lowercased email. app.js fills it (own
// row, Team page, and a per-document listener the first time an email is
// seen — consoleUsers is readable per document by any member).

const members = new Map();
let onUnknown = null;
const seen = new Set();

export function normEmail(e) { return String(e || "").trim().toLowerCase(); }

// Names shown for a person: their display name, else the address.
export function memberLabel(email) {
  const m = members.get(normEmail(email));
  return (m && m.displayName) || email || "";
}

export function initialOf(email) {
  const m = members.get(normEmail(email));
  const src = ((m && m.displayName) || String(email || "").split("@")[0] || "?").trim();
  const ch = src.charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

// Stable colour per person from a fixed palette of dark-enough backgrounds
// (white initial stays readable).
const PALETTE = ["#1b6ac9", "#0e8f6a", "#b4531c", "#7b4fc4", "#b02a5b", "#2f7d8f", "#8a6d12", "#4f5fc4"];
export function colourFor(email) {
  const s = normEmail(email);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// photoUrl with ?v=<photoUpdatedAt ms> so a replaced photo is never served
// from cache. Falls back to the Google sign-in photo for the signed-in user.
export function photoSrcFor(email, googlePhotoUrl) {
  const m = members.get(normEmail(email));
  if (m && m.photoUrl) {
    const ts = m.photoUpdatedAt && typeof m.photoUpdatedAt.toMillis === "function" ? m.photoUpdatedAt.toMillis() : (Number(m.photoUpdatedAt) || 0);
    return ts ? `${m.photoUrl}${m.photoUrl.includes("?") ? "&" : "?"}v=${ts}` : m.photoUrl;
  }
  return googlePhotoUrl || "";
}

let selfEmail = "";
let selfGooglePhoto = "";
export function setAvatarSelf(email, googlePhotoUrl) {
  selfEmail = normEmail(email);
  selfGooglePhoto = googlePhotoUrl || "";
  repaint(selfEmail);
}

function googleFallback(email) { return normEmail(email) === selfEmail ? selfGooglePhoto : ""; }

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

function inner(email) {
  const src = photoSrcFor(email, googleFallback(email));
  const label = memberLabel(email);
  if (src) return `<img class="ph-avatar-img" src="${esc(src)}" alt="${esc(label)}" loading="lazy" referrerpolicy="no-referrer">`;
  return `<span class="ph-avatar-initial" aria-hidden="true">${esc(initialOf(email))}</span>`;
}

export function avatarHTML(email, size = 24) {
  const e = normEmail(email);
  if (!e || !e.includes("@")) return "";
  if (onUnknown && !members.has(e) && !seen.has(e)) { seen.add(e); onUnknown(e); }
  const label = memberLabel(email);
  return `<span class="ph-avatar" data-avatar-email="${esc(e)}" style="--av:${size}px;background:${colourFor(e)}" title="${esc(label)}" role="img" aria-label="${esc(label)}">${inner(e)}</span>`;
}

function repaint(email) {
  if (typeof document === "undefined") return;
  const label = memberLabel(email);
  document.querySelectorAll(`.ph-avatar[data-avatar-email="${CSS.escape(email)}"]`).forEach((el) => {
    el.title = label;
    el.setAttribute("aria-label", label);
    el.innerHTML = inner(email);
  });
  if (email === selfEmail) document.dispatchEvent(new CustomEvent("avatar-row-changed"));
}

export function setAvatarMember(email, data) {
  const e = normEmail(email);
  if (!e) return;
  if (data) members.set(e, data); else members.delete(e);
  repaint(e);
}

export function setUnknownMemberHandler(fn) { onUnknown = fn; }
export function getAvatarMember(email) { return members.get(normEmail(email)) || null; }

// Crop to a centred square and scale to 256x256 JPEG (~0.85) in the browser.
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
export function checkAvatarFile(file) {
  if (!file) return "Choose an image first.";
  if (!/^image\//.test(file.type || "")) return "That file isn't an image. Choose a JPEG or PNG photo.";
  if (file.size > AVATAR_MAX_BYTES) return "That image is larger than 10 MB. Choose a smaller photo.";
  return "";
}
export async function avatarBlobFromFile(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 256, 256);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't read that image.");
  return blob;
}
