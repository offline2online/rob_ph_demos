"use strict";
// ── Support Inbox (Support › Support Inbox, Settings › Support inbox) ─────
// Connects the console to the support mailbox (a Google Workspace Gmail
// account) and turns every thread in it into a ticket:
//
//   • Connection: an admin saves a Google OAuth client and signs in as the
//     mailbox. The client secret and the refresh token are encrypted exactly
//     like the Media Studio keys (AES-256-GCM under MEDIA_KEYS_ENC_KEY) and
//     kept in supportSecrets/gmail, which firestore.rules closes to every
//     client. Scope: gmail.modify (read, label, send; no permanent delete).
//   • Sync: every five minutes (and on "Sync now") new mail is read and filed
//     as supportTickets/{threadId} + messages. Members read tickets straight
//     from Firestore; every write goes through this function.
//   • Triage: each new customer message is drafted an answer from the
//     published help-centre articles (Claude). support-core.js decides
//     whether it is sent by itself, waits for approval, or needs a person.
//     Machine-sent mail is never answered, and a thread is answered
//     automatically once at most, so two auto-responders cannot loop.
//   • High-value senders (Prospects (TAM), Leads, or a domain in Settings) are
//     never answered automatically: a flagged Staff Kanban ticket is raised
//     for the person named in Settings.
//
// Routes (Hosting rewrite /supportMail/** → this function):
//   GET  /v1/status                    member  connection + settings (no secrets)
//   POST /v1/oauth/client              admin   {clientId, clientSecret}
//   POST /v1/oauth/start               admin   → {url} to Google's consent page
//   GET  /v1/oauth/callback            Google redirects here (state-checked)
//   POST /v1/disconnect                admin
//   POST /v1/settings                  admin
//   POST /v1/sync                      editor  read new mail now
//   POST /v1/cron                      board key  the same, for the five-minute workflow
//   POST /v1/tickets/{id}/reply        editor  {text, resolve, draft}
//   POST /v1/tickets/{id}/draft        editor  write a fresh AI draft
//   POST /v1/tickets/{id}/status       editor  {status}
//   POST /v1/tickets/{id}/note         editor  {text}
//   POST /v1/tickets/{id}/assign       editor  {assignee}
//   POST /v1/tickets/{id}/escalate     editor  raise a Staff Kanban ticket
//
// Pure module: index.js injects Firestore, ID-token verification, the secrets
// and the Staff Kanban writer, so test/support-mail.test.js runs it with no
// Firebase, no network and no credentials.

const crypto = require("crypto");
const core = require("./support-core");
const { encrypt, decrypt, keyBytes } = require("./media-keys");

const TICKETS = "supportTickets";
const SETTINGS = "supportSettings";
const SECRETS = "supportSecrets";
const COUNTERS = "supportCounters";
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_TTL_MS = 10 * 60 * 1000;
const OVERLAP_MS = 15 * 60 * 1000;   // each sync re-reads this much, deduped by message id
const LIST_PAGES = 5;                // × 100 messages per sync
const TRIAGE_PER_RUN = 8;            // model calls per scheduled sync; the rest wait for the next one
// Calls through Hosting (/supportMail/**) are cut off at 60 seconds, so a sync
// someone starts from the page drafts fewer; the scheduled one calls the
// function's own address and has the full nine minutes.
const TRIAGE_PER_PAGE_SYNC = 2;
const CACHE_MS = 5 * 60 * 1000;
const DRAFT_MODEL = "claude-opus-5-5";
const DRAFT_TIMEOUT_MS = 40000;

// Asks the model for a triage of one thread. Returns the raw object, or throws.
async function claudeTriage({ apiKey, workspaceId, Anthropic, ticket, messages, candidates }) {
  const Client = Anthropic || require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
  const headers = require("./lead-enrich").workspaceHeaders(workspaceId);
  const client = new Client({ apiKey, timeout: DRAFT_TIMEOUT_MS, maxRetries: 1, ...(headers ? { defaultHeaders: headers } : {}) });
  const thread = messages.filter((m) => m.direction === "in" || m.direction === "out").slice(-8).map((m) =>
    `[${m.direction === "in" ? "customer" : "support"}]\n${core.clip(core.stripQuoted(m.text), 6000)}`).join("\n\n---\n\n");
  const articles = candidates.map((a) =>
    `<article id="${a.id}" url="${a.url}">\nTitle: ${a.title}\n${a.directAnswer ? `Short answer: ${a.directAnswer}\n` : ""}${a.summary ? `Summary: ${a.summary}\n` : ""}${core.clip(a.body, 5000)}\n</article>`).join("\n\n");
  const res = await client.beta.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 4000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: core.TRIAGE_SCHEMA } },
    fallbacks: "default",
    betas: ["server-side-fallback-2026-07-01"],
    system: core.TRIAGE_SYSTEM,
    messages: [{ role: "user", content:
      `Customer: ${ticket.customerName || "(name unknown)"} <${ticket.customerEmail}>\nSubject: ${ticket.subject}\n\n<email_thread>\n${thread}\n</email_thread>\n\n<help_articles>\n${articles || "(no article matched)"}\n</help_articles>` }],
  });
  if (!res || res.stop_reason === "refusal") throw new Error("the drafting model declined");
  const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

function createSupportMail({
  db, verifyIdToken, resolveConsoleUser, encKey, anthropicKey = () => "", anthropicWorkspace = () => "", Anthropic = null,
  fetch: fetchImpl = globalThis.fetch, logger = console, now = () => new Date(), baseUrl = "https://backlog-tracker-e4ed2.web.app",
  createKanbanTask = null, commentKanbanTask = null, triage: triageImpl = null, freeDomains = [], boardKey = () => "",
}) {
  const cronMisses = new Map(); // ip -> {n, first}: brute-force brake on the cron route
  const redirectUri = `${baseUrl}/supportMail/v1/oauth/callback`;
  const tickets = () => db.collection(TICKETS);
  const settingsRef = () => db.collection(SETTINGS).doc("main");
  const secretsRef = () => db.collection(SECRETS).doc("gmail");
  const send = (res, status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
  const iso = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : v || null);
  const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) || 0 : 0);
  const data = (snap) => (snap.exists ? snap.data() || {} : null);

  // ── Who is calling ──
  async function requireRole(req, role) {
    const idToken = String(req.get("x-firebase-id-token") || "");
    if (!idToken) return { ok: false, status: 401, error: "sign in first" };
    let decoded;
    try { decoded = await verifyIdToken(idToken); } catch { return { ok: false, status: 401, error: "invalid sign-in" }; }
    const user = await resolveConsoleUser(decoded.email);
    if (!user) return { ok: false, status: 403, error: "not on the console user list" };
    if ((ROLE_RANK[user.role] || 0) < ROLE_RANK[role]) return { ok: false, status: 403, error: role === "admin" ? "only an admin can change the support mailbox" : "your role is read-only" };
    return { ok: true, user: { email: String(user.email || decoded.email || "").toLowerCase(), role: user.role } };
  }

  // ── Settings and secrets ──
  async function readSettings() {
    const d = data(await settingsRef().get()) || {};
    return Object.assign({}, d, core.normaliseSettings(d));
  }
  async function status() {
    const [s, sec] = await Promise.all([readSettings(), secretsRef().get().then(data)]);
    const aiKey = String(anthropicKey() || "");
    return {
      encryptionReady: Boolean(keyBytes(encKey())),
      aiReady: Boolean(aiKey && aiKey !== "unset"),
      clientSet: Boolean(sec && sec.client), clientId: (sec && sec.clientId) || "",
      connected: Boolean(sec && sec.refresh && s.connectedEmail),
      connectedEmail: s.connectedEmail || "", connectedBy: s.connectedBy || "", connectedAt: iso(s.connectedAt),
      connectionError: s.connectionError || "",
      lastSyncAt: iso(s.lastSyncAt), lastSyncOk: s.lastSyncOk !== false, lastSyncError: s.lastSyncError || "", lastSyncNew: s.lastSyncNew || 0,
      redirectUri,
      settings: core.normaliseSettings(s),
    };
  }

  // ── Google ──
  // { token, exp, rev }. `rev` is the stored sign-in the token came from: another
  // instance may have connected a different mailbox (or disconnected) since.
  let tokenCache = null;
  let revCheck = { at: 0, rev: "" };
  const revOf = (sec) => (sec && sec.refresh && sec.refresh.iv) || "";
  async function currentRev() {
    if (now().getTime() - revCheck.at > 30000) revCheck = { at: now().getTime(), rev: revOf(data(await secretsRef().get())) };
    return revCheck.rev;
  }
  async function tokenRequest(params) {
    const r = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(body.error_description || body.error || `Google answered HTTP ${r.status}`);
      err.code = body.error || `http-${r.status}`;
      throw err;
    }
    return body;
  }
  async function clientCreds() {
    const key = keyBytes(encKey());
    if (!key) throw new Error("Encryption isn't set up yet (MEDIA_KEYS_ENC_KEY).");
    const sec = data(await secretsRef().get());
    if (!sec || !sec.client) throw new Error("No Google OAuth client is saved yet.");
    return { key, sec, clientId: sec.clientId, clientSecret: decrypt(key, "support-oauth-client", sec.client) };
  }
  async function accessToken() {
    if (tokenCache && tokenCache.exp > now().getTime() + 60000 && tokenCache.rev === await currentRev()) return tokenCache.token;
    const { key, sec, clientId, clientSecret } = await clientCreds();
    if (!sec.refresh) throw new Error("The support mailbox isn't connected.");
    let body;
    try {
      body = await tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: decrypt(key, "support-refresh-token", sec.refresh), grant_type: "refresh_token" });
    } catch (err) {
      if (err.code === "invalid_grant") {
        await settingsRef().set({ connectionError: "Google no longer accepts the saved sign-in. Connect the mailbox again in Settings." }, { merge: true });
      }
      throw err;
    }
    tokenCache = { token: body.access_token, exp: now().getTime() + (Number(body.expires_in) || 3000) * 1000, rev: revOf(sec) };
    revCheck = { at: now().getTime(), rev: tokenCache.rev };
    return tokenCache.token;
  }
  async function gmail(path, { method = "GET", body } = {}) {
    const token = await accessToken();
    const r = await fetchImpl(`${GMAIL}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) tokenCache = null;
      const err = new Error((out.error && out.error.message) || `Gmail answered HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return out;
  }

  // ── Reference data, read at most every five minutes ──
  const cache = new Map();
  async function cached(name, load) {
    const hit = cache.get(name);
    if (hit && now().getTime() - hit.at < CACHE_MS) return hit.value;
    const value = await load();
    cache.set(name, { at: now().getTime(), value });
    return value;
  }
  const rowsOf = async (name) => { const snap = await db.collection(name).get(); const out = []; snap.forEach((d) => out.push(Object.assign({ id: d.id }, d.data() || {}))); return out; };
  const articles = () => cached("articles", async () => (await rowsOf("faqArticles")).filter((a) => a.status === "published").map((a) => ({
    id: a.id, title: a.title || "", summary: a.summary || "", directAnswer: a.directAnswer || "", keywords: a.keywords || [], questionVariants: a.questionVariants || [],
    bodyMd: a.bodyMd || "", body: core.htmlToText(a.bodyMd || ""), url: `https://personalisationhub.com/support-centre/article.html?id=${encodeURIComponent(a.id)}`,
  })));
  const accounts = () => cached("accounts", async () => {
    const [prospects, leads] = await Promise.all([rowsOf("prospects"), rowsOf("leads")]);
    return { prospects, leads: leads.filter((l) => !l.archived && !l.test) };
  });

  // ── Tickets ──
  async function nextNumber() {
    const ref = db.collection(COUNTERS).doc("main");
    return db.runTransaction(async (tx) => {
      const c = await tx.get(ref);
      const n = c.exists && typeof c.data().nextNumber === "number" ? c.data().nextNumber : 1;
      tx.set(ref, { nextNumber: n + 1 });
      return n;
    });
  }
  const eventId = () => `ev-${now().getTime()}-${crypto.randomBytes(4).toString("hex")}`;
  // A line in the ticket's timeline: who did what (never customer text).
  function logEvent(ticketId, by, text) {
    return tickets().doc(ticketId).collection("messages").doc(eventId()).set({ direction: "event", text: core.clip(text, 500), by: by || "system", at: now() });
  }

  // File one parsed Gmail message. Returns "new-ticket", "added" or "skipped".
  async function ingest(m, settings) {
    if (!m.gmailId || !m.threadId) return "skipped";
    const ref = tickets().doc(m.threadId);
    const cur = data(await ref.get());
    const at = m.at || now();
    const messageDoc = {
      direction: m.direction, from: m.from, fromName: m.fromName, to: m.to, cc: m.cc, subject: m.subject, text: m.text, snippet: m.snippet,
      messageId: m.messageId, references: m.references, attachments: m.attachments, at, gmailId: m.gmailId, automated: m.automated || "",
    };
    if (!cur) {
      if (m.direction === "out") return "skipped"; // mail the mailbox started is not a ticket
      const acct = await accounts();
      const customerEmail = m.replyTo || m.from;
      const account = m.automated ? null : core.matchAccount(m.from, { prospects: acct.prospects, leads: acct.leads, vipDomains: settings.vipDomains, freeDomains });
      const number = await nextNumber();
      await ref.set({
        key: core.ticketKey(number), number, threadId: m.threadId, subject: m.subject,
        customerEmail, fromEmail: m.from, customerName: m.fromName || "", status: "open", needsHuman: false, triagePending: true,
        automated: m.automated || "", highValue: Boolean(account), account: account || null,
        category: m.automated ? "automated" : "", summary: "", triageReason: "",
        createdAt: at, updatedAt: now(), lastMessageAt: at, lastInboundAt: at, snippet: m.snippet,
        messageCount: 1, inboundCount: 1, humanInvolved: false, autoRepliesSent: 0, reopenCount: 0,
        firstResponseAt: null, resolvedAt: null, resolvedBy: "", assignee: "", kanbanKey: "", aiDraft: null,
      });
      await ref.collection("messages").doc(m.gmailId).set(messageDoc);
      return "new-ticket";
    }
    const patch = { updatedAt: now(), messageCount: (cur.messageCount || 0) + 1 };
    if (ms(at) >= ms(cur.lastMessageAt)) { patch.lastMessageAt = at; patch.snippet = m.snippet; }
    if (m.direction === "in") {
      patch.inboundCount = (cur.inboundCount || 0) + 1;
      patch.lastInboundAt = at;
      if (cur.status !== "spam") {
        // A customer wrote again: back to the open queue, whatever it was.
        if (cur.status === "resolved") { patch.reopenCount = (cur.reopenCount || 0) + 1; patch.resolvedAt = null; patch.resolvedBy = ""; }
        patch.status = "open";
        patch.triagePending = true;
        patch.aiDraft = null;
      }
    } else {
      // Sent from Gmail itself, not from the console: a person answered there.
      patch.humanInvolved = true;
      patch.needsHuman = false;
      patch.triagePending = false;
      patch.aiDraft = null;
      if (!cur.firstResponseAt) patch.firstResponseAt = at;
      if (cur.status === "open") patch.status = "pending";
      messageDoc.sentBy = "gmail";
    }
    await ref.set(patch, { merge: true });
    await ref.collection("messages").doc(m.gmailId).set(messageDoc);
    return "added";
  }

  async function threadMessages(ticketId) {
    const snap = await tickets().doc(ticketId).collection("messages").get();
    const out = [];
    snap.forEach((d) => out.push(Object.assign({ id: d.id }, d.data() || {})));
    return out.sort((a, b) => ms(a.at) - ms(b.at));
  }

  // Send a reply on the ticket's Gmail thread and file it. Returns the Gmail id.
  async function sendReply({ ticketId, ticket, text, auto, by, source, settings, extra = {} }) {
    const all = await threadMessages(ticketId);
    const lastIn = [...all].reverse().find((m) => m.direction === "in");
    const full = core.withSignature(text, settings.signature);
    const raw = core.buildReplyRaw({
      fromName: settings.fromName, fromEmail: settings.connectedEmail, to: ticket.customerEmail, subject: ticket.subject, text: full,
      inReplyTo: lastIn && lastIn.messageId, references: lastIn && lastIn.references, auto,
    });
    const sent = await gmail("messages/send", { method: "POST", body: { raw, threadId: ticket.threadId || ticketId } });
    const id = String(sent.id || eventId());
    await tickets().doc(ticketId).collection("messages").doc(id).set(Object.assign({
      direction: "out", from: settings.connectedEmail, fromName: settings.fromName, to: [ticket.customerEmail], cc: [], subject: core.replySubject(ticket.subject),
      text: full, snippet: core.clip(text.replace(/\s+/g, " "), 240), at: now(), gmailId: id, auto: Boolean(auto), sentBy: by, source: source || "manual",
    }, extra));
    return id;
  }

  // Raise the Staff Kanban ticket for a high-value sender (once per ticket).
  async function escalate(ticketId, ticket, settings, by) {
    if (ticket.kanbanKey) return { ok: true, key: ticket.kanbanKey, already: true };
    if (!createKanbanTask) return { ok: false, error: "Staff Kanban isn't available to the support inbox." };
    const assignee = settings.escalationAssignee || settings.connectedBy || "";
    const actor = by && by !== "system" ? by : assignee;
    if (!actor) return { ok: false, error: "No one is set to escalate to (Settings › Support inbox)." };
    const who = ticket.account && ticket.account.name ? `${ticket.account.name} (${ticket.account.reason})` : ticket.customerEmail;
    const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    try {
      const key = await createKanbanTask({
        title: core.clip(`Support ${ticket.key}: ${ticket.subject}`, 200),
        description: `<p><strong>${ticket.highValue ? "High-value support ticket" : "Support ticket"}</strong> from ${esc(who)}.</p>`
          + `<p>${esc(ticket.customerName || "")} &lt;${esc(ticket.customerEmail)}&gt;</p>`
          + (ticket.summary ? `<p>${esc(ticket.summary)}</p>` : `<p>${esc(ticket.snippet)}</p>`)
          + `<p><a href="${baseUrl}/#support/ticket/${encodeURIComponent(ticketId)}">Open ${esc(ticket.key)} in the Support Inbox</a> and reply from there.</p>`,
        assignee, priority: "highest", flagged: true, labels: ["support", ...(ticket.highValue ? ["high-value"] : [])],
      }, actor);
      await tickets().doc(ticketId).set({ kanbanKey: key, assignee: ticket.assignee || assignee, updatedAt: now() }, { merge: true });
      await logEvent(ticketId, by, `Raised Staff Kanban ticket ${key} for ${assignee || actor}.`);
      return { ok: true, key };
    } catch (err) {
      logger.error("support: Staff Kanban escalation failed", { ticketId, error: String(err && err.message ? err.message : err) });
      await tickets().doc(ticketId).set({ escalationError: core.clip(String(err && err.message ? err.message : err), 300) }, { merge: true });
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  // Draft, decide, and (when allowed) answer one ticket.
  async function triageTicket(ticketId, { by = "system", forceDraft = false } = {}) {
    const ref = tickets().doc(ticketId);
    const ticket = data(await ref.get());
    if (!ticket) return { ok: false, error: "no such ticket" };
    if (ticket.status === "spam" && !forceDraft) { await ref.set({ triagePending: false }, { merge: true }); return { ok: true, action: "none" }; }
    const settings = await readSettings();
    const messages = await threadMessages(ticketId);
    let triage = null, aiError = "", picked = [];
    if (!ticket.automated) {
      const key = String(anthropicKey() || "");
      if (!triageImpl && (!key || key === "unset")) aiError = "No drafting model is configured (ANTHROPIC_API_KEY).";
      else {
        const lastIn = [...messages].reverse().find((m) => m.direction === "in");
        picked = core.rankArticles(await articles(), `${ticket.subject}\n${core.stripQuoted(lastIn ? lastIn.text : "")}`);
        try {
          const raw = await (triageImpl || claudeTriage)({ apiKey: key, workspaceId: anthropicWorkspace(), Anthropic, ticket, messages, candidates: picked });
          triage = core.cleanTriage(raw, picked.map((a) => a.id));
        } catch (err) {
          aiError = `The draft couldn't be written: ${core.clip(String(err && err.message ? err.message : err), 200)}`;
          logger.warn("support: triage failed", { ticketId, error: aiError });
        }
      }
    }
    const decision = core.decideAction({ triage, settings, highValue: ticket.highValue, automated: ticket.automated, autoRepliesSent: ticket.autoRepliesSent || 0, humanInvolved: ticket.humanInvolved,
      replyToDiffers: Boolean(ticket.fromEmail && ticket.fromEmail !== ticket.customerEmail) });
    const cited = triage ? picked.filter((a) => triage.articleIds.includes(a.id)).map((a) => ({ id: a.id, title: a.title, url: a.url })) : [];
    const patch = {
      triagePending: false, updatedAt: now(), needsHuman: decision.needsHuman, triageReason: aiError || decision.reason,
      category: triage ? triage.category : ticket.category || "", summary: triage ? triage.summary : ticket.summary || "",
      spamLikely: Boolean(triage && triage.spamLikely),
      aiDraft: triage && triage.reply ? { text: triage.reply, confidence: triage.confidence, answerable: triage.answerable, articles: cited, at: now() } : null,
    };
    if (decision.action === "send") {
      try {
        await sendReply({ ticketId, ticket, text: triage.reply, auto: true, by: "ai", source: "ai-auto", settings, extra: { confidence: triage.confidence, articles: cited } });
        Object.assign(patch, {
          aiDraft: null, status: "resolved", resolvedBy: "ai", resolvedAt: now(), autoRepliesSent: (ticket.autoRepliesSent || 0) + 1,
          firstResponseAt: ticket.firstResponseAt || now(), lastMessageAt: now(), messageCount: (ticket.messageCount || 0) + 1,
        });
      } catch (err) {
        // Not sent: a person takes it, with the draft still there to use.
        patch.needsHuman = true;
        patch.triageReason = `The automatic reply couldn't be sent: ${core.clip(String(err && err.message ? err.message : err), 200)}`;
        logger.error("support: automatic reply failed", { ticketId, error: patch.triageReason });
      }
    }
    await ref.set(patch, { merge: true });
    if (patch.status === "resolved") await logEvent(ticketId, "ai", `Answered automatically from the help centre (${Math.round(triage.confidence * 100)}% confidence) and resolved.`);
    if (decision.escalate) await escalate(ticketId, Object.assign({}, ticket, patch), settings, by);
    return { ok: true, action: patch.status === "resolved" ? "send" : decision.action === "send" ? "human" : decision.action, reason: patch.triageReason };
  }

  // ── Sync ──
  let syncing = null;
  async function runSync(maxTriage) {
    const started = now();
    const settings = await readSettings();
    if (!settings.connectedEmail) return { ok: false, error: "The support mailbox isn't connected." };
    const result = { ok: true, listed: 0, newMessages: 0, newTickets: 0, triaged: 0 };
    try {
      const since = settings.lastSyncAt ? ms(settings.lastSyncAt) - OVERLAP_MS : started.getTime() - settings.importDays * 86400000;
      const q = `after:${Math.floor(since / 1000)} -in:chats -in:drafts`;
      const listed = [];
      let pageToken = "";
      for (let page = 0; page < LIST_PAGES; page++) {
        const r = await gmail(`messages?maxResults=100&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
        listed.push(...(r.messages || []));
        pageToken = r.nextPageToken || "";
        if (!pageToken) break;
      }
      result.listed = listed.length;
      const fresh = [];
      for (const m of listed) {
        const seen = await tickets().doc(String(m.threadId)).collection("messages").doc(String(m.id)).get();
        if (!seen.exists) fresh.push(m);
      }
      const parsed = [];
      for (let i = 0; i < fresh.length; i += 10) {
        const full = await Promise.all(fresh.slice(i, i + 10).map((m) => gmail(`messages/${encodeURIComponent(m.id)}?format=full`)));
        for (const m of full) parsed.push(core.parseGmailMessage(m, settings.connectedEmail));
      }
      parsed.sort((a, b) => ms(a.at) - ms(b.at));
      for (const m of parsed) {
        const r = await ingest(m, settings);
        if (r !== "skipped") result.newMessages += 1;
        if (r === "new-ticket") result.newTickets += 1;
      }
      const pending = await tickets().where("triagePending", "==", true).limit(maxTriage).get();
      const ids = [];
      pending.forEach((d) => ids.push(d.id));
      for (const id of ids) { await triageTicket(id); result.triaged += 1; }
      await settingsRef().set({ lastSyncAt: started, lastSyncOk: true, lastSyncError: "", lastSyncNew: result.newMessages, connectionError: "" }, { merge: true });
    } catch (err) {
      const message = core.clip(String(err && err.message ? err.message : err), 300);
      logger.error("support: sync failed", { error: message });
      await settingsRef().set({ lastSyncOk: false, lastSyncError: message, lastSyncTriedAt: started }, { merge: true });
      return Object.assign(result, { ok: false, error: message });
    }
    return result;
  }
  // One sync at a time in this instance: the schedule and "Sync now" can overlap.
  function sync({ maxTriage = TRIAGE_PER_RUN } = {}) {
    if (!syncing) syncing = runSync(maxTriage).finally(() => { syncing = null; });
    return syncing;
  }

  // ── Ticket actions ──
  async function setStatus(ticketId, ticket, status, by) {
    const patch = { status, updatedAt: now() };
    if (status === "resolved") {
      Object.assign(patch, { resolvedAt: now(), resolvedBy: by, needsHuman: false, aiDraft: null, triagePending: false });
      if (!ticket.automated) patch.humanInvolved = true;
    } else if (status === "spam") {
      Object.assign(patch, { needsHuman: false, aiDraft: null, triagePending: false, resolvedAt: null, resolvedBy: "" });
    } else if (status === "open") {
      Object.assign(patch, { resolvedAt: null, resolvedBy: "", needsHuman: !ticket.automated, ...(ticket.status === "resolved" ? { reopenCount: (ticket.reopenCount || 0) + 1 } : {}) });
    } else if (status === "pending") {
      Object.assign(patch, { needsHuman: false, resolvedAt: null, resolvedBy: "" });
    }
    await tickets().doc(ticketId).set(patch, { merge: true });
    // Keep Gmail's own spam folder in step; a failure here doesn't undo the ticket.
    if (status === "spam" || ticket.status === "spam") {
      const body = status === "spam" ? { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] } : { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] };
      try { await gmail(`threads/${encodeURIComponent(ticket.threadId || ticketId)}/modify`, { method: "POST", body }); }
      catch (err) { logger.warn("support: Gmail label change failed", { ticketId, error: String(err && err.message ? err.message : err) }); }
    }
    const label = { open: ticket.status === "spam" ? "Marked not spam" : "Reopened", pending: "Set to waiting on customer", resolved: "Resolved", spam: "Marked as spam" }[status];
    await logEvent(ticketId, by, `${label}.`);
    if (status === "resolved" && ticket.kanbanKey && commentKanbanTask) {
      try { await commentKanbanTask(ticket.kanbanKey, `Support ticket ${ticket.key} was resolved in the Support Inbox.`, by); }
      catch (err) { logger.warn("support: Staff Kanban comment failed", { ticketId, error: String(err && err.message ? err.message : err) }); }
    }
  }

  async function handleTicket(req, res, ticketId, action) {
    const who = await requireRole(req, "editor");
    if (!who.ok) return send(res, who.status, { error: who.error });
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const by = who.user.email;
    const ref = tickets().doc(ticketId);
    const ticket = data(await ref.get());
    if (!ticket) return send(res, 404, { error: "no such ticket" });
    const body = req.body && typeof req.body === "object" ? req.body : {};

    if (action === "reply") {
      const text = String(body.text || "").trim();
      if (!text) return send(res, 400, { error: "Write the reply first." });
      if (text.length > core.DRAFT_MAX) return send(res, 400, { error: `A reply is at most ${core.DRAFT_MAX} characters.` });
      if (ticket.status === "spam") return send(res, 409, { error: "This ticket is marked as spam. Mark it not spam to reply." });
      const settings = await readSettings();
      if (!settings.connectedEmail) return send(res, 409, { error: "The support mailbox isn't connected." });
      const source = ["ai-draft", "ai-draft-edited"].includes(body.draft) ? body.draft : "manual";
      try { await sendReply({ ticketId, ticket, text, auto: false, by, source, settings }); }
      catch (err) { return send(res, 502, { error: `The reply wasn't sent: ${core.clip(String(err && err.message ? err.message : err), 200)}` }); }
      const resolve = body.resolve === true;
      await ref.set({
        status: resolve ? "resolved" : "pending", resolvedAt: resolve ? now() : null, resolvedBy: resolve ? by : "",
        humanInvolved: true, needsHuman: false, aiDraft: null, triagePending: false, firstResponseAt: ticket.firstResponseAt || now(),
        lastMessageAt: now(), messageCount: (ticket.messageCount || 0) + 1, updatedAt: now(), snippet: core.clip(text.replace(/\s+/g, " "), 240),
      }, { merge: true });
      if (resolve) {
        await logEvent(ticketId, by, "Replied and resolved.");
        if (ticket.kanbanKey && commentKanbanTask) {
          try { await commentKanbanTask(ticket.kanbanKey, `Support ticket ${ticket.key} was answered and resolved in the Support Inbox.`, by); } catch (err) { logger.warn("support: Staff Kanban comment failed", { ticketId }); }
        }
      }
      return send(res, 200, { ok: true, status: resolve ? "resolved" : "pending" });
    }
    if (action === "draft") {
      const r = await triageTicket(ticketId, { by, forceDraft: true });
      return send(res, r.ok ? 200 : 500, r);
    }
    if (action === "status") {
      const status = String(body.status || "");
      if (!core.STATUSES.includes(status)) return send(res, 400, { error: `status is one of ${core.STATUSES.join(", ")}` });
      if (status === ticket.status) return send(res, 200, { ok: true, status });
      await setStatus(ticketId, ticket, status, by);
      return send(res, 200, { ok: true, status });
    }
    if (action === "note") {
      const text = String(body.text || "").trim();
      if (!text) return send(res, 400, { error: "Write the note first." });
      if (text.length > core.NOTE_MAX) return send(res, 400, { error: `A note is at most ${core.NOTE_MAX} characters.` });
      await ref.collection("messages").doc(eventId()).set({ direction: "note", text, by, at: now() });
      await ref.set({ humanInvolved: true, updatedAt: now() }, { merge: true });
      return send(res, 200, { ok: true });
    }
    if (action === "assign") {
      const assignee = core.lower(body.assignee);
      if (assignee && !(await resolveConsoleUser(assignee))) return send(res, 400, { error: `${assignee} isn't a member of the console.` });
      await ref.set({ assignee, updatedAt: now() }, { merge: true });
      await logEvent(ticketId, by, assignee ? `Assigned to ${assignee}.` : "Unassigned.");
      return send(res, 200, { ok: true, assignee });
    }
    if (action === "escalate") {
      const r = await escalate(ticketId, ticket, await readSettings(), by);
      if (r.ok) await ref.set({ needsHuman: true }, { merge: true });
      return send(res, r.ok ? 200 : 502, r);
    }
    return send(res, 404, { error: "not found" });
  }

  // ── HTTP ──
  async function handle(req, res) {
    const path = String((req.path || req.url || "/").split("?")[0]).replace(/^\/supportMail(?=\/|$)/, "").replace(/\/+$/, "") || "/";

    // Google sends the browser back here after consent. No sign-in header can
    // ride on a redirect, so the single-use state made by /oauth/start is the proof.
    if (path === "/v1/oauth/callback") {
      const back = (q) => res.redirect(302, `${baseUrl}/#settings/support?${q}`);
      const q = req.query || {};
      if (q.error) return back(`error=${encodeURIComponent(String(q.error).slice(0, 80))}`);
      const sec = data(await secretsRef().get());
      const st = sec && sec.oauthState;
      const given = String(q.state || "");
      const fresh = st && st.nonce && now().getTime() - ms(st.at) < STATE_TTL_MS;
      const a = Buffer.from(given), b = Buffer.from(String((st && st.nonce) || ""));
      if (!fresh || !given || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return back("error=expired");
      await secretsRef().set({ oauthState: null }, { merge: true });
      try {
        const { key, clientId, clientSecret } = await clientCreds();
        const tok = await tokenRequest({ client_id: clientId, client_secret: clientSecret, code: String(q.code || ""), grant_type: "authorization_code", redirect_uri: redirectUri });
        if (!tok.refresh_token) return back("error=no-refresh-token");
        if (!String(tok.scope || "").split(" ").includes(SCOPE)) return back("error=scope");
        const pr = await fetchImpl(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
        const profile = await pr.json().catch(() => ({}));
        if (!pr.ok || !profile.emailAddress) return back("error=profile");
        await secretsRef().set({ refresh: encrypt(key, "support-refresh-token", tok.refresh_token) }, { merge: true });
        tokenCache = null; revCheck = { at: 0, rev: "" };
        const cur = data(await settingsRef().get()) || {};
        await settingsRef().set({
          connectedEmail: String(profile.emailAddress).toLowerCase(), connectedBy: st.by, connectedAt: now(), connectionError: "",
          lastSyncAt: null, lastSyncOk: true, lastSyncError: "",
          ...(cur.escalationAssignee ? {} : { escalationAssignee: st.by }),
        }, { merge: true });
        return back("connected=1");
      } catch (err) {
        logger.error("support: OAuth callback failed", { error: String(err && err.message ? err.message : err) });
        return back("error=exchange");
      }
    }

    if (path === "/v1/status") {
      const who = await requireRole(req, "viewer");
      if (!who.ok) return send(res, who.status, { error: who.error });
      if (req.method !== "GET") return send(res, 405, { error: "GET only" });
      return send(res, 200, await status());
    }

    const t = /^\/v1\/tickets\/([A-Za-z0-9_-]{1,80})\/(reply|draft|status|note|assign|escalate)$/.exec(path);
    if (t) return handleTicket(req, res, t[1], t[2]);

    // The scheduled sync (.github/workflows/support-mail-sync.yml) holds no
    // person's sign-in, so it shows the board automation key instead.
    if (path === "/v1/cron") {
      if (req.method !== "POST") return send(res, 405, { error: "POST only" });
      const configured = String(boardKey() || "");
      if (!configured || configured === "unset") return send(res, 503, { error: "BOARD_API_KEY is not configured" });
      const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
      const m = cronMisses.get(ip);
      const windowOpen = m && now().getTime() - m.first < 600000;
      if (windowOpen && m.n >= 10) return send(res, 429, { error: "too many failed attempts — try again later" });
      const given = Buffer.from(String(req.get("x-board-key") || "")), want = Buffer.from(configured);
      if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
        cronMisses.set(ip, windowOpen ? { n: m.n + 1, first: m.first } : { n: 1, first: now().getTime() });
        return send(res, 401, { error: "missing or invalid X-Board-Key" });
      }
      const r = await sync();
      // "Not connected" is a normal state, not a failed run.
      return send(res, r.ok || /isn't connected/.test(r.error || "") ? 200 : 502, r);
    }

    if (path === "/v1/sync") {
      const who = await requireRole(req, "editor");
      if (!who.ok) return send(res, who.status, { error: who.error });
      if (req.method !== "POST") return send(res, 405, { error: "POST only" });
      const r = await sync({ maxTriage: TRIAGE_PER_PAGE_SYNC });
      return send(res, r.ok ? 200 : 502, r);
    }

    // ── Admin: connection and settings ──
    if (!["/v1/oauth/client", "/v1/oauth/start", "/v1/disconnect", "/v1/settings"].includes(path)) return send(res, 404, { error: "not found" });
    const who = await requireRole(req, "admin");
    if (!who.ok) return send(res, who.status, { error: who.error });
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const body = req.body && typeof req.body === "object" ? req.body : {};

    if (path === "/v1/oauth/client") {
      const key = keyBytes(encKey());
      if (!key) return send(res, 503, { error: "Encryption isn't set up yet (MEDIA_KEYS_ENC_KEY). It is created by the next console deploy." });
      const clientId = String(body.clientId || "").trim();
      const clientSecret = String(body.clientSecret || "").trim();
      if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) return send(res, 400, { error: "That doesn't look like a Google OAuth client ID (it ends .apps.googleusercontent.com)." });
      if (clientSecret.length < 16 || clientSecret.length > 200 || /\s/.test(clientSecret)) return send(res, 400, { error: "That doesn't look like a Google OAuth client secret." });
      await secretsRef().set({ clientId, client: encrypt(key, "support-oauth-client", clientSecret), clientUpdatedBy: who.user.email, clientUpdatedAt: now() }, { merge: true });
      tokenCache = null;
      return send(res, 200, { ok: true });
    }
    if (path === "/v1/oauth/start") {
      const sec = data(await secretsRef().get());
      if (!sec || !sec.client) return send(res, 409, { error: "Save the Google OAuth client first." });
      const nonce = crypto.randomBytes(24).toString("hex");
      await secretsRef().set({ oauthState: { nonce, by: who.user.email, at: now() } }, { merge: true });
      const url = `${AUTH_URL}?${new URLSearchParams({
        client_id: sec.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
        access_type: "offline", prompt: "consent", state: nonce, ...(body.loginHint ? { login_hint: String(body.loginHint).slice(0, 200) } : {}),
      }).toString()}`;
      return send(res, 200, { url });
    }
    if (path === "/v1/disconnect") {
      try {
        const { key, sec } = await clientCreds();
        if (sec.refresh) await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(key, "support-refresh-token", sec.refresh))}`, { method: "POST" });
      } catch (err) { logger.warn("support: token revoke failed", { error: String(err && err.message ? err.message : err) }); }
      await secretsRef().set({ refresh: null, oauthState: null }, { merge: true });
      revCheck = { at: 0, rev: "" };
      await settingsRef().set({ connectedEmail: "", connectionError: "", disconnectedBy: who.user.email, disconnectedAt: now() }, { merge: true });
      tokenCache = null;
      return send(res, 200, { ok: true });
    }
    // /v1/settings
    const cur = await readSettings();
    const { value, errors } = core.cleanSettingsInput(body, cur);
    if (errors.length) return send(res, 400, { error: errors.join(" ") });
    if (value.escalationAssignee && !(await resolveConsoleUser(value.escalationAssignee))) return send(res, 400, { error: `${value.escalationAssignee} isn't a member of the console.` });
    await settingsRef().set(Object.assign({}, value, { settingsUpdatedBy: who.user.email, settingsUpdatedAt: now() }), { merge: true });
    return send(res, 200, { ok: true, settings: value });
  }

  return { handle, sync, status, triageTicket, ingest };
}

module.exports = { createSupportMail, claudeTriage, TICKETS, SETTINGS, SECRETS, COUNTERS, SCOPE, DRAFT_MODEL };
