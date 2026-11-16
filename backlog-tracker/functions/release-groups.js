// Release groups — projects that ship in one deployable share one train.
//
// A project on the board and a deployable are usually the same thing: one
// project, one integration branch (projects/{id}.deployBranch), one train,
// one PR. Staff Kanban and Backlog Tracker & FAQs broke that rule: two
// projects, one deployable (the console — same Hosting site, same
// deploy-backlog-tracker.yml, same version.js, same test suites). On two
// trains they were tested apart and met for the first time on main.
//
// A release group joins such projects' trains and nothing else:
//
//   releaseGroups/{id}: { name, deployBranch, projectIds[], createdAt }
//   projects/{id}.releaseGroupId → the group (written with the group)
//
// Each member keeps its own Backlog, columns, docs, archive and owner. The
// train — the branch, the lock, the tests, Deploy to Main, the PR, the
// version bump — is the group's. A project with no group behaves exactly as
// before: every helper here returns the single-project answer for it.
//
// Plain data in, plain answers out, no SDK — required by
// scripts/run-backlog-automation.js, functions/index.js and
// functions/mcp-server.js, and unit-tested by test/release-groups.test.js.
// public/js/release-groups.js is the browser's copy of the board-facing half
// (that test checks the two agree).
"use strict";

const ON_TRAIN_STATUSES = new Set(["ready-for-testing", "ready-to-publish"]);

function asArray(v) { return Array.isArray(v) ? v : []; }

// The group a project belongs to, or null. `groups` is an array or a map of
// id → group. A group that does not list the project back (a half-finished
// edit) does not count: membership needs both pointers.
function groupOf(project, groups) {
  if (!project || !project.releaseGroupId) return null;
  const gid = project.releaseGroupId;
  let group = null;
  if (groups instanceof Map) group = groups.get(gid) || null;
  else if (Array.isArray(groups)) group = groups.find((g) => g && g.id === gid) || null;
  else if (groups && typeof groups === "object") group = groups[gid] ? { id: gid, ...groups[gid] } : null;
  if (!group || !asArray(group.projectIds).includes(project.id)) return null;
  if (typeof group.deployBranch !== "string" || !group.deployBranch) return null;
  return group;
}

// The project as the train sees it: deployBranch is the group's, the
// project's own branch is kept as ownDeployBranch (what it goes back to when
// it leaves the group), and trainProjectIds lists every project whose
// tickets ride the same train (just itself without a group).
function withReleaseGroup(project, groups) {
  if (!project) return project;
  const group = groupOf(project, groups);
  if (!group) return { ...project, releaseGroup: null, trainProjectIds: [project.id] };
  return {
    ...project,
    // Idempotent: a project already read through its group keeps its own branch.
    ownDeployBranch: Object.prototype.hasOwnProperty.call(project, "ownDeployBranch") ? project.ownDeployBranch : (project.deployBranch || null),
    deployBranch: group.deployBranch,
    releaseGroup: { id: group.id, name: group.name || group.id, deployBranch: group.deployBranch, projectIds: asArray(group.projectIds).slice() },
    trainProjectIds: asArray(group.projectIds).slice(),
  };
}

function trainProjectIdsOf(project) {
  if (!project) return [];
  if (Array.isArray(project.trainProjectIds) && project.trainProjectIds.length) return project.trainProjectIds.slice();
  if (project.releaseGroup && Array.isArray(project.releaseGroup.projectIds)) return project.releaseGroup.projectIds.slice();
  return [project.id];
}

// One key per train: the group's id, or the project's own. Used to process a
// shared train once per run however many member projects carry the flag.
function trainKeyOf(project) {
  if (!project) return null;
  return project.releaseGroup ? `group:${project.releaseGroup.id}` : `project:${project.id}`;
}

function isOnTrain(item) {
  return !!(item && item.deployCommit && ON_TRAIN_STATUSES.has(item.status));
}

// Whether Deploy to Main may be offered (and processDeployTrain may merge)
// for a project's train. With a group, every member project counts: each
// ticket on the shared train must be approved and no member may have one in
// Ready for Testing. `items` is every backlogItems doc in the train's
// projects; `projectsById` names them. The reason names what holds it, by
// project, so the other project's header can say "Waiting for Staff Kanban:
// <title> is in Ready for Testing".
function trainReadiness(project, items, projectsById = {}) {
  const ids = new Set(trainProjectIdsOf(project));
  const mine = asArray(items).filter((i) => i && ids.has(i.projectId));
  const onTrain = mine.filter(isOnTrain);
  const testing = onTrain.filter((i) => i.status === "ready-for-testing");
  const reverting = mine.filter((i) => i.revertRequested && i.deployCommit);
  const nameOf = (pid) => (projectsById[pid] && projectsById[pid].name) || pid;
  const blockers = testing.concat(reverting.filter((r) => !testing.includes(r))).map((i) => ({
    id: i.id, title: i.title || i.id, projectId: i.projectId, projectName: nameOf(i.projectId),
    otherProject: i.projectId !== project.id,
    why: i.revertRequested && i.deployCommit && i.status !== "ready-for-testing" ? "is still coming off the train" : "is in Ready for Testing",
  }));
  const ready = onTrain.length > 0 && !blockers.length;
  return { ready, onTrain, testing, reverting, blockers, heldByOtherProject: blockers.length > 0 && blockers.every((b) => b.otherProject), reason: holdReason(blockers) };
}

// "Waiting for Staff Kanban: Fix the filter is in Ready for Testing" — only
// the blockers in another project are named this way (a project's own
// Ready for Testing cards are in plain sight on its own board).
function holdReason(blockers) {
  const others = asArray(blockers).filter((b) => b.otherProject);
  if (!others.length) return null;
  const byProject = new Map();
  for (const b of others) {
    if (!byProject.has(b.projectName)) byProject.set(b.projectName, []);
    byProject.get(b.projectName).push(b);
  }
  return [...byProject.entries()].map(([name, list]) => {
    const shown = list.slice(0, 3).map((b) => `${b.title} ${b.why}`);
    const more = list.length > 3 ? `, and ${list.length - 3} more` : "";
    return `Waiting for ${name}: ${shown.join("; ")}${more}`;
  }).join(". ");
}

// "Ships with Staff Kanban · PH Agent Console"
function shipsWithLine(project, projectsById = {}) {
  const g = project && project.releaseGroup;
  if (!g) return null;
  const others = asArray(g.projectIds).filter((id) => id !== project.id).map((id) => (projectsById[id] && projectsById[id].name) || id);
  if (!others.length) return null;
  return `Ships with ${others.join(", ")} · ${g.name}`;
}

// The shared train's PR. A single project keeps today's title exactly.
function trainPrTitle(project, count) {
  const name = project && project.releaseGroup ? project.releaseGroup.name : (project && project.name);
  return `Deploy ${name} — ${count} ticket${count === 1 ? "" : "s"}`;
}

function trainPrBody(project, onTrain, projectsById = {}, deployBranch) {
  const branch = deployBranch || (project && project.deployBranch);
  const line = (i) => `- ${i.title || i.desc || i.id}\n  Backlog item: ${i.id}`;
  const items = asArray(onTrain);
  if (!project || !project.releaseGroup) {
    return `Deployment train for **${project && project.name}** — ${items.length} ticket(s) built on top of each other on \`${branch}\` and tested together.\n\n` +
      items.map(line).join("\n") +
      `\n\nOpened by the backlog automation. Merging this ships every ticket listed above.`;
  }
  const g = project.releaseGroup;
  const sections = asArray(g.projectIds).map((pid) => {
    const mine = items.filter((i) => i.projectId === pid);
    if (!mine.length) return null;
    return `### ${(projectsById[pid] && projectsById[pid].name) || pid}\n\n${mine.map(line).join("\n")}`;
  }).filter(Boolean);
  return `Deployment train for the release group **${g.name}** — ${items.length} ticket(s) from ${sections.length} project(s) built on top of each other on \`${branch}\` and tested together.\n\n` +
    sections.join("\n\n") +
    `\n\nOpened by the backlog automation. Merging this ships every ticket listed above, in every project of the group.`;
}

// A group edit (create, add a project, remove a project) moves tickets
// between branches if a train has anything on it, so it is refused then.
// `trainsInUse`: [{ label, count }] for the group's train and each affected
// project's own train. Returns the refusal text, or null when it may go on.
function groupEditRefusal(trainsInUse) {
  const busy = asArray(trainsInUse).filter((t) => t && Number(t.count) > 0);
  if (!busy.length) return null;
  return `Not changed: ${busy.map((t) => `${t.label} has ${t.count} ticket${Number(t.count) === 1 ? "" : "s"} on it`).join("; ")}. ` +
    "A release group can only be changed while the trains involved are empty — ship or send back those tickets first.";
}

// How many tickets occupy a branch's train (on it, or still coming off it).
function trainLoad(items, projectIds) {
  const ids = new Set(asArray(projectIds));
  return asArray(items).filter((i) => i && ids.has(i.projectId) &&
    ((i.deployCommit && ON_TRAIN_STATUSES.has(i.status)) || (i.revertRequested && i.deployCommit))).length;
}

// settings/deployQueue without the entries a project's group-mates left: a
// release group deploys as one train from any member, so its own earlier
// entry must never hold it ("Queued behind Staff Kanban's deploy" for the
// same train). A project with no group gets the queue back unchanged.
function withoutGroupMates(queue, project) {
  const mates = new Set(trainProjectIdsOf(project).filter((id) => id !== (project && project.id)));
  if (!queue || !mates.size) return queue;
  return { ...queue, entries: asArray(queue.entries).filter((e) => !(e && mates.has(e.projectId))) };
}

function isValidGroupBranch(v) {
  return typeof v === "string" && v.length <= 100 && /^deploy\/[a-z0-9][a-z0-9-]*$/.test(v);
}

module.exports = {
  groupOf,
  withReleaseGroup,
  trainProjectIdsOf,
  trainKeyOf,
  trainReadiness,
  holdReason,
  shipsWithLine,
  trainPrTitle,
  trainPrBody,
  groupEditRefusal,
  trainLoad,
  isValidGroupBranch,
  withoutGroupMates,
};
