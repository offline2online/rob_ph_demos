# Run Your Own RMN: LinkedIn launch animation

A 15.5 second, six-slide kinetic-type animation launching Run Your Own Retail Media Network on
LinkedIn. It's for people going solo: anyone recently made redundant, high-agency people and daily
AI users. Its one job is to get them to click through to personalisationhub.com/run-your-own-rmn/,
and its only call to action is **"Link in comments"**. Each slide carries one short sentence (Rob,
15 Nov 2026: short and punchy, more animated, different colours, switching light and dark).

- **Video**: `dist/run-your-own-rmn-launch.mp4` (1080×1350, 4:5 for the LinkedIn feed, H.264, 30 fps, silent audio track)
- **Thumbnail**: `dist/run-your-own-rmn-launch-cover.png` (the "Run your own in-store retail media network." slide)
- **Post copy**: `LINKEDIN-POST.md` (the refined post and the first comment that carries the link)
- **Live preview**: `dist/run-your-own-rmn-launch.html` (self-contained; open it in a browser to play, pause and scrub)

## Slides

| # | Starts | Surface | Accent | Sentence | Type animation | Arrives by |
|---|---|---|---|---|---|---|
| 1 | 0.0 s | dark | teal | Going out on your own? | words zoom in from large and blurred | |
| 2 | 2.3 s | light | pink | Bricks-and-mortar experiences matter more than ever. | letters pop and expand one by one | pink wipe up |
| 3 | 5.0 s | dark | orange | Run your own in-store retail media network. | lines rise from behind a mask | orange iris |
| 4 | 7.5 s | light | green | Earn from every screen. | words stretch out sideways | green wipe across |
| 5 | 9.6 s | dark | teal | Campaigns that optimise themselves. | tracking contracts from wide and blurred; the infinity loop draws itself | teal wipe down |
| 6 | 12.1 s to 15.5 s | light | orange | Start your next chapter. + **Link in comments ↓** | the line zooms in from small; the pill pops and pulses | orange iris |

Every slide keeps pushing in slowly while it's on screen, then zooms out towards the viewer as the
next wipe covers it. Each slide's type is sized to fit the width, so sizes vary from slide to slide.

## Brand

Built to the `ph-brand` skill (PH Brand concept):
- the brand's two surfaces, alternating dark and light, with the matching logo file (white on dark, full colour on light)
- Kantumruy Pro at 700, sentence case
- one accent per slide (the top bar, the rule and the wipe that brings the slide in)
- the four colours together only in the logo and the infinity loop
- the CTA in orange
- no long dashes, and British spelling

The usual footer URL is left off at Rob's request.

## Change it and render again

```bash
cd promote/linkedin/run-your-own-rmn-launch
npm install          # Kantumruy Pro and Material Symbols, inlined at build time
# edit a sentence in src/index.html (timings are in SCENES), then:
npm run build        # → dist/run-your-own-rmn-launch.html (fails on a long dash in the copy)
npm run check        # per slide: type fitted, inside the safe area, wipe gone, logo matches surface
npm run render       # → dist/*.mp4 and the cover PNG (needs Playwright's Chromium and ffmpeg)
```

`renderAt(t)` in the page is deterministic, so the render captures every frame
exactly. Nothing here is served by GitHub Pages as part of the site. It's a marketing asset kept
with its source.
