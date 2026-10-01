/* Every `it.fails(` in test/e2e must name a backlog ticket id (20 chars) in
   its title or the line above it, and — with BOARD_API_KEY — that ticket
   must still be open (E2E Testing Strategy §3.8). A closed ticket means
   the bug is fixed and the marker should be flipped back to `it(`. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, connect } from './lib/board.mjs'

const dir = join(ROOT, 'apps/api/test/e2e')
const problems = []
const refs = []
for (const f of readdirSync(dir).filter((f) => f.endsWith('.test.ts'))) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n')
  lines.forEach((l, i) => {
    if (!/\bit\.fails\(/.test(l)) return
    const window = [lines[i - 1] ?? '', l, lines[i + 1] ?? ''].join(' ')
    const id = window.match(/\b[A-Za-z0-9]{20}\b/)?.[0]
    if (!id) problems.push(`${f}:${i + 1} it.fails without a ticket id`)
    else refs.push({ file: `${f}:${i + 1}`, id })
  })
}
const board = await connect()
if (board) {
  const tickets = await board.tickets()
  for (const r of refs) {
    const t = tickets.find((t) => t.id === r.id)
    if (!t) problems.push(`${r.file} references ${r.id}, which is not on the project`)
    else if (['published-live', 'archived'].includes(t.status)) problems.push(`${r.file} references ${r.id}, which is ${t.status}: flip it.fails back to it`)
  }
} else console.log('BOARD_API_KEY not set: checked ids are present, not that they are open.')
console.log(`${refs.length} it.fails marker${refs.length === 1 ? '' : 's'}, ${problems.length} problem${problems.length === 1 ? '' : 's'}.`)
for (const p of problems) console.log(`  ${p}`)
process.exit(problems.length ? 1 : 0)
