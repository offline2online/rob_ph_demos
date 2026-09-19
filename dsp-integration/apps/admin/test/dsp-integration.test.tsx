import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'
import { exchange, fakeFetch } from './fixtures'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch())))
afterEach(() => vi.unstubAllGlobals())

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

  it('sits directly below DSP Integration in the nav for admins, with the prototype’s columns', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/advertisers': advertisers })))
    renderAt('/advertisers')
    await screen.findByText('Admin only')
    const nav = screen.getByRole('navigation', { name: 'Display Types and DSP Integration' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent?.replace(/^[a-z_]+/, ''))).toEqual(['Display Types', 'Playlist Management', 'DSP Integration', 'Advertisers / Inventory', 'Campaign Status'])
    expect(screen.getByRole('button', { name: /Every advertiser using the platform, across all DSPs, and the inventory they can buy/ })).toBeInTheDocument()
  })

  it('is not in the nav for a non-admin session', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/session': { userId: 'u', name: 'HQ User (POC)', role: 'hq_user' } })))
    renderAt('/display-types')
    await screen.findByRole('link', { name: /DSP Integration/ })
    expect(screen.queryByRole('link', { name: /Advertisers/ })).not.toBeInTheDocument()
  })
})

describe('Campaign Status stand-in', () => {
  const campaign = {
    campaignId: 'c1', name: 'Swisse spring', source: 'api', advertiserId: 'swisse', advertiserName: 'Swisse', partnerId: 'p_google', partnerName: 'Google DSP',
    displayTypeId: 'portrait', pricingType: 'localised', activation: { enabled: false },
    brief: { details: 'Spring immunity range.', promotedProducts: ['Ultiboost Immune'], objective: 'Brand Awareness', touchPoints: ['Digital Signage'] },
  }
  const hq = { campaignId: 'c_zinger', name: 'Zinger Box — hero', source: 'hq', advertiserId: null, advertiserName: null, partnerId: null, partnerName: null, displayTypeId: 'landscape', pricingType: null, activation: { enabled: true } }
  const approval = {
    campaignId: 'c1', campaignName: 'Swisse spring', status: 'awaiting_approval', mode: 'manual', assetVersion: 'v1', submittedAt: null, reviewedBy: null, reviewedAt: null, reason: null,
    checks: [{ name: 'dimensions', passed: true, detail: '1080×1920 for 1080×1920.' }], targetingSummary: 'Baseline (localised)', creative: null, canvas: null, audit: [],
  }
  const routes = {
    '/api/admin/v1/campaigns': { items: [campaign, hq] },
    '/api/admin/v1/campaigns/c1/approval': approval,
    '/api/admin/v1/booking-schedule': { currency: 'AUD', windows: [], positions: [], revenue: [], totals: { bookedWindows: 0, bookedRevenue: 0, billedRevenue: 0 } },
  }

  it('lists only advertiser and DSP campaigns, with the status filter in the column', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(routes)))
    renderAt('/campaign-status')
    expect(await screen.findByText(/campaigns submitted by advertisers and DSPs/)).toBeInTheDocument()
    const grid = screen.getByLabelText('Campaign Status')
    await new Promise((r) => setTimeout(r, 300))
    expect(await within(grid).findByText('Swisse spring', {}, { timeout: 10000 })).toBeInTheDocument()
    /* HQ's own campaigns aren't this build's business. */
    expect(within(grid).queryByText('Zinger Box — hero')).not.toBeInTheDocument()
    /* The status filter is a column filter, not chips above the table. */
    expect(screen.queryByRole('button', { name: /Awaiting approval 1/ })).not.toBeInTheDocument()
    expect(grid.querySelectorAll('.ag-floating-filter').length).toBeGreaterThan(0)
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
      positionId: 'menu_board.s2', displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', slot: 2, slotLabel: 'Supplier slot', partnerName: 'Google DSP', assignment: 'rtb',
      windows: [
        { start: '2026-09-21T00:00:00.000Z', status: 'available', booking: null },
        { start: '2026-09-22T00:00:00.000Z', status: 'booked', booking: { reservationId: 'r1', campaignId: 'c1', advertiserId: 'swisse', partnerId: 'p_google', pricingType: 'personalised', type: 'reserve', advertiserName: 'Swisse', partnerName: 'Google DSP', cpm: 175, assumedViews: 1236, bookedRevenue: 216.3, billedRevenue: null } },
      ],
    }],
    revenue: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', bookedWindows: 1, bookedRevenue: 216.3, billedRevenue: 0 }],
    byPricingType: [{ pricingType: 'personalised', bookedWindows: 1, bookedRevenue: 216.3 }],
    totals: { bookedWindows: 1, bookedRevenue: 216.3, billedRevenue: 0 },
  }

  it('is linked from Available Inventory, which now sits on Advertisers / Inventory', async () => {
    const advertisers = { currency: 'AUD', floorCpm: 100, items: [{ advertiserId: 'nestle', name: 'Nestlé', via: ['Google DSP'], approvalRequired: false, floorMultiplier: 0.8, effectiveFloorCpm: 80, campaigns: { draft: 0, awaiting_approval: 1, approved: 2, rejected: 0 } }] }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/advertisers': advertisers, '/api/admin/v1/available-inventory': { items: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', slot: 2, position: 'Supplier slot', partnerName: 'Google DSP' }] } })))
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
    const grid = screen.getByLabelText('Booking schedule')
    expect(await within(grid).findByText('Swisse')).toBeInTheDocument()
    expect(within(grid).getByText(/personalised · 175 CPM/)).toBeInTheDocument()
    expect(within(grid).getByText('Available')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Save changes' })).not.toBeInTheDocument()
    /* Filters and views (Rob, 20 Sep). */
    expect(screen.getByRole('radio', { name: 'Weekly' })).toBeInTheDocument()
    expect(screen.getByText('All advertisers')).toBeInTheDocument()
    expect(screen.getByText('All DSPs')).toBeInTheDocument()
  })
})

describe('Pricing tooltips', () => {
  it('explain how a floor CPM becomes what an advertiser pays, and how the multipliers stack', async () => {
    renderAt('/dsp-integration/advertiser-settings')
    await screen.findByRole('heading', { name: /Advertiser settings/ })
    const tip = (label: string) => screen.getByText(label).closest('label')!.querySelector('[role="button"]') as HTMLElement
    fireEvent.mouseEnter(tip('Floor price (CPM)'))
    expect(await screen.findByText(/× attention \(VAC: the share who actually look\)/)).toBeInTheDocument()
    expect(screen.getByText(/100 × 27 ÷ 1,000/)).toBeInTheDocument()
    fireEvent.mouseEnter(tip('Personalised multiplier'))
    expect(await screen.findByText(/100 × 1.5 = /)).toBeInTheDocument()
    fireEvent.mouseEnter(tip('Interactive multiplier'))
    expect(await screen.findByText(/100 × 1.5 × 3 = /)).toBeInTheDocument()
  })
})
