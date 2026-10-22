// GENERATED from public/js/kanban/kanban-core.js by test/kanban-core-copy.mjs.
// Do not edit: change the source and run  node test/kanban-core-copy.mjs --write
"use strict";
// Staff Kanban: the pure rules of the board, shared by the page
// (kanban-page.js), its data layer (kanban-store.js), the MCP tools
// (functions/kanban-mcp.js keeps a CommonJS copy, checked against this file
// by test/kanban-core.test.mjs) and the tests. No DOM, no Firebase.
//
// Spec: kanban-staff-board/REQUIREMENTS.md. Reference behaviour: the
// signed-off prototype in kanban-staff-board/prototype/js/kanban.js, which
// these functions were lifted from.

const STATUSES = [
  { key: "backlog", label: "Backlog", short: "Backlog" },
  { key: "ready-for-dev", label: "Ready for Dev", short: "Ready for Dev" },
  { key: "in-progress", label: "In Progress", short: "In Progress" },
  { key: "ready-for-testing", label: "Ready for Testing", short: "Testing" },
  { key: "approved", label: "Approved for Deployment", short: "Approved" },
  { key: "done", label: "Completed / Withdrawn", short: "Completed" },
];
const STATUS_KEYS = STATUSES.map((s) => s.key);
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));
// A ticket in the last column is either completed or withdrawn (its resolution).
const RESOLUTIONS = [
  { key: "completed", label: "Completed", icon: "check_circle" },
  { key: "withdrawn", label: "Withdrawn", icon: "block" },
];
const TYPES = [
  { key: "task", label: "Task", icon: "check_box" },
  { key: "bug", label: "Bug", icon: "bug_report" },
  { key: "epic", label: "Epic", icon: "bolt" },
];
const PRIORITIES = [
  { key: "highest", label: "Highest", icon: "keyboard_double_arrow_up" },
  { key: "high", label: "High", icon: "keyboard_arrow_up" },
  { key: "medium", label: "Medium", icon: "drag_handle" },
  { key: "low", label: "Low", icon: "keyboard_arrow_down" },
  { key: "lowest", label: "Lowest", icon: "keyboard_double_arrow_down" },
];
const LINK_TYPES = ["blocks", "is blocked by", "relates to", "duplicates"];

// Core fields are always on the form; optional ones follow Kanban settings.
const CORE_FIELDS = [
  { key: "title", label: "Title", lockRequired: true },
  { key: "description", label: "Description" },
  { key: "reporter", label: "Reporter" },
  { key: "assignee", label: "Assignee" },
  { key: "status", label: "Status", lockRequired: true },
  { key: "release", label: "Release" },
  { key: "estimate", label: "Estimate" },
];
const OPTIONAL_FIELDS = [
  { key: "type", label: "Type" },
  { key: "priority", label: "Priority" },
  { key: "sprint", label: "Sprint" },
  { key: "due", label: "Due date" },
  { key: "logged", label: "Time logged" },
  { key: "labels", label: "Labels" },
  { key: "comments", label: "Comments" },
  { key: "attachments", label: "Attachments" },
  { key: "epic", label: "Parent epic" },
  { key: "links", label: "Linked tickets" },
  { key: "flag", label: "Flag" },
];
const FIELD_LABEL = Object.fromEntries([...CORE_FIELDS, ...OPTIONAL_FIELDS].map((f) => [f.key, f.label]));
const FIELD_KEYS = [...CORE_FIELDS, ...OPTIONAL_FIELDS].map((f) => f.key);

function defaultFields() {
  return {
    title: { show: true, required: true }, description: { show: true, required: false },
    reporter: { show: true, required: true }, assignee: { show: true, required: false },
    status: { show: true, required: true }, release: { show: true, required: false },
    estimate: { show: true, required: false },
    type: { show: true, required: true }, priority: { show: true, required: false },
    sprint: { show: false, required: false }, due: { show: false, required: false },
    logged: { show: true, required: false }, labels: { show: false, required: false },
    comments: { show: true, required: false }, attachments: { show: false, required: false },
    links: { show: false, required: false },
    epic: { show: true, required: false }, flag: { show: true, required: false },
  };
}

// kanbanSettings/main as stored, filled out with defaults. Core fields are
// always shown, and title / status always required, whatever was saved.
function normaliseSettings(raw) {
  const s = raw || {};
  const fields = defaultFields();
  for (const k of FIELD_KEYS) {
    const f = s.fields && s.fields[k];
    if (f && typeof f === "object") fields[k] = { show: !!f.show, required: !!f.required };
  }
  for (const f of CORE_FIELDS) fields[f.key].show = true;
  fields.title.required = true;
  fields.status.required = true;
  for (const k of ["comments", "attachments", "flag", "release"]) fields[k].required = false; // a ticket may have no release
  for (const k of FIELD_KEYS) if (!fields[k].show) fields[k].required = false;
  return {
    fields,
    tester: typeof s.tester === "string" ? s.tester : "",
    currentRelease: typeof s.currentRelease === "string" ? s.currentRelease : "",
    releaseDates: s.releaseDates && typeof s.releaseDates === "object" ? { ...s.releaseDates } : {},
    labels: Array.isArray(s.labels) ? s.labels.filter((l) => typeof l === "string") : [],
    // How each person is named on the board (KB-PPL-1), when the first word
    // of their console name isn't it ("Lê Quang Huy" → "Huy").
    firstNames: s.firstNames && typeof s.firstNames === "object" ? { ...s.firstNames } : {},
  };
}

const res = (t) => (t && t.status === "done" ? (t.resolution === "withdrawn" ? "withdrawn" : "completed") : null);
const statusLabel = (status, resolution) => (status === "done" ? (resolution === "withdrawn" ? "Withdrawn" : "Completed") : STATUS_LABEL[status] || status);
const statusShort = (t) => (t.status === "done" ? statusLabel("done", res(t)) : (STATUSES.find((s) => s.key === t.status) || { short: t.status }).short);
const typeOf = (k) => TYPES.find((t) => t.key === k) || TYPES[0];
const prioOf = (k) => PRIORITIES.find((p) => p.key === k) || PRIORITIES[2];
const remaining = (t) => (t.status === "done" ? 0 : Math.max((+t.estimate || 0) - (+t.logged || 0), 0));
const keyNumber = (key) => { const m = /^PH-(\d+)$/i.exec(String(key || "")); return m ? +m[1] : null; };
const keyOf = (n) => `PH-${n}`;

// Hours to "1d 4h" (1d = 8h), rounded to the half hour.
function fmtH(h) {
  if (h == null || h === "" || isNaN(h)) return "—";
  h = Math.round(+h * 2) / 2;
  if (h === 0) return "0h";
  const d = Math.floor(h / 8), r = +(h - d * 8).toFixed(1);
  return [d ? `${d}d` : "", r ? `${r}h` : ""].filter(Boolean).join(" ");
}
// "1d 4h", "6h", "30m", "1.5" (hours) → hours; "" → null; nonsense → NaN.
function parseDur(str) {
  const s = String(str == null ? "" : str).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return +s;
  let total = 0, matched = false;
  const rest = s.replace(/(\d+(?:\.\d+)?)\s*([dhm])(?![a-z])/g, (_, n, u) => { matched = true; total += +n * (u === "d" ? 8 : u === "h" ? 1 : 1 / 60); return ""; });
  if (!matched || rest.replace(/[\s,]/g, "")) return NaN;
  return Math.round(total * 100) / 100;
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function fmtDate(iso, opts) {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", opts || { day: "numeric", month: "short" });
}
function daysBetween(aIso, bDate) {
  const a = new Date(aIso + "T12:00:00");
  const b = new Date(bDate); b.setHours(12, 0, 0, 0);
  return Math.round((a - b) / 86400000);
}
function workingDaysUntil(iso, today) {
  if (!iso) return 0;
  const end = new Date(iso + "T12:00:00");
  let n = 0;
  for (let d = new Date(today); d < end; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w && w !== 6) n++; }
  return n;
}

// Rank between two neighbours in a column (cards are ordered by rank).
function rankBetween(prev, next) {
  if (prev == null && next == null) return 10;
  if (prev == null) return next - 10;
  if (next == null) return prev + 10;
  return (prev + next) / 2;
}

// ── Status changes: the one place the testing hand-off happens ───────────
// Returns null when nothing changes, else { patch, note, activity } where
// patch holds the fields to write and activity is the line for the log.
// firstName(email) names people in the note.
function statusChange(task, status, { resolution, tester, firstName = (x) => x || "Unassigned" } = {}) {
  if (!STATUS_KEYS.includes(status)) throw new Error(`Unknown status ${status}`);
  const from = task.status, fromRes = res(task);
  const toRes = status === "done" ? (RESOLUTIONS.some((r) => r.key === resolution) ? resolution : fromRes || "completed") : null;
  if (from === status && fromRes === toRes) return null;
  const patch = { status, resolution: toRes, open: status !== "done" };
  let note = "";
  if (status === "ready-for-testing" && tester && task.assignee !== tester) {
    patch.previousAssignee = task.assignee || "";
    patch.assignee = tester;
    note = `reassigned to ${firstName(tester)} for testing`;
  } else if (from === "ready-for-testing" && (status === "in-progress" || status === "ready-for-dev") && task.previousAssignee) {
    patch.assignee = task.previousAssignee;
    note = `returned to ${firstName(task.previousAssignee)}`;
  }
  const activity = `${statusLabel(from, fromRes)} → ${statusLabel(status, toRes)}${note ? " · " + note : ""}`;
  return { patch, note, activity, resolution: toRes };
}

// ── Search ────────────────────────────────────────────────────────────────
const fold = (x) => String(x == null ? "" : x).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

// Tokens stored on each task (searchTokens) so the ticket picker and MCP can
// search on the server with one array-contains query: the key and its
// number, every title word and its prefixes, labels, and the description's
// whole words. Capped so a long description can't bloat the document.
const MAX_TOKENS = 600;
function searchTokens(t) {
  const out = new Set();
  const n = keyNumber(t.key);
  if (n != null) { out.add(String(n)); out.add(`ph-${n}`); }
  for (const w of words(t.title)) {
    for (let i = 2; i <= Math.min(w.length, 12); i++) out.add(w.slice(0, i));
    out.add(w);
  }
  for (const l of t.labels || []) out.add(fold(l));
  for (const w of words(t.descriptionText || "")) {
    if (out.size >= MAX_TOKENS) break;
    if (w.length >= 3 && w.length <= 30) out.add(w);
  }
  return [...out].slice(0, MAX_TOKENS);
}
// The one token a server query uses: the number, else the longest word.
function queryToken(query) {
  const q = fold(query).trim();
  const num = (/^(?:ph-?)?(\d+)$/.exec(q) || [])[1];
  if (num) return num;
  const ws = words(q).filter((w) => w.length >= 2);
  if (!ws.length) return "";
  return ws.reduce((a, b) => (b.length > a.length ? b : a)).slice(0, 30);
}
const byKeyDesc = (a, b) => (keyNumber(b.key) || 0) - (keyNumber(a.key) || 0);
// Rank: exact key, key prefix, title prefix, title words, description words.
// descText(t) gives the folded description text.
function searchTickets(list, query, descText = (t) => fold(t.descriptionText || "")) {
  const q = fold(query).trim();
  const num = (/^(?:ph-?)?(\d+)$/.exec(q) || [])[1];
  if (!q) return list.slice().sort(byKeyDesc).map((t) => ({ t, score: 5, where: "" }));
  const ws = q.split(/\s+/);
  const out = [];
  for (const t of list) {
    const key = String(t.key).toLowerCase(), title = fold(t.title);
    let score = -1, where = "";
    if (num && key === "ph-" + num) score = 0;
    else if (num && key.startsWith("ph-" + num)) score = 1;
    else if (key === q) score = 0;
    else if (title.startsWith(q)) score = 2;
    else if (ws.every((w) => title.includes(w))) score = 3;
    else if (ws.every((w) => title.includes(w) || descText(t).includes(w))) { score = 4; where = "desc"; }
    if (score >= 0) out.push({ t, score, where });
  }
  return out.sort((a, b) => a.score - b.score || byKeyDesc(a.t, b.t));
}
const PICK_LIMIT = 50;

// The board's text search: key, title, description text and labels.
function matchesQuery(t, q) {
  const s = fold(q).trim();
  if (!s) return true;
  return fold(`${t.key} ${t.title} ${t.descriptionText || ""} ${(t.labels || []).join(" ")}`).includes(s);
}

// Board / MCP filters (KB-FLT-1). f: { q, mine, me, flagged, assignees (Set
// or array of emails, "none" = unassigned), release, type, priority, sprint, label }.
function filterTasks(tasks, f) {
  const who = f.assignees instanceof Set ? f.assignees : new Set(f.assignees || []);
  return tasks.filter((t) => {
    if (f.mine && t.assignee !== f.me) return false;
    if (f.flagged && !t.flagged) return false;
    if (who.size && !who.has(t.assignee || "none")) return false;
    if (f.release && t.release !== f.release) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.sprint && t.sprint !== f.sprint) return false;
    if (f.label && !(t.labels || []).includes(f.label)) return false;
    if (f.status && (f.status.startsWith("done:") ? "done:" + res(t) !== f.status : t.status !== f.status)) return false;
    if (f.q && !matchesQuery(t, f.q)) return false;
    return true;
  });
}

// ── Release report (KB-REP-1) ─────────────────────────────────────────────
const CAPACITY_HOURS_PER_DAY = 6;
// tasks: every task in scope; f: { release, status, assignee, type, priority,
// sprint, label, epic }; people: emails in display order.
function releaseReport(tasks, f, { people = [], releaseDate = "", released = false, today = new Date() } = {}) {
  const status = f.status || "outstanding";
  const inScope = tasks.filter((t) => t.type !== "epic" && (!f.release || f.release === "all" || t.release === f.release));
  const filtered = inScope.filter((t) => {
    if (status === "outstanding" ? t.status === "done" : status.startsWith("done:") ? "done:" + res(t) !== status : status !== "all" && t.status !== status) return false;
    if (f.assignee && (t.assignee || "none") !== f.assignee) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.sprint && t.sprint !== f.sprint) return false;
    if (f.label && !(t.labels || []).includes(f.label)) return false;
    if (f.epic && t.epic !== f.epic) return false;
    return true;
  });
  const outstanding = filtered.filter((t) => t.status !== "done");
  const sum = (list, fn) => list.reduce((n, t) => n + fn(t), 0);
  const wd = releaseDate && !released ? workingDaysUntil(releaseDate, today) : 0;
  const capPer = wd * CAPACITY_HOURS_PER_DAY;
  const ids = [...people, ""];
  for (const t of filtered) if (t.assignee && !ids.includes(t.assignee)) ids.splice(ids.length - 1, 0, t.assignee);
  const perPerson = ids.map((id) => {
    const mine = filtered.filter((t) => (t.assignee || "") === id);
    const out = mine.filter((t) => t.status !== "done");
    return { id, tasks: mine, out, est: sum(mine, (t) => +t.estimate || 0), log: sum(mine, (t) => +t.logged || 0), rem: sum(out, remaining) };
  }).filter((p) => p.tasks.length);
  perPerson.sort((a, b) => b.rem - a.rem || b.out.length - a.out.length);
  return {
    status, inScope, filtered, outstanding, perPerson, workingDays: wd, capacityPerPerson: capPer,
    totals: {
      remaining: sum(outstanding, remaining), estimate: sum(filtered, (t) => +t.estimate || 0), logged: sum(filtered, (t) => +t.logged || 0),
      completed: inScope.filter((t) => res(t) === "completed").length, withdrawn: inScope.filter((t) => res(t) === "withdrawn").length,
      flagged: outstanding.filter((t) => t.flagged).length, noEstimate: outstanding.filter((t) => !(+t.estimate)).length,
    },
  };
}

// ── Agent fill: local stand-in ────────────────────────────────────────────
// Used when the console's Claude-backed fill (functions kanbanAgentFill)
// isn't configured or doesn't answer. Reads the transcript for the details
// people usually say out loud and writes a short title and a tidy
// description. ctx: { users: [{id, first}], epics: [{key, title}],
// releases: [{id, name, version}] in order, currentRelease, sprints:
// [{id, start, end}], today: Date }.
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, couple: 2 };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const AGENT_LABELS = [["menu-boards", /menu ?boards?|local offers?|offer/], ["dsp", /\bdsp\b|partner api|exchange|display types?|playlist|advertis/], ["help-centre", /help cent(re|er)|faq|freshdesk/], ["retail-admin", /retail admin|queue|appointment|store hours/], ["hq-admin", /hq admin|product assets|stockists|pricing page/], ["visitor-profile", /visitor profile|personali[sz]ation attribute|attribute/], ["performance", /slow|performance|latency|speed/], ["accessibility", /accessib|screen reader|wcag|contrast/], ["security", /security|permission|consent|rate.?limit/], ["api", /\bapi\b|endpoint|webhook/]];
function agentDraft(raw, ctx = {}) {
  const users = ctx.users || [], epics = ctx.epics || [], releases = ctx.releases || [], sprints = ctx.sprints || [];
  const today = ctx.today ? new Date(ctx.today) : new Date();
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const low = fold(text);
  const out = { labels: [] };
  // assignee: "assign it to Minh", "for Huy to do", "Linh should pick this up"
  for (const u of users) {
    const n = reEsc(fold(u.first));
    if (!n) continue;
    if (new RegExp(`\\b(assign(ed)?( it| this)? to|give (it|this) to|for|ask) ${n}\\b|\\b${n} (should|can|could|to) (pick|take|do|look)`).test(low)) { out.assignee = u.id; break; }
  }
  if (/\b(urgent|asap|as soon as possible|critical|blocker|blocking|show ?stopper|top priority|highest priority)\b/.test(low)) out.priority = "highest";
  else if (/\b(high priority|important|quite urgent|soon as we can)\b/.test(low)) out.priority = "high";
  else if (/\b(lowest priority)\b/.test(low)) out.priority = "lowest";
  else if (/\b(low priority|nice to have|no rush|whenever|not urgent)\b/.test(low)) out.priority = "low";
  else if (/\b(medium priority|normal priority)\b/.test(low)) out.priority = "medium";
  if (/\b(bug|broken|breaks|fails?|failing|failed|error|crash(es|ing)?|doesn'?t work|isn'?t working|not working|wrong|regression|missing)\b/.test(low)) out.type = "bug";
  else if (/\b(epic|programme of work|umbrella)\b/.test(low)) out.type = "epic";
  else out.type = "task";
  const est = low.match(/\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half|couple)\s*(?:of\s*)?(?:an?\s*)?(hours?|hrs?|days?|minutes?|mins?)\b/);
  if (est && /(take|estimate|about|around|roughly|should be|needs?|maybe|probably|half)/.test(low.slice(Math.max(0, est.index - 30), est.index + est[0].length))) {
    const n = NUM[est[1]] != null ? NUM[est[1]] : +est[1];
    out.estimate = /^d/.test(est[2]) ? n * 8 : /^m/.test(est[2]) ? Math.round((n / 60) * 4) / 4 : n;
  }
  // release: named ("PH 4.13", "4.13") or "this / next release"
  const named = releases.find((r) => [r.version, r.name].filter(Boolean).some((v) => {
    const f = fold(v).replace(/^ph\s*/, "");
    return f && new RegExp(`\\b${reEsc(f).replace(/\\\./g, "[ .]")}\\b`).test(low);
  }));
  const curIdx = releases.findIndex((r) => r.id === ctx.currentRelease);
  if (named) out.release = named.id;
  else if (/\bnext release\b/.test(low) && curIdx >= 0 && releases[curIdx + 1]) out.release = releases[curIdx + 1].id;
  else if (/\b(this|current) release\b/.test(low) && ctx.currentRelease) out.release = ctx.currentRelease;
  const day = isoDay(today);
  const curSprint = sprints.find((s) => s.start <= day && (!s.end || s.end >= day));
  if (/\bnext sprint\b/.test(low)) {
    const next = sprints.filter((s) => s.start > day).sort((a, b) => a.start.localeCompare(b.start))[0];
    if (next) out.sprint = next.id;
  } else if (/\bthis sprint\b/.test(low) && curSprint) out.sprint = curSprint.id;
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const byDay = low.match(/\bby (tomorrow|end of (the )?week|monday|tuesday|wednesday|thursday|friday)\b/);
  if (byDay) {
    const d = new Date(today);
    if (byDay[1] === "tomorrow") d.setDate(d.getDate() + 1);
    else { const target = byDay[1].startsWith("end") ? 5 : days.indexOf(byDay[1]); let add = (target - d.getDay() + 7) % 7; if (!add) add = 7; d.setDate(d.getDate() + add); }
    out.due = isoDay(d);
  }
  if (/\b(flag (it|this)|flagged|blocked)\b/.test(low)) out.flagged = true;
  if (out.type !== "epic") {
    const ep = epics.find((e) => { const name = fold(String(e.title).split(" — ")[0]); return name && (low.includes(name) || (/\bepic\b/.test(low) && name.split(" ").filter((w) => w.length > 3).every((w) => low.includes(w)))); });
    if (ep) out.epic = ep.key;
  }
  AGENT_LABELS.forEach(([l, re]) => { if (re.test(low)) out.labels.push(l); });

  // Description: the transcript, minus the routing talk, in tidy sentences.
  const ROUTING = /\b(assign(ed)? (it |this )?to \S+|give (it|this) to \S+|(it'?s |this is |make it )?(urgent|high priority|low priority|medium priority|top priority|nice to have|no rush)|((for|in) )?(the )?(next|this|current) (release|sprint)|(it )?(should|will|might) take (about |around |roughly )?\S+ (hours?|days?|minutes?)|by (tomorrow|end of (the )?week|monday|tuesday|wednesday|thursday|friday)|(maybe|about|around|roughly|probably|approximately) (\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|half an?|a couple of) (hours?|days?|minutes?))\b[,.]?/gi;
  const sentences = text.split(/(?<=[.!?])\s+|\s+(?:and then|also|and also)\s+/i).map((x) => x.replace(ROUTING, "").replace(/\s+([,.])/g, "$1").replace(/^[\s,]*(and|so|um+|uh+|okay|ok|right)[\s,]+/i, "").trim()).filter((x) => x.replace(/[^a-z]/gi, "").length > 3);
  if (out.assignee) {
    const u = users.find((x) => x.id === out.assignee);
    const names = Array.from(new Set([u.first, fold(u.first)])).map(reEsc).join("|");
    const re = new RegExp(`\\b((this is|it'?s) )?(for|ask) (${names})( to (do|pick up|look at|take))?\\b[,.]?|\\b(${names}) (should|can|could) (pick (it|this) up|take (it|this)|do (it|this)|look at (it|this))\\b[,.]?`, "gi");
    for (let i = 0; i < sentences.length; i++) sentences[i] = sentences[i].replace(re, "").replace(/\s+([,.])/g, "$1").trim();
    for (let i = sentences.length - 1; i >= 0; i--) if (sentences[i].replace(/[^a-z]/gi, "").length <= 3) sentences.splice(i, 1);
  }
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  out.description = sentences.map((x) => cap(x).replace(/[,\s]+$/, "") + (/[.!?]$/.test(x) ? "" : ".")).join(" ");

  // Title: the first sentence with the filler taken off, at most ~70 chars.
  let t = (sentences[0] || text)
    .replace(/^(so |ok(ay)? |right |um+ |uh+ )+/i, "")
    .replace(/^(we|i)('d| would)? (need|want|like|have) to (get |have )?/i, "")
    .replace(/^(can|could) (you|we|someone) (please )?/i, "")
    .replace(/^(please |there'?s an? (bug|issue|problem) (where|with|in) |there is an? (bug|issue|problem) (where|with|in) |it'?s (a bug|an issue) (where|with) )/i, "")
    .replace(/^(add|create|make) (a )?(ticket|task) (to |for )?/i, "")
    .replace(/^the /i, "")
    .replace(/[.!?,]+$/, "").trim();
  if (t.length > 72) { t = t.slice(0, 72); t = t.slice(0, t.lastIndexOf(" ")); }
  out.title = cap(t);
  return out;
}

// Plain text of stored HTML, for searching and descriptionText (no DOM).
function htmlToText(html) {
  return String(html || "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
// Emails mentioned in stored HTML (the editor's mention blot).
function mentionsIn(html) {
  const out = new Set();
  String(html || "").replace(/data-user="([^"]+)"/g, (_, id) => { out.add(id.replace(/&amp;/g, "&")); return ""; });
  return [...out];
}

// Validates and normalises the writable fields of a task (MCP and page).
// Returns { value, errors }.
function cleanTaskFields(input, { partial = false } = {}) {
  const v = {}, errors = [];
  const str = (k, max) => {
    if (!(k in input)) return;
    const s = input[k] == null ? "" : String(input[k]);
    if (s.length > max) errors.push(`${k} is limited to ${max} characters`);
    v[k] = s.trim();
  };
  str("title", 200);
  if (!partial && !v.title) errors.push("title is required");
  if ("title" in v && partial && !v.title) errors.push("title can't be empty");
  if ("description" in input) { const s = String(input.description || ""); if (s.length > 200000) errors.push("description is limited to 200000 characters"); v.description = s; }
  if ("type" in input) { if (!TYPES.some((t) => t.key === input.type)) errors.push("type must be task, bug or epic"); else v.type = input.type; }
  if ("priority" in input) { if (input.priority && !PRIORITIES.some((p) => p.key === input.priority)) errors.push("priority must be highest, high, medium, low or lowest"); else v.priority = input.priority || ""; }
  for (const k of ["assignee", "reporter", "previousAssignee"]) if (k in input) { const s = String(input[k] || "").trim().toLowerCase(); if (s && !/^[^@\s]+@[^@\s]+$/.test(s)) errors.push(`${k} must be an email`); else v[k] = s; }
  str("release", 100); str("sprint", 100); str("epic", 20);
  if ("due" in input) { const s = String(input.due || ""); if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors.push("due must be YYYY-MM-DD"); else v.due = s; }
  for (const k of ["estimate", "logged"]) if (k in input) {
    const raw = input[k];
    const n = raw === "" || raw == null ? null : typeof raw === "number" ? raw : parseDur(raw);
    if (Number.isNaN(n) || (n != null && (n < 0 || n > 100000))) errors.push(`${k} must be hours or a duration like 1d 4h`);
    else v[k] = k === "logged" ? n || 0 : n;
  }
  if ("labels" in input) {
    const l = Array.isArray(input.labels) ? input.labels : [];
    v.labels = [...new Set(l.map((x) => String(x).trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))].slice(0, 30);
  }
  if ("links" in input) {
    const l = Array.isArray(input.links) ? input.links : [];
    v.links = l.filter((x) => x && LINK_TYPES.includes(x.type) && keyNumber(x.key) != null).map((x) => ({ type: x.type, key: String(x.key).toUpperCase() })).slice(0, 50);
  }
  if ("flagged" in input) v.flagged = !!input.flagged;
  return { value: v, errors };
}

module.exports = { STATUSES, STATUS_KEYS, STATUS_LABEL, RESOLUTIONS, TYPES, PRIORITIES, LINK_TYPES, CORE_FIELDS, OPTIONAL_FIELDS, FIELD_LABEL, FIELD_KEYS, defaultFields, normaliseSettings, res, statusLabel, statusShort, typeOf, prioOf, remaining, keyNumber, keyOf, fmtH, parseDur, isoDay, fmtDate, daysBetween, workingDaysUntil, rankBetween, statusChange, fold, MAX_TOKENS, searchTokens, queryToken, searchTickets, PICK_LIMIT, matchesQuery, filterTasks, CAPACITY_HOURS_PER_DAY, releaseReport, AGENT_LABELS, agentDraft, htmlToText, mentionsIn, cleanTaskFields };
