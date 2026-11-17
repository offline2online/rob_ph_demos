// Runs inside the sandbox (see _lib.js for the rules): `run` may use only
// its three arguments.
module.exports = {
  name: "what_changed",
  version: 1,
  description: "Everything that changed since a given time (default: the last 7 days) — tickets created, deployed, commented on or otherwise moved, grouped by project, plus concept activity.",
  params: [
    { name: "since", type: "string", required: false, description: "A date (2026-11-10), an ISO time, or a span back from now: 7d, 36h, 2w. Default 7d." },
    { name: "projectId", type: "string", required: false, description: "Only one project, by id or name." },
  ],
  run: async function (tools, params, lib) {
    const now = Date.now();
    const since = lib.sinceMs(params.since, 7, now);
    const projects = await lib.projects();
    const project = params.projectId ? await lib.resolveProject(params.projectId, projects) : null;

    // Newest-updated first, so stop paging at the first page that ends before `since`.
    const { items, truncated } = await lib.allItems(
      Object.assign({ includeArchived: true }, project ? { projectId: project.id } : {}),
      { until: (last) => lib.ms(last.updatedAt) < since, maxPages: 10 });
    const changed = items.filter((i) => lib.ms(i.updatedAt) >= since);

    // Comment times and deploy results are only on the full ticket. Read the
    // most recently changed ones that have something to look at, within a
    // fixed budget; the rest are reported from their summaries.
    const DETAIL_BUDGET = 20;
    const wantDetail = changed.filter((i) => i.comments > 0 || i.status === "published-live").slice(0, DETAIL_BUDGET);
    const details = new Map();
    await Promise.all(wantDetail.map(async (i) => {
      try { details.set(i.id, await tools.get_backlog_item({ itemId: i.id })); } catch (e) { /* deleted meanwhile */ }
    }));

    const groups = new Map();
    const group = (name) => {
      if (!groups.has(name)) groups.set(name, { project: name, created: [], deployed: [], commented: [], moved: [] });
      return groups.get(name);
    };
    const totals = { created: 0, deployed: 0, commented: 0, moved: 0 };
    for (const i of changed) {
      const g = group(i.project || "No project");
      const title = lib.clip(i.title, 80);
      const d = details.get(i.id);
      let counted = false;
      if (lib.ms(i.createdAt) >= since) { g.created.push({ id: i.id, title, stage: i.statusLabel }); totals.created += 1; counted = true; }
      if (i.status === "published-live") {
        const runs = d && d.train && Array.isArray(d.train.deployRuns) ? d.train.deployRuns : [];
        const deployedSince = !d || !runs.length || runs.some((r) => lib.ms(r.dispatchedAt) >= since);
        if (deployedSince) {
          g.deployed.push({ id: i.id, title, ...(d && d.train && d.train.deployConclusion ? { deploy: d.train.deployConclusion } : {}) });
          totals.deployed += 1; counted = true;
        }
      }
      if (d) {
        const fresh = d.notes.filter((n) => lib.ms(n.at) >= since);
        if (fresh.length) {
          const last = fresh[fresh.length - 1];
          g.commented.push({ id: i.id, title, newComments: fresh.length, latest: lib.clip(last.text, 140), by: last.author });
          totals.commented += 1; counted = true;
        }
      }
      if (!counted) { g.moved.push({ id: i.id, title, nowIn: i.statusLabel }); totals.moved += 1; }
    }

    // Concepts: the list says which changed; the full concept says how.
    const conceptList = (await tools.list_concepts({})).concepts.filter((c) => lib.ms(c.updatedAt) >= since);
    const concepts = [];
    for (const c of conceptList.slice(0, 8)) {
      let full = null;
      try { full = await tools.get_concept({ conceptId: c.id }); } catch (e) { /* removed meanwhile */ }
      const fresh = full ? full.comments.filter((x) => lib.ms(x.at) >= since) : [];
      concepts.push({
        id: c.id, name: c.name,
        ...(full && lib.ms(full.createdAt) >= since ? { created: true } : {}),
        ...(full && lib.ms(full.promotedAt) >= since ? { promotedToProject: (projects.find((p) => p.id === full.promotedProjectId) || {}).name || full.promotedProjectId } : {}),
        newComments: fresh.length,
        ...(fresh.length ? { latestComment: lib.clip(fresh[fresh.length - 1].text, 140), by: fresh[fresh.length - 1].author } : {}),
      });
    }

    const cut = (list) => { const t = lib.top(list, 6); return t.more ? { items: t.shown, more: t.more } : { items: t.shown }; };
    const byProject = [...groups.values()]
      .sort((a, b) => (b.created.length + b.deployed.length + b.commented.length + b.moved.length) - (a.created.length + a.deployed.length + a.commented.length + a.moved.length))
      .slice(0, 12)
      .map((g) => {
        const out = { project: g.project };
        for (const k of ["created", "deployed", "commented", "moved"]) if (g[k].length) out[k] = Object.assign({ count: g[k].length }, cut(g[k]));
        return out;
      });
    return {
      insight: "what_changed",
      since: new Date(since).toISOString(),
      generatedAt: new Date(now).toISOString(),
      scope: project ? project.name : "All projects",
      ticketsChanged: changed.length,
      totals,
      byProject,
      ...(groups.size > 12 ? { projectsNotShown: groups.size - 12 } : {}),
      concepts: { changed: conceptList.length, items: concepts, ...(conceptList.length > 8 ? { more: conceptList.length - 8 } : {}) },
      notes: [
        "\"moved\" means the ticket changed in this window without being created, deployed or commented on — usually a stage move or an edit; nowIn is where it is now.",
        ...(changed.filter((i) => i.comments > 0 || i.status === "published-live").length > DETAIL_BUDGET ? [`Comments and deploy results were checked on the ${DETAIL_BUDGET} most recently changed tickets only.`] : []),
        ...(truncated ? ["More tickets changed than one read covers; narrow it with projectId or a later since."] : []),
      ],
    };
  },
};
