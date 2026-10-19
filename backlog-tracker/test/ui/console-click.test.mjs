// Click-through tests for the console, in Chromium, against the REAL
// backlog-tracker/public/ files with the Firebase SDK stubbed (see
// harness.mjs and firebase-stub.mjs, and test/README.md for how to add a
// scenario). jsdom does no layout or hit-testing, so a button hidden under a
// modal backdrop still "clicks" there; Playwright's click only succeeds when
// the element is visible, enabled and actually receives the event.
//
// Every scenario runs at 1280 px and 390 px and prints one PASS or FAIL line.
// Every wait is a condition with a timeout; there are no fixed sleeps.
//
// Run with:  cd backlog-tracker/test && npm run test:ui
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { startHarness, until, outDir, SDK_MODULES } from "./harness.mjs";
import * as stub from "./firebase-stub.mjs";
import { publicDir } from "./harness.mjs";

const WIDTHS = [1280, 390];
const t = (ms) => ({ $ts: ms });
const T0 = 1_760_000_000_000;

// ── Seed: one project with a card in every column, an archived card and a doc
const PID = "p1";
const seed = (extra = {}) => ({
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { [PID]: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    backlogItems: {
      b1: { projectId: PID, title: "Purple widget", desc: "Make the widget purple everywhere", type: "feature", category: "HQ Admin", status: "backlog", createdAt: t(T0 + 1), updatedAt: t(T0 + 1) },
      r1: { projectId: PID, title: "Fix the thing", desc: "Fix the thing on the settings page", type: "bug", category: "HQ Admin", status: "ready-for-testing", previewUrl: "https://example.test/preview/r1", deployCommit: "abc123", testVersion: "1.0.1", createdAt: t(T0 + 2), updatedAt: t(T0 + 2) },
      d1: { projectId: PID, title: "Approved thing", desc: "Already approved", type: "bug", category: "HQ Admin", status: "ready-to-publish", deployCommit: "def456", createdAt: t(T0 + 3), updatedAt: t(T0 + 3) },
      l1: { projectId: PID, title: "Shipped thing", desc: "Already live", type: "feature", category: "HQ Admin", status: "published-live", createdAt: t(T0 + 4), updatedAt: t(T0 + 4) },
      a1: { projectId: PID, title: "Archived thing", desc: "Long gone", type: "bug", category: "HQ Admin", status: "archived", createdAt: t(T0 + 5), updatedAt: t(T0 + 5), archivedAt: t(T0 + 6) },
    },
    projectDocs: { doc1: { projectId: PID, name: "Release checklist", contentMd: "1. Ship it", createdAt: t(T0), updatedAt: t(T0) } },
    ...extra,
  },
});
// A seed with only the cards a scenario needs, so its card is the only one of its kind.
const only = (...ids) => {
  const s = seed();
  s.docs.backlogItems = Object.fromEntries(Object.entries(s.docs.backlogItems).filter(([id]) => ids.includes(id)));
  return s;
};

// ── Scenario context ───────────────────────────────────────────────────────
class Step extends Error {}
function makeCtx(o, width) {
  const { page } = o;
  page.setDefaultTimeout(8000);
  const ctx = { page, width, step: "start", selector: "" };
  const at = (step, selector = "") => { ctx.step = step; ctx.selector = selector; };
  ctx.at = at;
  ctx.click = async (selector, step) => { at(step || `click ${selector}`, selector); await page.click(selector); };
  ctx.visible = async (selector, step) => { at(step || `${selector} visible`, selector); await page.waitForSelector(selector, { state: "visible" }); };
  ctx.hidden = async (selector, step) => { at(step || `${selector} hidden`, selector); await page.waitForSelector(selector, { state: "hidden" }); };
  ctx.text = async (selector) => (await page.locator(selector).first().innerText());
  ctx.writes = () => page.evaluate(() => (window.__fbStub ? window.__fbStub.writes : []));
  ctx.waitWrites = async (n, step) => { at(step || `wait for ${n} write(s)`); return until(async () => { const w = await ctx.writes(); return w.length >= n ? w : null; }, `${n} recorded write(s)`); };
  ctx.waitText = async (selector, needle, step) => {
    at(step || `${selector} contains "${needle}"`, selector);
    await until(async () => (await page.locator(selector).first().innerText().catch(() => "")).includes(needle), `${selector} to contain "${needle}"`);
  };
  // The board has rendered the seeded project's cards.
  ctx.boardReady = async () => { at("board renders"); await page.waitForSelector(".column[data-col=\"backlog\"]", { state: "attached" }); await until(() => page.locator(".card, .item-card, [data-id]").count(), "seeded cards"); };
  ctx.openMenu = async () => { await ctx.click(".project-options-btn", "open the ⋮ menu"); await ctx.visible(".project-options-menu"); };
  return ctx;
}

// ── Scenarios ──────────────────────────────────────────────────────────────
const scenarios = [
  {
    name: "board: four columns in order, stacked below 640 px",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      c.at("column order and layout");
      const cols = await c.page.evaluate(() => [...document.querySelectorAll(".column[data-col]")].map((e) => { const r = e.getBoundingClientRect(); return { key: e.dataset.col, head: e.querySelector(".col-head").innerText.replace(/\s+/g, " ").trim(), x: r.x, y: r.y, w: r.width }; }));
      assert.deepStrictEqual(cols.map((x) => x.key), ["backlog", "ready-for-testing", "ready-to-publish", "published-live"]);
      const heads = cols.map((x) => x.head.toLowerCase());
      assert.ok(heads[0].includes("backlog"), `first column is Backlog, got "${cols[0].head}"`);
      assert.ok(heads[1].includes("ready for testing"), `second column is Ready for Testing, got "${cols[1].head}"`);
      assert.ok(heads[2].includes("approved for deployment"), `third column is Approved for Deployment, got "${cols[2].head}"`);
      assert.ok(heads[3].includes("main"), `fourth column is the Merged to Main column, got "${cols[3].head}"`);
      if (c.width < 640) {
        for (let i = 1; i < cols.length; i++) assert.ok(cols[i].y > cols[i - 1].y, `column ${i + 1} should sit below column ${i} at ${c.width}px`);
        const { sw, cw } = await c.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        assert.ok(sw <= cw, `page scrolls sideways at ${c.width}px (scrollWidth ${sw} > clientWidth ${cw})`);
      } else {
        for (let i = 1; i < cols.length; i++) assert.ok(cols[i].x > cols[i - 1].x, `column ${i + 1} should sit right of column ${i} at ${c.width}px`);
      }
    },
  },
  {
    name: "⋮ menu: Archived tickets lists the archived card",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.click(".project-archive-btn", "Archived tickets");
      await c.visible("#archive-page");
      await c.waitText("#archive-table-body", "Archived thing", "archive page lists the seeded archived card");
    },
  },
  {
    name: "⋮ menu: an archived card's date renders (stub timestamps keep toMillis/toDate)",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.click(".project-archive-btn", "Archived tickets");
      await c.waitText("#archive-table-body", "Archived thing", "archive page lists the seeded archived card");
      const row = await c.page.evaluate((ms) => ({ text: document.querySelector("#archive-table-body tr").innerText, want: new Date(ms).toLocaleDateString() }), T0 + 6);
      assert.ok(row.text.includes(row.want), `the Archived row should show ${row.want}, got ${JSON.stringify(row.text)}`);
    },
  },
  {
    name: "⋮ menu: Docs opens Project Settings and lists a document",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.click(".project-docs-btn", "Project Settings");
      await c.visible("#docs-page");
      await c.waitText("#docs-page h2", "Project Settings — Demo Project");
      await c.waitText("#docs-extra-docs-list", "Release checklist", "docs page lists the seeded projectDocs document");
    },
  },
  {
    name: "Ready for Testing: Test this → links to the seeded previewUrl",
    seed: () => only("r1"),
    async run(c) {
      await c.boardReady();
      await c.visible("a.test-link-btn");
      c.at("link target", "a.test-link-btn");
      const a = await c.page.evaluate(() => { const e = document.querySelector("a.test-link-btn"); return { href: e.href, target: e.target }; });
      assert.strictEqual(a.href, "https://example.test/preview/r1");
      assert.strictEqual(a.target, "_blank");
    },
  },
  {
    name: "Ready for Testing: Failed testing — Cancel writes nothing, OK sends it back",
    seed: () => only("r1"),
    async run(c) {
      await c.boardReady();
      await c.click(".fail-testing-btn", "Failed testing");
      await c.visible("#dialog-backdrop");
      await c.waitText("#dialog-title", "Failed testing");
      await c.click("#dialog-cancel", "Cancel the dialog");
      await c.hidden("#dialog-backdrop");
      c.at("Cancel wrote nothing");
      assert.deepStrictEqual(await c.writes(), []);

      await c.click(".fail-testing-btn", "Failed testing again");
      await c.visible("#dialog-backdrop");
      c.at("fill in the details", "#dialog-fields textarea");
      await c.page.fill("#dialog-fields textarea", "The button does nothing on the settings page");
      await c.click("#dialog-ok", "OK");
      const writes = await c.waitWrites(1);
      c.at("the send-back write");
      assert.strictEqual(writes.length, 1, `exactly one write, got ${JSON.stringify(writes)}`);
      const w = writes[0];
      assert.strictEqual(w.op, "update");
      assert.strictEqual(w.path, "backlogItems/r1");
      assert.strictEqual(w.data.status, "backlog");
      assert.strictEqual(w.data.revertRequested, true);
      assert.ok(w.data.lastFailureReason && /settings page/.test(w.data.lastFailureReason.text), "lastFailureReason carries the details");
      assert.ok(w.data.notes && w.data.notes.$arrayUnion && /settings page/.test(JSON.stringify(w.data.notes)), "a note carries the details");
    },
  },
  {
    name: "Approve: ticking a card then Approved for Deployment locks the train",
    seed: () => only("r1"),
    async run(c) {
      await c.boardReady();
      await c.click(".card-deploy-select-cb", "tick the Ready for Testing card");
      await c.waitText(".deploy-to-feature-btn", "Approved for Deployment — 1 selected");
      await c.click(".deploy-to-feature-btn", "Approved for Deployment — 1 selected");
      const writes = await until(async () => { const w = await c.writes(); return w.some((x) => x.path === `projects/${PID}`) ? w : null; }, "the approval writes");
      c.at("approval writes");
      const card = writes.find((x) => x.path === "backlogItems/r1");
      assert.ok(card, `the card was written, got ${JSON.stringify(writes)}`);
      assert.strictEqual(card.data.status, "ready-to-publish");
      const proj = writes.find((x) => x.path === `projects/${PID}`);
      assert.strictEqual(proj.op, "set");
      assert.strictEqual(proj.merge, true);
      assert.strictEqual(proj.data.trainLocked, true);
    },
  },
  {
    name: "New backlog item: a new description creates one Backlog card",
    seed: () => only("r1"),
    async run(c) {
      await c.boardReady();
      await c.click(".new-item-btn", "+ New backlog item");
      await c.visible("#ni-backdrop");
      c.at("type the description", "#ni-desc-input");
      await c.page.fill("#ni-desc-input", "Add a dark mode toggle to the retail admin header");
      await c.click("#ni-submit", "Add to backlog");
      const writes = await c.waitWrites(1);
      await c.hidden("#ni-backdrop", "the form closes");
      c.at("the created card");
      const adds = writes.filter((x) => x.op === "add" && x.path.startsWith("backlogItems/"));
      assert.strictEqual(adds.length, 1, `one backlogItems doc created, got ${JSON.stringify(writes)}`);
      assert.strictEqual(adds[0].data.projectId, PID);
      assert.strictEqual(adds[0].data.status, "backlog");
      assert.ok(/dark mode/.test(adds[0].data.desc));
    },
  },
  {
    name: "New backlog item: a near-copy offers Add as comment, which adds a note only",
    seed: () => only("b1"),
    async run(c) {
      await c.boardReady();
      await c.click(".new-item-btn", "+ New backlog item");
      await c.visible("#ni-backdrop");
      c.at("type a near-copy", "#ni-desc-input");
      await c.page.fill("#ni-desc-input", "Make the widget purple everywhere please");
      await c.click("#ni-submit", "Add to backlog");
      await c.visible("#dialog-backdrop", "the duplicate dialog opens");
      await c.waitText("#dialog-message", "looks a lot like an existing open ticket");
      await c.click("#dialog-ok", "Add as comment");
      const writes = await c.waitWrites(1);
      c.at("the comment write");
      assert.ok(!writes.some((x) => x.op === "add" || (x.op === "set" && x.path.startsWith("backlogItems/"))), `no new backlogItems doc, got ${JSON.stringify(writes)}`);
      const note = writes.find((x) => x.path === "backlogItems/b1");
      assert.ok(note, `the existing card was written, got ${JSON.stringify(writes)}`);
      assert.ok(note.data.notes && /purple/.test(JSON.stringify(note.data.notes)), "the note carries the new description");
    },
  },
];

// ── Self-checks ────────────────────────────────────────────────────────────
// (a) the stub exports every name the console imports from gstatic;
// (c) a stub function that isn't implemented throws its own name.
function selfChecks() {
  const results = [];
  const check = (name, fn) => { try { fn(); results.push([name, null]); } catch (err) { results.push([name, err]); } };
  check("stub exports every SDK name app.js and auth-gate.js import", () => {
    const missing = [];
    for (const file of ["app.js", "auth-gate.js"]) {
      const src = fs.readFileSync(path.join(publicDir, "js", file), "utf8");
      const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+)"/g)];
      assert.ok(imports.length >= 2, `${file} should import the Firebase SDK from gstatic — has its loading changed? Update this harness.`);
      for (const [, names, url] of imports) {
        assert.ok(SDK_MODULES.includes(url.split("/").pop()), `${file} imports ${url}, which the harness does not route`);
        for (const n of names.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/)[0].trim())) {
          if (!(n in stub)) missing.push(`${n} (${file})`);
        }
      }
    }
    assert.deepStrictEqual(missing, [], `firebase-stub.mjs does not export: ${missing.join(", ")}`);
  });
  check("the index.html SDK URLs are all routed by the harness", () => {
    const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
    const urls = [...html.matchAll(/rel="modulepreload" href="(https:\/\/www\.gstatic\.com\/firebasejs\/10\.13\.2\/[^"]+)"/g)].map((m) => m[1].split("/").pop());
    assert.deepStrictEqual([...urls].sort(), [...SDK_MODULES].sort());
  });
  check("an unimplemented stub function throws its own name", () => {
    assert.throws(() => stub.getFirestore(), /firebase-stub: getFirestore not implemented/);
    assert.throws(() => stub.signOut(), /firebase-stub: signOut not implemented/);
  });
  return results;
}

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
  let failed = 0;
  for (const [name, err] of selfChecks()) {
    if (err) { failed += 1; console.log(`FAIL  self-check: ${name}\n      ${err.message}`); } else console.log(`PASS  self-check: ${name}`);
  }
  if (failed) process.exit(1);

  const harness = await startHarness();
  try {
    // (b) a request to an unrouted external host fails the run.
    {
      const o = await harness.open({ seed: seed(), width: 1280 });
      try {
        await o.page.evaluate(() => fetch("https://unrouted.example.test/x").catch(() => {}));
        await until(() => o.problems.find((p) => p.includes("unrouted.example.test")), "the unrouted request to be reported", 5000);
        console.log("PASS  self-check: a request to an unrouted host fails the run");
      } catch (err) { failed += 1; console.log(`FAIL  self-check: a request to an unrouted host fails the run\n      ${err.message}`); }
      await o.close();
    }

    fs.mkdirSync(outDir, { recursive: true });
    for (const width of WIDTHS) {
      for (const s of scenarios) {
        const label = `${s.name} @${width}px`;
        const o = await harness.open({ seed: s.seed(), width, height: width < 640 ? 800 : 900 });
        const ctx = makeCtx(o, width);
        let error = null;
        try {
          await s.run(ctx);
          // The run also fails on anything the page reported along the way.
          if (o.problems.length) throw new Error(`the page reported ${o.problems.length} problem(s):\n        ${o.problems.join("\n        ")}`);
        } catch (err) { error = err; }
        if (!error) { console.log(`PASS  ${label}`); await o.close(); continue; }
        failed += 1;
        const shot = path.join(outDir, `${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${width}.png`);
        await o.page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const writes = await ctx.writes().catch(() => []);
        console.log(`FAIL  ${label}`);
        console.log(`      step:     ${ctx.step}`);
        if (ctx.selector) console.log(`      selector: ${ctx.selector}`);
        console.log(`      error:    ${String(error && error.message).split("\n").join("\n      ")}`);
        if (o.problems.length && !String(error.message).includes("the page reported")) console.log(`      page:     ${o.problems.join("\n                ")}`);
        console.log(`      writes:   ${JSON.stringify(writes)}`);
        console.log(`      screenshot: ${path.relative(process.cwd(), shot)}`);
        await o.close();
      }
    }
  } finally {
    await harness.close();
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log(`\nall console click-through scenarios passed at ${WIDTHS.join(" px and ")} px`);
}
main().catch((err) => { console.error(err); process.exit(1); });
