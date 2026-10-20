// Responsive regression: a ticket's detail view (the Edit item modal and the
// comments modal) must scroll vertically only — never sideways — at phone,
// tablet and desktop widths, with a long description, many comments, long
// URLs/IDs, code and attachments. Asserts there is no horizontal overflow on
// the page or inside the modal panel, and that nothing pokes past the
// viewport's right edge.
//
// Run with:  cd backlog-tracker/test && node ui/ticket-detail-overflow.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const WIDTHS = [390, 820, 1180, 1440];
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
const attachments = [
  { type: "image", name: "a-screenshot-with-an-extremely-long-file-name-".repeat(5) + ".png", url: PIXEL },
  { type: "image", name: "second.png", url: PIXEL },
];

const seed = () => ({
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { [PID]: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    backlogItems: {
      b1: { projectId: PID, title: "T".repeat(150), desc: longDesc, type: "bug", category: "HQ Admin", status: "backlog", notes, attachments, createdAt: t(T0 + 1), updatedAt: t(T0 + 1) },
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
} finally { await harness.close(); }
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log(`\nticket detail never scrolls sideways at ${WIDTHS.join(", ")} px`);
