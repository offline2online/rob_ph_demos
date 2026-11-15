# Run Your Own RMN: LinkedIn launch animation

A 16 second, six-slide kinetic-type animation launching Run Your Own Retail Media Network on
LinkedIn. It's for people going solo: anyone recently made redundant, high-agency people and daily
AI users. Its one job is to get them to click through to personalisationhub.com/run-your-own-rmn/,
and its only call to action is **"Link in comments"**. Each slide carries one short sentence (Rob,
15 Nov 2026: short and punchy, more animated, different colours, switching light and dark; slide 3 says
build and own, not just run).

- **Video, feed**: `dist/run-your-own-rmn-launch.mp4` (1080×1350, 4:5 for the LinkedIn feed, H.264, 30 fps, silent audio track)
- **Video, stories**: `dist/run-your-own-rmn-launch-9x16.mp4` (1080×1920, 9:16, same slides and timing) with `dist/run-your-own-rmn-launch-9x16-cover.png`
- **Thumbnail**: `dist/run-your-own-rmn-launch-cover.png` (the "Why not build and own a retail media network?" slide)
- **Post copy**: `LINKEDIN-POST.md` (the refined post and the first comment that carries the link)
- **Live preview**: `dist/run-your-own-rmn-launch.html` (self-contained; open it in a browser to play, pause and scrub)

## Slides

| # | Starts | Surface | Accent | Sentence | Type animation | Arrives by |
|---|---|---|---|---|---|---|
| 1 | 0.0 s | dark | teal | Considering going out on your own? | words zoom in from large and blurred | |
| 2 | 2.6 s | light | pink | Bricks-and-mortar experiences matter more than ever. | letters pop and expand one by one | pink wipe up |
| 3 | 5.3 s | dark | orange | Why not build and own a retail media network? | lines rise from behind a mask | orange iris |
| 4 | 8.1 s | light | green | Earn from every screen. | words stretch out sideways | green wipe across |
| 5 | 10.2 s | dark | teal | Campaigns that optimise themselves. | tracking contracts from wide and blurred; the infinity loop draws itself | teal wipe down |
| 6 | 12.7 s to 16.1 s | light | orange | Start your next chapter. + **Link in comments ↓** | the line zooms in from small; the pill pops and pulses | orange iris |

Every slide keeps pushing in slowly while it's on screen, then zooms out towards the viewer as the
next wipe covers it. Each slide's type is sized to fit the width, so sizes vary from slide to slide.

## Formats

One source renders both. The page is 4:5 by default and 9:16 with `?ratio=9x16`:
- In 9:16 the logo moves down to y 270, so it sits below the stories progress bar and profile name.
- Each slide centres on y 940, keeping every line between y 360 and 1540, clear of the top UI and the reply bar.

Type sizes are the same in both formats, because the width sets them.
Stories have no comments, so "Link in comments" works where the 9:16 cut plays with comments: Reels, the LinkedIn mobile feed and similar.

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
npm run check:9x16   # the same checks on the 9:16 layout, with the stories safe area
npm run render       # → the 4:5 MP4 and cover PNG (needs Playwright's Chromium and ffmpeg)
npm run render:9x16  # → the 9:16 MP4 and cover PNG
```

`renderAt(t)` in the page is deterministic, so the render captures every frame
exactly. Nothing here is served by GitHub Pages as part of the site. It's a marketing asset kept
with its source.
