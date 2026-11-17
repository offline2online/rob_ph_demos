// Ticket attachments (backlogItems.attachments) — which files a person may
// attach, what kind each one is, and which recording format the browser can
// make. Pure helpers, no DOM or Firebase, so test/item-attachments.test.mjs
// runs them in Node. app.js's createAttachmentController and
// uploadItemAttachment use them; storage.rules' attachments/{itemId} match
// allows the same content types, so a file the picker offers is a file
// Storage accepts.
//
// Ticket AveRUvb8zcijYoamN2RN (17 Nov 2026): the picker said "Attach
// screenshot" and only took image/*, so a screen recording saved as an MP4
// could not be picked at all, and the in-browser recorder asked for WebM,
// which Safari's MediaRecorder refuses — the Record screen button did
// nothing there. Now any image, video, PDF, text, zip, JSON or Office file
// can be attached, and the recorder uses whatever format the browser makes.

// Size ceilings. Storage rules cap every attachment at 100 MB; images keep
// their own lower ceiling (a screenshot past 15 MB is almost always a
// mistake, and big images make the Edit modal's thumbnails slow).
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

// Content types other than image/*, video/* and text/* that may be attached.
// Keep in step with storage.rules → attachments/{itemId}/{fileName}.
export const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

// A browser leaves File.type empty for an extension it doesn't know (often
// .md, .log, .mkv; .mov on some Windows machines), and Storage would then
// store it as application/octet-stream, which the rules refuse. Fill it in
// from the extension.
const TYPE_BY_EXTENSION = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", bmp: "image/bmp", svg: "image/svg+xml",
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  pdf: "application/pdf", zip: "application/zip", json: "application/json",
  txt: "text/plain", log: "text/plain", md: "text/markdown", csv: "text/csv", html: "text/html",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// The file input's accept= value: every MIME family above plus the
// extensions, so an OS picker that matches on extension still offers them.
export const ATTACHMENT_ACCEPT = ["image/*", "video/*", "text/*", ...DOCUMENT_CONTENT_TYPES]
  .concat(Object.keys(TYPE_BY_EXTENSION).map((ext) => "." + ext))
  .join(",");

function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

// The content type to upload a file as: its own, or one read off its
// extension when the browser gave none ("" when neither is known).
export function attachmentContentType(file) {
  const own = String((file && file.type) || "").toLowerCase();
  if (own && own !== "application/octet-stream") return own;
  return TYPE_BY_EXTENSION[extensionOf(file && file.name)] || own;
}

export function isAllowedAttachmentType(contentType) {
  const t = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (!t) return false;
  return t.startsWith("image/") || t.startsWith("video/") || t.startsWith("text/") || DOCUMENT_CONTENT_TYPES.includes(t);
}

// The `type` stored on an attachment: "image" (thumbnail), "video" (inline
// player) or "file" (an icon and an Open link). Older attachments carry only
// "image" or "video".
export function attachmentKind(contentType) {
  const t = String(contentType || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  return "file";
}

export function kindLabel(kind) {
  return kind === "video" ? "Video" : kind === "image" ? "Image" : "File";
}

// Checks one picked file. Returns { ok: true, contentType, kind } or
// { ok: false, error } with a sentence to show the person.
export function checkAttachmentFile(file) {
  if (!file) return { ok: false, error: "No file was chosen." };
  const contentType = attachmentContentType(file);
  if (!isAllowedAttachmentType(contentType)) {
    return { ok: false, error: "That kind of file can't be attached. Attach an image, a video, a PDF, a text file, a zip or an Office document." };
  }
  const kind = attachmentKind(contentType);
  const size = Number(file.size) || 0;
  if (size === 0) return { ok: false, error: "That file is empty." };
  if (kind === "image" && size > MAX_IMAGE_BYTES) return { ok: false, error: "That image is too large (max 15 MB)." };
  if (size > MAX_ATTACHMENT_BYTES) return { ok: false, error: "That file is too large (max 100 MB)." };
  return { ok: true, contentType, kind };
}

// The recording format to ask MediaRecorder for: the first the browser
// supports. Chrome/Edge/Firefox make WebM; Safari makes only MP4. "" means
// "let the browser choose" (it then reports its choice on recorder.mimeType).
export const RECORDING_TYPES = ["video/webm;codecs=vp9", "video/webm", "video/mp4"];

export function pickRecordingType(isTypeSupported) {
  if (typeof isTypeSupported !== "function") return "";
  for (const t of RECORDING_TYPES) {
    try { if (isTypeSupported(t)) return t; } catch { /* a browser that throws here supports none of them */ }
  }
  return "";
}

// File extension for a finished recording, from the format it was made in.
export function recordingExtension(mimeType) {
  return /mp4/i.test(String(mimeType || "")) ? "mp4" : "webm";
}
