// New Item modal, voice-first (Kanban-prototype parity), in Chromium against
// the REAL backlog-tracker/public/ files with the Firebase SDK stubbed and a
// scripted SpeechRecognition + getUserMedia (the same idea as
// dictation.test.mjs, but with real layout): the Record button's states, the
// live transcript, the agent filling Title / Description / Type / Area with
// "Agent" marks, the typed fallback, the primary button following the type,
// an inline error when the microphone is denied, and the pinned action bar.
// Runs at 1280 px and 390 px.
// Run with:  cd backlog-tracker/test && node ui/new-item-voice.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const WIDTHS = [1280, 390];
const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const seed = {
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { p1: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    backlogItems: {
      b1: { projectId: "p1", title: "Purple widget", desc: "Make the widget purple everywhere", type: "feature", category: "HQ Admin", status: "backlog", createdAt: t(T0 + 1), updatedAt: t(T0 + 1) },
    },
  },
};

// Injected before app.js runs.
const speechStub = () => {
  window.__btDictationTuning = { probeReleaseMs: 5, agentMs: 60 };
  class FakeRecognition {
    constructor() { this.state = "idle"; this.results = []; (window.__sr ||= []).push(this); }
    start() { this.state = "running"; this.results = []; setTimeout(() => { this.onstart && this.onstart(); this.onaudiostart && this.onaudiostart(); }, 0); }
    stop() { if (this.state !== "running") return; this.state = "idle"; setTimeout(() => this.onend && this.onend(), 5); }
    abort() { this.state = "idle"; }
    say(transcript, isFinal) {
      const last = this.results.length - 1;
      const index = last >= 0 && !this.results[last].isFinal ? last : this.results.length;
      this.results[index] = Object.assign([{ transcript }], { isFinal });
      this.onresult && this.onresult({ resultIndex: index, results: this.results });
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.__live = () => (window.__sr || []).filter((r) => r.state === "running").pop();
  window.__say = (text, isFinal) => window.__live().say(text, isFinal);
  window.__endByItself = () => { const r = window.__live(); r.state = "idle"; r.onend && r.onend(); };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: async () => {
      if (window.__denyMic) { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; }
      return { getTracks: () => [{ stop() {} }] };
    },
  } });
};

const text = (page, sel) => page.locator(sel).first().innerText();
const h = await startHarness();
let failed = 0;
try {
  for (const width of WIDTHS) {
    const o = await h.open({ seed, width, height: 900 });
    await o.context.addInitScript(speechStub);
    const { page } = o;
    await page.reload({ waitUntil: "domcontentloaded" });
    try {
      await until(() => page.locator(".new-item-btn").count(), "board renders");
      const openModal = async () => { await page.click(".new-item-btn"); await page.waitForSelector("#ni-backdrop", { state: "visible" }); };
      await openModal();

      // 1. Record button on top; no mic inside the description box.
      assert.equal(await text(page, "#ni-record-label"), "Record item");
      assert.equal(await text(page, "#ni-record-sub"), "Say what needs doing");
      assert.equal(await page.locator("#ni-backdrop .mic-btn").count(), 0, "no in-textarea mic on this modal");
      const order = await page.evaluate(() => ["ni-mic-btn", "ni-title-input", "ni-desc-input", "ni-category-select"].map((id) => document.getElementById(id).getBoundingClientRect().top));
      assert.deepStrictEqual([...order].sort((a, b) => a - b), order, "Record, Title, Description, Area top to bottom");
      assert.equal(await text(page, "#ni-submit"), "Create feature");
      assert.equal(await text(page, "#ni-title"), "New feature");

      // 2. Record: red state, timer, live transcript.
      await page.click("#ni-mic-btn");
      await page.waitForSelector("#ni-mic-btn.listening");
      assert.equal(await text(page, "#ni-record-label"), "Stop recording");
      await until(async () => /^Listening · 0:0[1-9]/.test(await text(page, "#ni-record-sub")), "the timer to tick");
      assert.equal(await page.locator("#ni-transcript").getAttribute("placeholder"), "Listening…");
      assert.ok(await page.locator("#ni-transcript").isVisible(), "transcript box shown");
      await until(() => page.evaluate(() => !!window.__live()), "a live recognition");
      await page.evaluate(() => window.__say("there's a bug where the help centre search", false));
      assert.match(await page.inputValue("#ni-transcript"), /help centre search/, "interim words appear live");
      // 3. The browser's silence auto-stop must not end the recording.
      await page.evaluate(() => { window.__say("there's a bug where the help centre search returns archived articles, it's quite urgent", true); window.__endByItself(); });
      await until(() => page.evaluate(() => !!window.__live()), "the recogniser restarting by itself");
      assert.ok(await page.locator("#ni-mic-btn.listening").count(), "still recording after the engine's own end");

      // 4. Stop: agent fills the ticket.
      await page.click("#ni-mic-btn");
      await until(async () => (await page.inputValue("#ni-title-input")) !== "", "the agent to fill the title");
      assert.equal(await page.inputValue("#ni-title-input"), "Help centre search returns archived articles");
      assert.match(await page.inputValue("#ni-desc-input"), /^There's a bug where the help centre search returns archived articles\.$/);
      assert.equal(await text(page, "#ni-submit"), "Raise bug");
      assert.equal(await text(page, "#ni-title"), "New bug");
      assert.equal(await page.locator("#ni-backdrop .type-opt.active").getAttribute("data-type"), "bug");
      assert.equal(await page.locator(".ni-field.ni-agent-filled").count(), 4, "all four fields carry the Agent mark");
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ni-field[data-ni-field="title"] .field-label'), "::after").content), '"Agent"');
      assert.match(await text(page, "#ni-toast"), /Agent filled in 4 fields\. Check them before creating/);
      await until(async () => (await text(page, "#ni-record-label")) === "Record again", "Record again label");
      assert.equal(await text(page, "#ni-record-sub"), "Replaces the details below");

      // 5. Edit, flip the type, submit: the card is what was on screen.
      await page.fill("#ni-title-input", "Search shows archived articles");
      assert.equal(await page.locator('.ni-field[data-ni-field="title"].ni-agent-filled').count(), 0, "editing a field removes its Agent mark");
      await page.click('#ni-backdrop .type-opt[data-type="feature"]');
      assert.equal(await text(page, "#ni-submit"), "Create feature");
      await page.selectOption("#ni-category-select", "HQ Admin");
      await page.click("#ni-submit");
      await page.waitForSelector("#ni-backdrop", { state: "hidden" });
      const writes = await page.evaluate(() => window.__fbStub.writes);
      const add = writes.find((x) => x.op === "add" && x.path.startsWith("backlogItems/"));
      assert.ok(add, `a card was created, got ${JSON.stringify(writes)}`);
      assert.equal(add.data.title, "Search shows archived articles");
      assert.equal(add.data.type, "feature");
      assert.equal(add.data.category, "HQ Admin");

      // 6. Typed fallback.
      await openModal();
      assert.equal(await page.inputValue("#ni-title-input"), "", "a blank form on open");
      await page.fill("#ni-desc-input", "The retail admin store grid is broken on mobile");
      await page.click("#ni-agent-btn");
      await until(async () => (await page.inputValue("#ni-title-input")) !== "", "the typed fallback to fill the title");
      assert.equal(await page.inputValue("#ni-title-input"), "Retail admin store grid is broken on mobile");
      assert.equal(await page.inputValue("#ni-category-select"), "Retail Admin");
      assert.equal(await text(page, "#ni-submit"), "Raise bug");

      // 7. Microphone denied: a clear inline error, nothing hangs.
      await page.evaluate(() => { window.__denyMic = true; });
      await page.click("#ni-mic-btn");
      await page.waitForSelector("#ni-mic-error.on");
      assert.match(await text(page, "#ni-mic-error"), /blocked/);
      assert.equal(await page.locator("#ni-mic-btn.listening").count(), 0);
      assert.equal(await text(page, "#ni-record-label"), "Record item");

      // 8. Pinned action bar: stays visible when the modal scrolls.
      await page.setViewportSize({ width, height: 420 });
      const scrolls = await page.evaluate(() => { const p = document.querySelector("#ni-backdrop .modal-panel"); return p.scrollHeight > p.clientHeight; });
      assert.ok(scrolls, "the modal scrolls at this height");
      for (const to of ["top", "bottom"]) {
        await page.evaluate((w) => { const p = document.querySelector("#ni-backdrop .modal-panel"); p.scrollTop = w === "top" ? 0 : p.scrollHeight; }, to);
        const r = await page.evaluate(() => {
          const panel = document.querySelector("#ni-backdrop .modal-panel").getBoundingClientRect();
          const c = document.getElementById("ni-cancel").getBoundingClientRect();
          const s = document.getElementById("ni-submit").getBoundingClientRect();
          return { panelBottom: panel.bottom, cancel: [c.top, c.bottom], submit: [s.top, s.bottom], vh: innerHeight, sticky: getComputedStyle(document.querySelector(".ni-actions")).position };
        });
        assert.equal(r.sticky, "sticky");
        for (const [top, bottom] of [r.cancel, r.submit]) assert.ok(top >= 0 && bottom <= Math.min(r.vh, r.panelBottom + 1), `Cancel/primary visible with the modal scrolled to ${to}: ${JSON.stringify(r)}`);
      }
      assert.deepStrictEqual(o.problems, [], "page/console problems");
      console.log(`PASS new-item-voice @${width}px`);
    } catch (e) { failed++; console.log(`FAIL new-item-voice @${width}px: ${e.message}`); }
    await o.close();
  }
} finally { await h.close(); }
process.exit(failed ? 1 : 0);
