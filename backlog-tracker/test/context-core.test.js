// PH Agent Context — the pure rules (functions/context/core.js and
// sources.js): tokens, the keyword score, the vectors, the hybrid score with
// its recency boost, filters, chunks, snippets, cache keys (which carry the
// caller's role) and what each source gives the index. No stubs, no network.
//   node context-core.test.js
"use strict";
const assert = require("assert");
const core = require("../functions/context/core.js");
const { makeSources, documentEntries } = require("../functions/context/sources.js");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); } catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}
const DAY = 86400000;
const NOW = Date.parse("2026-11-19T12:00:00Z");

// A tiny corpus, scored the way the index scores it.
function corpus(docs) {
  const rows = docs.map((d) => { const tokens = core.tokenize(d.text); const title = core.tokenize(d.title || ""); const tf = core.termFreq(tokens); for (const t of title) tf.set(t, (tf.get(t) || 0) + core.TITLE_WEIGHT); return Object.assign({}, d, { tf, len: tokens.length + title.length * core.TITLE_WEIGHT, vec: core.localVector(`${d.title || ""} ${d.text}`) }); });
  const df = new Map();
  for (const r of rows) for (const t of r.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const stats = { n: rows.length, avgLen: rows.reduce((n, r) => n + r.len, 0) / rows.length, df };
  return (query) => {
    const q = [...new Set(core.tokenize(query))];
    const qv = core.localVector(query);
    return rows.map((r) => ({ id: r.id, score: core.hybrid({ keyword: core.bm25(q, r.tf, r.len, stats), vector: core.cosine(qv, r.vec), updatedAt: r.updatedAt || 0, now: NOW }) }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  };
}

check("tokens: lower case, filler words dropped, word families folded together", () => {
  assert.deepStrictEqual(core.tokenize("The Deploys were deployed and deploying"), ["deploy", "deploy", "deploy"]);
  assert.deepStrictEqual(core.tokenize("PH-36: categories & policies"), ["ph", "36", "category", "policy"]);
  assert.deepStrictEqual(core.tokenize("Größe der Märkte"), ["größe", "der", "märkte"], "letters outside ASCII are kept");
  assert.deepStrictEqual(core.tokenize(""), []);
});

check("keyword score: a rarer word counts for more, a title match beats a body match, a longer text is not favoured", () => {
  const search = corpus([
    { id: "title", title: "Slot booking window", text: "How long a slot stays bookable." },
    { id: "body", title: "Exchange settings", text: "The booking screen has a slot per window. Booking is common. Booking again." },
    { id: "common", title: "Campaign status", text: "A table of campaign states for the exchange and its settings and everything else there is to say about campaigns." },
    { id: "other", title: "Advertiser list", text: "Inventory of advertisers." },
  ]);
  const hits = search("slot booking window");
  assert.deepStrictEqual(hits.map((h) => h.id).slice(0, 2), ["title", "body"], "the title match ranks first");
  assert.ok(!hits.find((h) => h.id === "other"), "a record with no word in common and no near vector is not a hit");
  assert.strictEqual(search("zebra").length, 0, "an unknown word matches nothing");
});

check("the local vector brings near-spellings together, and unrelated text stays apart", () => {
  const sim = (a, b) => core.cosine(core.localVector(a), core.localVector(b));
  assert.ok(sim("personalisation attributes", "personalised attribute") > 0.5);
  assert.ok(sim("personalisation attributes", "quarterly invoice export") < 0.2);
  assert.ok(Math.abs(sim("slot booking", "slot booking") - 1) < 1e-5, "unit length: a text is at distance 0 from itself");
  // With no word in common, a close vector alone is a hit; a far one is not.
  assert.ok(core.hybrid({ keyword: 0, vector: 0.5, updatedAt: NOW, now: NOW }) > 0);
  assert.strictEqual(core.hybrid({ keyword: 0, vector: 0.2, updatedAt: NOW, now: NOW }), 0);
  assert.strictEqual(core.hybrid({ keyword: 0, vector: 0.5, kind: "semantic", updatedAt: NOW, now: NOW }), 0, "a semantic vector needs to be closer than a local one");
});

check("hybrid ranking: keyword and vector both count, and a newer record ranks above an older twin", () => {
  const both = core.hybrid({ keyword: 4, vector: 0.8, updatedAt: 0, now: NOW });
  assert.ok(both > core.hybrid({ keyword: 4, vector: 0.1, updatedAt: 0, now: NOW }), "the vector adds to the keyword score");
  assert.ok(both > core.hybrid({ keyword: 1, vector: 0.8, updatedAt: 0, now: NOW }), "the keyword score adds to the vector");
  const search = corpus([
    { id: "old", title: "Rate limits", text: "Partner API rate limits.", updatedAt: NOW - 400 * DAY },
    { id: "new", title: "Rate limits", text: "Partner API rate limits.", updatedAt: NOW - 1 * DAY },
  ]);
  assert.deepStrictEqual(search("rate limits").map((h) => h.id), ["new", "old"]);
  assert.ok(core.recency(NOW, NOW) <= 1 + core.RECENCY_BOOST + 1e-9 && core.recency(NOW - 3650 * DAY, NOW) < 1.001, "the boost is bounded and fades");
  assert.strictEqual(core.recency(0, NOW), 1, "a record with no date gets no boost");
  // The boost never lifts a weak match over a strong one.
  assert.ok(core.hybrid({ keyword: 6, vector: 0.6, updatedAt: NOW - 900 * DAY, now: NOW }) > core.hybrid({ keyword: 0.5, vector: 0.2, updatedAt: NOW, now: NOW }));
});

check("filters: source, project, status, type, owner, date range, open; archived records are hidden unless asked for", () => {
  const e = { source: "ticket", projectId: "p1", status: "backlog", type: "bug", owner: "sam@ph.example", updatedAt: NOW - 3 * DAY, open: true, archived: false };
  const f = (a) => core.cleanFilters(a, NOW);
  assert.ok(core.matchFilters(e, f({})));
  assert.ok(core.matchFilters(e, f({ sources: ["ticket", "kanban"], projectId: "p1", status: ["Backlog"], type: ["bug"], owner: "Sam@PH.example", since: "7d", until: "1d", open: true })));
  for (const no of [{ sources: ["faq"] }, { projectId: "p2" }, { status: ["archived"] }, { type: ["feature"] }, { owner: "kit@ph.example" }, { since: "2d" }, { until: "5d" }, { open: false }, { conceptId: "c1" }]) {
    assert.ok(!core.matchFilters(e, f(no)), JSON.stringify(no));
  }
  const archived = Object.assign({}, e, { status: "archived", archived: true, open: false });
  assert.ok(!core.matchFilters(archived, f({})), "hidden by default");
  assert.ok(core.matchFilters(archived, f({ includeArchived: true })));
  assert.ok(core.matchFilters(archived, f({ status: ["archived"] })), "naming the status asks for it");
  assert.ok(core.matchFilters({ source: "document", projectId: "p1", projectIds: ["p1", "p9"], updatedAt: NOW }, f({ projectId: "p9" })), "an interface belongs to both its projects");
  assert.strictEqual(f({ since: "2026-11-10" }).since, Date.parse("2026-11-10"));
  assert.throws(() => f({ since: "soon" }), (e) => e instanceof core.Refusal && /since must be a date/.test(e.message));
  assert.throws(() => f({ sources: ["passwords"] }), /Unknown source "passwords"/);
});

check("chunks: cut at headings, then paragraphs; never longer than the limit; a very long document is marked truncated", () => {
  const md = `# Guide\n\nIntro.\n\n## Booking\n\n${"A sentence about booking. ".repeat(200)}\n\n\`\`\`\n# not a heading\n\`\`\`\n\n## Limits\n\nRate limits.`;
  const { chunks, truncated } = core.chunkText(md);
  assert.ok(!truncated);
  assert.ok(chunks.every((c) => c.t.length <= core.CHUNK_CHARS));
  assert.deepStrictEqual([...new Set(chunks.map((c) => c.h))], ["Guide", "Booking", "Limits"], "a # inside a code fence is not a heading");
  assert.ok(chunks.filter((c) => c.h === "Booking").length > 1, "a long section is several chunks under its heading");
  // Many short sections share chunks, so a long document of them is indexed whole, and a hit still names its own heading.
  const many = Array.from({ length: 400 }, (_, i) => `## Rule ${i}\n\nRule ${i} says item${i} must hold.`).join("\n\n");
  const packed = core.chunkText(many);
  assert.ok(!packed.truncated && packed.chunks.length < 30 && packed.chunks.every((c) => c.t.length <= core.CHUNK_CHARS), `${packed.chunks.length} chunks`);
  assert.ok(packed.chunks.some((c) => c.t.includes("item399")), "the last section is indexed");
  const holding = packed.chunks.find((c) => c.t.includes("item57 "));
  assert.strictEqual(core.sectionOf(holding, core.tokenize("item57")), "Rule 57");
  assert.strictEqual(core.sectionOf({ h: "Only", t: "text" }, ["text"]), "Only");
  const long = core.chunkText("word ".repeat(60000));
  assert.ok(long.truncated && long.chunks.length <= core.MAX_CHUNKS);
  assert.deepStrictEqual(core.chunkText("").chunks, []);
});

check("snippet: around the first query word, in one line; email addresses never survive scrub", () => {
  const text = `${"Opening words that say little. ".repeat(20)}The partner rate limits were raised in October. ${"Closing words. ".repeat(20)}`;
  const s = core.snippet(text, core.tokenize("rate limits"));
  assert.ok(s.length <= core.SNIPPET_MAX + 2 && /rate limits/.test(s) && s.startsWith("…") && s.endsWith("…"), s);
  assert.strictEqual(core.snippet("Short text.", ["nothing"]), "Short text.");
  assert.strictEqual(core.scrub("Ask jo.bloggs+x@mail.ph.example or <sam@ph.example>."), "Ask [address] or <[address]>.");
});

check("cache keys carry the caller's role and reach, so a pack is never shared across roles", () => {
  const all = ["ticket", "lead", "support"];
  const viewer = core.visibilityKey("viewer", all), editor = core.visibilityKey("editor", all), fewer = core.visibilityKey("viewer", ["ticket"]);
  assert.notStrictEqual(core.packKey("project:p1", viewer), core.packKey("project:p1", editor), "same reach, different role: different key");
  assert.notStrictEqual(core.packKey("project:p1", viewer), core.packKey("project:p1", fewer), "same role, different reach: different key");
  assert.strictEqual(core.packKey("project:p1", viewer), core.packKey("project:p1", core.visibilityKey("viewer", ["support", "ticket", "lead"])), "the order of sources does not matter");
  const f = core.cleanFilters({}, NOW);
  assert.notStrictEqual(core.queryKey("rate limits", f, 10, viewer), core.queryKey("rate limits", f, 10, editor));
  assert.strictEqual(core.queryKey("Rate  Limits!", f, 10, viewer), core.queryKey("rate limits", f, 10, viewer), "the same words are the same query");
  assert.strictEqual(core.queryHash("Rate Limits"), core.queryHash("rate limits"));
  assert.ok(!core.queryHash("rate limits").includes("rate"), "the audit keeps a hash, never the words");
});

check("names resolve the way Aidan's resolveProjectRef does: id, exact, starts-with, contains; two candidates is no match", () => {
  const rows = [{ id: "p1", name: "Display Types & DSP Integration" }, { id: "p2", name: "Backlog Tracker & FAQs" }, { id: "p3", name: "Display Wall" }];
  assert.strictEqual(core.resolveRef("p2", rows).id, "p2");
  assert.strictEqual(core.resolveRef("backlog tracker & faqs", rows).id, "p2");
  assert.strictEqual(core.resolveRef("Backlog", rows).id, "p2");
  assert.strictEqual(core.resolveRef("dsp integration", rows).id, "p1");
  assert.strictEqual(core.resolveRef("display", rows), null, "ambiguous");
  assert.strictEqual(core.resolveRef("pricing", rows), null);
  assert.strictEqual(core.resolveRef("", rows), null);
  // A short name never captures a sentence that merely uses the word, or holds it inside another word.
  const short = [{ id: "l1", name: "Arc" }, { id: "l2", name: "Next" }, { id: "l3", name: "Northwind Grocers" }];
  assert.strictEqual(core.resolveRef("how does search ranking work", short), null);
  assert.strictEqual(core.resolveRef("next steps for the release", short), null);
  assert.strictEqual(core.resolveRef("arc", short).id, "l1");
  assert.strictEqual(core.resolveRef("north", short).id, "l3");
  assert.strictEqual(core.resolveRef("what did northwind grocers say", short).id, "l3", "a distinctive name inside a longer topic still resolves");
  assert.strictEqual(core.resolveRef("what did northwind grocers say", short, { contains: false }), null, "unless only the whole name or its start may match (leads)");
});

check("the LRU forgets the oldest entry and anything past its time limit", () => {
  let t = 0;
  const c = core.lru(2, 100, () => t);
  c.set("a", 1); c.set("b", 2); assert.strictEqual(c.get("a"), 1);
  c.set("c", 3);
  assert.strictEqual(c.get("b"), undefined, "the least recently used went");
  assert.strictEqual(c.get("a"), 1);
  t = 101;
  assert.strictEqual(c.get("a"), undefined, "too old");
});

check("sources: a lead and a prospect are indexed by company fields only; an article's pending revision, spam and test leads are never indexed", () => {
  const S = makeSources("https://console.example");
  const lead = S.lead.build("l1", { company: { name: "Northwind Grocers", industry: "Grocery" }, stage: "demo", assignee: "Sam@ph.example",
    contacts: [{ name: "Private Person", email: "private.person@northwind.example", jobTitle: "CIO" }], history: [{ kind: "note", text: "Wants a pilot in March." }, { kind: "stage", text: "moved" }] });
  const leadText = JSON.stringify(lead);
  assert.ok(/Northwind Grocers/.test(leadText) && /pilot in March/.test(leadText));
  assert.ok(!/Private Person|private\.person|CIO/.test(leadText), "no contact is indexed");
  assert.deepStrictEqual([lead.status, lead.owner, lead.open, lead.url], ["demo", "sam@ph.example", true, "https://console.example/#leads/l1"]);
  assert.strictEqual(S.lead.build("l2", { company: { name: "Test Co" }, test: true }), null);
  const prospect = JSON.stringify(S.prospect.build("x1", { name: "ALDI", country: "Australia", industry: "Grocery", insights: "Rolling out screens.", decisionMakers: "Jane Doe, CMO", contacts: [{ name: "Jane Doe" }], linkedinUrl: "https://www.linkedin.com/company/aldi/" }));
  assert.ok(/Rolling out screens/.test(prospect) && !/Jane Doe|linkedin/.test(prospect), "no decision maker, contact or profile link");
  const faq = S.faq.build("a1", { title: "How do I book?", bodyMd: "Live text.", status: "published", pendingRevision: { bodyMd: "SECRET DRAFT" }, retireProposal: { reason: "SECRET" } });
  assert.ok(!/SECRET/.test(JSON.stringify(faq)) && faq.archived === false);
  assert.strictEqual(S.faq.build("a2", { title: "Draft", status: "draft" }).archived, true, "an unpublished article is hidden by default, like search_faq");
  assert.strictEqual(S.support.build("t1", { subject: "Win a prize", status: "spam" }, []), null);
  const thread = S.support.build("t2", { key: "SUP-2", subject: "Screens offline", status: "open", needsHuman: true, aidan: { status: "needs-person", kind: "answer", reason: "No article." } },
    [{ direction: "in", text: "Our screens are offline.", at: 2 }, { direction: "event", text: "Triaged", at: 3 }, { direction: "out", text: "We are looking.", at: 4 }]);
  assert.ok(/Received: Our screens are offline\.\n\nSent: We are looking\./.test(thread.text) && !/Triaged/.test(thread.text), "mail in order, timeline events left out");
  assert.deepStrictEqual(thread.meta.blocked.reason, "needs-person");
  const ticket = S.ticket.build("i1", { title: "Rate limits", desc: "Cap the API.", status: "ready-for-testing", notes: [{ author: "sam@ph.example", text: "Decided: 60 a minute.", at: 5 }], patchFiles: [{ path: "x", content: "SECRET CODE" }], deployCommit: "abc" });
  assert.ok(ticket.open && !ticket.archived && ticket.meta.decisions.length === 1 && !/SECRET CODE|abc/.test(JSON.stringify(ticket)), "comments are indexed, patches and train fields are not");
  const D = documentEntries("https://console.example");
  assert.deepStrictEqual([D.projectMd("p1", "readme", { contentMd: "# Hi" }).id, D.projectDoc("d1", { projectId: "p1", name: "Spec", contentMd: "x" }).id, D.interface("f1", { name: "A↔B", projectIds: ["p1", "p2"], contentMd: "c" }).id], ["p1~readme", "doc~d1", "interface~f1"]);
  assert.strictEqual(D.projectMd("p1", "readme", { contentMd: "  " }), null);
});

check("the content version changes with the indexed content and not with anything else", () => {
  const e = { title: "T", text: "Body", status: "backlog", access: "list_backlog_items", meta: { comments: 1 } };
  assert.strictEqual(core.contentHash(e), core.contentHash(Object.assign({ notIndexed: 1, updatedAt: 5 }, e)));
  assert.notStrictEqual(core.contentHash(e), core.contentHash(Object.assign({}, e, { text: "Body." })));
  assert.notStrictEqual(core.contentHash(e), core.contentHash(Object.assign({}, e, { status: "archived" })));
});

console.log(failures.length ? `\ncontext-core: ${failures.length} FAILED (${failures.join("; ")})` : `\ncontext-core: ${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
