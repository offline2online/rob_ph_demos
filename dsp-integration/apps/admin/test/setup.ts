import '@testing-library/jest-dom/vitest'
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
