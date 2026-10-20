// Why a ticket came back, one line per time (20 Oct 2026). A ticket that
// bounces collects a long thread — build reports, landing notes, re-run
// notes, revert notes — and the reason it was sent back sat somewhere in the
// middle of it. NBQ1scD9GFEr6YbQxSYX went back twice in 20 minutes and
// reading its eleven comments still didn't say why. This reads the thread
// and gives every rejection (a person's Failed testing or Eject from train,
// the automation's send-back) and every "held, main is broken" as one line,
// newest first. Plain ESM, no DOM: test/rejection-summary.test.mjs.

const MAX = 280;
const clip = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);
const firstSentence = (s) => {
  const t = String(s || "").trim().split("\n")[0];
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return clip((m ? m[1] : t).replace(/[.]$/, ""));
};

// What the automation's note says, when it has no "Why:" line (notes from
// before failure summaries existed): "console tests (x.yml) failed on this
// ticket's own commit abc1234…" becomes "console tests failed — no detail
// recorded, open the run in this comment".
function legacyAutoLine(rest) {
  const m = rest.match(/^(.+?) \([^)]+\.ya?ml\) failed/);
  return m ? `${m[1]} failed (no detail recorded; the run is linked in the comment)` : firstSentence(rest);
}

const RULES = [
  {
    re: /^Sent back automatically \(Failed testing \[([^\]]+)\]\):\s*/,
    kind: "sent-back", who: "automation",
    line: (rest) => (/^Why: /.test(rest) ? clip(rest.slice(5).split("\n")[0].replace(/[.]$/, "")) : legacyAutoLine(rest)),
  },
  { re: /^Failed testing \[([^\]]+)\]:\s*/, kind: "sent-back", who: "person", line: (rest, cat) => `${cat}: ${firstSentence(rest)}` },
  { re: /^Ejected from train \[([^\]]+)\]:\s*/, kind: "ejected", who: "person", line: (rest, cat) => `${cat}: ${firstSentence(rest)}` },
  {
    re: /^Not sent back: main is broken, not this ticket\.\s*/,
    kind: "held", who: "automation",
    line: (rest) => {
      const m = rest.match(/\)\s*:\s*(.+?)\. It stays where it is/);
      return clip(m ? `main is broken: ${m[1]}` : "main is broken, not this ticket");
    },
  },
];

function toDate(at) {
  if (!at) return null;
  if (typeof at.toDate === "function") return at.toDate();
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

// [{ kind: "sent-back" | "ejected" | "held", who, at: Date|null, line }],
// newest first.
export function rejectionsOf(notes) {
  const out = [];
  for (const n of notes || []) {
    const text = String((n && n.text) || "");
    for (const r of RULES) {
      const m = text.match(r.re);
      if (!m) continue;
      out.push({ kind: r.kind, who: r.who === "person" ? (n.author && n.author !== "viewer" ? n.author : "a tester") : "automation", at: toDate(n.at), line: r.line(text.slice(m[0].length), m[1]) });
      break;
    }
  }
  return out.sort((a, b) => (b.at ? b.at.getTime() : 0) - (a.at ? a.at.getTime() : 0));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (d) => (d ? d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const VERB = { "sent-back": "Sent back", ejected: "Ejected", held: "Held" };

// The block above a ticket's comments: one headline ("Sent back 2×: <why>")
// and one line per earlier rejection. "" when the ticket was never sent back.
export function rejectionSummaryHTML(item) {
  const list = rejectionsOf(item && item.notes);
  if (!list.length) return "";
  const backs = list.filter((r) => r.kind !== "held").length;
  const latest = list[0];
  const head = latest.kind === "held"
    ? `Held, not sent back${backs ? ` (sent back ${backs}× before)` : ""}`
    : `${VERB[latest.kind]} ${backs}×`;
  const rows = list.slice(1).map((r) => `<li><span class="rejection-when">${esc(when(r.at))}</span><span class="rejection-kind">${VERB[r.kind]}</span><span class="rejection-why">${esc(r.line)}</span></li>`).join("");
  return `<div class="rejection-summary" role="note">
    <p class="rejection-summary-head"><span class="material-symbols-outlined" aria-hidden="true">${latest.kind === "held" ? "pan_tool" : "undo"}</span><b>${esc(head)}</b>${latest.at ? ` <span class="rejection-when">${esc(when(latest.at))}</span>` : ""}<br>${esc(latest.line)}</p>
    ${rows ? `<p class="rejection-summary-earlier">Earlier</p><ol class="rejection-summary-list">${rows}</ol>` : ""}
  </div>`;
}

// One line for a Backlog card's own badge tooltip / summary line.
export function lastRejectionLine(item) {
  const r = item && item.lastFailureReason;
  if (r && r.summary) return r.summary;
  const list = rejectionsOf(item && item.notes).filter((x) => x.kind !== "held");
  return list.length ? list[0].line : (r && r.text ? firstSentence(r.text) : "");
}
