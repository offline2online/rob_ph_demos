# Run Your Own RMN: LinkedIn launch animation

A 31.5 second animation launching Run Your Own Retail Media Network on LinkedIn.
It's for people going solo: anyone recently made redundant, high-agency people and daily AI users.
Its one job is to get them to click through to
personalisationhub.com/run-your-own-rmn/, and its only call to action is
**"Link in comments"**.

- **Video**: `dist/run-your-own-rmn-launch.mp4` (1080×1350, 4:5 for the LinkedIn feed, H.264, 30 fps, silent audio track, 2.5 MB)
- **Thumbnail**: `dist/run-your-own-rmn-launch-cover.png` (the "Run your own retail media network." frame)
- **Post copy**: `LINKEDIN-POST.md` (the refined post and the first comment that carries the link)
- **Live preview**: `dist/run-your-own-rmn-launch.html` (self-contained; open it in a browser to play, pause and scrub)

## Storyboard

| # | Time | Accent | Eyebrow | Headline | Visual |
|---|---|---|---|---|---|
| 1 | 0.0 | teal | Your next chapter | Going out on your own? | Retail media, Ad sales, Creative, Personalisation |
| 2 | 3.0 | pink | Why now | The store matters more than ever. | Online → In store |
| 3 | 6.2 | orange | The rise of the solopreneur | You no longer need a team. | Four jobs ticked off |
| 4 | 9.6 | teal | Now launching | Run your own retail media network. | "Your brand" hub and six venues |
| 5 | 13.2 | green | Any business with a physical presence | In an industry you love. | Ten venue types from the page |
| 6 | 16.8 | pink | Retail media income | Earn from every screen. | A golf club screen: venue promo, then a brand ad |
| 7 | 20.4 | teal | AI does the heavy lifting | Campaigns that run themselves. | The brand infinity loop: Launch, Learn |
| 8 | 23.6 | green | How it works | Without the upfront cost. | Get set up, free runway, grow on outcomes |
| 9 | 27.2 to 31.5 | orange | Go solo · Team up · Run your own stores | Start your next chapter. | **Link in comments ↓** |

The copy comes from the live page (`ph-website/elementor/run-your-own-rmn.md` and
`ph-website/snippets/ph-industry-enhancements/operator-content.php`) and the launch post.
It follows the page's own rules: no fee amounts, revenue splits or runway length, and no MCP
claims (not live).

## Brand

Built to the `ph-brand` skill (PH Brand concept):
- the dark surface for LinkedIn
- Kantumruy Pro
- one accent per scene, carried by the top bar and the footer dot
- the official white logo file, top left
- the four colours together only in the logo and the infinity loop (the brand templates' own path, flowing once every 14 s)
- Material Symbols Rounded icons tinted to the accent
- sentence-case headlines of 6 words or fewer
- no long dashes, and British spelling

## Change it and render again

```bash
cd promote/linkedin/run-your-own-rmn-launch
npm install          # Kantumruy Pro and Material Symbols, inlined at build time
# edit src/index.html (copy, timings in SCENES), then:
npm run build        # → dist/run-your-own-rmn-launch.html (fails on a long dash in the copy)
npm run check        # line counts, safe area (content above y 1190), overflow, overlaps per scene
npm run render       # → dist/*.mp4 and the cover PNG (needs Playwright's Chromium and ffmpeg)
```

`renderAt(t)` in the page is deterministic, so the render captures every frame
exactly. Nothing here is served by GitHub Pages as part of the site. It's a marketing asset kept
with its source.
