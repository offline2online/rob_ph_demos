// node ph-website/tests/operator.test.mjs : the hidden Be Your Own Boss page (/be-your-own-boss/) in Chromium (operator.php's server-rendered body, operator.css,
// operator.js, site.js), with the real tour.html served at /industries/retail-media/tour/. Copy and section order, the calculator defaults and
// live updates, tooltips (hover, focus, tap), no commercial terms, the gate (disabled until valid, the body it posts, ph_operator and ph_lead,
// an existing ph_lead never overwritten), the tour framed in place and unlocked with no form, Start the tour plays a step, returning visitors,
// the header's Arrange A Demo, no horizontal scroll at 360/390/768/1440, and enhance.js's known-visitor rule (name, company and email).
// The retired offer name (checked with the pattern fr[a]nch, so this file never contains it) appears nowhere: not in the visible text,
// any attribute, the title, meta or URL, the loaded CSS/JS file names and contents, localStorage keys or dataLayer events. The three
// copy replacements are exact; the header item is "Be Your Own Boss"; the dataLayer and ph_lead source say "Network operator inquiry";
// the gate posts to ph-site/v1/operator-lead. Touch: every "i" info button has a hit area of at least 44x44. Tablets: iPad Mini,
// iPad (gen 7), iPad Pro 11 and Galaxy Tab S4, portrait and landscape, touch on (iPad user agents on the iPads): no horizontal scroll,
// calculator, tooltips by tap, the 44x44 hit area, the gate unlocking the tour, the tour playing and its full-screen fallback.
// Skips (exit 0) when Playwright, Chromium or php is not available.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import assert from "assert";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require("playwright")); } catch { console.log("operator: playwright not installed here; skipping"); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "snippets", "ph-industry-enhancements");
const r = spawnSync("php", [path.join(here, "operator-render.php")], { encoding: "utf8" });
if (r.error) { console.log("operator: php not installed here; skipping"); process.exit(0); }
assert.strictEqual(r.status, 0, "operator-render.php: " + r.stderr);
const body = r.stdout;
const hr = spawnSync("php", [path.join(here, "operator-render.php"), "head"], { encoding: "utf8" });
assert.strictEqual(hr.status, 0, "operator-render.php head: " + hr.stderr);
const head = JSON.parse(hr.stdout);
assert.strictEqual(head.title, "Be Your Own Boss - Personalisation Hub", "document title");
assert.strictEqual(head.menu.title, "Be Your Own Boss", "menu item title");
assert.strictEqual(head.menu.url, "http://x.test/be-your-own-boss/", "menu item URL");
const OLD = /fr[a]nch/i;
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const css = fs.readFileSync(path.join(dir, "operator.css"), "utf8");
const js = fs.readFileSync(path.join(dir, "operator.js"), "utf8");
const site = fs.readFileSync(path.join(dir, "site.js"), "utf8");
const tourHtml = fs.readFileSync(path.join(dir, "tour", "tour.html"), "utf8");
const F = require(path.join(dir, "operator.js"));

// Model parity with the design (and operator_calc in PHP).
const d = F.view(F.calc({ ven: 90, dis: 3, vis: 800, cpm: 25, atv: 25, view: 60, up: 15 }));
assert.deepStrictEqual(d, { yours: "$591K", venues: "90", displays: "270", visitors: "2,190,000", views: "3,942,000", extraSales: "$59.1M" }, "defaults");

// The site's header (Industry, Support, Arrange A Demo as an Elementor popup link) and footer around the shortcode output.
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(head.title)}</title><meta property="og:title" content="${esc(head.title)}"><meta property="og:url" content="${esc(head.menu.url)}"><link rel="canonical" href="${esc(head.menu.url)}"><style>body{margin:0;font-family:Arial}</style><style>${css}</style></head><body>
<header class="elementor-location-header" style="position:sticky;top:0;z-index:5;background:#fff;height:72px"><nav><ul><li class="menu-item"><a href="/industries/">Industry</a></li><li class="${esc(head.menu.classes)}"><a href="${esc(head.menu.url)}" aria-current="${esc(head.menu.atts["aria-current"])}">${esc(head.menu.title)}</a></li><li class="menu-item"><a href="/support-centre/">Support</a></li></ul></nav>
<a class="elementor-button" id="hdr-demo" href="#elementor-action%3Aaction%3Dpopup%3Aopen%26settings%3DeyJpZCI6IjI2NTgi"><span>Arrange A Demo</span></a></header>
<main>${body}</main><footer class="elementor-location-footer"><a href="/privacy-policy/">Privacy</a></footer>
<script>window.__cal=0; window.Calendly={initPopupWidget:function(){window.__cal++;}}; window.PH_OPERATOR={"endpoint":"/wp-json/ph-site/v1/operator-lead","tour":"/industries/retail-media/tour/"};</script>
<script>${site}</script><script>${js}</script></body></html>`;

// Every "i" info button: its visible circle and whether the 44x44 square around its centre all hits it (elementFromPoint).
const hitBoxes = (t) => t.evaluate(() => {
  const out = { coarse: matchMedia("(pointer: coarse)").matches, n: 0, bad: [] };
  for (const b of document.querySelectorAll("#phf .phf-tip-b, #phf .phf-how-b")) {
    b.scrollIntoView({ block: "center", behavior: "instant" });
    const r = (b.querySelector(".phf-how-i") || b).getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; // the "i" circle
    out.n++;
    const miss = [];
    for (const dx of [-21.5, 0, 21.5]) for (const dy of [-21.5, 0, 21.5]) { const e = document.elementFromPoint(cx + dx, cy + dy); if (!e || !(e === b || b.contains(e))) miss.push([dx, dy, e && (e.id || e.className || e.tagName)]); }
    if (Math.round(r.width) !== 16 || Math.round(r.height) !== 16 || miss.length) out.bad.push({ id: b.getAttribute("aria-describedby"), w: r.width, h: r.height, miss });
  }
  return out;
});
// Where the Average CPM tooltip opens, relative to its button.
const tipPlace = async (t) => { await t.locator("[aria-describedby=c-cpm-tip]").focus(); return t.evaluate(() => { const b = document.querySelector("[aria-describedby=c-cpm-tip]").getBoundingClientRect(), x = document.getElementById("c-cpm-tip").getBoundingClientRect(); return { dx: Math.round(x.left - b.left), dy: Math.round(x.bottom - b.top), w: Math.round(x.width) }; }); };

const browser = await chromium.launch();
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
try {
  const probe = await browser.newPage(); const tinyJpg = await probe.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 8, height: 8 } }); await probe.close();
  const open = async ({ search = "", lead = null, operator = null, posts = null, status = 200, reply = { ok: true }, width = 1440, height = 1000, device = null, init = null } = {}) => {
    let ctx = null;
    if (device) { const { defaultBrowserType, ...desc } = devices[device]; ctx = await browser.newContext({ ...desc, reducedMotion: "reduce" }); }
    const p = ctx ? await ctx.newPage() : await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    p.__ctx = ctx;
    if (init) await p.addInitScript(init);
    p.__errs = []; p.on("pageerror", (e) => p.__errs.push(e.message));
    await p.addInitScript(([l, f]) => { if (sessionStorage.getItem("__init")) return; sessionStorage.setItem("__init", "1"); if (l) localStorage.setItem("ph_lead", JSON.stringify(l)); if (f) localStorage.setItem("ph_operator", JSON.stringify(f)); }, [lead, operator]);
    p.__reqs = [];
    await p.route("**/*", (rt) => {
      const u = rt.request().url(); p.__reqs.push(u);
      if (/\/wp-json\/ph-site\/v1\/operator-lead$/.test(u)) { if (posts) posts.push(JSON.parse(rt.request().postData())); return rt.fulfill({ status, contentType: "application/json", body: JSON.stringify(reply) }); }
      if (/\/assets\/v1\/img\//.test(u)) return rt.fulfill({ contentType: "image/jpeg", body: tinyJpg });
      if (/\/assets\/v1\//.test(u)) return rt.fulfill({ status: 404, body: "" });
      if (/\/industries\/retail-media\/tour\//.test(u)) return rt.fulfill({ contentType: "text/html", body: tourHtml });
      if (/\/wp-json\//.test(u)) return rt.fulfill({ contentType: "application/json", body: '{"found":false}' });
      if (u.startsWith("http://x.test/be-your-own-boss/")) return rt.fulfill({ contentType: "text/html", body: page });
      return rt.abort();
    });
    await p.goto("http://x.test/be-your-own-boss/" + search);
    return p;
  };
  const text = (p, sel) => p.evaluate((s) => document.querySelector(s).textContent.trim(), sel);
  const fill = async (p, o) => {
    for (const k of ["name", "email", "linkedin", "region"]) if (o[k] !== undefined) await p.fill(`#phf-form [name=${k}]`, o[k]);
    if (o.background) await p.selectOption("#phf-form [name=background]", o.background);
    if (o.consent) await p.check("#phf-form [name=consent]");
  };

  // 1. Copy and section order.
  let p = await open();
  const heads = await p.evaluate(() => [...document.querySelectorAll("#phf h1, #phf h2")].map((h) => h.textContent.trim()));
  assert.deepStrictEqual(heads, ["Be your own boss", "Your head start in a changing industry", "Built for people who know media", "How it works", "Any business with a physical presence", "Built to fix retail media's fragmentation", "What could it be worth to you?", "Give independents a fighting chance", "See a retail media network run end to end"], "section order");
  const all = await p.evaluate(() => document.getElementById("phf").textContent);
  for (const s of ["Run your own retail media network", "AI has changed what one person can achieve.", "Why it beats anything out there", "Personalisation in physical venues", "Campaigns can be created automatically", "Self-optimising, with proof of results", "Your brand, your own AWS account", "You sign up venues", "You partner with brands and advertisers", "You run it your own way", "Car dealerships", "Cafés and bakeries", "Standardised measurement", "AI-native, with full MCP support", "Your network", "Your potential income a year", "Retail media income", "A way to fight back", "Unlock the product tour", "Tell us a little about yourself to watch the full walkthrough. Our team will also follow up with more on becoming a network operator."]) ok(all.includes(s), "copy: " + s);
  // The three copy replacements, exact.
  ok(all.includes("We want to back them. If you have relationships with brands, retailers or businesses with a physical presence, becoming a Personalisation Hub network operator gives you a head start: your own retail media network, ready to sell from day one."), "copy 1: head-start paragraph");
  ok((await text(p, ".phf-cin-h")) === "Your network", "copy 2: calculator panel heading");
  ok((await text(p, ".phf-gate-p")) === "Tell us a little about yourself to watch the full walkthrough. Our team will also follow up with more on becoming a network operator.", "copy 3: tour gate intro");
  // The retired offer name nowhere a visitor can see it: visible text, tooltips, every attribute (aria-label, title, alt, placeholder, href...),
  // the document title, meta and the URL. Script and style bodies are code, not page content.
  const seen = await p.evaluate(() => {
    const out = [document.body.innerText, document.title, location.href, [...document.querySelectorAll(".phf-tipbox, option")].map((t) => t.textContent).join(" ")];
    for (const el of document.querySelectorAll("*")) { if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue; for (const a of el.attributes) out.push(a.name + "=" + a.value); }
    return out.join("\n");
  });
  ok(!OLD.test(seen), "no retired offer name in visible text, attributes, title, meta or URL: " + (seen.match(/.{0,60}fr[a]nch.{0,60}/i) || [""])[0]);
  // ...nor in the rendered HTML, the page's own CSS/JS (file names and contents) or the inline config.
  ok(!OLD.test(body) && !OLD.test(page), "no retired offer name in the rendered HTML or the page source");
  for (const f of ["operator.css", "operator.js", "operator.php", "operator-content.php", "site.js", "enhance.js"]) ok(!OLD.test(f) && !OLD.test(fs.readFileSync(path.join(dir, f), "utf8")), `${f}: no retired offer name in its name or contents`);
  ok(!fs.readdirSync(dir).some((f) => OLD.test(f)), "no snippet file named after the retired offer");
  ok((await p.title()) === "Be Your Own Boss - Personalisation Hub", "document title");
  ok((await p.evaluate(() => { const a = document.querySelector("header a[aria-current=page]"); return a.textContent + "|" + a.getAttribute("href"); })) === "Be Your Own Boss|http://x.test/be-your-own-boss/", "header item Be Your Own Boss, current, links /be-your-own-boss/");
  ok((await p.evaluate(() => getComputedStyle(document.querySelector("#phf h1")).fontFamily)).includes("Kantumruy Pro"), "Kantumruy Pro");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector(".phf-hero-sub")).color === "rgb(23, 155, 194)" && getComputedStyle(document.querySelector(".phf-cout")).backgroundColor === "rgb(15, 20, 36)" && getComputedStyle(document.querySelector(".phf-cout-v")).color === "rgb(239, 96, 167)"), "design colours");
  // No commercial terms anywhere on the page (text, tooltips, attributes).
  const html = await p.content();
  const bodyText = (await p.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll(".phf-tipbox")].map((t) => t.textContent).join(" "))).toLowerCase();
  for (const re of [/setup fee/, /minimum/, /\bsplit\b/, /50\s*%/, /\b0\.5\b/, /\bhalf\b/, /ph's share/]) ok(!re.test(bodyText), "no commercial term: " + re);
  ok(!/0\.5/.test(body), "the share is not in the server HTML");
  ok(!/personaliz|organiz/i.test(bodyText), "UK spelling");

  // 2. Calculator: defaults, then live updates.
  const outs = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#phf [data-out]")].map((e) => [e.dataset.out, e.textContent])));
  assert.deepStrictEqual(await outs(), d, "calculator defaults on the page");
  ok(await p.evaluate(() => !document.querySelector("#calculator .phf-cout ~ p, #calculator .phf-calc + p")), "no explanatory copy under the calculator");
  await p.fill("#c-ven", "100");
  let o = await outs();
  ok(o.yours === "$657K" && o.venues === "100" && o.displays === "300" && o.visitors === "2,433,333" && o.views === "4,380,000" && o.extraSales === "$65.7M", "venues 100 updates live: " + JSON.stringify(o));
  await p.fill("#c-ven", "-5"); await p.locator("#c-ven").dispatchEvent("change");
  ok((await p.inputValue("#c-ven")) === "0" && (await outs()).yours === "$0", "a negative input clamps at 0");
  await p.fill("#c-ven", "90");
  await p.locator("#c-view").fill("100");
  o = await outs(); ok(o.yours === "$986K" && (await text(p, "#c-view-v")) === "100%", "slider updates live: " + JSON.stringify(o));
  await p.locator("#c-up").fill("0"); o = await outs();
  ok(o.extraSales === "$0" && (await text(p, "#c-up-v")) === "0%", "uplift 0");

  // 3. Tooltips on hover, keyboard focus and tap.
  const tipOn = (id) => p.evaluate((i) => getComputedStyle(document.getElementById(i)).display !== "none", id);
  ok(!(await tipOn("c-ven-tip")), "tooltip hidden at rest");
  await p.hover("#c-ven + * button, .phf-crow:first-of-type .phf-tip-b").catch(() => {});
  await p.locator("[aria-describedby=c-ven-tip]").hover();
  ok(await tipOn("c-ven-tip"), "tooltip on hover");
  await p.mouse.move(5, 5);
  await p.locator("[aria-describedby=c-cpm-tip]").focus();
  ok(await tipOn("c-cpm-tip"), "tooltip on keyboard focus");
  ok((await text(p, "#c-how-tip")).startsWith("Venues × visitors per day"), "How it's calculated tooltip text");
  const ids = await p.evaluate(() => [...document.querySelectorAll("#calculator [aria-describedby]")].map((b) => b.getAttribute("aria-describedby")));
  assert.deepStrictEqual(ids, ["c-ven-tip", "c-dis-tip", "c-vis-tip", "c-cpm-tip", "c-atv-tip", "c-view-tip", "c-up-tip", "c-how-tip"], "a tooltip on every input and on How it's calculated");
  await p.close();
  { const t = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await t.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/") ? rt.fulfill({ contentType: "text/html", body: page }) : rt.abort());
    await t.goto("http://x.test/be-your-own-boss/");
    await t.locator("[aria-describedby=c-atv-tip]").tap();
    const g = await t.evaluate(() => { const b = document.getElementById("c-atv-tip").getBoundingClientRect(); return { on: getComputedStyle(document.getElementById("c-atv-tip")).display !== "none", l: b.left, r: b.right, w: innerWidth, exp: document.querySelector("[aria-describedby=c-atv-tip]").getAttribute("aria-expanded") }; });
    ok(g.on && g.exp === "true" && g.l >= 0 && g.r <= g.w, "tooltip on tap, inside the viewport: " + JSON.stringify(g));
    await t.locator("#calc").tap();
    ok(!(await t.evaluate(() => getComputedStyle(document.getElementById("c-atv-tip")).display !== "none")), "a tap elsewhere closes it");
    const hb = await hitBoxes(t);
    ok(hb.coarse && hb.n === 8 && hb.bad.length === 0, "touch: every info button has a hit box of at least 44x44 (16px circle kept): " + JSON.stringify(hb));
    await t.close(); }
  { const t = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await t.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/") ? rt.fulfill({ contentType: "text/html", body: page }) : rt.abort());
    await t.goto("http://x.test/be-your-own-boss/");
    const pos = await tipPlace(t);
    const t2 = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    await t2.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/") ? rt.fulfill({ contentType: "text/html", body: page }) : rt.abort());
    await t2.goto("http://x.test/be-your-own-boss/");
    const pos2 = await tipPlace(t2);
    ok(JSON.stringify(pos) === JSON.stringify(pos2), "touch: the tooltip opens in the same place as with a mouse: " + JSON.stringify([pos, pos2]));
    await t.close(); await t2.close(); }

  // 4. CTAs and the header's Arrange A Demo go to their anchors; #tour focuses the first empty field.
  p = await open();
  ok((await p.getAttribute(".phf-hero a.phf-btn", "href")) === "#calculator" && (await p.getAttribute(".phf-hero a.phf-btn-o", "href")) === "#tour", "hero CTAs");
  ok((await p.getAttribute(".phf-cctas a:first-child", "href")) === "#tour" && (await p.getAttribute(".phf-cctas a:last-child", "href")) === "#how", "calculator CTAs");
  await p.click(".phf-cctas a:first-child");
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "t-fn");
  ok(true, "Request further information focuses Full name");
  await p.fill("#t-fn", "Ada Lovelace");
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click("#hdr-demo");
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "t-em");
  ok((await p.evaluate(() => window.__cal)) === 0 && (await p.getAttribute("#hdr-demo", "href")) === "#tour", "header Arrange A Demo goes to #tour (no demo pop-up) and focuses the first empty field");
  ok(await p.evaluate(() => { const t = document.getElementById("tour").getBoundingClientRect().top; return t >= 0 && t < 200; }), "scrolled to the tour band");
  await p.close();

  // 5. The gate: disabled until valid, posts the body, stores ph_operator and ph_lead, frames the tour unlocked, Start plays a step.
  const posts = [];
  p = await open({ search: "?ph_test=1", posts });
  const dis = () => p.locator("#phf-unlock").isDisabled();
  ok(await dis(), "Unlock disabled when empty");
  await fill(p, { name: "Ada Lovelace", email: "ada@gmail.com", region: "Leeds", background: "Retail media" });
  ok(await dis(), "still disabled without consent");
  await p.check("#t-cs"); ok(!(await dis()), "enabled once valid (personal email accepted)");
  await p.fill("#t-li", "example.com/ada"); ok(await dis(), "disabled with a non-LinkedIn address");
  await p.fill("#t-li", "linkedin.com/in/ada"); ok(!(await dis()), "a LinkedIn address without https:// is fine");
  ok(await p.evaluate(() => { const s = document.getElementById("t-bg"); return s.options.length === 6 && [...s.options].slice(1).map((o) => o.text).join("|") === "Agency media or account management|Ad-tech sales or partnerships|Retail media|Marketing|Something else"; }), "the 5 backgrounds");
  await p.click("#phf-unlock");
  await p.waitForSelector("#phf-mount iframe");
  assert.strictEqual(posts.length, 1, "one post");
  assert.deepStrictEqual(posts[0], { name: "Ada Lovelace", email: "ada@gmail.com", linkedin: "linkedin.com/in/ada", region: "Leeds", background: "Retail media", consent: true, page: "/be-your-own-boss/", test: true, website: "" }, "post body");
  const st = await p.evaluate(() => ({ f: JSON.parse(localStorage.getItem("ph_operator")), l: JSON.parse(localStorage.getItem("ph_lead")), dl: (window.dataLayer || []).filter((e) => e.event === "ph_lead_captured") }));
  ok(st.f.name === "Ada Lovelace" && st.f.email === "ada@gmail.com" && st.f.ts > 0, "ph_operator stored");
  ok(st.l.name === "Ada Lovelace" && st.l.email === "ada@gmail.com" && st.l.company === "" && st.l.source === "Network operator inquiry", "ph_lead stored for the tour, source \"Network operator inquiry\"");
  ok(st.dl.length === 1 && st.dl[0].source === "Network operator inquiry" && !JSON.stringify(st.dl).includes("ada@"), "dataLayer ph_lead_captured, no contact details");
  ok((await text(p, "#phf-in-h")) === "You’re in, Ada", "You're in, <first name>");
  ok((await p.getAttribute("#phf-mount iframe", "src")) === "/industries/retail-media/tour/?embed=1&ph_test=1", "iframe src with embed=1 and ph_test=1");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector(".phf-ph")).display === "none" && getComputedStyle(document.getElementById("phf-gate")).display === "none" && window.PH_TOUR && window.PH_TOUR.endpoint === "/wp-json/ph-site/v1/tour-lead"), "placeholder and gate replaced; window.PH_TOUR set");
  const fr = p.frames().find((f) => /\/industries\/retail-media\/tour\//.test(f.url()));
  await fr.waitForSelector("#start", { state: "visible" });
  ok(await fr.evaluate(() => document.getElementById("gate").hidden && !document.querySelector("#gform")), "the tour opens unlocked, with no form");
  ok(await fr.evaluate(() => /Watch full screen/.test(document.getElementById("card").textContent)), "its own Start the tour / Watch full screen card");
  await p.waitForFunction(() => parseInt(document.querySelector("#phf-mount iframe").style.height, 10) > 300);
  ok(true, "the frame height follows the tour's height message");
  await fr.click("#start");
  await fr.waitForFunction(() => !!document.querySelector('#dots [aria-current="true"]'), null, { timeout: 15000 });
  ok(true, "Start the tour plays a step");
  ok(p.__errs.length === 0, "no page errors: " + p.__errs.join("; "));
  ok(!OLD.test(await p.evaluate(() => document.body.innerText)), "after unlocking: still no retired offer name in the visible text");
  const keys = await p.evaluate(() => Object.keys(localStorage));
  ok(keys.includes("ph_operator") && !keys.some((k) => OLD.test(k)) && !OLD.test(await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))))), "localStorage: key ph_operator, no retired offer name in any key or value: " + keys.join(","));
  ok(!OLD.test(await p.evaluate(() => JSON.stringify(window.dataLayer || []))), "dataLayer: no retired offer name in any event");
  ok(p.__reqs.some((u) => /\/wp-json\/ph-site\/v1\/operator-lead$/.test(u)) && !p.__reqs.some((u) => OLD.test(u)), "the gate posts to ph-site/v1/operator-lead; no request names the retired offer");
  await p.close();

  // 6. Errors: a 400 names the field.
  p = await open({ status: 400, reply: { error: "Please tell us where you plan to operate.", field: "region" } });
  await fill(p, { name: "Ada", email: "ada@x.test", region: "x", background: "Marketing", consent: true });
  await p.click("#phf-unlock");
  await p.waitForFunction(() => /where you plan/.test(document.getElementById("phf-msg").textContent));
  ok(await p.evaluate(() => document.activeElement.id === "t-rg" && document.getElementById("t-rg").getAttribute("aria-invalid") === "true" && !localStorage.getItem("ph_operator") && !document.querySelector("#phf-mount iframe")), "400: message, field focused, nothing stored, no tour");
  await p.close();

  // 7. An existing industry ph_lead: name and email prefilled, never overwritten.
  const industry = { name: "Grace Hopper", company: "Orbit Pharmacy", email: "grace@orbit.example", source: "Pharmacy business model download", ts: 1 };
  p = await open({ lead: industry, posts: [] });
  ok((await p.inputValue("#t-fn")) === "Grace Hopper" && (await p.inputValue("#t-em")) === "grace@orbit.example" && (await p.inputValue("#t-rg")) === "", "industry lead: name and email prefilled, the rest asked");
  ok(await p.locator("#phf-unlock").isDisabled(), "still asks for the remaining fields");
  await fill(p, { region: "Bristol", background: "Marketing", consent: true });
  await p.click("#phf-unlock"); await p.waitForSelector("#phf-mount iframe");
  ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")))) === JSON.stringify(industry), "the industry ph_lead is not overwritten");
  await p.close();

  // 8. Returning visitor (ph_operator stored): no gate, the tour straight away; the restored ph_lead carries the new label.
  p = await open({ operator: { name: "Ada Lovelace", email: "ada@gmail.com", ts: 1 } });
  await p.waitForSelector("#phf-mount iframe");
  ok(await p.evaluate(() => { const l = JSON.parse(localStorage.getItem("ph_lead")); return getComputedStyle(document.getElementById("phf-gate")).display === "none" && l.email === "ada@gmail.com" && l.source === "Network operator inquiry"; }), "returning visitor skips the gate (ph_lead restored for the tour, source Network operator inquiry)");
  ok((await p.getAttribute("#phf-mount iframe", "src")) === "/industries/retail-media/tour/?embed=1", "no ph_test outside test mode");
  await p.close();

  // 9. No horizontal scroll at 360, 390, 768 and 1440 (locked and unlocked).
  for (const w of [360, 390, 768, 1440]) {
    for (const fr2 of [null, { name: "A", email: "a@b.test", ts: 1 }]) {
      p = await open({ width: w, height: 800, operator: fr2 });
      const sw = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, wide: [...document.querySelectorAll("#phf *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".phf-tipbox, .phf-hp, .phf-ph")).map((e) => e.className || e.tagName).slice(0, 5) }));
      ok(sw.sw <= sw.w && sw.wide.length === 0, `no horizontal scroll at ${w} (${fr2 ? "unlocked" : "locked"}): ` + JSON.stringify(sw));
      await p.close();
    }
  }
  p = await open({ width: 1440 });
  ok(await p.evaluate(() => { const r = document.querySelector(".phf-hero-copy").getBoundingClientRect(), s = document.querySelector(".phf-why").getBoundingClientRect(); return Math.abs(r.top - s.top) < 200 && s.left > r.right; }), "1440: hero copy and the 'why' card side by side");
  ok(await p.evaluate(() => { const a = document.querySelector(".phf-cin-card").getBoundingClientRect(), b = document.querySelector(".phf-cout").getBoundingClientRect(); return b.left > a.right && Math.abs(a.top - b.top) < 2; }), "1440: calculator inputs and result side by side");
  await p.close();
  p = await open({ width: 360 });
  ok(await p.evaluate(() => document.querySelector(".phf-cout").getBoundingClientRect().top > document.querySelector(".phf-cin-card").getBoundingClientRect().bottom), "360: the calculator stacks");
  await p.close();

  // 10. Tablets (Rob's iPad and tablet pass): each device in portrait and landscape, touch on, the device's own user agent (an iPad UA
  // on the iPads). Galaxy Tab: the browser's full-screen API is switched off, so the tour's in-page fallback is what is exercised there too.
  for (const dev of ["iPad Mini", "iPad (gen 7)", "iPad Pro 11", "Galaxy Tab S4"]) {
    for (const name of [dev, dev + " landscape"]) {
      assert.ok(devices[name], "Playwright device " + name);
      const ipad = /iPad/.test(devices[name].userAgent);
      p = await open({ device: name, search: "?ph_test=1", posts: [], init: ipad ? null : () => { Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false }); Element.prototype.requestFullscreen = undefined; } });
      const env = await p.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth, touch: navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches, ua: navigator.userAgent }));
      ok(env.touch && (ipad ? /iPad/.test(env.ua) : /Android/.test(env.ua)), `${name}: touch on, ${ipad ? "iPad" : "Android"} user agent`);
      ok(env.sw <= env.w, `${name}: no horizontal scroll (${env.sw} <= ${env.w})`);
      await p.locator("#c-ven").tap(); await p.fill("#c-ven", "100");
      ok((await outs()).yours === "$657K", `${name}: calculator usable (venues 100 -> $657K)`);
      await p.fill("#c-ven", "90");
      await p.locator("[aria-describedby=c-atv-tip]").tap();
      ok(await p.evaluate(() => { const t = document.getElementById("c-atv-tip"), r = t.getBoundingClientRect(); return getComputedStyle(t).display !== "none" && r.left >= 0 && r.right <= innerWidth; }), `${name}: an info tooltip opens by tap, inside the viewport`);
      await p.locator("#calc").tap();
      ok(await p.evaluate(() => getComputedStyle(document.getElementById("c-atv-tip")).display === "none"), `${name}: a tap elsewhere closes it`);
      const hb = await hitBoxes(p);
      ok(hb.coarse && hb.n === 8 && hb.bad.length === 0, `${name}: every info button's hit box is at least 44x44: ` + JSON.stringify(hb));
      await fill(p, { name: "Ada Lovelace", email: "ada@gmail.com", region: "Leeds", background: "Retail media" });
      await p.locator("#t-cs").tap();
      ok(!(await p.locator("#phf-unlock").isDisabled()), `${name}: the gate is usable (Unlock enabled once valid)`);
      await p.locator("#phf-unlock").tap();
      await p.waitForSelector("#phf-mount iframe");
      ok(await p.evaluate(() => getComputedStyle(document.getElementById("phf-gate")).display === "none" && getComputedStyle(document.querySelector(".phf-ph")).display === "none"), `${name}: the gate submit unlocks the tour`);
      const tf = p.frames().find((f) => /\/industries\/retail-media\/tour\//.test(f.url()));
      await tf.waitForSelector("#start", { state: "visible" });
      await tf.locator("#start").tap();
      await tf.waitForFunction(() => !!document.querySelector('#dots [aria-current="true"]'), null, { timeout: 15000 });
      ok(true, `${name}: the tour plays`);
      await tf.waitForSelector("#fs", { state: "visible" });
      await tf.locator("#fs").tap();
      await tf.waitForFunction(() => document.documentElement.classList.contains("fs"));
      await p.waitForFunction(() => document.querySelector("#phf-mount iframe").style.position === "fixed");
      const fsOn = await p.evaluate(() => { const r = document.querySelector("#phf-mount iframe").getBoundingClientRect(); return { native: !!document.fullscreenElement, cover: Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight }; });
      ok(!fsOn.native && fsOn.cover && !(await tf.evaluate(() => !!document.fullscreenElement)), `${name}: the full-screen fallback opens over the whole viewport: ` + JSON.stringify(fsOn));
      await tf.locator("#fsclose").tap();
      await tf.waitForFunction(() => !document.documentElement.classList.contains("fs"));
      await p.waitForFunction(() => document.querySelector("#phf-mount iframe").style.position !== "fixed");
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.style.overflow !== "hidden"), `${name}: the full-screen fallback closes and the page is restored`);
      ok(p.__errs.length === 0, `${name}: no page errors: ` + p.__errs.join("; "));
      await p.__ctx.close();
    }
  }

  // 11. enhance.js: a stored lead without a company is not "known" on the industry download gates; tours still unlock from it.
  const enhance = fs.readFileSync(path.join(dir, "enhance.js"), "utf8");
  const ecss = fs.readFileSync(path.join(dir, "enhance.css"), "utf8");
  const { CALC } = require(path.join(dir, "enhance.js"));
  const row = '<div class="ph-ind-cf"><span class="ph-ind-cf-l">L</span><span class="ph-ind-cf-v">V</span></div>';
  const ind = "pharmacy", n = CALC[ind].inputs.length + CALC[ind].assumptions.length;
  const ihtml = `<!doctype html><html><head><style>${ecss}</style></head><body><main><section class="ph-ind-sec"><div class="ph-ind-calc"><div class="ph-ind-cin"><p class="ph-ind-label-gap">a</p><p class="ph-ind-label-gap">b</p>${row.repeat(n)}</div><div class="ph-ind-cout"><p class="ph-ind-ctot-l">Total</p><p class="ph-ind-ctot-v">0</p><div class="ph-ind-crow">r</div><div class="ph-ind-crow">r</div><div class="ph-ind-crow">r</div></div></div></section></main><script>window.PH_IND_PAGE="${ind}";</script><script>${enhance}</script></body></html>`;
  for (const [lead, known] of [[{ name: "Ada Lovelace", email: "ada@gmail.com", company: "", source: "Network operator inquiry" }, false], [{ name: "Ada Lovelace", email: "ada@orbit.example", company: "Orbit", source: "Interactive product tour" }, true], [{ name: "", email: "ada@orbit.example", company: "Orbit" }, false]]) {
    const q = await browser.newPage();
    await q.addInitScript((l) => localStorage.setItem("ph_lead", JSON.stringify(l)), lead);
    await q.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/industries/pharmacy/") && !/tour/.test(rt.request().url()) ? rt.fulfill({ contentType: "text/html", body: ihtml }) : rt.fulfill({ contentType: "text/html", body: "<p>t</p>" }));
    await q.goto("http://x.test/industries/pharmacy/");
    await q.locator("form.ph-ind-gate-f").waitFor();
    const k = await q.evaluate(() => document.querySelector("form.ph-ind-gate-f").classList.contains("ph-ind-gate-known"));
    ok(k === known, `enhance.js known visitor needs name, company and email (${JSON.stringify(lead)}): known=${k}`);
    await q.close();
  }
} finally {
  await browser.close();
}
console.log(`operator.test.mjs: ${checks} checks passed`);
