/* The board over Firestore's REST API, for scripts (E2E Testing Strategy
   §3.4). Same sign-in and collections as board-tickets.mjs and
   sync-board-docs.mjs — the MCP connector is for a person's agent, not for
   a runner. Needs BOARD_API_KEY (the board automation user's password) in
   the environment or dsp-integration/.env; without it every write is a
   dry run, which the callers say so. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PROJECT_ID = 'mIPdOCAWevhrgD8g2tCZ'
const FIREBASE_KEY = 'AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g'
const BOARD = 'https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents'
const AUTHOR = 'backlog-automation'

export const env = (name) => {
  if (process.env[name]) return process.env[name]
  try {
    const line = readFileSync(join(ROOT, '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
    return line ? line.slice(name.length + 1).trim() : ''
  } catch { return '' }
}

const str = (v) => ({ stringValue: String(v) })
const field = (doc, name) => doc.fields?.[name]?.stringValue ?? null
const now = () => ({ timestampValue: new Date().toISOString() })

export async function connect() {
  const key = env('BOARD_API_KEY')
  if (!key) return null
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'board-automation@backlog-tracker-e4ed2.firebaseapp.com', password: key, returnSecureToken: true }),
  })
  if (!res.ok) throw new Error(`Board sign-in failed (${res.status}): ${await res.text()}`)
  const auth = { Authorization: `Bearer ${(await res.json()).idToken}` }
  const json = { ...auth, 'Content-Type': 'application/json' }

  const page = async (collection) => {
    const out = []
    let pageToken
    do {
      const url = new URL(`${BOARD}/${collection}`)
      url.searchParams.set('pageSize', '300')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const r = await fetch(url, { headers: auth })
      if (!r.ok) throw new Error(`Reading ${collection} failed (${r.status}): ${await r.text()}`)
      const body = await r.json()
      out.push(...(body.documents ?? []))
      pageToken = body.nextPageToken
    } while (pageToken)
    return out
  }

  return {
    /* Every ticket on the project: id, title, status, type. */
    async tickets(projectId = PROJECT_ID) {
      return (await page('backlogItems')).filter((d) => field(d, 'projectId') === projectId)
        .map((d) => ({ id: d.name.split('/').pop(), title: field(d, 'title') ?? '', status: field(d, 'status') ?? 'backlog', type: field(d, 'type') ?? 'feature', desc: field(d, 'desc') ?? '' }))
    },
    async addComment(id, text) {
      const r = await fetch(`${BOARD}/backlogItems/${id}`, { headers: auth })
      if (!r.ok) throw new Error(`Reading ${id} failed (${r.status}): ${await r.text()}`)
      const notes = (await r.json()).fields?.notes?.arrayValue?.values ?? []
      notes.push({ mapValue: { fields: { author: str(AUTHOR), text: str(text), at: str(new Date().toISOString()) } } })
      const p = await fetch(`${BOARD}/backlogItems/${id}?updateMask.fieldPaths=notes&updateMask.fieldPaths=updatedAt`, { method: 'PATCH', headers: json, body: JSON.stringify({ fields: { notes: { arrayValue: { values: notes } }, updatedAt: now() } }) })
      if (!p.ok) throw new Error(`Commenting on ${id} failed (${p.status}): ${await p.text()}`)
    },
    /* Same shape as the MCP's create_backlog_item: Backlog, attributed to the automation. */
    async createTicket({ projectId = PROJECT_ID, title, desc, type = 'bug', category = 'Backend / Infrastructure' }) {
      const body = { fields: {
        projectId: str(projectId), title: str(title.slice(0, 200)), desc: str(desc.slice(0, 2000)), type: str(type), category: str(category), status: str('backlog'),
        createdVia: str('e2e'), createdByEmail: str(`${AUTHOR}@backlog-tracker-e4ed2.firebaseapp.com`), createdAt: now(), updatedAt: now(),
        notes: { arrayValue: { values: [{ mapValue: { fields: { author: str(AUTHOR), text: str('Filed by file-e2e-bugs from an E2E results file.'), at: str(new Date().toISOString()) } } }] } },
      } }
      const r = await fetch(`${BOARD}/backlogItems`, { method: 'POST', headers: json, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`Creating a ticket failed (${r.status}): ${await r.text()}`)
      return (await r.json()).name.split('/').pop()
    },
    /* Same shape as the MCP's create_project_document. */
    async createDocument({ projectId = PROJECT_ID, name, contentMd }) {
      const body = { fields: { projectId: str(projectId), name: str(name), contentMd: str(contentMd), createdAt: now(), updatedAt: now(), createdByEmail: str(`${AUTHOR}@backlog-tracker-e4ed2.firebaseapp.com`), updatedByEmail: str(`${AUTHOR}@backlog-tracker-e4ed2.firebaseapp.com`), createdVia: str('e2e') } }
      const r = await fetch(`${BOARD}/projectDocs`, { method: 'POST', headers: json, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`Creating the document failed (${r.status}): ${await r.text()}`)
      return (await r.json()).name.split('/').pop()
    },
  }
}
