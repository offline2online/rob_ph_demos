/* scripts/lib/board-rules.mjs: the board's rules for scripts that move cards
   when nobody clicks the board (board-tickets.mjs, lib/board.mjs). */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs helper with no type declarations
import * as rules from '../../../scripts/lib/board-rules.mjs'

const DOC = 'projects/p/databases/(default)/documents/backlogItems/abc'
const FULL = 'a'.repeat(40)
const ROOT = resolve(__dirname, '../../..')

type Reply = { code: number; stdout?: string }
/* A stub git: `answers` maps the first matching prefix of the joined args. */
function stubGit(answers: Record<string, Reply>) {
  const calls: string[][] = []
  const git = (args: string[]): Reply => {
    calls.push(args)
    const joined = args.join(' ')
    const key = Object.keys(answers).find((k) => joined.startsWith(k))
    return { stdout: '', ...(key ? answers[key] : { code: 0 }) }
  }
  return { git, calls }
}
const onBranch = (extra: Record<string, Reply> = {}) => stubGit({
  'rev-parse --is-shallow-repository': { code: 0, stdout: 'false\n' },
  'fetch': { code: 0 },
  'rev-parse --verify': { code: 0, stdout: `${FULL}\n` },
  'merge-base': { code: 0 },
  'log': { code: 0, stdout: '' },
  ...extra,
})
const card = (over = {}) => ({ id: 'abc', title: 't', status: 'backlog', deployCommit: null, deployBranch: null, createdAt: '2026-10-10T00:00:00Z', ...over })
const project = { id: 'p', name: 'Display Types & DSP Integration', deployBranch: 'deploy/dsp-integration', trainLocked: false }

describe('atomic note writes', () => {
  it('a note alone is a transform with the exists precondition and only the new note', () => {
    const { writes } = rules.noteAppendWrite(DOC, 'hello', '2026-10-19T00:00:00Z')
    expect(writes).toHaveLength(1)
    expect(writes[0].currentDocument).toEqual({ exists: true })
    expect(writes[0].transform.document).toBe(DOC)
    const [t] = writes[0].transform.fieldTransforms
    expect(t.fieldPath).toBe('notes')
    expect(t.appendMissingElements.values).toEqual([
      { mapValue: { fields: { author: { stringValue: 'backlog-automation' }, text: { stringValue: 'hello' }, at: { stringValue: '2026-10-19T00:00:00Z' } } } },
    ])
  })

  it('a note with fields keeps notes out of the mask and appends in updateTransforms', () => {
    const { writes } = rules.noteWithFieldsWrite(DOC, { updatedAt: { timestampValue: 'x' } }, 'hi')
    expect(writes[0].updateMask.fieldPaths).toEqual(['updatedAt'])
    expect(writes[0].updateMask.fieldPaths).not.toContain('notes')
    expect(writes[0].update.fields).not.toHaveProperty('notes')
    expect(writes[0].updateTransforms[0].fieldPath).toBe('notes')
    expect(writes[0].updateTransforms[0].appendMissingElements.values).toHaveLength(1)
    expect(writes[0].currentDocument).toEqual({ exists: true })
  })

  it("refuses 'notes' as a field", () => {
    expect(() => rules.noteWithFieldsWrite(DOC, { notes: { arrayValue: {} } }, 'x')).toThrow(/notes/)
  })
})

describe('deploy commits', () => {
  it('refuses a sha that is not on the branch', () => {
    const { git } = onBranch({ 'merge-base': { code: 1 } })
    const r = rules.stampDeployCommit(git, 'aaaaaaa', card(), 'deploy/dsp-integration')
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBe(1)
    expect(r.message).toMatch(/not on origin\/deploy\/dsp-integration/)
  })

  it('exits 2 when git cannot fetch', () => {
    const { git } = onBranch({ fetch: { code: 128 } })
    const r = rules.stampDeployCommit(git, 'aaaaaaa', card(), 'deploy/dsp-integration')
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBe(2)
  })

  it('a short sha on the branch becomes the full sha with all three stamps', () => {
    const { git } = onBranch()
    const r = rules.stampDeployCommit(git, 'aaaaaaa', card({ deployBranch: 'deploy/other' }), 'deploy/dsp-integration')
    expect(r.ok).toBe(true)
    expect(r.sha).toBe(FULL)
    expect(r.fields).toEqual({ deployBranch: 'deploy/other', deployCommit: FULL })
    expect(r.appendCommit).toBe(FULL)
    const write = rules.cardWrite(DOC, { fields: rules.toFields(r.fields), appendCommit: r.appendCommit }).writes[0]
    expect(write.updateTransforms).toEqual([{ fieldPath: 'deployCommits', appendMissingElements: { values: [{ stringValue: FULL }] } }])
  })

  it('uses --shallow-since only when the repository is shallow', () => {
    const shallow = onBranch({ 'rev-parse --is-shallow-repository': { code: 0, stdout: 'true\n' } })
    rules.resolveOnBranch(shallow.git, 'aaaaaaa', 'deploy/x', { createdAt: '2026-10-10T00:00:00Z' })
    const fetchArgs = shallow.calls.find((c) => c[0] === 'fetch')!
    expect(fetchArgs).toContain('--shallow-since=2026-10-09T00:00:00.000Z')

    const full = onBranch()
    rules.resolveOnBranch(full.git, 'aaaaaaa', 'deploy/x', { createdAt: '2026-10-10T00:00:00Z' })
    expect(full.calls.find((c) => c[0] === 'fetch')!.join(' ')).not.toMatch(/shallow/)
  })
})

describe('--notify', () => {
  const backlog = [
    { id: 'a', title: 'ok', blockedReason: null },
    { id: 'b', title: 'blocked', blockedReason: 'needs-decision', blockedNote: 'which?' },
  ]
  it('refuses a locked train, and allows it with force', () => {
    const locked = { ...project, trainLocked: true }
    const no = rules.checkNotify({ wanted: 'a', backlog, project: locked })
    expect(no.ok).toBe(false)
    expect(no.messages.join(' ')).toContain("This project's train is closing. Click Ready for Dev once the train has merged.")
    const yes = rules.checkNotify({ wanted: 'a', backlog, project: locked, force: true })
    expect(yes.ok).toBe(true)
    expect(yes.messages.join(' ')).toMatch(/--force/)
  })
  it('refuses a blocked named ticket', () => {
    const r = rules.checkNotify({ wanted: 'b', backlog, project })
    expect(r.ok).toBe(false)
    expect(r.messages[0]).toMatch(/blocked/)
  })
  it('`all` skips blocked tickets, and refuses when none are left', () => {
    const r = rules.checkNotify({ wanted: null, backlog, project })
    expect(r.ok).toBe(true)
    expect(r.targets.map((t: { id: string }) => t.id)).toEqual(['a'])
    expect(r.messages.join(' ')).toMatch(/skipped b/)
    expect(rules.checkNotify({ wanted: null, backlog: [backlog[1]], project }).ok).toBe(false)
  })
})

describe('status moves', () => {
  it('published-live without proof is refused', () => {
    const { git } = onBranch({ 'merge-base': { code: 1 } })
    const r = rules.checkMove({ card: card({ status: 'ready-to-publish', deployCommit: FULL }), to: 'published-live', git, project })
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBe(1)
    expect(r.message).toMatch(/no proof/)
  })
  it('published-live is allowed with a deployCommit on main', () => {
    const { git, calls } = onBranch()
    const r = rules.checkMove({ card: card(), to: 'published-live', deployCommit: 'aaaaaaa', git, project })
    expect(r.ok).toBe(true)
    expect(r.fields).toMatchObject({ status: 'published-live', deployCommit: FULL })
    expect(calls.some((c) => c.join(' ').includes('origin/main'))).toBe(true)
  })
  it('published-live is allowed when a commit on main carries the trailer', () => {
    const { git, calls } = onBranch({ log: { code: 0, stdout: `${FULL}\n` } })
    const r = rules.checkMove({ card: card(), to: 'published-live', git, project })
    expect(r.ok).toBe(true)
    expect(calls.find((c) => c[0] === 'log')!.join(' ')).toContain('Backlog item: abc')
  })
  it('ready-to-publish is refused from backlog, and from ready-for-testing records the approver', () => {
    const { git } = onBranch()
    expect(rules.checkMove({ card: card(), to: 'ready-to-publish', git, project }).ok).toBe(false)
    const r = rules.checkMove({ card: card({ status: 'ready-for-testing' }), to: 'ready-to-publish', git, project, actor: 'rob' })
    expect(r.ok).toBe(true)
    expect(r.fields.approvedAt.timestamp).toBeTruthy()
    expect(r.fields.approvedVia).toBe('dsp-board.yml by rob')
    expect(r.notes[0]).toMatch(/rob/)
    expect(r.lockTrain).toBe(true)
    expect(rules.checkMove({ card: card({ status: 'ready-for-testing' }), to: 'ready-to-publish', git, project }).fields.approvedVia).toBe('board-tickets.mjs (local run)')
  })
  it('backlog from a train card adds revertRequested', () => {
    const { git } = onBranch()
    const r = rules.checkMove({ card: card({ status: 'ready-for-testing', deployCommit: FULL }), to: 'backlog', git, project })
    expect(r.fields.revertRequested).toBe(true)
    expect(r.notes).toHaveLength(1)
    expect(rules.checkMove({ card: card({ status: 'ready-for-testing' }), to: 'backlog', git, project }).fields.revertRequested).toBeUndefined()
  })
  it('archived is refused for a train card and allowed from published-live', () => {
    const { git } = onBranch()
    expect(rules.checkMove({ card: card({ status: 'ready-to-publish', deployCommit: FULL }), to: 'archived', git, project }).ok).toBe(false)
    expect(rules.checkMove({ card: card({ status: 'published-live', deployCommit: FULL }), to: 'archived', git, project }).ok).toBe(true)
  })
})

describe('wired into the scripts', () => {
  it('no longer rewrites notes whole or hard-codes the project name', () => {
    for (const f of ['scripts/board-tickets.mjs', 'scripts/lib/board.mjs']) {
      const src = readFileSync(join(ROOT, f), 'utf8')
      expect(src, f).not.toContain('updateMask.fieldPaths=notes')
    }
    const main = readFileSync(join(ROOT, 'scripts/board-tickets.mjs'), 'utf8')
    expect(main).not.toMatch(/tickets on Display Types/)
  })

  it('--to published-live without proof exits 1 and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bt-'))
    const log = join(dir, 'writes.log')
    const stub = join(dir, 'stub.mjs')
    writeFileSync(stub, `
import { appendFileSync } from 'node:fs'
const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if ((init.method ?? 'GET') !== 'GET' && !u.includes('identitytoolkit')) { appendFileSync(${JSON.stringify(log)}, u + '\\n'); return ok({}) }
  if (u.includes('identitytoolkit')) return ok({ idToken: 't' })
  if (u.includes('/backlogItems')) return ok({ documents: [{ name: 'x/backlogItems/abc', fields: { projectId: { stringValue: 'mIPdOCAWevhrgD8g2tCZ' }, title: { stringValue: 'T' }, status: { stringValue: 'backlog' } } }] })
  return ok({ name: 'x/projects/p', fields: { name: { stringValue: 'Display Types & DSP Integration' } } })
}
`)
    const git = join(dir, 'git')
    writeFileSync(git, `#!/bin/sh
case "$1" in
  rev-parse) [ "$2" = "--is-shallow-repository" ] && echo false; exit 0;;
  fetch) exit 0;;
  log) exit 0;;
  *) exit 1;;
esac
`)
    chmodSync(git, 0o755)
    const res = spawnSync(process.execPath, ['--import', stub, join(ROOT, 'scripts/board-tickets.mjs'), '--ticket', 'abc', '--to', 'published-live', '--yes'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, BOARD_API_KEY: 'test', PATH: `${dir}:${process.env.PATH}` },
    })
    expect(res.status, res.stderr + res.stdout).toBe(1)
    expect(res.stderr).toMatch(/no proof/)
    expect(existsSync(log)).toBe(false)
  })
})

describe('relinkPlan', () => {
  const SHA = 'b'.repeat(40)
  const OLD = 'c'.repeat(40)
  const link = (ref: string, rest = 'index.html') => `https://rawcdn.githack.com/offline2online/rob_ph_demos/${ref}/dsp-integration/prototype/${rest}`
  const NOW = '2026-10-19T05:00:00.000Z'
  const card = (o: Record<string, unknown>) => ({ id: 'x', title: 't', status: 'ready-for-testing', deployBranch: 'deploy/dsp-integration', previewUrl: link(OLD), ...o })

  it('writes previewUrl, previewSha, previewUpdatedAt and updatedAt, and no notes', () => {
    const [p] = rules.relinkPlan([card({ id: 'a', previewUrl: link(OLD, 'demo/x.json') })], SHA, 'deploy/dsp-integration', NOW)
    expect(p.fields).toEqual({
      previewUrl: link(SHA, 'demo/x.json'), previewSha: SHA,
      previewUpdatedAt: { timestamp: NOW }, updatedAt: { timestamp: NOW },
    })
    expect('notes' in p.fields || 'notes' in p).toBe(false)
  })

  it('keeps only testing cards on the branch (by deployBranch or by a link to the branch)', () => {
    const plan = rules.relinkPlan([
      card({ id: 'rft' }),
      card({ id: 'rtp', status: 'ready-to-publish' }),
      card({ id: 'backlog', status: 'backlog' }),
      card({ id: 'live', status: 'published-live' }),
      card({ id: 'other', deployBranch: 'deploy/other' }),
      card({ id: 'hand', deployBranch: undefined, previewUrl: link('deploy/dsp-integration') }),
      card({ id: 'nolink', previewUrl: 'https://example.com/' }),
    ], SHA, 'deploy/dsp-integration', NOW)
    expect(plan.map((p: { id: string }) => p.id)).toEqual(['rft', 'rtp', 'hand'])
  })

  it('skips a card already at the sha', () => {
    expect(rules.relinkPlan([card({ previewUrl: link(SHA) })], SHA, 'deploy/dsp-integration', NOW)).toEqual([])
  })

  it('board-tickets.mjs posts no relink note', () => {
    const src = readFileSync(join(ROOT, 'scripts/board-tickets.mjs'), 'utf8')
    expect(src).not.toContain('Test link updated')
    const block = src.slice(src.indexOf("const relinkSha = value('--relink-prototype')"), src.indexOf('several tickets, one run'))
    expect(block).not.toContain('appendNote')
  })
})
