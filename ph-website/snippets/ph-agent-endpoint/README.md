# PH Agent Endpoint (snippet)

Makes the public pages of personalisationhub.com readable by AI agents.
Part 1 of the agent endpoint release (ticket "Site-wide llms.txt, markdown
twins and JSON-LD"). Design: project document "Agent endpoint release:
design and build guide", sections 1 to 3 and 7.

| File | What it does |
| --- | --- |
| `lib.php` | Pure helpers, no WordPress calls: the page allow-list (ids in one constant), shared Organization (`#organization`) and SoftwareApplication (`#software`, AWS free trial offer) nodes, HTML to markdown, llms.txt sections |
| `main.php` | WordPress glue: inline JSON-LD in `wp_head`, `?format=md` twin (text/markdown, canonical Link header, 5 min transient plus `max-age=300`), `ph_llms_txt` filter at priority 20 |
| `../../tests/run.php` | Offline tests: `php ph-website/tests/run.php` (also run by `backlog-tracker/test`'s `test:mcp`) |

Covers Home, the 8 feature pages and /privacy-policy/, /legal/, /support/.
Drafts, scheduled, private, password-protected and noindex pages, and
anything off the allow-list, get no twin, no JSON-LD and no llms.txt line.
No assets, no remote calls while rendering.

## Deploying (PH Website session, after Deploy to Main)

`main.php` requires `lib.php` by `__DIR__`; if Angie snippets can't hold two
files, concatenate `lib.php` above `main.php` (drop the second `<?php` and
the `require_once`). Namespace is `PhAgentEndpoint`; apply the snippet-id
suffix convention used by the other snippets when it is created.

## Still to do at deploy (not in this repo yet)

The live Industries (10063), Blog (10116) and Support Centre (10156) snippets
are not versioned here until the "Version the live site snippets" ticket
lands. Before publishing, in those snippets:

1. Blog and Support Centre: replace their own `#org` Organization with
   `{"@id": "https://personalisationhub.com/#organization"}`, and emit
   `\PhAgentEndpoint\organization_node()` / `software_node()` once per page
   (or inline identical copies), so entities match across pages.
2. Industries `llms.php`: link `## Platform` pages with `?format=md`. This
   snippet already rewrites those links and adds a missing `## Platform`,
   `## Company` and `## For AI agents`, deduplicating by section heading.
3. Compare the three snippets' twin routes with `main.php` so a URL is
   served by one of them only (this one answers only its own allow-list).
