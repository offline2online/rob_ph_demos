// functions/support-mail.js — the Support Inbox: connecting the mailbox, the
// sync, triage, replies and escalation. No Firebase, no network: Firestore,
// ID-token checks, Google and the drafting model are stubbed.
// Run: node test/support-mail.test.js
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { createSupportMail, runTriage, SCOPE } = require("../functions/support-mail");

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
      // A message sent with no thread starts one, as Gmail does.
      return json(200, { id, threadId: body.threadId || `thread-${id}` });
    }
    const att = path.match(/^messages\/([^/]+)\/attachments\/([^/]+)$/);
    if (att) { const a = (mail.attachments || {})[decodeURIComponent(att[2])]; return a ? json(200, { data: a, size: a.length }) : json(404, { error: { message: "no attachment" } }); }
    const one = path.match(/^messages\/([^/]+)$/);
    if (one) { const m = mail.find((x) => x.id === decodeURIComponent(one[1])); return m ? json(200, m) : json(404, { error: { message: "not found" } }); }
    const mod = path.match(/^threads\/([^/]+)\/modify$/);
    if (mod) { calls.modified.push({ threadId: mod[1], ...JSON.parse(opts.body) }); return json(200, {}); }
    return json(404, { error: { message: `unhandled ${path}` } });
  };
  return { fetch, calls, breakRefresh: () => { refreshOk = false; } };
}

const ARTICLE = { categoryId: "c1", status: "published", title: "Add a display to a store", summary: "Pair a new screen with a store", keywords: ["display", "store"], bodyMd: "<p>Open Displays and Devices, then Add display.</p>" };
const GOOD = { category: "how-to", summary: "Wants to add a display.", answerable: true, confidence: 0.92, reply: "Hello Ann,\n\nOpen Displays and Devices, then Add display.", articleIds: ["a1"], spamLikely: false };

function make({ mail = [], triage = async () => GOOD, db = fakeDb(), settings = {}, prospects = {}, kanban = true, aidan = null, bucket = null } = {}) {
  const google = fakeGoogle(mail);
  let clock = 1760000000000;
  const kanbanCalls = { created: [], comments: [] };
  db.state.faqArticles = { a1: ARTICLE, a2: { status: "draft", title: "Unpublished display notes", keywords: ["display"] } };
  db.state.faqCategories = { c1: { name: "Digital Signage" } };
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
    aidan, bucket,
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

check("hidden-from-website articles (own flag or hidden category) are still offered to the model, with no website link", async () => {
  let seen = null;
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })], triage: async (input) => { seen = input; return GOOD; } });
  t.db.state.faqArticles.h1 = { categoryId: "c1", status: "published", hiddenFromWebsite: true, title: "Run your own retail media: set up", keywords: ["retail media"], bodyMd: "<p>Steps.</p>" };
  t.db.state.faqArticles.h2 = { categoryId: "rm", status: "published", title: "Retail media pricing", keywords: ["retail media"], bodyMd: "<p>Prices.</p>" };
  t.db.state.faqCategories.rm = { name: "Run your own retail media", hiddenFromWebsite: true };
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  const byId = Object.fromEntries(seen.articles.map((a) => [a.id, a]));
  assert.deepStrictEqual(Object.keys(byId).sort(), ["a1", "h1", "h2"], "hidden published articles are answered from; drafts still aren't");
  assert.ok(/^https:\/\//.test(byId.a1.url), "a website article keeps its link");
  assert.deepStrictEqual([byId.h1.url, byId.h1.hiddenFromWebsite, byId.h2.url, byId.h2.hiddenFromWebsite], ["", true, "", true], "a hidden one has no page to link to");
});

check("sync files new customer mail as a ticket once, drafts a reply from published articles, and waits for approval by default", async () => {
  let seen = null;
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })], triage: async (input) => { seen = input; return GOOD; } });
  await connect(t);
  const r = await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.deepStrictEqual([r.statusCode, r.body.newTickets, r.body.newMessages, r.body.triaged], [200, 1, 1, 1]);
  const tk = ticketOf(t, "t1");
  assert.deepStrictEqual([tk.key, tk.status, tk.customerEmail, tk.customerName, tk.needsHuman, tk.triagePending], ["SUP-1", "open", "ann@shop.example", "Ann Lee", false, false]);
  assert.strictEqual(tk.aiDraft.text, "Hi Ann,\n\nThanks for your email.\n\nOpen Displays and Devices, then Add display.", "the draft opens with the first name and thanks, and the model's own greeting is not doubled");
  assert.deepStrictEqual(tk.aiDraft.articles.map((a) => a.id), ["a1"]);
  assert.deepStrictEqual(seen.articles.map((a) => a.id), ["a1"], "only published articles are offered to the model");
  assert.strictEqual(seen.articles[0].categoryName, "Digital Signage", "each article carries its category for the matching step");
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

check("an email that isn't about Personalisation Hub is filed with no draft, no article and no send, even with sending on", async () => {
  const t = make({ mail: [gmailMessage({ id: "u1", threadId: "tu", date: 1759990000000, from: "Seo Pro <hello@seo-agency.example>", subject: "Rank #1 on Google", text: "We can get your site to the top of Google." })],
    settings: { autoReply: true }, triage: async () => ({ relevant: false, category: "other", summary: "SEO services offer", answerable: true, confidence: 0.9, reply: "Thanks!", articleIds: ["a1"], spamLikely: false }) });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  const tk = ticketOf(t, "tu");
  assert.deepStrictEqual([tk.unrelated, tk.category, tk.aiDraft, tk.needsHuman, tk.status], [true, "unrelated", null, false, "open"]);
  assert.ok(/Not about Personalisation Hub/.test(tk.triageReason));
  assert.strictEqual(t.google.calls.sent.length, 0);
});

check("Try an email is gone: its route answers not found, to an admin too", async () => {
  const t = make();
  await connect(t);
  assert.strictEqual((await call(t.api, "POST", "/v1/preview", { token: "admin@ph.example", body: { subject: "x", text: "y" } })).statusCode, 404);
});

check("compose: an editor sends a new email from the mailbox; it is filed as a Support Inbox ticket waiting on the customer", async () => {
  const t = make({ settings: { signature: "PH Support", fromName: "PH Support" } });
  await connect(t);
  const ok = { to: "Buyer@Retailer.example", subject: "Your  demo\nBcc: x@evil.example", text: "Hello,\n\nHere is the link we discussed." };
  assert.strictEqual((await call(t.api, "POST", "/v1/compose", { body: ok })).statusCode, 401, "signed out");
  assert.strictEqual((await call(t.api, "POST", "/v1/compose", { token: "view@ph.example", body: ok })).statusCode, 403, "a viewer is read-only");
  assert.strictEqual((await call(t.api, "GET", "/v1/compose", { token: "ed@ph.example" })).statusCode, 405);
  for (const [bad, said] of [
    [{ ...ok, to: "" }, /who the email is to/], [{ ...ok, to: "not an address" }, /isn't an email address/], [{ ...ok, to: "a@b.example, c@d.example" }, /isn't an email address/],
    [{ ...ok, to: "a@b.example\nBcc: x@evil.example" }, /isn't an email address/], [{ ...ok, subject: "  " }, /subject/], [{ ...ok, text: " \n " }, /Write the message/], [{ ...ok, text: "x".repeat(8001) }, /at most 8000/],
  ]) {
    const r = await call(t.api, "POST", "/v1/compose", { token: "ed@ph.example", body: bad });
    assert.strictEqual(r.statusCode, 400, JSON.stringify(bad).slice(0, 80));
    assert.ok(said.test(r.body.error), r.body.error);
  }
  assert.strictEqual(t.google.calls.sent.length, 0, "nothing refused was sent");
  const r = await call(t.api, "POST", "/v1/compose", { token: "ed@ph.example", body: ok });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual([r.body.ok, r.body.to, r.body.ticketId, r.body.key], [true, "buyer@retailer.example", "thread-sent-1", "SUP-1"]);
  assert.strictEqual(t.google.calls.sent.length, 1);
  const mail = t.google.calls.sent[0].mail;
  assert.ok(mail.includes(`From: "PH Support" <${MAILBOX}>`) && mail.includes("To: buyer@retailer.example"), mail);
  assert.ok(/\r\nSubject: Your demo Bcc: x@evil\.example\r\n/.test(mail), "a new email's subject has no Re:, and a line break in it cannot add a header");
  assert.ok(!/\r\nBcc:/.test(mail) && !/In-Reply-To|Auto-Submitted/.test(mail));
  assert.strictEqual(t.google.calls.sent[0].threadId, undefined, "it starts its own thread");
  const tk = ticketOf(t, "thread-sent-1");
  assert.deepStrictEqual([tk.status, tk.inboxes, tk.customerEmail, tk.startedBy, tk.humanInvolved, tk.needsHuman, tk.triagePending, tk.messageCount, tk.inboundCount],
    ["pending", ["support"], "buyer@retailer.example", "ed@ph.example", true, false, false, 1, 0]);
  assert.deepStrictEqual([tk.lastReplyAt, tk.firstResponseAt, tk.lastInboundAt], [null, null, null], "a new email is not a reply: it is not in the Dashboard's replied today");
  const msgs = messagesOf(t, "thread-sent-1");
  const out = msgs.find((m) => m.direction === "out");
  assert.deepStrictEqual([out.sentBy, out.source, out.to, out.auto], ["ed@ph.example", "compose", ["buyer@retailer.example"], false]);
  assert.ok(out.text.endsWith("PH Support"), "the signature is added");
  assert.ok(msgs.some((m) => m.direction === "event" && /Wrote a new email/.test(m.text) && m.by === "ed@ph.example"));
});

check("compose: the answer joins the same ticket and reopens it; a high-value recipient stays high value", async () => {
  const mail = [];
  const t = make({ mail, prospects: { p1: { company: "Big Retailer", website: "https://bigretailer.example", status: "active" } } });
  await connect(t);
  const r = await call(t.api, "POST", "/v1/compose", { token: "ed@ph.example", body: { to: "cto@bigretailer.example", subject: "Following up", text: "Good to meet you." } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const id = r.body.ticketId;
  assert.strictEqual(ticketOf(t, id).highValue, true, "so its answer is never replied to automatically");
  // The sent email comes back in the next sync's listing; it is already filed, so it is not added twice.
  mail.push(gmailMessage({ id: "sent-1", threadId: id, from: MAILBOX, subject: "Following up", text: "Good to meet you.", labels: ["SENT"], date: 1760000100000 }));
  mail.push(gmailMessage({ id: "ans-1", threadId: id, from: "Cee Tio <cto@bigretailer.example>", subject: "Re: Following up", text: "Thanks, when can we talk?", date: 1760000200000 }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  const tk = ticketOf(t, id);
  assert.deepStrictEqual([tk.messageCount, tk.inboundCount, tk.status, tk.key], [2, 1, "open", r.body.key], "one sent, one received, one ticket");
  assert.ok(tk.lastInboundAt, "the customer's email starts the wait the Dashboard shows");
  assert.strictEqual(Object.keys(t.db.state.supportTickets).length, 1);
});

check("compose: not connected, a send Gmail refuses, and the hourly limit", async () => {
  const off = make();
  const body = { to: "a@b.example", subject: "Hello", text: "Hi" };
  assert.strictEqual((await call(off.api, "POST", "/v1/compose", { token: "ed@ph.example", body })).statusCode, 409, "no mailbox connected");
  const t = make();
  await connect(t);
  t.google.breakRefresh();
  const refused = await call(t.api, "POST", "/v1/compose", { token: "ed@ph.example", body });
  assert.strictEqual(refused.statusCode, 502);
  assert.ok(/The email wasn't sent/.test(refused.body.error));
  assert.strictEqual(t.db.state.supportTickets, undefined, "an email that wasn't sent is not filed");
  const u = make();
  await connect(u);
  for (let i = 0; i < 30; i++) assert.strictEqual((await call(u.api, "POST", "/v1/compose", { token: "ed@ph.example", body })).statusCode, 200);
  assert.strictEqual((await call(u.api, "POST", "/v1/compose", { token: "ed@ph.example", body })).statusCode, 429);
  assert.strictEqual((await call(u.api, "POST", "/v1/compose", { token: "admin@ph.example", body })).statusCode, 200, "the limit is each member's own");
  assert.strictEqual(u.google.calls.sent.length, 31);
});

check("a reply records when it was sent (lastReplyAt), from the console and from Gmail itself", async () => {
  const mail = [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })];
  const t = make({ mail });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.ok(!ticketOf(t, "t1").lastReplyAt, "no reply yet");
  assert.strictEqual((await call(t.api, "POST", "/v1/tickets/t1/reply", { token: "ed@ph.example", body: { text: "Here you go." } })).statusCode, 200);
  const first = ticketOf(t, "t1").lastReplyAt;
  assert.ok(first instanceof Date, "the console's reply");
  mail.push(gmailMessage({ id: "g2", threadId: "t1", from: MAILBOX, subject: "Re: How do I add a display?", text: "One more thing.", labels: ["SENT"], date: first.getTime() + 60000 }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.strictEqual(ticketOf(t, "t1").lastReplyAt.getTime(), first.getTime() + 60000, "a reply sent from Gmail");
});

// A stand-in for the Anthropic SDK: answers each call by which step it is.
function fakeModel(answers) {
  const calls = [];
  class Client {
    constructor() { this.beta = { messages: { create: async (req) => {
      const step = req.system.startsWith("You route") ? "select" : "draft";
      const n = (req.messages[0].content.match(/<article id=/g) || []).length;
      calls.push({ step, articles: n });
      return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answers(step, n)) }] };
    } } }; }
  }
  return { Client, calls };
}
const ARTS = ["a1", "a2", "a3"].map((id, i) => ({ id, title: `Article ${i + 1}`, summary: "", directAnswer: "", keywords: [], questionVariants: [], categoryName: "Digital Signage", body: `Body ${i + 1}`, url: `https://x.example/${id}` }));
const TICKET = { subject: "Screens", customerEmail: "ann@shop.example", customerName: "Ann Lee" };
const MSGS = [{ direction: "in", text: "How do I add a display?" }];

check("triage: the best article alone first; under 80% confidence it is written again from up to 3 articles together, and the better reply is kept", async () => {
  const sel = { relevant: true, question: "add a display", category: "how-to", articleIds: ["a1", "a2", "a3", "a4"], spamLikely: false };
  const low = fakeModel((step, n) => step === "select" ? sel : { summary: "s", answerable: true, reply: `from ${n}`, articleIds: ["a1", "a2", "a3"].slice(0, n), confidence: n === 1 ? 0.55 : 0.84 });
  const r1 = await runTriage({ apiKey: "k", Anthropic: low.Client, ticket: TICKET, messages: MSGS, articles: ARTS });
  assert.deepStrictEqual(low.calls.map((c) => `${c.step}:${c.articles}`), ["select:0", "draft:1", "draft:3"], "never more than 3 articles");
  assert.deepStrictEqual([r1.reply, r1.confidence, r1.confidenceSteps], ["from 3", 0.84, [{ articles: 1, confidence: 0.55 }, { articles: 3, confidence: 0.84 }]]);
  const high = fakeModel((step, n) => step === "select" ? sel : { summary: "s", answerable: true, reply: `from ${n}`, articleIds: ["a1"], confidence: 0.9 });
  const r2 = await runTriage({ apiKey: "k", Anthropic: high.Client, ticket: TICKET, messages: MSGS, articles: ARTS });
  assert.deepStrictEqual([high.calls.length, r2.reply, r2.confidenceSteps.length], [2, "from 1", 1], "a confident first answer is not padded out");
  const worse = fakeModel((step, n) => step === "select" ? sel : { summary: "s", answerable: true, reply: `from ${n}`, articleIds: ["a1"], confidence: n === 1 ? 0.7 : 0.6 });
  const r3 = await runTriage({ apiKey: "k", Anthropic: worse.Client, ticket: TICKET, messages: MSGS, articles: ARTS });
  assert.deepStrictEqual([r3.reply, r3.confidence], ["from 1", 0.7], "combining that scores lower is dropped");
  const off = fakeModel((step) => step === "select" ? { relevant: false, question: "SEO offer", category: "other", articleIds: [], spamLikely: false } : assert.fail("no draft for unrelated mail"));
  const r4 = await runTriage({ apiKey: "k", Anthropic: off.Client, ticket: TICKET, messages: MSGS, articles: ARTS });
  assert.deepStrictEqual([off.calls.length, r4.relevant, r4.reply], [1, false, ""]);
});

check("the confidence steps are kept on the ticket's draft", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })], triage: async () => ({ ...GOOD, confidence: 0.82, confidenceSteps: [{ articles: 1, confidence: 0.5 }, { articles: 3, confidence: 0.82 }] }) });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.deepStrictEqual(ticketOf(t, "t1").aiDraft.confidenceSteps, [{ articles: 1, confidence: 0.5 }, { articles: 3, confidence: 0.82 }]);
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

check("inboxes: a ticket is filed under each alias its emails were written to; a later Cc adds one; no alias means Support", async () => {
  const to = (id, headers, extra = {}) => gmailMessage({ id, threadId: `t-${id}`, date: 1759990000000, headers, ...extra });
  const t = make({ mail: [
    to("sup", { To: "support@ph.example" }),
    to("hel", { To: "Hello <hello@ph.example>" }),
    to("aid", { To: "someone@shop.example", Cc: "aidan@ph.example" }),
    to("both", { To: "support@ph.example", Cc: "aidan@ph.example" }),
    to("none", { To: "someone@shop.example" }),
  ] });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  const inboxes = (id) => ticketOf(t, `t-${id}`).inboxes;
  assert.deepStrictEqual([inboxes("sup"), inboxes("hel"), inboxes("aid"), inboxes("both"), inboxes("none")], [["support"], ["hello"], ["aidan"], ["support", "aidan"], ["support"]]);
  // The customer writes again on the Hello thread, now copying aidan@: it is in both.
  t.mail.push(gmailMessage({ id: "hel2", threadId: "t-hel", date: 1760000500000, headers: { To: "hello@ph.example", Cc: "aidan@ph.example" } }));
  // And again on the Aidan thread with no alias at all: it stays where it was.
  t.mail.push(gmailMessage({ id: "aid2", threadId: "t-aid", date: 1760000600000, headers: { To: "someone@shop.example" } }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.deepStrictEqual([inboxes("hel"), inboxes("aid")], [["hello", "aidan"], ["aidan"]]);
});

check("a ticket filed before the inboxes existed is Support's, and a later alias is added to that", async () => {
  const t = make({ mail: [gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000 })] });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  delete t.db.state.supportTickets.t1.inboxes;
  t.mail.push(gmailMessage({ id: "m2", threadId: "t1", date: 1760000500000, headers: { To: "someone@shop.example", Cc: "aidan@ph.example" } }));
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.deepStrictEqual(ticketOf(t, "t1").inboxes, ["support", "aidan"]);
});

check("with sending switched on, mail to hello@ or aidan@ alone is drafted but never sent by itself", async () => {
  const t = make({ mail: [
    gmailMessage({ id: "m1", threadId: "t1", date: 1759990000000, headers: { To: "hello@ph.example" } }),
    gmailMessage({ id: "m2", threadId: "t2", date: 1759990001000, headers: { To: "support@ph.example", Cc: "aidan@ph.example" } }),
  ], settings: { autoReply: true, autoReplyThreshold: 0.8 } });
  await connect(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.deepStrictEqual(t.google.calls.sent.map((x) => x.threadId), ["t2"], "only the one written to support@");
  const hello = ticketOf(t, "t1");
  assert.deepStrictEqual([hello.status, hello.needsHuman, Boolean(hello.aiDraft)], ["open", false, true]);
  assert.ok(/support address/.test(hello.triageReason), hello.triageReason);
});

// ── Aidan, the agent mailbox (functions/aidan.js, EeAljfWIiY8SOPsKXlXD) ──
// Fixture identities only: the real allowed senders are configuration.
const OWNER = "owner@example.com";
const AIDAN = "aidan@ph.example";
const VERIFIED = "mx.google.com; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=owner@example.com; dmarc=pass (p=NONE) header.from=example.com";
const SKILLS = {
  s1: { slug: "aws-onboarding-pack", name: "AWS onboarding pack", summary: "The onboarding pack for a new client.", version: "1", files: [{ path: "SKILL.md", content: "Write the onboarding pack: overview, steps, contacts." }] },
  s2: { slug: "poc-summary", name: "POC summary", summary: "A one-page proof of concept summary.", version: "1", files: [{ path: "SKILL.md", content: "Summarise the POC." }] },
};
const DOC = { title: "AWS onboarding pack: Kestrel", fileName: "aws-onboarding-pack-kestrel.md", documentMd: "# AWS onboarding pack\n\nFor Kestrel.", replyText: "Here is the AWS onboarding pack for Kestrel, attached." };
function aidanMail({ id, threadId = `t-${id}`, from = `Owner Person <${OWNER}>`, to = AIDAN, cc = "", text, auth = VERIFIED, date = 1759990000000, parts = null }) {
  const m = gmailMessage({ id, threadId, from, subject: "Kestrel onboarding", text, date, headers: { To: to, ...(cc ? { Cc: cc } : {}), ...(auth ? { "Authentication-Results": auth } : {}) } });
  if (parts) m.payload = { mimeType: "multipart/mixed", headers: m.payload.headers, parts: [{ mimeType: "text/plain", body: m.payload.body }, ...parts] };
  return m;
}
function makeAidan(mail, { write } = {}) {
  const seen = { write: [], triaged: [] };
  const stored = [];
  const t = make({
    mail,
    triage: async (input) => { seen.triaged.push(input.ticket.subject); return GOOD; },
    aidan: {
      // The model's choice when no skill is named: none fits.
      select: async (input) => { seen.select = (seen.select || []).concat([input.instruction]); return { skillId: "", client: "", reason: "nothing in the library fits" }; },
      write: async (input) => { seen.write.push(input); return write ? write(input) : DOC; },
    },
    bucket: () => ({ file: (path) => ({ save: async (buf, opts) => { stored.push({ path, size: buf.length, type: opts.contentType }); } }) }),
  });
  t.db.state.skills = JSON.parse(JSON.stringify(SKILLS));
  return Object.assign(t, { seen, stored });
}
async function connectAidan(t, config = { allowedSenders: [OWNER], enabled: true }) {
  await connect(t);
  t.db.state.supportSecrets.aidan = config;
}
const cron = (t) => call(t.api, "POST", "/v1/cron", { board: BOARD });

check("Aidan: an allowed sender's tagged request runs the skill and replies to everyone on the email with the document attached", async () => {
  const t = makeAidan([aidanMail({ id: "a1", cc: "Client <client@shop.example>, colleague@shop.example", text: "Hi all,\n\n@Aidan, send the AWS onboarding pack for client Kestrel.\n\nThanks" })]);
  await connectAidan(t);
  const r = await cron(t);
  assert.deepStrictEqual([r.statusCode, r.body.aidanRuns], [200, 1]);
  assert.deepStrictEqual(t.seen.triaged, [], "the instruction is not drafted a Help Centre reply");
  const w = t.seen.write[0];
  assert.strictEqual(w.skill.id, "s1", "the skill named in the instruction");
  assert.ok(/Write the onboarding pack/.test(w.system), "the skill's own instructions are what the document is written to");
  assert.ok(JSON.stringify(w.content).includes("send the AWS onboarding pack for client Kestrel"), "the email is the input");
  assert.strictEqual(t.google.calls.sent.length, 1);
  const sent = t.google.calls.sent[0];
  assert.strictEqual(sent.threadId, "t-a1", "on the original thread");
  assert.ok(sent.mail.includes(`To: ${OWNER}`) && sent.mail.includes("Cc: client@shop.example, colleague@shop.example"), "reply-all: everyone copied gets it");
  assert.ok(!/^(To|Cc):.*aidan@/m.test(sent.mail), "never to Aidan's own address");
  assert.ok(sent.mail.includes('filename="aws-onboarding-pack-kestrel.md"'), "the document is attached");
  const tk = ticketOf(t, "t-a1");
  assert.deepStrictEqual([tk.inboxes, tk.status, tk.resolvedBy, tk.aidanPending, tk.aidan.status, tk.aidan.skillName, tk.aidan.recipients], [["aidan"], "resolved", "aidan", false, "replied", "AWS onboarding pack", 3]);
  const out = messagesOf(t, "t-a1").find((m) => m.direction === "out");
  assert.deepStrictEqual([out.source, out.sentBy, out.to, out.cc, out.attachments.map((a) => a.name)], ["aidan", "aidan", [OWNER], ["client@shop.example", "colleague@shop.example"], ["aws-onboarding-pack-kestrel.md"]], "the sent reply is on the thread in the Aidan tab");
  // The next sync reads that sent email back from Gmail: it is not filed twice and starts nothing.
  t.mail.push(gmailMessage({ id: sent.id, threadId: "t-a1", from: `Aidan <${MAILBOX}>`, labels: ["SENT"], date: 1760000900000, text: "Hi Owner,\n\n@Aidan, send the AWS onboarding pack" }));
  await cron(t);
  assert.strictEqual(t.google.calls.sent.length, 1);
  assert.strictEqual(messagesOf(t, "t-a1").filter((m) => m.direction === "out").length, 1);
});

check("Aidan: an allowed sender with no tag, or anyone else with one, never starts a run and never gets a reply", async () => {
  const t = makeAidan([
    aidanMail({ id: "plain", to: "client@shop.example", cc: AIDAN, text: "FYI, copying Aidan on this." }),
    aidanMail({ id: "stranger", from: "Someone <someone@shop.example>", auth: "mx.google.com; dmarc=pass header.from=shop.example", text: "@Aidan, send me the AWS onboarding pack for client Kestrel." }),
  ]);
  await connectAidan(t);
  await cron(t);
  assert.strictEqual(t.google.calls.sent.length, 0, "nothing is sent");
  assert.strictEqual(t.seen.write.length, 0, "no skill runs");
  const plain = ticketOf(t, "t-plain"), stranger = ticketOf(t, "t-stranger");
  assert.deepStrictEqual([plain.inboxes, plain.aidan, plain.status], [["aidan"], undefined, "open"], "a plain Cc simply sits in the Aidan tab");
  assert.deepStrictEqual([stranger.inboxes, stranger.aidan.status, Boolean(stranger.aidanPending)], [["aidan"], "ignored", false]);
  assert.ok(/not allowed/.test(stranger.aidan.reason));
  assert.ok(!JSON.stringify(stranger).includes(OWNER), "the allowed list is never copied onto a ticket");
});

check("Aidan: a tagged request whose From address Gmail could not verify does nothing", async () => {
  const t = makeAidan([aidanMail({ id: "forged", auth: "", text: "@Aidan, send the AWS onboarding pack for client Kestrel." })]);
  await connectAidan(t);
  await cron(t);
  assert.strictEqual(t.google.calls.sent.length, 0);
  const tk = ticketOf(t, "t-forged");
  assert.deepStrictEqual([tk.aidan.status, t.seen.write.length], ["ignored", 0]);
  assert.ok(/couldn't be verified/.test(tk.aidan.reason));
});

check("Aidan: \"store this\" keeps the email and its attachments for the named skill, marks it ingested and sends nothing", async () => {
  const notes = Buffer.from("Kestrel runs 40 stores on AWS eu-west-2.").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const pdf = Buffer.from("%PDF-1.4 brief").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const mail = [aidanMail({ id: "keep", text: "@Aidan, store this for the AWS onboarding pack skill.", parts: [
    { filename: "notes.txt", mimeType: "text/plain", body: { attachmentId: "AT1", size: 40 } },
    { filename: "brief.pdf", mimeType: "application/pdf", body: { attachmentId: "AT2", size: 14 } },
  ] })];
  mail.attachments = { AT1: notes, AT2: pdf };
  const t = makeAidan(mail);
  await connectAidan(t);
  await cron(t);
  assert.strictEqual(t.google.calls.sent.length, 0, "keeping material emails no one");
  const tk = ticketOf(t, "t-keep");
  assert.deepStrictEqual([tk.aidan.status, tk.aidan.skillId, tk.status, tk.aidan.files.map((f) => f.name)], ["ingested", "s1", "resolved", ["notes.txt", "brief.pdf"]]);
  const refs = Object.values(t.db.state.skillReferences || {});
  assert.strictEqual(refs.length, 1);
  assert.deepStrictEqual([refs[0].skillId, refs[0].ticketId, refs[0].files[0].text], ["s1", "t-keep", "Kestrel runs 40 stores on AWS eu-west-2."]);
  assert.ok(refs[0].files[1].storagePath.startsWith("skill-references/s1/"), "a PDF goes to Storage");
  assert.deepStrictEqual(t.stored.map((x) => x.type), ["application/pdf"]);
  // The next request with that skill reads the kept material.
  t.mail.push(aidanMail({ id: "use", threadId: "t-use", text: "@Aidan, send the AWS onboarding pack for client Kestrel.", date: 1760000500000 }));
  await cron(t);
  assert.ok(/Kestrel runs 40 stores/.test(t.seen.write[0].system), "kept reference material is used by later runs of the skill");
});

check("Aidan: no matching skill goes to a person; only the scheduled sync runs Aidan; one run per sync", async () => {
  const t = makeAidan([
    aidanMail({ id: "vague", text: "@Aidan, do the usual thing for them please." }),
    aidanMail({ id: "two", threadId: "t-two", text: "@Aidan, write the POC summary for Kestrel.", date: 1759990001000 }),
  ]);
  await connectAidan(t);
  await call(t.api, "POST", "/v1/sync", { token: "ed@ph.example" });
  assert.deepStrictEqual([ticketOf(t, "t-vague").aidan.status, ticketOf(t, "t-two").aidan.status], ["queued", "queued"], "Sync now files and queues, but does not run");
  assert.strictEqual(t.google.calls.sent.length, 0);
  const r1 = await cron(t);
  assert.strictEqual(r1.body.aidanRuns, 1);
  const r2 = await cron(t);
  assert.strictEqual(r2.body.aidanRuns, 1);
  const vague = ticketOf(t, "t-vague");
  assert.deepStrictEqual([vague.aidan.status, vague.needsHuman], ["needs-person", true], "no skill matched: a person takes it, nothing is sent");
  assert.deepStrictEqual(t.seen.select, ["do the usual thing for them please."], "the model was asked only when no skill was named");
  assert.strictEqual(ticketOf(t, "t-two").aidan.status, "replied");
  assert.strictEqual(t.google.calls.sent.length, 1);
});

check("Aidan's allowed senders: an admin sets them, they are never read back in full, and switching Aidan off stops runs", async () => {
  const t = makeAidan([aidanMail({ id: "a1", text: "@Aidan, send the AWS onboarding pack for client Kestrel." })]);
  await connect(t);
  assert.strictEqual((await call(t.api, "POST", "/v1/aidan", { token: "ed@ph.example", body: { allowedSenders: OWNER } })).statusCode, 403, "an editor can't");
  assert.strictEqual((await call(t.api, "POST", "/v1/aidan", { token: "admin@ph.example", body: { allowedSenders: "not an address" } })).statusCode, 400);
  const saved = await call(t.api, "POST", "/v1/aidan", { token: "admin@ph.example", body: { allowedSenders: `${OWNER}, owner.alias@example.com`, enabled: true } });
  assert.deepStrictEqual([saved.statusCode, saved.body.aidan.senderCount, saved.body.aidan.sendersMasked], [200, 2, ["o***@example.com", "o***@example.com"]]);
  assert.ok(!JSON.stringify(saved.body).includes(OWNER), "not echoed back");
  const viewer = (await call(t.api, "GET", "/v1/status", { token: "view@ph.example" })).body.aidan;
  assert.deepStrictEqual([viewer.enabled, viewer.senderCount, "sendersMasked" in viewer], [true, 2, false], "members see a count only");
  const admin = (await call(t.api, "GET", "/v1/status", { token: "admin@ph.example" })).body;
  assert.ok(!JSON.stringify(admin).includes(OWNER), "an admin sees them masked");
  // Saving without a list keeps it; switching off stops runs.
  await call(t.api, "POST", "/v1/aidan", { token: "admin@ph.example", body: { enabled: false } });
  assert.deepStrictEqual(t.db.state.supportSecrets.aidan.allowedSenders, [OWNER, "owner.alias@example.com"]);
  await cron(t);
  assert.deepStrictEqual([ticketOf(t, "t-a1").aidan.status, t.google.calls.sent.length], ["ignored", 0]);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\nsupport-mail: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
