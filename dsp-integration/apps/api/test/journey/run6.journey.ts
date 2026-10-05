/* Run 6 — Full user journey, as one command (E2E Testing Strategy §3.1,
   ticket 35PG44MjyR7S27iAMGY6). `npm run e2e:journey` from dsp-integration/.

   This is not the vitest harness. It starts the real API and the mock DSP
   service as child processes on ephemeral ports with a fresh SQLite file,
   and drives them the way the two surfaces do: the retailer phases over the
   Admin API (what the Chrome agent used to click), the advertiser phases
   over the Partner API. The scheduler is a third process (`scheduler:tick`),
   and all three share one PH_TEST_CLOCK file, which is how a window is
   cleared and ended inside one run without touching Advertiser settings.

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
  targetingSupported: string[]; reservePrice: number | null; maxCampaigns: number | null; billingUnitHours: number | null
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
Targeting supported: ${h.targetingSupported.join(' + ')}
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
  const inv = await admin('PUT', '/available-inventory', { items: [{ displayTypeId: dtId, slot: 1, supportedTargeting: ['localised', 'personalised'], reservePrice: 50, assignedTo: { partnerIds: [PARTNER], advertisers: [], whitelistOnly: false } }] })
  const invRow = inv.json?.items?.find((i: any) => i.displayTypeId === dtId && i.slot === 1)
  must('J4b', 'assigned to Google DSP (open, not held); targeting supported = localised + personalised', inv.status === 200 && invRow?.assignedTo?.partnerIds?.includes(PARTNER) && !invRow?.assignedTo?.advertisers?.length && JSON.stringify([...(invRow?.supportedTargeting ?? [])].sort()) === JSON.stringify(['localised', 'personalised']), 'partnerIds [p_google], no held advertiser, localised + personalised', `${inv.status} ${JSON.stringify({ assignedTo: invRow?.assignedTo, supportedTargeting: invRow?.supportedTargeting })} ${inv.status !== 200 ? inv.text.slice(0, 300) : ''}`)
  const settings = await admin('GET', '/advertiser-settings')
  const floorCpm = settings.json?.floorCpm, currency = settings.json?.currency
  must('J4c', 'base floor read from Advertiser settings (never changed); no personalised multiplier', settings.status === 200 && typeof floorCpm === 'number' && settings.json?.personalisedMultiplier === undefined, 'a number, no multiplier', `${settings.status} floor=${floorCpm}`)
  const settingsBefore = settings.text
  const inv5 = await admin('GET', '/available-inventory')
  const row5 = inv5.json?.items?.find((i: any) => i.displayTypeId === dtId && i.slot === 1)
  record('J5', 'slot shows in Available Inventory with those values; Unassigned until Phase 1b', !!row5 && row5.unassigned !== false, 'row present, unassigned', JSON.stringify({ present: !!row5, unassigned: row5?.unassigned }))

  const handover: Handover = {
    apiUrl: apiUrl + '/v1', adminUrl: apiUrl + '/admin/v1', mocksUrl, displayTypeId: dtId, canvas: `${CANVAS.width}x${CANVAS.height}`, slot: 1, positionId: `${dtId}.s1`,
    floorCpm, currency, targetingSupported: ['localised', 'personalised'],
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
  must('K0', 'inventory shows the slot with the same base floor and targeting as the handover',
    pricing?.effectiveFloorCpm?.localised === floorCpm && pricing?.personalisedMultiplier === undefined && pos0?.supportedTargeting?.includes('personalised'),
    `floor ${floorCpm}, no personalised price, personalised supported`, JSON.stringify({ pricing, supportedTargeting: pos0?.supportedTargeting }))
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
  const otherLocalisedOnly = k0pre.json?.items?.find((p: any) => p.positionId !== handover.positionId && p.supportedTargeting?.includes('localised') && !p.supportedTargeting?.includes('personalised'))
  if (otherLocalisedOnly) {
    const [e6dt, e6slot] = otherLocalisedOnly.positionId.split('.s')
    const e6 = await partner('POST', '/campaigns', campaignBody(e6dt, ADVERTISER, Number(e6slot)))
    record('E6', 'personalised package on a localised-only slot → 400 validation_failed on targeted[n].pricingType', e6.status === 400 && e6.json?.error?.code === 'validation_failed' && (e6.json?.error?.details ?? []).some((d: any) => /pricingType/.test(d.field ?? '')), '400 validation_failed pricingType', `${e6.status} ${e6.text.slice(0, 200)}`)
  } else record('E6', 'localised-only slot cross-check', true, '-', 'not exercised (no localised-only slot)', 'skipped')

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

  /* ---------- Phase 4 — advertiser bid & verify (Partner API + tick) ---------- */
  currentPhase = 4
  console.log('\nPhase 4 — advertiser bid & verify (L2–L6)')
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const avail = await partner('GET', `/inventory/${handover.positionId}/availability?advertiserId=${ADVERTISER}&from=${day(START)}&to=${day(new Date(START.getTime() + 7 * 86_400_000))}`)
  const windows: any[] = avail.json?.windows ?? avail.json?.items ?? []
  const nextOpen = windows.find((w) => w.status === 'available')
  must('L2a', 'the next open window is available', !!nextOpen, 'an available window', `${avail.status} ${JSON.stringify(windows.slice(0, 3))}`)
  const windowStart: string = nextOpen.windowStart ?? nextOpen.start
  const below = await partner('POST', '/reservations', { positionId: handover.positionId, windowStart, campaignId, advertiserId: ADVERTISER, type: 'bid', bidCpm: Math.max(1, floorCpm - 10) })
  record('L2b', 'a bid below the base floor is refused below_floor', below.status === 422 || (below.status === 400 && /floor/.test(below.text)), '422 below_floor', `${below.status} ${below.text.slice(0, 160)}`)
  const bidCpm = floorCpm + 20 // 120 on a base of 100, accepted
  const bid = await partner('POST', '/reservations', { positionId: handover.positionId, windowStart, campaignId, advertiserId: ADVERTISER, type: 'bid', bidCpm })
  must('L2', `a bid of ${bidCpm} (base ${floorCpm}) is accepted for a campaign with personalised versions`, bid.status === 201 && bid.json?.status === 'pending', '201 pending', `${bid.status} ${bid.text.slice(0, 200)}`)
  const reservationId: string = bid.json.reservationId
  /* Clear the window: move the clock past its cutoff and tick. No settings change. */
  const cutoff = new Date(Date.parse(windowStart) - 6 * 3_600_000) // seed cutoff 18:00 UTC the day before
  setClock(new Date(cutoff.getTime() + 60_000))
  const tick1 = await tick()
  const res1 = await partner('GET', `/reservations/${reservationId}`)
  must('L2c', 'the auction clears the window; the campaign wins at its own price', res1.json?.status === 'won' && res1.json?.clearingCpm === bidCpm, `won at ${bidCpm}`, `${JSON.stringify(res1.json)} · tick: ${tick1.trim().split('\n').slice(-2).join(' | ')}`)
  {
    const d = db()
    const bk = d.prepare('SELECT * FROM campaign_slot_bookings WHERE display_type_id = ? AND slot = 1 AND window_start = ?').get(dtId, windowStart) as any
    record('L3', 'hand-off: a booking exists for the slot and window carrying this campaign', !!bk && bk.campaign_id === campaignId, `booking for ${campaignId}`, JSON.stringify(bk ?? null))
    const ho = d.prepare('SELECT handed_off_at, reason FROM reservations WHERE id = ?').get(reservationId) as any
    record('L3b', 'reservation marked handed off, no refusal reason', !!ho?.handed_off_at && !ho?.reason, 'handed_off_at set', JSON.stringify(ho))
    d.close()
  }
  const settingsAfter = await admin('GET', '/advertiser-settings')
  record('L2e', 'Advertiser settings untouched by clearing the window (test clock, not the cutoff hack)', settingsAfter.text === settingsBefore, 'identical', settingsAfter.text === settingsBefore ? 'identical' : `changed: ${settingsAfter.text.slice(0, 200)}`)

  /* L4 — end the window, report plays, bill. */
  const windowEnd = new Date(Date.parse(windowStart) + 24 * 3_600_000)
  const plays = await admin('POST', '/test/plays', { reservationId, plays: [{ tier: 'default', count: 6, durationSec: 15 }, { tier: 'localised', count: 2, durationSec: 15 }, { tier: 'personalised', count: 4, durationSec: 15 }] })
  must('L4a', 'test-only play reporter writes plays for the won window', plays.status === 201 && plays.json?.total === 12, '201, 12 plays', `${plays.status} ${plays.text.slice(0, 200)}`)
  setClock(new Date(windowEnd.getTime() + 60_000))
  const tick2 = await tick()
  {
    const d = db()
    const li = d.prepare('SELECT * FROM billing_line_items WHERE reservation_id = ?').get(reservationId) as any
    const basePlays = 8, pPlays = 4
    const ok = !!li && li.plays === 12 && li.cpm === bidCpm && Math.abs(li.amount - Math.round((li.realised_views / 1000) * bidCpm * 100) / 100) < 0.011
    record('L4', 'billing: every play, whatever tier, at the cleared CPM against realised VAC-d; no split', ok,
      `plays 12 (${basePlays} base + ${pPlays} personalised), cpm ${bidCpm}, amount = realised views × cpm`, li ? JSON.stringify({ plays: li.plays, cpm: li.cpm, amount: li.amount, realisedViews: li.realised_views }) : `no line item · tick: ${tick2.trim().split('\n').slice(-2).join(' | ')}`)
    d.close()
  }
  /* L5 — continuity. */
  const final = await partner('GET', `/campaigns/${campaignId}`)
  record('L5', 'the campaign from K, on the slot from J, is the one booked and billed; stored versions and targeting unchanged', final.status === 200 && norm(final.json?.targeted ?? []) === norm(body.targeted) && final.json?.displayTypeId === dtId, 'same id, slot, targeting', `${final.status} displayTypeId=${final.json?.displayTypeId} targetingUnchanged=${norm(final.json?.targeted ?? []) === norm(body.targeted)}`)

  /* L6 — fall-through: a later window nobody bids on. Bidders are already no-bid. */
  const w2 = new Date(windowEnd.getTime() + 24 * 3_600_000).toISOString() // the window after next
  const cutoff2 = new Date(Date.parse(w2) - 6 * 3_600_000)
  setClock(new Date(cutoff2.getTime() + 60_000))
  const tick3 = await tick()
  {
    const d = db()
    const bk = d.prepare('SELECT * FROM campaign_slot_bookings WHERE display_type_id = ? AND slot = 1 AND window_start = ?').get(dtId, w2)
    const won = d.prepare("SELECT COUNT(*) AS n FROM reservations WHERE position_id = ? AND window_start = ? AND status IN ('won','reserved')").get(handover.positionId, w2) as { n: number }
    const run = d.prepare('SELECT * FROM auction_runs WHERE window_start = ?').get(w2)
    record('L6', 'a window with no eligible bid: auction runs, no winner, no booking', !!run && won.n === 0 && !bk, 'auction run, 0 won, no booking', JSON.stringify({ auctioned: !!run, won: won.n, booking: bk ?? null, tick: tick3.trim().split('\n').slice(-1)[0] }))
    setClock(new Date(Date.parse(w2) + 24 * 3_600_000 + 60_000))
    await tick()
    const li = d.prepare('SELECT COUNT(*) AS n FROM billing_line_items WHERE position_id = ? AND window_start = ?').get(handover.positionId, w2) as { n: number }
    record('L6b', 'nobody is billed for the fall-through window', li.n === 0, '0 line items', String(li.n))
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
