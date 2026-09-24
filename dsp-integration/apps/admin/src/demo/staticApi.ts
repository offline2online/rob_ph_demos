/* The hosted demo (Rob, 21 Sep): the same admin UI, opened from a URL and
   dropped into an iframe in HQ Admin. Only built when VITE_DEMO=1.

   Two ways it answers the API, decided once at start-up:
   - LIVE (Rob, 23 Sep): when the build names the hosted API (VITE_API_URL,
     the Cloud Function in deploy/firebase/) and it answers, every /api call
     goes there — reads and saves are real and shared by everyone using the
     link.
   - SNAPSHOT: otherwise (no URL in the build, or the API unreachable) it
     answers reads from the snapshot `scripts/capture-demo.mjs` took, and
     **refuses writes** — the screens are real, the data is a photograph,
     and a Save that silently did nothing would be worse than one that says
     so. So the link keeps working even with the API down. */
import type { ApiError } from '@ph-dsp/types'
import { demoMode } from './mode'

/* A cold start restores the database from storage first; allow for it. */
const LIVE_PROBE_TIMEOUT_MS = 20_000

interface Snapshot { capturedAt: string; routes: Record<string, unknown> }

const READ_ONLY: ApiError = {
  error: { code: 'forbidden', message: 'This is the hosted demo: the screens are live but the data is a snapshot, so changes aren’t saved. Run the POC locally to change anything.' },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/* The URL the snapshot was captured under, e.g. "/admin/v1/session". */
const apiPath = (url: string) => {
  const u = new URL(url, location.href)
  return u.pathname.replace(/^.*\/api/, '') + u.search
}

/* This app's API calls are relative (`/api/admin/v1/…`), which on GitHub
   Pages would ask Pages. Send them to the hosted API instead. */
function installLiveApi(base: string) {
  const real = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!/\/api\/(admin\/)?v1\//.test(url)) return real(input as RequestInfo, init)
    const target = base + '/api' + apiPath(url)
    return input instanceof Request ? real(new Request(target, input), init) : real(target, init)
  }
}

async function liveApiAnswers(base: string) {
  try {
    const res = await fetch(`${base}/api/admin/v1/session`, { signal: AbortSignal.timeout(LIVE_PROBE_TIMEOUT_MS) })
    return res.ok
  } catch {
    return false
  }
}

export async function installStaticApi() {
  const live = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
  if (live && (await liveApiAnswers(live))) return installLiveApi(live)
  demoMode.snapshot = true

  const res = await fetch(new URL('demo/api-snapshot.json', document.baseURI))
  const snap = (await res.json()) as Snapshot

  /* Pin the clock to the capture, so the schedule asks for the range the
     snapshot actually holds and every "today" on screen agrees with it. */
  const fixed = Date.parse(snap.capturedAt)
  const RealDate = Date
  const Pinned = class extends RealDate {
    constructor(...args: unknown[]) {
      /* new Date() means "now", which here is the capture. */
      super(...((args.length ? args : [fixed]) as [number]))
    }
    static now() {
      return fixed
    }
  }
  globalThis.Date = Pinned as unknown as DateConstructor

  const real = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    /* Anything that isn't this app's API — fonts, creatives — goes out as usual. */
    if (!/\/api\/admin\/v1\//.test(url)) return real(input as RequestInfo, init)
    if (method !== 'GET') return json(READ_ONLY, 403)

    const path = apiPath(url)
    const hit = snap.routes[path] ?? snap.routes[path.split('?')[0]]
    if (hit !== undefined) return json(hit)
    /* A range or an id the capture didn't cover: say so in the contract's shape. */
    return json({ error: { code: 'not_found', message: `Not in the demo snapshot: ${path}` } } satisfies ApiError, 404)
  }
}
