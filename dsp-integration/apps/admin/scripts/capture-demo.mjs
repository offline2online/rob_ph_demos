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

/* The booking schedule asks for an explicit range, one per view, and again
   for each filter the funnels offer. Capture every combination the page can
   reach on its own, so Weekly and Monthly show their own windows rather
   than falling back to the fortnight (Rob, 21 Sep). */
const iso = (d) => d.toISOString().slice(0, 10)
const plusDays = (days) => iso(new Date(Date.parse(CAPTURED_AT) + days * 86400000))
const SPAN_DAYS = [13, 83, 91] // Daily, Weekly, Monthly — SPAN_DAYS in BookingSchedulePage
const dsps = snapshot['/admin/v1/booking-schedule'].dsps
const filters = [
  '',
  ...dsps.map((d) => `&partnerId=${encodeURIComponent(d.partnerId)}`),
  ...dsps.flatMap((d) => d.advertisers.map((a) => `&advertiserId=${encodeURIComponent(a.advertiserId)}`)),
]
const from = iso(new Date(CAPTURED_AT))
await Promise.all(
  SPAN_DAYS.flatMap((span) => [...new Set(filters)].map((f) => record(`/admin/v1/booking-schedule?from=${from}&to=${plusDays(span)}${f}`))),
)

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
