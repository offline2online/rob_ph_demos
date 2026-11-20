// PH Agent Context — what each kind of record gives the index.
//
// One extractor per source: a stored document in, one index entry out (or
// null: nothing to index, remove what was there). An entry is
//   { source, id, title, text, projectId, projectIds, conceptId, status,
//     type, owner, open, archived, updatedAt, createdAt, url, access, meta }
// and index.js cuts its text into chunks, scores it and stores it.
//
// What goes in is what the record's own read tool already returns to any
// member, and LESS for people: a lead or a prospect is indexed by its
// company-level fields only (never its contacts, decision makers or org
// chart), and every email address in any text is removed (core.scrub) before
// it is indexed. A Help Centre article's pending revision is never indexed.
"use strict";

const core = require("./core");
const library = require("../documentation-library");

const OPEN_TICKET = ["backlog", "ready-for-testing", "ready-to-publish"];
const ms = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
};
const str = (v) => (typeof v === "string" ? v : "");
const lines = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === "string" && x.trim()).join("\n") : "");
const join = (...parts) => parts.map((p) => str(p).trim()).filter(Boolean).join("\n\n");
// The last few comments that read like a decision, newest first.
function decisionsIn(comments) {
  return (Array.isArray(comments) ? comments : [])
    .filter((c) => c && typeof c.text === "string" && core.DECISION.test(c.text))
    .slice(-5).reverse()
    .map((c) => ({ text: core.clip(core.scrub(c.text), 240), at: ms(c.at) || null }));
}
const commentText = (comments) => (Array.isArray(comments) ? comments : []).filter((c) => c && typeof c.text === "string" && c.text.trim()).map((c) => `Comment: ${c.text}`).join("\n\n");

// origin: the console's public origin, for deep links.
function makeSources(origin) {
  const link = (hash) => `${origin}/${hash}`;
  return {
    // Agent board tickets, every project, archived ones too.
    ticket: {
      collection: "backlogItems",
      build(id, d) {
        const status = str(d.status) || "backlog";
        const blocked = d.blocked && typeof d.blocked === "object" ? { reason: str(d.blocked.reason), note: core.clip(core.scrub(d.blocked.note), 200) } : null;
        const aidan = d.aidanImprovementKey ? { key: str(d.aidanImprovementKey), category: str(d.aidanImprovement && d.aidanImprovement.category), gap: core.clip(core.scrub(d.aidanImprovement && d.aidanImprovement.gap), 400) } : null;
        return {
          title: str(d.title) || "(untitled ticket)",
          text: join(d.desc, commentText(d.notes)),
          projectId: str(d.projectId) || null, status, type: str(d.type) || "feature",
          owner: str(d.ownerEmail).toLowerCase() || null,
          open: OPEN_TICKET.includes(status), archived: status === "archived",
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#item-${id}`),
          meta: Object.assign({ category: str(d.category) || null, comments: Array.isArray(d.notes) ? d.notes.length : 0 },
            blocked ? { blocked } : {}, aidan ? { aidan } : {}, decisionsIn(d.notes).length ? { decisions: decisionsIn(d.notes) } : {}),
        };
      },
    },
    // Staff Kanban tasks with their comments (a subcollection).
    kanban: {
      collection: "kanbanTasks",
      sub: "comments",
      build(id, d, comments) {
        const said = (comments || []).map((c) => ({ text: str(c.text) || core.stripTags(c.html), at: c.createdAt || c.at }));
        return {
          title: `${str(d.key) || id} ${str(d.title)}`.trim(),
          text: join(core.stripTags(d.description), lines(d.labels), commentText(said)),
          projectId: str(d.project) || null, status: str(d.status) || "backlog", type: str(d.type) || "task",
          owner: str(d.assignee).toLowerCase() || null,
          open: d.open !== false && d.status !== "done", archived: false,
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#staff-kanban/ticket/${encodeURIComponent(str(d.key) || id)}`),
          meta: Object.assign({ key: str(d.key) || id, priority: str(d.priority) || null, release: str(d.release) || null, resolution: str(d.resolution) || null },
            d.flagged ? { blocked: { reason: "flagged", note: core.clip(core.scrub(d.flagReason || d.flagNote), 200) } } : {},
            decisionsIn(said).length ? { decisions: decisionsIn(said) } : {}),
        };
      },
    },
    project: {
      collection: "projects",
      build(id, d) {
        return {
          title: str(d.name) || id,
          text: join(d.description, d.type, d.program),
          projectId: id, status: d.archived === true ? "archived" : "active", type: str(d.type) || null,
          open: d.archived !== true, archived: d.archived === true,
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#docs/${id}`),
          meta: { deployBranch: str(d.deployBranch) || null },
        };
      },
    },
    // A concept: description, README, Requirements, its documents and its discussion.
    concept: {
      collection: "concepts",
      build(id, d) {
        const docs = (Array.isArray(d.documents) ? d.documents : []).map((x) => `## ${str(x && x.name)}\n\n${str(x && x.contentMd)}`).join("\n\n");
        return {
          title: str(d.name) || id,
          text: join(d.description, d.readmeMd, d.requirementsMd, docs, commentText(d.comments)),
          conceptId: id, projectId: str(d.promotedProjectId) || null,
          status: str(d.status) || "active", type: str(d.type) || null,
          owner: str(d.createdByEmail).toLowerCase() || null,
          open: (str(d.status) || "active") === "active", archived: false,
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#concept-${id}`),
          meta: Object.assign({ comments: Array.isArray(d.comments) ? d.comments.length : 0 }, decisionsIn(d.comments).length ? { decisions: decisionsIn(d.comments) } : {}),
        };
      },
    },
    critique: {
      collection: "conceptCritiques",
      build(id, d) {
        if (!str(d.conceptId)) return null;
        const part = (label, list) => (lines(list) ? `${label}:\n${lines(list.map((x) => (typeof x === "string" ? x : str(x && x.text))))}` : "");
        const recs = (Array.isArray(d.recommendations) ? d.recommendations : []).map((x) => (typeof x === "string" ? x : str(x && x.text)));
        return {
          title: `Critique (${str(d.role) || "Unspecified"}): ${str(d.verdict) || "no verdict"}`,
          text: join(d.summary, part("For", d.argumentsFor || []), part("Against", d.argumentsAgainst || []), part("Assumptions challenged", d.assumptions || []), lines(recs) ? `Recommendations:\n${lines(recs)}` : ""),
          conceptId: str(d.conceptId), status: str(d.status) || "open", type: str(d.verdict) || null,
          open: (str(d.status) || "open") === "open", archived: false,
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#concept-${str(d.conceptId)}`),
          meta: { role: str(d.role) || "Unspecified", verdict: str(d.verdict) || null },
        };
      },
    },
    // Help Centre articles: the live fields only. An article that isn't
    // published is kept as "archived", the way search_faq hides it unless
    // drafts are asked for.
    faq: {
      collection: "faqArticles",
      build(id, d) {
        const status = str(d.status) || "draft";
        return {
          title: str(d.title) || id,
          text: join(d.summary, d.directAnswer, lines(d.keywords), d.bodyMd),
          status, type: str(d.docType) || null,
          open: false, archived: status !== "published",
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#faq-article/${id}`),
          meta: { slug: str(d.slug) || null, hiddenFromWebsite: d.hiddenFromWebsite === true },
        };
      },
    },
    // Support › Documentation (docArticles): the internal docs library,
    // including every page migrated from Confluence. extra: { cats } — the
    // sections (docCategories) as a Map, read by index.js, so a document is
    // found by the name of the section or folder it sits in, and a hit says
    // where it is. A document under Archive, or from an archived Confluence
    // page, is kept as "archived" (search with includeArchived to reach it).
    documentation: {
      collection: "docArticles",
      build(id, d, extra) {
        const cats = extra && extra.cats instanceof Map ? extra.cats : new Map();
        const status = str(d.status) || "draft";
        const location = library.locationOf(cats, str(d.categoryId));
        const src = library.sourceOf(d);
        const archived = status !== "published" || library.isArchived(cats, d);
        return {
          title: str(d.title) || id,
          text: join(location && `Section: ${location}`, src && src.path && `Confluence: ${src.path}`, d.summary, lines(d.keywords), library.searchableText(library.bodyMarkdown(d))),
          projectId: str(d.projectId) || null, status, type: str(d.docType) || null,
          open: false, archived,
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#doc/${id}`),
          meta: Object.assign({ slug: str(d.slug) || null, categoryId: str(d.categoryId) || null, location: location || null, needsReview: d.needsReview === true },
            src ? { origin: { system: src.system, pageId: src.pageId, space: src.space, lastUpdated: src.lastUpdated } } : {}),
        };
      },
    },
    // Leads: the company, its stage and the notes on it. No contacts.
    lead: {
      collection: "leads",
      build(id, d) {
        if (d.test === true) return null;
        const c = d.company && typeof d.company === "object" ? d.company : {};
        const name = str(c.name) || str(d.name) || str(d.company);
        if (!name) return null;
        const notes = (Array.isArray(d.history) ? d.history : []).filter((h) => h && h.kind === "note" && typeof h.text === "string").slice(-20).map((h) => `Note: ${h.text}`).join("\n\n");
        const stage = str(d.stage) || "lead";
        const closed = /^closed/.test(stage);
        return {
          title: name,
          text: join(str(c.industry) || str(d.industry), lines(c.countries || d.countries), str(c.website) || str(d.website), `Stage: ${stage}`, str(d.source) && `Source: ${d.source}`, str(d.leadType), notes),
          status: stage, type: str(d.leadType) || null,
          owner: str(d.assignee).toLowerCase() || null,
          open: !closed && d.archived !== true, archived: d.archived === true,
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#leads/${id}`),
          meta: { stage },
        };
      },
    },
    // Prospects (TAM): the company record. No contacts, decision makers or people.
    prospect: {
      collection: "prospects",
      build(id, d) {
        const name = str(d.name);
        if (!name) return null;
        return {
          title: str(d.country) ? `${name} · ${d.country}` : name,
          text: join(d.industry, d.subIndustry, d.hqCountry && `HQ: ${d.hqCountry}`, lines(d.markets), d.insights, d.notes,
            lines(d.vendors) && `Vendors: ${lines(d.vendors).replace(/\n/g, ", ")}`, lines(d.campaigns) && `Campaigns: ${lines(d.campaigns).replace(/\n/g, ", ")}`,
            d.sizeBand && `Size: ${d.sizeBand}`, Number.isFinite(d.storeCount) ? `Stores: ${d.storeCount}` : "", d.ownership, d.storePresence),
          status: str(d.status) || null, type: str(d.priority) || null,
          open: true, archived: false,
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#prospects/${id}`),
          meta: { country: str(d.country) || null, priority: str(d.priority) || null, leadId: str(d.leadId) || null },
        };
      },
    },
    // Support Inbox threads with their messages (a subcollection). Spam is not indexed.
    support: {
      collection: "supportTickets",
      sub: "messages",
      build(id, d, messages) {
        if (str(d.status) === "spam" || (d.aidan && d.aidan.spam)) return null;
        const mail = (messages || []).filter((m) => m && (m.direction === "in" || m.direction === "out" || m.direction === "note") && typeof m.text === "string")
          .sort((a, b) => ms(a.at) - ms(b.at)).slice(-30)
          .map((m) => `${m.direction === "in" ? "Received" : m.direction === "out" ? "Sent" : "Note"}: ${String(m.text).slice(0, 3000)}`).join("\n\n");
        const status = str(d.status) || "open";
        const a = d.aidan && typeof d.aidan === "object" ? d.aidan : null;
        return {
          title: `${str(d.key) || id} ${str(d.subject) || "(no subject)"}`.trim(),
          text: join(d.summary, d.category && `Category: ${d.category}`, a && a.instruction && `Instruction to Aidan: ${a.instruction}`, mail || d.snippet),
          status, type: str(d.category) || null,
          owner: str(d.assignee).toLowerCase() || null,
          open: status === "open" || status === "pending", archived: false,
          updatedAt: ms(d.lastMessageAt) || ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link(`#support/ticket/${encodeURIComponent(id)}`),
          meta: Object.assign({ key: str(d.key) || null, needsHuman: d.needsHuman === true },
            d.needsHuman === true ? { blocked: { reason: "needs-person", note: core.clip(core.scrub(a && a.reason), 200) } } : {},
            a ? { aidan: { status: str(a.status), kind: str(a.kind) } } : {}),
        };
      },
    },
    skill: {
      collection: "skills",
      build(id, d) {
        const files = (Array.isArray(d.files) ? d.files : []).map((f) => `## ${str(f && f.path)}\n\n${str(f && f.content)}`).join("\n\n");
        return {
          title: str(d.name) || str(d.slug) || id,
          text: join(d.summary, files),
          status: null, type: str(d.owningTeam) || null,
          open: false, archived: false,
          updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
          url: link("#skills"),
          meta: { slug: str(d.slug) || null, version: str(d.version) || null },
        };
      },
    },
  };
}

// Project documents come from three places, so they have three extractors
// that all make a "document" entry: a project's Requirements and README
// (projects/{id}/docs/{requirements|readme}), an additional document or a
// repo mirror (projectDocs), and an interface contract (interfaces).
function documentEntries(origin) {
  const link = (hash) => `${origin}/${hash}`;
  return {
    // id in the index: "<projectId>~requirements" / "<projectId>~readme"
    projectMd(projectId, kind, d) {
      const text = str(d && d.contentMd);
      if (!text.trim()) return null;
      return {
        id: `${projectId}~${kind}`, title: kind === "readme" ? "README" : "Requirements", text,
        projectId, status: d.sourcePath || d.sourceCommit ? "mirror" : "board", type: kind,
        open: false, archived: false, updatedAt: ms(d.updatedAt), createdAt: ms(d.createdAt) || ms(d.updatedAt),
        url: link(`#docs/${projectId}`), meta: { docId: kind, sourcePath: str(d.sourcePath) || null },
      };
    },
    projectDoc(id, d) {
      if (!str(d.projectId)) return null;
      return {
        id: `doc~${id}`, title: str(d.name) || id, text: str(d.contentMd),
        projectId: str(d.projectId), status: d.sourcePath ? "mirror" : "board", type: "document",
        open: false, archived: false, updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
        url: link(`#docs/${str(d.projectId)}`), meta: { docId: id, sourcePath: str(d.sourcePath) || null },
      };
    },
    interface(id, d) {
      const projectIds = (Array.isArray(d.projectIds) ? d.projectIds : []).filter((x) => typeof x === "string" && x);
      const conceptId = (Array.isArray(d.endpoints) ? d.endpoints : []).filter((e) => e && e.type === "concept").map((e) => str(e.id))[0] || null;
      return {
        id: `interface~${id}`, title: str(d.name) || id, text: str(d.contentMd),
        projectId: projectIds[0] || null, projectIds, conceptId, status: "interface", type: "interface",
        open: false, archived: false, updatedAt: ms(d.updatedAt) || ms(d.createdAt), createdAt: ms(d.createdAt),
        url: projectIds[0] ? link(`#docs/${projectIds[0]}?interface=${id}`) : link("#board"), meta: { docId: id },
      };
    },
  };
}

module.exports = { makeSources, documentEntries, ms, OPEN_TICKET, decisionsIn };
