# ph-website

Every line of code running on personalisationhub.com, versioned here. Four Angie code snippets, copied byte for byte from WordPress on 4 Nov 2026 (the live files have `__ID__` already replaced by the snippet id). Do not reformat them.

## Snippets

| Snippet | Id | Version | Folder | Owns |
| --- | --- | --- | --- | --- |
| PH Industry Enhancements | 10063 | 1.6.0 | `snippets/ph-industry-enhancements/` | /industries/ hub (9502) and 9 industry pages; their JSON-LD (Organization `#organization`, SoftwareApplication `#software`, WebPage, Service, BreadcrumbList, FAQPage) and markdown twins; **/llms.txt itself** (`llms.php`: intro, `## Industries`, `## Platform`) and the `ph_llms_txt` filter; header/footer CSS; blog CTA Calendly |
| PH Blog | 10116 | 1.0.6 | `snippets/ph-blog/` | /blog/ (10147) and single posts: kick line, byline, right-hand article menu (section filter, sort dropdown, count), series bar, Read next, progress bar; Blog/BlogPosting/BreadcrumbList JSON-LD with Organization `#org`; twins; `## Blog` in llms.txt |
| PH Support Centre | 10156 | 1.3.1 | `snippets/ph-support-centre/` | everything under /support-centre/; Organization `#org`, WebSite `/support-centre/#site`; twins; `## Support Centre` in llms.txt; (its WebMCP tools moved to the PH Agent Endpoint snippet in 1.3.1); public `ph-help/v1/index`, `/redirects`, `/published` |
| PH Site Icon | 10157 | 1.0.1 | `snippets/ph-site-icon/` | /favicon.ico from the Site Icon |

`snippets/MANIFEST.json` lists every file with its byte count and sha256, so a deploy can check what is live against the repo.

## How a deploy works

After Deploy to Main, the PH Website session (the one with the Elementor MCP) publishes the changed snippets from `main` through the Elementor MCP (`angie-*` snippet tools):

1. Snapshot the live snippet files before.
2. Publish the changed files.
3. Snapshot after and compare with `MANIFEST.json`.
4. Roll back by republishing the previous version.

Spec: project document "Agent endpoint release: design and build guide" (PH Website project), sections 1 and 2.
