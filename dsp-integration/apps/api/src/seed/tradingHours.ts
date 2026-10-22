/* Trading hours (whole UTC hours, open inclusive, close exclusive) for every stub store, seeded and demo,
   so Operating hours = Store hours gives fewer plays than 24 hours. All under 24 and varied. Applied by the demo
   and mock-screens seeds, not the bare seed, so tests that rely on 24-hour stores are untouched. */
export const STORE_TRADING_HOURS: Record<string, [number, number]> = {
  st_sydney_cbd: [7, 21], st_parramatta: [9, 20], st_chatswood: [9, 21], st_bondi_junction: [8, 19],
  st_melbourne_cbd: [8, 20], st_chadstone: [9, 21], st_brisbane_city: [7, 19], st_chermside: [9, 21],
  st_perth_cbd: [8, 18], st_adelaide_rundle: [9, 17], st_newcastle: [10, 18], st_canberra_centre: [9, 17],
  st_mock_central: [7, 22], st_mock_harbour: [9, 19], st_mock_riverside: [8, 20], st_mock_northgate: [10, 21],
}
/* Gives stores still on the 24-hour default their trading hours; a store whose hours were set is left alone. */
export function applyTradingHours(db: { prepare(sql: string): { run(...a: unknown[]): unknown } }): void {
  const set = db.prepare('UPDATE stores SET open_hour = ?, close_hour = ? WHERE id = ? AND open_hour = 0 AND close_hour = 24')
  for (const [id, [open, close]] of Object.entries(STORE_TRADING_HOURS)) set.run(open, close, id)
}
