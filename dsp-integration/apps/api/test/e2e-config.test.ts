/* e2e.config.json is read by backlog-tracker/scripts/e2e-run.mjs: a command naming a script package.json lacks is skipped silently. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../../..')
const cfg = JSON.parse(readFileSync(join(ROOT, 'e2e.config.json'), 'utf8')) as { steps: { id: string; cmd: string; cases?: string }[]; report: string; fileBugs: string }
const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts

describe('e2e.config.json', () => {
  it('only names npm scripts that exist', () => {
    for (const cmd of [...cfg.steps.map((s) => s.cmd), cfg.report, cfg.fileBugs]) {
      const name = /^npm run ([\w:.-]+)/.exec(cmd)?.[1]
      if (!name) continue // e2e-run runs anything that isn't `npm run <script>` as given
      expect(scripts[name], cmd).toBeTruthy()
    }
  })
  it('keeps every cases file under results/cases/', () => {
    for (const s of cfg.steps) if (s.cases) expect(s.cases, s.id).toMatch(/^results\/cases\/[\w.-]+\.json$/)
  })
})
