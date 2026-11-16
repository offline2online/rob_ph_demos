"use strict";

// Agent tickets fire under their owner's own Claude account only
// (xFzQgynkoMdV33iWJFZq, 15 Nov 2026).
//
// An agent ticket can carry an owner: backlogItems/{id}.ownerEmail, the
// lowercased email of the member it belongs to. "Send to Agent" (a Staff
// Kanban ticket split into agent tickets, VlBatzRVbPt6heAEp5mu) tags every
// ticket it creates with the Kanban ticket's owner; an agent can also claim a
// ticket over MCP (create_backlog_item / update_backlog_item, ownedByMe).
// Nobody writes ownerEmail from a browser (firestore.rules lists it with the
// pipeline fields), so a person cannot tag a ticket with someone else's
// account.
//
// For an owner-tagged ticket, every Routine fire — Ready for Dev (a build),
// Deploy to Main, Groom Backlog — goes through the OWNER's personal Routine
// binding (routineBindings/{owner}) and never falls back to the shared
// project token:
//   - a person may fire only their own owner-tagged tickets; anyone else's
//     click (or an admin's send_to_build over MCP) is refused for them;
//   - the pipeline's own automatic rebuilds (a ticket sent back by a failed
//     test, a dependency that landed) fire the owner's binding too — those
//     requests are stamped notifyAutomationAt, which only the automation can
//     write;
//   - an owner with no binding gets nothing fired at all: the board disables
//     the button with a link to Settings → My Claude Routine.
// Untagged tickets keep the behaviour they always had: the clicker's own
// binding if they have one, else the shared project Routine.
//
// Pure functions only, so test/owner-firing.test.js drives them directly.

const ROUTINE_SETUP_HASH = "#settings/routine";

function normEmail(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s && s.includes("@") ? s : null;
}

function ticketOwner(item) {
  return item ? normEmail(item.ownerEmail) : null;
}

function millisOf(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" || typeof v === "number") { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; }
  if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}

// A build request is the pipeline's own (an automatic rebuild) only when
// run-backlog-automation.js stamped notifyAutomationAt with the very same
// instant as notifyRequestedAt. A person's later click writes a new
// notifyRequestedAt (a server timestamp), which never matches the stale stamp,
// and firestore.rules keeps notifyAutomationAt out of every browser's reach.
function isAutomaticBuildRequest(project) {
  if (!project) return false;
  const a = millisOf(project.notifyAutomationAt);
  return a > 0 && a === millisOf(project.notifyRequestedAt);
}

function ownerRefusalMessage(reason, owner) {
  if (reason === "not-owner") return `Only ${owner} can start this agent ticket: it runs under its owner's own Claude account.`;
  if (reason === "no-binding") return `Not started: ${owner} has no personal Claude Routine yet, and an agent ticket never runs on the shared project token. Set one up in Settings → My Claude Routine.`;
  return `Not started (${reason}).`;
}

// Ready for Dev. `named(id)` says whether the click named the ticket
// explicitly (notifyItemIds); a ticket the click only swept up with "the whole
// column" is skipped quietly rather than marked refused.
//   shared   — untagged tickets, fired as before
//   byOwner  — { ownerEmail: [items] } to fire through that owner's binding
//   refused  — [{ item, owner, reason, message }] to record on the card
//   skipped  — tickets left alone without a mark
function planOwnedBuild(items, { requesterEmail = null, automatic = false, named = () => false } = {}) {
  const requester = normEmail(requesterEmail);
  const out = { shared: [], byOwner: {}, refused: [], skipped: [] };
  for (const item of items || []) {
    const owner = ticketOwner(item);
    if (!owner) { out.shared.push(item); continue; }
    if (automatic || (requester && requester === owner)) {
      (out.byOwner[owner] = out.byOwner[owner] || []).push(item);
      continue;
    }
    if (named(item.id)) out.refused.push({ item, owner, reason: "not-owner", message: ownerRefusalMessage("not-owner", owner) });
    else out.skipped.push(item);
  }
  return out;
}

// After the binding lookup: an owner group whose owner has no usable binding
// is refused whole. `hasBinding(owner)` is the lookup's result.
function refuseUnboundOwners(plan, hasBinding) {
  const byOwner = {};
  const refused = plan.refused.slice();
  for (const [owner, list] of Object.entries(plan.byOwner)) {
    if (hasBinding(owner)) byOwner[owner] = list;
    else for (const item of list) refused.push({ item, owner, reason: "no-binding", message: ownerRefusalMessage("no-binding", owner) });
  }
  return { ...plan, byOwner, refused };
}

// The card's record of a refused fire, in lastFire's shape. Status "refused"
// is never retried by the automation's fire sweep (it looks for "retrying").
function refusedFireRecord({ reason, message, prior = {}, requestedAt = null, requestedByEmail = null, now = Date.now() }) {
  return {
    at: new Date(now), requestedAt: requestedAt || null, requestedByEmail: requestedByEmail || null,
    status: "refused", reason, sessionId: null, sessionUrl: null, error: message,
    attempts: prior.attempts || 0, deferrals: prior.deferrals || 0, nextAttemptAt: null,
  };
}

// Deploy to Main merges the whole train in one session, so it runs under one
// account. A train carrying owner-tagged tickets deploys only when the person
// clicking owns every one of them, through their own binding; a train mixing
// two owners' tickets can't be deployed by either alone.
function planOwnedDeploy(items, { requesterEmail = null } = {}) {
  const owners = [...new Set((items || []).map(ticketOwner).filter(Boolean))];
  if (!owners.length) return { mode: "shared" };
  const requester = normEmail(requesterEmail);
  if (owners.length > 1) {
    return { mode: "refused", owners, message: `Not deployed: this train carries agent tickets owned by ${owners.length} different people (${owners.join(", ")}), and each runs only under its owner's own Claude account. Send one owner's tickets back with Failed testing, or deploy them in separate releases.` };
  }
  const [owner] = owners;
  if (!requester || requester !== owner) {
    return { mode: "refused", owners, message: `Only ${owner} can deploy this train: it carries their agent tickets, which run only under their own Claude account.` };
  }
  return { mode: "owner", owner };
}

// Groom Backlog: another member's agent tickets are left out of the session
// (it would otherwise read and rewrite them under the wrong account); the
// clicker's own come along, and then the session runs under their binding.
function planOwnedGroom(items, { requesterEmail = null } = {}) {
  const requester = normEmail(requesterEmail);
  const keep = [];
  const excluded = [];
  for (const item of items || []) {
    const owner = ticketOwner(item);
    if (!owner || (requester && owner === requester)) keep.push(item);
    else excluded.push(item);
  }
  return { keep, excluded, ownOwned: keep.filter((i) => !!ticketOwner(i)) };
}

// Owner scoping over MCP (ZmEWDC40NYOiojehfPjk, 16 Nov 2026): every member's
// agent reads the whole project (every ticket, its docs and interface
// contracts) so it understands cross-cutting impact, but changes only the
// agent tickets its own member owns. null when `email` may change `item`,
// else the refusal shown to the agent. An untagged ticket stays open to every
// editor, as before; an admin's agent is refused like anyone else's (each
// agent is one owner's session; an admin releases a ticket with ownedByMe
// false, which the caller allows separately). Commenting is never refused:
// add_item_comment is how one owner tells another about an impact.
function ownerEditRefusal(item, email, verb = "change") {
  const owner = ticketOwner(item);
  if (!owner) return null;
  if (normEmail(email) === owner) return null;
  return `This is ${owner}'s agent ticket: only ${owner}'s own agent can ${verb} it. You can still read it in full, and add_item_comment to tell its owner about an impact on their work.`;
}

module.exports = {
  ownerEditRefusal,
  ROUTINE_SETUP_HASH, normEmail, ticketOwner, millisOf, isAutomaticBuildRequest, ownerRefusalMessage,
  planOwnedBuild, refuseUnboundOwners, refusedFireRecord, planOwnedDeploy, planOwnedGroom,
};
