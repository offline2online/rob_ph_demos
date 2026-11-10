# Retail media walkthrough: sources and voiceover

The retail media walkthrough is part of the shared product tour (`snippets/ph-industry-enhancements/tour/tour.html`, industry `retail-media`, served at `/industries/retail-media/tour/`). Rob approved it on 10 Nov 2026.

## What is where

| Path | What it is |
| --- | --- |
| `snippets/ph-industry-enhancements/tour/tour.html` | The shared tour. The retail media parts are guarded by `IS_RM` (path `/industries/retail-media/tour/`, `?ind=retail-media` for previews, or `window.PH_TOUR_IND`). Telco, pharmacy and convenience behave exactly as before. |
| `tour-assets/retail-media/img/` | 33 JPGs: HQ Admin screenshots taken from the DSP Integration prototype (1600x950, shown at 0.8 on the 1280x760 stage), plus `login-bg.jpg` for the platform login screen. |
| `tour-assets/retail-media/vo/` | 77 voiceover MP3s (`<step>-<line>-<hash>.mp3`, mono 24 kHz 48 kbps) and `manifest.json` (`{step: [{file, hash, text, duration, cue}]}`). |
| `tour-assets/retail-media/SHA256SUMS` | sha256 of every asset. The live site serves only these, pinned by sha. |
| `tools/retail-media-tour/voiceover-script.json` | The narration: one or more lines per step, each under 10 seconds. A line with `cue` starts when the on-screen tip with that title appears. |
| `tools/retail-media-tour/build_voiceover.py` | Builds the MP3s with Kokoro-82M (Apache-2.0) offline through `kokoro-onnx`, voice `af_heart`. Only changed lines are regenerated. |
| `tools/retail-media-tour/sync_tour_vo.py` | Copies `vo/manifest.json` into `tour.html` (`const CLIPS = …`). |
| `tools/retail-media-tour/votest.js` | Voiceover tests (Playwright): off by default, one line at a time, lines in step with their tips, captions match the script, pause, prev/next, toggle, reload. Serves the repo's `tour.html` and the assets from `TOUR_ASSETS_DIR` (a checkout of the tag `tour-assets-retail-media-v1`, `ph-website/tour-assets/retail-media`); `node votest.js off|reload|nav|full 0|full 1|full 2` (`MOTION=normal` for real-speed timing, which the full runs need). `tests/tour.test.mjs` runs it when `TOUR_ASSETS_DIR` is set. |
| `rmtour.py`, `slots4.py`, `cap5.js`, `hot.json` | Provenance only: the generator that added the retail media flows to main's `tour.html` (sha `ac0296f4…`), the prototype demo data, the screenshot capture script and the click and highlight boxes (in screenshot pixels). Future changes are made in `tour.html` directly. |

## How the live site gets the assets

`tour.html` loads screenshots and audio from `/industries/retail-media/tour/assets/v1/{img,vo}/<file>` on the live path, and from the git tag `tour-assets-retail-media-v1` on raw.githubusercontent.com anywhere else (train previews). `tour.php` serves the same-origin route from a file cache, filled from the tag and checked against `SHA256SUMS`.

## Changing the voiceover

1. Edit `voiceover-script.json`.
2. `pip install kokoro-onnx soundfile`; download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0.
3. `python3 build_voiceover.py --out ../../tour-assets/retail-media/vo --models <model dir>` (fails if a line reaches 10 s).
4. `python3 sync_tour_vo.py`, regenerate `tour-page.php`, update `TOUR_PAGE_SHA256`.
5. New or changed MP3s need a new assets tag (v2) and the asset path and map updated to match, because v1 is cached as immutable.

## Rules

"personalisation" with an S; no internal project names in narration or on screen; fictional brands only (Larkspur Convenience, Frostline Cold Drinks); screens never blank. Like telco and pharmacy, the visitor's company (from the lead or the company field) and colour are used everywhere: the HTML screens, login, phone and shopper scene use `B()`/`C()`, and on the screenshots the HQ Admin logo and the header badge are redrawn over the image (`brandOv()`), since the screenshots were taken with the demo retailer's logo. An advertiser's own login sees only Campaigns and Insights / Analytics in the left-hand nav.
