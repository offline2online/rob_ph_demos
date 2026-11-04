# Media Studio

Makes images and video for the website, blog posts, social and in-store
screens through one API, using:

| Model | What it makes | Key |
|---|---|---|
| **Nano Banana Pro** (`gemini-3-pro-image-preview`) | Images up to 4K in 10 aspect ratios. Takes up to 14 reference images (product shots, logos, a style to match) and can edit an existing picture. | Gemini |
| **Veo 3.1** / **Veo 3.1 Fast** (`veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`) | 4, 6 or 8 second clips at 720p, 1080p or 4K, 16:9 or 9:16, with sound. Can animate a still or run between a first and last frame. | Gemini (the same key) |
| **LTX 2.5 Pro** / **LTX 2.5 Fast** (`ltx-2-5-pro`, `ltx-2-5-fast`) | Text-to-video and image-to-video. Pro goes up to 1080p. Fast goes up to 4K and 20 seconds. You can set the camera motion and turn audio off. | LTX |

You can use it in three ways. All three share `src/studio.js`.

1. **Web page**: `npm start`, then open <http://127.0.0.1:8787>. Create
   Image, Create Video and a Library of everything you've made. From the
   Library you can download a file, copy its link, use an image as a
   reference, animate it with Veo or LTX, or send it to WordPress.
2. **Command line**: `npm run image -- "…"` and `npm run video -- "…"`.
   Claude sessions use this one.
3. **GitHub Actions**: `.github/workflows/media-studio.yml` runs on a
   runner with the repository's secrets, so you don't need the keys on
   your own machine.

It needs nothing beyond Node 20 or later: no `npm install` and no build step.

## Set up

### Keys: store them in the PH Agent Console (recommended)

An admin opens the console at <https://backlog-tracker-e4ed2.web.app>, goes to
**Settings → Integrations & MCP → Media Studio API keys** and pastes:

- the **Google Gemini** key (aistudio.google.com/apikey). This one key covers
  Nano Banana Pro and Veo 3.1.
- the **LTX** key (console.ltx.io → API keys).
- optionally, the **WordPress** site URL and `username:application password`.

Each key is encrypted (AES-256-GCM) before it is stored. After that the
console shows only its last four characters, who saved it and when, so
nobody, admins included, can read a key back there. Saving runs a free check
with the provider, and **Test** runs it again later.

Media Studio fetches the keys when it starts, using `BOARD_API_KEY`, the
board automation key. That key is already a repository secret, so **the
GitHub workflow needs no other setup**. To use the keys on your own machine
or in a Claude session, set `BOARD_API_KEY` there. In a cloud session, also
allow `backlog-tracker-e4ed2.web.app` in the network settings. How it works:
`backlog-tracker/functions/media-keys.js` and the console README →
"Media Studio provider keys".

### Or: keys in `.env`

```bash
cd media-studio
cp .env.example .env      # gitignored. Never commit keys: this repo is public
#   GEMINI_API_KEY=...    (covers Nano Banana Pro + Veo)
#   LTX_API_KEY=...
```

A key set in the environment or in `.env` always wins over the console's.
`MEDIA_STUDIO_CONSOLE=off` skips the console altogether.

```bash
npm run check             # shows where each key came from, then checks the Gemini key against the model list
```

Generated files go in `media-studio/output/<yyyy-mm>/`, which is gitignored.
Each file has a `.json` sidecar beside it recording the prompt, model and
settings, so any asset on the site can be traced back and made again.

**Cloud Claude sessions:** the default network policy blocks the provider
hosts, so set Network access to **Custom** and allow
`generativelanguage.googleapis.com`, `api.ltx.io`, your WordPress host if
you use the upload, and `backlog-tracker-e4ed2.web.app` if the keys come
from the console.

## Command line

```bash
# Blog hero image, 16:9 at 2K, with a style
npm run image -- "A shopper scanning a QR code on a digital menu board in a bright café" --preset blog-hero --style photo

# Three square variations, matched to a product photo and a logo
npm run image -- "Our oat latte on a marble counter, morning light" --preset social-square --count 3 --ref ./latte.jpg --ref ./logo.png

# Text to video with Veo 3.1 (default model), 8 s at 1080p
npm run video -- "Slow push-in on a store window as the screen changes from breakfast to lunch offers" --preset blog-hero

# Animate an image you already made (pass its library id), vertical, with LTX 2.5
npm run list                                   # find the id
npm run video -- "The steam rises and the camera drifts left" --provider ltx --image 6f1ae44f --preset story --camera dolly_left

# Make it and upload it to WordPress in one go (alt text included)
npm run image -- "…" --preset blog-hero --wordpress --alt "Shopper using a digital menu board"
```

Run `node src/cli.js --help` to see every option.

**Formats** (`--preset`): `blog-hero` 16:9 2K · `website-banner` 21:9 ·
`og-image` 16:9 1K · `inline` 3:2 · `social-square` 1:1 · `social-portrait`
4:5 · `story` 9:16 · `signage-landscape` / `signage-portrait` 4K.
**Styles** (`--style`): `photo`, `ph-brand` (teal and violet accents, room
left for a headline), `illustration`, `cinematic`. Both lists are in
`src/presets.js` and you can edit them. Any setting you pass explicitly
overrides the preset.

## HTTP API

`npm start` serves the API on `127.0.0.1:8787` (change it with `PORT` and
`HOST`). Image and video requests both run as jobs. Images take about
10–40 s and video takes 1–5 minutes.

| | |
|---|---|
| `POST /v1/images` | `{prompt, preset?, style?, aspectRatio?, imageSize?, count?, references?: [dataUrl \| https url \| libraryId], groundWithSearch?, model?, publish?: "wordpress", altText?, caption?}` → `202 {job}`. Add `?wait=1` to get `200 {job}` when it is done. |
| `POST /v1/videos` | `{prompt, provider?: veo \| veo-fast \| ltx \| ltx-fast, preset?, style?, aspectRatio?, resolution?, durationSeconds?, image?, lastFrame?, references? (Veo, ≤3), negativePrompt? (Veo), cameraMotion?, generateAudio? (LTX), seed?, model?, publish?}` → `202 {job}` |
| `GET /v1/jobs/:id` | `{job: {status: running \| succeeded \| failed, progress[], result, error}}` |
| `GET /v1/library?kind=&limit=` · `GET /v1/library/:id` | What has been made, newest first |
| `POST /v1/library/:id/publish` | Upload to WordPress: `{altText?, caption?, title?}` |
| `GET /v1/health` · `GET /v1/presets` | Which providers are configured, and the formats and styles |
| `GET /media/<path>` | The files themselves |

```bash
curl -s localhost:8787/v1/images?wait=1 -H 'content-type: application/json' \
  -d '{"prompt":"Retail staff using a tablet beside a digital screen","preset":"blog-hero"}' | jq .job.result.files
```

**Security:** the server listens on localhost only. It refuses to start on
any other address unless `MEDIA_STUDIO_TOKEN` is set, and then every `/v1`
call needs `Authorization: Bearer <token>`. Open the page as
`/?token=<token>` once and it remembers the token for that tab. The files
under `/media` are not protected, because they are made to be published.

## WordPress

Set `WP_SITE_URL` (for example `https://personalisationhub.com`) and
`WP_AUTH` = `<username>:<application-password>` (or its base64). You create
the application password in WordPress under the user's profile →
Application Passwords. The asset goes into that site's media library with
alt text, which defaults to the prompt, and the WordPress URL is recorded
on the library item. This uses the same kind of credential as
`ELEMENTOR_MCP_AUTH` for offline2online.com.

## GitHub Actions

On GitHub, go to Actions → **Media Studio (generate an image or video)** →
Run workflow. Or run:

```bash
gh workflow run media-studio.yml -f kind=image -f prompt="…" -f preset=blog-hero -f style=photo
gh workflow run media-studio.yml -f kind=video -f provider=ltx -f prompt="…" -f image_url=https://…/still.png
```

The files are attached to the run as the artifact `media-<run id>` and kept
for 30 days. The run summary lists them. Tick `wordpress` to upload them as
well. The run fetches the keys from the console with the `BOARD_API_KEY`
repository secret. Repository secrets named `GEMINI_API_KEY`,
`LTX_API_KEY` or `WP_AUTH` (and the variable `WP_SITE_URL`) still work
and win over the console. Every input reaches the script as an
environment variable, never as part of the shell command, so a prompt
can't run code.

## Files

| Path | What it does |
|---|---|
| `src/providers/nano-banana.js` | Gemini `generateContent` with `imageConfig` (aspect ratio and size) and reference images. Skips the model's interim "thought" images. |
| `src/providers/veo.js` | `predictLongRunning` → polls the operation → downloads the MP4 with the key. If the API rejects the first image encoding it tries the other, so a schema change on Google's side doesn't break image-to-video. |
| `src/providers/ltx.js` | LTX `/v2/text-to-video` and `/v2/image-to-video`: create the job, poll it, download the result. Maps `1080p` + aspect ratio to the `1920x1080` form LTX expects. |
| `src/presets.js` | Formats and styles |
| `src/studio.js` | Shared pipeline: preset → input images → provider → library → WordPress |
| `src/library.js` | Saves files and their sidecars in `output/` and lists them |
| `src/wordpress.js` | Uploads to `wp/v2/media` and sets the alt text |
| `src/console-keys.js` | Fetches the encrypted-at-rest keys from the PH Agent Console with `BOARD_API_KEY`. A key already in the environment wins. |
| `src/server.js` | The HTTP API and the web page |
| `src/cli.js` | The command line |
| `public/` | The web page: the Personalisation Hub design system, content frame only, so it can be iframed into HQ Admin |
| `test/` | `npm test`: every provider contract, the API and the security checks against scripted responses. No keys or network needed. CI runs it as `.github/workflows/media-studio-tests.yml` (a train test suite, registered in `TRAIN_TEST_WORKFLOWS`). |

## Limits

- The request shapes come from the providers' documentation and from the
  LTX contract the menu-board prototype already uses
  (`menu-board-demo/functions/index.js`). The tests check them against
  scripted responses. **The first real call with your keys is the live
  check.** If a provider has changed a field, the error message names it.
- Veo keeps its file on Google's side for about 2 days and LTX keeps its
  result URL only briefly. Media Studio downloads both as soon as they are
  ready, so the copy in `output/` (or on WordPress) is the permanent one.
- Every call is billed to your key. Veo and LTX charge per second of video,
  and LTX checks your balance against the longest possible clip before it
  starts.
