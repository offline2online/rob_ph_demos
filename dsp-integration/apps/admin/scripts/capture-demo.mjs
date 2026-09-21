/* Capture the POC API's read side into a snapshot the hosted demo serves
   instead of a server (Rob, 21 Sep: host the prototype so it can be tried in
   an iframe). Run it with the dev API up:

     npm run dev:api          # in another terminal
     npm run demo:capture -w @ph-dsp/admin

   It writes public/demo/api-snapshot.json and copies every creative the
   snapshot points at into public/demo/api-assets/. Read-only by design: the
   demo build refuses writes rather than pretending they saved. */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = process.env.DEMO_API ?? 'http://127.0.0.1:4000'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo')
/* The date the snapshot was taken: the demo pins its clock to it, so the
   schedule's date range matches the windows in the capture. */
const CAPTURED_AT = new Date().toISOString()

const get = async (path) => {
  const res = await fetch(`${API}/api${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

const snapshot = {}
const record = async (path) => {
  snapshot[path] = await get(path)
  return snapshot[path]
}

/* Everything the screens read. */
const campaigns = (await record('/admin/v1/campaigns')).items
await Promise.all([
  '/admin/v1/session',
  '/admin/v1/display-types',
  '/admin/v1/playlists',
  '/admin/v1/partners',
  '/admin/v1/exchange',
  '/admin/v1/advertiser-settings',
  '/admin/v1/available-inventory',
  '/admin/v1/advertisers',
  '/admin/v1/targeting-variables',
  '/admin/v1/booking-schedule',
  ...campaigns.map((c) => `/admin/v1/campaigns/${c.campaignId}/approval`),
].map(record))

/* Per-campaign schedules, as the campaign page asks for them. */
await Promise.all(campaigns.map((c) => record(`/admin/v1/booking-schedule?campaignId=${encodeURIComponent(c.campaignId)}`)))

/* Creatives: copy the files and point the snapshot at them, relative to the
   page, so the demo works wherever it is published. */
await rm(OUT, { recursive: true, force: true })
await mkdir(join(OUT, 'api-assets'), { recursive: true })
const assets = new Set()
const json = JSON.stringify(snapshot).replace(/\/assets\/([\w.-]+)/g, (_m, file) => {
  assets.add(file)
  return `./api-assets/${file}`
})
for (const file of assets) {
  const res = await fetch(`${API}/assets/${file}`)
  if (!res.ok) continue
  await writeFile(join(OUT, 'api-assets', file), Buffer.from(await res.arrayBuffer()))
}

await writeFile(join(OUT, 'api-snapshot.json'), JSON.stringify({ capturedAt: CAPTURED_AT, routes: JSON.parse(json) }, null, 0))
console.log(`Captured ${Object.keys(snapshot).length} responses and ${assets.size} creatives from ${API}.`)
