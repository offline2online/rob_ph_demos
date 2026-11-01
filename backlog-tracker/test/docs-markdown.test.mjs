// The Docs page's Markdown reading view must never let document text become markup.
import assert from "node:assert/strict";
import { renderMarkdown } from "../public/js/docs-markdown.js";

assert.match(renderMarkdown("# Title"), /<h1>Title<\/h1>/);
assert.match(renderMarkdown("- a\n- b **bold** `c`"), /<ul><li>a<\/li><li>b <strong>bold<\/strong> <code>c<\/code><\/li><\/ul>/);
assert.match(renderMarkdown("1. one\n2. two"), /<ol><li>one<\/li><li>two<\/li><\/ol>/);
assert.match(renderMarkdown("|a|b|\n|-|-|\n|1|2|"), /<th>a<\/th>[\s\S]*<td>2<\/td>/);
assert.match(renderMarkdown("```\n<b>x</b>\n```"), /<pre><code>&lt;b&gt;x&lt;\/b&gt;<\/code><\/pre>/);
// raw HTML and script URLs are neutralised
const evil = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>');
assert.ok(!/<script|<img/i.test(evil), evil);
assert.ok(!/href="javascript/i.test(evil), evil);
assert.match(renderMarkdown("[ok](https://example.com)"), /<a href="https:\/\/example.com" target="_blank" rel="noopener">ok<\/a>/);
assert.equal(renderMarkdown(""), "");
console.log("docs-markdown: ok");
