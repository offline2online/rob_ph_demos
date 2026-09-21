/* Load .env from the POC root if present (never committed). */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function loadEnv() {
  const file = fileURLToPath(new URL('../../../.env', import.meta.url))
  if (existsSync(file)) process.loadEnvFile(file)
}
