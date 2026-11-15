# Run Your Own RMN walkthrough (golf network): screenshot sources

The Run Your Own RMN tour is told from a network operator's view (v2, 15 Nov 2026): the Fairlinks Golf Network, a golf retail
media network of 100 connected golf clubs, sells its brand partner slots to Corvane Golf on six screen types (Pro Shop, Driving
Range, First Tee, Halfway House, Locker Room, Clubhouse Bar), set once for the network. Flow 3 goes into Fernhollow Golf Club,
one club on the network. Every HQ Admin screenshot in `../../tour-assets/rmn-golf/v2/img/` is a real screen of the DSP
Integration prototype (`dsp-integration/prototype/`) seeded with the network, except `N0-stores` (Stores / Branches, which the
prototype doesn't have: `stores.html`, built to the ph-designer list-page recipe). Names are fictional throughout. v1
(`../../tour-assets/rmn-golf/img|vo`, the single club of 14 Nov) is immutable; nothing loads it any more.

| File | What it does |
| --- | --- |
| `slots_golf.py` | Derives the demo data from the prototype's own snapshot (`dsp-integration/prototype/demo/api-snapshot.json`) for the network: each slot's display count is the club's screens of that type × `CLUBS` (100), so every view, play and revenue figure is the network's. Three fictional advertisers (Corvane Golf direct, Thunder Energy via The Trade Desk, Northwind Foods via Google DSP; every other seeded brand is dropped or renamed), six display types with three slots each (slot 1 "Brand partner", owner Advertiser), and the deal "Corvane direct" (Direct advertiser, 1–31 Dec 2026, fixed CPM USD 150). Writes `golf-{pre,predeal,draft,assigned,live,dec}.json`, prints the booking totals the tour copy quotes and writes `figures.json`. |
| `figures.json` | The network's revenue inputs and results (per screen type: screens per club and in total, plays per window, viewers per play, booked windows, views, revenue). `tests/tour.test.mjs` recomputes every figure the tour quotes from it. |
| `stores.html` | Capture-only Stores / Branches list: 100 fictional golf clubs of the Fairlinks Golf Network (Fernhollow first), 27 screens each, 2,700 connected displays. |
| `shell.html` | Capture-only stand-in for the HQ Admin chrome (sidebar with the network's logo, top bar, breadcrumb; `nav=platform|company|stores`) around the prototype, matched to the retail media v1 screenshots. |
| `cap_golf.js` | Serves the prototype, the mockups, the shell and `stores.html` on `localhost:8790`, answers the prototype's API from the snapshot, drives each screen and writes `<id>.jpg` (1600×950, quality 85) and `hot.json` (boxes clipped to the screen). |
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
| `pack_assets.py` | Writes `tour-assets/rmn-golf/v2/<img|vo>/<file>.b64` and `SHA256SUMS` (of the decoded files) from a folder of JPGs and MP3s; `--verify` checks a checkout (`--out` for another set). |
| `allowlist.py` | Writes `TOUR_ASSETS_RMN_V2` in `tour.php` from `v2/SHA256SUMS` (`--version v1` for the old `TOUR_ASSETS_RMN`; `--check` reports drift). |
| `sync_tour_vo.py` | Copies the manifest into `tour.html` (`const CLIPS_GOLF = …;`). |

```bash
# voiceover (Kokoro af_heart, offline; see ../retail-media-tour/README.md for the model files; the model release downloads from GitHub)
cp vo-manifest.json <work>/vo/manifest.json   # reuse unchanged clips
python3 ../retail-media-tour/build_voiceover.py --script voiceover-script.json --out <work>/vo --models <kokoro dir>
# <work>/img holds the JPGs from cap_golf.js plus login-bg.jpg (decode it from ../../tour-assets/rmn-golf/v2/img/login-bg.jpg.b64);
# copy only the clips the new manifest names into <work>/vo
python3 pack_assets.py --src <work> && python3 pack_assets.py --verify
python3 allowlist.py && python3 sync_tour_vo.py --manifest <work>/vo/manifest.json
node ../build-tour.mjs   # then TOUR_PAGE_SHA256 in tour.php = sha256 of tour/tour.html
```

The tour reads `HOT_GOLF` (this folder's `hot.json`) and `CLIPS_GOLF` inline. Changed assets on the live site need a new route and cache folder (v3 next), because each set is served as immutable.
