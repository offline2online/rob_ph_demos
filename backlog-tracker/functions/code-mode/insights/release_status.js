// Runs inside the sandbox (see _lib.js for the rules): `run` may use only
// its three arguments.
module.exports = {
  name: "release_status",
  version: 1,
  description: "One Staff Kanban release: which projects are in it, tickets by stage, remaining effort against capacity, and what is still outstanding.",
  params: [
    { name: "releaseId", type: "string", required: false, description: "The release, by id, name or version (\"2.4\", \"release 2.4\"). Omit, or say \"current\", for the current release." },
  ],
  run: async function (tools, params, lib) {
    const board = await tools.kanban_list_people({});
    const release = lib.resolveRelease(params.releaseId, board);
    const report = await tools.kanban_release_report({ release: release.id });
    const tasks = [];
    let truncated = false;
    for (let cursor, page = 0; page < 6; page += 1) {
      const r = await tools.kanban_list_tasks(Object.assign({ release: release.id, limit: 200 }, cursor ? { cursor } : {}));
      tasks.push(...r.tasks);
      if (r.matched > r.returned) truncated = true;
      cursor = r.nextCursor;
      if (!cursor) break;
      if (page === 5) truncated = true;
    }
    const projectName = (id) => (board.projects.find((p) => p.id === id) || {}).name || id || "No project";
    const outstanding = tasks.filter((t) => t.status !== "done");
    const byProject = {};
    for (const t of tasks) {
      const name = projectName(t.project);
      const row = byProject[name] || (byProject[name] = { tickets: 0, outstanding: 0 });
      row.tickets += 1;
      if (t.status !== "done") row.outstanding += 1;
    }
    const ORDER = board.statuses;
    const list = lib.top(outstanding
      .sort((a, b) => (b.flagged - a.flagged) || ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
      .map((t) => ({ key: t.key, title: lib.clip(t.title, 80), status: t.statusLabel, project: projectName(t.project), assignee: t.assigneeName || t.assignee || "unassigned", remaining: t.remaining || undefined, flagged: t.flagged || undefined })), 12);
    return {
      insight: "release_status",
      release: { id: release.id, name: release.name, version: release.version, date: release.date, live: release.live, current: release.id === board.currentRelease },
      workingDaysLeft: report.workingDaysLeft,
      tickets: tasks.length,
      byStage: lib.countBy(tasks, (t) => t.statusLabel),
      projects: byProject,
      effort: { remaining: report.remaining, logged: report.logged, estimate: report.estimate, withoutEstimate: report.withoutEstimate, capacityPerPerson: report.capacityPerPerson },
      people: report.byPerson.filter((p) => p.outstanding > 0).map((p) => ({ name: p.name || p.assignee || "unassigned", outstanding: p.outstanding, remaining: p.remaining, overCapacity: p.overCapacity || undefined })),
      outstanding: { count: outstanding.length, flagged: outstanding.filter((t) => t.flagged).length, tickets: list.shown, more: list.more },
      ...(truncated || report.truncated ? { truncated: true } : {}),
    };
  },
};
