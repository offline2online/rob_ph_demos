/* Build the hosted API for Cloud Functions: one ESM bundle of the API (and
   the workspace packages and npm dependencies it uses), plus both migration
   folders beside it, in functions/lib/.

     node deploy/firebase/build.mjs            the function (functions/lib/index.mjs)
     node deploy/firebase/build.mjs --local    also a local server over the same
                                               bundle settings (lib/local-server.mjs),
                                               to check the bundle before deploying

   Only firebase-functions and firebase-admin stay external: Cloud Build
   installs them from functions/package.json. */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const root = here('../../')
const lib = here('./functions/lib/')

rmSync(lib, { recursive: true, force: true })
mkdirSync(lib, { recursive: true })

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  external: ['firebase-functions', 'firebase-functions/*', 'firebase-admin', 'firebase-admin/*'],
  /* Bundled CommonJS dependencies (Fastify and friends) call require() on
     Node built-ins; an ESM bundle needs a real require for that. */
  banner: { js: "import { createRequire as __phCreateRequire } from 'node:module'; const require = __phCreateRequire(import.meta.url);" },
  logLevel: 'warning',
}

await build({ ...common, entryPoints: [here('./functions/src/index.ts')], outfile: `${lib}index.mjs` })
if (process.argv.includes('--local')) await build({ ...common, entryPoints: [here('./local-server.ts')], outfile: `${lib}local-server.mjs` })

cpSync(`${root}apps/api/src/db/migrations`, `${lib}migrations/api`, { recursive: true })
cpSync(`${root}packages/campaign-approval/migrations`, `${lib}migrations/approval`, { recursive: true })
console.log(`Built ${lib}`)
