/* The bench as a regression gate (E2E Testing Strategy §3.7).

     npm run bench -- --assert              # every shape in thresholds.json; exit 1 on a breach
     npm run bench -- --assert --shapes=A,T # some shapes
     npm run bench -- --calibrate           # measure this machine, write bench/baseline.local.json
     npm run bench -- --assert --seconds=1  # quicker, less precise (any load.ts arg passes through)

   Each shape runs bench/load.ts in its own process with --json, then every
   number is compared with the threshold: req/s must not fall below
   threshold × (1 − tolerance), a latency must not rise above threshold ×
   (1 + tolerance). Thresholds are the committed numbers (24 Sep 2026 review)
   unless bench/baseline.local.json exists, in which case this machine's own
   calibration is the baseline — CI calibrates once per runner image. A
   breach names the shape and the endpoint, which is what file-e2e-bugs
   files as "Perf: <shape> <endpoint> — <before> → <after>". */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(DIR, '../../..')
interface Shape { args: string; note: string; rps: Record<string, number>; p50: Record<string, number>; ms: Record<string, number> }
interface Thresholds { tolerance: number; args: string; shapes: Record<string, Shape> }
const thresholds = JSON.parse(readFileSync(join(DIR, 'thresholds.json'), 'utf8')) as Thresholds
const BASELINE = join(DIR, 'baseline.local.json')
const argv = process.argv.slice(2)
const calibrate = argv.includes('--calibrate')
const shapesArg = argv.find((a) => a.startsWith('--shapes='))?.slice(9)
const passthrough = argv.filter((a) => !['--assert', '--calibrate'].includes(a) && !a.startsWith('--shapes='))
const names = (shapesArg ? shapesArg.split(',') : Object.keys(thresholds.shapes)).filter((n) => thresholds.shapes[n])

const baseline: Thresholds = !calibrate && existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : thresholds
if (baseline !== thresholds) console.log(`Baseline: bench/baseline.local.json (calibrated on this machine). Delete it to compare with the committed thresholds.`)

const run = (args: string[]) => new Promise<Record<string, number>>((res, rej) => {
  const out = mkdtempSync(join(tmpdir(), 'ph-gate-')) + '/bench.json'
  const p = spawn(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(DIR, 'load.ts'), ...args, `--json=${out}`], { cwd: DIR, stdio: ['ignore', 'pipe', 'inherit'] })
  p.stdout.on('data', (d) => process.stdout.write(`    ${String(d).replace(/\n(?!$)/g, '\n    ')}`))
  p.on('exit', (code) => (code === 0 ? res(JSON.parse(readFileSync(out, 'utf8')).metrics) : rej(new Error(`load.ts exited ${code}`))))
})
/* Metric keys are the bench's labels; the reservations label carries counts, so match it by prefix. */
const metric = (m: Record<string, number>, label: string, kind: string) => {
  const key = Object.keys(m).find((k) => k.endsWith(`|${kind}`) && (k.startsWith(`${label}|`) || k.startsWith(label)))
  return key === undefined ? undefined : m[key]
}

const measured: Record<string, Shape> = {}
const breaches: string[] = []
const tol = thresholds.tolerance
for (const name of names) {
  const shape = thresholds.shapes[name]
  const base = baseline.shapes[name] ?? shape
  console.log(`\nShape ${name} — ${shape.note}\n  ${shape.args} ${thresholds.args} ${passthrough.join(' ')}`)
  const m = await run([...shape.args.split(' '), ...thresholds.args.split(' '), ...passthrough])
  const got: Shape = { args: shape.args, note: shape.note, rps: {}, p50: {}, ms: {} }
  for (const label of Object.keys(shape.rps)) {
    const v = metric(m, label, 'rps'); if (v === undefined) { breaches.push(`${name}: ${label} rps not measured`); continue }
    got.rps[label] = v
    if (v < base.rps[label] * (1 - tol)) breaches.push(`Perf: ${name} ${label} — ${base.rps[label]} → ${v} req/s`)
  }
  for (const label of Object.keys(shape.p50)) {
    const v = metric(m, label, 'p50'); if (v === undefined) continue
    got.p50[label] = v
    if (v > base.p50[label] * (1 + tol)) breaches.push(`Perf: ${name} ${label} — p50 ${base.p50[label]} → ${v} ms`)
  }
  for (const label of Object.keys(shape.ms)) {
    const v = metric(m, label, 'ms'); if (v === undefined) { breaches.push(`${name}: ${label} not measured`); continue }
    got.ms[label] = v
    if (v > base.ms[label] * (1 + tol)) breaches.push(`Perf: ${name} ${label} — ${base.ms[label]} → ${v} ms`)
  }
  measured[name] = got
}

if (calibrate) {
  writeFileSync(BASELINE, JSON.stringify({ _about: `Calibrated ${new Date().toISOString()} on this machine by npm run bench -- --calibrate; --assert compares against this instead of thresholds.json. Not committed.`, tolerance: tol, args: thresholds.args, shapes: measured }, null, 2) + '\n')
  console.log(`\nWrote ${BASELINE}.`)
  process.exit(0)
}
console.log(breaches.length ? `\n${breaches.length} breach${breaches.length === 1 ? '' : 'es'}:\n  ${breaches.join('\n  ')}` : `\nAll ${names.length} shape${names.length === 1 ? '' : 's'} inside ±${tol * 100}% of the baseline.`)
process.exit(breaches.length ? 1 : 0)
