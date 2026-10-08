/* Visual layout check: every DSP integration admin page, at tablet and
   desktop (playwright.config.ts). Two layers per page:

   1. Alignment rules (rules.ts) — objective geometry. Always enforced, minus
      the issues listed in known-issues.json (see below).
   2. Screenshot baseline — layout/baselines/<page>-<viewport>.png. Enforced
      once layout/baselines/.enforce exists; until then the screenshot is
      attached to the report so a person can review it. Intended changes:
      `npm run test:layout:update` and commit the new baselines.

   known-issues.json is the baseline for the rules: layout problems that
   already existed when the check was added. They are reported, not failed
   on, so the gate only trips on a NEW misalignment — and fixing one means
   deleting its line. A listed issue that no longer happens is flagged. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { collectViolations, type Violation } from './rules'

const here = dirname(fileURLToPath(import.meta.url))
const known: { page: string; viewport?: string; rule: string; where: string; note?: string }[] = JSON.parse(readFileSync(join(here, 'known-issues.json'), 'utf8')).issues
const enforceShots = existsSync(join(here, 'baselines', '.enforce'))

/* Every admin page. Advertisers / Inventory and the booking schedule need
   DSP integration switched on, which the snapshot has. */
export const PAGES = [
  { id: 'display-types', route: '/display-types' },
  { id: 'playlists', route: '/playlists' },
  { id: 'advertisers-inventory', route: '/advertisers' },
  { id: 'advertiser-bookings', route: '/booking-schedule' },
  { id: 'campaign-detail', route: '/campaign-status/c_breakfast' },
  { id: 'dsp-exchange-settings', route: '/dsp-integration/exchange' },
  { id: 'dsp-advertiser-settings', route: '/dsp-integration/advertiser-settings' },
  { id: 'dsp-targeting-variables', route: '/dsp-integration/targeting-variables' },
  { id: 'dsp-partner-google', route: '/dsp-integration/partners/p_google' },
  { id: 'dsp-partner-amazon', route: '/dsp-integration/partners/p_amazon' },
  { id: 'dsp-partner-ttd', route: '/dsp-integration/partners/p_ttd' },
]

async function open(page: Page, route: string) {
  await page.goto(`/#${route}`)
  await page.waitForSelector('main', { state: 'visible' })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}) // web fonts may be unreachable; carry on
  /* Material Symbols and Roboto come from Google Fonts; wait for whatever
     did load, then settle animations so geometry is final. */
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await page.waitForTimeout(300)
}

for (const p of PAGES) {
  test(`${p.id}`, async ({ page }, info) => {
    const viewport = info.project.name
    await open(page, p.route)
    await expect(page.locator('main')).not.toBeEmpty()

    const found: Violation[] = await page.evaluate(collectViolations)
    const isKnown = (v: Violation) => known.some((k) => k.page === p.id && (!k.viewport || k.viewport === viewport) && k.rule === v.rule && v.where.startsWith(k.where))
    const fresh = found.filter((v) => !isKnown(v))
    const stale = known.filter((k) => k.page === p.id && (!k.viewport || k.viewport === viewport) && !found.some((v) => k.rule === v.rule && v.where.startsWith(k.where)))

    for (const v of found.filter(isKnown)) info.annotations.push({ type: 'known-issue', description: `[${v.rule}] ${v.where} — ${v.detail}` })
    for (const k of stale) info.annotations.push({ type: 'known-issue-gone', description: `[${k.rule}] ${k.where} no longer happens at ${viewport} — delete it from known-issues.json` })

    await info.attach(`${p.id}-${viewport}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    expect(fresh.map((v) => `[${v.rule}] ${v.where} — ${v.detail}`), `new layout misalignment on ${p.id} at ${viewport}`).toEqual([])

    if (enforceShots) await expect(page).toHaveScreenshot(`${p.id}.png`, { fullPage: true, maxDiffPixelRatio: 0.01 })
  })
}

/* The gate must actually trip: break a clean page on purpose and the rules
   have to name it (test step 2). The injected block has two fields on a row,
   a third wrapped onto a row of its own, and an info icon floating far from
   its label. */
test('a deliberate misalignment is caught', async ({ page }) => {
  await open(page, '/playlists')
  await page.evaluate(() => {
    const field = (label: string, icon = '') =>
      `<div style="width:280px"><label style="display:flex;gap:5px;align-items:center">${label}${icon}</label><input style="width:100%" /></div>`
    const floating = '<span role="button" tabindex="0" aria-label="Help" style="margin-left:300px">info</span>'
    const box = document.createElement('div')
    box.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;width:600px'
    box.innerHTML = field('First', floating) + field('Second') + field('Third')
    document.querySelector('main')!.appendChild(box)
  })
  const rules = new Set((await page.evaluate(collectViolations)).map((v) => v.rule))
  expect(rules.has('tooltip'), 'floating info icon is flagged').toBe(true)
  expect(rules.has('field-row'), 'wrapped field is flagged').toBe(true)
})

test('mobile is not captured', async ({}, info) => {
  expect(['tablet', 'desktop']).toContain(info.project.name)
})
