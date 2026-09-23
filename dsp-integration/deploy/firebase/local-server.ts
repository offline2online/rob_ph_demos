/* The hosted API's host.ts behind a plain Node HTTP server, with a folder
   standing in for the Storage bucket — to try the bundle locally before
   deploying (`node deploy/firebase/build.mjs --local`, then
   `node deploy/firebase/functions/lib/local-server.mjs`). Not deployed.

   Env: PORT (default 4800), DSP_API_STORE (the stand-in bucket folder),
   DSP_API_DATA (the stand-in /tmp). Restart it to see a cold start restore
   from the "bucket". */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BlobStore, createHost } from './functions/src/host'

const PORT = Number(process.env.PORT ?? 4800)
const storeDir = process.env.DSP_API_STORE ?? '/tmp/dsp-api-store'
const folderStore = (dir: string): BlobStore => ({
  async get(name) {
    const p = join(dir, name)
    return existsSync(p) ? readFileSync(p) : null
  },
  async put(name, bytes) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), bytes)
  },
  async list(prefix) {
    const d = join(dir, prefix)
    return existsSync(d) ? readdirSync(d).map((f) => prefix + f) : []
  },
})

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const host = createHost({
  store: folderStore(storeDir),
  dataDir: process.env.DSP_API_DATA ?? '/tmp/dsp-api-data',
  migrationsDirs: [here('./migrations/api/'), here('./migrations/approval/')],
  publicUrl: `http://127.0.0.1:${PORT}`,
  log: (m) => console.log(m),
})

createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  try {
    const out = await host.handle({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, rawBody: Buffer.concat(chunks), ip: req.socket.remoteAddress })
    res.writeHead(out.status, out.headers).end(out.body)
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'internal_error', message: 'Unexpected error.' } }))
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Hosted-API stand-in on http://127.0.0.1:${PORT}`))
