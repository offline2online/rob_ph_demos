/* scripts/lib/ticket-batch.mjs: the list dsp-board.yml's `tickets` input
   passes to board-tickets.mjs (yiieGT0gynTXo0o8F4O8). */
import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs helper with no type declarations
import { parseTicketBatch } from '../../../scripts/lib/ticket-batch.mjs'

const STATUSES = { 'backlog': 'Backlog', 'ready-for-testing': 'Ready for Testing', 'ready-to-publish': 'Approved for Deployment', 'published-live': 'Live', 'archived': 'Archived' }
const SHA = '014c264e0487eeb3cf3d3036c92dd5e79d1178c4'

describe('parseTicketBatch', () => {
  it('reads id:status@sha entries separated by commas or newlines', () => {
    const { entries, errors } = parseTicketBatch(`pwGKh6gfIKq8O7A1ymP6:ready-for-testing@${SHA},\n rec5vaJCQaid5jXHCQK5@${SHA.slice(0, 7)}\nmlIoc3zzhFMjCydeF0Qx:ready-to-publish`, STATUSES)
    expect(errors).toEqual([])
    expect(entries).toEqual([
      { id: 'pwGKh6gfIKq8O7A1ymP6', to: 'ready-for-testing', deployCommit: SHA },
      { id: 'rec5vaJCQaid5jXHCQK5', to: undefined, deployCommit: SHA.slice(0, 7) },
      { id: 'mlIoc3zzhFMjCydeF0Qx', to: 'ready-to-publish', deployCommit: undefined },
    ])
  })

  it('refuses a bad status, an entry with nothing to change, a duplicate and junk — naming each', () => {
    const { entries, errors } = parseTicketBatch('aaaaaaaa:shipped, bbbbbbbb, cccccccc:backlog, cccccccc:archived, not an id!', STATUSES)
    expect(entries).toEqual([{ id: 'cccccccc', to: 'backlog', deployCommit: undefined }])
    expect(errors).toHaveLength(4)
    expect(errors.join('\n')).toMatch(/unknown status shipped/)
    expect(errors.join('\n')).toMatch(/nothing to change/)
    expect(errors.join('\n')).toMatch(/appears twice/)
    expect(errors.join('\n')).toMatch(/expected id\[:status\]\[@sha\]/)
  })

  it('treats an empty input as no entries', () => {
    expect(parseTicketBatch('', STATUSES)).toEqual({ entries: [], errors: [] })
    expect(parseTicketBatch(undefined, STATUSES)).toEqual({ entries: [], errors: [] })
  })
})
