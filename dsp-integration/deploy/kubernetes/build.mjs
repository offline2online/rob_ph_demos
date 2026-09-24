/* Build the API for a container: one ESM bundle of the API server and one
   of the scheduler tick, with both migration folders beside them, in
   deploy/kubernetes/dist/. The Dockerfile runs this in its build stage.

     node deploy/kubernetes/build.mjs

   Same bundling as the hosted Cloud Function (deploy/firebase/build.mjs);
   nothing is external here — the runtime image needs Node and these files,
   no node_modules. */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const root = here('../../')
const dist = here('./dist/')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  /* Bundled CommonJS dependencies (Fastify and friends) call require() on
     Node built-ins; an ESM bundle needs a real require for that. */
  banner: { js: "import { createRequire as __phCreateRequire } from 'node:module'; const require = __phCreateRequire(import.meta.url);" },
  logLevel: 'warning',
}

await build({ ...common, entryPoints: [`${root}apps/api/src/index.ts`], outfile: `${dist}api.mjs` })
await build({ ...common, entryPoints: [`${root}apps/api/src/exchange/tickCli.ts`], outfile: `${dist}tick.mjs` })
cpSync(`${root}apps/api/src/db/migrations`, `${dist}migrations/api`, { recursive: true })
cpSync(`${root}packages/campaign-approval/migrations`, `${dist}migrations/approval`, { recursive: true })
console.log(`Built ${dist}`)
