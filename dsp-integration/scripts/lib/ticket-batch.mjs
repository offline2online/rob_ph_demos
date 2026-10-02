/* Several ticket moves in one board-tickets.mjs run (yiieGT0gynTXo0o8F4O8,
   2 Oct 2026). dsp-board.yml runs share one concurrency group, and GitHub
   keeps only one PENDING run per group: dispatching three moves in a row
   silently cancelled the middle one. One run applying a list is the safe
   way to move several cards.

   Entries are separated by commas or newlines:  id[:status][@sha]
     abc123                       nothing to change (rejected)
     abc123:ready-for-testing     move it
     abc123@0f0c6c0…              stamp its deployCommit
     abc123:ready-to-publish@0f0c6c0…   both */
export function parseTicketBatch(text, statuses) {
  const entries = []
  const errors = []
  for (const raw of String(text ?? '').split(/[\n,]+/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z0-9]{6,40})(?::([a-z-]+))?(?:@([0-9a-f]{7,40}))?$/)
    if (!m) { errors.push(`"${line}": expected id[:status][@sha]`); continue }
    const [, id, to, sha] = m
    if (to && !statuses[to]) { errors.push(`"${line}": unknown status ${to} (one of ${Object.keys(statuses).join(', ')})`); continue }
    if (!to && !sha) { errors.push(`"${line}": nothing to change — give :status and/or @sha`); continue }
    if (entries.some((e) => e.id === id)) { errors.push(`"${line}": ${id} appears twice`); continue }
    entries.push({ id, to: to || undefined, deployCommit: sha || undefined })
  }
  return { entries, errors }
}
