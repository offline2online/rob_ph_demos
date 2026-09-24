/* Two real API processes on one database file (stability review, 24 Sep
   2026): what two replicas sharing a volume, or the API beside a CronJob
   tick, actually do when the same bid lands on both at once and when three
   ticks see the same cutoff pass. The in-process tests can't interleave
   SQLite writes; separate processes can. Real clock, real sockets, the
   seed's estate; the DSP bidders are unreachable (no bid is no failure).

   Skipped in the two minutes around midnight UTC, when "the next window's
   cutoff a minute ago" can't be expressed with a daily cutoff time. */
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const API = fileURLToPath(new URL('../', import.meta.url))
const TSX = join(ROOT, 'node_modules/.bin/tsx')
const GOOGLE = { authorization: 'Bearer poc-token-google-dv360', 'content-type': 'application/json' }
const POS = 'menu_board.s2'

const minuteOfDay = new Date().getUTCHours() * 60 + new Date().getUTCMinutes()
const nearMidnight = minuteOfDay >= 23 * 60 + 57 || minuteOfDay <= 2

const dir = mkdtempSync(join(tmpdir(), 'ph-multi-'))
const env = {
  ...process.env, PH_DB_FILE: join(dir, 'poc.sqlite'), PH_ASSETS_DIR: join(dir, 'assets'), PH_SCHEDULER: 'off', API_HOST: '127.0.0.1',
  DSP_INTEGRATION_ENABLED: 'true', DSP_MOCKS_URL: 'http://127.0.0.1:9', PH_SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'),
  PARTNER_RATE_PER_SECOND: '100000', PARTNER_RATE_BURST: '100000', NODE_OPTIONS: '--no-warnings',
}
const children: ChildProcess[] = []
const output = new Map<ChildProcess, string[]>()
const run = (args: string[], extra: Record<string, string> = {}) => {
  const child = spawn(TSX, args, { cwd: API, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] })
  const lines: string[] = []
  output.set(child, lines)
  child.stdout!.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)))
  child.stderr!.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)))
  children.push(child)
  return child
}
const exited = (child: ChildProcess) => new Promise<number | null>((resolve) => (child.exitCode !== null ? resolve(child.exitCode) : child.once('exit', resolve)))
const ready = async (port: number) => {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/readyz`)).status === 200) return
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`API on ${port} never became ready`)
}
const api = (port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = GOOGLE) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

afterAll(async () => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM')
  await Promise.all(children.map(exited))
})

describe.skipIf(nearMidnight)('two API processes and three ticks on one database', () => {
  const ports = [41000 + Math.floor(Math.random() * 10_000), 51000 + Math.floor(Math.random() * 10_000)]
  const settings = async (port: number, patch: Record<string, unknown>) => {
    const current = await (await api(port, 'GET', '/api/admin/v1/advertiser-settings', undefined, {})).json() as Record<string, unknown>
    delete current.whereTheseApply
    const res = await api(port, 'PUT', '/api/admin/v1/advertiser-settings', { ...current, ...patch }, { 'content-type': 'application/json' })
    expect(res.status, await res.text()).toBe(200)
    /* The other process reads company settings from a 1 s snapshot. */
    await new Promise((r) => setTimeout(r, 1200))
  }
  let window = ''
  let swisseId = ''
  let nestleId = ''

  it('start, and the second process finds the first one’s database migrated and seeded', async () => {
    const [a, b] = [run(['src/index.ts'], { API_PORT: String(ports[0]) }), run(['src/index.ts'], { API_PORT: String(ports[1]) })]
    await Promise.all([ready(ports[0]), ready(ports[1])])
    expect([a.exitCode, b.exitCode]).toEqual([null, null])
    expect((await (await api(ports[1], 'GET', '/api/v1/inventory')).json()).items.map((i: { positionId: string }) => i.positionId)).toContain(POS)
  }, 60_000)

  it('the same bid on both processes at once: one advertiser holds one bid, whichever process took it', async () => {
    /* Bidding for the next window closes at a cutoff two minutes from now. */
    const cutoff = new Date(Date.now() + 2 * 60_000)
    const w = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate() + 1))
    window = w.toISOString()
    await settings(ports[0], { auctionCutoffTime: hhmm(cutoff), auctionOpensHours: 168 })
    /* A fresh database carries the sample bookings, which may hold this
       window already; clear it so it is for sale. */
    const db = new DatabaseSync(env.PH_DB_FILE)
    db.prepare('DELETE FROM reservations WHERE position_id = ? AND window_start = ?').run(POS, window)
    db.prepare("DELETE FROM campaign_slot_bookings WHERE display_type_id = 'menu_board' AND slot = 2 AND window_start = ?").run(window)
    db.close()
    for (const id of ['c_api_swisse']) {
      expect((await api(ports[0], 'POST', `/api/admin/v1/campaigns/${id}/approve`, { assetVersion: 'v1' }, { 'content-type': 'application/json' })).status).toBeLessThan(300)
      expect((await api(ports[1], 'PUT', `/api/admin/v1/campaigns/${id}/activation`, { enabled: true }, { 'content-type': 'application/json' })).status).toBeLessThan(300)
    }
    const bid = (port: number, body: Record<string, unknown>) => api(port, 'POST', '/api/v1/reservations', { positionId: POS, windowStart: window, type: 'bid', ...body })
    const swisse = { campaignId: 'c_api_swisse', advertiserId: 'swisse', bidCpm: 200 }
    const nestle = { campaignId: 'c_dsp_nestle', advertiserId: 'nestle', bidCpm: 150 }
    const res = await Promise.all(Array.from({ length: 16 }, (_, i) => bid(ports[i % 2], swisse)))
    const codes = res.map((r) => r.status).sort()
    expect(codes, await res[0].clone().text()).toEqual([201, ...Array(15).fill(409)])
    swisseId = (await res.find((r) => r.status === 201)!.json()).reservationId
    for (const r of res.filter((x) => x.status === 409)) expect((await r.json()).error.message).toBe('This advertiser already has a reservation or bid for that window.')
    const other = await Promise.all([bid(ports[0], nestle), bid(ports[1], nestle)])
    expect(other.map((r) => r.status).sort()).toEqual([201, 409])
    nestleId = (await other.find((r) => r.status === 201)!.json()).reservationId
    /* Both processes see both bids. */
    for (const port of ports) {
      expect((await (await api(port, 'GET', `/api/v1/reservations/${swisseId}`)).json()).status).toBe('pending')
      expect((await (await api(port, 'GET', `/api/v1/reservations/${nestleId}`)).json()).status).toBe('pending')
    }
  }, 60_000)

  it('three ticks seeing the cutoff pass at once auction the window once; the fourth finds nothing to do', async () => {
    await settings(ports[1], { auctionCutoffTime: hhmm(new Date(Date.now() - 60_000)) })
    const ticks = [run(['src/exchange/tickCli.ts']), run(['src/exchange/tickCli.ts']), run(['src/exchange/tickCli.ts'])]
    const codes = await Promise.all(ticks.map(exited))
    const lines = ticks.flatMap((t) => output.get(t)!)
    expect(codes, lines.join('\n')).toEqual([0, 0, 0])
    expect(lines.filter((l) => l.startsWith('Auction cleared')), lines.join('\n')).toHaveLength(1)
    expect(lines.filter((l) => /failed/i.test(l))).toEqual([])
    for (const port of ports) {
      expect((await (await api(port, 'GET', `/api/v1/reservations/${swisseId}`)).json())).toMatchObject({ status: 'won', clearingCpm: 200 })
      expect((await (await api(port, 'GET', `/api/v1/reservations/${nestleId}`)).json())).toMatchObject({ status: 'lost', reason: 'Outbid: the window cleared at 200 AUD CPM.' })
    }
    const db = new DatabaseSync(env.PH_DB_FILE, { readOnly: true })
    expect(db.prepare('SELECT window_start, finished_at FROM auction_runs').all()).toMatchObject([{ window_start: window, finished_at: expect.any(String) }])
    expect((db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE position_id = ? AND window_start = ? AND status IN ('won', 'reserved') AND test_mode = 0").get(POS, window) as { n: number }).n).toBe(1)
    db.close()
    /* A late bid, after the auction: refused, and nothing is left pending. */
    const late = await api(ports[0], 'POST', '/api/v1/reservations', { positionId: POS, windowStart: window, type: 'bid', campaignId: 'c_api_swisse', advertiserId: 'swisse', bidCpm: 300 })
    expect(late.status).toBe(409)
    const again = run(['src/exchange/tickCli.ts'])
    expect(await exited(again)).toBe(0)
    expect(output.get(again)!.filter((l) => l.startsWith('Auction cleared'))).toHaveLength(0)
  }, 90_000)

  it('SIGTERM stops each process cleanly and leaves the database consistent', async () => {
    const apis = children.slice(0, 2)
    for (const c of apis) c.kill('SIGTERM')
    expect(await Promise.all(apis.map(exited))).toEqual([0, 0])
    const db = new DatabaseSync(env.PH_DB_FILE, { readOnly: true })
    expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    db.close()
  }, 30_000)
})
