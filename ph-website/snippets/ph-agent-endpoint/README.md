# PH Agent Endpoint (snippet)

Makes the public pages of personalisationhub.com readable by AI agents.
Part 1 of the agent endpoint release (ticket "Site-wide llms.txt, markdown
twins and JSON-LD"). Design: project document "Agent endpoint release:
design and build guide", sections 1 to 3 and 7.

| File | What it does |
| --- | --- |
| `lib.php` | Pure helpers, no WordPress calls: the page allow-list (ids in one constant), shared Organization (`#organization`) and SoftwareApplication (`#software`, AWS free trial offer) nodes, HTML to markdown, llms.txt sections |
| `tools.php` | Pure: the shared tool contract (design guide s.4): the eight tool definitions, argument validation, `/support-centre/` URL check, `run_tool()` returning a CallToolResult |
| `webmcp.js` | The WebMCP loader (under 2 KB), printed inline in the footer of allow-listed pages: does nothing without `navigator.modelContext`, otherwise fetches the tool list once and registers each tool; `execute` calls the endpoint |
| `main.php` | WordPress glue: inline JSON-LD in `wp_head`, `?format=md` twin (text/markdown, canonical Link header, 5 min transient plus `max-age=300`), `ph_llms_txt` filter at priority 20 |
| `../../tests/run.php`, `../../tests/webmcp.test.js` | Offline tests: `php ph-website/tests/run.php` and `node ph-website/tests/webmcp.test.js` (both run by `backlog-tracker/test`'s `test:mcp`) |

Covers Home, the 8 feature pages and /privacy-policy/, /legal/, /support/.
Drafts, scheduled, private, password-protected and noindex pages, and
anything off the allow-list, get no twin, no JSON-LD and no llms.txt line.
No assets, no remote calls while rendering.

## Tools endpoint (ticket "WebMCP tools on site pages")

`GET /wp-json/ph-agent/v1/tools` lists the eight tools (the public remote MCP server `POST https://backlog-tracker-e4ed2.web.app/help-api/mcp` proxies this contract live, cached 5 minutes) (`describe_platform`, `list_industries`, `get_industry`, `get_feature`, `search_help`, `get_help_article`, `start_free_trial`, `book_demo`) with `inputSchema` and `annotations.readOnlyHint`. `GET /wp-json/ph-agent/v1/tools/{name}?args=<json>` returns an MCP CallToolResult (`content`, `structuredContent`, `isError`). Public and read-only. It reads live published content at call time: allow-listed pages through `twin_for()`, industries through the Industries snippet's markdown, help through the Support Centre's own `search_articles()` / `markdown()` on its live catalogue (always the live release; `?release=` is ignored). Results are cached 5 minutes (transient plus `Cache-Control: public, max-age=300`); errors are never cached. Saving an allow-listed page, an industry page or a help article starts a new cache generation. Bad input returns `isError` with a plain message.

The Support Centre no longer registers WebMCP tools itself (sc.js `initWebMcp` removed in 1.3.1); this snippet registers all eight on every allow-listed page, industries, blog, and Support Centre page. Ticket 5 (RevOps): see below.

## Deploying (PH Website session, after Deploy to Main)

`main.php` requires `lib.php` by `__DIR__`; if Angie snippets can't hold two
files, concatenate `lib.php` above `main.php` (drop the second `<?php` and
the `require_once`). Namespace is `AngieSnippets\PhAgentEndpoint___ID__`, the convention of the other snippets; the PH Website
session substitutes the real id for `___ID__` at first deploy and records it in `snippets/MANIFEST.json`
(`"id": null` until then).

## Shared entities across the site

Every page declares the same `Organization` (`https://personalisationhub.com/#organization`) and
`SoftwareApplication` (`#software`) nodes, with identical properties. `organization_node()` and
`software_node()` in `lib.php` are the source; the Blog (1.0.8), Support Centre (1.3.2) and Industries
(`ld.php`) snippets carry identical copies (their own functions, so none depends on this snippet being
loaded). `tests/run.php` renders Home, a Blog post, the Support Centre and an industry page through each
snippet's own code and fails if the nodes differ or any `#org` id remains. Change a property in all four
places together.

## RevOps signals (ticket "RevOps signals from agent tool calls and CTAs")

Agent traffic is logged without personal data. No IP, user agent, query string, email or free-text argument is ever stored.

| Signal | Where | Fields |
| --- | --- | --- |
| Tool call from a WebMCP browser | `webmcp.js` pushes a `dataLayer` event `ph_agent_tool` (the `ph_ind_calculator` pattern, so GTM forwards it to RevOps) | `tool`, `source: "webmcp"`, `page_path` (path only), `referrer` (host or `none`), `at` |
| Tool call from an MCP client | `backlog-tracker/functions/help-search.js` writes one `agentToolLog` Firestore row per `tools/call` (server-written, members read) | `tool`, `source: "remote-mcp"`, `referrer` (Origin/Referer host or null), `at`, `cached`, `ok` |
| CTA click by an agent | `start_free_trial` and `book_demo` return `trackedUrl` (`/go/free-trial/?via=webmcp`, `/go/demo/?via=webmcp`; the remote server rewrites `via` to `remote-mcp`) beside the exact `url`. `main.php` serves `/go/<slug>/`, records `ph_agent_cta` and answers a 302 to the exact link | `cta`, `source` (`webmcp`, `remote-mcp` or `agent`), `agent: true`, `referrer` host, `at` |

The hop's target comes from `go_targets()` in `tools.php`, never from the request, so it cannot be used as an open redirect. Events are appended to a capped option (`ph_ae_cta_log`, last 500) and passed to `do_action( 'ph_agent_cta', $event )` for RevOps listeners. A human click on the same CTA goes straight to the link (or through the site's existing `ph_ind_cta` event) and never carries `agent: true`.

## Security gate (ticket "Security gate and go-live")

1.3.0 adds, from the pen test in `../../SECURITY-GATE.md`: a per-address rate limit on `/ph-agent/v1/tools/{name}` (120 a minute, `429` with `Retry-After`; `ph_ae_rate_max_tools` filter) and on the CTA hop's recording (30 a minute; the redirect always happens), a cache key built from sorted arguments, CORS `*` without credentials plus `nosniff` on `/ph-agent/v1` responses only, and a sanitised "Unknown argument" error. The address is hashed with the site salt for the counter and never stored.
