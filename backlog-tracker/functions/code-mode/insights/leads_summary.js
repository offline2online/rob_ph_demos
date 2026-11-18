// Runs inside the sandbox (see _lib.js for the rules): `run` may use only
// its three arguments.
module.exports = {
  name: "leads_summary",
  version: 1,
  description: "The Leads pipeline: how many leads are in each stage, which were updated recently, and which open leads have stalled (no update for longer than a threshold, default 14 days).",
  params: [
    { name: "stalledDays", type: "number", required: false, description: "A lead with no update for this many days counts as stalled. Default 14." },
    { name: "recentDays", type: "number", required: false, description: "\"Recently updated\" window in days. Default 7." },
    { name: "leadType", type: "string", required: false, description: "company (retail/company leads) or operator (network operator inquiries). Omit for both." },
  ],
  run: async function (tools, params, lib) {
    const now = Date.now();
    const stalledDays = params.stalledDays > 0 ? params.stalledDays : 14;
    const recentDays = params.recentDays > 0 ? params.recentDays : 7;
    const leads = [];
    for (let offset = 0, page = 0; page < 10; page += 1) {
      const r = await tools.list_leads(Object.assign({ limit: 200, offset }, params.leadType ? { leadType: params.leadType } : {}));
      leads.push(...r.leads);
      if (r.nextOffset === undefined) break;
      offset = r.nextOffset;
    }
    // Closed stages are finished, so they can't stall.
    const CLOSED = ["closed-won", "closed-lost", "approved", "not-a-fit"];
    const line = (l) => ({ id: l.id, name: lib.clip(l.name, 60), stage: l.stageLabel, assignee: l.assignee || "unassigned", lastUpdatedDaysAgo: lib.ageDays(l.updatedAt, now) });

    const byStage = {};
    for (const type of [...new Set(leads.map((l) => l.leadTypeLabel))]) {
      // list_leads returns leads in pipeline order, so stages come out in order too.
      byStage[type] = lib.countBy(leads.filter((l) => l.leadTypeLabel === type), (l) => l.stageLabel);
    }
    const recent = leads.filter((l) => lib.ms(l.updatedAt) >= now - recentDays * lib.DAY).sort((a, b) => lib.ms(b.updatedAt) - lib.ms(a.updatedAt));
    const open = leads.filter((l) => !CLOSED.includes(l.stage));
    const stalled = open.filter((l) => lib.ms(l.updatedAt) && lib.ms(l.updatedAt) < now - stalledDays * lib.DAY).sort((a, b) => lib.ms(a.updatedAt) - lib.ms(b.updatedAt));
    const recentTop = lib.top(recent.map(line), 8), stalledTop = lib.top(stalled.map(line), 10);
    return {
      insight: "leads_summary",
      generatedAt: new Date(now).toISOString(),
      total: leads.length,
      open: open.length,
      byStage,
      unassignedOpen: open.filter((l) => !l.assignee).length,
      recentlyUpdated: { withinDays: recentDays, count: recent.length, leads: recentTop.shown, more: recentTop.more },
      stalled: { olderThanDays: stalledDays, count: stalled.length, byStage: lib.countBy(stalled, (l) => l.stageLabel), leads: stalledTop.shown, more: stalledTop.more },
    };
  },
};
