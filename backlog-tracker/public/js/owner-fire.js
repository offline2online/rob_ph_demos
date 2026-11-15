// Agent tickets fire under their owner's own Claude account only
// (xFzQgynkoMdV33iWJFZq). The browser half of functions/owner-firing.js: it
// decides which buttons a viewer may use, the server decides what actually
// fires (and refuses anything this gets wrong). Pure functions, no DOM, so
// test/owner-fire.test.mjs drives them.
//
// backlogItems/{id}.ownerEmail tags a ticket as an agent ticket owned by that
// member. Its Ready for Dev / Deploy to Main / Groom Backlog fire only through
// the owner's personal Routine binding, and only on the owner's own click.

export const ROUTINE_SETUP_HASH = "#settings/routine";

export function normEmail(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s && s.includes("@") ? s : "";
}

export function ticketOwner(item) {
  return item ? normEmail(item.ownerEmail) : "";
}

// viewer: { email, hasBinding } (hasBinding null while unknown).
// null when the viewer may start this ticket, else { reason, message }.
export function ownerFireBlock(item, viewer = {}) {
  const owner = ticketOwner(item);
  if (!owner) return null;
  const me = normEmail(viewer.email);
  if (me !== owner) {
    return { reason: "not-owner", owner, message: `Agent ticket owned by ${owner}. It runs only under their own Claude account, so only they can start it.` };
  }
  if (viewer.hasBinding !== true) {
    return { reason: "no-binding", owner, message: "This agent ticket runs only under your own Claude account, and you haven't set up your personal Claude Routine yet. Set it up in Settings → My Claude Routine." };
  }
  return null;
}

// Deploy to Main merges the whole train in one session under one account.
export function deployOwnerBlock(trainItems, viewer = {}) {
  const owners = [...new Set((trainItems || []).map(ticketOwner).filter(Boolean))];
  if (!owners.length) return null;
  const me = normEmail(viewer.email);
  if (owners.length > 1) {
    return { reason: "mixed-owners", owners, message: `This train carries agent tickets owned by ${owners.length} people (${owners.join(", ")}). Each runs only under its owner's own Claude account, so no one person can deploy them together.` };
  }
  if (me !== owners[0]) {
    return { reason: "not-owner", owners, message: `This train carries ${owners[0]}'s agent tickets, which run only under their own Claude account. Only they can deploy it.` };
  }
  if (viewer.hasBinding !== true) {
    return { reason: "no-binding", owners, message: "This train carries your agent tickets, which run only under your own Claude account. Set up your personal Claude Routine in Settings → My Claude Routine to deploy it." };
  }
  return null;
}

// Groom Backlog leaves out tickets the viewer may not start; the button is
// disabled only when that leaves nothing at all.
export function groomOwnerBlock(groomable, viewer = {}) {
  const list = groomable || [];
  if (!list.length) return null;
  const blocked = list.map((i) => ownerFireBlock(i, viewer)).filter(Boolean);
  if (blocked.length < list.length) return null;
  const noBinding = blocked.some((b) => b.reason === "no-binding");
  return {
    reason: noBinding ? "no-binding" : "not-owner",
    message: noBinding
      ? "Every ticket here is an agent ticket that runs only under its owner's own Claude account, and you haven't set up your personal Claude Routine yet. Set it up in Settings → My Claude Routine."
      : "Every ticket here is another member's agent ticket, which only its owner can groom.",
  };
}
