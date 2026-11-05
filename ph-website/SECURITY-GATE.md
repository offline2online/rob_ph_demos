# Security gate: agent endpoint release

The go-live gate for the site-wide agent endpoint release (seven tickets, one release). Design: project document "Agent endpoint release: design and build guide", section 6. Written by the build session for the gate ticket; findings were found by reading the code of every endpoint on the train and attacking it with the offline harnesses (no production traffic was sent from the build sandbox).

**Status: every high and critical finding is fixed on the train. The gate is not closed until the three post-deploy items in section 5 are done by the PH Website session.**

## 1. Scope

| Endpoint | Code |
| --- | --- |
| `GET /wp-json/ph-agent/v1/tools`, `/tools/{name}?args=` | `snippets/ph-agent-endpoint/main.php`, `tools.php` |
| Markdown twins `?format=md` (allow-listed pages, industries, blog, Support Centre) | `ph-agent-endpoint`, `ph-industry-enhancements/md.php`, `ph-blog`, `ph-support-centre` |
| `/llms.txt` and the `ph_llms_txt` filter | `ph-industry-enhancements/llms.php` plus each snippet's section |
| `GET /help-api/search`, `GET /help-api/article` | `backlog-tracker/functions/help-search.js` |
| `POST /help-api/mcp` (remote MCP server) | same file |
| `/go/free-trial/`, `/go/demo/` (tracked CTA hop) | `ph-agent-endpoint/main.php`, `tools.php` |
| PH Blog snippet output (the blog's open security review) | `snippets/ph-blog/` |

## 2. Findings and fixes

Severity: Critical = takes the site or data; High = unauthenticated abuse or bypass of a control the release relies on; Medium = weakens a control or leaks a little; Low = hygiene.

| Id | Sev | Finding | Fix (on this train) | Test |
| --- | --- | --- | --- | --- |
| PT-01 | **High** | The help API's rate limit keyed on the **first** `X-Forwarded-For` entry, which the caller writes. Changing the header bought a fresh budget on every request, so the 429s, the abuse alert and the top-offender list could all be dodged. | Client = the edge's `Fastly-Client-IP`; otherwise count from the **right** (the entry before the last hop), so anything a caller prepends only moves entries left. `help-search.js` `clientIp()`. | `help-search.test.js` 5c: five spoofed headers, one budget; edge address has its own budget |
| PT-04 | **High** | `ph-agent/v1/tools/{name}` had no rate limit, and each distinct `args` string created its own 5-minute transient, so a loop of unique queries filled `wp_options`. | Fixed-window limit of 120 requests a minute per address (hashed with the site salt, never stored): `429`, `Retry-After`, `Cache-Control: no-store`. Cache key built from sorted decoded args (`args_key()`), so equivalent calls share one entry. Limit adjustable with the `ph_ae_rate_max_tools` filter. | `tests/run.php`: 120 pass, 121st is 429; key order independent |
| PT-02 | Medium | Every `/go/…` hit read and rewrote the `ph_ae_cta_log` option: an unauthenticated write on each request. | 30 hops a minute per address are recorded; beyond that the visitor is still redirected but nothing is written. | `tests/run.php`: 31st hop is over the limit, another address is not |
| PT-03 | Medium | An MCP batch of up to 20 messages cost one unit of rate limit, a 20-fold amplification onto the WordPress tools route. | A batch is charged one unit per message. | `help-search.test.js` 5c |
| PT-05 | Medium | WordPress reflects any `Origin` and sends `Access-Control-Allow-Credentials: true` on REST responses. Harmless today (public, read-only, no cookies), but it would turn into a hole the day any of these routes read the logged-in user. | `rest_pre_serve_request` filter on `/ph-agent/v1` only: `Access-Control-Allow-Origin: *`, credentials header removed, `nosniff`, `Cross-Origin-Resource-Policy: cross-origin`. | `tests/run.php` registers the filter; live header check in `e2e-live.mjs` |
| PT-06 | Medium | `/help-api/article` returns JSON or markdown at one URL depending on `Accept`, with `Cache-Control: public` and no `Vary`: a shared cache could serve markdown to a JSON client (cache poisoning by one request with the other `Accept`). | `Vary: Accept` on the response. | `help-search.test.js` 5c; live in `e2e-live.mjs` |
| PT-07 | Low | The "Unknown argument" tool error echoed the caller's key name unfiltered into text an LLM then reads. | Key is reduced to `[\w .\/-]` and 40 characters, as the enum error already was. | `tests/run.php` |
| PT-08 | Low | The blog's markdown twin lacked `X-Content-Type-Options: nosniff`. | Header added. | `e2e-live.mjs` (twin content type) |

No critical findings. No open high findings.

### Accepted residual risk (not findings)

* **R-1 Per-instance counters.** The help API's buckets live in each Cloud Function instance (`maxInstances: 10`), so a determined client spread across instances can get up to ten times the limit. The 5-minute cache in front of WordPress (WP_TTL 5 min, 4 s timeout, 256 KB cap) bounds what that costs. Moving the counters to Firestore would add a write per request; not worth it at this traffic. Revisit if the abuse alert fires.
* **R-2 `REMOTE_ADDR` behind a proxy. CLOSED (4 Nov 2026, Rob).** The WordPress limit keys on `REMOTE_ADDR`. Checked on 4 Nov 2026: behind Cloudflare, WordPress sees the real client address in `REMOTE_ADDR`, not a Cloudflare range, so visitors do not share one budget. No filter or `ph_ae_rate_max_tools` change is needed. Re-check only if the CDN or proxy setup changes; a `429` on the tool route in the first minute of normal use would be the sign.
* **R-3 The publishing account stays admin** (Rob, 3 Nov 2026). Moving the `ph-mcp` account on the personalisationhub.com WordPress MCP to least privilege is out of scope for this release.

## 3. Pen test checklist and results

"Offline" = proved by the tests listed; "Live" = also checked by `e2e-live.mjs` on production.

### 3.1 Injection in tool arguments

| Test | Result |
| --- | --- |
| Every argument is validated against the tool's `inputSchema` before anything reads it: type, `enum`, `minLength`/`maxLength`, integer range, unknown keys refused (`validate_args`) | Pass (offline; Live) |
| SQL, shell and template payloads in `query`, `slug`, `url` (`' OR 1=1`, `$(id)`, `{{7*7}}`, `<script>`) | Pass: `slug` is an enum; `query` is only tokenised and scored in memory (PHP and Node), never reaches a database query or a shell |
| `args` that is not JSON, not an object, a list, `null`, 2001+ characters, nested arrays | Pass: `isError`, no cache entry (`tests/run.php`, Live) |
| Wrong types (`limit` as string or float, `query` as array) | Pass: refused |
| Prototype pollution in MCP `arguments` (`__proto__`, `constructor`) | Pass: arguments are only serialised into a query string for the fixed WordPress origin and validated there |

### 3.2 Path traversal and SSRF via `get_help_article`

The tool never fetches what the caller sends. It normalises the URL to a `/support-centre/…` path (`help_article_path`) and looks it up by **equality** against the paths of the articles that are visible right now.

| Input | Result |
| --- | --- |
| `https://evil.example/support-centre/x/`, `https://personalisationhub.com.evil.example/…`, `https://user@personalisationhub.com/…` | Refused (host and user-info checks) |
| `…/support-centre/../wp-admin/`, `%2e%2e`, `%2f`, `%5c`, `%00`, `//`, backslash, control characters | Refused |
| `http://169.254.169.254/latest/meta-data/`, `file:///etc/passwd`, `ftp://…`, `javascript:` | Refused (scheme and host) |
| `/digital-signage/`, `/support-centre/` (no article) | Refused |
| A well-formed path for a draft, out-of-range or unknown article | "No published Support Centre article", nothing else revealed |
| Help API `article?id=` with `../../etc/passwd`, `x'; DROP`, `%00`, 5000 characters | `404`; the id is only compared with Firestore ids in memory |
| Help API markdown twin fetch | Fixed origin: only URLs from the Support Centre's own published map that pass `safeSupportUrl` (https, `personalisationhub.com` host) are fetched, 4 s timeout, size cap |

Offline: 10 refused URL forms in `tests/run.php`, plus `help-leak.test.js`. Live: `e2e-live.mjs` "traversal and SSRF through get_help_article are refused".

### 3.3 Open redirect in the CTA hop

| Test | Result |
| --- | --- |
| Target comes from `go_targets()` constants (`free-trial`, `demo`); never from the request | Pass |
| `?via=https://evil.example`, `?to=`, `?url=`, `//evil.example`, `/go/https://evil.example`, `/go//evil.example/`, `/go/demo/../x`, `/go/demo/extra/` | Pass: unknown slug is no hop; `via` is allow-listed to `webmcp`, `remote-mcp`, otherwise `agent` |
| Response headers | `302`, `nocache_headers()`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` |
| What is logged | CTA, source, referrer **host**, time. No IP, user agent, query or free text (`cta_event`) |

### 3.4 Cache poisoning

| Test | Result |
| --- | --- |
| Tool results cached by `(generation, tool, sorted args)` in a transient; only successful results; errors `no-store` | Pass |
| A visitor cannot pick the release (`?release=` is removed while the live catalogue is read) | Pass |
| Request headers do not change a tool answer, so `Cache-Control: public, max-age=300` on a tool URL is safe | Pass |
| `/help-api/article` JSON vs markdown at one URL | Fixed (PT-06) |
| Remote MCP cache key is the stable-serialised arguments for a fixed allow-listed tool name; a failed fetch is cached 30 s and the last good answer is kept | Pass |
| Twin cache key includes the page's modified time; saving an allow-listed page starts a new generation | Pass |

### 3.5 Rate limits and 429s

| Endpoint | Limit | Result |
| --- | --- | --- |
| `/help-api/search`, `/article` | 60 a minute per client | `429`, `Retry-After`, `Cache-Control: no-store`, `X-RateLimit-*`; spoof fixed (PT-01) |
| `/help-api/mcp` | 30 a minute per client, batch charged per message | Fixed (PT-03) |
| `/wp-json/ph-agent/v1/tools/{name}` | 120 a minute per address | Added (PT-04) |
| `/go/{slug}/` | 30 recorded a minute per address | Added (PT-02) |
| Body limits | MCP batch ≤ 20, tool `args` ≤ 2000 characters, query ≤ 300 | Pass |

Live: `e2e-live.mjs` "help API answers 429" always; "WordPress tool route answers 429" with `--stress`.

### 3.6 Error leakage

| Test | Result |
| --- | --- |
| Tool failures are caught (`\Throwable`) and become "That did not work. Try again later." A thrown exception containing a server path does not appear in the result | Pass (`tests/run.php`) |
| Help API: 500 returns `{"error":"server_error"}` only; stack goes to the server log | Pass |
| `404`, `405`, bad JSON-RPC, odd query strings (`q[]=a&q[]=b`) | Pass: JSON error, no HTML, no framework text |
| Output scanned for `Fatal error`, `Warning:`, `Stack trace`, `/var/www`, `wp-content/plugins`, `PDOException` | None, offline (`leak.php`, 538 checks) and Live |

### 3.7 CORS and security headers

| Endpoint | Headers | Result |
| --- | --- | --- |
| `ph-agent/v1` | `Access-Control-Allow-Origin: *`, no credentials, `nosniff`, CORP | Fixed (PT-05) |
| Twins | `Content-Type: text/markdown`, `X-Content-Type-Options: nosniff` (agent endpoint, blog after PT-08), canonical `Link` | Pass |
| `/help-api/**` | `Access-Control-Allow-Origin: *` (public, no cookies), `nosniff`, CSP `default-src 'none'`, HSTS, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy` (Hosting headers in `backlog-tracker/firebase.json`) | Pass |
| Preflight | `OPTIONS` answered `204` with the allowed methods and headers only | Pass |

### 3.8 Output escaping in the PH Blog snippet (the blog's open security review)

| Area | Result |
| --- | --- |
| Titles, kick line, byline, dek, series name and part text, menu counts, sort labels | `esc_html`, no raw output |
| Attribute values (`data-desk`, `data-date`, `data-mins`, `title`, `aria-label`) | `esc_attr` |
| URLs (`href` of menu, series, Read next, previous/next) | `esc_url( get_permalink() )` |
| JSON-LD | `wp_json_encode` with `JSON_HEX_TAG`: `</script>` in a title cannot end the block |
| Markdown twin | Plain text served as `text/markdown`, `nosniff` |
| `blog.js` | No `innerHTML`, `eval`, `document.write`. The `?section=` value is stripped to `[a-z]` before it is used in a selector, so selector injection is not possible. `sessionStorage` values pass the same strip |
| Post body (`the_content`) | Editors' own HTML, as in WordPress core; the publishing account is a trusted editor |

**Blog security review: closed.** No finding above medium; the only change is the `nosniff` header (PT-08).

## 4. Other tickets' gates

| Ticket | Check | Result |
| --- | --- | --- |
| Leak tests (`qOPs`) | `php ph-website/tests/leak.php`: draft, scheduled, private, password-protected and noindex pages, demo pages, out-of-range help articles and internal fields across llms.txt, twins, JSON-LD, the tool list, every tool call, the loader and the Support Centre routes | **538 checks passed.** `node backlog-tracker/test/help-leak.test.js`: all checks passed. Both run inside `test:mcp`, so every train runs them |
| Rate limits and alerts (`jB00`) | `help-search.test.js`: 429, Retry-After, window reset, abuse and error alert thresholds, 30-minute cooldown, test alert | Passed offline. **Live `helpApiTestAlert` delivery is a post-deploy step (section 5, item 2):** it needs the deployed function and the board key, neither of which the build sandbox has |
| RevOps events (`rH5S`) | `tests/run.php` and `webmcp.test.js`: `ph_agent_tool` dataLayer event, `agentToolLog` row shape (no IP, user agent, arguments or result text), `ph_agent_cta` event shape, via allow-list | Passed offline. **Live check is section 5, item 3** |

## 5. Post-deploy steps (PH Website session, with the personalisationhub.com WordPress MCP as `ph-mcp`; never offline2online.com)

Do these after Deploy to Main and after publishing the changed snippets (`README.md` → How a deploy works). Attach the output to the ticket.

1. **End-to-end check on production:** `node ph-website/tests/e2e-live.mjs`. It covers every page type, every tool, the twins, JSON-LD, llms.txt, the CTA links, 429 on the help API, the headers and the console. Add `--stress` once to see the WordPress route's 429 (it spends that address's minute). Any FAIL stops the release; a `429` from the tool route in the first minute of normal use would mean the R-2 check (closed 4 Nov 2026) no longer holds.
2. **Alert delivery:** call `helpApiTestAlert` with the board key (it posts the test alert to the webhook) and confirm the alert reaches Rob.
3. **RevOps:** call `start_free_trial` through the remote MCP server (`/help-api/mcp`) and through a WebMCP page, follow each `trackedUrl`, then check that one `agentToolLog` row (`source: "remote-mcp"`), one `ph_agent_tool` dataLayer event and one `ph_agent_cta` event exist, and that none of them holds an IP, user agent or free text.
4. **Roll back** if (1) fails and the cause is not a flaky page: republish the previous snippet versions from the snapshot taken before the deploy.

## 6. Sign-off

| Gate | State |
| --- | --- |
| Pen test record: every high and critical finding fixed | **Done** (PT-01, PT-04 high; no critical) |
| Leak tests green | **Done** (538 + help-leak) |
| Rate limits and alerting verified | Offline done; live alert delivery pending (5.2) |
| Blog security review closed | **Done** (3.8) |
| Rob's sign-off | Recorded on the ticket: "Rob, 4 Nov 2026: permission to deploy this release live". The build session cannot give or extend it |
| Post-deploy end-to-end check on production | Pending (5.1): runs only after the deploy |
