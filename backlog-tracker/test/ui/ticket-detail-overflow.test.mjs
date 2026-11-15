// Responsive regression: a ticket's detail view (the Edit item modal and the
// comments modal) must scroll vertically only — never sideways — at phone,
// tablet and desktop widths, with a long description, many comments, long
// URLs/IDs, code and attachments. Asserts there is no horizontal overflow on
// the page or inside the modal panel, and that nothing pokes past the
// viewport's right edge.
//
// The tickets on the boards themselves (jcQCHLGeLP50iOeh1ZnJ) are checked
// too: on the Agent board no column of tickets scrolls sideways and no ticket
// is wider than its column, in every column; on the Staff Kanban no ticket is
// wider than its column and a ticket only pans vertically under a finger
// (touch-action: pan-y), so a sideways swipe on a ticket never moves it or
// the board.
//
// Run with:  cd backlog-tracker/test && node ui/ticket-detail-overflow.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";
import { kanbanSeed, cardOfTask, KB } from "./kanban-seed.mjs";

const WIDTHS = [390, 820, 1024, 1180, 1440];
const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const PID = "p1";

const LONG_URL = "https://example.test/" + "very-long-path-segment-".repeat(14) + "end?token=" + "A1b2C3d4".repeat(20);
const LONG_ID = "backlogItems/" + "Hi4Cz01Cjq3ad1I8ohbO".repeat(6);
const CODE = "const handler = async (request, response) => { return response.status(200).json({ ok: true, items: await loadEverything(request.query.projectId, request.query.status) }); };";
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const longDesc = ["## Outcome", "A very long description. ".repeat(60), LONG_URL, LONG_ID, CODE, "x".repeat(400)].join("\n");
const notes = Array.from({ length: 24 }, (_, i) => ({
  author: i % 3 === 0 ? "claude" : "rob.with.a.very.long.email.address.for.testing@personalisationhub.example.com",
  text: `Comment ${i}: ${LONG_URL}\n${LONG_ID}\n${CODE}\n${"y".repeat(300)}`,
  at: t(T0 + i * 1000),
}));
// Two automatic send-backs and a held-for-main note, so the one-line
// rejection summary above the thread (rejection-summary.js) is measured too.
notes.push(
  { author: "backlog-automation", text: `Sent back automatically (Failed testing [tests]): Why: deployment train tests: ${LONG_ID} — ${LONG_URL}\nconsole tests (firestore-rules-test.yml) failed on this ticket's own commit abc1234: ${LONG_URL}`, at: t(T0 + 30000) },
  { author: "viewer", text: `Failed testing [Visual or layout issue]: ${"z".repeat(300)}`, at: t(T0 + 31000) },
  { author: "backlog-automation", text: `Not sent back: main is broken, not this ticket. The console tests fail the same way on main without this ticket (ccccccc: ${LONG_URL}): ${CODE}. It stays where it is.`, at: t(T0 + 32000) },
);
const attachments = [
  { type: "image", name: "a-screenshot-with-an-extremely-long-file-name-".repeat(5) + ".png", url: PIXEL },
  { type: "image", name: "second.png", url: PIXEL },
];

const seed = () => ({
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { [PID]: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    backlogItems: {
      b1: { projectId: PID, title: "T".repeat(150), desc: longDesc, type: "bug", category: "HQ Admin", status: "backlog", notes, attachments, lastFailureReason: { category: "tests", summary: `deployment train tests: ${LONG_ID}`, text: LONG_URL, action: "failed-testing", at: t(T0 + 30000) }, createdAt: t(T0 + 1), updatedAt: t(T0 + 1) },
    },
  },
});

// Overflow report: page, plus the modal panel and anything wider than the viewport.
const measure = (panelSel) => {
  const vw = document.documentElement.clientWidth;
  const panel = document.querySelector(panelSel);
  const wide = [];
  for (const el of document.querySelectorAll(`${panelSel} *`)) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > vw + 1 || r.left < -1)) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}#${el.id} right=${Math.round(r.right)}`);
  }
  return {
    vw,
    pageScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    panelScrollW: panel.scrollWidth,
    panelClientW: panel.clientWidth,
    wide: wide.slice(0, 6),
  };
};

let failed = 0;
const harness = await startHarness();
try {
  for (const width of WIDTHS) {
    for (const modal of [
      { name: "Edit item", open: ".edit-item-btn", panel: "#ei-backdrop .modal-panel", backdrop: "#ei-backdrop" },
      { name: "Comments", open: ".comment-item-btn, .quick-comment-btn", panel: "#qc-backdrop .modal-panel", backdrop: "#qc-backdrop" },
    ]) {
      const label = `ticket detail (${modal.name}) @${width}px`;
      const o = await harness.open({ seed: seed(), width, height: width < 640 ? 800 : 900 });
      try {
        const { page } = o;
        page.setDefaultTimeout(8000);
        await page.waitForSelector(".edit-item-btn", { state: "attached" });
        if (modal.name === "Edit item") await page.click(".edit-item-btn");
        else {
          const sel = await page.evaluate(() => { const b = [...document.querySelectorAll(".card button")].find((x) => /comment/i.test(x.title || "") && !x.classList.contains("edit-item-btn")); return b ? `.card button[title="${b.title}"]` : null; });
          if (!sel) { console.log(`SKIP  ${label} (no quick-comment button)`); await o.close(); continue; }
          await page.click(sel);
        }
        await page.waitForSelector(modal.backdrop, { state: "visible" });
        await page.waitForSelector(`${modal.backdrop} .ei-note-row`, { state: "attached" });
        await until(() => page.evaluate(() => document.querySelectorAll("#ei-notes-list .ei-note-row, #qc-notes-list .ei-note-row").length > 5), "comments rendered");
        const m = await page.evaluate(measure, modal.panel);
        assert.ok(m.pageScrollW <= m.vw, `page scrolls sideways: scrollWidth ${m.pageScrollW} > viewport ${m.vw}`);
        assert.ok(m.bodyScrollW <= m.vw, `body scrolls sideways: ${m.bodyScrollW} > ${m.vw}`);
        assert.ok(m.panelScrollW <= m.panelClientW, `modal panel scrolls sideways: scrollWidth ${m.panelScrollW} > clientWidth ${m.panelClientW}`);
        assert.deepStrictEqual(m.wide, [], `elements poke past the viewport: ${m.wide.join(", ")}`);
        // inner scrollers (comments, attachments) must not scroll sideways either
        const inner = await page.evaluate((b) => [...document.querySelectorAll(`${b} .ei-notes-list, ${b} .ei-attachments-list, ${b} textarea`)].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.id || e.className), modal.backdrop);
        assert.deepStrictEqual(inner, [], `inner blocks scroll sideways: ${inner.join(", ")}`);
        if (o.problems.length) throw new Error(`the page reported problems:\n ${o.problems.join("\n ")}`);
        console.log(`PASS  ${label}`);
      } catch (err) { failed += 1; console.log(`FAIL  ${label}\n      ${String(err.message).split("\n").join("\n      ")}`); }
      await o.close();
    }
  }
  // ── The boards: tickets never scroll left or right (jcQCHLGeLP50iOeh1ZnJ) ──
  const boardScan = (sel) => {
    const out = [];
    for (const box of document.querySelectorAll(sel.lists)) {
      if (!box.getClientRects().length) continue;
      if (box.scrollWidth > box.clientWidth + 1) out.push(`${box.id || box.className} scrolls sideways (${box.scrollWidth} > ${box.clientWidth})`);
      const br = box.getBoundingClientRect();
      for (const card of box.querySelectorAll(sel.card)) {
        const cr = card.getBoundingClientRect();
        if (cr.right > br.right + 1) out.push(`a ticket in ${box.id || box.className} is wider than its column by ${Math.round(cr.right - br.right)}px`);
        if (card.scrollWidth > card.clientWidth + 1) out.push(`a ticket in ${box.id || box.className} overflows sideways (${card.scrollWidth} > ${card.clientWidth})`);
        const ta = getComputedStyle(card).touchAction;
        if (sel.panY && ta !== "pan-y") out.push(`a ticket's touch-action is ${ta}, not pan-y`);
      }
    }
    return [...new Set(out)];
  };
  const BOARD_STATUSES = ["backlog", "ready-for-testing", "ready-to-publish", "published-live"];
  for (const width of WIDTHS) {
    const label = `agent board tickets @${width}px`;
    const o = await harness.open({ seed: { user: { email: "editor@personalisationhub.com", role: "editor" }, docs: {
      projects: { [PID]: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
      backlogItems: Object.fromEntries(BOARD_STATUSES.map((status, i) => [`s${i}`, { projectId: PID, title: `Title ${LONG_URL}`, desc: longDesc, type: "bug", category: "HQ Admin", status, notes: notes.slice(0, 2), createdAt: t(T0 + i), updatedAt: t(T0 + i) }])),
    } }, width, height: 900 });
    try {
      await o.page.waitForSelector(".col-list .card", { timeout: 15000 });
      await until(() => o.page.evaluate(() => document.querySelectorAll(".col-list .card").length >= 4), "every column's ticket rendered");
      const bad = await o.page.evaluate(boardScan, { lists: ".col-list", card: ".card", panY: false });
      assert.deepStrictEqual(bad, [], bad.join("; "));
      console.log(`PASS  ${label}`);
    } catch (err) { failed += 1; console.log(`FAIL  ${label}\n      ${String(err.message).split("\n").join("\n      ")}`); }
    await o.close();
  }
  const k0 = Object.keys(KB.kanbanTasks)[0];
  const longTask = { ...KB.kanbanTasks[k0], title: `Title ${LONG_URL}`, description: `<p>${LONG_URL}</p>`, descriptionText: LONG_URL, labels: ["a-long-label-" + "z".repeat(60)] };
  for (const width of WIDTHS) {
    const label = `staff kanban tickets @${width}px`;
    const o = await harness.open({ seed: kanbanSeed({ user: { email: "editor@personalisationhub.com", role: "admin" }, extra: { kanbanTasks: { [k0]: longTask }, kanbanCards: { [k0]: cardOfTask({ ...longTask, key: k0 }) } } }), width, height: 900, hash: "#staff-kanban" });
    try {
      await o.page.waitForSelector(".kb-card", { timeout: 20000 });
      const bad = await o.page.evaluate(boardScan, { lists: ".kb-list", card: ".kb-card", panY: true });
      assert.deepStrictEqual(bad, [], bad.join("; "));
      const pageW = await o.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(pageW <= 0, `the page scrolls sideways by ${pageW}px`);
      console.log(`PASS  ${label}`);
    } catch (err) { failed += 1; console.log(`FAIL  ${label}\n      ${String(err.message).split("\n").join("\n      ")}`); }
    await o.close();
  }
} finally { await harness.close(); }
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log(`\nticket detail, and the tickets on both boards, never scroll sideways at ${WIDTHS.join(", ")} px`);
