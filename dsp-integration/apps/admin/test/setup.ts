import '@testing-library/jest-dom/vitest'
import { createRequire } from 'node:module'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => cleanup())

/* jsdom lacks these; Ant Design and AG Grid use them. */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
})
class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO

/* jsdom's getComputedStyle has no pseudo-element support; Ant Design asks. */
const gcs = window.getComputedStyle.bind(window)
window.getComputedStyle = ((elt: Element) => gcs(elt)) as typeof window.getComputedStyle

/* React Router's data routers build a fetch Request with jsdom's AbortSignal,
   which Node's Request rejects. Test-only: drop the signal. */
const NodeRequest = globalThis.Request
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal: _signal, ...rest } = init ?? {}
    super(input, rest)
  }
} as typeof Request

/* jsdom's getComputedStyle matches every CSS rule on the page against the
   element, through nwsapi, which keeps compiled selectors in an LRU cache of
   1,000. Ant Design's CSS-in-JS and jsdom's default sheet come to about 2,000
   selectors, walked in the same order on every call, so that cache missed
   every time and each call recompiled all of them: 72% of a profiled test,
   and dsp-integration.test.tsx took 26 minutes of e2e-quick (26 Oct 2026).
   The selectors are spread over several nwsapi instances, each with its own
   cache of 1,000, so all of them stay compiled. Same engine and settings as
   jsdom's own, so the same answers. If jsdom stops matching through
   _nwsapiDontThrow this does nothing and the suite is only slow again. */
{
  const fromJsdom = createRequire(createRequire(import.meta.url).resolve('jsdom'))
  const nwsapi = fromJsdom('nwsapi')
  const doc = fromJsdom('./jsdom/living/generated/utils.js').implForWrapper(document)
  const SHARDS = 8
  const engines = Array.from({ length: SHARDS }, () => {
    const engine = nwsapi({ document, DOMException: window.DOMException })
    engine.configure({ LOGERRORS: false, VERBOSITY: false, IDS_DUPES: true, MIXEDCASE: true })
    return engine
  })
  const shardOf = (selector: unknown) => {
    if (typeof selector !== 'string') return 0
    let h = 0
    for (let i = 0; i < selector.length; i++) h = (h * 31 + selector.charCodeAt(i)) | 0
    return (h >>> 0) % SHARDS
  }
  if (doc) {
    doc._nwsapiDontThrow = { match: (selector: string, element: Element) => engines[shardOf(selector)].match(selector, element) }
  }
}
