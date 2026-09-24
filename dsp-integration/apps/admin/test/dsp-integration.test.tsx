import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'
import { exchange, fakeFetch } from './fixtures'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch())))
afterEach(() => vi.unstubAllGlobals())

/* Advertisers / Inventory: two advertisers, and two sellable slots — one
   left at the default (localised only), one opened up. */
const ADVERTISER_PAGE = {
  '/api/admin/v1/advertisers': {
    currency: 'AUD', floorCpm: 100,
    items: [
      { advertiserId: 'nestle', name: 'Nestlé', via: ['Google DSP'], approvalRequired: false, floorMultiplier: 0.8, effectiveFloorCpm: 80, bookings: 3, campaigns: { draft: 0, awaiting_approval: 1, approved: 2, rejected: 0 } },
      { advertiserId: 'swisse', name: 'Swisse', via: ['Google DSP', 'Amazon Ads DSP'], approvalRequired: true, floorMultiplier: 1, effectiveFloorCpm: 100, bookings: 0, campaigns: { draft: 1, awaiting_approval: 0, approved: 0, rejected: 0 } },
    ],
  },
  '/api/admin/v1/available-inventory': {
    items: [
      {
        displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', slot: 2, position: 'Supplier slot',
        assignedTo: { partnerIds: ['p_google'], partnerNames: ['Google DSP'], advertisers: [], whitelistOnly: false }, qrControl: true, visionAi: true, supportedTargeting: ['localised', 'personalised'],
      },
      {
        displayTypeId: 'portrait', displayTypeName: 'Portrait', touchPoint: 'Digital Signage', playlistName: 'Portrait Playlist', slot: 1, position: 'Slot 1',
        assignedTo: { partnerIds: [], partnerNames: [], advertisers: [], whitelistOnly: false }, qrControl: false, visionAi: false, supportedTargeting: ['localised'],
      },
    ],
    dsps: [
      { partnerId: 'p_google', name: 'Google DSP', advertisers: [{ advertiserId: 'nestle', name: 'Nestlé' }, { advertiserId: 'swisse', name: 'Swisse' }] },
      { partnerId: 'p_amazon', name: 'Amazon Ads DSP', advertisers: [{ advertiserId: 'loreal', name: "L'Oréal" }] },
    ],
  },
}

const renderAt = (path: string, dspIntegration = true) => {
  const router = createMemoryRouter(appRoutes({ dspIntegration }), { initialEntries: [path] })
  render(<Providers><RouterProvider router={router} /></Providers>)
  return router
}

describe('DSP Integration section', () => {
  it('lists the company pages and the three DSPs in onboarding order, with their state', async () => {
    renderAt('/dsp-integration/exchange')
    const nav = await screen.findByRole('navigation', { name: 'DSP Integration' })
    expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual([
      'Exchange settings', 'Advertiser settings', 'Shared Targeting Variables',
      'Google DSP — Live', 'Amazon Ads DSP — Connection error', 'The Trade Desk — Not set up yet',
    ])
    expect(within(nav).getByText('3 advertisers · floor AUD 100 CPM')).toBeInTheDocument()
    expect(within(nav).getByText('Adopts company lists')).toBeInTheDocument()
    expect(within(nav).getByText('Own advertiser lists')).toBeInTheDocument()
  })

  it('Exchange settings: four required fields, Published, and where sellers.json is', async () => {
    renderAt('/dsp-integration/exchange')
    expect(await screen.findByRole('heading', { name: /Exchange settings/ })).toBeInTheDocument()
    for (const label of ['Organisation', 'Domain', 'Seller ID', 'Ad-ops contact email']) expect(screen.getByLabelText(new RegExp(label))).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText('https://demoretail.example/sellers.json')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('shows Incomplete until the saved settings are complete', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/exchange': { ...exchange, sellerId: '', published: false, sellersJsonUrl: null } })))
    renderAt('/dsp-integration/exchange')
    expect(await screen.findByText('Incomplete')).toBeInTheDocument()
    expect(screen.getByText('Complete all four fields before any DSP can be sent bid requests.')).toBeInTheDocument()
  })

  it('is hidden with the flag off', async () => {
    renderAt('/display-types', false)
    await screen.findByRole('link', { name: /Display Types/ })
    expect(screen.queryByRole('link', { name: /DSP Integration/ })).not.toBeInTheDocument()
  })
})

/* The retailer's DSP integration switch (Rob, 24 Sep 2026). */
describe('DSP integration switch', () => {
  const OFF = { ...exchange, enabled: false, published: false, sellersJsonUrl: null }
  const FIRST_VISIT = { ...OFF, organisation: '', domain: '', sellerId: '', contactEmail: '' }
  const navLabels = async () => {
    const nav = await screen.findByRole('navigation', { name: 'Display Types and DSP Integration' }).catch(() => null)
    /* A link's text starts with its icon's ligature name ("campaign…"). */
    return nav ? within(nav).getAllByRole('link').map((l) => l.textContent?.replace(/^[a-z_]+/, '')) : []
  }

  it('first visit: switched off, and the switch is all Exchange settings shows', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/exchange': FIRST_VISIT, '/api/admin/v1/features': { dspIntegration: false } })))
    renderAt('/dsp-integration')
    const toggle = await screen.findByRole('switch', { name: 'Enable DSP Integration' })
    expect(toggle).not.toBeChecked()
    /* Its tooltip says what it is for, at a high level (Rob, 24 Sep 2026). */
    expect(screen.getByRole('button', { name: /retail media network.*sell ad inventory on your in-store screens.*new revenue opportunity/ })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Organisation/)).not.toBeInTheDocument()
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument()
    /* Only Exchange settings in the section's list, and no DSPs yet. */
    const list = screen.getByRole('navigation', { name: 'DSP Integration' })
    expect(within(list).getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual(['Exchange settings'])
    expect(within(list).getByText('DSP integration off')).toBeInTheDocument()
  })

  it('switching on shows the seller-of-record fields, as an unsaved change', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/exchange': FIRST_VISIT, '/api/admin/v1/features': { dspIntegration: false } })))
    renderAt('/dsp-integration/exchange')
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable DSP Integration' }))
    for (const label of ['Organisation', 'Domain', 'Seller ID', 'Ad-ops contact email']) expect(screen.getByLabelText(new RegExp(label))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    /* Off again before saving: back to nothing to save. */
    fireEvent.click(screen.getByRole('switch', { name: 'Enable DSP Integration' }))
    expect(screen.queryByLabelText(/Organisation/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('saves the switch with the kept fields, and the nav follows', async () => {
    const calls: { url: string; body: unknown }[] = []
    let state = { ...exchange }
    const base = fakeFetch()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0]
      if (path === '/api/admin/v1/exchange' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        calls.push({ url: path, body })
        state = { ...body, published: body.enabled, sellersJsonUrl: body.enabled ? exchange.sellersJsonUrl : null }
        return new Response(JSON.stringify(state), { status: 200 })
      }
      if (path === '/api/admin/v1/exchange') return new Response(JSON.stringify(state), { status: 200 })
      if (path === '/api/admin/v1/features') return new Response(JSON.stringify({ dspIntegration: state.enabled }), { status: 200 })
      return base(url)
    }))
    renderAt('/dsp-integration/exchange')
    await waitFor(async () => expect(await navLabels()).toContain('Campaign Status'))
    expect(await navLabels()).toContain('Advertisers / Inventory')

    fireEvent.click(await screen.findByRole('switch', { name: 'Enable DSP Integration' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    /* Nothing is thrown away: the seller of record goes back as it was. */
    expect(calls[0].body).toEqual({ enabled: false, organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example' })
    await waitFor(async () => expect(await navLabels()).not.toContain('Campaign Status'))
    expect(await navLabels()).not.toContain('Advertisers / Inventory')
    expect(await navLabels()).toContain('DSP Integration')

    fireEvent.click(await screen.findByRole('switch', { name: 'Enable DSP Integration' }))
    expect((screen.getByLabelText(/Organisation/) as HTMLInputElement).value).toBe('Demo Retail Group')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toMatchObject({ enabled: true })
    await waitFor(async () => expect(await navLabels()).toContain('Campaign Status'))
    expect(await screen.findByText('Published')).toBeInTheDocument()
  }, 30_000)

  it('switched off: Campaign Status and Advertisers / Inventory are hidden and their links go home', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/exchange': OFF, '/api/admin/v1/features': { dspIntegration: false } })))
    const router = renderAt('/advertisers')
    await waitFor(() => expect(router.state.location.pathname).toBe('/display-types'))
    expect(await navLabels()).toEqual(['Display Types', 'Playlist Management', 'DSP Integration'])
    cleanup()
    const campaigns = renderAt('/campaign-status')
    await waitFor(() => expect(campaigns.state.location.pathname).toBe('/display-types'))
  })

  it('switched on but not yet published: a DSP page opens Exchange settings instead', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/exchange': { ...exchange, sellerId: '', published: false, sellersJsonUrl: null } })))
    const router = renderAt('/dsp-integration/partners/p_google')
    expect(await screen.findByRole('heading', { name: /Exchange settings/ })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/dsp-integration/exchange')
    expect(screen.getByRole('switch', { name: 'Enable DSP Integration' })).toBeChecked()
    expect(screen.getByText('Incomplete')).toBeInTheDocument()
  })
})

describe('Advertiser settings page', () => {
  it('shows Pricing, the Auction schedule, the four lists and Where these apply, in that order', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/available-inventory': { items: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', slot: 2, position: 'Supplier slot', partnerName: 'Google DSP' }] } })))
    renderAt('/dsp-integration')
    expect(await screen.findByRole('heading', { name: /Advertiser settings/ })).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    const order = ['Pricing', 'Auction schedule', 'Auction opens', 'Play-window length', 'Auction cutoff time', 'List management', 'Where these apply'].map((h) => text.indexOf(h))
    /* Available Inventory moved to Advertisers / Inventory (Rob, 20 Sep). */
    expect(text).not.toContain('Available Inventory')
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(screen.getByLabelText(/Currency/)).toBeInTheDocument()
    /* Stored in hours, shown as days and hours: 168 h = 7 days, 24 h = 1 day. */
    expect((document.getElementById('auctionOpensHours') as HTMLInputElement).value).toBe('7')
    expect((document.getElementById('playWindowHours') as HTMLInputElement).value).toBe('1')
    expect(screen.getByText('18:00 UTC')).toBeInTheDocument()
    for (const l of ['Advertisers — whitelist', 'Advertisers — blacklist', 'Categories — whitelist', 'Categories — blacklist']) expect(screen.getByRole('region', { name: l })).toBeInTheDocument()
    const where = screen.getByRole('list', { name: 'Where these apply' })
    expect(within(where).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Adopting'), expect.stringContaining('Own lists')])
    expect(screen.queryByText('Advertisers', { selector: '.ag-header-cell-text' })).not.toBeInTheDocument()
  })
})

describe('Where DSP Integration opens', () => {
  it('opens Exchange settings until the exchange is published, then Advertiser settings', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/exchange': { ...exchange, organisation: '', published: false, sellersJsonUrl: null } })))
    const unpublished = renderAt('/dsp-integration')
    expect(await screen.findByRole('heading', { name: /Exchange settings/ })).toBeInTheDocument()
    expect(unpublished.state.location.pathname).toBe('/dsp-integration/exchange')
    cleanup()
    vi.stubGlobal('fetch', vi.fn(fakeFetch()))
    const published = renderAt('/dsp-integration')
    expect(await screen.findByRole('heading', { name: /Advertiser settings/ })).toBeInTheDocument()
    expect(published.state.location.pathname).toBe('/dsp-integration/advertiser-settings')
  })
})

describe('Shared Targeting Variables page', () => {
  it('has two groups, each a Variable / DSPs table, with access shown as pills', async () => {
    renderAt('/dsp-integration/targeting-variables')
    expect(await screen.findByRole('heading', { name: /Shared Targeting Variables/ })).toBeInTheDocument()
    expect(screen.getByText('Localisation Variables')).toBeInTheDocument()
    expect(screen.getByText('Personalisation Variables')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Variables shared through the API/ })).toBeInTheDocument()
  })
})

describe('DSP page', () => {
  it('shows issues first, then Mode, Connection credentials, Bidder integration and the lists; secrets masked', async () => {
    renderAt('/dsp-integration/partners/p_amazon')
    expect(await screen.findByRole('heading', { name: 'Amazon Ads DSP' })).toBeInTheDocument()
    const issues = screen.getByLabelText('Issues')
    expect(issues.textContent).toContain('Connection error: Refresh token rejected — 3 days ago. Re-enter the credentials below and re-test the connection.')
    const text = document.body.textContent ?? ''
    const order = ['Mode', 'Connection credentials', 'Bidder integration', 'Advertiser whitelist / blacklist'].map((h) => text.indexOf(h))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(screen.getByLabelText(/Refresh token/)).toHaveAttribute('type', 'password')
    expect(screen.getByText(/Unlinked — this DSP has its own lists./)).toBeInTheDocument()
    expect(screen.queryByText(/floor|CPM|currency/i, { selector: 'label' })).not.toBeInTheDocument()
  })

  it('the Add card lists what you will need, then Add partner / Cancel', async () => {
    renderAt('/dsp-integration/add/the_trade_desk')
    const card = await screen.findByRole('region', { name: 'Add The Trade Desk' })
    expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Supply source ID', 'TTD partner ID', 'API token', 'Region', 'Bidder endpoint and seat IDs'])
    expect(within(card).getByRole('button', { name: /Add partner/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})

describe('Advertisers screen (admin only)', () => {
  const advertisers = { currency: 'AUD', floorCpm: 100, items: [{ advertiserId: 'nestle', name: 'Nestlé', via: ['Google DSP'], approvalRequired: false, floorMultiplier: 0.8, effectiveFloorCpm: 80, campaigns: { draft: 0, awaiting_approval: 1, approved: 2, rejected: 0 } }] }

  it('sits below Campaign Status and above DSP Integration in the nav for admins, with the prototype’s columns', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/advertisers': advertisers })))
    renderAt('/advertisers')
    await screen.findByText('1 advertiser')
    const nav = screen.getByRole('navigation', { name: 'Display Types and DSP Integration' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent?.replace(/^[a-z_]+/, ''))).toEqual(['Display Types', 'Playlist Management', 'Campaign Status', 'Advertisers / Inventory', 'DSP Integration'])
    expect(screen.getByRole('button', { name: /Every advertiser using the platform, across all DSPs, and the inventory they can buy/ })).toBeInTheDocument()
  })

  it('is read-only for a marketing user, who doesn’t get DSP Integration at all', async () => {
    const advertisers = { currency: 'AUD', floorCpm: 100, items: [{ advertiserId: 'nestle', name: 'Nestlé', via: ['Google DSP'], approvalRequired: false, floorMultiplier: 0.8, effectiveFloorCpm: 80, campaigns: { draft: 0, awaiting_approval: 1, approved: 2, rejected: 0 } }] }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/session': { userId: 'u', name: 'HQ Marketing (POC)', role: 'hq_marketing' }, '/api/admin/v1/advertisers': advertisers })))
    renderAt('/advertisers')
    const nav = await screen.findByRole('navigation', { name: 'Display Types and DSP Integration' })
    /* Campaign Status and Advertisers / Inventory join once the switch is known to be on. */
    await waitFor(() => expect(within(nav).getAllByRole('link').map((l) => l.textContent?.replace(/^[a-z_]+/, ''))).toEqual(['Display Types', 'Playlist Management', 'Campaign Status', 'Advertisers / Inventory']))
    expect(await screen.findByText('Read only')).toBeInTheDocument()
    expect(await screen.findByLabelText('Nestlé: campaign approval')).toBeDisabled()
    expect(screen.getByLabelText('Nestlé: floor multiplier')).toBeDisabled()
    expect(screen.queryByRole('region', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('shows a help desk user nothing at all', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/session': { userId: 'u', name: 'HQ Help Desk (POC)', role: 'hq_helpdesk' } })))
    renderAt('/')
    expect(await screen.findByText(/These pages are for admin and marketing users/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Display Types/ })).not.toBeInTheDocument()
  })
})

describe('Campaign Status stand-in', () => {
  const campaign = {
    campaignId: 'c1', name: 'Swisse spring', source: 'api', advertiserId: 'swisse', advertiserName: 'Swisse', partnerId: 'p_google', partnerName: 'Google DSP',
    displayTypeId: 'portrait', pricingType: 'localised', activation: { enabled: false }, schedule: { nextWindowStart: '2026-09-22T00:00:00.000Z', bookedWindows: 2 },
    brief: { details: 'Spring immunity range.', promotedProducts: ['Ultiboost Immune'], objective: 'Brand Awareness', touchPoints: ['Digital Signage'] },
  }
  const hq = { campaignId: 'c_zinger', name: 'Zinger Box — hero', source: 'hq', advertiserId: null, advertiserName: null, partnerId: null, partnerName: null, displayTypeId: 'landscape', pricingType: null, activation: { enabled: true }, schedule: { nextWindowStart: null, bookedWindows: 0 } }
  const approval = {
    campaignId: 'c1', campaignName: 'Swisse spring', status: 'awaiting_approval', mode: 'manual', assetVersion: 'v1', submittedAt: null, reviewedBy: null, reviewedAt: null, reason: null,
    checks: [{ name: 'dimensions', passed: true, detail: '1080×1920 for 1080×1920.' }], targetingSummary: 'Default (localised)', creative: null, canvas: null, audit: [],
  }
  const routes = {
    '/api/admin/v1/campaigns': { items: [campaign, hq] },
    '/api/admin/v1/campaigns/c1/approval': approval,
    '/api/admin/v1/booking-schedule': { currency: 'AUD', windows: [], positions: [], revenue: [], totals: { bookedWindows: 0, bookedRevenue: 0, billedRevenue: 0 } },
  }

  it('lists only advertiser and DSP campaigns, with the status filter in the column', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(routes)))
    renderAt('/campaign-status')
    /* Heading: total + per-status counts, no "submitted by advertisers and
       DSPs" copy and no Draft count (ticket, 22 Sep — Draft never surfaces
       in a retailer-facing view). */
    await waitFor(() => expect(document.body.textContent).toMatch(/1 campaign/), { timeout: 10000 })
    expect(document.body.textContent).toMatch(/Approved.*0/)
    expect(document.body.textContent).toMatch(/Awaiting approval.*1/)
    expect(document.body.textContent).toMatch(/Rejected.*0/)
    expect(document.body.textContent).not.toMatch(/submitted by advertisers and DSPs/)
    expect(document.body.textContent).not.toMatch(/Draft/)
    const grid = screen.getByLabelText('Campaign Status')
    await new Promise((r) => setTimeout(r, 300))
    expect(await within(grid).findByText('Swisse spring', {}, { timeout: 10000 })).toBeInTheDocument()
    /* HQ's own campaigns aren't this build's business. */
    expect(within(grid).queryByText('Zinger Box — hero')).not.toBeInTheDocument()
    /* The status filter is a column filter, not chips above the table. */
    expect(screen.queryByRole('button', { name: /Awaiting approval 1/ })).not.toBeInTheDocument()
    expect(grid.querySelectorAll('.ag-floating-filter').length).toBeGreaterThan(0)
    /* The filters name themselves and list what is there (Rob, 20 Sep). */
    expect((await within(grid).findAllByLabelText('Advertiser filter', {}, { timeout: 10000 })).length).toBeGreaterThan(0)
    expect(within(grid).getAllByLabelText('DSP filter').length).toBeGreaterThan(0)
    /* Schedule first, sorted so what is up next is at the top. */
    expect([...grid.querySelectorAll('.ag-header-cell-text')].map((h) => h.textContent)).toEqual(['Schedule', 'Status', 'Name', 'Advertiser', 'DSP', 'Activation', ''])
    expect(await within(grid).findByText('2 windows booked', {}, { timeout: 10000 })).toBeInTheDocument()
    /* And a row menu for approving, rejecting, undoing a rejection, or switching a campaign on. */
    expect(within(grid).getByLabelText('Swisse spring: options')).toBeInTheDocument()
    fireEvent.click(within(grid).getByLabelText('Swisse spring: options'))
    /* Awaiting approval, not Rejected, so Undo rejection is offered but disabled. */
    expect(await screen.findByRole('menuitem', { name: /Undo rejection/ }, { timeout: 10000 })).toHaveAttribute('aria-disabled', 'true')
  })

  it('never lists a Draft campaign — a retailer only ever sees one that has been submitted', async () => {
    const draftApproval = { ...approval, status: 'draft', mode: null, submittedAt: null }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/campaigns/c1/approval': draftApproval })))
    renderAt('/campaign-status')
    await waitFor(() => expect(document.body.textContent).toMatch(/0 campaigns/), { timeout: 10000 })
    const grid = screen.getByLabelText('Campaign Status')
    await waitFor(() => expect(within(grid).queryByText('Swisse spring')).not.toBeInTheDocument(), { timeout: 10000 })
  })

  it('opens the campaign laid out like the platform: brief, targeting, scheduling, storyboard, creative', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(routes)))
    renderAt('/campaign-status/c1')
    expect(await screen.findByRole('heading', { name: 'Swisse spring' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Campaign Brief', 'Targeting', 'Scheduling', 'Storyboard & Copy', 'Creative'])
    expect(screen.getByText('Spring immunity range.')).toBeInTheDocument()
    expect(screen.getByText('Ultiboost Immune')).toBeInTheDocument()
    expect(screen.getByText('Not provided', { exact: false })).toBeInTheDocument()
    /* Approve and Reject are on the campaign too, not only in the table. */
    expect(await screen.findByRole('button', { name: /Approve/ })).toBeInTheDocument()
  })
})

describe('Booking schedule', () => {
  const schedule = {
    currency: 'AUD',
    windows: [
      { start: '2026-09-21T00:00:00.000Z', end: '2026-09-22T00:00:00.000Z' },
      { start: '2026-09-22T00:00:00.000Z', end: '2026-09-23T00:00:00.000Z' },
    ],
    positions: [{
      positionId: 'menu_board.s2', displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', slot: 2, slotLabel: 'Supplier slot', partnerNames: ['Google DSP'], assignment: 'rtb', displayCount: 3,
      windows: [
        { start: '2026-09-21T00:00:00.000Z', status: 'available', booking: null },
        { start: '2026-09-22T00:00:00.000Z', status: 'booked', booking: { reservationId: 'r1', campaignId: 'c1', advertiserId: 'swisse', partnerId: 'p_google', pricingType: 'personalised', type: 'reserve', advertiserName: 'Swisse', partnerName: 'Google DSP', cpm: 175, assumedViews: 1236, bookedRevenue: 216.3, billedRevenue: null, reach: null, layers: { default: true, localised: false, personalised: true }, personalisedTriggers: { computerVision: false, aggregateStore: false, individual: true } } },
      ],
    }],
    revenue: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', bookedWindows: 1, sellableWindows: 2, bookedRevenue: 216.3, billedRevenue: 0 }],
    byPricingType: [{ pricingType: 'personalised', bookedWindows: 1, bookedRevenue: 216.3 }],
    totals: { bookedWindows: 1, sellableWindows: 2, bookedRevenue: 216.3, billedRevenue: 0 },
  }

  it('is linked from Available Inventory, which now sits on Advertisers / Inventory', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    renderAt('/advertisers')
    expect(await screen.findByLabelText('Available Inventory')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Booking schedule/ })).toBeInTheDocument()
  })

  it('shows booking revenue, what sold by campaign type, and each slot’s windows at the price booked', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/booking-schedule': schedule })))
    renderAt('/booking-schedule')
    expect(await screen.findByRole('heading', { name: /Booking schedule/ })).toBeInTheDocument()
    const revenue = await screen.findByLabelText('Booking revenue')
    expect(await within(revenue).findAllByText('$216.30')).toHaveLength(2)
    /* Single-advertiser stacking tile (ticket, 22 Sep): one tile per booked
       window, the advertiser name at the top, stacking only the layers the
       booking actually carries. The fixture's one booking is default plus
       personalised (2 layers, no localised upsell), so the tile shows
       Swisse once (plus once more in the Advertiser column) and no
       per-layer competition — the other, unbooked window just reads
       Available. */
    const grid = await screen.findByLabelText('Booking schedule')
    expect(within(grid).getAllByText('Swisse')).toHaveLength(2) // the Advertiser column, and the tile
    expect(within(grid).getAllByText('Available')).toHaveLength(1) // the other, unbooked window
    expect(screen.queryByRole('region', { name: 'Save changes' })).not.toBeInTheDocument()
    /* Views, and DSP/advertiser as column filters like every other table (Rob, 20 Sep). */
    expect(screen.getByRole('radio', { name: 'Weekly' })).toBeInTheDocument()
    expect([...grid.querySelectorAll('.ag-header-cell-text')].slice(0, 3).map((h) => h.textContent)).toEqual(['Advertiser', 'DSP', 'Position'])
    expect(within(grid).getByLabelText('DSP filter')).toBeInTheDocument()
    expect(within(grid).getByLabelText('Advertiser filter')).toBeInTheDocument()
  })

  it('stands alone — no Display Types / DSP Integration nav — and shows the DSP that actually booked it, not every DSP merely eligible to', async () => {
    const eligibleForMore = {
      ...schedule,
      positions: [{
        /* Eligible to bid: both DSPs. Actually booked: only Google DSP
           (the fixture's one booking) — the DSP column must reflect the
           latter, not the former (ticket, 21 Sep). */
        ...schedule.positions[0], partnerNames: ['Google DSP', 'Amazon Ads DSP'],
      }],
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/booking-schedule': eligibleForMore })))
    renderAt('/booking-schedule')
    expect(await screen.findByRole('heading', { name: /Booking schedule/ })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Display Types and DSP Integration' })).not.toBeInTheDocument()
    const grid = await screen.findByLabelText('Booking schedule')
    expect(within(grid).getByText('Google DSP')).toBeInTheDocument()
    expect(within(grid).queryByText(/Amazon Ads DSP/)).not.toBeInTheDocument()
  })

  it('stacks a tile up to three layers, with a reach count on the localised layer', async () => {
    const allThree = {
      ...schedule,
      positions: [{
        ...schedule.positions[0],
        displayCount: 4,
        windows: [
          schedule.positions[0].windows[0],
          {
            start: '2026-09-22T00:00:00.000Z', status: 'booked',
            booking: {
              ...schedule.positions[0].windows[1].booking, pricingType: 'localised', reach: { matchedDisplays: 3, asOf: '2026-09-20T00:00:00.000Z' },
              layers: { default: true, localised: true, personalised: true },
              personalisedTriggers: { computerVision: true, aggregateStore: false, individual: false },
            },
          },
        ],
      }],
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/booking-schedule': allThree })))
    renderAt('/booking-schedule')
    const grid = await screen.findByLabelText('Booking schedule')
    /* All three layers on the one tile: DEFAULT, LOC with the reach count
       against the display count, and PERS with its lit trigger icon
       (ticket "Booking schedule: personalised trigger icons"). The display
       count itself now sits in brackets on the Position cell rather than
       its own Displays column (ticket "remove the displays column … show
       that number of displays in brackets after the display name", 22
       Sep). */
    expect(within(grid).getByText('(4)')).toBeInTheDocument() // the display count, on the Position cell
    expect(await within(grid).findByText('3 of 4')).toBeInTheDocument()
    expect(within(grid).getByText('DEFAULT')).toBeInTheDocument()
    /* LOC and PERS each appear twice: once on the tile's own layer row, and
       once more in the Position cell's row-level "N of M windows booked"
       summary (ticket "Also for the play windows … show a representation
       of how many are booked versus … localised … personalised …", 22
       Sep), which is always on screen now, not only in Weekly/Monthly. */
    expect(within(grid).getAllByText('LOC')).toHaveLength(2)
    expect(within(grid).getAllByText('PERS')).toHaveLength(2)
  })
})

describe('Advertisers / Inventory', () => {
  it('filters both tables by column, and shows what each slot supports and who may buy it', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    renderAt('/advertisers')
    const advertisers = await screen.findByLabelText('Advertisers')
    /* Column filters, as on every other table: search on the name, funnels on the value columns. */
    expect(within(advertisers).getByLabelText('Advertiser search')).toBeInTheDocument()
    expect(within(advertisers).getByLabelText('Via filter')).toBeInTheDocument()
    expect(within(advertisers).getByLabelText('Campaign approval filter')).toBeInTheDocument()
    expect(screen.getByText('2 advertisers')).toBeInTheDocument()
    /* Bookings opens the schedule, so it is only offered to an advertiser
       that has some (Rob, 20 Sep): Nestlé has 3, Swisse none. */
    expect(within(advertisers).getAllByRole('button', { name: /Bookings/ })).toHaveLength(1)

    const inventory = await screen.findByLabelText('Available Inventory')
    expect([...inventory.querySelectorAll('.ag-header-cell-text')].map((h) => h.textContent))
      .toEqual(['Display type', 'Playlist', 'Slot', 'Position', 'Assigned to', 'Targeting supported', 'Reserve price', 'Billing unit', ''])
    expect(within(inventory).getByLabelText('Display type search')).toBeInTheDocument()
    expect(within(inventory).getByLabelText('Targeting supported filter')).toBeInTheDocument()
    /* QR Control is flagged on the display type that has it, and only that
       display type can support interactive targeting (Rob, 20 Sep). Vision/AI
       is flagged the same way, alongside it (ticket "show a computer vision
       icon when computer vision is enabled on a specific display type", 22
       Sep). */
    expect(within(inventory).getAllByLabelText('QR Control enabled')).toHaveLength(1)
    expect(within(inventory).getAllByLabelText('Vision/AI enabled')).toHaveLength(1)
    /* Both editable columns are pills: what the slot supports, and who may
       buy it. Assigned to shows "All DSPs" only when nothing is chosen. */
    const cellOf = (label: string) => within(inventory).getAllByLabelText(`Menu Board — Long Format slot 2: ${label}`)[0].closest('.ag-cell') as HTMLElement
    expect([...cellOf('targeting supported').querySelectorAll('.ant-select-selection-item')].map((t) => t.textContent)).toEqual(['Localised', 'Personalised'])
    expect([...cellOf('assigned to').querySelectorAll('.ant-select-selection-item')].map((t) => t.textContent)).toEqual(['Google DSP'])
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

  })

  it('holds a position for an advertiser, and only offers interactive where QR Control is on', async () => {
    const calls: { url: string; body: unknown }[] = []
    const saved = () => calls.find((c) => c.url.includes('available-inventory'))?.body
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') calls.push({ url, body: JSON.parse(String(init.body)) })
      return fakeFetch(ADVERTISER_PAGE)(url)
    }))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const combo = (row: string, label: string) =>
      within(within(inventory).getAllByLabelText(`${row}: ${label}`)[0].closest('.ag-cell') as HTMLElement).getByRole('combobox')

    /* Interactive needs a QR code to scan, so it is refused on Portrait. */
    fireEvent.mouseDown(combo('Portrait slot 1', 'targeting supported'))
    expect(await screen.findByText('QR Control required to support an interactive engagement')).toBeInTheDocument()
    fireEvent.keyDown(combo('Portrait slot 1', 'targeting supported'), { key: 'Escape' })

    /* Hold the Menu Board position for an advertiser: a pill, and the DSP the API adds. */
    fireEvent.mouseDown(combo('Menu Board — Long Format slot 2', 'assigned to'))
    fireEvent.click(await screen.findByTitle('Nestlé (Google DSP)'))
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    /* Only the slot that changed is sent. */
    await waitFor(() => expect(saved()).toEqual({ items: [{
      displayTypeId: 'menu_board', slot: 2, supportedTargeting: ['localised', 'personalised'],
      assignedTo: { partnerIds: ['p_google'], advertisers: ['Nestlé'], whitelistOnly: false, buyersListId: null },
      reservePriceDefault: null, billingUnitHoursDefault: null,
    }] }))
    /* This test opens two AntD Selects, drives a save round-trip and waits
       on it with real timers — already the file's slowest, and, measured in
       this sandbox, right at (and under full-suite load, occasionally over)
       the file's default 20s budget regardless of this change (Rob, 23
       Sep). A per-test override, not a global one, so a real hang elsewhere
       in the file still fails fast. */
  }, 45000)

  /* Round 2 (23 Sep) failed testing twice on this exact picker: once because
     the buyers-lists group sat after Advertisers instead of directly under
     DSPs, and — after that was fixed — again because "Add buyer list is now
     missing completely from the drop-down menu". The suite that shipped
     with that second build never actually asserted the option was there at
     all, so it went green while the picker was reported broken. This test
     is that missing assertion: the option group's position, the option
     itself, and that it actually opens the modal. */
  it('offers "+ Add new buyers list…" in the Assigned to picker, and opens the modal', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', name: 'Q4 FMCG Private Auction', description: '', invitedBuyers: [{ identifierType: 'brandEntity', value: 'brand_x' }], activeFrom: null, activeTo: null }] },
    })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const combo = within(within(inventory).getAllByLabelText('Menu Board — Long Format slot 2: assigned to')[0].closest('.ag-cell') as HTMLElement).getByRole('combobox')
    fireEvent.mouseDown(combo)
    await screen.findByRole('listbox')
    /* The full option list is long (DSPs, buyers lists, every advertiser,
       whitelist) and virtualised, which jsdom doesn't lay out the way a
       real browser does — so, as the picker's own showSearch already lets
       a person do, filter down to just this option rather than relying on
       scroll position. (Group order and dedup — round 1's own failed-
       testing feedback — were verified separately against a real rendered
       Chromium browser, not jsdom.) */
    fireEvent.change(combo, { target: { value: 'Add new buyers' } })
    const addOption = await screen.findByText('+ Add new buyers list…')
    expect(addOption).toBeInTheDocument()

    /* Choosing it is a picker action, not a real choice: it opens the
       modal and leaves this slot's own assignment untouched. (There are two
       BuyersListModal instances in the tree — this one and the Buyers
       lists table's own — so scope to the one that's actually open.) */
    fireEvent.click(addOption)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('New buyers list')).toBeInTheDocument()
  }, 30000)

  /* The modal used to show field errors only when the API sent `details`
     and say nothing at all otherwise — so a detail-less error (the hosted
     demo's read-only 403, a plain 500, anything without a `field` to blame)
     failed completely silently: the modal just sat there. That silent
     failure is what made the feature read as broken/"missing" when a round
     2 tester tried it against exactly this kind of response (Rob, 23 Sep).
     This asserts the fix: some message always shows. */
  it('shows an error when saving a buyers list fails without field-level detail, instead of failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/buyers-lists')) {
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'forbidden', message: 'This is the hosted demo: the screens are live but the data is a snapshot, so changes aren’t saved.' } }), { status: 403 }))
      }
      return fakeFetch(ADVERTISER_PAGE)(url)
    }))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const combo = within(within(inventory).getAllByLabelText('Menu Board — Long Format slot 2: assigned to')[0].closest('.ag-cell') as HTMLElement).getByRole('combobox')
    fireEvent.mouseDown(combo)
    await screen.findByRole('listbox')
    fireEvent.change(combo, { target: { value: 'Add new buyers' } })
    fireEvent.click(await screen.findByText('+ Add new buyers list…'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('New buyers list')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Q4 FMCG private auction'), { target: { value: 'Test deal' } })
    fireEvent.change(within(dialog).getByLabelText('Invited buyer 1: value'), { target: { value: 'brand_x' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create buyers list' }))

    /* The modal stays open (the save failed) but says so, rather than
       silently doing nothing. */
    expect(await screen.findByText(/the data is a snapshot/)).toBeInTheDocument()
    expect(within(dialog).getByText('New buyers list')).toBeInTheDocument()
  }, 30000)

  /* The CTAs open a new tab, so they can't go through the router — and a
     bare path 404s wherever the bundle isn't served from the domain root
     (ticket d5lCFNAL: the hosted prototype routes in the hash). */
  it('opens the booking schedule at a URL that works where the bundle is served', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    const opened: string[] = []
    vi.stubGlobal('open', vi.fn((url: string) => { opened.push(url); return null }))
    renderAt('/advertisers')
    const advertisers = await screen.findByLabelText('Advertisers')
    fireEvent.click(within(advertisers).getAllByRole('button', { name: /Bookings/ })[0])
    fireEvent.click(screen.getByRole('button', { name: /Booking schedule/ }))
    /* Served from the root, as the app is inside HQ Admin: the plain route. */
    expect(opened).toEqual(['/booking-schedule?advertiserId=nestle', '/booking-schedule'])
  })

  it('in the hosted build, puts the route in the hash under the bundle\u2019s base', async () => {
    vi.stubEnv('VITE_DEMO', '1')
    vi.stubEnv('BASE_URL', './')
    const { externalUrl } = await import('../src/features/booking-schedule/path')
    expect(externalUrl('/booking-schedule')).toBe('./#/booking-schedule')
    expect(externalUrl('/booking-schedule?advertiserId=nestle')).toBe('./#/booking-schedule?advertiserId=nestle')
    vi.unstubAllEnvs()
    expect(externalUrl('/booking-schedule')).toBe('/booking-schedule')
  })

  it('shows a marketing user what each slot supports, without letting them change it', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/session': { role: 'hq_marketing', scopes: ['sections'] } })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    /* Read-only: the same values as plain text, with nothing to open. */
    expect(within(inventory).getByText('Localised, Personalised')).toBeInTheDocument()
    expect(within(inventory).getByText('Google DSP')).toBeInTheDocument()
    expect(within(inventory).queryAllByRole('combobox')).toHaveLength(0)
    expect(await screen.findByText('Read only')).toBeInTheDocument()
  })
})

describe('Pricing tooltips', () => {
  /* The floor tooltip does the VAC-d working; the other two relate themselves
     to it instead of repeating it (Rob, 20 Sep). */
  it('explain how a floor CPM becomes what an advertiser pays, without repeating the working', async () => {
    renderAt('/dsp-integration/advertiser-settings')
    await screen.findByRole('heading', { name: /Advertiser settings/ })
    const tip = (label: string) => screen.getByText(label).closest('label')!.querySelector('[role="button"]') as HTMLElement
    fireEvent.mouseEnter(tip('Floor price (CPM)'))
    expect(await screen.findByText(/× attention \(VAC: the share who actually look\)/)).toBeInTheDocument()
    expect(screen.getByText(/100 × 27 ÷ 1,000/)).toBeInTheDocument()

    /* Each of the other two says how it relates to the floor, and nothing
       from the floor's own working appears inside it. */
    const bubble = (text: RegExp) => screen.getByText(text).closest('.ant-tooltip-inner') as HTMLElement
    fireEvent.mouseEnter(tip('Personalised multiplier'))
    await screen.findByText(/It multiplies the/)
    expect(bubble(/It multiplies the/).textContent).toMatch(/floor price/)
    expect(bubble(/It multiplies the/).textContent).not.toMatch(/VAC-d|attention/)

    /* Interactive is a fee per engagement now, not a multiplier. */
    fireEvent.mouseEnter(tip('Interactive cost per engagement'))
    await screen.findByText(/Charged per engagement/)
    expect(bubble(/Charged per engagement/).textContent).toMatch(/on top of the CPM/)
    expect(bubble(/Charged per engagement/).textContent).not.toMatch(/VAC-d|attention/)
  })
})
