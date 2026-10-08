/* Run 6 — Full user journey, as one command (E2E Testing Strategy §3.1,
   ticket 35PG44MjyR7S27iAMGY6). `npm run e2e:journey` from dsp-integration/.

   This is not the vitest harness. It starts the real API and the mock DSP
   service as child processes on ephemeral ports with a fresh SQLite file,
   and drives them the way the two surfaces do: the retailer phases over the
   Admin API (what the Chrome agent used to click), the advertiser phases
   over the Partner API. The scheduler is a third process (`scheduler:tick`),
   and all three share one PH_TEST_CLOCK file, which is how a window is
   cleared and ended inside one run without touching Advertiser settings.

   Note (8 Oct 2026): the windowed auction was retired (company auction
   schedule, play-window setting and per-slot bidMode removed; migration
   0059). Comments below that mention a company cutoff or the seed's
   18:00 UTC schedule describe the journey as written before then.

   Cases are the Run 6 Runbook's J/K/L. Each records pass / fail / known-gap
   with expected and actual; the run exits non-zero on any fail. Results go
   to results/<timestamp>.json (one record per case ID, for report-e2e and
   file-e2e-bugs) and are printed; the handover block is printed in the
   runbook's format so a person can read it as before.

   Phase 1b (displays, stores, audience score) is PH Core's data and is
   seeded straight into the stand-in tables, as the runbook says. The
   booking and the billing line item are read from the database for the
   same reason: the Partner API deliberately exposes neither. */
import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { multipart } from '../media'
import { BAD, CANVAS, campaignBody, versions, writePackage } from './fixtures'

const API_DIR = fileURLToPath(new URL('../../', import.meta.url))
const MOCKS_DIR = resolve(API_DIR, '../dsp-mocks')
const ROOT = resolve(API_DIR, '../../')
const TOKEN = 'poc-token-google-dv360'
const PARTNER = 'p_google'
const ADVERTISER = 'swisse'
/* The journey's own "now": a Thursday mid-morning UTC. Windows are 24 h
   from 00:00 UTC with a cutoff at 18:00 UTC the day before (seed defaults). */
const START = new Date('2026-10-01T10:00:00.000Z')

/* ---- results ---------------------------------------------------------- */
type Status = 'pass' | 'fail' | 'known-gap' | 'skipped'
interface CaseResult { caseId: string; title: string; status: Status; expected: string; actual: string; phase: number }
const results: CaseResult[] = []
let currentPhase = 0
const record = (caseId: string, title: string, ok: boolean, expected: string, actual: string, status: Status = ok ? 'pass' : 'fail') => {
  results.push({ caseId, title, status, expected, actual, phase: currentPhase })
  console.log(`  ${status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status.toUpperCase()}  ${caseId} — ${title}${ok ? '' : `\n        expected: ${expected}\n        actual:   ${actual}`}`)
}
class StopRun extends Error {}
const must = (caseId: string, title: string, ok: boolean, expected: string, actual: string) => {
  record(caseId, title, ok, expected, actual)
  if (!ok) throw new StopRun(`${caseId} failed; the later phases depend on it.`)
}

/* ---- processes -------------------------------------------------------- */
const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => (typeof a === 'object' && a ? res(a.port) : rej(new Error('no port')))) })
})
const children: ChildProcess[] = []
const start = (cwd: string, args: string[], env: NodeJS.ProcessEnv, name: string) => {
  const p = spawn(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  p.stdout.on('data', (d) => { if (process.env.JOURNEY_VERBOSE) process.stdout.write(`[${name}] ${d}`) })
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`))
  children.push(p)
  return p
}
const waitFor = async (url: string, what: string, ms = 60_000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`${what} did not come up at ${url} within ${ms / 1000}s`)
}
const stopAll = () => { for (const c of children) if (!c.killed) c.kill('SIGTERM') }
const runOnce = (cwd: string, args: string[], env: NodeJS.ProcessEnv) => new Promise<string>((res, rej) => {
  const p = spawn(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), ...args], { cwd, env: { ...process.env, ...env } })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.stderr.on('data', (d) => (out += d))
  p.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`${args.join(' ')} exited ${code}:\n${out}`))))
})

/* ---- http ------------------------------------------------------------- */
interface Res { status: number; json: any; text: string }
const http = (base: string, headers: Record<string, string> = {}) => async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}, raw?: Buffer): Promise<Res> => {
  const r = await fetch(base + path, { method, headers: { ...(raw || body === undefined ? {} : { 'content-type': 'application/json' }), ...headers, ...extra }, body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, json, text }
}

/* ---- handover --------------------------------------------------------- */
interface Handover {
  apiUrl: string; adminUrl: string; mocksUrl: string
  displayTypeId: string; canvas: string; slot: number; positionId: string
  floorCpm: number; currency: string
  reservePrice: number | null; maxCampaigns: number | null; billingUnitHours: number | null
  dsp: string; dspConnected: boolean; cvGenderEnabled: boolean
  displays: string[]; stores: string[]; audienceScore: number | null; slotDurationSec: number | null
}
const printHandover = (h: Handover) => console.log(`
--- RUN 6 HANDOVER ---
Instance: ${h.adminUrl} / ${h.apiUrl}
Display type id (new): ${h.displayTypeId}
Canvas: ${h.canvas}
Slot label / id: Slot ${h.slot} / ${h.positionId}
Base floor CPM + currency (company-wide): ${h.floorCpm} ${h.currency}
Effective reserve price: ${h.reservePrice ?? 'none'}
Effective max campaigns: ${h.maxCampaigns ?? 'default'}
Effective billing unit hours: ${h.billingUnitHours ?? 'default'}
Advertiser: Swisse / ${ADVERTISER}
DSP: Google DSP / ${PARTNER} (connected, Live): ${h.dspConnected ? 'yes' : 'no'}
store.cv_gender enabled for ${PARTNER}: ${h.cvGenderEnabled ? 'yes' : 'no'}
Displays / stores: ${h.displays.length} (${h.displays.join(', ')}) / ${h.stores.length} (${h.stores.join(', ')})
Audience score / slot duration: ${h.audienceScore ?? 'none'} / ${h.slotDurationSec ?? 'none'}
--- END HANDOVER ---`)

/* ---- the run ------------------------------------------------------------ */
async function main() {
  const work = mkdtempSync(join(tmpdir(), 'ph-run6-'))
  const dbFile = join(work, 'run6.sqlite')
  const assetsDir = join(work, 'assets')
  const clockFile = join(work, 'clock')
  const setClock = (d: Date) => writeFileSync(clockFile, d.toISOString())
  setClock(START)
  const apiPort = await freePort()
  const mocksPort = await freePort()
  const apiUrl = `http://127.0.0.1:${apiPort}/api`
  const mocksUrl = `http://127.0.0.1:${mocksPort}`
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test', API_PORT: String(apiPort), API_HOST: '127.0.0.1', PH_DB_FILE: dbFile, PH_ASSETS_DIR: assetsDir,
    PH_SECRETS_KEY: randomBytes(32).toString('base64'), DSP_INTEGRATION_ENABLED: 'true', POC_ROLE: 'hq_admin',
    PH_SCHEDULER: 'off', PH_TEST_CLOCK: clockFile, DSP_MOCKS_URL: mocksUrl, DSP_MOCKS_PORT: String(mocksPort),
    PARTNER_TOKENS: '', PH_PUBLIC_URL: '',
  }
  const admin = http(apiUrl + '/admin/v1')
  const partner = http(apiUrl + '/v1', { authorization: `Bearer ${TOKEN}` })
  const mocks = http(mocksUrl + '/_control')
  const tick = () => runOnce(API_DIR, ['src/exchange/tickCli.ts'], env)
  const db = () => new DatabaseSync(dbFile)
  console.log(`Run 6 journey · work dir ${work}`)

  /* ---------- Phase 0 — start the local instance ---------- */
  currentPhase = 0
  console.log('\nPhase 0 — start the local instance')
  start(MOCKS_DIR, ['src/index.ts'], env, 'mocks')
  await waitFor(`${mocksUrl}/_control/state`, 'mock DSP service')
  start(API_DIR, ['src/index.ts'], env, 'api')
  await waitFor(`${apiUrl.replace(/\/api$/, '')}/healthz`, 'API')
  const features = await admin('GET', '/features')
  must('P0', 'API up, DSP integration on, fresh database, clock at START', features.status === 200 && features.json?.dspIntegration === true, 'dspIntegration true', `${features.status} ${features.text}`)
  /* Isolation (§3.3): no mock DSP bids during the journey, so the Nestlé
     auto-approve creative can never alter an outcome. L2 is an API bid. */
  const quiet = await mocks('POST', '/bidder', { mode: 'no-bid' })
  must('P0b', 'mock bidders switched to no-bid for the journey', quiet.status === 200, '200', `${quiet.status} ${quiet.text}`)

  /* ---------- Phase 1 — retailer setup (Admin API replaces Chrome) ---------- */
  currentPhase = 1
  console.log('\nPhase 1 — retailer setup (J)')
  const partners = await admin('GET', '/partners')
  const google = partners.json?.items?.find((p: any) => p.id === PARTNER)
  must('J0', 'Google DSP connected and Live; Swisse on its seat', google?.status === 'connected' && google?.mode === 'live' && google?.seats?.some((s: any) => /swisse/i.test(s.name)), 'connected, live, Swisse seat', JSON.stringify({ status: google?.status, mode: google?.mode, seats: google?.seats?.map((s: any) => s.name) }))
  const access = await admin('PUT', '/targeting-variables', { access: { 'store.cv_gender': [PARTNER] } })
  const cv = access.json?.items?.find((v: any) => v.key === 'store.cv_gender')
  must('J0b', 'store.cv_gender enabled for Google DSP', access.status === 200 && (cv?.access === 'all' || cv?.access?.includes?.(PARTNER) || cv?.partnerIds?.includes?.(PARTNER)), `access includes ${PARTNER}`, `${access.status} ${JSON.stringify(cv)}`)

  const dtId = `dt_run6_${Date.now()}`
  const created = await admin('POST', '/display-types', {
    id: dtId, name: 'Run 6 Landscape', touchPoint: 'Digital Signage', description: null, displayCanvasSize: CANVAS, backgroundColor: '#000000',
    defaultPlaylistId: `pl_${dtId}`, playlistSettings: { maximumCampaignsPlayedInRotation: 2 }, qrControl: {}, enabledFeatures: {}, multiZone: { enabled: false, zones: [] },
  })
  const playlist = created.status === 201 ? await admin('GET', `/playlists/${created.json.defaultPlaylistId}`) : null
  must('J1', 'display type created (1920×1080); its playlist auto-creates', created.status === 201 && created.json?.displayCanvasSize?.width === 1920 && (playlist?.status === 200 || playlist?.status === 404 /* no single GET; list below */), '201, canvas 1920×1080, playlist exists', `${created.status} ${created.text.slice(0, 200)}`)
  if (playlist?.status === 404) {
    const list = await admin('GET', '/playlists')
    record('J1b', 'auto-created playlist is listed', list.json?.items?.some((p: any) => p.id === created.json.defaultPlaylistId), 'playlist listed', JSON.stringify(list.json?.items?.map((p: any) => p.id)))
  }

  const ext = await admin('PUT', `/display-types/${dtId}/extensions`, {
    slots: [
      { label: 'Advertiser slot', owner: 'advertiser', partnerIds: [PARTNER], advertisers: [], listMode: 'rtb', storeScope: null, quota: null },
      { label: 'HQ slot', owner: 'internal', partnerIds: [], advertisers: [], listMode: null, storeScope: null, quota: null },
    ],
    venue: { openOohVenueType: 'retail.convenience', orientation: 'landscape', loopLengthSec: 30 },
  })
  must('J4a', 'slot 1 owner = Advertiser; loop length set (assignment is Available Inventory\'s, below)', ext.status === 200 && ext.json?.slots?.[0]?.owner === 'advertiser' && ext.json?.venue?.loopLengthSec === 30, 'owner advertiser, loopLengthSec 30', `${ext.status} ${ext.text.slice(0, 300)}`)
  const inv = await admin('PUT', '/available-inventory', { items: [{ displayTypeId: dtId, slot: 1, reservePrice: 50, assignedTo: { partnerIds: [PARTNER], advertisers: [], whitelistOnly: false } }] })
  const invRow = inv.json?.items?.find((i: any) => i.displayTypeId === dtId && i.slot === 1)
  must('J4b', 'assigned to Google DSP (open, not held)', inv.status === 200 && invRow?.assignedTo?.partnerIds?.includes(PARTNER) && !invRow?.assignedTo?.advertisers?.length, 'partnerIds [p_google], no held advertiser', `${inv.status} ${JSON.stringify({ assignedTo: invRow?.assignedTo })} ${inv.status !== 200 ? inv.text.slice(0, 300) : ''}`)
  const settings = await admin('GET', '/advertiser-settings')
  const floorCpm = settings.json?.floorCpm, currency = settings.json?.currency
  must('J4c', 'base floor read from Advertiser settings (never changed); no personalised multiplier', settings.status === 200 && typeof floorCpm === 'number' && settings.json?.personalisedMultiplier === undefined, 'a number, no multiplier', `${settings.status} floor=${floorCpm}`)
  const settingsBefore = settings.text
  const inv5 = await admin('GET', '/available-inventory')
  const row5 = inv5.json?.items?.find((i: any) => i.displayTypeId === dtId && i.slot === 1)
  record('J5', 'slot shows in Available Inventory with those values; Unassigned until Phase 1b', !!row5 && row5.unassigned !== false, 'row present, unassigned', JSON.stringify({ present: !!row5, unassigned: row5?.unassigned }))

  const handover: Handover = {
    apiUrl: apiUrl + '/v1', adminUrl: apiUrl + '/admin/v1', mocksUrl, displayTypeId: dtId, canvas: `${CANVAS.width}x${CANVAS.height}`, slot: 1, positionId: `${dtId}.s1`,
    floorCpm, currency,
    reservePrice: row5?.reservePrice ?? null, maxCampaigns: row5?.maxCampaigns ?? null, billingUnitHours: row5?.billingUnitHours ?? null,
    dsp: PARTNER, dspConnected: google?.status === 'connected', cvGenderEnabled: true, displays: [], stores: [], audienceScore: null, slotDurationSec: null,
  }

  /* ---------- Phase 1b — seed displays, stores & audience score (PH Core stand-ins) ---------- */
  currentPhase = 1
  console.log('\nPhase 1b — seed PH Core stand-ins (displays, stores, audience score)')
  {
    const d = db()
    const stores = (d.prepare('SELECT id FROM stores ORDER BY id LIMIT 2').all() as { id: string }[]).map((s) => s.id)
    const ins = d.prepare('INSERT INTO displays (id, name, store, store_id, display_type_id) VALUES (?, ?, ?, ?, ?)')
    const displays = [`d_run6_01`, `d_run6_02`]
    displays.forEach((id, i) => ins.run(id, `Run 6 display ${i + 1}`, stores[i] ?? stores[0], stores[i] ?? stores[0], dtId))
    d.prepare('INSERT INTO audience_vacd (display_type_id, slot, assumed_views_per_window, counted) VALUES (?, ?, ?, ?)').run(dtId, 1, 1200, 1)
    d.close()
    handover.displays = displays
    handover.stores = stores
    handover.audienceScore = 1200
  }
  await new Promise((r) => setTimeout(r, 1200)) // display summaries are a one-second snapshot
  const k0pre = await partner('GET', `/inventory?advertiserId=${ADVERTISER}`)
  const pos0 = k0pre.json?.items?.find((p: any) => p.positionId === handover.positionId)
  must('1b', 'slot listed over the Partner API with displays > 0 and assumedViewsPerWindow > 0', !!pos0 && pos0.displayCount > 0 && pos0.assumedViewsPerWindow > 0, 'displays > 0, views > 0', JSON.stringify({ found: !!pos0, displayCount: pos0?.displayCount, assumedViewsPerWindow: pos0?.assumedViewsPerWindow, ids: k0pre.json?.items?.map((p: any) => p.positionId) }))
  handover.slotDurationSec = pos0?.slotDurationSec ?? null
  const inv5b = await admin('GET', '/available-inventory')
  const row5b = inv5b.json?.items?.find((i: any) => i.displayTypeId === dtId && i.slot === 1)
  record('J5b', 'no longer Unassigned once displays are seeded', row5b?.unassigned === false, 'unassigned false', JSON.stringify({ unassigned: row5b?.unassigned }))
  printHandover(handover)

  /* ---------- Phase 2 — advertiser submit (Partner API) ---------- */
  currentPhase = 2
  console.log('\nPhase 2 — advertiser submit (K)')
  const pkgDir = join(work, 'run6-package')
  mkdirSync(pkgDir, { recursive: true })
  writePackage(pkgDir)
  const pricing = pos0?.pricing ?? {}
  must('K0', 'inventory shows the slot with the same base floor as the handover',
    pricing?.effectiveFloorCpm?.localised === floorCpm && pricing?.personalisedMultiplier === undefined,
    `floor ${floorCpm}, no personalised price`, JSON.stringify({ pricing }))
  const body = campaignBody(dtId, ADVERTISER)
  const createdC = await partner('POST', '/campaigns', body)
  must('K1', 'POST /v1/campaigns with the package body → 201', createdC.status === 201 && !!createdC.json?.campaignId, '201 + campaignId', `${createdC.status} ${createdC.text.slice(0, 300)}`)
  const campaignId: string = createdC.json.campaignId
  let allAccepted = true
  const uploads: Record<string, string> = {}
  for (const v of versions()) {
    const m = multipart({ version: v.id }, { name: v.file.split('/').pop()!, bytes: v.bytes })
    const up = await partner('POST', `/campaigns/${campaignId}/assets`, undefined, m.headers, m.payload)
    uploads[v.id] = `${up.status} ${up.json?.checks ? JSON.stringify(up.json.checks.filter((c: any) => c.status !== 'pass' && c.result !== 'pass')) : up.text.slice(0, 120)}`
    if (up.status !== 201) allAccepted = false
  }
  record('K2', 'the five creatives pass every check (±5% aspect-ratio rule)', allAccepted, 'all 201', JSON.stringify(uploads))
  const badM = multipart({ version: 'default' }, { name: BAD.file.split('/').pop()!, bytes: BAD.bytes })
  const bad = await partner('POST', `/campaigns/${campaignId}/assets`, undefined, badM.headers, badM.payload)
  const badFails = (bad.json?.error?.details ?? []).map((c: any) => c.field ?? c.check ?? c.name)
  record('K2b', 'the portrait asset is refused on aspect_ratio only', bad.status === 422 && badFails.length >= 1 && badFails.every((c: string) => /aspect/.test(String(c))), '422, aspect_ratio', `${bad.status} ${JSON.stringify(badFails)} ${bad.text.slice(0, 160)}`)
  /* The refused asset must not have displaced the accepted default. */
  const submitted = await partner('POST', `/campaigns/${campaignId}/submit`)
  must('K3', 'submit → Awaiting approval', submitted.status === 200 && /awaiting/.test(String(submitted.json?.status)), '200 awaiting_approval', `${submitted.status} ${submitted.text.slice(0, 200)}`)
  const readBack = await partner('GET', `/campaigns/${campaignId}`)
  const norm = (t: any[]) => JSON.stringify([...t].sort((a, b) => a.id.localeCompare(b.id)).map((x) => ({ id: x.id, priority: x.priority, pricingType: x.pricingType, rules: x.rules })))
  record('K3b', 'GET /v1/campaigns/{id} returns the four targeted versions and rules unchanged, priorities included', readBack.status === 200 && norm(readBack.json?.targeted ?? []) === norm(body.targeted), norm(body.targeted), `${readBack.status} ${norm(readBack.json?.targeted ?? [])}`)

  /* ---------- Phase 3 — retailer approve (Admin API replaces Chrome) ---------- */
  currentPhase = 3
  console.log('\nPhase 3 — retailer approve (L1)')
  const approvals = await admin('GET', '/approvals')
  const inQueue = approvals.json?.items?.find((a: any) => a.campaignId === campaignId || a.id === campaignId)
  record('L1a', 'the submission appears in the approvals list', !!inQueue, 'listed', JSON.stringify({ found: !!inQueue, status: inQueue?.status }))
  const view = await admin('GET', `/campaigns/${campaignId}/approval`)
  const assetVersion = view.json?.assetVersion ?? view.json?.approval?.assetVersion
  const creative = view.json?.creative
  const creativeVersions: any[] = Array.isArray(creative) ? creative : Array.isArray(creative?.versions) ? creative.versions : Array.isArray(creative?.assets) ? creative.assets : creative && typeof creative === 'object' ? Object.keys(creative) : []
  const ts = JSON.stringify(view.json?.targetingSummary ?? '')
  record('L1b', 'the approval view shows the submission\'s creative (5 versions) and its targeting summary', view.status === 200 && creativeVersions.length >= 5 && /cv_gender|Gender/.test(ts) && /Cold Day|variable_segments/.test(ts), '5 creative versions; targeting summary names cv_gender and Cold Day', `${view.status} creative=${creativeVersions.length} assetVersion=${assetVersion} summary=${ts.slice(0, 160)}`)
  const approved = await admin('POST', `/campaigns/${campaignId}/approve`, { assetVersion })
  const status1 = await partner('GET', `/campaigns/${campaignId}/status`)
  must('L1', 'approve → Approved', approved.status === 200 && status1.json?.status === 'approved', 'approved', `${approved.status} ${approved.text.slice(0, 120)} / status ${status1.json?.status}`)
  const activated = await admin('PUT', `/campaigns/${campaignId}/activation`, { enabled: true })
  record('L1c', 'campaign activated', activated.status === 200, '200', `${activated.status} ${activated.text.slice(0, 120)}`)

  /* ---------- Phase 4 — advertiser view of the open slot (Partner API) ---------- */
  currentPhase = 4
  console.log('\nPhase 4 — advertiser availability and the retired windowed auction (L2–L6)')
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const avail = await partner('GET', `/inventory/${handover.positionId}/availability?advertiserId=${ADVERTISER}&from=${day(START)}&to=${day(new Date(START.getTime() + 7 * 86_400_000))}`)
  /* Since 8 Oct 2026 an open (rtb) slot is sold per impression, bid bidLookaheadSeconds before each
     play: there is no window series to report, and the endpoint says so (REQUIREMENTS §5). */
  const lookahead = avail.json?.bidLookaheadSeconds
  must('L2a', 'an open slot is sold per impression: availability reports sale "realtime", the bid lookahead and no window series',
    avail.status === 200 && avail.json?.positionId === handover.positionId && avail.json?.sale === 'realtime' && typeof lookahead === 'number' && lookahead > 0 && Array.isArray(avail.json?.windows) && avail.json.windows.length === 0,
    'sale realtime, bidLookaheadSeconds > 0, windows []', `${avail.status} ${avail.text.slice(0, 300)}`)
  /* The window bid, clearing, hand-off and window billing cases (L2b, L2, L2c, L3, L4, L6) were written for
     the retired windowed auction (company cutoff, scheduled clearing, type "bid"). Window sales that remain
     are deals on a buyers list, which Phase 5 drives end to end (reserve, hand-off, billing); per-impression
     fills and proof of play are vitest's realtime.test.ts. */
  const retired = 'windowed auction retired 8 Oct 2026; open slots are sold per impression (covered by realtime.test.ts), deals by Phase 5'
  for (const [id, title] of [['L2b', 'a bid below the base floor is refused'], ['L2', 'a window bid is accepted'], ['L2c', 'the auction clears the window'], ['L3', 'hand-off: a booking for the cleared window'], ['L4', 'billing for a cleared window'], ['L6', 'a window with no eligible bid falls through']] as const)
    record(id, title, true, retired, retired, 'skipped')
  const settingsAfter = await admin('GET', '/advertiser-settings')
  record('L2e', 'Advertiser settings untouched by the journey so far', settingsAfter.text === settingsBefore, 'identical', settingsAfter.text === settingsBefore ? 'identical' : `changed: ${settingsAfter.text.slice(0, 200)}`)
  /* L5 — continuity. */
  const final = await partner('GET', `/campaigns/${campaignId}`)
  record('L5', 'the campaign from K, on the slot from J, is unchanged: stored versions and targeting', final.status === 200 && norm(final.json?.targeted ?? []) === norm(body.targeted) && final.json?.displayTypeId === dtId, 'same id, slot, targeting', `${final.status} displayTypeId=${final.json?.displayTypeId} targetingUnchanged=${norm(final.json?.targeted ?? []) === norm(body.targeted)}`)
  const w2 = new Date(START.getTime() + 3 * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z' // Phase 5 windows start after this

  /* ---------- Phase 5 — deal types end to end (Run 7 cases M; ticket rFN7TfIXtValP5hfIq1o) ----------
     The same slot, campaign and processes as L: the retailer makes the slot a reserve-priced
     deal of each type from the buyers list (Admin API), the advertiser reserves a window over
     the Partner API, the tick hands it off, the test play reporter plays it and the tick bills it.
     Open RTB is L2–L6 above; private auction is the vitest Run 3/4/7 (it needs an auction window
     and a locked term, which this clock-driven journey does not exercise twice). */
  currentPhase = 5
  console.log('\nPhase 5 — deal types: preferred and programmatic guaranteed (M1–M8)')
  const RESERVE_PRICE = floorCpm + 50
  const assign = (buyersListId: string | null) => admin('PUT', '/available-inventory', { items: [{ displayTypeId: dtId, slot: 1, reservePrice: RESERVE_PRICE, assignedTo: { partnerIds: buyersListId ? [] : [PARTNER], advertisers: [], whitelistOnly: false, buyersListId } }] })
  const newList = (dealType: string, extra: Record<string, unknown> = {}) => admin('POST', '/buyers-lists', { name: `Run 7 ${dealType}`, dealType, invitedBuyers: [{ partnerId: PARTNER, seatId: '5130002' }], ...extra })
  const viewsPerWindow = 1200 /* the audience score seeded in Phase 1b */
  const t0 = Date.parse(w2) + 24 * 3_600_000
  const winPreferred = new Date(t0 + 2 * 24 * 3_600_000).toISOString()
  const winGuaranteed = new Date(t0 + 3 * 24 * 3_600_000).toISOString()
  setClock(new Date(t0 + 60_000))
  const reserveOn = (windowStart: string) => partner('POST', '/reservations', { positionId: handover.positionId, windowStart, campaignId, advertiserId: ADVERTISER, type: 'reserve', bidCpm: RESERVE_PRICE })

  /* M1 — deal type drives the fields the list captures. */
  const refusedVolume = await newList('preferred', { committedPlays: 500 })
  record('M1', 'a preferred deal refuses committed plays (volume is captured for guaranteed only)', refusedVolume.status === 400 && /committedPlays/.test(refusedVolume.text), '400 on committedPlays', `${refusedVolume.status} ${refusedVolume.text.slice(0, 160)}`)
  const refusedClose = await newList('guaranteed', { committedPlays: 500, auctionCloses: new Date(t0).toISOString() })
  record('M1b', 'a guaranteed deal refuses an auction window (only a private auction has one)', refusedClose.status === 400 && /auctionCloses/.test(refusedClose.text), '400 on auctionCloses', `${refusedClose.status} ${refusedClose.text.slice(0, 160)}`)

  /* M2–M4 — preferred deal. */
  const pref = await newList('preferred')
  must('M2', 'preferred deal created on the buyers list', pref.status === 201 && pref.json?.dealType === 'preferred' && pref.json?.committedPlays == null, '201 dealType preferred, no committed plays', `${pref.status} ${pref.text.slice(0, 200)}`)
  const assignedPref = await assign(pref.json.id)
  must('M2b', 'slot assigned to the preferred deal', assignedPref.status === 200, '200', `${assignedPref.status} ${assignedPref.text.slice(0, 200)}`)
  const prefRes = await reserveOn(winPreferred)
  must('M3', 'reserve at the reserve price: booked as a preferred deal, no committed volume, DSP told preferred_deal', prefRes.status === 201 && prefRes.json?.status === 'reserved' && prefRes.json?.dealType === 'preferred' && prefRes.json?.clearingCpm === RESERVE_PRICE && prefRes.json?.guaranteedImpressions == null && prefRes.json?.dspDeal?.dspDealKind === 'preferred_deal' && prefRes.json?.dspDeal?.unitCount == null, `reserved, preferred, ${RESERVE_PRICE}, no volume`, `${prefRes.status} ${prefRes.text.slice(0, 300)}`)
  const clash = await partner('POST', '/reservations', { positionId: handover.positionId, windowStart: winGuaranteed, campaignId, advertiserId: ADVERTISER, type: 'reserve', bidCpm: RESERVE_PRICE, dealType: 'guaranteed' })
  record('M3b', 'the list is authoritative: a reservation naming guaranteed on a preferred list is refused 409', clash.status === 409, '409', `${clash.status} ${clash.text.slice(0, 200)}`)
  {
    const d = db()
    const bk = d.prepare('SELECT * FROM campaign_slot_bookings WHERE display_type_id = ? AND slot = 1 AND window_start = ?').get(dtId, winPreferred) as any
    record('M4', 'hand-off: the preferred window is booked for the campaign at once', !!bk && bk.campaign_id === campaignId, `booking for ${campaignId}`, JSON.stringify(bk ?? null))
    d.close()
  }

  /* M5–M8 — programmatic guaranteed. */
  const pg = await newList('guaranteed', { committedPlays: 900 })
  must('M5', 'programmatic guaranteed deal created with committed plays', pg.status === 201 && pg.json?.dealType === 'guaranteed' && pg.json?.committedPlays === 900, '201 dealType guaranteed, 900', `${pg.status} ${pg.text.slice(0, 200)}`)
  const assignedPg = await assign(pg.json.id)
  must('M5b', 'slot reassigned to the guaranteed deal', assignedPg.status === 200, '200', `${assignedPg.status} ${assignedPg.text.slice(0, 200)}`)
  const bufferPct = (await admin('GET', '/advertiser-settings')).json?.guaranteeBufferPct ?? 10
  const committed = Math.floor(viewsPerWindow * (1 - bufferPct / 100))
  const pgRes = await reserveOn(winGuaranteed)
  must('M6', `reserve: committed volume = floor(forecast ${viewsPerWindow} × (1 − ${bufferPct}%)) = ${committed}, carried to DV360 as programmatic_guaranteed`, pgRes.status === 201 && pgRes.json?.dealType === 'guaranteed' && pgRes.json?.forecastImpressions === viewsPerWindow && pgRes.json?.guaranteedImpressions === committed && pgRes.json?.dspDeal?.dspDealKind === 'programmatic_guaranteed' && pgRes.json?.dspDeal?.unitCount === committed && pgRes.json?.dspDeal?.unit === 'impressions', `guaranteed, ${committed} impressions`, `${pgRes.status} ${pgRes.text.slice(0, 400)}`)
  {
    const d = db()
    const bk = d.prepare('SELECT * FROM campaign_slot_bookings WHERE display_type_id = ? AND slot = 1 AND window_start = ?').get(dtId, winGuaranteed) as any
    record('M7', 'hand-off: the guaranteed window is booked for the campaign at once', !!bk && bk.campaign_id === campaignId, `booking for ${campaignId}`, JSON.stringify(bk ?? null))
    d.close()
  }
  /* M8 — a short delivery is billed as played at the reserve price: realised VAC-d, no make-good. */
  const pgPlays = await admin('POST', '/test/plays', { reservationId: pgRes.json.reservationId, plays: [{ tier: 'default', count: 6, durationSec: 15 }] })
  must('M8a', 'test-only play reporter writes 6 plays for the guaranteed window', pgPlays.status === 201 && pgPlays.json?.total === 6, '201, 6 plays', `${pgPlays.status} ${pgPlays.text.slice(0, 200)}`)
  setClock(new Date(Date.parse(winGuaranteed) + 24 * 3_600_000 + 60_000))
  const tick4 = await tick()
  {
    const d = db()
    const li = d.prepare('SELECT * FROM billing_line_items WHERE reservation_id = ?').get(pgRes.json.reservationId) as any
    const ok = !!li && li.cpm === RESERVE_PRICE && li.plays === 6 && li.realised_views < committed && Math.abs(li.amount - Math.round((li.realised_views / 1000) * RESERVE_PRICE * 100) / 100) < 0.011
    record('M8', 'billing: realised VAC-d at the reserve price; the shortfall against the committed volume is not made good', ok, `cpm ${RESERVE_PRICE}, 6 plays, amount = realised views × cpm, realised views below ${committed}`, li ? JSON.stringify({ plays: li.plays, cpm: li.cpm, amount: li.amount, realisedViews: li.realised_views }) : `no line item · tick: ${tick4.trim().split('\n').slice(-2).join(' | ')}`)
    d.close()
  }
  const restored = await mocks('POST', '/bidder', { mode: 'default' })
  record('P4z', 'mock bidders restored', restored.status === 200, '200', String(restored.status))
}

/* ---- entry -------------------------------------------------------------- */
const startedAt = new Date()
let fatal: unknown = null
try {
  await main()
} catch (e) {
  fatal = e
  if (!(e instanceof StopRun)) console.error(e)
} finally {
  stopAll()
}
const counts = { pass: 0, fail: 0, 'known-gap': 0, skipped: 0 }
for (const r of results) counts[r.status]++
const out = { run: 'Run 6 — full user journey', startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, command: 'npm run e2e:journey', counts, stopped: fatal ? String((fatal as Error).message) : null, cases: results }
const resultsDir = join(ROOT, 'results')
mkdirSync(resultsDir, { recursive: true })
const file = join(resultsDir, `journey-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
console.log(`\n${counts.pass} pass · ${counts.fail} fail · ${counts['known-gap']} known gap · ${counts.skipped} skipped${fatal ? ` · stopped: ${(fatal as Error).message}` : ''}\nResults: ${file}`)
process.exit(counts.fail > 0 || (fatal && !(fatal instanceof StopRun)) ? 1 : 0)
