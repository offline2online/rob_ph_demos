// Small, dependency-free HTML -> markdown conversion for help article bodies
// (the console's bodyMd holds rich-text HTML). Handles headings, paragraphs,
// lists (nested), tables, links, bold/italic, inline and fenced code, quotes.
"use strict";

function decode(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return m; } })
    .replace(/&amp;/gi, "&");
}
const strip = (s) => s.replace(/<[^>]+>/g, "");
const squash = (s) => s.replace(/\s+/g, " ").trim();

function htmlToMarkdown(html) {
  let s = String(html == null ? "" : html).replace(/\r/g, "");
  if (!/<\/?[a-z][^>]*>/i.test(s)) return s; // already markdown / plain text
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const keep = [];
  const hold = (text) => { keep.push(text); return `\u0000${keep.length - 1}\u0000`; };
  // code blocks first, so nothing inside them is touched
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (m, c) => `\n\n${hold("```\n" + strip(c).replace(/^\n+|\n+$/g, "") + "\n```")}\n\n`);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (m, c) => hold("`" + strip(c).replace(/`/g, "'") + "`"));
  // inline
  s = s.replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (m, h1, h2, t) => {
    const text = squash(strip(t)); const href = (h1 || h2 || "").trim();
    return text && href && !/^javascript:/i.test(href) ? `[${text}](${href})` : text;
  });
  s = s.replace(/<img\b[^>]*>/gi, (m) => {
    const src = (m.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i) || [])[1] || (m.match(/\bsrc\s*=\s*'([^']*)'/i) || [])[1];
    const alt = (m.match(/\balt\s*=\s*"([^"]*)"/i) || [])[1] || "";
    return src ? `![${alt}](${src})` : "";
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, t, c) => (squash(strip(c)) ? `**${squash(strip(c))}**` : ""));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, t, c) => (squash(strip(c)) ? `*${squash(strip(c))}*` : ""));
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // headings
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, c) => `\n\n${"#".repeat(Number(n))} ${squash(strip(c))}\n\n`);
  // tables
  s = s.replace(/<table\b[\s\S]*?<\/table>/gi, (t) => {
    const rows = (t.match(/<tr\b[\s\S]*?<\/tr>/gi) || []).map((r) =>
      (r.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map((c) => squash(strip(c.replace(/<br\s*\/?>/gi, " "))).replace(/\|/g, "\\|")));
    const cols = Math.max(0, ...rows.map((r) => r.length));
    if (!rows.length || !cols) return "";
    const line = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] || "").join(" | ")} |`;
    return `\n\n${hold([line(rows[0]), `| ${Array(cols).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n"))}\n\n`;
  });
  // lists, innermost first so nesting indents correctly
  const listRe = /<(ul|ol)\b[^>]*>((?:(?!<\/?(?:ul|ol)\b)[\s\S])*?)<\/\1>/i;
  for (let guard = 0; guard < 50 && listRe.test(s); guard++) {
    s = s.replace(listRe, (m, kind, inner) => {
      let n = 0; const out = [];
      inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (mm, c) => {
        n += 1;
        const mark = kind.toLowerCase() === "ol" ? `${n}. ` : "- ";
        const expanded = c.replace(/\u0000(\d+)\u0000/g, (x, i) => `\n${keep[Number(i)]}\n`);
        const clean = strip(expanded.replace(/<\/?(p|div)\b[^>]*>/gi, "\n")).split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
        if (!clean.length) return mm;
        out.push(mark + clean[0].trim());
        for (const l of clean.slice(1)) out.push(" ".repeat(mark.length) + (/^\s*(- |\d+\. )/.test(l) ? l : l.trim()));
        return mm;
      });
      return `\n\n${hold(out.join("\n"))}\n\n`;
    });
  }
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, c) => `\n\n${squash(strip(c.replace(/<\/p>/gi, " "))).replace(/^/, "> ")}\n\n`);
  s = s.replace(/<hr\b[^>]*>/gi, "\n\n---\n\n");
  s = s.replace(/<\/(p|div|section|article|figure|tr)>/gi, "\n\n").replace(/<(p|div|section|article|figure)\b[^>]*>/gi, "\n\n");
  s = strip(s);
  s = decode(s);
  s = s.split("\n").map((l) => l.replace(/[ \t]+$/g, "").replace(/^ +(?=\S)/, (w) => (w.length >= 2 ? w : ""))).join("\n");
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => decode(keep[Number(i)]));
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { htmlToMarkdown };
