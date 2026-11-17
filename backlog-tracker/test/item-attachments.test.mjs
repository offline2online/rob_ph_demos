// Ticket attachments (AveRUvb8zcijYoamN2RN): which files can be attached to a
// ticket, what kind each is, and which format the screen recorder asks for.
// public/js/item-attachments.js; storage.rules must allow the same types.
// Run with:  node item-attachments.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATTACHMENT_ACCEPT, DOCUMENT_CONTENT_TYPES, MAX_IMAGE_BYTES, MAX_ATTACHMENT_BYTES,
  attachmentContentType, isAllowedAttachmentType, attachmentKind, kindLabel,
  checkAttachmentFile, pickRecordingType, recordingExtension,
} from "../public/js/item-attachments.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const f = (name, type, size = 10) => ({ name, type, size });

// The common cases the ticket names: PNG, JPEG, MP4 and other video.
for (const [file, kind] of [
  [f("shot.png", "image/png"), "image"], [f("photo.jpg", "image/jpeg"), "image"],
  [f("rec.mp4", "video/mp4"), "video"], [f("clip.mov", "video/quicktime"), "video"], [f("rec.webm", "video/webm"), "video"],
  [f("spec.pdf", "application/pdf"), "file"], [f("notes.txt", "text/plain"), "file"],
  [f("data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "file"],
]) {
  const r = checkAttachmentFile(file);
  assert.equal(r.ok, true, `${file.name} is accepted`);
  assert.equal(r.kind, kind, `${file.name} is a ${kind}`);
}

// An empty browser type is read off the extension.
assert.equal(attachmentContentType(f("clip.MOV", "")), "video/quicktime");
assert.equal(attachmentContentType(f("readme.md", "")), "text/markdown");
assert.equal(attachmentContentType(f("rec.mkv", "application/octet-stream")), "video/x-matroska");
assert.equal(checkAttachmentFile(f("clip.mov", "")).kind, "video");

// Refused: unknown types, empty files, over the caps.
assert.equal(checkAttachmentFile(f("run.exe", "application/x-msdownload")).ok, false);
assert.equal(checkAttachmentFile(f("mystery", "")).ok, false);
assert.equal(checkAttachmentFile(f("empty.png", "image/png", 0)).ok, false);
assert.match(checkAttachmentFile(f("big.png", "image/png", MAX_IMAGE_BYTES + 1)).error, /15 MB/);
assert.equal(checkAttachmentFile(f("big.mp4", "video/mp4", MAX_IMAGE_BYTES + 1)).ok, true, "a video may be larger than an image");
assert.match(checkAttachmentFile(f("huge.mp4", "video/mp4", MAX_ATTACHMENT_BYTES + 1)).error, /100 MB/);
assert.equal(checkAttachmentFile(null).ok, false);

assert.equal(isAllowedAttachmentType("video/webm;codecs=vp9"), true, "parameters are ignored");
assert.equal(attachmentKind("application/zip"), "file");
assert.deepEqual(["image", "video", "file"].map(kindLabel), ["Image", "Video", "File"]);

// The picker's accept list carries the families and the extensions.
const accept = ATTACHMENT_ACCEPT.split(",");
for (const t of ["image/*", "video/*", "text/*", "application/pdf", ".png", ".jpg", ".jpeg", ".mp4", ".mov", ".pdf"]) assert.ok(accept.includes(t), t);

// Recording format: the first the browser supports; Safari makes only MP4.
assert.equal(pickRecordingType((t) => t.startsWith("video/webm")), "video/webm;codecs=vp9");
assert.equal(pickRecordingType((t) => t === "video/webm"), "video/webm");
assert.equal(pickRecordingType((t) => t === "video/mp4"), "video/mp4", "Safari");
assert.equal(pickRecordingType(() => false), "", "let the browser choose");
assert.equal(pickRecordingType(() => { throw new Error("no"); }), "");
assert.equal(pickRecordingType(undefined), "");
assert.equal(recordingExtension("video/mp4"), "mp4");
assert.equal(recordingExtension("video/webm;codecs=vp9"), "webm");

// storage.rules' attachments match allows every document type the console offers.
const rules = fs.readFileSync(path.join(here, "../storage.rules"), "utf8");
const block = rules.slice(rules.indexOf("match /attachments/{itemId}/{fileName}"));
const attachBlock = block.slice(0, block.indexOf("allow delete"));
for (const t of DOCUMENT_CONTENT_TYPES) assert.ok(attachBlock.includes(`'${t}'`), `storage.rules allows ${t}`);
for (const fam of ["image/.*", "video/.*", "text/.*"]) assert.ok(attachBlock.includes(fam), `storage.rules allows ${fam}`);
assert.match(attachBlock, /100 \* 1024 \* 1024/);

console.log("item-attachments: all checks passed");
