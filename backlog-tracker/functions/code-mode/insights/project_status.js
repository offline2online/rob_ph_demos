// Runs inside the sandbox (see _lib.js for the rules): `run` may use only
// its three arguments.
module.exports = {
  name: "project_status",
  version: 1,
  description: "One project: open tickets by stage, blockers, its deployment train and release group, the last deployment, and its open Staff Kanban tickets.",
  params: [
    { name: "projectId", type: "string", required: true, description: "The project, by id or name." },
  ],
  run: async function (tools, params, lib) {
    const now = Date.now();
    const project = await lib.resolveProject(params.projectId);
    const [{ items, truncated }, health, kanban] = await Promise.all([
      lib.allItems({ projectId: project.id }),
      tools.get_pipeline_health({ projectId: project.id }),
      // A project nobody has filed Kanban tickets against is not an error.
      tools.kanban_list_tasks({ project: project.id, limit: 200 }).catch((e) => ({ unavailable: lib.clip(e.message, 160) })),
    ]);

    const line = (i) => ({ id: i.id, title: lib.clip(i.title, 80) });
    const byStage = {};
    for (const [key, label] of lib.STAGES) byStage[label] = items.filter((i) => i.status === key).length;
    const open = items.filter((i) => i.status !== "published-live");
    const blockers = items.filter((i) => i.blocked)
      .map((i) => Object.assign(line(i), { stage: i.statusLabel, reason: i.blocked.reason, note: lib.clip(i.blocked.note, 120) || undefined, blockedDays: lib.ageDays(i.blocked.setAt, now) }));

    // Last deployment: the most recently changed Deployed (Live) ticket, and
    // what its deploy actually concluded (merged is not the same as live).
    const live = items.filter((i) => i.status === "published-live").sort((a, b) => lib.ms(b.updatedAt) - lib.ms(a.updatedAt))[0];
    let lastDeployment = null;
    if (live) {
      const d = await tools.get_backlog_item({ itemId: live.id });
      lastDeployment = {
        ticket: line(live), at: live.updatedAt, daysAgo: lib.ageDays(live.updatedAt, now),
        version: d.testVersion || undefined, pr: d.train.prNumber || undefined, deploy: d.train.deployConclusion || undefined,
      };
    }

    const train = (health.trains || [])[0];
    const attention = lib.top((health.needsAttention || []).map((e) => ({ id: e.id, title: lib.clip(e.title, 80), line: lib.clip(e.line, 140), waitingOn: e.waitingOn, ageHours: e.ageHours })), 6);
    const blockersTop = lib.top(blockers, 8);

    let kanbanOut;
    if (kanban.unavailable) kanbanOut = { unavailable: kanban.unavailable };
    else {
      const tasks = kanban.tasks.filter((t) => t.status !== "done");
      const t = lib.top(tasks.map((x) => ({ key: x.key, title: lib.clip(x.title, 80), status: x.statusLabel, assignee: x.assigneeName || x.assignee || "unassigned", release: x.release || undefined, flagged: x.flagged || undefined })), 8);
      kanbanOut = { open: tasks.length, byStatus: lib.countBy(tasks, (x) => x.statusLabel), releases: [...new Set(tasks.map((x) => x.release).filter(Boolean))], tasks: t.shown, more: t.more, ...(kanban.truncated ? { truncated: true } : {}) };
    }

    return {
      insight: "project_status",
      project: { id: project.id, name: project.name, description: lib.clip(project.description, 200) || null, type: project.type, program: project.program, archived: project.archived || undefined, finalised: project.finalised ? true : undefined },
      generatedAt: new Date(now).toISOString(),
      openTickets: open.length,
      byStage,
      blockers: { count: blockers.length, items: blockersTop.shown, more: blockersTop.more },
      release: {
        // Projects in one release group ship together on one train.
        releaseGroup: project.releaseGroup ? project.releaseGroup.name : null,
        deployBranch: project.deployBranch,
        trainLocked: project.trainLocked,
        train: train ? lib.clip(train.line, 160) : "Nothing on the train.",
        ...(train && train.stuckReason ? { stuck: train.stuckReason } : {}),
      },
      lastDeployment,
      needsAttention: { count: (health.needsAttention || []).length, items: attention.shown, more: attention.more },
      kanban: kanbanOut,
      artifactUrl: project.artifactUrl || null,
      ...(truncated ? { truncated: true } : {}),
    };
  },
};
