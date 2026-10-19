/* The bench as a regression gate (E2E Testing Strategy §3.7).

     npm run bench -- --assert              # every shape in thresholds.json; exit 1 on a breach or a crash
     npm run bench -- --assert --shapes=A,T # some shapes
     npm run bench -- --calibrate           # measure this machine, write bench/baseline.local.json
     npm run bench -- --assert --seconds=1  # quicker, less precise (any load.ts arg passes through)

   Each shape runs bench/load.ts in its own process with --json, then every
   number is compared with the threshold (bench/compare.ts): req/s must not
   fall below threshold × (1 − tolerance), a latency must not rise above
   threshold × (1 + tolerance). Thresholds are the committed numbers
   (24 Sep 2026 review) unless bench/baseline.local.json exists, in which
   case this machine's own calibration is the baseline — CI calibrates once
   per runner image. A shape whose load.ts exits non-zero is recorded as a
   `bench:<shape>:crash` failure and the next shape still runs.

   --assert writes results/bench.json ({run: "Bench", command, commit,
   startedAt, cases}) and results/cases/bench.json (the same cases as a bare
   array, for e2e-run.mjs), deleting both first so a crashed gate can't leave
   a stale pass. file-e2e-bugs files the failures as one ticket per shape:
   "Perf: <shape> — <n> breaches; worst: <title>" or "Perf: <shape> bench
   crashed — <actual>". */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, reproFor, type BenchCase, type Shape } from './compare'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(DIR, '../../..')
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
  p.on('error', rej)
  p.on('exit', (code, signal) => {
    if (code !== 0) return rej(new Error(code === 134 ? 'load.ts exited 134 — out of memory' : `load.ts exited ${code ?? `by ${signal}`}`))
    try { res(JSON.parse(readFileSync(out, 'utf8')).metrics) } catch (e) { rej(new Error(`load.ts wrote no results: ${(e as Error).message}`)) }
  })
})

const RESULTS = join(ROOT, 'results')
const OUT_FILES = [join(RESULTS, 'bench.json'), join(RESULTS, 'cases', 'bench.json')]
if (!calibrate) for (const f of OUT_FILES) rmSync(f, { force: true })
const startedAt = new Date().toISOString()

const measured: Record<string, Shape> = {}
const cases: BenchCase[] = []
const tol = thresholds.tolerance
for (const name of names) {
  const shape = thresholds.shapes[name]
  const base = baseline.shapes[name] ?? shape
  console.log(`\nShape ${name} — ${shape.note}\n  ${shape.args} ${thresholds.args} ${passthrough.join(' ')}`)
  let m: Record<string, number>
  try {
    m = await run([...shape.args.split(' '), ...thresholds.args.split(' '), ...passthrough])
  } catch (e) {
    const actual = (e as Error).message
    console.log(`  ${name} crashed: ${actual}`)
    const caseId = `bench:${name}:crash`
    cases.push({ caseId, id: caseId, run: 'Bench', shape: name, label: 'crash', kind: 'ms', title: `Perf: ${name} bench crashed — ${actual}`, status: 'fail', expected: 'load.ts exits 0 and writes its metrics', actual, repro: reproFor(name) })
    continue
  }
  const r = compare(name, shape, base, m, tol)
  cases.push(...r.cases)
  measured[name] = r.measured
}
const breaches = cases.filter((c) => c.status === 'fail').map((c) => (c.label === 'crash' ? `${c.shape}: ${c.actual}` : c.actual === 'not measured' ? `${c.shape}: ${c.label} ${c.kind} not measured` : c.title))

if (calibrate) {
  if (cases.some((c) => c.label === 'crash')) { console.error('\nA shape crashed: not writing a partial baseline.'); process.exit(1) }
  writeFileSync(BASELINE, JSON.stringify({ _about: `Calibrated ${new Date().toISOString()} on this machine by npm run bench -- --calibrate; --assert compares against this instead of thresholds.json. Not committed.`, tolerance: tol, args: thresholds.args, shapes: measured }, null, 2) + '\n')
  console.log(`\nWrote ${BASELINE}.`)
  process.exit(0)
}
if (!calibrate) {
  mkdirSync(join(RESULTS, 'cases'), { recursive: true })
  const commit = process.env.GITHUB_SHA ?? null
  writeFileSync(OUT_FILES[0], JSON.stringify({ run: 'Bench', command: `npm run bench -- --assert${shapesArg ? ` --shapes=${shapesArg}` : ''}`, commit, startedAt, cases }, null, 2) + '\n')
  writeFileSync(OUT_FILES[1], JSON.stringify(cases, null, 2) + '\n')
}
console.log(breaches.length ? `\n${breaches.length} breach${breaches.length === 1 ? '' : 'es'}:\n  ${breaches.join('\n  ')}` : `\nAll ${names.length} shape${names.length === 1 ? '' : 's'} inside ±${tol * 100}% of the baseline.`)
process.exit(breaches.length ? 1 : 0)
