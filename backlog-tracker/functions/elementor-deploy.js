// Non-GitHub deployment targets — the pure logic for projects whose build
// output is an artifact published to WordPress through the Elementor MCP
// (first user: the PH Website project, personalisationhub.com).
//
// Everything here is side-effect free apart from the injected `callTool`
// (an async (toolName, args) => result function the caller wires to the
// Elementor MCP). With `dryRun: true` nothing is ever called for a write, so
// the whole path is testable without a WordPress site.
//
// A project's `deployTarget` is "github" (the default, and what every
// existing project is) or "elementor". A github project never reaches any of
// the Elementor code; an elementor project never shows deploy-branch / train /
// e2e / repo-synced-README UI (see usesGithub()).
"use strict";

const DEPLOY_TARGETS = ["github", "elementor"];
const ARTIFACT_KINDS = ["page", "post", "template", "media"];
const SYDNEY = "Australia/Sydney";

// The Elementor MCP tool each action maps to (offline2online-elementor).
const TOOLS = {
  create: "elementor-create-page",
  update: "elementor-publish-document",
  read: "elementor-get-page-structure",
};

function deployTargetOf(project) {
  const t = project && project.deployTarget;
  return DEPLOY_TARGETS.includes(t) ? t : "github";
}

// True when the project ships through a repo, a deploy branch and a train.
// Every GitHub-only control (deploy branch, train status, e2e, repo-synced
// README, Deploy to Main) is gated on this.
function usesGithub(project) {
  return deployTargetOf(project) === "github";
}

// ---- artifact ------------------------------------------------------------

function validateArtifact(a) {
  const problems = [];
  if (!a || typeof a !== "object") return ["artifact is missing"];
  if (!ARTIFACT_KINDS.includes(a.kind)) problems.push(`kind must be one of ${ARTIFACT_KINDS.join(", ")}`);
  if (!a.title || typeof a.title !== "string") problems.push("title is required");
  if (a.kind !== "media" && a.content == null) problems.push("content (Elementor JSON or text) is required");
  if (a.wpId != null && !Number.isInteger(a.wpId)) problems.push("wpId must be an integer when set");
  return problems;
}

// ---- pre-publish checks --------------------------------------------------

// Holds an item in Ready for Testing when its text names a client or brand
// that must never appear on the public site. Whole-word, case-insensitive.
function prePublishChecks(artifact, blockedTerms) {
  const text = [artifact && artifact.title, artifact && artifact.excerpt,
    typeof (artifact && artifact.content) === "string" ? artifact.content : JSON.stringify((artifact && artifact.content) || "")]
    .filter(Boolean).join("\n");
  const findings = [];
  for (const term of blockedTerms || []) {
    const t = String(term || "").trim();
    if (!t) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) findings.push({ check: "blocked-term", term: t });
  }
  return { ok: findings.length === 0, findings };
}

// ---- publish -------------------------------------------------------------

function planPublish(artifact, now) {
  const update = artifact.wpId != null;
  return {
    action: update ? "update" : "create",
    tool: update ? TOOLS.update : TOOLS.create,
    args: update
      ? { postId: artifact.wpId, status: "publish" }
      : { title: artifact.title, slug: artifact.slug || undefined, postType: artifact.kind === "post" ? "post" : "page", status: "publish" },
    at: now,
  };
}

// Publishes (or dry-runs) an artifact and returns the ticket fields to merge.
// `ticket.deployHistory` is append-only: the previous live version is kept in
// it (with its snapshot) so rollback() can restore it.
async function publishArtifact({ ticket, project, artifact, callTool, dryRun = false, blockedTerms = [], now = new Date().toISOString(), actor = "board" }) {
  if (usesGithub(project)) return { ok: false, error: "project deploys through GitHub, not Elementor" };
  const problems = validateArtifact(artifact);
  if (problems.length) return { ok: false, error: problems.join("; ") };
  const checks = prePublishChecks(artifact, blockedTerms);
  if (!checks.ok) {
    return { ok: false, held: true, error: "held in Ready for Testing: " + checks.findings.map((f) => `"${f.term}" found`).join(", "), log: logEntry("held", actor, now, { findings: checks.findings }) };
  }
  const plan = planPublish(artifact, now);
  const history = Array.isArray(ticket && ticket.deployHistory) ? ticket.deployHistory : [];
  const version = history.length ? Math.max(...history.map((h) => h.version || 0)) + 1 : 1;

  let snapshot = null;
  if (plan.action === "update" && !dryRun) snapshot = await callTool(TOOLS.read, { postId: artifact.wpId });
  let result = { dryRun: true, id: artifact.wpId == null ? null : artifact.wpId, url: artifact.url || null };
  if (!dryRun) result = await callTool(plan.tool, { ...plan.args, content: artifact.content });

  const entry = {
    version, at: now, by: actor, action: plan.action, dryRun: !!dryRun,
    wpId: result.id != null ? result.id : (artifact.wpId == null ? null : artifact.wpId),
    url: result.url || artifact.url || null,
    previousSnapshot: snapshot,
  };
  return {
    ok: true, dryRun: !!dryRun, plan,
    fields: dryRun ? {} : {
      publishedUrl: entry.url, wpId: entry.wpId, deployVersion: version,
      deployHistory: [...history, entry],
    },
    log: logEntry(dryRun ? "dry-run" : plan.action, actor, now, { version, wpId: entry.wpId, url: entry.url, tool: plan.tool }),
  };
}

// ---- rollback ------------------------------------------------------------

function planRollback(ticket) {
  const history = Array.isArray(ticket && ticket.deployHistory) ? ticket.deployHistory.filter((h) => !h.dryRun) : [];
  if (history.length < 1) return { ok: false, error: "nothing has been published" };
  const latest = history[history.length - 1];
  if (!latest.previousSnapshot) return { ok: false, error: "no earlier version to restore (the first publish created the item)", latest };
  return { ok: true, latest, restore: latest.previousSnapshot };
}

async function rollback({ ticket, callTool, dryRun = false, now = new Date().toISOString(), actor = "board" }) {
  const plan = planRollback(ticket);
  if (!plan.ok) return plan;
  const history = ticket.deployHistory;
  const version = Math.max(...history.map((h) => h.version || 0)) + 1;
  if (!dryRun) await callTool(TOOLS.update, { postId: plan.latest.wpId, status: "publish", content: plan.restore });
  const entry = { version, at: now, by: actor, action: "rollback", dryRun: !!dryRun, wpId: plan.latest.wpId, url: plan.latest.url, restoredFromVersion: plan.latest.version - 1 || null, previousSnapshot: null };
  return {
    ok: true, dryRun: !!dryRun,
    fields: dryRun ? {} : { deployVersion: version, deployHistory: [...history, entry] },
    log: logEntry(dryRun ? "dry-run-rollback" : "rollback", actor, now, { version, wpId: entry.wpId }),
  };
}

function logEntry(event, actor, at, detail) {
  return { event, actor, at, ...detail };
}

// ---- recurring jobs ------------------------------------------------------
// job: { id, title, weekday (0=Sun..6=Sat, local), hour, minute, jitterMinutes,
//        tz, autoPublish }. The weekly Friday blog post is
//        { weekday: 5, hour: 9, jitterMinutes: 90, tz: "Australia/Sydney", autoPublish: true }.

function zoneOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

function localToUtcMs(y, m, d, h, min, tz) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let ms = guess - zoneOffsetMs(guess, tz);
  ms = guess - zoneOffsetMs(ms, tz);
  return ms;
}

function localParts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

// Next run strictly after `from`. `rand` (0..1) picks the offset inside the
// jitter window, so the publish time "varies" around the target hour.
function nextRunAt(job, from = new Date(), rand = Math.random) {
  const tz = job.tz || SYDNEY;
  const jitter = Math.max(0, job.jitterMinutes || 0);
  const offset = Math.floor(rand() * (jitter + 1));
  const start = from.getTime();
  for (let i = 0; i < 8; i++) {
    const probe = localParts(start + i * 86400000, tz);
    if (probe.wd !== job.weekday) continue;
    const ms = localToUtcMs(probe.y, probe.m, probe.d, job.hour || 0, (job.minute || 0) + offset, tz);
    if (ms > start) return new Date(ms);
  }
  return null;
}

// The record a run creates on the board. It publishes by itself only when the
// project AND the job both allow it AND the pre-publish checks pass;
// otherwise it waits in Ready for Testing for a person.
function scheduledRunRecord(job, project, artifact, blockedTerms, runAt) {
  const checks = prePublishChecks(artifact, blockedTerms);
  const allowed = !!(project && project.autoPublish) && !!job.autoPublish;
  const publish = allowed && checks.ok;
  return {
    title: `${job.title} — ${runAt.toISOString().slice(0, 10)}`,
    source: "scheduled-job", jobId: job.id, runAt: runAt.toISOString(),
    status: publish ? "published-live" : "ready-for-testing",
    autoPublish: publish,
    hold: checks.ok ? null : { reason: "pre-publish-check", findings: checks.findings },
  };
}

module.exports = {
  DEPLOY_TARGETS, ARTIFACT_KINDS, TOOLS,
  deployTargetOf, usesGithub, validateArtifact, prePublishChecks,
  planPublish, publishArtifact, planRollback, rollback,
  nextRunAt, scheduledRunRecord,
};
