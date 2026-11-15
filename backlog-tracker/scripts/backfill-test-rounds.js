#!/usr/bin/env node
// One-off (safe to repeat) backfill of the testing-rounds fields — testRound,
// sendBacks, sendBackCount, countedSendBacks — on every non-archived ticket
// that has none yet, read from its notes with the same rules as
// public/js/rejection-summary.js's rejectionsOf (functions/test-rounds.js →
// backfillFields; test/test-rounds.test.js checks the two agree).
//
// Ticket hm84opFjizq3vekk0fC1 (Flow 4/9). The board and the automation fall
// back to the notes for a card without the fields, so nothing is wrong
// before this runs; it makes every card carry its count, so the loop cap and
// the MCP board read the stored number rather than re-parsing notes.
//
// Run it from the deploy session of the train that ships this (it has the
// board automation password) or anywhere BOARD_API_KEY is set:
//
//   BOARD_API_KEY=… node backlog-tracker/scripts/backfill-test-rounds.js           # dry run: counts only
//   BOARD_API_KEY=… node backlog-tracker/scripts/backfill-test-rounds.js --apply   # write
//
// Never overwrites a card that already has the fields (the automation or the
// MCP server wrote them), and never touches notes or status. It writes only
// the four fields, through the board automation user, with an updateMask.
"use strict";

const { backfillFields, hasStoredLoop } = require("../functions/test-rounds");

const API_KEY = "AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g";
const AUTOMATION_EMAIL = "board-automation@backlog-tracker-e4ed2.firebaseapp.com";
const BASE = "https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents";
const FIELDS = ["testRound", "sendBacks", "sendBackCount", "countedSendBacks", "notes", "status"];

// ── Firestore REST value codec (just what these fields need) ──────────────
function decode(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  return null;
}
function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
  return { stringValue: String(v) };
}

// Pure: which cards to write and with what. Exported for the test.
function plan(items) {
  const out = [];
  for (const item of items) {
    if (!item || item.status === "archived" || hasStoredLoop(item)) continue;
    out.push({ id: item.id, fields: backfillFields(item) });
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

async function write(token, id, fields) {
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join("&");
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)])) };
  const r = await fetch(`${BASE}/backlogItems/${id}?${mask}&currentDocument.exists=true`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
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
  const looping = todo.filter((t) => t.fields.countedSendBacks >= 2).length;
  console.log(`${items.length} tickets read; ${todo.length} without testing-round fields (${looping} sent back twice or more).`);
  if (!apply) { console.log("Dry run: nothing written. Add --apply to write."); return; }
  let done = 0;
  for (const t of todo) {
    await write(token, t.id, t.fields);
    done++;
  }
  console.log(`Wrote testRound, sendBacks, sendBackCount and countedSendBacks on ${done} ticket(s).`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { plan, decode, encode };
