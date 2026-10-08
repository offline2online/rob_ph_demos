/* Static server for the layout check's build. `vite preview` is not used: it
   inherits the dev server's proxy, which sends /assets to the API on :4000. */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(process.cwd(), process.argv[2] ?? 'dist-layout')
const port = Number(process.argv[3] ?? 4173)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(root, path)
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html') } catch { res.writeHead(404).end('not found'); return }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1')
