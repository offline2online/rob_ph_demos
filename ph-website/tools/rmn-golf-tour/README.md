# Run Your Own RMN walkthrough (golf club): screenshot sources

The Run Your Own RMN tour is set in a golf club: Fernhollow Golf Club sells its brand partner slots to Corvane Golf on six
screen types (Pro Shop, Driving Range, First Tee, Halfway House, Locker Room, Clubhouse Bar). Every HQ Admin screenshot in
`../../tour-assets/rmn-golf/img/` is a real screen of the DSP Integration prototype (`dsp-integration/prototype/`), seeded
with golf data. Names are fictional throughout.

| File | What it does |
| --- | --- |
| `slots_golf.py` | Derives the demo data from the prototype's own snapshot (`dsp-integration/prototype/demo/api-snapshot.json`): three fictional advertisers (Corvane Golf direct, Thunder Energy via The Trade Desk, Northwind Foods via Google DSP; every other seeded brand is dropped or renamed), six display types with three slots each (slot 1 "Brand partner", owner Advertiser), and the deal "Corvane direct" (Direct advertiser, 1–31 Dec 2026, fixed CPM USD 150). Writes `golf-{pre,predeal,draft,assigned,live,dec}.json` and prints the booking totals the tour copy quotes. |
| `shell.html` | Capture-only stand-in for the HQ Admin chrome (sidebar with the club's logo, top bar, breadcrumb) around the prototype, matched to the retail media v1 screenshots. |
| `cap_golf.js` | Serves the prototype, the mockups and the shell on `localhost:8790`, answers the prototype's API from the snapshot, drives each screen and writes `<id>.jpg` (1600×950, quality 85) and `hot.json`. |
| `hot.json` | Each screenshot's click target and the regions the tips point at (`id` and `id#name`), in screenshot pixels, clipped to the screen. |

## Re-capturing

```bash
python3 slots_golf.py ../../../dsp-integration/prototype/demo/api-snapshot.json <work>/snap
# fonts: save the Google Fonts CSS for Roboto + Material Symbols Outlined (the prototype's own <link>) as <work>/fonts/fonts.css,
# download each woff2 next to it and point the CSS urls at /fonts/<file> (the capture never calls Google)
node cap_golf.js --snap <work>/snap --fonts <work>/fonts --out <work>/img --hot hot.json [id prefixes...]
```

`login-bg.jpg` is the retail media v1 login background, unchanged. Then look at every image: no blank screens, no
alerts, no real brand names, all six screen types visible where a step is about all six.

## Voiceover, packing and wiring

| File | What it does |
| --- | --- |
| `voiceover-script.json` | The narration, one or more lines per step, each under 10 seconds; a line with `cue` starts when the tip with that title appears (same rules as `../retail-media-tour/voiceover-script.json`). |
| `vo-manifest.json` | The last build's manifest (`{step: [{file, hash, text, duration, cue}]}`), so a rebuild regenerates only changed lines. |
| `pack_assets.py` | Writes `tour-assets/rmn-golf/<img|vo>/<file>.b64` and `SHA256SUMS` (of the decoded files) from a folder of JPGs and MP3s; `--verify` checks a checkout. |
| `allowlist.py` | Writes `TOUR_ASSETS_RMN` in `tour.php` from `SHA256SUMS` (`--check` reports drift). |
| `sync_tour_vo.py` | Copies the manifest into `tour.html` (`const CLIPS_GOLF = …;`). |

```bash
# voiceover (Kokoro af_heart, offline; see ../retail-media-tour/README.md for the model files)
cp vo-manifest.json <work>/vo/manifest.json   # reuse unchanged clips
python3 ../retail-media-tour/build_voiceover.py --script voiceover-script.json --out <work>/vo --models <kokoro dir>
# <work>/img holds the JPGs from cap_golf.js plus login-bg.jpg
python3 pack_assets.py --src <work> && python3 pack_assets.py --verify
python3 allowlist.py && python3 sync_tour_vo.py --manifest <work>/vo/manifest.json
node ../build-tour.mjs   # then TOUR_PAGE_SHA256 in tour.php = sha256 of tour/tour.html
```

The tour reads `HOT_GOLF` (this folder's `hot.json`) and `CLIPS_GOLF` inline. Changed assets on the live site need a new route and cache folder (v2), because v1 is served as immutable.
