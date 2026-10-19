/* Stand-in for the existing platform's asset storage: a local folder
   (data/assets/, git-ignored). Files are served at /assets/{file} by the
   POC API so the review panel can render them. */
import type { Awaitable } from '../db/db'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Readable } from 'node:stream'

export interface AssetStore {
  put(bytes: Buffer, ext: string): Awaitable<string>
  read(file: string): Awaitable<Buffer | null>
  url(file: string): Awaitable<string>
  /* A file to serve, as a stream and its size, or null if there is none.
     Optional: GET /assets/:file uses it when present and read() otherwise.
     Serving through read() held each download's whole file in memory — 8
     slow clients on a 150 MB creative added 1.1 GB to a pod limited to 2 GiB,
     on a public route (pre-handover review, 18 Oct 2026). A store whose files
     are served by a CDN (S3, on integration) needs neither. */
  open?(file: string): Awaitable<{ sizeBytes: number; stream: Readable } | null>
}

/* publicBase: the API's own origin, when the admin UI is served from a
   different one (the hosted prototype on GitHub Pages calling the hosted
   API). Empty for the POC, where the UI proxies /assets to the API. */
export function localAssetStore(dir: string, publicBase = ''): AssetStore {
  mkdirSync(dir, { recursive: true })
  const safe = (file: string) => /^[a-z0-9-]+\.[a-z0-9]+$/i.test(file)
  return {
    put(bytes, ext) {
      const file = `${randomUUID()}${ext.startsWith('.') ? ext : `.${ext}`}`.toLowerCase()
      writeFileSync(join(dir, file), bytes)
      return file
    },
    read(file) {
      const p = join(dir, file)
      return safe(file) && existsSync(p) ? readFileSync(p) : null
    },
    open(file) {
      if (!safe(file)) return null
      const p = join(dir, file)
      try {
        const st = statSync(p)
        return st.isFile() ? { sizeBytes: st.size, stream: createReadStream(p) } : null
      } catch {
        return null
      }
    },
    url: (file) => `${publicBase}/assets/${file}`,
  }
}

export const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' }
export const mimeOf = (file: string) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
