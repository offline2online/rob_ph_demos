/* Test-data seed: give the screens nobody has assigned a store and a display
   type, and give every display type a default VAC-d (ticket, 1 Oct 2026), so
   Available Inventory and audience scoring can be exercised without hand
   setup. Re-runnable: the screens it assigned are put back in scope on the
   next run, and each run resets to the same known state for the scenario.

   Scenarios:
     all-scored       every display type has a default VAC-d; no overrides.
     some-unscored    one display type has its default cleared and its slot
                      scores removed, so its slots show "No audience score
                      yet." (the edge case). NOTE the slot scores are not
                      restored by a later run: re-seed the database for that.
     some-overridden  as all-scored, plus a few screens with a VAC-d of their
                      own that differs from their type's default. */
import type { Context } from '../context'
import { tx } from '../db/db'

export const SCENARIOS = ['all-scored', 'some-unscored', 'some-overridden'] as const
export type Scenario = (typeof SCENARIOS)[number]

const MOCK_STORES = [
  { id: 'st_mock_central', name: 'Mock Central', region: 'NSW' },
  { id: 'st_mock_harbour', name: 'Mock Harbour', region: 'NSW' },
  { id: 'st_mock_riverside', name: 'Mock Riverside', region: 'VIC' },
  { id: 'st_mock_northgate', name: 'Mock Northgate', region: 'QLD' },
]

/* Assumed views per play window, per display, by kind of screen (the Menu
   Board's 412 is the figure used across the other seeds). */
const DEFAULTS: [RegExp, number][] = [[/menu/i, 412], [/led/i, 900], [/kiosk|tablet/i, 150], [/window|entrance/i, 700]]
const FALLBACK_DEFAULT = 300
const defaultFor = (name: string) => DEFAULTS.find(([re]) => re.test(name))?.[1] ?? FALLBACK_DEFAULT

export interface ScreensSummary {
  scenario: Scenario
  stores: number
  assigned: { displayId: string; store: string; displayType: string }[]
  defaults: { displayType: string; defaultVacd: number | null }[]
  overrides: { displayId: string; vacd: number }[]
  unscoredDisplayTypes: string[]
}

export function seedScreens(ctx: Context, scenario: Scenario = 'all-scored'): ScreensSummary {
  const { db } = ctx
  return tx(db, () => {
    const types = ctx.displayTypes.list()
    const typeIds = new Set(types.map((t) => t.id))
    for (const s of MOCK_STORES) db.prepare('INSERT INTO stores (id, name, region) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, region = excluded.region').run(s.id, s.name, s.region)

    /* In scope: screens with no store, and screens this seed assigned earlier. */
    const screens = db.prepare("SELECT id, display_type_id AS typeId FROM displays WHERE store_id IS NULL OR store_id = '' OR store_id LIKE 'st_mock_%' ORDER BY id").all() as unknown as { id: string; typeId: string }[]
    const assigned: ScreensSummary['assigned'] = []
    const upd = db.prepare('UPDATE displays SET store_id = ?, store = ?, display_type_id = ?, vacd_override = NULL WHERE id = ?')
    screens.forEach((d, i) => {
      const store = MOCK_STORES[i % MOCK_STORES.length]
      /* Keep the type the screen already has when it is a real one; otherwise spread across the types. */
      const typeId = typeIds.has(d.typeId) ? d.typeId : types[i % types.length]?.id
      if (!typeId) return
      upd.run(store.id, store.name, typeId, d.id)
      assigned.push({ displayId: d.id, store: store.name, displayType: typeId })
    })

    /* A default VAC-d on every display type that has an assigned screen. */
    const setDefault = db.prepare("UPDATE display_types SET ph_extensions = json_set(COALESCE(ph_extensions, '{\"slots\":[]}'), '$.defaultVacd', ?) WHERE id = ?")
    const clearDefault = db.prepare("UPDATE display_types SET ph_extensions = json_remove(ph_extensions, '$.defaultVacd') WHERE id = ? AND ph_extensions IS NOT NULL")
    const used = [...new Set(assigned.map((a) => a.displayType))]
    for (const id of used) setDefault.run(defaultFor(types.find((t) => t.id === id)?.name ?? ''), id)

    const unscoredDisplayTypes: string[] = []
    if (scenario === 'some-unscored' && used.length) {
      clearDefault.run(used[0])
      db.prepare('DELETE FROM audience_vacd WHERE display_type_id = ?').run(used[0])
      unscoredDisplayTypes.push(used[0])
    }

    const overrides: ScreensSummary['overrides'] = []
    if (scenario === 'some-overridden') {
      const setOverride = db.prepare('UPDATE displays SET vacd_override = ? WHERE id = ?')
      /* Every third assigned screen, tuned 40% above or below its type's default. */
      assigned.forEach((a, i) => {
        if (i % 3 !== 0) return
        const base = defaultFor(types.find((t) => t.id === a.displayType)?.name ?? '')
        const vacd = Math.round(base * (i % 2 === 0 ? 1.4 : 0.6))
        setOverride.run(vacd, a.displayId)
        overrides.push({ displayId: a.displayId, vacd })
      })
    }

    const defaults = types.filter((t) => used.includes(t.id)).map((t) => ({ displayType: t.id, defaultVacd: unscoredDisplayTypes.includes(t.id) ? null : defaultFor(t.name) }))
    return { scenario, stores: MOCK_STORES.length, assigned, defaults, overrides, unscoredDisplayTypes }
  }, 'IMMEDIATE')
}

export function printSummary(s: ScreensSummary) {
  console.log(`Scenario "${s.scenario}": ${s.stores} mock stores, ${s.assigned.length} screens assigned.`)
  for (const a of s.assigned) console.log(`  ${a.displayId} → ${a.store} (${a.displayType})`)
  for (const d of s.defaults) console.log(`  default VAC-d ${d.displayType}: ${d.defaultVacd ?? 'none (cleared)'}`)
  for (const o of s.overrides) console.log(`  override ${o.displayId}: ${o.vacd}`)
  if (s.unscoredDisplayTypes.length) console.log(`  unscored: ${s.unscoredDisplayTypes.join(', ')}`)
}
