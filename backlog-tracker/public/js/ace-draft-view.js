// Promote › Leads › lead summary → "ACE opportunity" group (ticket qLIDYPTSvzKqYLLsI8kC).
// Draws what GET /partnerCentral/v1/leads/{id}/ace answers (functions/ace-draft.js):
// at-risk / closed-lost insights first, then the draft's status, the opportunity,
// its ACE stage and any queued stage change, the quality score (Partner Central's
// own once the opportunity exists, else the agent's prediction), the attachments,
// the agent's open recommendations, a link to the write waiting for approval and,
// for admins, Draft ACE opportunity. Pure view: leads-page.js loads and wires it.
import { group, row, stackRow, lineRow, esc } from "./ap-components.js";

const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
const isAws = (v) => /\baws\b|amazon\s+web\s+services/i.test(String(v || ""));

export const ACE_STATUS_TEXT = {
  drafting: "Drafting…",
  "awaiting-approval": "Draft waits for approval",
  drafted: "Drafted",
  rejected: "Create rejected in Settings",
  error: "Couldn't draft",
  skipped: "Not drafted",
};

// Whether the group shows at all: a draft, an opportunity, or a company that runs on AWS.
export function aceShown(ace) {
  if (!ace || typeof ace !== "object" || !ace.leadId) return false;
  return !!(ace.draft || ace.opportunityId || isAws(ace.primaryCloud));
}

// The Draft button (admins): not while one is being drafted or waits for approval, never once there is an opportunity.
export function aceCanDraft(ace) {
  if (!ace || ace.opportunityId || !ace.eligible || !ace.eligible.ok) return false;
  const s = ace.draft && ace.draft.status;
  return s !== "drafting" && s !== "awaiting-approval" && s !== "drafted";
}

export function aceStageChangeText(sync) {
  if (!sync || !sync.status) return "";
  if (sync.status === "pending") return `${sync.target} · waits to be sent`;
  if (sync.status === "sent") return `${sync.target} · waits for approval`;
  if (sync.status === "done") return "";
  if (sync.status === "rejected") return `${sync.target} · rejected`;
  return "";
}

export function aceScoreText(score, target = 60) {
  if (!score || typeof score.value !== "number") return "";
  return `${score.value} · ${score.source === "actual" ? "Partner Central" : "Predicted"} · target ${target}`;
}

// The group's HTML. `busy` shows the group as drafting while the click's request runs.
export function aceGroupHTML(ace, { busy = false } = {}) {
  if (!aceShown(ace)) return "";
  const d = ace.draft || null;
  const status = busy ? "drafting" : d ? d.status : null;
  const rows = [];
  for (const i of ace.insights || []) {
    const lost = i.level === "lost";
    rows.push(stackRow(`<p class="lead-ace-insight ${lost ? "lead-ace-lost" : "lead-ace-risk"}"><span class="material-symbols-outlined" aria-hidden="true">${lost ? "block" : "warning"}</span><span>${esc(i.text)}</span></p>`, "", "lead-ace-insight-row"));
  }
  const statusText = status ? ACE_STATUS_TEXT[status] || "Couldn't draft" : ace.opportunityId ? "Linked" : ace.eligible && ace.eligible.ok ? "Not drafted yet" : "Not drafted";
  rows.push(row("Status", `<span class="lead-ace-status">${esc(statusText)}</span>`));
  const why = !busy && d && (status === "error" || status === "skipped" || status === "rejected" || (status === "drafted" && d.reason)) ? d.reason : !d && !ace.opportunityId && ace.eligible && !ace.eligible.ok ? ace.eligible.reason : "";
  if (why) rows.push(stackRow(`<p class="ap-row-sub lead-ace-message">${esc(why)}</p>`));
  const opp = ace.opportunity;
  if (ace.opportunityId) {
    const href = safeUrl(opp && opp.partnerCentralUrl);
    rows.push(row("Opportunity", href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(ace.opportunityId)}</a>` : esc(ace.opportunityId)));
  }
  if (ace.opportunityError) rows.push(stackRow(`<p class="ap-row-sub lead-ace-message">${esc(ace.opportunityError)}</p>`));
  const stage = (opp && opp.stage) || (d && d.aceStage) || "";
  if (stage) rows.push(row("ACE stage", esc(stage)));
  const sync = d && d.stageSync;
  const change = aceStageChangeText(sync);
  if (change) rows.push(row("Stage change", esc(change)));
  if (sync && sync.status === "flagged") rows.push(stackRow(`<p class="lead-ace-insight lead-ace-risk"><span class="material-symbols-outlined" aria-hidden="true">warning</span><span>${esc(sync.reason || "ACE is not moved backwards.")}</span></p>`, "", "lead-ace-insight-row"));
  const score = aceScoreText(ace.score, ace.targetScore || 60);
  if (score) rows.push(row("Quality score", `<span class="lead-ace-score">${esc(score)}</span>`));
  if (d && d.catalog) rows.push(row("Catalogue", esc(d.catalog)));
  const att = (ace.attachments || []).map((a) => { const h = safeUrl(a.url); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>` : esc(a.title); });
  if (att.length) rows.push(row(status === "awaiting-approval" || status === "drafted" ? "Attached" : "To attach", att.join(", ")));
  const recs = d && Array.isArray(d.recommendations) ? d.recommendations : [];
  if (recs.length && !(opp && opp.stage === "Closed Lost")) rows.push(stackRow(`<p class="ap-row-sub">Open recommendations</p><ul class="lead-ace-recs">${recs.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`));
  if (d && (d.pendingApprovals > 0 || status === "awaiting-approval" || (sync && sync.status === "sent"))) {
    rows.push('<a class="ap-row-btn" href="#settings/integrations" data-admin-only><span class="material-symbols-outlined" aria-hidden="true">pending_actions</span>Review the write waiting for approval</a>');
  }
  if (!busy && aceCanDraft(ace)) {
    rows.push(`<button type="button" class="ap-row-btn" id="lead-sum-ace-draft" data-admin-only><span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>${d && d.status ? "Draft again" : "Draft ACE opportunity"}</button>`);
  }
  if (!rows.length) rows.push(lineRow("Not drafted yet"));
  const aside = d && d.catalog === "Sandbox" ? '<span class="lead-test-badge">Sandbox</span>' : "";
  return group("ACE opportunity", rows.join(""), {
    id: "lead-sum-ace", aside,
    tipText: "When a lead becomes a Hot Lead and its TAM company runs on AWS, the Partner Central agent drafts the ACE opportunity with the industry one-pager and prospect pack, applies the co-sell recommendations and aims for a quality score of 60. Nothing is written to Partner Central until an admin approves it in Settings. Later stage moves are queued for Sync ACE stages.",
  });
}
