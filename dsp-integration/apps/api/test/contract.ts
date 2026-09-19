/* Response validation generated from docs/dsp-integration/api/openapi.yaml.
   Strict: a response with any field the contract doesn't define fails. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { parse } from 'yaml'
import { expect } from 'vitest'

const DOC_URL = new URL('../../../docs/dsp-integration/api/openapi.yaml', import.meta.url)
type Node = Record<string, unknown>
export const openapi = parse(readFileSync(fileURLToPath(DOC_URL), 'utf8')) as Node

/* Close every object schema: unevaluatedProperties:false unless the contract
   says otherwise. allOf members are left open; their parent is closed. */
function strictify(node: unknown, allOfMember = false): void {
  if (Array.isArray(node)) return node.forEach((n) => strictify(n))
  if (!node || typeof node !== 'object') return
  const n = node as Node
  const isObjectSchema = (n.properties && typeof n.properties === 'object') || Array.isArray(n.allOf)
  if (isObjectSchema && !allOfMember && n.additionalProperties === undefined && n.unevaluatedProperties === undefined) n.unevaluatedProperties = false
  for (const [k, v] of Object.entries(n)) {
    if (k === 'allOf' && Array.isArray(v)) v.forEach((m) => strictify(m, true))
    else if (k === 'example' || k === 'examples') continue
    else strictify(v)
  }
}
const doc = structuredClone(openapi)
strictify(doc.components)
strictify(doc.paths)

const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema({ ...doc, $id: 'openapi.json' })

const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1')
const resolveRef = (ref: string) => ref.replace(/^#\//, '').split('/').reduce<unknown>((o, k) => (o as Node)?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc) as Node

/* Operations the contract defines, as "METHOD /path". */
export const contractOperations = () =>
  Object.entries(openapi.paths as Node).flatMap(([p, ops]) => Object.keys(ops as Node).filter((m) => ['get', 'put', 'post', 'delete'].includes(m)).map((m) => `${m.toUpperCase()} ${p}`))

export function expectMatchesContract(method: string, pathTemplate: string, status: number, body: unknown) {
  const op = ((doc.paths as Node)[pathTemplate] as Node | undefined)?.[method.toLowerCase()] as Node | undefined
  if (!op) throw new Error(`No ${method} ${pathTemplate} in the contract`)
  let resp = (op.responses as Node)[String(status)] as Node | undefined
  if (!resp) throw new Error(`${method} ${pathTemplate} has no ${status} response in the contract`)
  let ptr = `/paths/${esc(pathTemplate)}/${method.toLowerCase()}/responses/${status}`
  if (typeof resp.$ref === 'string') {
    ptr = resp.$ref.replace(/^#/, '')
    resp = resolveRef(resp.$ref)
  }
  const content = resp.content as Node | undefined
  if (!content) {
    expect(body === undefined || body === '' || body === null).toBe(true)
    return
  }
  const validate = ajv.getSchema(`openapi.json#${ptr}/content/application~1json/schema`)
  if (!validate) throw new Error(`Could not compile schema at ${ptr}`)
  const ok = validate(body)
  if (!ok) throw new Error(`${method} ${pathTemplate} ${status} does not match the contract:\n${JSON.stringify(validate.errors, null, 2)}\nbody: ${JSON.stringify(body).slice(0, 600)}`)
}
