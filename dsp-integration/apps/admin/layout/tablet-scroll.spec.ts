/* Tablet scroll check (ticket 6DM1NG04RrUB355zT6hX): on a touch tablet the
   sticky nav / list column / header must stay in view while the page scrolls,
   and the page must always scroll back to its top. Runs every admin page on an
   emulated iPad (touch, coarse pointer), portrait and landscape. */
import { expect, test, type Page } from '@playwright/test'
import { PAGES } from './pages'

const IPADS = [
  { name: 'portrait', viewport: { width: 820, height: 1180 } },
  { name: 'landscape', viewport: { width: 1180, height: 820 } },
]

async function open(page: Page, route: string) {
  await page.goto(`/#${route}`)
  await page.waitForSelector('main', { state: 'visible' })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
  await page.waitForTimeout(300)
}

/* Everything on the page that is sticky, and whether it scrolls on its own. */
const probe = () => {
  const out: { what: string; top: number; bottom: number; trap: boolean }[] = []
  const vh = window.innerHeight
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const label = `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}.${String(el.className).split(' ')[0]}`
    if (cs.position === 'sticky' || cs.position === 'fixed')
      out.push({ what: `${cs.position} ${label}`, top: Math.round(r.top), bottom: Math.round(r.bottom), trap: false })
    const scrolls = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && el !== document.scrollingElement && el.tagName !== 'BODY' && el.tagName !== 'HTML'
    if (scrolls && r.height > vh * 0.4) out.push({ what: `nested-scroller ${label}`, top: Math.round(r.top), bottom: Math.round(r.bottom), trap: true })
  }
  return { vh, items: out, docH: document.documentElement.scrollHeight }
}

for (const dev of IPADS) {
  test.describe(`ipad ${dev.name}`, () => {
    test.use({ viewport: dev.viewport, hasTouch: true, isMobile: true })
    for (const p of PAGES) {
      test(p.id, async ({ page }, info) => {
        test.skip(info.project.name !== 'tablet', 'one project is enough')
        await open(page, p.route)
        expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), 'emulating a touch screen').toBe(true)
        const traps = (await page.evaluate(probe)).items.filter((i) => i.trap)
        expect(traps.map((t) => t.what), "no tall nested scroller to trap a swipe").toEqual([])
        /* Make the page long enough to scroll on every route, then scroll down. */
        await page.evaluate(() => {
          /* Lengthen main, and each pane's own content column, so the pane's container is as tall as a real long page. */
          const hosts = new Set<Element>([document.querySelector('main')!])
          document.querySelectorAll('.ph-sticky-pane').forEach((p) => p.nextElementSibling && hosts.add(p.nextElementSibling))
          hosts.forEach((h) => { const d = document.createElement('div'); d.style.height = '3000px'; h.appendChild(d) })
        })
        await page.evaluate(() => window.scrollTo(0, 1500))
        await page.waitForTimeout(150)
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
        const panes = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.ph-sticky-pane')).map((el) => {
          const r = el.getBoundingClientRect()
          return { what: el.getAttribute('aria-label') ?? 'list column', top: r.top, bottom: r.bottom, h: r.height, vh: window.innerHeight }
        }))
        info.annotations.push({ type: 'panes', description: JSON.stringify(panes) })
        for (const s of panes) {
          const stuck = s.h <= s.vh ? s.top >= -1 && s.top <= 21 : Math.abs(s.bottom - s.vh) <= 2
          expect(stuck, `${s.what} did not stick while scrolled (top ${s.top}, bottom ${s.bottom}, viewport ${s.vh})`).toBe(true)
        }
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForTimeout(150)
        expect(await page.evaluate(() => window.scrollY), 'scrolls back to the top').toBe(0)
        const top = await page.evaluate(() => (document.querySelector('main h1, main [class*="text-xl"]') as HTMLElement | null)?.getBoundingClientRect().top ?? 0)
        expect(top, 'page title back in view').toBeGreaterThanOrEqual(0)
      })
    }
  })
}
