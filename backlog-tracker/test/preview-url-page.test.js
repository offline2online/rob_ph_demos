/* nearestPageFor(): the "Test this ->" link has to be a page a static host
   can actually serve. A bundler's index.html is not one — it loads
   /src/main.tsx, which only exists during a build — and linking it gives a
   tester a blank page (ticket xvb2ZtHQoMvdrtKIL3hN, 22 Sep 2026). */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { nearestPageFor, isBundlerTemplate } = require("../scripts/run-backlog-automation.js");

const VITE_TEMPLATE = `<!doctype html><html><body><div id="root"></div>
  <script type="module" src="/src/main.tsx"></script></body></html>`;
const BUILT_PAGE = `<!doctype html><html><body><div id="root"></div>
  <script type="module" crossorigin src="./assets/index-abc123.js"></script></body></html>`;
const PLAIN_PAGE = `<!doctype html><html><body><h1>A page</h1></body></html>`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "preview-url-"));
const write = (rel, body) => {
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

write("proj/apps/admin/index.html", VITE_TEMPLATE);
write("proj/apps/admin/src/features/Thing.tsx", "export const Thing = () => null");
write("proj/prototype/index.html", BUILT_PAGE);
write("site/index.html", PLAIN_PAGE);
write("site/css/styles.css", "body{}");
write("lonely/scripts/tool.mjs", "// no page above me");

const cwd = process.cwd();
process.chdir(root);
try {
  assert.strictEqual(isBundlerTemplate("proj/apps/admin/index.html"), true, "a Vite template is not a servable page");
  assert.strictEqual(isBundlerTemplate("proj/prototype/index.html"), false, "a built page is servable");
  assert.strictEqual(isBundlerTemplate("site/index.html"), false, "a plain page is servable");

  // The bug: this used to return proj/apps/admin/index.html.
  assert.strictEqual(
    nearestPageFor("proj/apps/admin/src/features/Thing.tsx"),
    "proj/prototype/index.html",
    "skips the bundler template and finds the build beside the source",
  );
  // Unchanged behaviour for an ordinary static site.
  assert.strictEqual(nearestPageFor("site/css/styles.css"), "site/index.html");
  // Still honest when there is no page at all.
  assert.strictEqual(nearestPageFor("lonely/scripts/tool.mjs"), null);
  console.log("preview-url-page: 6 assertions passed");
} finally {
  process.chdir(cwd);
  fs.rmSync(root, { recursive: true, force: true });
}
