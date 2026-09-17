// FAQ editor load fidelity — every article in the committed help-centre
// snapshot (faq/data/articles/*.json) must survive being opened in the
// console's Quill editor: same words out as in, lists/tables/callouts/code
// blocks still present, and nothing changing once the user starts typing.
//
// Runs the console's REAL editor code (extracted from public/js/app.js by
// the markers below, not a copy) against the real quill@1.3.7 build the
// app loads from cdnjs, in a real Chromium via Playwright. It exists
// because both previous ways of loading an article into Quill lost content
// silently — see faqSetEditorHtml's comment in app.js — and nothing here
// caught it: the MCP/rules tests never render the editor.
//
//   cd backlog-tracker/test && npm install && npm run test:editor
//
// Needs a Chromium: PLAYWRIGHT_CHROMIUM (a path) if playwright-core can't
// find one itself, e.g. /opt/pw-browsers/chromium-*/chrome-linux/chrome in
// the Claude Code sandbox, or the `chrome` channel on a GitHub runner.
// Opt-in (not part of `npm test`) for exactly that reason.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const appJs = fs.readFileSync(path.join(repo, "backlog-tracker/public/js/app.js"), "utf8");

// Pull the editor's own functions straight out of app.js. app.js is one ES
// module that imports Firebase from gstatic and wires up the whole board on
// load, so it can't be imported here; these markers bracket exactly the
// self-contained editor pieces (table row model, callout/table blots,
// faqHtmlForQuill/faqSetEditorHtml, the Quill instance and its matcher
// filter, faqBodySourceForSave). A marker that stops matching fails the
// test loudly rather than silently testing stale code.
function slice(from, to) {
  const a = appJs.indexOf(from), b = appJs.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(`app.js marker not found: ${JSON.stringify(a < 0 ? from : to)}`);
  return appJs.slice(a, b);
}
const editorCode = [
  slice("function escapeHTML(s) {", "\n}\n") + "\n}\n",
  slice("const FAQ_CALLOUT_LEVELS =", "// Insert a brand-new table at the cursor"),
  slice("registerFaqEditorFormats();", "// Table cell TEXT needs no handler"),
  slice("function faqBodySourceForSave() {", "\n}\n") + "\n}\n",
].join("\n");
for (const fn of ["faqHtmlForQuill", "faqSetEditorHtml", "matchers.filter", "faqBodySourceForSave"]) {
  if (!editorCode.includes(fn)) throw new Error(`extracted editor code is missing ${fn}`);
}

// Both packages resolve to a file inside their dist/ folder.
const quillDist = path.dirname(fileURLToPath(import.meta.resolve("quill")));
const purifyDist = path.dirname(fileURLToPath(import.meta.resolve("dompurify")));
const files = {
  "/quill.min.js": path.join(quillDist, "quill.min.js"),
  "/quill.snow.css": path.join(quillDist, "quill.snow.css"),
  "/purify.min.js": path.join(purifyDist, "purify.min.js"),
  "/styles.css": path.join(repo, "backlog-tracker/public/css/styles.css"),
};
const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/quill.snow.css"><link rel="stylesheet" href="/styles.css">
<script src="/quill.min.js"></script><script src="/purify.min.js"></script></head>
<body><p id="fa-load-notice" hidden></p><div id="fa-body-editor"></div>
<script>${editorCode}
function renderFaqBodyMd(c){const t=(c||"").trim();return t.startsWith("<")?DOMPurify.sanitize(t,{ADD_TAGS:["iframe"],ADD_ATTR:["allowfullscreen","frameborder"]}):t;}
window.loadArticle=(html)=>{faqSetEditorHtml(renderFaqBodyMd(html));return faqBodySourceForSave();};
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/") { res.setHeader("content-type", "text/html"); res.end(page); return; }
  if (!files[url]) { res.writeHead(404); res.end(); return; }
  res.setHeader("content-type", url.endsWith(".css") ? "text/css" : "text/javascript");
  fs.createReadStream(files[url]).pipe(res);
}).listen(0);
const port = server.address().port;

const launch = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch(launch).catch(() => chromium.launch({ ...launch, channel: "chrome" }));
const tab = await browser.newPage();
const pageErrors = [];
tab.on("pageerror", (e) => pageErrors.push(String(e)));
await tab.goto(`http://127.0.0.1:${port}/`);

const articlesDir = path.join(repo, "faq/data/articles");
const only = process.argv.slice(2);
const count = (html, re) => (html.match(re) || []).length;
// Characters without whitespace, decoded by the browser so `&mdash;` in a
// saved body and the "—" Quill serialises compare equal — the same
// faqPlainText the editor's own lossy-load check uses.
const words = (html) => tab.evaluate((h) => faqPlainText(h), html);
const structure = (html) => ({
  lists: count(html, /<(ul|ol)[\s>]/g), items: count(html, /<li[\s>]/g), tables: count(html, /<table[\s>]/g),
  callouts: count(html, /<div class="callout/g), headings: count(html, /<h[1-6][\s>]/g),
  // Quill's code block is <pre class="ql-syntax"> with no inner <code>, so a
  // saved <pre><code> pair is one code block, not a block plus inline code.
  blocks: count(html, /<pre[\s>]/g), code: count(html, /<code[\s>]/g) - count(html, /<pre[^>]*>\s*<code[\s>]/g),
});
let failures = 0, checked = 0;
for (const file of fs.readdirSync(articlesDir).sort()) {
  const article = JSON.parse(fs.readFileSync(path.join(articlesDir, file), "utf8"));
  if (only.length && !only.includes(article.id)) continue;
  const body = article.bodyMd || "";
  if (!body.trim().startsWith("<")) continue; // legacy markdown-ish body: a different (one-time upgrade) path
  checked++;
  const loaded = await tab.evaluate((html) => window.loadArticle(html), body);
  await tab.evaluate(() => { faQuill.focus(); faQuill.setSelection(0, 0); });
  await tab.keyboard.type("x");
  await tab.keyboard.press("Backspace");
  const { afterTyping, notice } = await tab.evaluate(() => ({ afterTyping: faqBodySourceForSave(), notice: !document.getElementById("fa-load-notice").hidden }));
  const problems = [];
  if ((await words(loaded)) !== (await words(body))) problems.push("words changed on load");
  if ((await words(afterTyping)) !== (await words(loaded))) problems.push("words changed after one keystroke");
  if (notice) problems.push("editor showed its lossy-load notice");
  const want = structure(body), got = structure(loaded);
  for (const k of ["tables", "callouts", "blocks", "code", "headings"]) if (got[k] !== want[k]) problems.push(`${k}: ${want[k]} saved → ${got[k]} loaded`);
  // Nested <ul>/<ol> are folded into their parent list on purpose (Quill 1.x
  // has no nested lists — see faqHtmlForQuill), so the list count may drop
  // by the number of nested lists, but never the number of items.
  const nested = count(body, /<li[^>]*>(?:(?!<\/li>)[\s\S])*?<(ul|ol)[\s>]/g);
  if (got.lists < want.lists - nested || got.lists > want.lists) problems.push(`lists: ${want.lists} saved → ${got.lists} loaded`);
  if (got.items !== want.items) problems.push(`list items: ${want.items} saved → ${got.items} loaded`);
  if (pageErrors.length) problems.push(...pageErrors.splice(0));
  if (problems.length) { failures++; console.log(`FAIL ${article.id} — ${article.title}\n  ${problems.join("\n  ")}`); }
}
await browser.close();
server.close();
console.log(`${checked - failures}/${checked} articles load faithfully in the FAQ editor`);
process.exit(failures ? 1 : 0);
