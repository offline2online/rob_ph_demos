/* Firebase adapter for the hosted POC API (host.ts does the work).

   Deployed to the backlog-tracker-e4ed2 project as its own codebase,
   `dsp-api`, by .github/workflows/dsp-api-deploy.yml — deploying it never
   touches the console's own functions, and theirs never touch this.

   dspApi      HTTPS, public. The whole API: /api/admin/v1/*, /api/v1/*,
               /sellers.json, /assets/*. ONE instance at most, because the
               database is a single SQLite file (host.ts).

   Scheduled work (billing, the auction at its cutoff, retention) runs inside
   dspApi on the back of requests (host.ts). A Cloud Scheduler job would need
   cloudscheduler.googleapis.com, which the deploy's service account is not
   allowed to enable (first deploy, 23 Sep 2026); host.ts keeps a
   token-guarded /_tasks/tick for one if a project owner enables it. */
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import { type DocStore, chunkedStore, createHost } from './host'

initializeApp()
const REGION = 'us-central1'
const PROJECT = process.env.GCLOUD_PROJECT ?? 'backlog-tracker-e4ed2'
/* The function's own public URL; creative URLs are built on it. */
const PUBLIC_URL = `https://${REGION}-${PROJECT}.cloudfunctions.net/dspApi`

/* Durable state lives in its own Firestore collection. firestore.rules has
   no rule for it, so no browser — signed in or not — can read or write it;
   the Admin SDK used here is the only way in. (Firestore rather than Cloud
   Storage because the project's Storage may not be enabled; Firestore
   certainly is — the console runs on it.) */
const COLLECTION = 'dspApiState'
const firestoreDocs = (): DocStore => {
  const col = getFirestore().collection(COLLECTION)
  return {
    async get(id) {
      const snap = await col.doc(id).get()
      return snap.exists ? (snap.data() as Record<string, unknown>) : null
    },
    async setMany(docs) {
      const batch = getFirestore().batch()
      for (const [id, data] of docs) batch.set(col.doc(id), data)
      await batch.commit()
    },
    async set(id, data) {
      await col.doc(id).set(data)
    },
    async deleteMany(ids) {
      const batch = getFirestore().batch()
      for (const id of ids) batch.delete(col.doc(id))
      await batch.commit()
    },
    async namesWithPrefix(prefix) {
      const snap = await col.where('name', '>=', prefix).where('name', '<', `${prefix}\uf8ff`).get()
      return snap.docs.map((d) => d.get('name') as string)
    },
  }
}
const store = () => chunkedStore(firestoreDocs())

/* The bundle sits in lib/ with both migration folders copied beside it (build.mjs). */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const host = createHost({
  store: store(),
  dataDir: '/tmp/dsp-api',
  migrationsDirs: [here('./migrations/api/'), here('./migrations/approval/')],
  publicUrl: PUBLIC_URL,
  log: (m) => logger.info(m),
})

export const dspApi = onRequest(
  { region: REGION, maxInstances: 1, concurrency: 80, memory: '512MiB', timeoutSeconds: 120, invoker: 'public' },
  async (req, res) => {
    try {
      /* Reached as …/dspApi/<path>: the function name isn't part of the app's routes. */
      const url = req.url.replace(/^\/dspApi(?=\/|$)/, '') || '/'
      const out = await host.handle({ method: req.method, url, headers: req.headers, rawBody: req.rawBody, ip: req.ip })
      res.status(out.status)
      for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v)
      res.end(out.body)
    } catch (e) {
      logger.error('dspApi failed', e)
      res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected error.' } })
    }
  },
)
