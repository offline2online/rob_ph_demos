/* Backup and restore of the hosted API's saved data (Firestore `dspApiState`).

     node state-backup.mjs backup [reason]     copy it all to dspApiBackups/<timestamp>
     node state-backup.mjs restore <timestamp> put that backup back
     node state-backup.mjs list

   Run by .github/workflows/dsp-api-deploy.yml: a backup is taken before a
   reset deletes anything (22 Oct 2026: two resets wiped the demo set up by
   hand, with no copy to put back). `dspApiBackups` has no rule in
   firestore.rules, so no browser can read it; the keys in instance.json are
   in it, which is why it must never become a public Actions artifact (this
   repo is public). The newest KEEP backups are kept; older ones are deleted.

   A restore first backs up what is there now (reason "before restore"), so
   it can itself be undone. Run it BEFORE the redeploy: the new instance
   then cold-starts from what was restored. */
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STATE = 'dspApiState'
const BACKUPS = 'dspApiBackups'
const KEEP = 10
/* A commit is limited to 10 MiB and 500 writes; chunks are ~900 KB. */
const BATCH_BYTES = 6 * 1024 * 1024
const BATCH_DOCS = 400

initializeApp({ projectId: 'backlog-tracker-e4ed2' })
const db = getFirestore()

const size = (data) => Object.values(data).reduce((n, v) => n + (v instanceof Uint8Array ? v.length : JSON.stringify(v)?.length ?? 0), 0)

/* Apply writes in batches under both limits. ops: [(batch) => void, bytes][] */
async function inBatches(ops) {
  let batch = db.batch(), docs = 0, bytes = 0
  for (const [op, b] of ops) {
    if (docs && (docs >= BATCH_DOCS || bytes + b > BATCH_BYTES)) { await batch.commit(); batch = db.batch(); docs = 0; bytes = 0 }
    op(batch); docs++; bytes += b
  }
  if (docs) await batch.commit()
}

async function backup(reason) {
  const snap = await db.collection(STATE).get()
  if (snap.empty) { console.log(`${STATE} is empty: nothing to back up.`); return null }
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const root = db.collection(BACKUPS).doc(id)
  const bytes = snap.docs.reduce((n, d) => n + size(d.data()), 0)
  await inBatches(snap.docs.map((d) => [(b) => b.set(root.collection('docs').doc(d.id), d.data()), size(d.data())]))
  /* The parent last: a backup without it is incomplete and is not listed. */
  await root.set({ createdAt: new Date().toISOString(), reason: reason || 'manual', count: snap.size, bytes })
  console.log(`Backed up ${snap.size} documents (${(bytes / 1048576).toFixed(1)} MB) to ${BACKUPS}/${id}.`)
  const all = (await db.collection(BACKUPS).get()).docs.map((d) => d.id).sort()
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    const docs = await db.collection(BACKUPS).doc(old).collection('docs').get()
    await inBatches(docs.docs.map((d) => [(b) => b.delete(d.ref), 0]))
    await db.collection(BACKUPS).doc(old).delete()
    console.log(`Removed the old backup ${old}.`)
  }
  return id
}

async function restore(id) {
  const root = db.collection(BACKUPS).doc(id)
  const meta = await root.get()
  if (!meta.exists) throw new Error(`No backup called ${id}. Run "list".`)
  const saved = await root.collection('docs').get()
  if (saved.size !== meta.get('count')) throw new Error(`Backup ${id} holds ${saved.size} documents but should hold ${meta.get('count')}; not restoring.`)
  await backup('before restore')
  const current = await db.collection(STATE).get()
  await inBatches(current.docs.map((d) => [(b) => b.delete(d.ref), 0]))
  await inBatches(saved.docs.map((d) => [(b) => b.set(db.collection(STATE).doc(d.id), d.data()), size(d.data())]))
  console.log(`Restored ${saved.size} documents from ${id} (${meta.get('reason')}, ${meta.get('createdAt')}).`)
}

async function list() {
  const all = (await db.collection(BACKUPS).get()).docs.sort((a, b) => (a.id < b.id ? -1 : 1))
  if (!all.length) console.log('No backups.')
  for (const d of all) console.log(`${d.id}  ${d.get('count')} docs  ${(d.get('bytes') / 1048576).toFixed(1)} MB  ${d.get('reason')}`)
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'backup') await backup(arg)
else if (cmd === 'restore' && arg) await restore(arg)
else if (cmd === 'list') await list()
else { console.error('Usage: state-backup.mjs backup [reason] | restore <timestamp> | list'); process.exit(2) }
