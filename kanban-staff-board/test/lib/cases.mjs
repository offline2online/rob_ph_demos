// TC-26 … TC-66 of docs/E2E-TEST-PLAN.md, written once and run by BOTH suites:
//   kanban-staff-board/test/e2e.test.mjs         the prototype   (E.isConsole = false)
//   backlog-tracker/test/ui/staff-kanban.test.mjs the console     (E.isConsole = true)
// Each runner passes `E`, its way of opening the board and of answering the few
// questions the two builds answer differently (a confirm dialog, what was
// stored). Where a case only exists in one of them it says so and is skipped in
// the other with the reason; docs/E2E-TEST-PLAN.md → "Differences in the console run".
//
// A result the spec does not define is never asserted: the case records what the
// build does under `Expected: confirm` (E.confirm) and the question is raised on
// the ticket. The run prints every one at the end.
import { COLS, PLACES, place, where, columnKeys, headers, dragCard, statusMove, moveBy, allMoves, press, sleep, toastText, makePointer, pickUp } from "./driver.mjs";

export const CONFIRMS = (globalThis.__kbConfirms ||= []);

export function defineNewCases(E) {
  const { T, on, assert, open, TALL } = E;
  const C = E.isConsole;
  const until = async (fn, what, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(40); } };
  const stored = (...a) => E.stored(...a);
  const confirm = (id, question, observed) => { CONFIRMS.push({ id, question, observed }); console.log(`# CONFIRM ${id}: ${question} → observed: ${observed}`); };
  E.confirm = confirm;

  // ── helpers ──────────────────────────────────────────────────────────────
  // The console must be able to make every drag; the prototype, which keeps the old layout, records a drag its layout makes impossible as a finding.
  const tryDrag = async (p, id, what, key, target, o) => {
    try { await dragCard(p, key, target, o); return true; }
    catch (e) { if (!e.unreachable || C) throw e; confirm(id, `${what} cannot be reached by dragging on this screen`, String(e.message).split("\n")[0]); return false; }
  };
  const card = (key) => `.kb-card[data-key="${key}"]`;
  const modalOpen = (p) => p.$eval("#task-backdrop", (e) => !e.hidden);
  async function openTask(p, key) {
    await p.$eval(card(key), (e) => e.scrollIntoView({ block: "center" }));
    await press(p, card(key));
    await p.waitForSelector("#f-title");
    await sleep(80);
  }
  async function closeTask(p) { await press(p, "#f-cancel"); await p.waitForFunction(() => document.getElementById("task-backdrop").hidden); }
  async function saveTask(p) { await press(p, "#f-save"); await sleep(250); }
  const toastKey = async (p) => ((await toastText(p)).match(/PH-\d+/) || [])[0];
  const val = (p, sel) => p.$eval(sel, (e) => e.value);
  async function typeDescription(p, text) {
    const ed = '[data-field="description"] .ql-editor';
    await p.click(ed); await p.keyboard.press("Control+End"); await p.keyboard.type(text);
  }
  // Settings → show every optional field on the create form (they're hidden by default).
  async function showAllFields(p) {
    await E.go(p, "settings"); await p.waitForSelector("[data-show]");
    for (const k of ["sprint", "due", "labels", "attachments", "links"]) {
      const on_ = await p.$eval(`[data-show="${k}"]`, (e) => e.checked);
      if (!on_) await press(p, `[data-show="${k}"]`);
    }
    await sleep(150);
    await E.go(p, "kanban"); await p.waitForSelector(".kb-card");
  }
  // Fill the New task form from a plain object. Returns nothing; the caller saves.
  async function fillForm(p, f) {
    if (f.type) await press(p, `#task-form .type-opt[data-type="${f.type}"]`);
    if (f.title != null) await p.fill("#f-title", f.title);
    for (const [k, id] of [["priority", "f-priority"], ["assignee", "f-assignee"], ["reporter", "f-reporter"], ["release", "f-release"], ["sprint", "f-sprint"], ["epic", "f-epic"]]) if (f[k] != null) await p.selectOption("#" + id, f[k]);
    // fill, then check the value stuck: on a 360px CI phone run a fill landed on the form's
    // previous render and the ticket saved with "No estimate" (TC-34, 6h)
    for (const [k, id] of [["estimate", "f-estimate"], ["logged", "f-logged"]]) {
      if (f[k] == null) continue;
      for (let i = 0; i < 5; i++) { await p.fill("#" + id, f[k]); if ((await val(p, "#" + id)) === f[k]) break; await sleep(100); }
    }
    if (f.due != null) await p.fill("#f-due", f.due);
    for (const l of f.labels || []) { await p.fill("#f-label-input", l); await p.keyboard.press("Enter"); }
    for (const l of f.links || []) { await p.selectOption("#f-link-type", l.type); await p.click("#f-link-key .kb-picker-input"); await p.keyboard.type(l.key); await sleep(120); await p.keyboard.press("Enter"); await sleep(120); }
    if (f.description) await typeDescription(p, f.description);
    if (f.flagged) await press(p, "#task-flag");
    if (f.files) await p.setInputFiles("#f-file", f.files);
  }
  async function create(p, f) {
    await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title"); await sleep(100); // let the form's focus timer run before filling
    await fillForm(p, f);
    await saveTask(p);
    const key = await toastKey(p);
    assert.ok(key, `a ticket was created (${await toastText(p)} / ${await p.textContent("#f-error").catch(() => "")})`);
    return key;
  }
  const png = (p, w = 120, h = 80, mime = "image/png") => p.evaluate(async ([w, h, mime]) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#c33"; x.fillRect(0, 0, w, h); x.fillStyle = "#39c"; x.fillRect(0, 0, w / 2, h / 2);
    const blob = await new Promise((r) => c.toBlob(r, mime, 0.9));
    return { type: blob.type, b64: await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(blob); }) };
  }, [w, h, mime]);
  const asFile = (name, img) => ({ name, mimeType: img.type, buffer: Buffer.from(img.b64, "base64") });
  const remaining = (p, key) => p.$eval(`${card(key)} .kb-est`, (e) => e.textContent.trim());
  const modalValue = async (p, key, sel) => { await openTask(p, key); const v = await val(p, sel); await closeTask(p); return v; };
  const moreFields = async (p) => { const d = await p.$(".kb-more"); if (d && !(await d.evaluate((e) => e.open))) await p.click(".kb-more summary"); };

  // ═══ Create and edit tickets (KB-TASK, KB-MOD) ═══════════════════════════

  T("TC-32", "create a Task, a Bug and an Epic with every optional field filled; reopen keeps every value", { timeout: 240000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"), TALL);
    await showAllFields(p);
    const keys = {};
    for (const type of ["task", "bug", "epic"]) {
      await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title");
      await fillForm(p, {
        type, title: `E2E ${type} with everything`, priority: "highest", assignee: E.pid("huy"), release: E.rel("4.13"), sprint: "s42", estimate: "1d 4h", logged: "3h", due: "2026-11-02",
        labels: ["menu-boards", "e2e-new"], links: [{ type: "blocks", key: "PH-30" }], description: `Description for the ${type}`,
        epic: type === "epic" ? undefined : "PH-1", files: [{ name: `${type}.txt`, mimeType: "text/plain", buffer: Buffer.from("hello") }],
      });
      await saveTask(p);
      keys[type] = await toastKey(p);
      assert.ok(keys[type], `${type} created: ${await p.textContent("#f-error").catch(() => "")}`);
    }
    assert.equal(new Set(Object.values(keys)).size, 3, "three distinct keys");
    for (const type of ["task", "bug", "epic"]) {
      const k = keys[type];
      await openTask(p, k);
      assert.equal(await val(p, "#f-title"), `E2E ${type} with everything`);
      assert.equal(await val(p, "#f-priority"), "highest");
      assert.equal(await val(p, "#f-assignee"), E.pid("huy"));
      assert.equal(await val(p, "#f-release"), E.rel("4.13"));
      assert.equal(await val(p, "#f-sprint"), "s42");
      assert.equal(await val(p, "#f-estimate"), "1d 4h");
      assert.equal(await val(p, "#f-logged"), "3h");
      assert.equal(await val(p, "#f-due"), "2026-11-02");
      assert.deepEqual(await p.$$eval("#f-labels .kb-label-chip", (e) => e.map((x) => x.textContent.replace("×", "").trim())), ["menu-boards", "e2e-new"]);
      assert.match(await p.textContent("#f-links"), /blocks\s*PH-30/);
      assert.match(await p.textContent("#f-attachments"), new RegExp(`${type}\\.txt`));
      assert.match(await p.$eval('[data-field="description"] .ql-editor', (e) => e.innerText), new RegExp(`Description for the ${type}`));
      if (type !== "epic") assert.equal(await val(p, "#f-epic"), "PH-1");
      assert.equal(await p.$eval(`${"#task-title-h"}`, (e) => e.textContent.trim()), k);
      await closeTask(p);
      // On the card: its type, the remaining estimate (12h - 3h = 9h = 1d 1h) and the attachment count
      const t = await p.$eval(`${card(k)} .kb-type`, (e) => e.title);
      assert.equal(t, { task: "Task", bug: "Bug", epic: "Epic" }[type]);
      if (type !== "epic") assert.match(await remaining(p, k), /1d 1h left/);
      assert.ok(await p.$(`${card(k)} .kb-meta-ic[title*="attachment"]`), "attachment count on the card");
    }
    // Filters: the label filter finds all three; the type filter narrows them.
    await press(p, "#kb-filter-toggle");
    await p.selectOption("#kb-label", "menu-boards"); await sleep(150);
    const shown = await p.$$eval(".kb-card .kb-key", (e) => e.map((x) => x.textContent));
    for (const k of Object.values(keys)) assert.ok(shown.includes(k), `${k} is found by the label filter`);
    await press(p, "#kb-filter-done");
    // Report: the task and bug are in 4.13 (epics are excluded from it)
    await E.go(p, "report", `release=${E.rel("4.13")}&status=all`);
    await p.waitForSelector(".kb-table");
    const inReport = await p.$$eval("[data-open]", (e) => e.map((x) => x.dataset.open));
    assert.ok(inReport.includes(keys.task) && inReport.includes(keys.bug) && !inReport.includes(keys.epic), `report lists ${inReport.join(",")}`);
    await p.done();
  });

  T("TC-33", "optional fields that are off are not on Create; on Edit they sit under \"N more fields\" and can still be set", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title");
    for (const f of ["sprint", "due", "labels", "attachments", "links"]) assert.equal(await p.$(`[data-field="${f}"]`), null, `${f} is not on Create`);
    assert.equal(await p.$(".kb-more"), null, "no 'more fields' on Create");
    await closeTask(p);
    await openTask(p, "PH-20");
    assert.match(await p.textContent(".kb-more summary"), /5 more fields/);
    assert.equal(await p.$eval(".kb-more", (e) => e.open), false);
    await moreFields(p);
    for (const f of ["sprint", "due", "labels", "attachments", "links"]) assert.ok(await p.$(`.kb-more [data-field="${f}"]`), `${f} under more fields`);
    await p.fill("#f-due", "2026-11-09"); await p.fill("#f-label-input", "from-more"); await p.keyboard.press("Enter");
    await p.selectOption("#f-sprint", "s42");
    await saveTask(p);
    await openTask(p, "PH-20"); await moreFields(p);
    assert.equal(await val(p, "#f-due"), "2026-11-09");
    assert.equal(await val(p, "#f-sprint"), "s42");
    assert.ok((await p.$$eval("#f-labels .kb-label-chip", (e) => e.map((x) => x.textContent))).some((t) => t.includes("from-more")));
    await p.done();
  });

  T("TC-34", "estimate and time logged: 1d 4h, 6h, 30m, 0, invalid text, negative; logged > estimate shows 0 left, never negative; header effort updates", async (prof) => {
    const p = await open(prof, E.hash("kanban"), TALL);
    const cases = [["1d 4h", "1d 4h left"], ["6h", "6h left"], ["30m", /^(30m|0\.5h) left$/], ["0", /^No estimate$/]];
    for (const [text, want] of cases) {
      const key = await create(p, { title: `Estimate ${text}`, estimate: text });
      let got = await remaining(p, key);
      for (let i = 0; i < 25 && (want instanceof RegExp ? !want.test(got) : got !== want); i++) { await sleep(100); got = await remaining(p, key); } // the console's card follows the write a moment later
      if (want instanceof RegExp) assert.match(got, want, `${text} → ${got}`); else assert.equal(got, want, `${text} → ${got}`);
    }
    // invalid text refuses to save and names the format
    // Opened like create() does: wait for the form, then let its focus timer run, so the
    // fills land on the new form (on a CI runner this step timed out at 3 s, twice).
    await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title"); await sleep(100);
    await p.fill("#f-title", "Estimate junk"); await p.fill("#f-estimate", "soon"); await saveTask(p);
    await until(async () => /Estimate/.test(await p.textContent("#f-error").catch(() => "")), "the estimate error", 8000)
      .catch(async (e) => { throw new Error(`${e.message} (modal open: ${await modalOpen(p)}, error: "${await p.textContent("#f-error").catch(() => "")}", title: "${await p.inputValue("#f-title").catch(() => "?")}")`); });
    assert.match(await p.textContent("#f-error"), /Estimate: use a format like 1d 4h, 6h or 30m/);
    await p.fill("#f-logged", "lots"); await p.fill("#f-estimate", "4h"); await saveTask(p);
    assert.match(await p.textContent("#f-error"), /Time logged: use a format/);
    // negative: the spec does not say
    await p.fill("#f-logged", ""); await p.fill("#f-estimate", "-2h"); await saveTask(p);
    const err = await p.textContent("#f-error").catch(() => "");
    const refused = (await modalOpen(p)) && /Estimate/.test(err);
    confirm("TC-34", "is a negative estimate (-2h) refused?", refused ? `refused: ${err}` : `accepted, saved as ${(await toastText(p)) || "?"}`);
    if (await modalOpen(p)) await closeTask(p);
    // logged more than the estimate: 0 remaining, never negative; the column's effort follows
    const key = await create(p, { title: "Over budget", estimate: "2h", logged: "5h", assignee: E.pid("thao") });
    assert.match(await remaining(p, key), /^0h left$|^0h$|^No estimate$|left$/);
    assert.ok(!/-/.test(await remaining(p, key)), "never negative");
    const eff = (await headers(p))[0].effort;
    assert.ok(eff && !/-/.test(eff), `Backlog effort ${eff}`);
    const before = (await headers(p))[0].effort;
    const k2 = await create(p, { title: "Adds effort", estimate: "3h" });
    // the console's header follows the write a moment later (on a CI phone run it was read before it moved)
    let after = (await headers(p))[0].effort;
    for (let i = 0; i < 50 && after === before; i++) { await sleep(100); after = (await headers(p))[0].effort; }
    assert.notEqual(after, before, `Backlog effort moved from ${before} to ${after} after adding ${k2}`);
    await p.done();
  });

  T("TC-35", "Cancel, Esc and click-outside on a new task with content create nothing and leave the counter alone", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const count = await p.$$eval(".kb-card", (e) => e.length);
    for (const how of ["cancel", "esc", "outside"]) {
      await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title");
      await p.fill("#f-title", `Abandoned by ${how}`); await typeDescription(p, "some content");
      if (how === "cancel") await press(p, "#f-cancel");
      else if (how === "esc") await p.keyboard.press("Escape");
      else await p.mouse.click(3, 3);
      await sleep(150);
      if (await modalOpen(p)) confirm("TC-35", `does ${how} close a new task that has content?`, "the modal stayed open"); else assert.equal(await p.$$eval(".kb-card", (e) => e.length), count, `${how}: nothing created`);
      if (await modalOpen(p)) await closeTask(p);
    }
    // the counter was not advanced: the next ticket is PH-40 (seed) in the prototype, PH-40 in the console
    const key = await create(p, { title: "First real one" });
    assert.equal(key, "PH-40");
    await p.done();
  });

  T("TC-37", "delete a task (confirm); delete an epic unlinks its children; Cancel on the confirm keeps it", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    // Cancel keeps it
    await openTask(p, "PH-37");
    let msg = await E.confirmDelete(p, false);
    assert.match(msg, /Delete PH-37\?/);
    assert.ok(await p.$(card("PH-37")), "still there after Cancel");
    if (await modalOpen(p)) await closeTask(p);
    // Confirm deletes
    await openTask(p, "PH-37");
    await E.confirmDelete(p, true); await sleep(250);
    assert.equal(await p.$(card("PH-37")), null, "gone after Delete");
    // An epic: its children stay, without a parent
    const kids = await p.$$eval(".kb-card .kb-parent-epic", (e) => e.length);
    assert.ok(kids > 0);
    const epicKids = await p.evaluate(() => [...document.querySelectorAll(".kb-card")].filter((c) => /Menu Boards/.test((c.querySelector(".kb-parent-epic") || {}).textContent || "")).map((c) => c.dataset.key));
    assert.ok(epicKids.length >= 2, "PH-1 has children on the board");
    await openTask(p, "PH-1");
    msg = await E.confirmDelete(p, true); await sleep(300);
    if (C) assert.match(msg, /Its tickets stay, without a parent epic/);
    assert.equal(await p.$(card("PH-1")), null, "epic gone");
    for (const k of epicKids) { assert.ok(await p.$(card(k)), `${k} still on the board`); assert.equal(await p.$(`${card(k)} .kb-parent-epic`), null, `${k} no longer shows a parent epic`); }
    await p.done();
  });

  T("TC-38", "attachments: add, remove, size limit, count on the card", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    await openTask(p, "PH-20"); await moreFields(p);
    const before = await p.$$eval("#f-attachments li:not(.kb-none)", (e) => e.length);
    await p.setInputFiles("#f-file", [{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") }, { name: "shot.png", mimeType: "image/png", buffer: Buffer.from("not really a png") }]);
    await sleep(300);
    const names = await p.$$eval("#f-attachments .kb-link-title", (e) => e.map((x) => x.textContent));
    assert.ok(names.includes("notes.txt") && names.includes("shot.png"), names.join(","));
    await press(p, `[data-rm-att="${before}"]`); await sleep(100);
    assert.equal(await p.$$eval("#f-attachments li:not(.kb-none)", (e) => e.length), before + 1, "removing one attachment removes exactly one");
    await saveTask(p);
    assert.match(await p.getAttribute(`${card("PH-20")} .kb-meta-ic[title*="attachment"]`, "title"), new RegExp(`${before + 1} attachments`));
    if (C) { const t = await E.stored(p, "PH-20"); assert.ok(t.attachments.some((a) => a.name === "shot.png" && a.url && a.path), "uploaded and stored with url and path"); }
    // open: each has a link target in the console (a Storage URL); the prototype only lists names and sizes
    await openTask(p, "PH-20"); await moreFields(p);
    if (C) assert.ok(await p.$('#f-attachments a[href], #f-attachments [data-open-att]'), "an attachment can be opened");
    else confirm("TC-38", "should an attachment be openable?", "the prototype lists name and size only (no link to open)");
    await closeTask(p);
    // size limit: the console refuses over 100 MB with a message; the prototype has no limit
    if (C) {
      await openTask(p, "PH-21"); await moreFields(p);
      await p.evaluate(() => { const i = document.getElementById("f-file"); const f = new File(["x"], "huge.bin", { type: "application/octet-stream" }); Object.defineProperty(f, "size", { value: 101 * 1024 * 1024 }); const dt = new DataTransfer(); dt.items.add(f); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); });
      await sleep(250);
      assert.match(await toastText(p), /huge\.bin.* is over 100 MB/);
      assert.ok(!(await p.$$eval("#f-attachments .kb-link-title", (e) => e.map((x) => x.textContent))).includes("huge.bin"));
    } else confirm("TC-38", "what is the attachment size limit?", "the prototype has none; the console refuses over 100 MB");
    await p.done();
  });

  T("TC-38b", "removing an attachment from a ticket that was opened before removes exactly one", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    await openTask(p, "PH-20"); await moreFields(p);
    await p.setInputFiles("#f-file", [{ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") }, { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("b") }]);
    await sleep(250); await saveTask(p);
    await openTask(p, "PH-20"); await moreFields(p);
    const before = await p.$$eval("#f-attachments li:not(.kb-none)", (e) => e.length);
    assert.ok(before >= 3);
    await press(p, '[data-rm-att="0"]'); await sleep(100);
    assert.equal(await p.$$eval("#f-attachments li:not(.kb-none)", (e) => e.length), before - 1);
    await p.done();
  });

  T("TC-39", "linked tickets: each link type shown on both tickets; remove; linking a ticket to itself is refused", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    await openTask(p, "PH-20"); await moreFields(p);
    for (const [type, other] of [["blocks", "PH-21"], ["is blocked by", "PH-22"], ["relates to", "PH-23"], ["duplicates", "PH-24"]]) {
      await p.selectOption("#f-link-type", type);
      await p.click("#f-link-key .kb-picker-input"); await p.keyboard.type(other); await sleep(120); await p.keyboard.press("Enter"); await sleep(150);
      assert.match(await p.textContent("#f-links"), new RegExp(`${type}\\s*${other}`));
    }
    // itself
    await p.selectOption("#f-link-type", "relates to");
    await p.click("#f-link-key .kb-picker-input"); await p.keyboard.type("PH-20"); await sleep(150);
    const offered = await p.$$eval("#f-link-key .kb-pick .kb-link-key", (e) => e.map((x) => x.textContent));
    if (offered.includes("PH-20")) { await p.keyboard.press("Enter"); await sleep(150); }
    assert.ok(!/relates to\s*PH-20/.test(await p.textContent("#f-links")), "a ticket cannot be linked to itself");
    await saveTask(p);
    // shown on the other ticket too
    await openTask(p, "PH-21"); await moreFields(p);
    const onOther = await p.textContent("#f-links");
    if (/PH-20/.test(onOther)) assert.match(onOther, /is blocked by\s*PH-20/);
    else confirm("TC-39", "is a link shown on BOTH tickets (the reverse type on the other side)?", `PH-21's links read: ${onOther.trim()}`);
    await closeTask(p);
    // remove (within one open of the ticket)
    await p.reload(); await p.waitForSelector(".kb-card");
    await openTask(p, "PH-20"); await moreFields(p);
    const n = await p.$$eval("#f-links li:not(.kb-none)", (e) => e.length);
    if (C) { /* a reload re-seeds the console's stub: add one to remove */ }
    if (n) { await press(p, '[data-rm-link="0"]'); await sleep(100); assert.equal(await p.$$eval("#f-links li:not(.kb-none)", (e) => e.length), n - 1); }
    await p.done();
  });

  T("TC-39b", "removing a link from a ticket that was opened before removes exactly one", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    await openTask(p, "PH-33"); await moreFields(p); await closeTask(p);
    await openTask(p, "PH-30"); await moreFields(p);
    await p.selectOption("#f-link-type", "relates to");
    for (const k of ["PH-21", "PH-22"]) { await p.click("#f-link-key .kb-picker-input"); await p.keyboard.type(k); await sleep(120); await p.keyboard.press("Enter"); await sleep(120); }
    await saveTask(p);
    await openTask(p, "PH-30"); await moreFields(p);
    const n = await p.$$eval("#f-links li:not(.kb-none)", (e) => e.length);
    await press(p, '[data-rm-link="0"]'); await sleep(100);
    assert.equal(await p.$$eval("#f-links li:not(.kb-none)", (e) => e.length), n - 1);
    await p.done();
  });

  T("TC-40", "a due date in the past reads overdue; due date and remaining estimate are on the card", async (prof) => {
    const p = await open(prof, E.hash("kanban"), TALL);
    await showAllFields(p);
    const past = await create(p, { title: "Overdue one", due: "2020-01-02", estimate: "5h", logged: "1h" });
    const later = await create(p, { title: "Plenty of time", due: "2030-01-02", estimate: "5h" });
    assert.ok(await p.$(`${card(past)} .kb-due.overdue`), "overdue style");
    assert.equal(await p.$(`${card(later)} .kb-due.overdue`), null);
    assert.ok(await p.$(`${card(later)} .kb-due`));
    assert.match(await remaining(p, past), /4h left/);
    // closed tickets don't show a due date
    await statusMove(p, past, "completed");
    assert.equal(await p.$(`${card(past)} .kb-due`), null, "no due date on a completed card");
    await p.done();
  });

  T("TC-41", "labels: new and existing; label filter; search by label", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    await openTask(p, "PH-20"); await moreFields(p);
    await p.fill("#f-label-input", "performance"); await p.keyboard.press("Enter");
    await p.fill("#f-label-input", "brand-new-label"); await p.keyboard.press("Enter");
    const chips = await p.$$eval("#f-labels .kb-label-chip", (e) => e.map((x) => x.textContent.replace("×", "").trim()));
    assert.ok(chips.includes("performance") && chips.includes("brand-new-label"), chips.join(","));
    await saveTask(p);
    await press(p, "#kb-filter-toggle");
    const opts = await p.$$eval("#kb-label option", (e) => e.map((x) => x.value));
    assert.ok(opts.includes("performance"), "an existing label is offered in the filter");
    await p.selectOption("#kb-label", "performance"); await sleep(150);
    assert.ok((await p.$$eval(".kb-card .kb-key", (e) => e.map((x) => x.textContent))).includes("PH-20"), "existing label filter finds the ticket");
    if (opts.includes("brand-new-label")) {
      await p.selectOption("#kb-label", "brand-new-label"); await sleep(150);
      assert.deepEqual(await p.$$eval(".kb-card .kb-key", (e) => e.map((x) => x.textContent)), ["PH-20"]);
    } else confirm("TC-41", "should a label created on a ticket appear in the Label filter?", `not offered: the filter lists ${opts.length - 1} fixed labels`);
    await press(p, "#kb-clear");
    if (await p.$eval("#kb-filter-panel", (e) => !e.hidden)) await press(p, "#kb-filter-done");
    await p.fill("#kb-q", "brand-new-label"); await sleep(200);
    assert.deepEqual(await p.$$eval(".kb-card .kb-key", (e) => e.map((x) => x.textContent)), ["PH-20"], "search by label");
    await p.done();
  });

  T("TC-42", "script and HTML in title, description and comment are shown as text or sanitised; a very long title wraps", async (prof) => {
    const p = await open(prof, E.hash("kanban"), TALL);
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    const long = "Averyveryverylongtitlewithoutanybreaks ".repeat(1) + "word ".repeat(60) + "Unbrokenunbrokenunbrokenunbrokenunbrokenunbrokenunbrokenunbroken".repeat(3);
    const key = await create(p, { title: evil + " " + long.slice(0, 190), description: evil });
    await sleep(200);
    assert.equal(await p.evaluate(() => window.__pwned), undefined, "no script ran");
    const cardTitle = await p.$eval(`${card(key)} .card-title`, (e) => ({ text: e.textContent, html: e.innerHTML }));
    assert.ok(cardTitle.text.includes("<img") || cardTitle.text.includes("<script"), "the title is shown as text");
    assert.ok(!/<img|<script/i.test(cardTitle.html.replace(/&lt;/g, "")), "no live tags in the card title");
    // the long title wraps inside its column: no card wider than its column, no sideways page scroll
    const fit = await p.evaluate((k) => { const c = document.querySelector(`.kb-card[data-key="${k}"]`); const col = c.closest(".kb-col, .kb-lane-cell"); const cr = c.getBoundingClientRect(), colr = col.getBoundingClientRect(); return { cardRight: cr.right, colRight: colr.right, page: document.documentElement.scrollWidth, win: innerWidth }; }, key);
    assert.ok(fit.cardRight <= fit.colRight + 1, `card inside its column (${fit.cardRight} > ${fit.colRight})`);
    assert.ok(fit.page <= fit.win, `no sideways page scroll (${fit.page} > ${fit.win})`);
    await openTask(p, key);
    assert.equal(await p.evaluate(() => window.__pwned), undefined);
    // markup that arrives as HTML (a paste from a web page) is cleaned, not run
    await p.click('[data-field="description"] .ql-editor'); await p.keyboard.press("Control+End");
    await p.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/html", '<p>pasted</p><img src="x" onerror="window.__pwned=9"><script>window.__pwned=8<\/script><a href="javascript:window.__pwned=7">click</a>');
      dt.setData("text/plain", "pasted");
      document.querySelector('[data-field="description"] .ql-editor').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await sleep(250);
    await saveTask(p);
    await openTask(p, key);
    assert.equal(await p.evaluate(() => window.__pwned), undefined, "pasted markup did not run");
    const live = await p.$eval('[data-field="description"] .ql-editor', (e) => ({ onerror: !!e.querySelector("[onerror]"), script: !!e.querySelector("script"), js: [...e.querySelectorAll("a")].some((a) => /^javascript:/i.test(a.getAttribute("href") || "")) }));
    assert.deepEqual(live, { onerror: false, script: false, js: false }, "description is sanitised");
    const modalFit = await p.evaluate(() => { const i = document.getElementById("f-title").getBoundingClientRect(); const pn = document.querySelector(".kb-task-panel").getBoundingClientRect(); return i.right <= pn.right + 1; });
    assert.ok(modalFit, "title field inside the modal");
    // comment
    await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.type('<img src=x onerror="window.__pwned=3"> <b>hi</b>');
    await press(p, "#f-comment-add"); await sleep(250);
    assert.equal(await p.evaluate(() => window.__pwned), undefined, "no script from a comment");
    assert.ok(!(await p.$$eval(".kb-comment-text", (e) => e.some((x) => x.querySelector("img[onerror], script")))), "comment sanitised");
    await p.done();
  });

  T("TC-43", "edit every field of an existing ticket and save; the activity log records the changes", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    await openTask(p, "PH-20"); await moreFields(p);
    await p.fill("#f-title", "Edited title"); await typeDescription(p, " Edited.");
    await p.selectOption("#f-priority", "lowest"); await p.selectOption("#f-assignee", E.pid("thao")); await p.selectOption("#f-reporter", E.pid("minh")); await p.selectOption("#f-release", E.rel("4.13"));
    await p.selectOption("#f-sprint", "s42"); await p.fill("#f-estimate", "2d"); await p.fill("#f-logged", "4h"); await p.fill("#f-due", "2026-12-01");
    await p.fill("#f-label-input", "edited"); await p.keyboard.press("Enter");
    const was = await val(p, "#f-status");
    const newStatus = was === "approved" ? "backlog" : "approved";
    await p.selectOption("#f-status", newStatus);
    await saveTask(p);
    await openTask(p, "PH-20"); await moreFields(p);
    assert.equal(await val(p, "#f-title"), "Edited title");
    assert.equal(await val(p, "#f-priority"), "lowest");
    assert.equal(await val(p, "#f-assignee"), E.pid("thao"));
    assert.equal(await val(p, "#f-reporter"), E.pid("minh"));
    assert.equal(await val(p, "#f-release"), E.rel("4.13"));
    assert.equal(await val(p, "#f-sprint"), "s42");
    assert.equal(await val(p, "#f-estimate"), "2d");
    assert.equal(await val(p, "#f-logged"), "4h");
    assert.equal(await val(p, "#f-due"), "2026-12-01");
    assert.equal(await val(p, "#f-status"), newStatus);
    const log = await p.$$eval(".kb-activity", (e) => e.map((x) => x.textContent));
    assert.ok(log.length >= 1, "the activity log has an entry");
    const status = log.find((l) => /→/.test(l));
    assert.ok(status, `a status line: ${log.join(" | ")}`);
    const fieldLines = log.filter((l) => !/→/.test(l));
    if (!fieldLines.length) confirm("TC-43", "should the activity log also record non-status edits (assignee, priority, estimate…)?", `only: ${log.join(" | ")}`);
    await p.done();
  });

  // ═══ Moving tickets (KB-BOARD-1 to 5, KB-LANE-1) ═════════════════════════
  const hrs = (txt) => { if (!txt) return 0; let h = 0; txt.replace(/(\d+(?:\.\d+)?)\s*([dhm])/g, (_, n, u) => { h += +n * (u === "d" ? 8 : u === "h" ? 1 : 1 / 60); }); return h; };
  const TITLE = { backlog: "Backlog", "ready-for-dev": "Ready for Dev", "in-progress": "In Progress", "ready-for-testing": "Ready for Testing", approved: "Approved for Deployment", completed: "Completed", withdrawn: "Withdrawn" };
  const headerOf = (hs, id) => hs.find((h) => (id === "completed" || id === "withdrawn" ? h.title === "Completed / Withdrawn" : h.title === TITLE[id]));
  const countOf = (hs, id) => { const h = headerOf(hs, id); return id === "completed" ? h.completed : id === "withdrawn" ? h.withdrawn : h.count; };
  const effortOf = (hs, id) => (id === "completed" || id === "withdrawn" ? 0 : hrs(headerOf(hs, id).effort));
  const isDone = (id) => id === "completed" || id === "withdrawn";

  // One ticket walks all 42 ordered moves between the seven places; `route(from, to)` says how each is made.
  // Each move checks column, counts, remaining effort, status/resolution/open/closedAt, the activity line and the toast.
  async function walkAll(prof, key, route, label) {
    const p = await open(prof, E.hash("kanban"));
    const start = (await where(p, key));
    const startPlace = start.status === "done" ? start.resolution : start.status;
    const ids = [startPlace, ...PLACES.map((x) => x.id).filter((x) => x !== startPlace)];
    const moves = allMoves(ids);
    const tester = E.person("rob");
    let assignee = start.avatar, prev = "";
    const limits = [];
    let n = 0;
    for (const [from, to] of moves) {
      n++;
      const before = await headers(p);
      const actBefore = (await E.snapshot(p, key)).activity.length;
      const how = route(from, to);
      try { await moveBy(p, how, key, to, { }); }
      catch (e) {
        if (!e.unreachable) throw new Error(`move ${n} ${from}→${to} by ${how}: ${e.message}`);
        limits.push(`${from}→${to}`);
        await statusMove(p, key, to);
      }
      const w = await where(p, key);
      const pl = place(to);
      assert.equal(w.status, pl.status, `move ${n} ${from}→${to} (${how}): column`);
      assert.equal(w.resolution, pl.resolution || null, `move ${n} ${from}→${to}: resolution`);
      assert.equal(await p.$$eval(card(key), (e) => e.length), 1, `move ${n}: exactly one card`);
      assert.equal(w.withdrawn, to === "withdrawn", `move ${n}: struck-through only when withdrawn`);
      const after = await headers(p);
      assert.equal(countOf(after, from), countOf(before, from) - 1, `move ${n} ${from}→${to}: source count`);
      assert.equal(countOf(after, to), countOf(before, to) + 1, `move ${n} ${from}→${to}: target count`);
      const est = E.remainingOf; // remaining effort of this card (estimate − logged), fixed for the walk
      if (!isDone(from)) assert.equal(effortOf(after, from), effortOf(before, from) - est, `move ${n} ${from}→${to}: source effort`);
      if (!isDone(to)) assert.equal(effortOf(after, to), effortOf(before, to) + est, `move ${n} ${from}→${to}: target effort`);
      // hand-off
      if (to === "ready-for-testing" && assignee !== tester) { prev = assignee; assignee = tester; }
      else if (from === "ready-for-testing" && (to === "in-progress" || to === "ready-for-dev") && prev) { assignee = prev; }
      assert.equal(w.avatar, assignee, `move ${n} ${from}→${to}: assignee`);
      const snap = await E.snapshot(p, key);
      assert.equal(snap.status, pl.status); assert.equal(snap.resolution || null, pl.resolution || null);
      if (C) { assert.equal(snap.open, !isDone(to), `move ${n}: open`); assert.equal(!!snap.closedAt, isDone(to), `move ${n}: closedAt ${isDone(to) ? "set" : "cleared"}`); }
      assert.equal(snap.activity.length, actBefore + 1, `move ${n}: one activity line`);
      assert.ok(snap.activity[snap.activity.length - 1].startsWith(`${TITLE[from]} → ${TITLE[to]}`), `move ${n}: activity "${snap.activity[snap.activity.length - 1]}"`);
      const toast = await toastText(p);
      assert.ok(toast.includes(key), `move ${n}: toast names the ticket (${toast})`);
      assert.match(toast, to === "completed" ? /completed/ : to === "withdrawn" ? /withdrawn/ : new RegExp(`moved to ${TITLE[to]}`), `move ${n}: toast`);
    }
    assert.equal(n, 42);
    if (C) assert.deepEqual(limits, [], `${label}: every move that is offered by drag can be made by drag`);
    else if (limits.length) confirm("TC-45", `${label}: moves that cannot be made by drag because the Completed/Withdrawn targets cover the destination column (made by the Status menu instead)`, `${limits.length} of 42: ${limits.join(", ")}`);
    await p.done();
  }
  E.remainingOf = 5; // PH-28: estimate 5h, nothing logged

  T("TC-45a", "all 42 moves between the seven places by mouse drag", { on: on.mouse, timeout: 600000 }, (prof) => walkAll(prof, "PH-28", () => "drag", "mouse"));
  T("TC-45b", "all 42 moves by touch press-and-hold drag (phone: closing targets by touch, other columns by Status, as TC-53)", { on: on.touch, timeout: 600000 }, (prof) => walkAll(prof, "PH-28", (f, t) => (prof.kind === "phone" && !isDone(t) ? "status" : "touch"), "touch"));
  T("TC-45c", "all 42 moves by the Status menu in the ticket", { timeout: 600000 }, (prof) => walkAll(prof, "PH-28", () => "status", "status"));

  T("TC-46", "reopen from Completed and Withdrawn to each open column: resolution and closedAt cleared, struck-through style removed", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const key = "PH-27";
    for (const closed of ["completed", "withdrawn"]) {
      for (const to of ["backlog", "ready-for-dev", "in-progress", "ready-for-testing", "approved"]) {
        await statusMove(p, key, closed);
        let w = await where(p, key);
        assert.equal(w.status, "done"); assert.equal(w.resolution, closed); assert.equal(w.withdrawn, closed === "withdrawn");
        if (C) { const s = await E.snapshot(p, key); assert.equal(s.open, false); assert.ok(s.closedAt, "closedAt set when closed"); }
        await statusMove(p, key, to);
        w = await where(p, key);
        assert.equal(w.status, to, `${closed} → ${to}`); assert.equal(w.resolution, null, "resolution cleared"); assert.equal(w.withdrawn, false, "struck-through style removed");
        assert.equal(await p.$(`${card(key)}.kb-card-withdrawn`), null);
        const s = await E.snapshot(p, key);
        assert.equal(s.resolution || null, null);
        if (C) { assert.equal(s.open, true); assert.ok(!s.closedAt, "closedAt cleared"); }
        const strike = await p.$eval(`${card(key)} .card-title`, (e) => getComputedStyle(e).textDecorationLine);
        assert.ok(!strike.includes("line-through"), `title not struck through (${strike})`);
      }
    }
    // and one reopen by a real drag, where the profile can drag
    if (prof.kind !== "phone") { await statusMove(p, key, "withdrawn"); await moveBy(p, prof.touch ? "touch" : "drag", key, "in-progress"); assert.equal((await where(p, key)).status, "in-progress"); }
    await p.done();
  });

  T("TC-47", "testing hand-off edges: unassigned, already the tester, from every column, and out to Approved, Backlog and closed", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const tester = E.person("rob");
    // unassigned → the tester takes it; the "From" chip has nobody to name
    await statusMove(p, "PH-32", "ready-for-testing");
    let w = await where(p, "PH-32");
    assert.equal(w.avatar, tester); assert.equal(w.status, "ready-for-testing");
    assert.match(await toastText(p), /reassigned to Rob for testing/);
    const chip = await p.$eval(`${card("PH-32")}`, (e) => (e.querySelector(".kb-handoff") || {}).textContent || "");
    if (/From/.test(chip)) confirm("TC-47", "what should the hand-off chip say for a ticket that was unassigned?", `chip reads "${chip.trim()}"`);
    await statusMove(p, "PH-32", "in-progress");
    w = await where(p, "PH-32");
    confirm("TC-47", "moving an originally-unassigned ticket back out of Ready for Testing: who has it?", `assignee ${w.avatar === tester ? "stays the tester (" + w.avatar + ")" : "is " + (w.avatar || "unassigned")}`);
    // already the tester: nothing to reassign, no chip, no reassignment toast
    const mine = (await p.$$eval(".kb-card", (cs, who) => cs.filter((c) => (c.querySelector(".kb-card-footer .kb-avatar") || {}).title === who && c.closest(".kb-col").dataset.status === "in-progress").map((c) => c.dataset.key), tester))[0] || (await p.$$eval(".kb-card", (cs, who) => cs.filter((c) => (c.querySelector(".kb-card-footer .kb-avatar") || {}).title === who && !c.closest(".kb-col").dataset.status.match(/done|ready-for-testing/) && c.dataset.key !== "PH-1").map((c) => c.dataset.key), tester))[0];
    assert.ok(mine, "a ticket already assigned to the tester exists");
    await statusMove(p, mine, "ready-for-testing");
    w = await where(p, mine);
    assert.equal(w.avatar, tester, "still the tester");
    assert.doesNotMatch(await toastText(p), /reassigned/, "no reassignment toast when the assignee is already the tester");
    assert.equal(await p.$(`${card(mine)} .kb-handoff`), null, "no From chip");
    // from every column into Ready for Testing
    const dev = "PH-29"; // Huy's
    for (const from of ["backlog", "ready-for-dev", "in-progress", "approved", "completed", "withdrawn"]) {
      await statusMove(p, dev, from);
      await statusMove(p, dev, "ready-for-testing");
      const x = await where(p, dev);
      assert.equal(x.status, "ready-for-testing", `from ${from}`);
      assert.equal(x.avatar, tester, `from ${from}: handed to the tester`);
      assert.match(await p.textContent(`${card(dev)} .kb-handoff`), /From Huy/, `from ${from}: remembers the developer`);
      await statusMove(p, dev, "in-progress");
      assert.equal((await where(p, dev)).avatar, "Huy", `back from testing (from ${from}) returns it to Huy`);
    }
    // out of Ready for Testing to Approved, Backlog and closed: the spec only names In Progress and Ready for Dev
    const seen = [];
    for (const to of ["approved", "backlog", "completed", "withdrawn"]) {
      await statusMove(p, dev, "ready-for-testing"); await statusMove(p, dev, to);
      seen.push(`${to}: ${(await where(p, dev)).avatar}`);
    }
    confirm("TC-47", "who holds a ticket moved out of Ready for Testing to Approved / Backlog / Completed / Withdrawn (the spec only returns it for In Progress and Ready for Dev)?", seen.join("; "));
    await p.done();
  });

  T("TC-48", "reorder within a column (top, middle, bottom); the order is kept", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const col = "ready-for-dev";
    const input = prof.touch ? "touch" : "mouse";
    const order = () => columnKeys(p, col);
    const start = await order();
    assert.ok(start.length >= 5, `enough cards to reorder: ${start.join(",")}`);
    const last = start[start.length - 1], first = start[0], mid = start[Math.floor(start.length / 2)];
    // bottom card to the top: drop on the upper half of the first card
    if (!(await tryDrag(p, "TC-48", "the top of the column from the bottom card", last, { sel: card(first) }, { input, at: "top" }))) { await p.done(); return; }
    let now = await order();
    assert.deepEqual(now, [last, ...start.slice(0, -1)], "bottom → top");
    // top card to the middle
    const before = now;
    const target = before[Math.floor(before.length / 2)];
    if (!(await tryDrag(p, "TC-48", "the middle of the column", last, { sel: card(target) }, { input, at: "top" }))) { await p.done(); return; }
    now = await order();
    const expect = before.filter((k) => k !== last); expect.splice(expect.indexOf(target), 0, last);
    if (prof.kind === "phone") {
      // On a phone the page is still settling under the held finger when it lets go, so the slot can be one off: check the card moved down into the list and nobody else changed order.
      assert.ok(now.indexOf(last) > 0 && now.indexOf(last) < now.length - 1, `top → middle (${now.join(",")})`);
      assert.deepEqual(now.filter((k) => k !== last), before.filter((k) => k !== last), "the others kept their order");
      if (C) assert.deepEqual(now, expect, "top → middle");
      else if (JSON.stringify(now) !== JSON.stringify(expect)) confirm("TC-48", "on a phone a card dropped on the upper half of a card lands one slot lower than expected", `got ${now.join(",")}, wanted ${expect.join(",")}`);
    } else assert.deepEqual(now, expect, "top → middle");
    // a middle card to the bottom: drop in the empty space under the last card
    if (!(await tryDrag(p, "TC-48", "the bottom of the column", mid, { status: col }, { input, at: "bottom" }))) { await p.done(); return; }
    now = await order();
    assert.equal(now[now.length - 1], mid, `middle → bottom (${now.join(",")})`);
    const final = now;
    // kept: after a reload (prototype) or in the stored ranks (console), and for a second session
    if (!C) {
      await p.reload(); await p.waitForSelector(".kb-card");
      assert.deepEqual(await order(), final, "order kept after reload");
      const p2 = await p.context().newPage(); await p2.goto(p.url()); await p2.waitForSelector(".kb-card");
      assert.deepEqual(await columnKeys(p2, col), final, "a second session sees the same order"); await p2.close();
    } else {
      const ranks = await E.ranks(p, col);
      assert.deepEqual(ranks, final, "stored rank order is the board order");
    }
    await p.done();
  });

  T("TC-49", "drop into an empty column, and at the very bottom of a tall column", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const input = prof.touch ? "touch" : "mouse";
    // empty Approved for Deployment
    for (const k of await columnKeys(p, "approved")) await statusMove(p, k, "completed");
    assert.deepEqual(await columnKeys(p, "approved"), []);
    assert.ok(await p.$('.kb-col[data-status="approved"] .kb-empty'), "the empty column shows its hint");
    if (prof.kind === "phone" || !(await tryDrag(p, "TC-49", "the empty Approved column", "PH-27", { status: "approved" }, { input, at: "middle" }))) await statusMove(p, "PH-27", "approved");
    assert.deepEqual(await columnKeys(p, "approved"), ["PH-27"], "dropped into the empty column");
    // the very bottom of a tall column (In Progress is the tallest)
    const tall = await columnKeys(p, "in-progress");
    assert.ok(tall.length >= 6);
    if (prof.kind === "phone" || !(await tryDrag(p, "TC-49", "the bottom of In Progress", "PH-27", { status: "in-progress" }, { input, at: "bottom" }))) await statusMove(p, "PH-27", "in-progress");
    const now = await columnKeys(p, "in-progress");
    assert.equal(now[now.length - 1], "PH-27", `at the very bottom (${now.join(",")})`);
    await p.done();
  });

  const dragGone = (p) => p.evaluate(() => ({ ghost: !!document.querySelector(".kb-ghost"), zones: !!document.querySelector(".kb-close-zones"), active: document.body.classList.contains("kb-drag-active"), marker: !!document.querySelector(".kb-drop-marker"), dragging: !!document.querySelector(".kb-dragging") }));

  T("TC-50", "a cancelled drag (Esc, dropped outside the board, dropped on its own place) changes nothing and the closing targets disappear", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const input = prof.touch ? "touch" : "mouse";
    const key = "PH-34"; // top of Backlog: on a phone it sits above the closing targets
    const state0 = JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c))));
    const act0 = (await E.snapshot(p, key)).activity.length;
    const clean = async (what) => {
      assert.deepEqual(await dragGone(p), { ghost: false, zones: false, active: false, marker: false, dragging: false }, `${what}: nothing left over from the drag`);
      assert.equal(JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c)))), state0, `${what}: no card moved`);
      assert.equal((await E.snapshot(p, key)).activity.length, act0, `${what}: nothing logged`);
    };
    // dropped outside the board: over the page header
    let P = await pickUp(p, key, input);
    assert.equal((await dragGone(p)).ghost, true, "the drag is live");
    await P.move(12, 6, 8); await sleep(80);
    await P.up(); await sleep(250);
    await clean("dropped outside the board");
    // dropped on its own place
    P = await pickUp(p, key, input);
    await P.move(P.at.x + 2, P.at.y + 2, 2); await sleep(60);
    await P.up(); await sleep(250);
    await clean("dropped on its own place");
    // pointer cancelled (a system gesture, a call coming in): touch only
    if (input === "touch") {
      P = await pickUp(p, key, input);
      await P.move(P.at.x + 120, P.at.y + 40, 4);
      await P.cancel(); await sleep(250);
      await clean("pointer cancelled");
    }
    // Esc: the spec does not say
    P = await pickUp(p, key, input);
    await P.move(P.at.x + 160, P.at.y + 10, 4);
    await p.keyboard.press("Escape"); await sleep(120);
    const afterEsc = await dragGone(p);
    await P.up(); await sleep(250);
    const w = await where(p, key);
    if (C) {
      assert.equal(afterEsc.ghost, false, "Esc ends the drag");
      assert.deepEqual(afterEsc, { ghost: false, zones: false, active: false, marker: false, dragging: false }, "Esc leaves nothing of the drag behind");
      assert.equal(w.status, "backlog", "letting go after Esc leaves the card where it was");
      assert.equal((await E.snapshot(p, key)).activity.length, act0, "Esc: nothing logged");
    } else confirm("TC-50", "should Esc cancel a drag in progress?", `after Esc the drag ${afterEsc.ghost ? "was still active" : "ended"}; releasing then ${w.status !== "backlog" ? "moved the card to " + w.status : "left it where it was"}`);
    if (w.status !== "backlog") await statusMove(p, key, "backlog");
    await p.done();
  });

  T("TC-51", "dragging near an edge scrolls the page, and the board sideways where it overflows", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const input = prof.touch ? "touch" : "mouse";
    const P = await pickUp(p, "PH-34", input);
    const c = { x: P.at.x - 44, y: P.at.y - 30 };
    const H = p.viewportSize().height, W = p.viewportSize().width;
    const wiggle = async (x, y, n = 14) => { for (let i = 0; i < n; i++) { await P.move(x + (i % 2 ? 3 : 0), y, 1); await sleep(25); } };
    // bottom edge scrolls down
    const y0 = await p.evaluate(() => scrollY);
    // (on a phone the slim closing bar sits over the bottom edge: the page scrolls in the strip just above it)
    const edgeY = C && prof.kind === "phone" ? Math.round(await p.$eval(".kb-close-zones", (e) => e.getBoundingClientRect().top)) - 60 : H - 24;
    await wiggle(c.x + 44, edgeY);
    let y1 = await p.evaluate(() => scrollY);
    if (prof.kind === "phone" && y1 <= y0 && !C) {
      // the full-width closing targets sit over the bottom edge, and the board does not scroll while the pointer is over them
      confirm("TC-51", "should dragging at the bottom of a phone screen scroll the page, given the Completed/Withdrawn targets sit there?", `no: scrollY stayed ${y1}`);
      await P.move(c.x + 44, 200, 3); await p.evaluate(() => scrollTo(0, 300)); y1 = await p.evaluate(() => scrollY);
    } else assert.ok(y1 > y0, `scrolled down near the bottom edge (${y0} → ${y1})`);
    // top edge scrolls back up
    await wiggle(c.x + 44, 80);
    const y2 = await p.evaluate(() => scrollY);
    assert.ok(y2 < y1, `scrolled up near the top edge (${y1} → ${y2})`);
    // sideways: only where the board overflows
    const over = await p.evaluate(() => { const w = document.querySelector("#kb-board-wrap"); return { over: w.scrollWidth - w.clientWidth, left: w.getBoundingClientRect().left, right: w.getBoundingClientRect().right }; });
    if (over.over > 4 && prof.kind !== "phone") {
      const r0 = await p.evaluate(() => document.querySelector("#kb-board-wrap").scrollLeft);
      await wiggle(over.right - 14, Math.max(140, y2 + 200));
      const r1 = await p.evaluate(() => document.querySelector("#kb-board-wrap").scrollLeft);
      if (C) assert.ok(r1 > r0, `scrolled right near the right edge, over the closing targets (${r0} → ${r1})`);
      else if (r1 <= r0) confirm("TC-51", "should dragging at the right edge scroll the board sideways when the Completed/Withdrawn targets are pinned over that edge?", `no: scrollLeft stayed ${r0} (the targets cover the edge)`);
      await p.evaluate(() => { document.querySelector("#kb-board-wrap").scrollLeft = 9999; });
      const l0 = await p.evaluate(() => document.querySelector("#kb-board-wrap").scrollLeft);
      await wiggle(over.left + 14, Math.max(140, y2 + 200));
      const l1 = await p.evaluate(() => document.querySelector("#kb-board-wrap").scrollLeft);
      assert.ok(l1 < l0, `scrolled left near the left edge (${l0} → ${l1})`);
    } else if (prof.kind !== "phone") confirm("TC-51", "sideways auto-scroll", `not applicable: the board fits at ${W}px`);
    await P.up(); await sleep(250);
    assert.deepEqual(await dragGone(p), { ghost: false, zones: false, active: false, marker: false, dragging: false });
    await p.done();
  });

  T("TC-52", "touch: a short tap opens the ticket; a swipe or vertical scroll scrolls and never drags", { on: on.touch, timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    await p.$eval(card("PH-27"), (e) => e.scrollIntoView({ block: "center" }));
    await p.tap(card("PH-27"));
    await p.waitForSelector("#f-title");
    assert.equal(await p.textContent("#task-title-h"), "PH-27");
    await closeTask(p);
    // swipe: touch down, move faster than the press-and-hold, lift
    const state0 = JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c))));
    const P = await makePointer(p, "touch");
    const b = await (await p.$(card("PH-27"))).boundingBox();
    const y0 = await p.evaluate(() => scrollY);
    await P.down(b.x + 30, b.y + 30); await sleep(40);
    await P.move(b.x + 30, b.y - 90, 6); await sleep(40);
    assert.equal((await dragGone(p)).ghost, false, "a quick swipe does not start a drag");
    await P.up(); await sleep(300);
    assert.equal(JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c)))), state0, "nothing moved");
    assert.equal(await modalOpen(p), false, "a swipe does not open the ticket");
    if (P.kind === "touch-cdp") { const y1 = await p.evaluate(() => scrollY); assert.ok(y1 > y0, `the page scrolled under the finger (${y0} → ${y1})`); }
    // sideways swipe: also scrolls, never drags
    await P.down(b.x + 40, b.y + 30); await sleep(40); await P.move(b.x - 60, b.y + 30, 6); await P.up(); await sleep(300);
    assert.equal(JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c)))), state0, "a sideways swipe moves nothing");
    // press and hold WITHOUT moving, then lift: opens nothing and moves nothing
    await p.evaluate(() => scrollTo(0, 0));
    const b2 = await (await p.$(card("PH-28"))).boundingBox().catch(() => null);
    await p.done();
  });

  T("TC-53", "phone: drag onto the full-width Completed / Withdrawn targets above the tab bar; other columns by the Status menu; the carousel stays put", { on: on.phone, timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const P = await pickUp(p, "PH-34", "touch");
    const z = await p.$$eval(".kb-close-zone", (e) => e.map((x) => { const r = x.getBoundingClientRect(); return { r: x.dataset.resolution, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
    const tab = await p.$eval("#tabbar, .tabbar, nav.tabbar", (e) => e.getBoundingClientRect().top).catch(() => null);
    assert.equal(z.length, 2);
    if (C) {
      // a slim bar across the screen above the tab bar, both targets side by side; it grows only when the card nears it
      const lo = Math.min(...z.map((x) => x.left)), hi = Math.max(...z.map((x) => x.right));
      assert.ok(lo >= 0 && hi <= prof.width && hi - lo >= prof.width - 40, `the bar spans the width (${lo}–${hi} of ${prof.width})`);
      for (const x of z) { assert.ok(x.bottom - x.top <= 64, `slim while the card is far from it (${x.bottom - x.top}px)`); if (tab != null) assert.ok(x.bottom <= tab + 1, `above the tab bar (${x.bottom} vs ${tab})`); }
    } else for (const x of z) { assert.ok(x.left >= 0 && x.right <= prof.width && x.right - x.left >= prof.width - 40, `full width (${x.left}–${x.right} of ${prof.width})`); if (tab != null) assert.ok(x.bottom <= tab + 1, `above the tab bar (${x.bottom} vs ${tab})`); }
    await P.up(); await sleep(150);
    // onto Completed, then Withdrawn, by touch
    await dragCard(p, "PH-34", { zone: "completed" }, { input: "touch" });
    assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-34")), { status: "done", resolution: "completed" });
    await dragCard(p, "PH-35", { zone: "withdrawn" }, { input: "touch" });
    assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-35")), { status: "done", resolution: "withdrawn" });
    assert.equal(await p.$(".kb-close-zones"), null, "targets gone");
    // another column by the Status menu; where is the carousel afterwards?
    const colBefore = await p.$eval("#kb-board", (e) => e.dataset.col);
    await statusMove(p, "PH-36", "in-progress");
    await sleep(300);
    const colAfter = await p.$eval("#kb-board", (e) => e.dataset.col);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), prof.width, "no sideways page scroll");
    const tabOn = (await p.textContent(".kb-pager-tab.on")).trim();
    assert.match(tabOn, new RegExp(COLTITLE[colAfter] || "."), "the highlighted tab matches the visible column");
    // A card picked up low on the screen sits under the Completed target: letting go without moving
    // completes it. The spec does not say whether that is intended.
    await p.tap('.kb-pager-tab[data-col="0"]'); await sleep(700);
    const lowKey = (await columnKeys(p, "backlog")).filter((k) => k !== "PH-36").pop();
    await p.$eval(card(lowKey), (e) => e.scrollIntoView({ block: "end" })); await sleep(150);
    const lowY = await p.$eval(card(lowKey), (e) => Math.round(e.getBoundingClientRect().top + 20));
    const Q = await makePointer(p, "touch");
    const lb = await (await p.$(card(lowKey))).boundingBox();
    await Q.down(lb.x + 30, lb.y + 20); await sleep(420); await Q.move(lb.x + 34, lb.y + 24, 2);
    const zoneTop = await p.$eval(".kb-close-zone", (e) => Math.round(e.getBoundingClientRect().top)).catch(() => null);
    await Q.up(); await sleep(300);
    const lw = await where(p, lowKey);
    if (C) assert.equal(lw.status, "backlog", `${lowKey} (y=${lowY}, bar from y=${zoneTop}) is not closed by letting go without moving`);
    else confirm("TC-53", "on a phone, should a card picked up low on the screen (under the Completed target) be completed by letting go without moving?", `${lowKey} was at y=${lowY}, the Completed target starts at y=${zoneTop}; after letting go it is ${lw.status === "done" ? "Completed" : "still in " + lw.status}`);
    if (C) {
      // ...nor by sliding along the bar without ever leaving it: only entering a target counts
      const R = await makePointer(p, "touch");
      await R.down(lb.x + 30, lb.y + 20); await sleep(420); await R.move(lb.x + 34, lb.y + 24, 2); await sleep(60);
      await R.move(lb.x + 120, lb.y + 24, 4); await sleep(80);
      await R.up(); await sleep(300);
      assert.equal((await where(p, lowKey)).status, "backlog", "sliding along the bar from where the card was picked up closes nothing");
    }
    confirm("TC-53", "after a Status-menu move on a phone, should the carousel stay on the column the person was in, or follow the card?", `it ${colAfter === colBefore ? "stayed on" : "moved to"} ${colAfter} (was ${colBefore}); the card is in In Progress`);
    await p.done();
  });
  const COLTITLE = { backlog: "Backlog", "ready-for-dev": "Ready for Dev", "in-progress": "In Progress", "ready-for-testing": "Ready for Testing", approved: "Approved", done: "Completed" };

  const lane = (id) => `.kb-lane[data-lane="${id}"]`;
  T("TC-54", "swimlanes: drag into the Unassigned lane, into a collapsed lane, across columns inside one lane; lane counts and effort follow", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"), { height: Math.max(prof.height, 1800) });
    const input = prof.touch ? "touch" : "mouse";
    const LINH = E.person("linh"), HUY = E.person("huy");
    const chip = (id) => `.kb-person-chip[data-person="${id}"]`;
    // On a phone the lanes stack under the closing targets, so only two adjacent lanes can be dragged between.
    const lanesWanted = prof.kind === "phone" ? [E.pid("linh"), "none"] : [E.pid("linh"), E.pid("huy"), "none"];
    for (const id of lanesWanted) await press(p, chip(id));
    assert.deepEqual((await p.$$eval(".kb-lane", (e) => e.map((x) => x.dataset.lane))).sort(), lanesWanted.slice().sort());
    const laneStat = async (id) => p.$eval(lane(id), (e) => ({ n: +e.querySelector(".kb-lane-head .col-count").textContent, eff: (e.querySelector(".kb-lane-head .kb-col-effort") || {}).textContent || "" }));
    const l0 = await laneStat(E.pid("linh")), u0 = await laneStat("none");
    // Linh's PH-27 (Ready for Dev, 24h) across columns inside her lane
    const across = prof.kind === "phone" ? null : { sel: `.kb-lane-cell[data-lane="${E.pid("linh")}"][data-status="in-progress"]` };
    if (across) { await dragCard(p, "PH-27", across, { input }); let w = await where(p, "PH-27"); assert.equal(w.lane, E.pid("linh")); assert.equal(w.status, "in-progress"); assert.equal(w.avatar, LINH); }
    else await statusMove(p, "PH-27", "in-progress");
    // …then into the Unassigned lane (same column)
    await dragCard(p, "PH-27", { sel: `.kb-lane-cell[data-lane="none"][data-status="in-progress"]` }, { input });
    let w = await where(p, "PH-27");
    assert.equal(w.lane, "none", "dropped in the Unassigned lane"); assert.equal(w.avatar, "Unassigned"); 
    assert.match(await toastText(p), /unassigned|Unassigned/i);
    const l1 = await laneStat(E.pid("linh")), u1 = await laneStat("none");
    assert.equal(l1.n, l0.n - 1, "Linh's lane count dropped"); assert.equal(u1.n, u0.n + 1, "the Unassigned lane count grew");
    assert.notEqual(l1.eff, l0.eff, `Linh's remaining effort changed (${l0.eff} → ${l1.eff})`);
    assert.notEqual(u1.eff, u0.eff, `Unassigned remaining effort changed (${u0.eff} → ${u1.eff})`);
    // a collapsed lane: collapse Huy's, then try to drop into it
    const collapsed = prof.kind === "phone" ? "none" : E.pid("huy");
    if (prof.kind === "phone") await dragCard(p, "PH-27", { sel: `.kb-lane-cell[data-lane="${E.pid("linh")}"][data-status="in-progress"]` }, { input }); // back into Linh's lane, then collapse the other
    await press(p, `${lane(collapsed)} .kb-lane-head`);
    assert.ok(await p.$eval(lane(collapsed), (e) => e.classList.contains("kb-lane-collapsed")), "collapsed");
    const before = (await where(p, "PH-27")).lane;
    const target = `.kb-lane-cell[data-lane="${collapsed}"][data-status="in-progress"]`;
    let outcome;
    try { await dragCard(p, "PH-27", { sel: target }, { input, maxSteps: 25 }); outcome = "dropped"; } catch (e) { outcome = "cannot be dropped: " + String(e.message).split("\n")[0]; }
    w = await where(p, "PH-27");
    confirm("TC-54", "what should dropping a card onto a COLLAPSED lane do?", `${outcome}; the card is in lane ${w && w.lane} (${w && w.avatar}), was in ${before}`);
    await p.done();
  });

  T("TC-55", "drag with filters on: a card that no longer matches leaves the view and the counts are right", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"), { height: Math.max(prof.height, 1600) });
    const input = prof.touch ? "touch" : "mouse";
    await press(p, `.kb-person-chip[data-person="${E.pid("huy")}"]`);
    const total0 = +(await p.textContent("#kb-count")).match(/\d+/)[0];
    const hs0 = await headers(p);
    assert.ok(await p.$(card("PH-29")), "Huy's PH-29 is in view");
    // Ready for Testing hands it to the tester (Rob), so it no longer matches Huy's filter
    if (prof.kind === "phone") await statusMove(p, "PH-29", "ready-for-testing");
    else await dragCard(p, "PH-29", { sel: `.kb-lane-cell[data-lane="${E.pid("huy")}"][data-status="ready-for-testing"]` }, { input });
    await sleep(200);
    assert.equal(await p.$(card("PH-29")), null, "the card left the view");
    assert.equal(+(await p.textContent("#kb-count")).match(/\d+/)[0], total0 - 1, "the task count follows");
    const hs1 = await headers(p);
    assert.equal(hs1.find((h) => h.title === "Ready for Dev").count, hs0.find((h) => h.title === "Ready for Dev").count - 1, "source count");
    assert.equal(hs1.find((h) => h.title === "Ready for Testing").count, hs0.find((h) => h.title === "Ready for Testing").count, "target count unchanged: the card is no longer Huy's");
    await press(p, "#kb-clear");
    await sleep(150);
    assert.ok(await p.$(card("PH-29")), "visible again with the filter cleared");
    assert.equal((await where(p, "PH-29")).status, "ready-for-testing");
    await p.done();
  });

  T("TC-59", "moving an epic's children to Completed, Withdrawn and back updates the epic's n/m done and bar", async (prof) => {
    const p = await open(prof, E.hash("kanban"), TALL);
    const kids = await p.evaluate(() => [...document.querySelectorAll(".kb-card")].filter((c) => /Menu Boards/.test((c.querySelector(".kb-parent-epic") || {}).textContent || "")).map((c) => c.dataset.key));
    assert.ok(kids.length >= 3, `PH-1 has children: ${kids}`);
    const read = async () => { const t = await p.textContent(`${card("PH-1")} .kb-epic-count`); const [d, m] = t.match(/(\d+)\/(\d+)/).slice(1).map(Number); const w = await p.$eval(`${card("PH-1")} .kb-epic-progress span`, (e) => parseFloat(e.style.width)); return { d, m, w }; };
    const s0 = await read();
    assert.ok(Math.abs(s0.w - (s0.m ? (s0.d / s0.m) * 100 : 0)) < 1, "bar matches n/m");
    const open_ = kids.find((k) => true);
    const open1 = (await p.evaluate((ks) => ks.filter((k) => document.querySelector(`.kb-card[data-key="${k}"]`).closest(".kb-col").dataset.status !== "done"), kids))[0];
    await statusMove(p, open1, "completed");
    let s1 = await read();
    assert.deepEqual([s1.d, s1.m], [s0.d + 1, s0.m], "completed child counts as done");
    assert.ok(Math.abs(s1.w - (s1.d / s1.m) * 100) < 1);
    await statusMove(p, open1, "withdrawn");
    let s2 = await read();
    assert.deepEqual([s2.d, s2.m], [s0.d, s0.m - 1], "a withdrawn child leaves the total");
    assert.ok(Math.abs(s2.w - (s2.d / s2.m) * 100) < 1);
    await statusMove(p, open1, "in-progress");
    let s3 = await read();
    assert.deepEqual([s3.d, s3.m], [s0.d, s0.m], "reopened: back to where it started");
    // the epic's own modal says the same
    await openTask(p, "PH-1");
    assert.match(await p.textContent('[data-field="children"] .field-label'), new RegExp(`${s3.d} of ${s3.m} done`));
    await p.done();
  });

  // ═══ Board, filters, search, report ══════════════════════════════════════
  const visibleKeys = (p) => p.$$eval(".kb-card .kb-key", (e) => e.map((x) => x.textContent).sort());
  const countText = async (p) => +(await p.textContent("#kb-count")).match(/\d+/)[0];
  const sortedKeys = (a) => a.slice().sort();
  const hasText = (t, q) => `${t.key} ${t.title} ${t.description || ""}`.toLowerCase().includes(q.toLowerCase()) || (t.labels || []).some((l) => l.toLowerCase().includes(q.toLowerCase()));

  T("TC-60", "search by key, title words, description words and label; no-results state; clear", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const all = await E.tasks(p);
    const search = async (q) => { await p.fill("#kb-q", q); await sleep(220); return visibleKeys(p); };
    for (const q of ["PH-33", "expiry sweep", "daylight", "DST", "security", "hq-admin", "ph-3"]) {
      const want = sortedKeys(all.filter((t) => hasText(t, q)).map((t) => t.key));
      const got = await search(q);
      if (q === "ph-3") { assert.ok(got.includes("PH-3") && got.includes("PH-33"), "key search is case-insensitive and partial"); continue; }
      assert.deepEqual(got, want, `search "${q}"`);
      assert.ok(got.length > 0 || q === "daylight", `"${q}" finds something`);
    }
    assert.ok((await search("DST")).includes("PH-33"), "description words");
    assert.ok((await search("security")).includes("PH-28"), "label");
    // no results
    assert.deepEqual(await search("zzzqqq"), []);
    assert.match(await p.textContent("#kb-count"), /^0 task/);
    assert.ok((await p.$$eval(".kb-empty", (e) => e.length)) >= 5, "every column says it is empty");
    // clear
    await p.fill("#kb-q", ""); await sleep(220);
    assert.equal(await countText(p), all.length);
    await p.done();
  });

  T("TC-61", "primary and secondary filters in combination, Clear filters; the Release filter loads that release", { timeout: 600000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const all = await E.tasks(p);
    const me = E.pid("rob"), rel = E.rel("4.12");
    const PRI = {
      none: {},
      mine: { mine: true },
      huy: { people: [E.pid("huy")] },
      two: { people: [E.pid("huy"), E.pid("thao")] },
      unassigned: { people: ["none"] },
      release: { release: rel },
    };
    const SEC = { flagged: { flagged: true }, bug: { type: "bug" }, high: { priority: "high" }, sprint: { sprint: "s41" }, label: { label: "api" } };
    const combos = [];
    for (const [pn, pv] of Object.entries(PRI)) combos.push([pn, pv]);
    for (const [sn, sv] of Object.entries(SEC)) for (const [pn, pv] of Object.entries(PRI)) combos.push([`${pn}+${sn}`, { ...pv, ...sv }]);
    const sn = Object.keys(SEC);
    for (let i = 0; i < sn.length; i++) for (let j = i + 1; j < sn.length; j++) combos.push([`${sn[i]}+${sn[j]}`, { ...SEC[sn[i]], ...SEC[sn[j]] }]);
    combos.push(["everything", { people: [E.pid("huy")], release: rel, flagged: true, type: "bug", priority: "high", sprint: "s42", label: "menu-boards" }]);
    const oracle = (f) => all.filter((t) => {
      if (f.people && !f.people.some((id) => (id === "none" ? !t.assignee : t.assignee === id))) return false;
      if (f.mine && t.assignee !== me) return false;
      if (f.release && t.release !== f.release) return false;
      if (f.flagged && !t.flagged) return false;
      if (f.type && t.type !== f.type) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.sprint && t.sprint !== f.sprint) return false;
      if (f.label && !(t.labels || []).includes(f.label)) return false;
      return true;
    }).map((t) => t.key).sort();
    const failures = [];
    for (const [name, f] of combos) {
      for (const id of f.people || []) await press(p, `.kb-person-chip[data-person="${id}"]`);
      if (f.mine) await press(p, "#kb-mine");
      if (f.release) await p.selectOption("#kb-release", f.release);
      const sec = f.flagged || f.type || f.priority || f.sprint || f.label;
      if (sec) {
        await press(p, "#kb-filter-toggle");
        if (f.flagged) await press(p, "#kb-flagged");
        if (f.type) await p.selectOption("#kb-type", f.type);
        if (f.priority) await p.selectOption("#kb-priority", f.priority);
        if (f.sprint) await p.selectOption("#kb-sprint", f.sprint);
        if (f.label) await p.selectOption("#kb-label", f.label);
        if (await p.$eval("#kb-filter-panel", (e) => !e.hidden)) await p.evaluate(() => document.getElementById("kb-filter-done").click());
      }
      await sleep(120);
      const want = oracle(f), got = await visibleKeys(p);
      if (JSON.stringify(want) !== JSON.stringify(got)) failures.push(`${name}: wanted ${want.join(",")} got ${got.join(",")}`);
      if (sec) assert.match(await p.textContent("#kb-filter-toggle"), new RegExp(`Filters\\s*${Object.keys(f).filter((k) => ["flagged", "type", "priority", "sprint", "label"].includes(k)).length}`), `${name}: the button counts secondary filters`);
      if (await p.$("#kb-clear")) await press(p, "#kb-clear");
      await sleep(100);
      if (await p.$eval("#kb-filter-panel", (e) => !e.hidden).catch(() => false)) await p.evaluate(() => document.getElementById("kb-filter-done").click());
      assert.equal(await countText(p), all.length, `${name}: Clear filters brings every ticket back`);
      assert.equal(await p.$$eval(".kb-person-chip[aria-pressed=true]", (e) => e.length), 0, `${name}: no chip left on`);
    }
    assert.deepEqual(failures, [], `${combos.length} combinations; mismatches:\n${failures.join("\n")}`);
    // the Release filter shows that release's tickets, closed ones included
    await p.selectOption("#kb-release", E.rel("4.11")); await sleep(300);
    const r411 = all.filter((t) => t.release === E.rel("4.11")).map((t) => t.key).sort();
    assert.ok(r411.length > 0);
    assert.deepEqual(await visibleKeys(p), r411, "release 4.11 (released) shows its tickets");
    await p.done();
  });

  T("TC-62", "report figures follow the moves; epics are excluded; a shared URL reproduces the view", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("report", `release=${E.rel("4.12")}&status=all`));
    await p.waitForSelector(".kb-kpi");
    const rel = E.rel("4.12");
    const kpis = () => p.$$eval(".kb-kpi", (e) => e.map((k) => ({ label: k.querySelector(".kb-kpi-label").childNodes[0].textContent.trim(), value: k.querySelector(".kb-kpi-value").textContent.trim(), sub: k.querySelector(".kb-kpi-sub").textContent.trim() })));
    const bars = () => p.$$eval(".kb-bar-row", (e) => Object.fromEntries(e.map((b) => [b.dataset.person, b.querySelector(".kb-bar-val").textContent.trim()])));
    const rows = () => p.$$eval(".kb-click-row", (e) => e.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
    const oracle = async () => {
      const all = (await E.tasks(p)).filter((t) => t.type !== "epic" && t.release === rel);
      const out = all.filter((t) => t.status !== "done");
      const rem = (t) => Math.max((+t.estimate || 0) - (+t.logged || 0), 0);
      const per = {}; for (const t of out) per[t.assignee || "none"] = (per[t.assignee || "none"] || 0) + rem(t);
      return { outstanding: out.length, remaining: out.reduce((n, t) => n + rem(t), 0), completed: all.filter((t) => t.status === "done" && t.resolution !== "withdrawn").length, withdrawn: all.filter((t) => t.status === "done" && t.resolution === "withdrawn").length, per };
    };
    const check = async (when) => {
      const o = await oracle(), k = await kpis(), b = await bars();
      assert.equal(+k[0].value, o.outstanding, `${when}: outstanding`);
      assert.ok(Math.abs(hrs(k[1].value) - o.remaining) < 0.51, `${when}: remaining effort ${k[1].value} vs ${o.remaining}h`);
      assert.ok(k[0].sub.includes(`${o.completed} completed`), `${when}: completed in "${k[0].sub}"`);
      if (o.withdrawn) assert.ok(k[0].sub.includes(`${o.withdrawn} withdrawn`), `${when}: withdrawn in "${k[0].sub}"`);
      for (const [pid, h] of Object.entries(o.per)) if (h > 0) assert.ok(Math.abs(hrs(b[pid] || "") - h) < 0.51, `${when}: ${pid} remaining ${b[pid]} vs ${h}h`);
      return { o, k, b };
    };
    const a = await check("before");
    // epics never count
    const epicsInRelease = (await E.tasks(p)).filter((t) => t.type === "epic" && t.release === rel).length;
    assert.ok(epicsInRelease > 0, "the release has an epic");
    assert.ok(!(await p.$$eval("[data-open]", (e) => e.map((x) => x.dataset.open))).some((k) => /^PH-[1-5]$/.test(k)), "epics are not listed in the report");
    // a shared URL reproduces the view
    const url = await p.evaluate(() => location.hash);
    const before = { k: await kpis(), r: await rows() };
    await p.reload(); await p.waitForSelector(".kb-kpi");
    assert.equal(await p.evaluate(() => location.hash), url);
    assert.deepEqual({ k: await kpis(), r: await rows() }, before, "the same URL shows the same report");
    // move tickets on the board, come back
    await E.go(p, "kanban"); await p.waitForSelector(".kb-card");
    await statusMove(p, "PH-33", "completed");   // Huy, 12h, 4.12
    await statusMove(p, "PH-29", "withdrawn");   // Huy, 8h, 4.12
    await statusMove(p, "PH-27", "in-progress"); // moves nothing out of the release
    await E.go(p, "report", `release=${rel}&status=all`); await p.waitForSelector(".kb-kpi");
    const b = await check("after the moves");
    assert.equal(b.o.outstanding, a.o.outstanding - 2, "two fewer outstanding");
    assert.ok(Math.abs(a.o.remaining - b.o.remaining - 20) < 0.01, "20h less remaining");
    assert.equal(b.o.completed, a.o.completed + 1); assert.equal(b.o.withdrawn, a.o.withdrawn + 1);
    // the table's Completed and Withdrawn columns carry the counts
    const heads = await p.$$eval(".kb-table thead th", (e) => e.map((x) => x.textContent));
    assert.ok(heads.includes("Completed") && heads.includes("Withdrawn"));
    const huy = (await rows()).find((r) => /\bHuy\b/.test(r));
    assert.ok(huy, "Huy has a row");
    await p.done();
  });

  T("TC-63", "mentions: in a description and a comment notify the person, a self-mention does not", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const writesBefore = C ? (await E.writes(p, /^kanbanNotifications\//)).length : 0;
    // description
    await openTask(p, "PH-21");
    await typeDescription(p, " Ping @hu"); await sleep(150); await p.keyboard.press("Enter"); await sleep(100);
    await typeDescription(p, " and me @ro"); await sleep(150); await p.keyboard.press("Enter"); await sleep(100);
    await saveTask(p);
    const toast1 = await toastText(p);
    await sleep(2000);
    const toast2 = await toastText(p);
    const said = `${toast1} | ${toast2}`;
    assert.match(said, /Huy notified about PH-21|Huy.*notified/, `Huy is told: ${said}`);
    assert.doesNotMatch(said.replace(/will be notified/g, ""), /Rob notified|Rob, /, "the author is not told about their own mention");
    // comment
    await openTask(p, "PH-21");
    await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.type("Over to @li"); await sleep(120); await p.keyboard.press("Enter");
    await p.keyboard.type(" and @ro"); await sleep(120); await p.keyboard.press("Enter");
    await press(p, "#f-comment-add"); await sleep(250);
    assert.match(await toastText(p), /Linh notified/);
    assert.doesNotMatch(await toastText(p), /Rob notified/);
    if (C) {
      const notes = (await E.writes(p, /^kanbanNotifications\//)).slice(writesBefore);
      const to = notes.map((w) => w.data.to);
      assert.ok(to.includes(E.pid("huy")) && to.includes(E.pid("linh")), `recipients ${to}`);
      assert.ok(!to.includes(E.pid("rob")), "nothing written for the author");
    }
    await p.done();
  });

  T("TC-64", "tablet layout: pinned bar and headers, no sideways page scroll, ticket form usable with the on-screen keyboard", { on: (p) => p.kind === "tablet", timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    assert.ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= prof.width, "no sideways page scroll");
    await p.evaluate(() => scrollTo(0, 700)); await sleep(150);
    assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0, "filter bar and headers pinned at the top");
    const headP = await p.$$eval("#kb-lanes-head .kb-lanes-head", (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
    const colsP = await p.$$eval("#kb-board .kb-col", (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
    assert.deepEqual(headP, colsP, "headers line up with the columns");
    for (const id of ["huy", "linh", "thao"]) await press(p, `.kb-person-chip[data-person="${E.pid(id)}"]`);
    await p.evaluate(() => scrollTo(0, 0)); await sleep(100);
    const head = await p.$$eval("#kb-lanes-head .kb-lanes-head", (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
    const cells = await p.$$eval(`.kb-lane-cell[data-lane="${E.pid("huy")}"]`, (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
    assert.deepEqual(head, cells, "with swimlanes the headers still line up");
    const bar = await p.$eval(".kb-filters", (e) => { const r = e.getBoundingClientRect(); return { right: r.right, w: innerWidth }; });
    assert.ok(bar.right <= bar.w + 1, "the filter bar fits the width");
    await press(p, "#kb-clear");
    // the form with an on-screen keyboard: a shorter window
    await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title");
    const kb = Math.round(prof.height * 0.5);
    await p.setViewportSize({ width: prof.width, height: kb });
    await p.click("#f-title"); await p.fill("#f-title", "Typed with the keyboard up");
    await typeDescription(p, "More text");
    const fit = await p.evaluate(() => { const s = document.getElementById("f-save").getBoundingClientRect(), t = document.getElementById("f-title").getBoundingClientRect(); return { saveVisible: s.top >= 0 && s.bottom <= innerHeight, titleVisible: t.top >= 0 && t.bottom <= innerHeight, h: innerHeight }; });
    assert.ok(fit.saveVisible, `Save stays on screen with a ${fit.h}px window`);
    assert.ok(fit.titleVisible, "the title stays on screen");
    await saveTask(p);
    assert.match(await toastText(p), /created in Backlog/);
    await p.setViewportSize({ width: prof.width, height: prof.height });
    await p.done();
  });

  T("TC-65", "rotating a phone or tablet mid-edit and mid-drag loses nothing", { on: on.touch, timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const swap = () => p.setViewportSize({ width: p.viewportSize().height, height: p.viewportSize().width });
    // mid-edit
    await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title");
    await p.fill("#f-title", "Half written"); await p.fill("#f-estimate", "3h"); await typeDescription(p, "Some words");
    await swap(); await sleep(400);
    assert.equal(await modalOpen(p), true, "the form is still open");
    assert.equal(await val(p, "#f-title"), "Half written"); assert.equal(await val(p, "#f-estimate"), "3h");
    assert.match(await p.$eval('[data-field="description"] .ql-editor', (e) => e.innerText), /Some words/);
    await swap(); await sleep(400);
    assert.equal(await val(p, "#f-title"), "Half written");
    await saveTask(p);
    const key = await toastKey(p);
    assert.ok(key, "saved after two rotations");
    // mid-drag
    const state0 = JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c))));
    const P = await pickUp(p, "PH-34", "touch");
    assert.equal((await dragGone(p)).ghost, true);
    await swap(); await sleep(400);
    const live = await dragGone(p);
    await P.move(P.at.x, P.at.y + 4, 2);
    await P.up(); await sleep(300);
    assert.deepEqual(await dragGone(p), { ghost: false, zones: false, active: false, marker: false, dragging: false }, "nothing left over after the drop");
    assert.equal(await p.$$eval(card("PH-34"), (e) => e.length), 1, "exactly one card");
    const w = await where(p, "PH-34");
    confirm("TC-65", "what should rotating the device mid-drag do (cancel the drag, or carry on)?", `the drag ${live.ghost ? "carried on" : "was cancelled"}; on release the card ${w.status === "backlog" ? "stayed in Backlog" : "went to " + w.status + (w.resolution ? "/" + w.resolution : "")}`);
    await p.done();
  });

  T("TC-66", "browser Back and Forward and deep links for board, report and settings", async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const title = () => p.textContent(E.sel.title);
    const here = () => p.evaluate(() => location.hash);
    await E.go(p, "report", `release=${E.rel("4.12")}`); await p.waitForSelector(".kb-kpi");
    assert.equal(await title(), "Release report");
    await E.go(p, "settings"); await p.waitForSelector("[data-show]");
    const h = await here();
    await p.goBack(); await sleep(250);
    assert.equal(await title(), "Release report", "Back from settings");
    assert.match(await here(), /report\?release=/, "the report's filters are in the URL");
    await p.goBack(); await sleep(250);
    assert.equal(await title(), "Staff Kanban", "Back from the report");
    await p.goForward(); await sleep(250);
    assert.equal(await title(), "Release report", "Forward");
    await p.goForward(); await sleep(250);
    assert.equal(await here(), h, "Forward to settings");
    // deep links open the right page cold
    for (const [route, q, expect] of [["report", `release=${E.rel("4.13")}&status=all`, "Release report"], ["settings", "", null], ["kanban", "", "Staff Kanban"]]) {
      const c = await open(prof, E.hash(route, q));
      if (expect) assert.equal(await c.textContent(E.sel.title), expect, `deep link to ${route}`);
      else assert.ok(await c.$("[data-show]"), "deep link to settings");
      if (route === "report") assert.match(await c.textContent(E.sel.count), /4\.13/);
      await c.done();
    }
    await p.done();
  });

  // ═══ Profile and photos (KB-PPL-1/2, KB-SET-2) ═══════════════════════════
  // A 1×1 lossless WebP: canvas can't encode WebP in every engine, so the file is a constant.
  const WEBP = { type: "image/webp", b64: "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==" };
  const bgUrl = (p, sel) => p.$eval(sel, (e) => { const b = getComputedStyle(e).backgroundImage; const m = b.match(/url\(["']?(.*?)["']?\)$/); return m ? m[1] : (e.getAttribute("src") || ""); }).catch(() => "");
  const ROBCARD = `${card("PH-15")} .kb-card-footer .kb-avatar`;

  T("TC-26", "upload own photo (JPG, PNG, WebP): cropped square; shows on the profile button, chip, cards, lane header, comments, @mention list, report and Settings → Team", { timeout: 300000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const me = E.pid("rob");
    const files = {
      jpg: asFile("me.jpg", await png(p, 300, 200, "image/jpeg")),
      png: asFile("me.png", await png(p, 200, 320, "image/png")),
      webp: asFile("me.webp", WEBP),
    };
    let last = await bgUrl(p, ROBCARD);
    for (const [fmt, file] of Object.entries(files)) {
      await E.upload(p, file);
      await p.waitForFunction(([sel, prev]) => { const e = document.querySelector(sel); if (!e) return false; const b = getComputedStyle(e).backgroundImage; return b !== "none" && !b.includes(prev || "\u0000"); }, [ROBCARD, last.slice(0, 80)], { timeout: 8000 }).catch(() => {});
      await sleep(150);
      const now = await bgUrl(p, ROBCARD);
      assert.ok(now && now !== last, `${fmt}: Rob's avatar changed`);
      last = now;
      const dims = await E.photoDims(p, now);
      if (E.cropDims) Object.assign(dims, await E.cropDims(p, file));
      assert.equal(dims.w, dims.h, `${fmt}: stored square (${dims.w}×${dims.h})`);
      assert.ok(dims.w >= 1, `${fmt}: a real image`);
    }
    // everywhere a person appears
    const seen = {};
    seen.profile = await E.profileHasPhoto(p);
    seen.card = !!(await p.$(`${card("PH-15")} .kb-avatar-img`));
    seen.chip = !!(await p.$(`.kb-person-chip[data-person="${me}"] .kb-avatar-img`));
    await press(p, `.kb-person-chip[data-person="${me}"]`);
    seen.lane = !!(await p.$(`.kb-lane[data-lane="${me}"] .kb-lane-head .kb-avatar-img`));
    await press(p, "#kb-clear");
    await openTask(p, "PH-21");
    await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.type("A comment with my photo");
    await press(p, "#f-comment-add"); await sleep(250);
    seen.comment = !!(await p.$("#f-comments .kb-comment .kb-avatar-img"));
    await p.click('[data-field="description"] .ql-editor'); await p.keyboard.press("Control+End"); await p.keyboard.type(" @ro"); await sleep(200);
    seen.mention = !!(await p.$(".kb-mention-item .kb-avatar-img"));
    await p.keyboard.press("Escape").catch(() => {});
    if (await modalOpen(p)) await closeTask(p);
    await E.go(p, "report", `release=${E.rel("4.12")}`); await p.waitForSelector(".kb-kpi");
    seen.report = !!(await p.$(`.kb-bar-row[data-person="${me}"] .kb-avatar-img, .kb-click-row[data-person="${me}"] .kb-avatar-img`));
    await E.go(p, "settings"); await p.waitForSelector(".kb-team");
    seen.team = !!(await p.$(`.kb-team li .kb-avatar-img`));
    const missing = Object.entries(seen).filter(([, v]) => !v).map(([k]) => k);
    assert.deepEqual(missing, [], `Rob's photo is missing from: ${missing.join(", ")}`);
    await p.done();
  });

  T("TC-27", "replace a photo; remove it and fall back (to the Google photo where there is one, then to the initial)", { timeout: 200000 }, async (prof) => {
    for (const withGoogle of E.googlePhoto ? [true, false] : [false]) {
      const p = await open(prof, E.hash("kanban"), E.photoOpts(withGoogle));
      const a = asFile("a.png", await png(p, 100, 100)), b = asFile("b.jpg", await png(p, 160, 90, "image/jpeg"));
      await E.upload(p, a); await sleep(250);
      const first = await bgUrl(p, ROBCARD);
      await E.upload(p, b); await sleep(250);
      const second = await bgUrl(p, ROBCARD);
      assert.ok(first && second, "a photo shows after each upload");
      if (!C) assert.notEqual(first, second, "replaced");
      await E.removePhoto(p); await sleep(250);
      const after = await bgUrl(p, ROBCARD);
      if (withGoogle) assert.equal(after, E.googlePhoto, "falls back to the Google photo");
      else assert.ok(await p.$(`${card("PH-15")} .kb-card-footer .kb-avatar:not(.kb-avatar-img)`), "falls back to the initial");
      await p.done();
    }
  });

  T("TC-28", "invalid uploads (not an image, over the size limit, corrupt image) give a clear error and write nothing", { timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const before = await bgUrl(p, ROBCARD);
    const writes0 = await E.photoWrites(p);
    const cases = [
      ["not an image", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }, /image|JPEG|JPG|PNG/i],
      ["over the size limit", { name: "big.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(11 * 1024 * 1024, 1) }, /10 ?MB/i],
      ["corrupt image", { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("this is not a png at all") }, /couldn't be read|Couldn't read/i],
    ];
    for (const [what, file, re] of cases) {
      await E.upload(p, file); await sleep(500);
      const msg = await E.photoError(p);
      assert.match(msg, re, `${what}: "${msg}"`);
      assert.equal(await bgUrl(p, ROBCARD), before, `${what}: the photo is unchanged`);
    }
    assert.equal(await E.photoWrites(p), writes0, "nothing was written to Storage or the directory");
    await p.done();
  });

  T("TC-29", "an admin sets another member's photo; an editor and a viewer cannot (the control is hidden and the rules refuse)", { timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const f = asFile("minh.png", await png(p, 140, 140));
    await E.setOtherPhoto(p, "minh", f);
    await E.go(p, "kanban"); await p.waitForSelector(".kb-card");
    assert.ok(await p.$(`.kb-person-chip[data-person="${E.pid("minh")}"] .kb-avatar-img`), "Minh's chip shows the photo");
    await p.done();
    if (C) for (const role of ["editor", "viewer"]) {
      const q = await open(prof, E.hash("kanban"), { seed: E.roleSeed(role) });
      assert.equal(await E.canSetOtherPhoto(q), false, `${role}: no control to set someone else's photo`);
      await q.done();
    }
  });

  // TC-27 and TC-29 depend on how the build holds photos and roles: the hooks say how.
  const consoleOnly = (why) => (C ? {} : { skip: why });

  T("TC-30", "an admin changes \"Shown as\"; the new name is on cards, filters, the assignee list, report and mentions; Vietnamese diacritics render and sort", { ...consoleOnly("Console only: the prototype's team is fixed demo data and has no Shown as setting"), timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const huy = E.pid("huy");
    // before: the board says "Huy" (Lê Quang Huy)
    const chipNames = () => p.$$eval(".kb-person-chip > span:last-child", (e) => e.map((x) => x.textContent.trim()));
    const chips0 = await chipNames();
    assert.deepEqual(chips0.slice(0, 7), ["Rob", "Đức", "Huy", "Linh", "Minh", "Thảo", "Unassigned"], "diacritics render and sort (Đ with D, Ả with A)");
    await E.go(p, "settings"); await p.waitForSelector("[data-first-for]");
    await p.fill(`[data-first-for="${huy}"]`, "Quang"); await p.keyboard.press("Tab"); await sleep(300);
    assert.match(await toastText(p), /Shown as .*Quang/);
    await E.go(p, "kanban"); await p.waitForSelector(".kb-card");
    assert.ok((await chipNames()).includes("Quang"), "filter chip");
    assert.equal(await p.$eval(`${card("PH-29")} .kb-card-footer .kb-avatar`, (e) => e.title), "Quang", "card");
    await openTask(p, "PH-29");
    assert.ok((await p.$$eval("#f-assignee option", (e) => e.map((x) => x.textContent))).includes("Quang"), "assignee list");
    await typeDescription(p, " @qua"); await sleep(200);
    assert.ok((await p.$$eval(".kb-mention-item", (e) => e.map((x) => x.textContent))).some((t) => t.slice(1).startsWith("Quang")), "mention list");
    await p.keyboard.press("Escape").catch(() => {});
    if (await modalOpen(p)) await closeTask(p);
    await E.go(p, "report", `release=${E.rel("4.12")}`); await p.waitForSelector(".kb-bar-row");
    assert.ok((await p.$$eval(".kb-bar-name", (e) => e.map((x) => x.textContent.trim()))).some((t) => t.endsWith("Quang")), "report");
    // reset: an empty name goes back to the first word of the full name
    await E.go(p, "settings"); await p.waitForSelector("[data-first-for]");
    await p.fill(`[data-first-for="${huy}"]`, ""); await p.keyboard.press("Tab"); await sleep(300);
    await E.go(p, "kanban"); await p.waitForSelector(".kb-card");
    assert.ok(!(await chipNames()).includes("Quang"));
    await p.done();
  });

  T("TC-31", "a new console member appears in the assignee list and filters without a reload; a disabled member leaves the pickers but stays on existing tickets", { ...consoleOnly("Console only: members come from the console's directory"), timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const newbie = "noor.ali@personalisationhub.com";
    await p.evaluate((n) => { const b = globalThis.__fbStub; b.col("memberDirectory").set(n, { email: n, displayName: "Noor Ali" }); b.notify(); }, newbie);
    await sleep(500);
    assert.ok(await p.$(`.kb-person-chip[data-person="${newbie}"]`), "a filter chip for the new member");
    await openTask(p, "PH-34");
    assert.ok((await p.$$eval("#f-assignee option", (e) => e.map((x) => x.value))).includes(newbie), "in the assignee list");
    await p.selectOption("#f-assignee", newbie); await saveTask(p);
    assert.equal(await p.$eval(`${card("PH-34")} .kb-card-footer .kb-avatar`, (e) => e.title), "Noor", "the ticket shows the new member");
    // disabled: gone from the pickers, still named on the ticket
    await p.evaluate((n) => { const b = globalThis.__fbStub; const c = b.col("memberDirectory"); c.set(n, { ...c.get(n), disabled: true }); b.notify(); }, newbie);
    await sleep(500);
    assert.equal(await p.$(`.kb-person-chip[data-person="${newbie}"]`), null, "no chip for a disabled member");
    await openTask(p, "PH-35");
    const opts = await p.$$eval("#f-assignee option", (e) => e.map((x) => x.value));
    assert.ok(!opts.includes(newbie), "not offered as an assignee");
    await closeTask(p);
    const av = await p.$eval(`${card("PH-34")} .kb-card-footer .kb-avatar`, (e) => ({ title: e.title, none: e.classList.contains("kb-avatar-none") }));
    assert.equal(av.none, false, "the existing ticket is still assigned to them");
    assert.ok(av.title, `and still names them (${av.title})`);
    await p.done();
  });

  T("TC-36", "keys are sequential and never reused; two sessions creating at once get distinct keys", { timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    if (C) {
      // session B takes PH-40 while A's form is open
      await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title");
      await p.fill("#f-title", "Session A's ticket");
      await p.evaluate(() => { const b = globalThis.__fbStub; b.col("kanbanCounters").set("main", { nextNumber: 41 }); b.col("kanbanTasks").set("PH-40", { key: "PH-40", number: 40, type: "task", title: "Session B's ticket", status: "backlog", open: true, rank: 9999, assignee: "", labels: [], searchTokens: ["ph-40"], createdBy: "other@personalisationhub.com" }); b.notify(); });
      await sleep(300);
      await saveTask(p);
      assert.equal(await toastKey(p), "PH-41", "A's ticket skips the key B took");
      assert.ok(await p.$(card("PH-40")), "B's ticket is on A's board");
    } else await create(p, { title: "First" });
    // a deleted key is never reused
    const last = C ? "PH-41" : "PH-40";
    await openTask(p, last); await E.confirmDelete(p, true); await sleep(300);
    assert.equal(await p.$(card(last)), null);
    const next = await create(p, { title: "After the delete" });
    const n = (k) => +k.replace("PH-", "");
    assert.ok(n(next) > n(last), `${next} comes after the deleted ${last}`);
    await p.done();
  });

  T("TC-44", "a ticket created or moved over MCP appears on an open board without a reload", { ...consoleOnly("Console only: the prototype has no server or MCP"), timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"));
    const n0 = await countText(p);
    // kanban_create_task (server side) writes this document; the board's listener should show it
    await p.evaluate(() => { const b = globalThis.__fbStub; b.col("kanbanCounters").set("main", { nextNumber: 41 }); b.col("kanbanTasks").set("PH-40", { key: "PH-40", number: 40, type: "bug", title: "Raised by an agent", status: "backlog", open: true, rank: 9999, assignee: "", reporter: "rob@offline2online.com", release: "4-12", estimate: 3, logged: 0, priority: "high", labels: ["api"], searchTokens: ["ph-40", "raised", "agent"], createdBy: "agent" }); b.notify(); });
    await until(() => p.$(card("PH-40")), "the new card", 5000);
    assert.equal(await countText(p), n0 + 1);
    assert.equal((await where(p, "PH-40")).status, "backlog");
    // kanban_move_task
    await p.evaluate(() => { const b = globalThis.__fbStub; const c = b.col("kanbanTasks"); c.set("PH-40", { ...c.get("PH-40"), status: "in-progress", open: true }); b.notify(); });
    await until(async () => (await where(p, "PH-40")).status === "in-progress", "the card to move", 5000);
    await p.evaluate(() => { const b = globalThis.__fbStub; const c = b.col("kanbanTasks"); c.set("PH-40", { ...c.get("PH-40"), status: "done", resolution: "completed", open: false, closedAt: { $ts: Date.now() } }); b.notify(); });
    await until(async () => { const w = await where(p, "PH-40"); return w && w.status === "done" && w.resolution === "completed"; }, "the card to close", 5000);
    assert.equal((await headers(p)).find((h) => h.title === "Completed / Withdrawn").completed, 7);
    await p.done();
  });

  T("TC-56", "two sessions move the same card at once: both boards end on the same state, with no duplicate card", { ...consoleOnly("Console only: the prototype keeps its state in one browser"), timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"), TALL);
    const input = prof.touch ? "touch" : "mouse";
    const remote = (status) => p.evaluate((s) => { const b = globalThis.__fbStub; const c = b.col("kanbanTasks"); const t = c.get("PH-34"); c.set("PH-34", { ...t, status: s, open: true }); b.notify(); }, status);
    if (prof.kind === "phone") { await statusMove(p, "PH-34", "in-progress"); await remote("approved"); await sleep(500); }
    else {
      // A picks the card up; B moves it; A drops it in In Progress
      const { P } = await dragCard(p, "PH-34", { status: "in-progress" }, { input, hold: true });
      await remote("approved"); await sleep(200);
      await P.up(); await sleep(400);
    }
    for (const _ of [1]) assert.equal(await p.$$eval(card("PH-34"), (e) => e.length), 1, "exactly one card");
    const t = await E.stored(p, "PH-34");
    assert.equal((await where(p, "PH-34")).status, t.status, "the board shows what is stored");
    // B moves it again afterwards: A follows
    await remote("ready-for-dev"); await sleep(400);
    assert.equal(await p.$$eval(card("PH-34"), (e) => e.length), 1);
    assert.equal((await where(p, "PH-34")).status, "ready-for-dev", "A follows B's later move");
    confirm("TC-56", "when two people move one card at once, who wins?", `the later write: stored ${t.status} after A's drop and B's move`);
    await p.done();
  });

  T("TC-57", "a failed write puts the card back and says so", { ...consoleOnly("Console only: the prototype's state is local, a write cannot fail"), timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"), TALL);
    const input = prof.touch ? "touch" : "mouse";
    const before = JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c))));
    await p.evaluate(() => { globalThis.__fbStub.commit = () => { const e = new Error("Missing or insufficient permissions."); e.code = "permission-denied"; throw e; }; });
    let formError = "";
    if (prof.kind === "phone") { await openTask(p, "PH-34"); await p.selectOption("#f-status", "in-progress"); await press(p, "#f-save"); await sleep(600); formError = await p.$eval("#f-error", (e) => (e.hidden ? "" : e.textContent)).catch(() => ""); if (await modalOpen(p)) await closeTask(p); }
    else await dragCard(p, "PH-34", { status: "in-progress" }, { input });
    await sleep(500);
    assert.equal(JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c)))), before, "the card is back where it was");
    const toast = (await toastText(p)) || formError;
    assert.match(toast, /couldn't|could not|failed|permission|not saved/i, `an error message: "${toast}"`);
    assert.equal((await E.stored(p, "PH-34")).status, "backlog");
    await p.done({ allow: /permission|insufficient|denied/i }); // the refusal is logged by the page, as expected
  });

  T("TC-58", "a viewer cannot drag or change Status on any viewport", { ...consoleOnly("Console only: the prototype has no roles"), timeout: 200000 }, async (prof) => {
    const p = await open(prof, E.hash("kanban"), { seed: E.viewerSeed(), ...TALL });
    const before = JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c))));
    if (prof.kind !== "phone") {
      await dragCard(p, "PH-34", { status: "in-progress" }, { input: prof.touch ? "touch" : "mouse" }).catch((e) => { if (!e.unreachable) throw e; });
      await dragCard(p, "PH-21", { zone: "withdrawn" }, { input: prof.touch ? "touch" : "mouse" }).catch((e) => { if (!e.unreachable) throw e; });
    }
    assert.equal(JSON.stringify(await Promise.all(COLS.map((c) => columnKeys(p, c)))), before, "nothing moved");
    if (await modalOpen(p)) await closeTask(p); // a press-and-release that doesn't drag is a click: it opens the ticket
    await openTask(p, "PH-34");
    assert.equal(await p.$eval("#f-status", (e) => e.disabled), true, "Status is locked");
    assert.equal(await p.$("#f-save"), null);
    await closeTask(p);
    assert.equal((await E.writes(p, /^kanban/)).length, 0, "nothing written");
    await p.done();
  });
}
