// Support Inbox: the page's rules. Pure functions only (no DOM, no Firestore),
// so test/support-page-core.test.mjs can drive them; support-page.js owns the
// rendering. The server's half is functions/support-core.js; STATUSES must
// match it (test/support-core.test.js checks).

export const STATUSES = ["open", "pending", "resolved", "spam"];
export const STATUS_LABEL = { open: "Open", pending: "Waiting on customer", resolved: "Resolved", spam: "Spam" };
export const CATEGORY_LABEL = {
  question: "Question", "how-to": "How-to", bug: "Bug", billing: "Billing", account: "Account",
  sales: "Sales", feedback: "Feedback", automated: "Automated", other: "Other",
};

const open = (t) => t.status === "open";
// The queues down the left of the inbox, in working order. A ticket is in
// exactly one of the first six.
export const QUEUES = [
  { key: "needs-person", label: "Needs a person", icon: "support_agent", test: (t) => open(t) && !!t.needsHuman },
  { key: "ai-drafts", label: "AI drafts to approve", icon: "auto_awesome", test: (t) => open(t) && !t.needsHuman && !!t.aiDraft },
  { key: "to-sort", label: "Automated & unsorted", icon: "mark_email_unread", test: (t) => open(t) && !t.needsHuman && !t.aiDraft },
  { key: "pending", label: "Waiting on customer", icon: "schedule", test: (t) => t.status === "pending" },
  { key: "resolved", label: "Resolved", icon: "task_alt", test: (t) => t.status === "resolved" },
  { key: "spam", label: "Spam", icon: "report", test: (t) => t.status === "spam" },
  { key: "all", label: "All tickets", icon: "inbox", test: (t) => t.status !== "spam" },
];
export const DEFAULT_QUEUE = "needs-person";
export const queueOf = (key) => QUEUES.find((q) => q.key === key) || QUEUES[0];
export function queueCounts(tickets) {
  const out = {};
  for (const q of QUEUES) out[q.key] = 0;
  for (const t of tickets || []) for (const q of QUEUES) if (q.test(t)) out[q.key] += 1;
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
    id, key: t.key || id, subject: t.subject || "(no subject)", customerEmail: t.customerEmail || "", customerName: t.customerName || "",
    status: STATUSES.includes(t.status) ? t.status : "open", needsHuman: !!t.needsHuman, triagePending: !!t.triagePending,
    automated: t.automated || "", highValue: !!t.highValue, account: t.account || null, category: t.category || "", summary: t.summary || "",
    triageReason: t.triageReason || "", spamLikely: !!t.spamLikely, snippet: t.snippet || "", assignee: t.assignee || "", kanbanKey: t.kanbanKey || "",
    aiDraft: t.aiDraft && t.aiDraft.text ? { text: t.aiDraft.text, confidence: Number(t.aiDraft.confidence) || 0, answerable: !!t.aiDraft.answerable, articles: Array.isArray(t.aiDraft.articles) ? t.aiDraft.articles : [] } : null,
    messageCount: t.messageCount || 0, humanInvolved: !!t.humanInvolved, autoRepliesSent: t.autoRepliesSent || 0, reopenCount: t.reopenCount || 0,
    resolvedBy: t.resolvedBy || "", escalationError: t.escalationError || "",
    createdAt: toMs(t.createdAt), lastMessageAt: toMs(t.lastMessageAt), firstResponseAt: toMs(t.firstResponseAt), resolvedAt: toMs(t.resolvedAt),
  };
}

// Queue + free-text filter, newest activity first (high-value first inside
// "Needs a person", so the ticket that matters most is at the top).
export function filterTickets(tickets, queueKey, search) {
  const q = queueOf(queueKey);
  const s = String(search || "").trim().toLowerCase();
  const rows = (tickets || []).filter((t) => q.test(t) && (!s || [t.key, t.subject, t.customerEmail, t.customerName, t.snippet, t.account && t.account.name].some((v) => String(v || "").toLowerCase().includes(s))));
  return rows.sort((a, b) => (q.key === "needs-person" ? Number(b.highValue) - Number(a.highValue) : 0) || b.lastMessageAt - a.lastMessageAt);
}

// "#support", "#support?queue=spam", "#support/stats", "#support/ticket/<id>"
// -> { view, queue, ticketId }, or null when the hash is not a Support Inbox route.
export function supportRoute(hash) {
  const [path, qs] = String(hash || "").split("?");
  if (path !== "#support" && !path.startsWith("#support/")) return null;
  const rest = path.slice("#support".length).replace(/^\//, "");
  if (rest === "stats") return { view: "stats", queue: "", ticketId: "" };
  const m = rest.match(/^ticket\/(.+)$/);
  if (m) return { view: "ticket", queue: "", ticketId: decodeURIComponent(m[1]) };
  const queue = new URLSearchParams(qs || "").get("queue");
  return { view: "inbox", queue: QUEUES.some((x) => x.key === queue) ? queue : DEFAULT_QUEUE, ticketId: "" };
}
export const supportHash = ({ view = "inbox", queue = "", ticketId = "" } = {}) =>
  view === "stats" ? "#support/stats" : view === "ticket" ? `#support/ticket/${encodeURIComponent(ticketId)}` : queue && queue !== DEFAULT_QUEUE ? `#support?queue=${queue}` : "#support";

// ── Stats ─────────────────────────────────────────────────────────────────
const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Everything the Stats tab shows, for tickets received between `from` and
// `to` (ms, inclusive). Spam and machine-sent mail are counted on their own
// and left out of the customer figures, so they cannot flatter the rates.
export function supportStats(tickets, { from = 0, to = Infinity } = {}) {
  const inRange = (tickets || []).filter((t) => t.createdAt >= from && t.createdAt <= to);
  const spam = inRange.filter((t) => t.status === "spam");
  const automated = inRange.filter((t) => t.status !== "spam" && t.automated);
  const customer = inRange.filter((t) => t.status !== "spam" && !t.automated);
  const resolved = customer.filter((t) => t.status === "resolved");
  const byAi = resolved.filter((t) => t.resolvedBy === "ai" && !t.humanInvolved);
  const byPeople = resolved.filter((t) => !(t.resolvedBy === "ai" && !t.humanInvolved));
  const firstResponse = customer.filter((t) => t.firstResponseAt && t.firstResponseAt >= t.createdAt).map((t) => t.firstResponseAt - t.createdAt);
  const resolution = resolved.filter((t) => t.resolvedAt && t.resolvedAt >= t.createdAt).map((t) => t.resolvedAt - t.createdAt);
  const days = new Map();
  for (const t of customer) {
    const k = dayOf(t.createdAt);
    const row = days.get(k) || { day: k, ai: 0, people: 0, open: 0 };
    if (t.status !== "resolved") row.open += 1; else if (t.resolvedBy === "ai" && !t.humanInvolved) row.ai += 1; else row.people += 1;
    days.set(k, row);
  }
  const categories = new Map();
  for (const t of customer) { const k = t.category || "other"; categories.set(k, (categories.get(k) || 0) + 1); }
  return {
    received: customer.length, spam: spam.length, automated: automated.length,
    open: customer.filter((t) => t.status === "open").length, pending: customer.filter((t) => t.status === "pending").length,
    needsPerson: customer.filter((t) => t.status === "open" && t.needsHuman).length,
    resolved: resolved.length, resolvedByAi: byAi.length, resolvedByPeople: byPeople.length,
    aiRate: resolved.length ? byAi.length / resolved.length : null,
    humanInvolved: customer.filter((t) => t.humanInvolved).length,
    highValue: customer.filter((t) => t.highValue).length, reopened: customer.filter((t) => t.reopenCount > 0).length,
    medianFirstResponseMs: median(firstResponse), medianResolutionMs: median(resolution),
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byCategory: [...categories.entries()].map(([key, count]) => ({ key, label: CATEGORY_LABEL[key] || key, count })).sort((a, b) => b.count - a.count),
  };
}

// 95000 -> "1m", 7500000 -> "2h 5m", 300000000 -> "3d 11h"; null -> "—".
export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "under 1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
export const fmtPct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);

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
