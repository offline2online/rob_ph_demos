/* The bench gate's comparison, pure so it can be tested (gate.ts runs the
   shapes and writes the results). One case per metric: the case ids are
   `bench:<shape>:<label>:<rps|p50|ms>`; file-e2e-bugs files one ticket per
   shape, not per metric (see gate.ts and bug-plan.mjs). */
export interface Shape { args: string; note: string; rps: Record<string, number>; p50: Record<string, number>; ms: Record<string, number> }
export type Kind = 'rps' | 'p50' | 'ms'
export interface BenchCase { caseId: string; id: string; run: 'Bench'; title: string; status: 'pass' | 'fail'; expected: string; actual: string; repro: string; shape: string; label: string; kind: Kind; baseline?: number; value?: number; runs?: number[] }

/* Metric keys are the bench's labels; the reservations label carries counts, so match it by prefix. */
export const metric = (m: Record<string, number>, label: string, kind: string) => {
  const key = Object.keys(m).find((k) => k.endsWith(`|${kind}`) && (k.startsWith(`${label}|`) || k.startsWith(label)))
  return key === undefined ? undefined : m[key]
}

export const reproFor = (shape: string) => `npm run bench -- --assert --shapes=${shape}`

export function compare(name: string, shape: Shape, base: Shape, m: Record<string, number>, tol: number): { cases: BenchCase[]; measured: Shape } {
  const measured: Shape = { args: shape.args, note: shape.note, rps: {}, p50: {}, ms: {} }
  const cases: BenchCase[] = []
  const add = (kind: Kind, label: string, v: number | undefined, required: boolean) => {
    if (v === undefined && !required) return
    const b = base[kind][label] ?? shape[kind][label]
    const unit = kind === 'rps' ? 'req/s' : 'ms'
    const bound = kind === 'rps' ? b * (1 - tol) : b * (1 + tol)
    const prefix = kind === 'p50' ? 'p50 ' : ''
    const c = { caseId: `bench:${name}:${label}:${kind}`, run: 'Bench' as const, shape: name, label, kind, repro: reproFor(name), baseline: b }
    if (v === undefined) {
      cases.push({ ...c, id: c.caseId, title: `Perf: ${name} ${label} — ${prefix}not measured`, status: 'fail', expected: `${kind === 'rps' ? '≥' : '≤'} ${+bound.toFixed(1)} ${unit}`, actual: 'not measured' })
      return
    }
    measured[kind][label] = v
    const fail = kind === 'rps' ? v < bound : v > bound
    cases.push({ ...c, id: c.caseId, value: v, title: `Perf: ${name} ${label} — ${prefix}${b} → ${v} ${unit}`, status: fail ? 'fail' : 'pass', expected: `${kind === 'rps' ? '≥' : '≤'} ${+bound.toFixed(1)} ${unit}`, actual: `${v} ${unit}` })
  }
  for (const label of Object.keys(shape.rps)) add('rps', label, metric(m, label, 'rps'), true)
  for (const label of Object.keys(shape.p50)) add('p50', label, metric(m, label, 'p50'), false)
  for (const label of Object.keys(shape.ms)) add('ms', label, metric(m, label, 'ms'), true)
  return { cases, measured }
}

/* A breach is confirmed only if it repeats (ticket YLWwUhbyeGDuQxJYQPeZ,
   23 Nov 2026). One 3-second run of a ~10 ms CPU-bound endpoint at 32
   clients is ~300 samples with GC stalls in its tail, and identical runs on
   one machine differed by ~30% (shape A ?status=available p50 231.6 vs
   320.9 ms) — as wide as the 25% tolerance, so a single run filed tickets
   for noise. gate.ts re-runs a shape that breached once and passes both
   runs' cases here: a metric fails only if it failed in both, and reports
   the better of the two values; `runs` keeps both so the retry is visible.
   A metric missing from the retry (it crashed) keeps the first result. */
export function confirmBreaches(first: BenchCase[], retry: BenchCase[]): BenchCase[] {
  const again = new Map(retry.map((c) => [c.caseId, c]))
  return first.map((c) => {
    const r = again.get(c.caseId)
    if (c.status === 'pass' || !r) return c
    const runs = [c.value, r.value].filter((v): v is number => v !== undefined)
    if (r.status === 'pass') return { ...r, runs }
    const better = c.value === undefined ? r : r.value === undefined ? c : (c.kind === 'rps' ? r.value > c.value : r.value < c.value) ? r : c
    return { ...better, runs }
  })
}
