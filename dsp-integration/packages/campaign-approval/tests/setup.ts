import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

/* DOM shims for the component tests (jsdom only). */
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => cleanup())
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
  })
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO
  const gcs = window.getComputedStyle.bind(window)
  window.getComputedStyle = ((elt: Element) => gcs(elt)) as typeof window.getComputedStyle
}
