// functions/support-mail.js — the Support Inbox: connecting the mailbox, the
// sync, triage, replies and escalation. No Firebase, no network: Firestore,
// ID-token checks, Google and the drafting model are stubbed.
// Run: node test/support-mail.test.js
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { createSupportMail, SCOPE } = require("../functions/support-mail");

const ENC = crypto.randomBytes(32).toString("base64");
const BOARD = "board-key-123";
const MAILBOX = "support@ph.example";
const CLIENT_ID = "1234567890-abcdef123.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-test-secret-0123456789";
const USERS = {
  "admin@ph.example": { email: "admin@ph.example", role: "admin" },
  "ed@ph.example": { email: "ed@ph.example", role: "editor" },
  "view@ph.example": { email: "view@ph.example", role: "viewer" },
};

// An in-memory Firestore: documents by path, subcollections, where/limit, transactions.
function fakeDb() {
  const state = {};
  const col = (path) => {
    state[path] = state[path] || {};
    const docRef = (id) => ({
      id,
      async get() { const d = state[path][id]; return { exists: d !== undefined, id, data: () => d }; },
      async set(data, opts) { state[path][id] = opts && opts.merge ? { ...(state[path][id] || {}), ...data } : { ...data }; },
      async delete() { delete state[path][id]; },
      collection: (name) => col(`${path}/${id}/${name}`),
    });
    const snap = (rows) => ({ forEach: (fn) => rows.forEach(([id, d]) => fn({ id, data: () => d })), size: rows.length });
    const q = (filters, n) => ({
      where: (f, op, v) => q([...filters, [f, v]], n),
      limit: (k) => q(filters, k),
      async get() { let rows = Object.entries(state[path]).filter(([, d]) => filters.every(([f, v]) => d[f] === v)); if (n) rows = rows.slice(0, n); return snap(rows); },
    });
    return { doc: docRef, where: (f, op, v) => q([[f, v]]), limit: (k) => q([], k), get: () => q([]).get() };
  };
  return {
    collection: col, state,
    async runTransaction(fn) { return fn({ get: (ref) => ref.get(), set: (ref, data) => ref.set(data) }); },
  };
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
function gmailMessage({ id, threadId, from = "Ann Lee <ann@shop.example>", subject = "How do I add a display?", text = "Hi, how do I add a display to my store?", labels = ["INBOX"], date, headers = {} }) {
  return { id, threadId, labelIds: labels, internalDate: String(date),
    payload: { mimeType: "text/plain", body: { data: b64(text) },
      headers: Object.entries({ From: from, To: MAILBOX, Subject: subject, "Message-ID": `<${id}@mail.example>`, ...headers }).map(([name, value]) => ({ name, value })) } };
}

// A stand-in for Google: the token endpoint and the Gmail API over `mail`.
function fakeGoogle(mail) {
  const calls = { sent: [], modified: [], token: [], revoked: 0 };
  let refreshOk = true;
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.href.startsWith("https://oauth2.googleapis.com/token")) {
      const p = new URLSearchParams(opts.body);
      calls.token.push(Object.fromEntries(p));
      if (p.get("client_secret") !== CLIENT_SECRET) return json(401, { error: "invalid_client" });
      if (p.get("grant_type") === "authorization_code") return p.get("code") === "good-code" ? json(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: SCOPE }) : json(400, { error: "invalid_grant" });
      return refreshOk && p.get("refresh_token") === "rt-1" ? json(200, { access_token: "at-2", expires_in: 3600 }) : json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    }
    if (u.href.startsWith("https://oauth2.googleapis.com/revoke")) { calls.revoked += 1; return json(200, {}); }
    if (!/^Bearer at-/.test((opts.headers || {}).Authorization || "")) return json(401, { error: { message: "no token" } });
    const path = u.pathname.replace("/gmail/v1/users/me/", "");
    if (path === "profile") return json(200, { emailAddress: MAILBOX });
    if (path === "messages" && (!opts.method || opts.method === "GET")) return json(200, { messages: mail.map((m) => ({ id: m.id, threadId: m.threadId })) });
    if (path === "messages/send") {
      const body = JSON.parse(opts.body);
      const id = `sent-${calls.sent.length + 1}`;
      calls.sent.push({ id, threadId: body.threadId, mail: Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") });
      return json(200, { id, threadId: body.threadId });
    }
    const one = path.match(/^messages\/([^/]+)$/);
    if (one) { const m = mail.find((x) => x.id === decodeURIComponent(one[1])); return m ? json(200, m) : json(404, { error: { message: "not found" } }); }
    const mod = path.match(/^threads\/([^/]+)\/modify$/);
    if (mod) { calls.modified.push({ threadId: mod[1], ...JSON.parse(opts.body) }); return json(200, {}); }
    return json(404, { error: { message: `unhandled ${path}` } });
  };
  return { fetch, calls, breakRefresh: () => { refreshOk = false; } };
}

const ARTICLE = { status: "published", title: "Add a display to a store", summary: "Pair a new screen with a store", keywords: ["display", "store"], bodyMd: "<p>Open Displays and Devices, then Add display.</p>" };
const GOOD = { category: "how-to", summary: "Wants to add a display.", answerable: true, confidence: 0.92, reply: "Hello Ann,\n\nOpen Displays and Devices, then Add display.", articleIds: ["a1"], spamLikely: false };

function make({ mail = [], triage = async () => GOOD, db = fakeDb(), settings = {}, prospects = {}, kanban = true } = {}) {
  const google = fakeGoogle(mail);
  let clock = 1760000000000;
  const kanbanCalls = { created: [], comments: [] };
  db.state.faqArticles = { a1: ARTICLE, a2: { status: "draft", title: "Unpublished display notes", keywords: ["display"] } };
  db.state.prospects = prospects;
  db.state.leads = {};
  if (Object.keys(settings).length) db.state.supportSettings = { main: settings };
  const api = createSupportMail({
    db,
    verifyIdToken: async (t) => { if (!t.startsWith("tok:")) throw new Error("bad"); return { email: t.slice(4) }; },
    resolveConsoleUser: async (email) => USERS[email] || null,
    encKey: () => ENC, boardKey: () => BOARD, anthropicKey: () => "sk-test",
    fetch: google.fetch, logger: { warn() {}, error() {}, info() {} }, now: () => new Date(clock += 1000),
    baseUrl: "https://console.example", triage, freeDomains: ["gmail.com"],
    createKanbanTask: kanban ? async (task, actor) => { kanbanCalls.created.push({ task, actor }); return `PH-${kanbanCalls.created.length}`; } : null,
    commentKanbanTask: async (key, text, actor) => { kanbanCalls.comments.push({ key, text, actor }); },
  });
  return { api, db, google, kanbanCalls, tick: (ms) => { clock += ms; }, mail };
}

async function call(api, method, path, { token, board, body, query, ip = "1.2.3.4" } = {}) {
  const headers = { "x-firebase-id-token": token ? `tok:${token}` : "", "x-board-key": board || "", "x-forwarded-for": ip };
  const req = { method, path: `/supportMail${path}`, body, query: query || {}, get: (h) => headers[h.toLowerCase()] || "" };
  const res = { statusCode: 0, body: null, location: "", headers: {}, status(c) { this.statusCode = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, json(b) { this.body = b; return this; }, redirect(c, url) { this.statusCode = c; this.location = url; return this; } };
  await api.handle(req, res);
  return res;
}

// Save the client, start the sign-in and come back from Google.
async function connect(t) {
  assert.strictEqual((await call(t.api, "POST", "/v1/oauth/client", { token: "admin@ph.example", body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } })).statusCode, 200);
  const start = await call(t.api, "POST", "/v1/oauth/start", { token: "admin@ph.example" });
  const state = new URL(start.body.url).searchParams.get("state");
  const back = await call(t.api, "GET", "/v1/oauth/callback", { query: { code: "good-code", state } });
  assert.ok(back.location.endsWith("#settings/support?connected=1"), back.location);
  return { start, state };
}
const ticketOf = (t, id) => t.db.state.supportTickets[id];
const messagesOf = (t, id) => Object.values(t.db.state[`supportTickets/${id}/messages`] || {});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("roles: signed-out and non-members get nothing; only an admin touches the connection; a viewer can't act on tickets", async () => {
  const t = make();
  assert.strictEqual((await call(t.api, "GET", "/v1/status")).statusCode, 401);
  assert.strictEqual((await call(t.api, "GET", "/v1/status", { token: "nobody@x.example" })).statusCode, 403);
  assert.strictEqual((await call(t.api, "GET", "/v1/status", { token: "view@ph.example" })).statusCode, 200);
  for (const p of ["/v1/oauth/client", "/v1/oauth/start", "/v1/disconnect", "/v1/settings"]) {
    assert.strictEqual((await call(t.api, "POST", p, { token: "ed@ph.example", body: {} })).statusCode, 403, p);
  }
  assert.strictEqual((await call(t.api, "POST", "/v1/sync", { token: "view@ph.example" })).statusCode, 403);
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/t1/reply", { token: "view@ph.example", body: { text: "x" } })).statusCode, 403);
  assert.strictEqual((await call(t.api, "POST", "/v1/sync", { board: BOARD })).statusCode, 401, "the board key is not a person");
});

check("connecting: secrets are stored encrypted, never returned, and the callback needs the single-use state", async () => {
  const t = make();
  assert.strictEqual((await call(t.api, "POST", "/v1/oauth/client", { token: "admin@ph.example", body: { clientId: "nope", clientSecret: CLIENT_SECRET } })).statusCode, 400);
  assert.strictEqual((await call(t.api, "POST", "/v1/oauth/start", { token: "admin@ph.example" })).statusCode, 409, "no client yet");
  const { start, state } = await connect(t);
  const url = new URL(start.body.url);
  assert.strictEqual(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.strictEqual(url.searchParams.get("scope"), SCOPE);
  assert.strictEqual(url.searchParams.get("access_type"), "offline");
  assert.strictEqual(url.searchParams.get("redirect_uri"), "https://console.example/supportMail/v1/oauth/callback");
  const stored = JSON.stringify(t.db.state.supportSecrets);
  assert.ok(!stored.includes(CLIENT_SECRET) && !stored.includes("rt-1"), "no secret in the clear in Firestore");
  const status = (await call(t.api, "GET", "/v1/status", { token: "view@ph.example" })).body;
  assert.deepStrictEqual([status.connected, status.connectedEmail, status.connectedBy], [true, MAILBOX, "admin@ph.example"]);
  assert.ok(!JSON.stringify(status).includes(CLIENT_SECRET) && !JSON.stringify(status).includes("rt-1"));
  assert.strictEqual(status.settings.escalationAssignee, "admin@ph.example", "whoever connected is who a high-value ticket goes to");
  assert.strictEqual(status.settings.autoReply, false);
  // The state cannot be replayed, guessed or used late.
  assert.ok((await call(t.api, "GET", "/v1/oauth/callback", { query: { code: "good-code", state } })).location.includes("error=expired"), "single use");
  assert.ok((await call(t.api, "GET", "/v1/oauth/callback", { query: { code: "good-code", state: "x".repeat(48) } })).location.includes("error=expired"));
  const again = await call(t.api, "POST", "/v1/oauth/start", { token: "admin@ph.example" });
  t.tick(11 * 60 * 1000);
  assert.ok((await call(t.api, "GET", "/v1/oauth/callback", { query: { code: "good-code", state: new URL(again.body.url).searchParams.get("state") } })).location.includes("error=expired"), "ten minutes at most");
});

check("sync files new customer mail as a ticket once, drafts a reply from published articles, and waits for approval by default", async () => {
  let seen = null;
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })], triage: async (input) => { seen = input; return GOOD; } });
  await connect(t);
  const r = await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.deepStrictEqual([r.statusCode, r.body.newTickets, r.body.newMessages, r.body.triaged], [200, 1, 1, 1]);
  const tk = ticketOf(t, "t1");
  assert.deepStrictEqual([tk.key, tk.status, tk.customerEmail, tk.customerName, tk.needsHuman, tk.triagePending], ["SUP-1", "open", "ann@shop.example", "Ann Lee", false, false]);
  assert.strictEqual(tk.aiDraft.text, GOOD.reply);
  assert.deepStrictEqual(tk.aiDraft.articles.map((a) => a.id), ["a1"]);
  assert.deepStrictEqual(seen.candidates.map((a) => a.id), ["a1"], "only published articles are offered to the model");
  assert.strictEqual(t.google.calls.sent.length, 0, "nothing is sent while sending by itself is off");
  // Reading the same mail again changes nothing.
  const again = await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.deepStrictEqual([again.body.newTickets, again.body.newMessages], [0, 0]);
  assert.strictEqual(messagesOf(t, "t1").length, 1);
});

check("with sending switched on, a confident answer goes out once on the thread and the ticket is resolved by AI", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })], settings: { autoReply: true, autoReplyThreshold: 0.8, signature: "PH Support" } });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(t.google.calls.sent.length, 1);
  const sent = t.google.calls.sent[0];
  assert.strictEqual(sent.threadId, "t1");
  assert.ok(/^To: ann@shop\.example$/m.test(sent.mail) && /^In-Reply-To: <m1@mail\.example>$/m.test(sent.mail) && /^Auto-Submitted: auto-replied$/m.test(sent.mail));
  assert.ok(/^Subject: Re: How do I add a display\?$/m.test(sent.mail));
  const tk = ticketOf(t, "t1");
  assert.deepStrictEqual([tk.status, tk.resolvedBy, tk.humanInvolved, tk.autoRepliesSent, tk.aiDraft], ["resolved", "ai", false, 1, null]);
  assert.ok(tk.firstResponseAt && tk.resolvedAt);
  const out = messagesOf(t, "t1").find((m) => m.direction === "out");
  assert.ok(out.auto && out.text.endsWith("PH Support") && out.sentBy === "ai");
  // The customer writes back: reopened, and the second answer is NOT sent by itself.
  t.mail.push(gmailMessage({ id: "m2", threadId: "t1", date: 1760000500000, text: "That didn't work for my display in the store" }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  const after = ticketOf(t, "t1");
  assert.deepStrictEqual([after.status, after.reopenCount, after.resolvedBy], ["open", 1, ""]);
  assert.strictEqual(t.google.calls.sent.length, 1, "one automatic answer per thread");
  assert.ok(after.aiDraft, "the new draft waits for a person");
});

check("a Reply-To that isn't the sender is never answered automatically", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000, headers: { "Reply-To": "victim@elsewhere.example" } })], settings: { autoReply: true } });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(t.google.calls.sent.length, 0);
  const tk = ticketOf(t, "t1");
  assert.deepStrictEqual([tk.customerEmail, tk.fromEmail, tk.status], ["victim@elsewhere.example", "ann@shop.example", "open"]);
  assert.ok(tk.aiDraft, "the draft waits for a person");
});

check("connecting a different mailbox drops the old mailbox's cached access", async () => {
  const t = make({ mail: [] });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual((await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" })).statusCode, 200, "the cached access works while the sign-in is unchanged");
  // Another instance stores a new sign-in; this one must not keep using its cached token.
  t.db.state.supportSecrets.gmail = { ...t.db.state.supportSecrets.gmail, refresh: { ...t.db.state.supportSecrets.gmail.refresh, iv: "changed" } };
  t.tick(31000);
  const r = await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(r.statusCode, 502, "the changed sign-in is read again (and here refused), not silently replaced by the old mailbox's access");
});

check("machine-sent mail is never drafted or answered, even with sending switched on", async () => {
  let asked = 0;
  const t = make({ mail: [gmailMessage({ id: "n1", threadId: "tn", date: 1759990000000, from: "Deals <no-reply@shop.example>", headers: { "List-Unsubscribe": "<mailto:u@shop.example>" } })],
    settings: { autoReply: true }, triage: async () => { asked += 1; return GOOD; } });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  const tk = ticketOf(t, "tn");
  assert.ok(tk.automated);
  assert.deepStrictEqual([tk.needsHuman, tk.aiDraft, tk.status, tk.highValue], [false, null, "open", false]);
  assert.strictEqual(asked, 0, "no model call for a newsletter");
  assert.strictEqual(t.google.calls.sent.length, 0);
});

check("a high-value sender is never answered automatically: it needs a person and a flagged Staff Kanban ticket is raised once", async () => {
  const t = make({ mail: [gmailMessage({ id: "h1", threadId: "th", date: 1759990000000, from: "Bo <bo@bigretail.example>" })],
    settings: { autoReply: true }, prospects: { p1: { name: "Big Retail", website: "https://www.bigretail.example" } } });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  const tk = ticketOf(t, "th");
  assert.deepStrictEqual([tk.highValue, tk.account.kind, tk.account.name, tk.needsHuman, tk.status, tk.kanbanKey], [true, "prospect", "Big Retail", true, "open", "PH-1"]);
  assert.strictEqual(t.google.calls.sent.length, 0);
  assert.ok(tk.aiDraft, "a suggested reply is still there for the person");
  const k = t.kanbanCalls.created[0];
  assert.deepStrictEqual([k.task.assignee, k.task.priority, k.task.flagged, k.actor], ["admin@ph.example", "highest", true, "admin@ph.example"]);
  assert.ok(k.task.title.startsWith("Support SUP-1:") && k.task.description.includes("#support/ticket/th") && k.task.labels.includes("high-value"));
  // A second message on the thread does not raise a second Kanban ticket.
  t.mail.push(gmailMessage({ id: "h2", threadId: "th", date: 1760000500000, from: "Bo <bo@bigretail.example>" }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(t.kanbanCalls.created.length, 1);
  // Resolving it tells the Kanban ticket.
  await call(t.api, "POST", "/v1/tickets/th/status", { token: "ed@ph.example", body: { status: "resolved" } });
  assert.deepStrictEqual(t.kanbanCalls.comments.map((c) => c.key), ["PH-1"]);
});

check("a person replies from the console: sent on the thread, attributed, first response stamped, ticket waiting or resolved", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })], triage: async () => ({ ...GOOD, answerable: false, articleIds: [] }) });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(ticketOf(t, "t1").needsHuman, true, "the help centre didn't answer it");
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/t1/reply", { token: "ed@ph.example", body: { text: "  " } })).statusCode, 400);
  const r = await call(t.api, "POST", "/v1/tickets/t1/reply", { token: "ed@ph.example", body: { text: "Hello Ann, we're on it.", draft: "ai-draft-edited" } });
  assert.deepStrictEqual([r.statusCode, r.body.status], [200, "pending"]);
  assert.ok(!/Auto-Submitted/.test(t.google.calls.sent[0].mail));
  let tk = ticketOf(t, "t1");
  assert.deepStrictEqual([tk.status, tk.humanInvolved, tk.needsHuman, tk.aiDraft], ["pending", true, false, null]);
  assert.ok(tk.firstResponseAt);
  const out = messagesOf(t, "t1").find((m) => m.direction === "out");
  assert.deepStrictEqual([out.sentBy, out.source, out.auto], ["ed@ph.example", "ai-draft-edited", false]);
  // The reply the console sent comes back in the next sync and is not filed twice.
  t.mail.push(gmailMessage({ id: "sent-1", threadId: "t1", date: 1760000400000, from: `PH <${MAILBOX}>`, labels: ["SENT"], text: "Hello Ann, we're on it." }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(messagesOf(t, "t1").filter((m) => m.direction === "out").length, 1);
  const done = await call(t.api, "POST", "/v1/tickets/t1/reply", { token: "ed@ph.example", body: { text: "All fixed.", resolve: true } });
  tk = ticketOf(t, "t1");
  assert.deepStrictEqual([done.body.status, tk.status, tk.resolvedBy], ["resolved", "resolved", "ed@ph.example"]);
});

check("a reply written in Gmail itself counts as a person answering", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })] });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  t.mail.push(gmailMessage({ id: "g1", threadId: "t1", date: 1760000400000, from: `PH <${MAILBOX}>`, labels: ["SENT"], text: "Answered from Gmail" }));
  t.mail.push(gmailMessage({ id: "o1", threadId: "other", date: 1760000400000, from: `PH <${MAILBOX}>`, labels: ["SENT"], text: "Mail we started" }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  const tk = ticketOf(t, "t1");
  assert.deepStrictEqual([tk.status, tk.humanInvolved, tk.aiDraft], ["pending", true, null]);
  assert.strictEqual(ticketOf(t, "other"), undefined, "mail the mailbox started is not a ticket");
});

check("spam: marked in the console and in Gmail, later mail doesn't reopen it, and it can be put back", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })] });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/t1/status", { token: "ed@ph.example", body: { status: "junk" } })).statusCode, 400);
  await call(t.api, "POST", "/v1/tickets/t1/status", { token: "ed@ph.example", body: { status: "spam" } });
  assert.deepStrictEqual(t.google.calls.modified[0], { threadId: "t1", addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] });
  assert.deepStrictEqual([ticketOf(t, "t1").status, ticketOf(t, "t1").aiDraft], ["spam", null]);
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/t1/reply", { token: "ed@ph.example", body: { text: "hello" } })).statusCode, 409);
  t.mail.push(gmailMessage({ id: "m2", threadId: "t1", date: 1760000500000 }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(ticketOf(t, "t1").status, "spam");
  await call(t.api, "POST", "/v1/tickets/t1/status", { token: "ed@ph.example", body: { status: "open" } });
  assert.deepStrictEqual(t.google.calls.modified[1], { threadId: "t1", addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] });
  assert.ok(messagesOf(t, "t1").some((m) => m.direction === "event" && /spam/i.test(m.text) && m.by === "ed@ph.example"), "who did it is on the timeline");
});

check("notes, assignment and a manual Staff Kanban ticket", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })] });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/t1/note", { token: "ed@ph.example", body: { text: "Called the store." } })).statusCode, 200);
  assert.ok(messagesOf(t, "t1").some((m) => m.direction === "note" && m.by === "ed@ph.example"));
  assert.strictEqual(t.google.calls.sent.length, 0, "a note is never emailed");
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/t1/assign", { token: "ed@ph.example", body: { assignee: "stranger@x.example" } })).statusCode, 400);
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/t1/assign", { token: "ed@ph.example", body: { assignee: "Admin@PH.example" } })).statusCode, 200);
  assert.strictEqual(ticketOf(t, "t1").assignee, "admin@ph.example");
  const e = await call(t.api, "POST", "/v1/tickets/t1/escalate", { token: "ed@ph.example" });
  assert.deepStrictEqual([e.statusCode, e.body.key, ticketOf(t, "t1").kanbanKey], [200, "PH-1", "PH-1"]);
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/missing/note", { token: "ed@ph.example", body: { text: "x" } })).statusCode, 404);
});

check("when the model fails the ticket still arrives and goes to a person", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })], settings: { autoReply: true }, triage: async () => { throw new Error("model down"); } });
  await connect(t);
  const r = await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(r.statusCode, 200);
  const tk = ticketOf(t, "t1");
  assert.deepStrictEqual([tk.needsHuman, tk.aiDraft, tk.triagePending], [true, null, false]);
  assert.ok(/model down/.test(tk.triageReason));
});

check("a revoked Google sign-in is reported, not hidden; settings are validated; disconnect forgets the token", async () => {
  const t = make({ mail: [] });
  await connect(t);
  const bad = await call(t.api, "POST", "/v1/settings", { token: "admin@ph.example", body: { autoReplyThreshold: 0.1 } });
  assert.strictEqual(bad.statusCode, 400);
  assert.strictEqual((await call(t.api, "POST", "/v1/settings", { token: "admin@ph.example", body: { escalationAssignee: "stranger@x.example" } })).statusCode, 400);
  const ok = await call(t.api, "POST", "/v1/settings", { token: "admin@ph.example", body: { autoReply: true, autoReplyThreshold: 0.9, vipDomains: "vip.example", escalationAssignee: "ed@ph.example" } });
  assert.deepStrictEqual([ok.statusCode, ok.body.settings.autoReply, ok.body.settings.vipDomains, ok.body.settings.escalationAssignee], [200, true, ["vip.example"], "ed@ph.example"]);
  t.tick(2 * 3600 * 1000); // the cached access token has expired
  t.google.breakRefresh();
  const r = await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(r.statusCode, 502);
  const st = (await call(t.api, "GET", "/v1/status", { token: "admin@ph.example" })).body;
  assert.ok(/Connect the mailbox again/.test(st.connectionError) && st.lastSyncOk === false);
  await call(t.api, "POST", "/v1/disconnect", { token: "admin@ph.example" });
  const after = (await call(t.api, "GET", "/v1/status", { token: "admin@ph.example" })).body;
  assert.deepStrictEqual([after.connected, after.connectedEmail], [false, ""]);
  assert.strictEqual(t.db.state.supportSecrets.gmail.refresh, null);
});

check("the scheduled sync uses the board key, with a brake on guessing; not connected is not a failure", async () => {
  const t = make();
  assert.strictEqual((await call(t.api, "POST", "/v1/cron", { board: "wrong" })).statusCode, 401);
  assert.strictEqual((await call(t.api, "POST", "/v1/cron", { token: "admin@ph.example" })).statusCode, 401, "a sign-in is not the board key");
  assert.strictEqual((await call(t.api, "POST", "/v1/cron", { board: BOARD })).statusCode, 200);
  for (let i = 0; i < 10; i++) await call(t.api, "POST", "/v1/cron", { board: "wrong", ip: "9.9.9.9" });
  assert.strictEqual((await call(t.api, "POST", "/v1/cron", { board: BOARD, ip: "9.9.9.9" })).statusCode, 429);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\nsupport-mail: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
