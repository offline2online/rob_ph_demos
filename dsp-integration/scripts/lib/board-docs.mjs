/* Loads, checks and cuts this project's board-docs.json, and matches its
   mirror entries to board documents. Pure: no network, no writes. The schema,
   the validator and the cutter are backlog-tracker's (docs-sync-lib.js), so
   the post-merge sync and this script cannot disagree about either. */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = createRequire(import.meta.url)('../../../backlog-tracker/scripts/docs-sync-lib.js')
export const { MIRROR_CAP } = lib

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dsp-integration/
export const REPO = join(ROOT, '..')
export const MANIFEST_PATH = 'dsp-integration/board-docs.json'

/* -> the manifest. Throws with every problem the validator finds. */
export function loadManifest(repo = REPO) {
  const manifest = JSON.parse(readFileSync(join(repo, MANIFEST_PATH), 'utf8'))
  const problems = lib.validateManifest(manifest, (p) => existsSync(join(repo, p)))
  if (problems.length) throw new Error(`${MANIFEST_PATH}: ${problems.join('; ')}`)
  return manifest
}

/* One entry's board configuration: { sourcePath, sourceSlices, sourcePrefix }. */
export const specOf = (manifest, entry) => lib.mirrorSpec(manifest, entry)

/* One entry's text, refused — before any write — when it is over the cap. */
export function cutEntry(manifest, entry, repo = REPO) {
  const text = lib.mirrorText(readFileSync(join(repo, entry.path), 'utf8'), specOf(manifest, entry))
  if (text.length > MIRROR_CAP) {
    throw new Error(`${text.length} chars, over the ${MIRROR_CAP} the board allows a project document. ` +
      `Add another cut to ${entry.path}'s entries in ${MANIFEST_PATH}.`)
  }
  return text
}

const sliceKey = (slices) => JSON.stringify(lib.mirrorSpec({ mirrors: [] }, { path: '', slices }).sourceSlices
  .map((s) => ({ start: s.start, end: s.end })).map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined).sort())))

/* Match entries to the project's board documents ({id, sourcePath, sourceSlices}).
   An id is tried first; an entry without one matches only a document with the
   identical path and slices (key order ignored). An id-less entry with no
   document is returned as `missing` — never a write: docs-manifest's post-merge
   reconcile is the only creator. -> [{ entry, doc|null, missing }] */
export function matchEntries(manifest, docs) {
  const byId = new Map(docs.map((d) => [d.id, d]))
  return manifest.mirrors.map((entry) => {
    if (entry.id) return { entry, doc: byId.get(entry.id) ?? null, missing: false }
    const want = sliceKey(entry.slices)
    const doc = docs.find((d) => d.sourcePath === entry.path && sliceKey(d.sourceSlices) === want) ?? null
    return { entry, doc, missing: !doc }
  })
}
