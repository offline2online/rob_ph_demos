// Small, dependency-free Markdown -> HTML renderer for the Docs page's
// README / Requirements reading view. Everything is HTML-escaped FIRST and
// only a fixed set of tags is then produced from the escaped text, so no
// markup in a document can reach the page. Links are limited to http(s),
// mailto and in-page/relative targets. No Firebase, no DOM (testable in node).

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeHref(h) {
  const u = String(h || "").trim().replace(/&amp;/g, "&");
  if (/^(https?:|mailto:|#|\/|\.{0,2}\/)/i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return esc(u);
  return null;
}

// Inline spans on an already-escaped string.
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (m, text, href) => {
    const h = safeHref(href);
    if (m[0] === "!" || h === null) return text;
    return `<a href="${h}" target="_blank" rel="noopener">${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const isTableSep = (l) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l || "");
const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function renderMarkdown(md) {
  const lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) { buf.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { out.push(`<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`); i += 1; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i += 1; continue; }
    if (line.includes("|") && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(cells(lines[i])); i += 1; }
      out.push(`<div class="docs-md-table"><table><thead><tr>${head.map((c) => `<th>${inline(esc(c))}</th>`).join("")}</tr></thead><tbody>${
        rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(esc(r[k] || ""))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i += 1; }
      out.push(`<blockquote>${inline(esc(buf.join(" ")))}</blockquote>`);
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) { items.push(m[3]); i += 1; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i += 1; }
        else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(esc(t))}</li>`).join("")}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i]) && !(lines[i].includes("|") && isTableSep(lines[i + 1]))) { buf.push(lines[i].trim()); i += 1; }
    if (!buf.length) { buf.push(lines[i].trim()); i += 1; }
    out.push(`<p>${inline(esc(buf.join(" ")))}</p>`);
  }
  return out.join("\n");
}
