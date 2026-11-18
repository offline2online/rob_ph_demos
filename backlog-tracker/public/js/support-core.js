// Support Inbox: the page's rules. Pure functions only (no DOM, no Firestore),
// so test/support-page-core.test.mjs can drive them; support-page.js owns the
// rendering. The server's half is functions/support-core.js; STATUSES must
// match it (test/support-core.test.js checks).

export const STATUSES = ["open", "pending", "resolved", "spam"];
export const STATUS_LABEL = { open: "Open", pending: "Waiting on customer", resolved: "Resolved", spam: "Spam" };
export const CATEGORY_LABEL = {
  question: "Question", "how-to": "How-to", bug: "Bug", billing: "Billing", account: "Account",
  sales: "Sales", feedback: "Feedback", automated: "Automated", unrelated: "Not about PH", other: "Other",
};

// The inboxes, one tab each. The mailbox is reached through three addresses
// and a ticket is filed under each one its emails were written to (`inboxes`
// on the ticket, set by functions/support-core.js; the keys must match it).
// A ticket with none recorded (filed before the tabs existed, or written to
// no alias) is the Support Inbox's.
// Only the Support Inbox is worked as support tickets (queues, triage, a
// suggested reply). Hello and Aidan are `plain`: a list of emails and the
// thread, with Reply; Aidan's also says what Aidan did with each thread.
export const INBOXES = [
  { key: "support", label: "Support Inbox", address: "support@", plain: false },
  { key: "hello", label: "Hello", address: "hello@", plain: true },
  { key: "aidan", label: "Aidan", address: "aidan@", plain: true, agent: true },
];
export const DEFAULT_INBOX = "support";
const INBOX_KEYS = INBOXES.map((i) => i.key);
export const inboxOf = (key) => INBOXES.find((i) => i.key === key) || INBOXES[0];
export const isPlainInbox = (key) => !!inboxOf(key).plain;
export const inInbox = (t, key) => (t.inboxes && t.inboxes.length ? t.inboxes : [DEFAULT_INBOX]).includes(inboxOf(key).key);

const open = (t) => t.status === "open";
// The queues down the left of the Support Inbox, in working order. A ticket is
// in exactly one of the first six. Hello and Aidan have none (plain inboxes).
export const QUEUES = [
  { key: "needs-person", label: "Needs a person", icon: "support_agent", test: (t) => open(t) && !!t.needsHuman },
  { key: "ai-drafts", label: "AI drafts to approve", icon: "auto_awesome", test: (t) => open(t) && !t.needsHuman && !!t.aiDraft },
  { key: "to-sort", label: "Automated & not about PH", icon: "mark_email_unread", test: (t) => open(t) && !t.needsHuman && !t.aiDraft },
  { key: "pending", label: "Waiting on customer", icon: "schedule", test: (t) => t.status === "pending" },
  { key: "resolved", label: "Resolved", icon: "task_alt", test: (t) => t.status === "resolved" },
  { key: "spam", label: "Spam", icon: "report", test: (t) => t.status === "spam" },
  { key: "all", label: "All tickets", icon: "inbox", test: (t) => t.status !== "spam" },
];
export const DEFAULT_QUEUE = "needs-person";
export const queueOf = (key) => QUEUES.find((q) => q.key === key) || QUEUES[0];
// `inbox`: count that inbox's tickets only (every ticket when left out).
export function queueCounts(tickets, inbox) {
  const out = {};
  for (const q of QUEUES) out[q.key] = 0;
  for (const t of tickets || []) if (!inbox || inInbox(t, inbox)) for (const q of QUEUES) if (q.test(t)) out[q.key] += 1;
  return out;
}

// Firestore Timestamp, Date, ISO string or the test stub's {$ts} -> ms (0 when unset).
export function toMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && typeof v.$ts === "number") return v.$ts;
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "number") return v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

export function normaliseTicket(id, d) {
  const t = d || {};
  return {
    id, inboxes: (() => { const own = INBOX_KEYS.filter((k) => Array.isArray(t.inboxes) && t.inboxes.includes(k)); return own.length ? own : [DEFAULT_INBOX]; })(),
    key: t.key || id, subject: t.subject || "(no subject)", customerEmail: t.customerEmail || "", customerName: t.customerName || "",
    status: STATUSES.includes(t.status) ? t.status : "open", needsHuman: !!t.needsHuman, triagePending: !!t.triagePending,
    automated: t.automated || "", unrelated: !!t.unrelated || t.category === "unrelated", highValue: !!t.highValue, account: t.account || null, category: t.category || "", summary: t.summary || "",
    triageReason: t.triageReason || "", spamLikely: !!t.spamLikely, snippet: t.snippet || "", assignee: t.assignee || "", kanbanKey: t.kanbanKey || "",
    aiDraft: t.aiDraft && t.aiDraft.text ? { text: t.aiDraft.text, confidence: Number(t.aiDraft.confidence) || 0, confidenceSteps: Array.isArray(t.aiDraft.confidenceSteps) ? t.aiDraft.confidenceSteps : [], answerable: !!t.aiDraft.answerable, articles: Array.isArray(t.aiDraft.articles) ? t.aiDraft.articles : [] } : null,
    messageCount: t.messageCount || 0, humanInvolved: !!t.humanInvolved, autoRepliesSent: t.autoRepliesSent || 0, reopenCount: t.reopenCount || 0,
    resolvedBy: t.resolvedBy || "", escalationError: t.escalationError || "",
    // Archived out of a plain inbox's list (Hello, Aidan); the Support Inbox resolves instead.
    archived: !!t.archived,
    // What Aidan (the agent mailbox, aidan@) did with this ticket's tagged request; null when nothing.
    aidan: t.aidan && typeof t.aidan === "object" && AIDAN_STATES[t.aidan.status] ? t.aidan : null,
    createdAt: toMs(t.createdAt), lastMessageAt: toMs(t.lastMessageAt), firstResponseAt: toMs(t.firstResponseAt), resolvedAt: toMs(t.resolvedAt),
    // The customer's latest email and our latest reply to them (0 on tickets filed before these were recorded).
    lastInboundAt: toMs(t.lastInboundAt), lastReplyAt: toMs(t.lastReplyAt),
  };
}

// ── Aidan, the agent mailbox ──────────────────────────────────────────────
// An email in the Aidan tab from an allowed sender that tags "@Aidan" with an
// instruction is answered by Aidan (functions/aidan.js). `aidan.status` on
// the ticket says how far it got and `aidan.kind` what was asked for; this is
// how the page words them.
// tone: "done" | "working" | "attention"
const AIDAN_STATES = {
  queued: { badge: "Aidan: queued", tone: "working" },
  working: { badge: "Aidan: working", tone: "working" },
  replied: { badge: "Aidan replied", tone: "done" },
  ingested: { badge: "Ingested", tone: "done" },
  ignored: { badge: "Aidan: no action", tone: "attention" },
  "needs-person": { badge: "Aidan: needs a person", tone: "attention" },
  error: { badge: "Aidan: failed", tone: "attention" },
};
// What Aidan was asked to do (functions/aidan-core.js → kindOf): answer in the
// email itself, write a document with a skill, or keep the email for a skill.
export const AIDAN_KINDS = { answer: "Answer", generate: "Write", store: "Store" };
const AIDAN_ASKED = { answer: "answer on the email", generate: "write documentation", store: "keep this email for a skill" };
// What an answer run took from the Help Centre (functions/answer-core.js, the
// engine the Support Inbox drafts with): the matched articles and the
// confidence, kept on the ticket and never written in Aidan's email. null when
// the answer didn't come from the Help Centre.
export function aidanHelpCentre(aidan) {
  const h = aidan && aidan.helpCentre && typeof aidan.helpCentre === "object" ? aidan.helpCentre : null;
  if (!h || !Array.isArray(h.articles) || !h.articles.length) return null;
  return {
    confidence: Math.min(1, Math.max(0, Number(h.confidence) || 0)),
    confidenceSteps: Array.isArray(h.confidenceSteps) ? h.confidenceSteps : [],
    articles: h.articles.filter((x) => x && x.title).map((x) => ({ id: String(x.id || ""), title: String(x.title), url: typeof x.url === "string" ? x.url : null })),
  };
}
// A thread marked as spam (functions/aidan.js → markSpam): no action, and a
// request that was waiting on it was cancelled.
const aidanSpamView = (a) => ({ badge: "Aidan: no action", tone: "none", kind: "", helpCentre: null, spam: true,
  line: `Aidan: no action — spam.${a.cancelled ? " The request waiting on this thread was cancelled." : ""}` });
// True while Aidan has a request queued or working on the thread: marking it
// as spam cancels that request, and the confirmation says so first.
export function aidanRequestWaiting(aidan) {
  return Boolean(aidan && typeof aidan === "object" && (aidan.status === "queued" || aidan.status === "working"));
}
// What the Mark as spam confirmation says. `plain` is a Hello or Aidan email;
// the Support Inbox names the ticket.
export function spamConfirmText(t, { plain = false } = {}) {
  const base = plain ? "Mark this email as spam? It moves to Spam here and in the mailbox."
    : `Mark ${t.key} as spam? It moves to Spam here and in the mailbox, and is left out of the Dashboard's figures.`;
  return aidanRequestWaiting(t.aidan) ? `${base} Aidan's request on it is cancelled.` : base;
}
// { badge, tone, line, kind, helpCentre } for a ticket's Aidan state, or null when Aidan has
// nothing to say. `kind` is "Answer", "Write" or "Store" ("" when no run was accepted).
export function aidanView(aidan) {
  const a = aidan && AIDAN_STATES[aidan.status] ? aidan : null;
  if (!a) return null;
  if (a.spam) return aidanSpamView(a);
  const helpCentre = a.status === "replied" && a.kind === "answer" ? aidanHelpCentre(a) : null;
  const collateral = aidanCollateral(a);
  const s = AIDAN_STATES[a.status];
  const skill = a.skillName ? ` with the ${a.skillName} skill` : "";
  const people = `${a.recipients || 0} ${a.recipients === 1 ? "person" : "people"}`;
  const line = {
    queued: `Aidan was asked to ${AIDAN_ASKED[a.kind] || AIDAN_ASKED.generate}: "${a.instruction || ""}". It runs at the next scheduled sync.`,
    working: `Aidan is working on: "${a.instruction || ""}".`,
    replied: helpCentre ? `Aidan answered from the Help Centre, in the email itself, to ${people} on this email. Nothing was attached.`
      : a.kind === "answer" ? `Aidan answered in the email itself, to ${people} on this email. Nothing was attached.`
      : collateral && !collateral.unsent ? `Aidan wrote the branded ${collateral.formatLabel.toLowerCase()}${skill} and replied to ${people} on this email with the PDF and its Markdown source attached.`
      : `Aidan wrote ${a.document && a.document.name ? a.document.name : "the documentation"}${skill} and replied to ${a.recipients || 0} ${a.recipients === 1 ? "person" : "people"} on this email.`,
    ingested: `Ingested: kept as reference material for the ${a.skillName || "named"} skill${a.files && a.files.length ? ` (${a.files.length} attachment${a.files.length === 1 ? "" : "s"})` : ""}.`,
    ignored: `Aidan did nothing: ${a.reason || "the request wasn't accepted."}`,
    "needs-person": `Aidan needs a person: ${a.reason || ""}`,
    error: a.reason || "Aidan couldn't finish.",
  }[a.status];
  return { badge: s.badge, tone: s.tone, line, kind: AIDAN_KINDS[a.kind] || "", helpCentre, collateral };
}

// Branded sales collateral Aidan wrote (functions/collateral-core.js,
// JtkLrEG0aTnC5JfkdPA1): what it was, for whom, the two files sent (the PDF
// and its Markdown source), whether it was kept as a reference example for
// the skill, and what was taken out of it before it was sent. null for any
// other run. { formatLabel, about, files: [{ name, detail }], kept, removed: [string], unsent }
const COLLATERAL_REMOVED = {
  australia: (n) => `${n} sentence${n === 1 ? "" : "s"} naming Sydney or Australia`,
  internal: (n) => `${n} sentence${n === 1 ? "" : "s"} naming an internal project`,
  renamed: (n) => `${n} internal name${n === 1 ? "" : "s"} renamed`,
  dashes: (n) => `${n} long dash${n === 1 ? "" : "es"} replaced`,
};
const kb = (n) => { const b = Math.max(0, Number(n) || 0); return b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; };
export function aidanCollateral(aidan) {
  const c = aidan && aidan.collateral && typeof aidan.collateral === "object" ? aidan.collateral : null;
  if (!c || typeof c.formatLabel !== "string" || !c.formatLabel) return null;
  const prospect = c.prospect && typeof c.prospect === "object" && typeof c.prospect.name === "string" ? c.prospect : null;
  const source = prospect && prospect.source === "prospect" ? "Prospects (TAM)" : prospect && prospect.source === "lead" ? "Leads" : "";
  const about = [c.formatLabel, typeof c.industry === "string" ? c.industry : "", prospect ? `for ${prospect.name}${source ? ` (industry and country from ${source})` : ""}` : ""].filter(Boolean).join(" · ");
  const files = [];
  const pdf = c.pdf && typeof c.pdf === "object" && c.pdf.name ? c.pdf : null;
  if (pdf) { const pages = Math.max(0, Number(pdf.pages) || 0); files.push({ name: String(pdf.name), detail: `Branded PDF${pages ? `, ${pages} page${pages === 1 ? "" : "s"}` : ""}, ${kb(pdf.size)}` }); }
  if (c.markdown && c.markdown.name) files.push({ name: String(c.markdown.name), detail: `Markdown source, ${kb(c.markdown.size)}` });
  const removed = (Array.isArray(c.removed) ? c.removed : []).filter((r) => r && COLLATERAL_REMOVED[r.rule] && Number(r.count) > 0).map((r) => COLLATERAL_REMOVED[r.rule](Number(r.count)));
  return { formatLabel: c.formatLabel, about, files, kept: Boolean(c.referenceId), removed, unsent: !pdf };
}

// Which part of the email was the instruction and which the content
// (functions/aidan-core.js → threadContent, OrkZBBjz9RM5DY54azIG): when the
// instruction refers to the thread ("answer John's question below"), the
// quoted or forwarded part and the thread's earlier emails were read as
// content, never as instructions; anything in them that looked like an
// instruction was ignored. Earlier emails not everyone on the reply had
// received were left out (`left`). While the run is queued or working, a
// request that refers to the thread says it will be read; once it has run,
// rows show only when it really read content. null otherwise.
// { instruction, content: { line, preview }, ignored: [string] }
export function aidanParts(aidan) {
  const a = aidan && typeof aidan === "object" && AIDAN_STATES[aidan.status] ? aidan : null;
  if (!a || !a.instruction) return null;
  const c = a.content && typeof a.content === "object" ? a.content : null;
  const pending = a.status === "queued" || a.status === "working";
  if (!c && !(pending && a.refersToThread)) return null;
  let line = "The quoted email and the earlier emails on this thread will be read as content when Aidan runs.";
  if (c) {
    const earlier = Math.max(0, Number(c.earlierCount) || 0);
    const left = Math.max(0, Number(c.left) || 0);
    const what = [Number(c.quotedChars) > 0 ? "the quoted or forwarded email" : "", earlier ? `${earlier} earlier email${earlier === 1 ? "" : "s"} on this thread` : ""].filter(Boolean).join(" and ");
    line = `Aidan read ${what || "the thread"} as content to answer from, never as instructions.`;
    if (left) line += ` ${left} earlier email${left === 1 ? " was" : "s were"} left out, because not everyone this reply went to had received ${left === 1 ? "it" : "them"}.`;
  }
  const ignored = c && Array.isArray(c.ignored) ? c.ignored.filter((x) => typeof x === "string" && x.trim()).slice(0, 3) : [];
  return { instruction: String(a.instruction), content: { line, preview: c && typeof c.preview === "string" ? c.preview : "" }, ignored };
}

// What the Aidan tab says about a thread: always a state. A thread Aidan was
// never asked about reads "no action", and why.
export function aidanThreadState(aidan, { spam = false } = {}) {
  if (spam && !(aidan && aidan.spam)) return aidanSpamView({});
  return aidanView(aidan) || { badge: "Aidan: no action", tone: "none", line: "Aidan did nothing: this email has no @Aidan request.", kind: "" };
}

// ── Hello and Aidan: plain inboxes ────────────────────────────────────────
// An email list (sender, subject, date, unread) and the thread. No queues:
// the only other places an email can be are Spam and Archived.
// Unread: the sender's latest email is newer than our last reply and than the
// last time this browser opened the thread (`openedAt`, ms; kept by the page).
// MARKED_UNREAD in its place means a person marked the thread unread (the
// lists' checkboxes): it stays unread until it is opened or marked read.
export const MARKED_UNREAD = -1;
export const isMarkedUnread = (openedAt) => Number(openedAt) === MARKED_UNREAD;
export function isUnread(t, openedAt = 0) {
  if (t.status === "spam") return false;
  if (isMarkedUnread(openedAt)) return true;
  return (t.lastInboundAt || 0) > Math.max(t.lastReplyAt || 0, Number(openedAt) || 0);
}
// Which of a plain inbox's three lists a thread is in: "spam", "archived" or "" (its emails).
export const plainListOf = (t) => (t.status === "spam" ? "spam" : t.archived ? "archived" : "");
// `list`: "spam" (or true) for the inbox's Spam, "archived" for what was
// archived out of it, anything else for its emails. Newest first.
export function plainInboxRows(tickets, inbox, search, list = "") {
  const s = String(search || "").trim().toLowerCase();
  const want = list === true || list === "spam" ? "spam" : list === "archived" ? "archived" : "";
  return (tickets || []).filter((t) => inInbox(t, inbox) && plainListOf(t) === want
    && (!s || [t.subject, t.customerEmail, t.customerName, t.snippet].some((v) => String(v || "").toLowerCase().includes(s))))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}
// { emails, unread, spam, archived } for a plain inbox; `opened` is { ticketId: ms }.
export function plainInboxCounts(tickets, inbox, opened = {}) {
  const out = { emails: 0, unread: 0, spam: 0, archived: 0 };
  for (const t of tickets || []) {
    if (!inInbox(t, inbox)) continue;
    if (t.status === "spam") { out.spam += 1; continue; }
    if (t.archived) { out.archived += 1; continue; }
    out.emails += 1;
    if (isUnread(t, opened[t.id])) out.unread += 1;
  }
  return out;
}

// ── Selecting several threads (the checkboxes on every inbox's list) ──────
// What can be done to the selected threads, by inbox and list, in the order
// the selection bar shows them. Each is { key, label, icon } plus what the
// page sends to POST /supportMail/v1/tickets/bulk (`action` and its fields),
// or `local: "read" | "unread"` for the unread state this browser keeps.
// `pick: "member" | "move"` is a list to choose from instead of a button.
// `danger` asks once for the whole batch before anything is sent.
const BULK = {
  spam: { key: "spam", label: "Mark as spam", icon: "report", action: "status", status: "spam", danger: true },
  notSpam: { key: "not-spam", label: "Not spam", icon: "inbox", action: "status", status: "open" },
  read: { key: "read", label: "Mark as read", icon: "drafts", local: "read" },
  unread: { key: "unread", label: "Mark as unread", icon: "mark_email_unread", local: "unread" },
  resolve: { key: "resolve", label: "Resolve", icon: "task_alt", action: "status", status: "resolved" },
  archive: { key: "archive", label: "Archive", icon: "archive", action: "archive", archived: true },
  unarchive: { key: "unarchive", label: "Move to inbox", icon: "unarchive", action: "archive", archived: false },
  assign: { key: "assign", label: "Assign to", icon: "person_add", action: "assign", pick: "member" },
  move: { key: "move", label: "Move to", icon: "drive_file_move", pick: "move" },
  escalate: { key: "escalate", label: "Raise on Staff Kanban", icon: "view_kanban", action: "escalate", confirm: true },
  dismiss: { key: "aidan-dismiss", label: "Dismiss Aidan's state", icon: "smart_toy", action: "aidan-dismiss" },
};
// Where "Move to" can put Support Inbox tickets (Resolved and Spam have their own buttons).
export const BULK_MOVES = [
  { key: "needs-person", label: "Needs a person", action: "needs-person" },
  { key: "pending", label: "Waiting on customer", action: "status", status: "pending" },
];
export function bulkActions(inbox, queue) {
  const box = inboxOf(inbox);
  if (queue === "spam") return [BULK.notSpam];
  if (!box.plain) return [BULK.spam, BULK.read, BULK.unread, BULK.resolve, BULK.assign, BULK.move, BULK.escalate];
  if (queue === "archived") return [BULK.unarchive, BULK.spam];
  return [BULK.spam, BULK.read, BULK.unread, BULK.archive, ...(box.agent ? [BULK.dismiss] : [])];
}
export const bulkAction = (inbox, queue, key) => bulkActions(inbox, queue).find((a) => a.key === key) || null;
const things = (n, plain) => `${n} ${plain ? "email" : "ticket"}${n === 1 ? "" : "s"}`;
// The one confirmation for a batch marked as spam.
export function bulkSpamConfirmText(tickets, { plain = false } = {}) {
  const n = (tickets || []).length;
  if (n === 1) return spamConfirmText(tickets[0], { plain });
  const waiting = tickets.filter((t) => aidanRequestWaiting(t.aidan)).length;
  return `Mark ${things(n, plain)} as spam? They move to Spam here and in the mailbox${plain ? "" : ", and are left out of the Dashboard's figures"}.`
    + (waiting ? ` Aidan's request on ${waiting === 1 ? "one of them" : `${waiting} of them`} is cancelled.` : "");
}
// The one message after a batch: what was done to how many, and how many failed.
// `r` is { done, failed, skipped, error } summed over the calls made.
const BULK_DONE = {
  spam: "marked as spam", "not-spam": "marked not spam", read: "marked as read", unread: "marked as unread", resolve: "resolved",
  archive: "archived", unarchive: "moved to the inbox", assign: "assigned", move: "moved", escalate: "raised on Staff Kanban", "aidan-dismiss": "cleared of Aidan's state",
};
export function bulkResultText(key, r, { plain = false, detail = "" } = {}) {
  const done = Number(r && r.done) || 0, failed = Number(r && r.failed) || 0, skipped = Number(r && r.skipped) || 0;
  const what = `${BULK_DONE[key] || "changed"}${detail ? ` ${detail}` : ""}`;
  const parts = [];
  if (done || (!failed && !skipped)) parts.push(`${things(done, plain)} ${what}.`);
  if (skipped) parts.push(key === "aidan-dismiss" ? `${skipped} had nothing to dismiss.` : `${skipped} left as ${skipped === 1 ? "it was" : "they were"}.`);
  if (failed) parts.push(`${failed} failed${r.error ? `: ${r.error}` : "."}`);
  return parts.join(" ");
}
// The selection after the list changed: only threads still in it stay selected.
export function keepSelected(selected, rows) {
  const ids = new Set((rows || []).map((t) => t.id));
  return new Set([...(selected || [])].filter((id) => ids.has(id)));
}

// Queue + free-text filter, newest activity first (high-value first inside
// "Needs a person", so the ticket that matters most is at the top).
// `inbox`: that inbox's tickets only (every ticket when left out).
export function filterTickets(tickets, queueKey, search, inbox) {
  const q = queueOf(queueKey);
  const s = String(search || "").trim().toLowerCase();
  const rows = (tickets || []).filter((t) => (!inbox || inInbox(t, inbox)) && q.test(t) && (!s || [t.key, t.subject, t.customerEmail, t.customerName, t.snippet, t.account && t.account.name].some((v) => String(v || "").toLowerCase().includes(s))));
  return rows.sort((a, b) => (q.key === "needs-person" ? Number(b.highValue) - Number(a.highValue) : 0) || b.lastMessageAt - a.lastMessageAt);
}

// "#support", "#support?queue=spam", "#support/hello", "#support/aidan?queue=spam",
// "#support/compose", "#support/ticket/<id>", "#support/hello/ticket/<id>",
// "#support/lab", "#support/lab/case/<id>" (the Test lab, support-lab.js)
// -> { view, inbox, queue, ticketId, caseId }, or null when the hash is not a Support Inbox route.
// Routes are split by inbox: the Support Inbox has its queues; Hello and Aidan
// have none, so their `queue` is "" (the emails), "spam" or "archived", and an
// old link to any other queue of theirs opens the emails.
// The Support Inbox's own routes carry no inbox name, so links made before the
// Hello and Aidan tabs existed still open. "#support/stats" and "#support/try"
// were tabs once (removed 17 Nov 2026): an old link to either opens the inbox.
const PLAIN_LISTS = ["spam", "archived"];
export function supportRoute(hash) {
  const [path, qs] = String(hash || "").split("?");
  if (path !== "#support" && !path.startsWith("#support/")) return null;
  let rest = path.slice("#support".length).replace(/^\//, "");
  if (rest === "compose") return { view: "compose", inbox: DEFAULT_INBOX, queue: "", ticketId: "" };
  if (rest === "lab" || rest.startsWith("lab/")) {
    const c = rest.match(/^lab\/case\/(.+)$/);
    return { view: "lab", inbox: DEFAULT_INBOX, queue: "", ticketId: "", caseId: c ? decodeURIComponent(c[1]) : "" };
  }
  if (rest === "stats" || rest === "try") rest = "";
  let inbox = DEFAULT_INBOX;
  const named = INBOX_KEYS.find((k) => k !== DEFAULT_INBOX && (rest === k || rest.startsWith(`${k}/`)));
  if (named) { inbox = named; rest = rest.slice(named.length).replace(/^\//, ""); }
  const m = rest.match(/^ticket\/(.+)$/);
  if (m) return { view: "ticket", inbox, queue: "", ticketId: decodeURIComponent(m[1]) };
  const queue = new URLSearchParams(qs || "").get("queue");
  if (isPlainInbox(inbox)) return { view: "inbox", inbox, queue: PLAIN_LISTS.includes(queue) ? queue : "", ticketId: "" };
  return { view: "inbox", inbox, queue: QUEUES.some((x) => x.key === queue) ? queue : DEFAULT_QUEUE, ticketId: "" };
}
export function supportHash({ view = "inbox", inbox = DEFAULT_INBOX, queue = "", ticketId = "", caseId = "" } = {}) {
  if (view === "compose") return "#support/compose";
  if (view === "lab") return caseId ? `#support/lab/case/${encodeURIComponent(caseId)}` : "#support/lab";
  const key = inboxOf(inbox).key;
  const base = key === DEFAULT_INBOX ? "#support" : `#support/${key}`;
  if (view === "ticket") return `${base}/ticket/${encodeURIComponent(ticketId)}`;
  if (isPlainInbox(key)) return PLAIN_LISTS.includes(queue) ? `${base}?queue=${queue}` : base;
  return queue && queue !== DEFAULT_QUEUE ? `${base}?queue=${queue}` : base;
}

// ── Writing a new email (the email icon in the Support Inbox) ─────────────
// One address, a subject and a message. Returns what is wrong, or "" when it
// can be sent; functions/support-mail.js checks the same before sending.
export const COMPOSE_MAX = 8000;
const ADDRESS_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"'.]+$/;
export function composeProblem({ to, subject, text } = {}) {
  const addr = String(to || "").trim();
  if (!addr) return "Say who the email is to.";
  if (!ADDRESS_RE.test(addr) || addr.length > 254) return "That isn't an email address. Use one address, like name@company.com.";
  if (!String(subject || "").trim()) return "Give the email a subject.";
  if (!String(text || "").trim()) return "Write the message first.";
  if (String(text).trim().length > COMPOSE_MAX) return `A message is at most ${COMPOSE_MAX} characters.`;
  return "";
}

export function fmtWhen(ms, nowMs = Date.now()) {
  if (!ms) return "";
  const diff = nowMs - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const d = new Date(ms);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() === new Date(nowMs).getFullYear() ? {} : { year: "numeric" }) });
}

// ── Inserting a help article into a reply ─────────────────────────────────
export const articleUrl = (id) => `https://personalisationhub.com/support-centre/article.html?id=${encodeURIComponent(id)}`;
export function searchArticles(articles, query, limit = 8) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return [];
  const scored = [];
  for (const a of articles || []) {
    const title = String(a.title || "").toLowerCase();
    const rest = `${a.summary || ""} ${(a.keywords || []).join(" ")} ${a.directAnswer || ""}`.toLowerCase();
    let score = 0;
    for (const t of terms) { if (title.includes(t)) score += 3; else if (rest.includes(t)) score += 1; else { score = 0; break; } }
    if (score) scored.push({ a, score });
  }
  return scored.sort((x, y) => y.score - x.score || String(x.a.title).localeCompare(String(y.a.title))).slice(0, limit).map((x) => x.a);
}
// What "Insert" puts in the reply box: the short answer and the link.
export function articleSnippet(a) {
  const answer = String(a.directAnswer || a.summary || "").trim();
  return `${answer ? `${answer}\n\n` : ""}${a.title}: ${articleUrl(a.id)}`;
}
// Whether the reply about to be sent is the AI draft as written, an edit of
// it, or a person's own words (recorded on the message for the stats).
export function draftSource(text, draft, usedDraft) {
  if (!usedDraft || !draft) return "manual";
  return String(text).trim() === String(draft.text).trim() ? "ai-draft" : "ai-draft-edited";
}

// ── Confidence in a suggested reply ───────────────────────────────────────
// High from 80% (the default level for sending by itself), medium from 60%.
export function confidenceBand(c) { const v = Number(c) || 0; return v >= 0.8 ? "high" : v >= 0.6 ? "medium" : "low"; }
export const CONFIDENCE_LABEL = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
export const pct = (c) => `${Math.round((Number(c) || 0) * 100)}%`;
// "55% from 1 article, 82% with 3 combined" when more answers were added; "" otherwise.
export function confidenceChange(steps) {
  const list = Array.isArray(steps) ? steps : [];
  if (list.length < 2) return "";
  const [a, b] = list;
  return `${pct(a.confidence)} from ${a.articles} article${a.articles === 1 ? "" : "s"}, ${pct(b.confidence)} with ${b.articles} combined`;
}
