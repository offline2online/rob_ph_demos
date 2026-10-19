/* board-docs.json: the Display Types handover set is declared in the manifest,
   and sync-board-docs.mjs reads it. node --test scripts/test/board-docs.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIRROR_CAP, REPO, ROOT, cutEntry, loadManifest, matchEntries, specOf } from '../lib/board-docs.mjs'

const manifest = loadManifest()
const read = (p) => readFileSync(join(REPO, p), 'utf8')
const E2E = 'dsp-integration/docs/dsp-integration/E2E-TEST-SPEC.md'
const START = read('dsp-integration/docs/dsp-integration/START-HERE.md')
const e2eParts = manifest.mirrors.filter((m) => m.path === E2E)

test('carry-over: the 24 mirrors from MIRRORS (28a088d5) are unchanged and cut to the same text', () => {
  const fixture = JSON.parse(readFileSync(join(ROOT, 'scripts/test/fixtures/mirrors-28a088d5.json'), 'utf8'))
  assert.equal(fixture.length, 24)
  for (const f of fixture) {
    const entry = manifest.mirrors.find((m) => m.id === f.id)
    assert.ok(entry, `${f.id} is missing from the manifest`)
    assert.equal(entry.name, f.name)
    assert.deepEqual(specOf(manifest, entry), { sourcePath: f.sourcePath, sourceSlices: f.sourceSlices, sourcePrefix: f.sourcePrefix }, f.id)
    assert.ok(cutEntry(manifest, entry).startsWith(f.sourcePrefix))
  }
})

test('every mirror is under the cap; each E2E part under 15,000; every E2E heading is in exactly one part', () => {
  assert.equal(manifest.mirrors.length, 28)
  for (const m of manifest.mirrors) assert.ok(cutEntry(manifest, m).length < MIRROR_CAP, m.name)
  assert.equal(e2eParts.length, 3)
  const texts = e2eParts.map((m) => cutEntry(manifest, m))
  texts.forEach((t) => assert.ok(t.length < 15000))
  const headings = read(E2E).split('\n').filter((l) => /^#{1,6} /.test(l))
  for (const h of headings) assert.equal(texts.filter((t) => t.split('\n').includes(h)).length, 1, h)
})

test('ids, names and (path, slices) are unique; projectId and startHere are right', () => {
  const ids = [...manifest.mirrors.map((m) => m.id).filter(Boolean), ...manifest.boardDocs.map((b) => b.id)]
  assert.equal(new Set(ids).size, ids.length)
  const names = manifest.mirrors.map((m) => m.name)
  assert.equal(new Set(names).size, names.length)
  names.forEach((n) => assert.ok(n.length >= 1 && n.length <= 120))
  const pairs = manifest.mirrors.map((m) => JSON.stringify([m.path, m.slices ?? []]))
  assert.equal(new Set(pairs).size, pairs.length)
  assert.equal(manifest.projectId, 'mIPdOCAWevhrgD8g2tCZ')
  const start = manifest.mirrors.find((m) => m.key === manifest.startHere)
  assert.equal(start.path, 'dsp-integration/docs/dsp-integration/START-HERE.md')
})

test('E2E part 1 keeps the existing document id; parts 2 and 3 and the hosted demo API have none', () => {
  assert.equal(e2eParts[0].id, 'f34VQZCy2kkWJfBP6Iwp')
  assert.equal(e2eParts[1].id, undefined)
  assert.equal(e2eParts[2].id, undefined)
  const hosted = manifest.mirrors.find((m) => m.path === 'dsp-integration/deploy/firebase/README.md')
  assert.equal(hosted.id, undefined)
  assert.equal(hosted.name, 'Hosted demo API — deploy, reset and limits')
})

test('matching: id first; an id-less entry matches only identical path and slices; none is returned as missing', () => {
  const idless = { key: 'p', path: 'a.md', name: 'p', slices: [{ start: 'X', end: 'Y' }] }
  const m = { mirrors: [idless, { key: 'q', id: 'D2', path: 'a.md', name: 'q' }] }
  const docs = [
    { id: 'D1', sourcePath: 'a.md', sourceSlices: [{ end: 'Y', start: 'X' }] }, // key order differs
    { id: 'D2', sourcePath: 'zzz.md', sourceSlices: [] },
  ]
  const [a, b] = matchEntries(m, docs)
  assert.equal(a.doc.id, 'D1')
  assert.equal(b.doc.id, 'D2') // by id, though the path differs
  const [none] = matchEntries({ mirrors: [idless] }, [{ id: 'D3', sourcePath: 'a.md', sourceSlices: [{ start: 'X' }] }])
  assert.equal(none.doc, null)
  assert.equal(none.missing, true)
})

test('matching: boundaries 1/7 and 2/7 never match each other', () => {
  const b = (n) => manifest.mirrors.find((m) => m.key === `ph-core-boundaries-${n}`)
  const idless = (e) => ({ mirrors: [{ ...e, id: undefined }] })
  const doc1 = { id: 'x1', sourcePath: b(1).path, sourceSlices: b(1).slices }
  const doc2 = { id: 'x2', sourcePath: b(2).path, sourceSlices: b(2).slices }
  assert.equal(matchEntries(idless(b(1)), [doc2])[0].missing, true)
  assert.equal(matchEntries(idless(b(2)), [doc1])[0].missing, true)
  assert.equal(matchEntries(idless(b(2)), [doc1, doc2])[0].doc.id, 'x2')
})

test('--check-cut exits 0 and lists 28 mirrors; the script holds no mirror list of its own', () => {
  const out = execFileSync('node', ['scripts/sync-board-docs.mjs', '--check-cut'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(out.split('\n').filter((l) => l.startsWith('✓')).length, 28)
  const src = readFileSync(join(ROOT, 'scripts/sync-board-docs.mjs'), 'utf8')
  assert.ok(!/const MIRRORS\b|repoMirror|PH-CORE-BOUNDARIES\.md'/.test(src))
})

test('START-HERE.md names every mirror path and every superseded board document', () => {
  for (const p of new Set(manifest.mirrors.map((m) => m.path))) assert.ok(START.includes(p), `${p} is not in START-HERE.md`)
  for (const b of manifest.boardDocs) assert.ok(START.includes(b.id), `${b.id} is not in START-HERE.md`)
})
