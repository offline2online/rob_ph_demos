# PH Agent Endpoint (snippet)

Makes the public pages of personalisationhub.com readable by AI agents.

**Target and connection.** Build and deploy on personalisationhub.com through the personalisationhub.com WordPress MCP (user `ph-mcp`). offline2online.com is an unrelated company and is never used for PH Website work. If a ticket seems to need site access, use that MCP first; only if it is genuinely unavailable is the ticket blocked, and it says exactly that.
Part 1 of the agent endpoint release (ticket "Site-wide llms.txt, markdown
twins and JSON-LD"). Design: project document "Agent endpoint release:
design and build guide", sections 1 to 3 and 7.

| File | What it does |
| --- | --- |
| `lib.php` | Pure helpers, no WordPress calls: the page allow-list (ids in one constant), shared Organization (`#organization`) and SoftwareApplication (`#software`, AWS free trial offer) nodes, HTML to markdown, llms.txt sections |
| `tools.php` | Pure: the shared tool contract (design guide s.4): the tool definitions (each with a title, a 1-3 sentence description and the three annotations), `agents_llms_md()` (the llms.txt "For AI agents" section) and `server_card()`, argument validation, `/support-centre/` URL check, `run_tool()` returning a CallToolResult |
| `install-spec.php` | Pure (1.5.0): the one source of truth for the `get_installation_spec` tool, `installation_spec()` (Marketplace listing and product ID, subscribe link, pricing, prerequisites, CloudFormation launch steps and parameters, deployment, verification, recovery, teardown, human-approval steps, hand-off note) and `installation_spec_md()`. Every value is confirmed against the live listing (checked 4 Nov 2026) or the Help Centre install articles; anything not public is `{status: "unconfirmed", value: null, note}` and a test fails if one gains a value. **Not yet supplied by the owner (follow-up ticket): the IAM policy JSON, the CloudFormation template URL, the full region list, the health-check endpoint.** Do not invent them. Edit this file to add them; WebMCP and the remote MCP server both read it through the same REST route, so they cannot differ |
| (tool `calculate_business_model`, 1.6.0) | Defined in `tools.php`, reads the one list of calculators in the Industries snippet (`ph-industry-enhancements/calculators.php`): `industry` (enum from that list, omit to list them) and `inputs` (figures by id; missing ones use defaults and the result names them). Returns the estimate (the same formulas as the on-page calculator), the figures used and a calculator link with the figures pre-filled. It never takes or stores a name, company or email: the gated .xlsx download is completed by the person on the page (or by the on-page WebMCP tool `run_business_model_calculator` when the person gave those details and agreed). Not offered when the Industries snippet is not loaded. A new industry in that list appears here with no change to this snippet |
| `proxy.php` | 1.8.0 (14 Nov 2026): the public help API and remote MCP server on personalisationhub.com. `GET /help-api/search`, `/help-api/article`, `/help-api/data/*` and `POST /mcp` (also `/help-api/mcp`; `GET /mcp` is passed on and answers 405, as the stateless server always has) are forwarded server side to the help service; `GET /help-api/` is a JSON index answered here. Same status, content type and body; `Mcp-Session-Id`/`Mcp-Protocol-Version` passed both ways; 6 s (help) and 12 s (MCP) timeouts answer 504/502 with no upstream detail; 60 and 30 requests a minute per address (an MCP batch counts each message) and a 60 s shared cache, so the help service sees this server, not every agent. Every console address in an answer (article links, tool results and descriptions) is rewritten to its personalisationhub.com equivalent (articles to `/support-centre/...`). The console's address is in one constant, `UPSTREAM_HELP_API`, and is never printed. Pure helpers; `main.php` wires them at `parse_request`. Tests: `tests/help-proxy.test.php` |
| `webmcp.js` | The WebMCP loader (under 2 KB), printed inline in the footer of allow-listed pages: does nothing without `navigator.modelContext`, otherwise fetches the tool list once and registers each tool; `execute` calls the endpoint |
| `faq.php`, `faq-data.php` | Feature Q&A (1.4.0, styled in 1.4.1): pure helpers and the content. `faq_css()` is the block's small scoped stylesheet (H2 at section-heading size, questions 21px/600/not title-cased, answers at body size, links brand teal #169BC2 with hover #0F7A9A and underline, spacing at desktop and 390 px), printed once in `wp_head` at priority 22 on pages with a block and never inside the block, so the markdown twin stays clean. `faq-data.php` holds 4 to 6 questions for each live feature page (digital signage, personalisation, AI agents, queue management, appointments, store sites, localisation) and 5 on the home page for self-hosted AWS deployment. Each answer is a one or two sentence direct answer, then detail, then Help Centre links. `faq_html()`, `faq_graph()` (FAQPage JSON-LD) and the markdown twin all read the same data |
| `main.php` | WordPress glue (1.8.0 serves `/help-api/*` and `/mcp` through `proxy.php` at `parse_request`; 1.7.0 adds `/llms-full.txt` and `/.well-known/mcp.json`, both cached like the twins): inline JSON-LD in `wp_head`, `?format=md` twin (text/markdown, canonical Link header, 5 min transient plus `max-age=300`), `ph_llms_txt` filter at priority 20; `extra_pages()` reads the `ph_agent_extra_pages` filter (14 Nov 2026: pages another snippet exposes once they are live, each `{title, url, summary, md}` on personalisationhub.com; `describe_platform` lists them under "More from Personalisation Hub" and `/llms-full.txt` adds their markdown; the Industries snippet's Run Your Own RMN page adds itself only when `OPERATOR_LIVE`) |
| `../../tests/run.php`, `../../tests/webmcp.test.js` | Offline tests: `php ph-website/tests/run.php` and `node ph-website/tests/webmcp.test.js` (both run by `backlog-tracker/test`'s `test:mcp`) |

Covers Home, the 8 feature pages and /privacy-policy/, /legal/, /support/.
Drafts, scheduled, private, password-protected and noindex pages, and
anything off the allow-list, get no twin, no JSON-LD and no llms.txt line.
No assets, no remote calls while rendering.

## Tools endpoint (ticket "WebMCP tools on site pages")

`GET /wp-json/ph-agent/v1/tools` lists the ten tools (the public remote MCP server `POST https://personalisationhub.com/mcp` proxies this contract live, cached 5 minutes) (`describe_platform`, `list_industries`, `get_industry`, `get_feature`, `search_help`, `get_help_article`, `start_free_trial`, `book_demo`, `get_installation_spec`, `calculate_business_model`) with `inputSchema` and `annotations.readOnlyHint`. `GET /wp-json/ph-agent/v1/tools/{name}?args=<json>` returns an MCP CallToolResult (`content`, `structuredContent`, `isError`). Public and read-only. It reads live published content at call time: allow-listed pages through `twin_for()`, industries through the Industries snippet's markdown, help through the Support Centre's own `search_articles()` / `markdown()` on its live catalogue (always the live release; `?release=` is ignored). Results are cached 5 minutes (transient plus `Cache-Control: public, max-age=300`); errors are never cached. Saving an allow-listed page, an industry page or a help article starts a new cache generation. Bad input returns `isError` with a plain message.

The Support Centre no longer registers WebMCP tools itself (sc.js `initWebMcp` removed in 1.3.1); this snippet registers all nine on every allow-listed page, industries, blog, and Support Centre page. Ticket 5 (RevOps): see below.

## Deploying (PH Website session, after Deploy to Main)

`main.php` requires `lib.php` by `__DIR__`; if Angie snippets can't hold two
files, concatenate `lib.php` above `main.php` (drop the second `<?php` and
the `require_once`). Namespace is `AngieSnippets\PhAgentEndpoint___ID__`, the convention of the other snippets; the PH Website
session substituted the real id for `___ID__` at first deploy (snippet 10646, 4 Nov 2026) and recorded it in `snippets/MANIFEST.json`
(repo and live hashes both).

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

## Feature Q&A (ticket "Feature-specific Q&A sections on product and feature pages")

Each page in `faq-data.php` gets a visible Q&A block (`<section class="ph-faq" id="questions">`) appended to its content by a `the_content` filter at priority 99, a second `application/ld+json` script with an `FAQPage` (`<page>#faq`, `isPartOf` the page's `#webpage`) in `wp_head` at priority 21, and the same block at the end of its markdown twin. Not shown in the Elementor editor or preview. The answers are consistent with, and link to, Help Centre articles; `tests/faq.test.php` checks that every link resolves to a published article in `faq/data/index.json`, that there are 4 to 6 questions per page, that an answer opens with one or two sentences, that nothing mentions DSP or programmatic media, and that the JSON-LD matches the visible text. The retail media page (3266) has no block because that product is not live yet. To change an answer, edit `faq-data.php` only.
