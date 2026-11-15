# Run Your Own RMN walkthrough (golf network): screenshot sources

The Run Your Own RMN tour is told from a network operator's view (v2, 15 Nov 2026; v3 the same day: clubs have 1 to 12 screens each, and slot 1 is sold by display type and the audience in front of it, on every matching screen): the Fairlinks Golf Network, a golf retail
media network of 100 connected golf clubs, sells its brand partner slots to Corvane Golf on six screen types (Pro Shop, Driving
Range, First Tee, Halfway House, Locker Room, Clubhouse Bar), set once for the network. Flow 3 goes into Fernhollow Golf Club,
one club on the network. Every HQ Admin screenshot in `../../tour-assets/rmn-golf/v3/img/` is a real screen of the DSP
Integration prototype (`dsp-integration/prototype/`) seeded with the network, except `N0-stores` (Stores / Branches, which the
prototype doesn't have: `stores.html`, built to the ph-designer list-page recipe). Names are fictional throughout. v1
(`../../tour-assets/rmn-golf/img|vo`, the single club of 14 Nov) and v2 (`../../tour-assets/rmn-golf/v2/`, 27 screens at every club) are immutable; nothing loads them any more.

| File | What it does |
| --- | --- |
| `slots_golf.py` | Holds the network seed (`network()`: 100 clubs from shapes of 1 to 12 screens, Fernhollow first with 7 on all six types, the rest in a fixed shuffled order; written to `network.json`) and derives the demo data from the prototype's own snapshot (`dsp-integration/prototype/demo/api-snapshot.json`): each slot's display count is the screens of that type across the network, and each display type has its own viewers per play (`vacdPerPlay`) and an audience description, so every view, play and revenue figure is the network's. One advertiser, Corvane Golf (direct), and no DSP: Run Your Own RMN sells direct deals only, so the seed drops every DSP-synced advertiser and campaign, empties the partner list and gives Corvane's campaigns a non-DSP source (every other seeded brand is dropped or renamed), six display types with three slots each (slot 1 "Brand partner", owner Advertiser), and the deal "Corvane direct" (Direct advertiser, 1–31 Dec 2026, fixed CPM USD 150). Writes `golf-{pre,predeal,draft,assigned,live,dec}.json`, prints the booking totals the tour copy quotes and writes `figures.json`. |
| `network.json` | The seed: every club's code, name, screens per display type and total (written by `slots_golf.py`; read by `stores.html` and the tests). |
| `figures.json` | The network's figures (per display type: clubs that have it, screens, plays per window, viewers per play, booked windows, views, revenue; the screen total, club sizes, the deal's reach, Fernhollow). `sync_tour_figures.py` copies it into `tour.html` (`const GNET`); `tests/tour.test.mjs` recomputes it from `network.json`. |
| `sync_tour_figures.py` | Writes `const GNET = …;` in `tour.html` from `figures.json` (`--check` reports drift). Every golf figure the tour shows is read from `GNET`. |
| `stores.html` | Capture-only Stores / Branches list: the first 25 of the network's 100 fictional golf clubs from `network.json` (Fernhollow first); Displays is each club's screens, Total connected displays their sum (343). |
| `shell.html` | Capture-only stand-in for the HQ Admin chrome (sidebar with the network's logo, top bar, breadcrumb; `nav=platform|company|stores`) around the prototype, matched to the retail media v1 screenshots. |
| `cap_golf.js` | Serves the prototype, the mockups, the shell, `stores.html` and `network.json` on `localhost:8790`, answers the prototype's API from the snapshot, drives each screen and writes `<id>.jpg` (1600×950, quality 85) and `hot.json` (boxes clipped to the screen). No DSP wording on screen: the "Assigned to" step types *Corvane* into the menu's own search, so only the deal is listed (the menu's "DSPs (open auction)" group can't be removed from the seed), and `noDsp()` leaves out the deal dialog's help sentences that name a DSP or programmatic buying; no field is added or removed. |
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
| `pack_assets.py` | Writes `tour-assets/rmn-golf/v3/<img|vo>/<file>.b64` and `SHA256SUMS` (of the decoded files) from a folder of JPGs and MP3s; `--verify` checks a checkout (`--out` for another set). |
| `allowlist.py` | Writes `TOUR_ASSETS_RMN_V3` in `tour.php` from `v3/SHA256SUMS` (`--version v2` / `v1` for the older sets; `--check` reports drift). |
| `sync_tour_vo.py` | Copies the manifest into `tour.html` (`const CLIPS_GOLF = …;`). |

```bash
# voiceover (Kokoro af_heart, offline; see ../retail-media-tour/README.md for the model files; the model release downloads from GitHub)
cp vo-manifest.json <work>/vo/manifest.json   # reuse unchanged clips
python3 ../retail-media-tour/build_voiceover.py --script voiceover-script.json --out <work>/vo --models <kokoro dir>
# <work>/img holds the JPGs from cap_golf.js plus login-bg.jpg (decode it from ../../tour-assets/rmn-golf/v3/img/login-bg.jpg.b64);
# copy only the clips the new manifest names into <work>/vo
python3 pack_assets.py --src <work> && python3 pack_assets.py --verify
python3 allowlist.py && python3 sync_tour_vo.py --manifest <work>/vo/manifest.json && python3 sync_tour_figures.py
# HOT_GOLF in tour.html is a copy of hot.json: update it when cap_golf.js changed hot.json
node ../build-tour.mjs   # then TOUR_PAGE_SHA256 in tour.php = sha256 of tour/tour.html
```

The tour reads `HOT_GOLF` (this folder's `hot.json`) and `CLIPS_GOLF` inline. Changed assets on the live site need a new route and cache folder (v4 next), because each set is served as immutable.
