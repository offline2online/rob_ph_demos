#!/usr/bin/env node
// One-off (safe to repeat) backfill of backlogItems.statusEnteredAt — when a
// card entered its current column — on every non-archived ticket without
// one, copied from its updatedAt (else createdAt). Ticket
// RC6wVNJJcPjNTR5hov9W ("Flow 7/9"): from now on the Cloud Function
// onBacklogItemStatusEntered stamps it on every status change; the board and
// MCP fall back to updatedAt for a card without it, so nothing is wrong
// before this runs. Idempotent: a card that already has the field is never
// written (test/card-state-stamp.test.js).
//
//   BOARD_API_KEY=… node backlog-tracker/scripts/backfill-status-entered.js           # dry run: counts only
//   BOARD_API_KEY=… node backlog-tracker/scripts/backfill-status-entered.js --apply   # write
//
// It writes only statusEnteredAt, through the board automation user, with an
// updateMask; never status, notes or anything else.
"use strict";

const API_KEY = "AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g";
const AUTOMATION_EMAIL = "board-automation@backlog-tracker-e4ed2.firebaseapp.com";
const BASE = "https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents";
const FIELDS = ["status", "statusEnteredAt", "updatedAt", "createdAt"];

function decode(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  return null;
}

// Pure: which cards to write and with what. Exported for the test.
function plan(items) {
  const out = [];
  for (const item of items) {
    if (!item || item.status === "archived" || item.statusEnteredAt) continue;
    const ms = Date.parse(item.updatedAt || "") || Date.parse(item.createdAt || "");
    if (!Number.isFinite(ms)) continue;
    out.push({ id: item.id, statusEnteredAt: new Date(ms).toISOString() });
  }
  return out;
}

async function signIn(password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: AUTOMATION_EMAIL, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`sign-in failed (${r.status})`);
  return j.idToken;
}

async function listItems(token) {
  const items = [];
  let pageToken = "";
  do {
    const mask = FIELDS.map((f) => `mask.fieldPaths=${f}`).join("&");
    const r = await fetch(`${BASE}/backlogItems?pageSize=300&${mask}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`list failed (${r.status})`);
    const j = await r.json();
    for (const d of j.documents || []) {
      const fields = Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, decode(v)]));
      items.push({ id: d.name.split("/").pop(), ...fields });
    }
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return items;
}

async function write(token, id, iso) {
  const r = await fetch(`${BASE}/backlogItems/${id}?updateMask.fieldPaths=statusEnteredAt&currentDocument.exists=true`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { statusEnteredAt: { timestampValue: iso } } }),
  });
  if (!r.ok) throw new Error(`${id}: write failed (${r.status})`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const password = process.env.BOARD_API_KEY;
  if (!password) { console.error("Set BOARD_API_KEY (the board automation password)."); process.exit(2); }
  const token = await signIn(password);
  const items = await listItems(token);
  const todo = plan(items);
  console.log(`${items.length} tickets read; ${todo.length} without statusEnteredAt.`);
  if (!apply) { console.log("Dry run: nothing written. Add --apply to write."); return; }
  for (const t of todo) await write(token, t.id, t.statusEnteredAt);
  console.log(`Wrote statusEnteredAt on ${todo.length} ticket(s).`);
}

module.exports = { plan };

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
