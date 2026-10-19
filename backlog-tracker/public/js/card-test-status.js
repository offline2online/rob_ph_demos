// Pure, dependency-free helpers for a train card's own test result
// (`trainTest`, written only by run-backlog-automation.js): the chip on
// Ready for Testing / Approved for Deployment cards, the warning before
// approving a ticket that isn't green, and the "Approved by" line.
//
// No Firebase, no DOM: testable with plain node
// (test/card-test-status-ui.test.mjs) and imported as-is by public/js/app.js.

const REPO_ACTIONS = "https://github.com/offline2online/rob_ph_demos/actions";

// state → [label, Material Symbols Outlined icon, css modifier]
const CHIPS = {
  "starting": ["Tests starting", "hourglass_empty", "running"],
  "running": ["Tests running", "hourglass_top", "running"],
  "passed": ["Tests passed", "check_circle", "passed"],
  "failed": ["Tests failed — view run", "error", "failed"],
  "not-run": ["Tests not run — open", "do_not_disturb_on", "not-run"],
  "not-applicable": ["No train tests", "", "none"],
};

const STATE_WORDS = {
  "starting": "starting", "running": "running", "passed": "passed", "failed": "failed",
  "not-run": "not run", "not-applicable": "no train tests",
};

function escapeHTML(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Only https links are ever drawn.
function safeHttps(url) {
  return typeof url === "string" && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : "";
}

// The record, but only while it describes the commit now on the train and
// the card is in a train column — a stale sha shows nothing, like the review flag.
export function currentTrainTest(item) {
  const t = item && item.trainTest;
  if (!item || !t || typeof t !== "object") return null;
  if (item.status !== "ready-for-testing" && item.status !== "ready-to-publish") return null;
  if (!item.deployCommit || t.sha !== item.deployCommit) return null;
  if (!CHIPS[t.state]) return null;
  return t;
}

function sinceText(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";
}

// { state, label, icon, modifier, href, title } or null when no chip shows.
export function trainTestChip(item) {
  const t = currentTrainTest(item);
  if (!t) return null;
  const [label, icon, modifier] = CHIPS[t.state];
  const workflows = Array.isArray(t.workflows) ? t.workflows : [];
  const culprit = workflows.find((w) => w && w.state === t.state);
  let href = "";
  if (t.state === "failed") href = safeHttps(culprit && culprit.runUrl);
  if (t.state === "not-run") {
    href = safeHttps(culprit && culprit.runUrl)
      || (culprit && /^[\w.-]+\.ya?ml$/.test(culprit.workflow || "") ? `${REPO_ACTIONS}/workflows/${culprit.workflow}` : REPO_ACTIONS);
  }
  const lines = workflows.map((w) => {
    const since = sinceText(w.since);
    return `${w.label || w.workflow}: ${STATE_WORDS[w.state] || w.state}${since ? ` since ${since}` : ""}`;
  });
  return { state: t.state, label, icon, modifier, href, title: lines.length ? lines.join("\n") : label };
}

export function trainTestChipHTML(item) {
  const c = trainTestChip(item);
  if (!c) return "";
  const icon = c.icon ? `<span class="material-symbols-outlined">${c.icon}</span>` : "";
  const text = c.href ? `${escapeHTML(c.label)} ↗` : escapeHTML(c.label);
  const inner = `${icon}${text}`;
  const cls = `review-flag train-test-flag train-test-flag-${c.modifier}`;
  return c.href
    ? `<a class="${cls}" href="${escapeHTML(c.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(c.title)}">${inner}</a>`
    : `<span class="${cls}" title="${escapeHTML(c.title)}">${inner}</span>`;
}

// One line per ticked ticket whose tests aren't green. Passed and "no train
// tests" tickets are left out; none left means no dialog at all.
export function approvalWarningLines(items) {
  const words = { "starting": "tests still running", "running": "tests still running", "failed": "tests failed", "not-run": "tests not run" };
  const lines = [];
  for (const item of items || []) {
    const t = currentTrainTest(item);
    if (t && words[t.state]) lines.push(`${item.title} — ${words[t.state]}`);
  }
  return lines;
}

export const APPROVAL_WARNING_TITLE = "Approve before tests pass?";
export const APPROVAL_WARNING_FOOTER = "An approved ticket that goes red is not sent back automatically. The deploy holds until someone fixes it.";

// The fields the approving batch writes, besides status. `now` is the
// caller's serverTimestamp() so this stays free of Firebase.
export function approvalFields(email, now) {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  return e ? { approvedByEmail: e, approvedAt: now } : {};
}

// "Approved by <email>" (time on hover), or the route that approved it.
export function approvedByLine(item) {
  if (!item) return null;
  const who = item.approvedByEmail || item.approvedVia;
  if (!who) return null;
  let when = "";
  const a = item.approvedAt;
  const ms = a && typeof a.toMillis === "function" ? a.toMillis() : a instanceof Date ? a.getTime() : Date.parse(a);
  if (Number.isFinite(ms)) when = new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return { text: `Approved by ${who}`, title: when ? `Approved ${when}` : "" };
}
