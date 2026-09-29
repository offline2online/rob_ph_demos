/* The Billing module's boundary (PH-CORE-BOUNDARIES.md → "Billing"): only
   its two public entry points are imported from outside, and it never
   builds its own database or platform source — context.ts is the only
   wiring point. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', 'src')
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []))
const importsOf = (f: string) => [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1])

describe('billing module boundary', () => {
  it('is imported from outside only through billing or billing/term', () => {
    const bad = files(SRC).filter((f) => !f.startsWith(join(SRC, 'billing'))).flatMap((f) => importsOf(f)
      .filter((i) => /(^|\/)billing\/(?!term$)[^']+$/.test(i))
      .map((i) => `${relative(SRC, f)} imports ${i}`))
    expect(bad).toEqual([])
  })

  it('never constructs a database or a platform source itself', () => {
    const bad = files(join(SRC, 'billing')).filter((f) => /sqlite[A-Z]\w*Source|DatabaseSync|openDb/.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f))
    expect(bad).toEqual([])
  })
})
