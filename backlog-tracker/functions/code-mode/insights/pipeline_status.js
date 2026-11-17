// Runs inside the sandbox (see _lib.js for the rules): `run` may use only
// its three arguments.
module.exports = {
  name: "pipeline_status",
  version: 1,
  description: "The agent board at a glance: tickets per stage, what is blocked, what is waiting for a person's approval, and the oldest ticket in each stage.",
  params: [
    { name: "projectId", type: "string", required: false, description: "One project, by id or name. Omit for the whole board." },
  ],
  run: async function (tools, params, lib) {
    const now = Date.now();
    const projects = await lib.projects();
    const project = params.projectId ? await lib.resolveProject(params.projectId, projects) : null;
    const scope = project ? { projectId: project.id } : {};
    const [{ items, truncated }, health] = await Promise.all([lib.allItems(scope), tools.get_pipeline_health(scope)]);

    const line = (i) => ({ id: i.id, title: lib.clip(i.title, 80), project: i.project });
    const byStage = {};
    const oldest = {};
    for (const [key, label] of lib.STAGES) {
      const inStage = items.filter((i) => i.status === key);
      byStage[label] = inStage.length;
      const first = inStage.slice().sort((a, b) => lib.ms(a.updatedAt) - lib.ms(b.updatedAt))[0];
      if (first) oldest[label] = Object.assign(line(first), { lastChangedDaysAgo: lib.ageDays(first.updatedAt, now) });
    }
    const blocked = items.filter((i) => i.blocked)
      .sort((a, b) => lib.ms(a.blocked.setAt) - lib.ms(b.blocked.setAt))
      .map((i) => Object.assign(line(i), { reason: i.blocked.reason, note: lib.clip(i.blocked.note, 120) || undefined, blockedDays: lib.ageDays(i.blocked.setAt, now) }));
    const awaitingTest = items.filter((i) => i.status === "ready-for-testing")
      .sort((a, b) => lib.ms(a.updatedAt) - lib.ms(b.updatedAt))
      .map((i) => Object.assign(line(i), { waitingDays: lib.ageDays(i.updatedAt, now), waitingOn: i.waitingOn || undefined }));
    const awaitingDeploy = items.filter((i) => i.status === "ready-to-publish");
    const attention = (health.needsAttention || []).map((e) => ({ id: e.id, title: lib.clip(e.title, 80), project: e.project, line: lib.clip(e.line, 140), waitingOn: e.waitingOn, ageHours: e.ageHours, overdue: e.overdue || undefined }));

    const blockedTop = lib.top(blocked, 8), testTop = lib.top(awaitingTest, 8), attnTop = lib.top(attention, 8);
    return {
      insight: "pipeline_status",
      scope: project ? project.name : "All projects",
      generatedAt: new Date(now).toISOString(),
      openTickets: items.length,
      byStage,
      blocked: { count: blocked.length, items: blockedTop.shown, more: blockedTop.more },
      awaitingApproval: {
        // Ready for Testing waits for a tester's approval; Approved for
        // Deployment waits for the Deploy to Main click.
        readyForTesting: { count: awaitingTest.length, items: testTop.shown, more: testTop.more },
        approvedAwaitingDeploy: awaitingDeploy.length,
      },
      oldestPerStage: oldest,
      trains: (health.trains || []).slice(0, 8).map((t) => ({ project: t.project, line: lib.clip(t.line, 160), stuck: t.stuckReason || undefined })),
      needsAttention: { count: attention.length, items: attnTop.shown, more: attnTop.more },
      ...(truncated || health.truncated ? { truncated: true, note: "The board has more tickets than one read covers; pass projectId for exact numbers." } : {}),
    };
  },
};
