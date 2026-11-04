# ph-website

Every line of code running on personalisationhub.com, versioned here. Five Angie code snippets, copied byte for byte from WordPress on 4 Nov 2026 (the live files have `__ID__` already replaced by the snippet id). Do not reformat them. PH Blog Layout (10644) was written here first and published the same day, as a hotfix.

## Snippets

| Snippet | Id | Version | Folder | Owns |
| --- | --- | --- | --- | --- |
| PH Industry Enhancements | 10063 | 1.6.1 | `snippets/ph-industry-enhancements/` | /industries/ hub (9502) and 9 industry pages; their JSON-LD (Organization `#organization`, SoftwareApplication `#software`, WebPage, Service, BreadcrumbList, FAQPage) and markdown twins; **/llms.txt itself** (`llms.php`: intro, `## Industries`, `## Platform`) and the `ph_llms_txt` filter; header/footer CSS (the header burger and submenu chevron are SVG masks, and ElementsKit's `ekiticons.css` icon font is dequeued site-wide); home-page hero background preload (`fetchpriority="high"`); blog CTA Calendly |
| PH Blog | 10116 | 1.0.8 | `snippets/ph-blog/` | /blog/ (10147) and single posts: kick line, byline, right-hand article menu (section filter, count; newest first, only the current article bold), series bar, Read next, progress bar; Blog/BlogPosting/BreadcrumbList JSON-LD with shared Organization `#organization` and SoftwareApplication `#software`; twins; `## Blog` in llms.txt |
| PH Blog Layout | 10644 | 1.0.0 | `snippets/ph-blog-layout/` | single posts always render through the Theme Builder template "PH Blog · Single post" (10142): on the public front end a post is never treated as built with Elementor, so the kit's default Full Width layout (which prints only the post content, no title, byline, hero or article menu) can't take over. Published 4 Nov 2026 as a hotfix after all 25 posts were re-saved through Elementor on 3 Nov and every article lost its layout. wp-admin, the Elementor editor/preview, AJAX and REST see the real `_elementor_edit_mode`. Can be folded into PH Blog at its next release |
| PH Support Centre | 10156 | 1.4.0 | `snippets/ph-support-centre/` | everything under /support-centre/; shared Organization `#organization` and SoftwareApplication `#software`, WebSite `/support-centre/#site`; twins; `## Support Centre` in llms.txt; (its WebMCP tools moved to the PH Agent Endpoint snippet in 1.3.1); public `ph-help/v1/index`, `/redirects`, `/published`; 1.4.0: syncs from the live console feed first (GitHub raw, then help site, as fallbacks), public rate-limited `POST ph-help/v1/refresh` (202 or 429, schedules one sync in 5 s, never inline), no Google Fonts request |
| PH Site Icon | 10157 | 1.0.1 | `snippets/ph-site-icon/` | /favicon.ico from the Site Icon |
| PH Media | not published yet | 1.0.0 | `snippets/ph-media/` | new JPEG/PNG uploads get WebP sizes (quality 80, GIF/SVG untouched, only while sub-sizes are generated so the favicon stays PNG); fixes Elementor `elementor/thumbs` srcset URLs; admin `POST ph-site/v1/media/webp-status` (read-only) |

`snippets/MANIFEST.json` lists every file with its byte count and sha256, so a deploy can check what is live against the repo.

## How a deploy works

After Deploy to Main, the PH Website session (the one with the Elementor MCP) publishes the changed snippets from `main` through the Elementor MCP (`angie-*` snippet tools):

1. Snapshot the live snippet files before.
2. Publish the changed files.
3. Snapshot after and compare with `MANIFEST.json`.
4. Roll back by republishing the previous version.

Spec: project document "Agent endpoint release: design and build guide" (PH Website project), sections 1 and 2.

## Leak tests

`php ph-website/tests/leak.php` seeds a draft, scheduled, private, password-protected and noindex page, demo pages outside the allow-list, an out-of-range help article and internal fields (`ph_help_*`, hash, programme, project), then checks llms.txt, markdown twins, JSON-LD, the `ph-agent/v1` tools list and every tool call, the WebMCP loader and the Support Centre's public routes. `node backlog-tracker/test/help-leak.test.js` does the same for `/help-api/search`, `/help-api/article` and the remote MCP server (stubbed fetch). Both run without network inside the console's `npm run test:offline` (via `test:mcp`), so every train runs them and a leak blocks the deploy; a failure names the endpoint.

## Security gate and the production check

`SECURITY-GATE.md` is the go-live record for the agent endpoint release: the pen test checklist and results for every public endpoint, the findings (PT-01 to PT-08) and the fix for each, the leak, rate-limit, alert and RevOps results, and the post-deploy steps. `node ph-website/tests/e2e-live.mjs` is the check the PH Website session runs against production after the WordPress deploy (every page type, every tool, the twins, JSON-LD, llms.txt, the CTA links, 429 behaviour, headers and console errors; prints a pass/fail table; `--dry-run` lists the checks without network, `--stress` also exercises the WordPress route's 429). The dry run is part of `test:mcp`.

`snippets/MANIFEST.json` describes what is live. The security fixes change `ph-agent-endpoint/` (1.3.0) and `ph-blog/main.php`; regenerate the manifest entries for those files after the deploy snapshot, not before.
