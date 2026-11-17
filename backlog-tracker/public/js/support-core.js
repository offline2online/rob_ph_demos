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
export const INBOXES = [
  { key: "support", label: "Support Inbox", address: "support@" },
  { key: "hello", label: "Hello", address: "hello@" },
  { key: "aidan", label: "Aidan", address: "aidan@" },
];
export const DEFAULT_INBOX = "support";
const INBOX_KEYS = INBOXES.map((i) => i.key);
export const inboxOf = (key) => INBOXES.find((i) => i.key === key) || INBOXES[0];
export const inInbox = (t, key) => (t.inboxes && t.inboxes.length ? t.inboxes : [DEFAULT_INBOX]).includes(inboxOf(key).key);

const open = (t) => t.status === "open";
// The queues down the left of the inbox, in working order. A ticket is in
// exactly one of the first six.
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
    createdAt: toMs(t.createdAt), lastMessageAt: toMs(t.lastMessageAt), firstResponseAt: toMs(t.firstResponseAt), resolvedAt: toMs(t.resolvedAt),
    // The customer's latest email and our latest reply to them (0 on tickets filed before these were recorded).
    lastInboundAt: toMs(t.lastInboundAt), lastReplyAt: toMs(t.lastReplyAt),
  };
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
// "#support/compose", "#support/ticket/<id>", "#support/hello/ticket/<id>"
// -> { view, inbox, queue, ticketId }, or null when the hash is not a Support Inbox route.
// The Support Inbox's own routes carry no inbox name, so links made before the
// Hello and Aidan tabs existed still open. "#support/stats" and "#support/try"
// were tabs once (removed 17 Nov 2026): an old link to either opens the inbox.
export function supportRoute(hash) {
  const [path, qs] = String(hash || "").split("?");
  if (path !== "#support" && !path.startsWith("#support/")) return null;
  let rest = path.slice("#support".length).replace(/^\//, "");
  if (rest === "compose") return { view: "compose", inbox: DEFAULT_INBOX, queue: "", ticketId: "" };
  if (rest === "stats" || rest === "try") rest = "";
  let inbox = DEFAULT_INBOX;
  const named = INBOX_KEYS.find((k) => k !== DEFAULT_INBOX && (rest === k || rest.startsWith(`${k}/`)));
  if (named) { inbox = named; rest = rest.slice(named.length).replace(/^\//, ""); }
  const m = rest.match(/^ticket\/(.+)$/);
  if (m) return { view: "ticket", inbox, queue: "", ticketId: decodeURIComponent(m[1]) };
  const queue = new URLSearchParams(qs || "").get("queue");
  return { view: "inbox", inbox, queue: QUEUES.some((x) => x.key === queue) ? queue : DEFAULT_QUEUE, ticketId: "" };
}
export function supportHash({ view = "inbox", inbox = DEFAULT_INBOX, queue = "", ticketId = "" } = {}) {
  if (view === "compose") return "#support/compose";
  const key = inboxOf(inbox).key;
  const base = key === DEFAULT_INBOX ? "#support" : `#support/${key}`;
  if (view === "ticket") return `${base}/ticket/${encodeURIComponent(ticketId)}`;
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
