# Run Your Own RMN: LinkedIn launch animation

A 13 second, five-slide animation launching Run Your Own Retail Media Network on LinkedIn.
It's for people going solo: anyone recently made redundant, high-agency people and daily AI users.
Its one job is to get them to click through to
personalisationhub.com/run-your-own-rmn/, and its only call to action is
**"Link in comments"**. Each slide carries one short sentence and nothing else (Rob, 15 Nov 2026:
punchy, one sentence per slide, five slides at most).

- **Video**: `dist/run-your-own-rmn-launch.mp4` (1080×1350, 4:5 for the LinkedIn feed, H.264, 30 fps, silent audio track)
- **Thumbnail**: `dist/run-your-own-rmn-launch-cover.png` (the "Run your own retail media network." slide)
- **Post copy**: `LINKEDIN-POST.md` (the refined post and the first comment that carries the link)
- **Live preview**: `dist/run-your-own-rmn-launch.html` (self-contained; open it in a browser to play, pause and scrub)

## Slides

| # | Starts | Accent | Sentence |
|---|---|---|---|
| 1 | 0.0 s | teal | Going out on your own? |
| 2 | 2.3 s | pink | AI is your team now. |
| 3 | 4.5 s | green | Run your own retail media network. |
| 4 | 7.2 s | teal | Without the upfront cost. |
| 5 | 9.4 s to 13.0 s | orange | Link in comments. (with an orange down-arrow button) |

Each sentence punches in word by word under a short accent rule, at one size (140px) and from
one fixed top on every slide. "Without the upfront cost." is the page's own sub-line. The video
carries no fee amounts, splits, runway length or MCP claims, which the page doesn't state either.

## Brand

Built to the `ph-brand` skill (PH Brand concept):
- the dark surface for LinkedIn
- Kantumruy Pro at 700, sentence case, 6 words or fewer per slide, no long dashes
- one accent per slide, carried by the top bar and the rule
- the official white logo file, top left
- the CTA in orange (the brand's call-to-action colour)

The usual footer URL is left off at Rob's request (one sentence per slide).

## Change it and render again

```bash
cd promote/linkedin/run-your-own-rmn-launch
npm install          # Kantumruy Pro and Material Symbols, inlined at build time
# edit a sentence in src/index.html (timings are in SCENES), then:
npm run build        # → dist/run-your-own-rmn-launch.html (fails on a long dash in the copy)
npm run check        # line counts (3 at most), safe area (content above y 1190), overflow, overlaps per slide
npm run render       # → dist/*.mp4 and the cover PNG (needs Playwright's Chromium and ffmpeg)
```

`renderAt(t)` in the page is deterministic, so the render captures every frame
exactly. Nothing here is served by GitHub Pages as part of the site. It's a marketing asset kept
with its source.
