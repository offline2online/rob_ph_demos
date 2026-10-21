// functions/kanban-core.js is a CommonJS copy of public/js/kanban/kanban-core.js
// (Cloud Functions deploy only functions/, so the MCP tools can't import the
// page's module). This builds the copy from the source; the test fails when
// the two differ. Regenerate with:  node test/kanban-core-copy.mjs --write
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "public", "js", "kanban", "kanban-core.js");
const OUT = path.join(root, "functions", "kanban-core.js");

export function buildCopy(src) {
  const names = [];
  const body = src.replace(/^export (async function|function|const) ([A-Za-z0-9_]+)/gm, (_, kind, name) => { names.push(name); return `${kind} ${name}`; });
  return `// GENERATED from public/js/kanban/kanban-core.js by test/kanban-core-copy.mjs.\n// Do not edit: change the source and run  node test/kanban-core-copy.mjs --write\n"use strict";\n${body}\nmodule.exports = { ${names.join(", ")} };\n`;
}

const want = buildCopy(fs.readFileSync(SRC, "utf8"));
if (process.argv.includes("--write")) { fs.writeFileSync(OUT, want); console.log("wrote", path.relative(root, OUT)); }
else {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (have !== want) { console.error("functions/kanban-core.js is out of date: run  node test/kanban-core-copy.mjs --write"); process.exit(1); }
  console.log("ok  functions/kanban-core.js matches public/js/kanban/kanban-core.js");
}
