/* Stand-in for the existing platform's asset storage: a local folder
   (data/assets/, git-ignored). Files are served at /assets/{file} by the
   POC API so the review panel can render them. */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

export interface AssetStore {
  put(bytes: Buffer, ext: string): string
  read(file: string): Buffer | null
  url(file: string): string
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
    url: (file) => `${publicBase}/assets/${file}`,
  }
}

export const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' }
export const mimeOf = (file: string) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
