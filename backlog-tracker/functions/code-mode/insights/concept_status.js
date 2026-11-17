// Runs inside the sandbox (see _lib.js for the rules): `run` may use only
// its three arguments.
module.exports = {
  name: "concept_status",
  version: 1,
  description: "One concept from the Concept Incubator: what it is, whether it has a README and Requirements, the latest decisions from its discussion, its interfaces, its artifact link, and the project it was promoted to, if any.",
  params: [
    { name: "conceptId", type: "string", required: true, description: "The concept, by id or name." },
  ],
  run: async function (tools, params, lib) {
    const [projects, list] = await Promise.all([lib.projects(), tools.list_concepts({})]);
    const hit = lib.pick(list.concepts, params.conceptId, "concept", (x) => [x.name]);
    const nameOf = (e) => ((e.type === "concept" ? list.concepts : projects).find((x) => x.id === e.id) || {}).name || e.id;
    const c = await tools.get_concept({ conceptId: hit.id });
    const words = (md) => (String(md || "").trim() ? String(md).trim().split(/\s+/).length : 0);

    // The discussion has no "decision" field. A comment that reads like one
    // (decided, agreed, we'll go with, approved, ruled out …) is reported as
    // a decision; the last few comments are given as they are either way.
    const DECISION = /\b(decid\w*|decision|agreed?|we(?:'| wi)ll go with|go(?:ing)? with|approved?|sign(?:ed)? off|settled|ruled out|won't|will not|confirmed)\b/i;
    const comments = c.comments.slice().sort((a, b) => lib.ms(a.at) - lib.ms(b.at));
    const say = (x) => ({ at: x.at, by: x.author, text: lib.clip(x.text, 240) });
    const decisions = comments.filter((x) => DECISION.test(x.text)).slice(-5).reverse().map(say);
    const latest = comments.slice(-3).reverse().map(say);

    let promoted = null;
    if (c.promotedProjectId) {
      const p = projects.find((x) => x.id === c.promotedProjectId);
      promoted = { projectId: c.promotedProjectId, name: p ? p.name : null, at: c.promotedAt };
    }
    return {
      insight: "concept_status",
      concept: { id: c.id, name: c.name, type: c.type, status: c.status, createdBy: c.createdByEmail, updatedAt: c.updatedAt },
      description: lib.clip(c.description, 400) || null,
      readme: { present: words(c.readmeMd) > 0, words: words(c.readmeMd) },
      requirements: { present: words(c.requirementsMd) > 0, words: words(c.requirementsMd) },
      otherDocuments: c.documents.map((d) => d.name),
      discussion: { comments: comments.length, latestDecisions: decisions, latestComments: latest },
      interfaces: c.interfaces.map((i) => ({ id: i.id, name: i.name, with: (i.endpoints || []).filter((e) => e && e.id !== c.id).map(nameOf) })),
      artifactUrl: c.artifactUrl || null,
      docsUrl: c.docsUrl,
      promotedTo: promoted,
    };
  },
};
