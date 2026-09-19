import { render, screen, within } from '@testing-library/react'
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
  it('shows Pricing, the Auction schedule, the four lists, Where these apply and Available Inventory, in that order', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/available-inventory': { items: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', slot: 2, position: 'Supplier slot', partnerName: 'Google DSP' }] } })))
    renderAt('/dsp-integration')
    expect(await screen.findByRole('heading', { name: /Advertiser settings/ })).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    const order = ['Pricing', 'Auction schedule', 'Auction opens', 'Play-window length', 'Auction cutoff time', 'List management', 'Where these apply', 'Available Inventory'].map((h) => text.indexOf(h))
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
  const advertisers = { currency: 'AUD', floorCpm: 100, items: [{ advertiserId: 'nestle', name: 'Nestlé', via: ['Google DSP'], approvalRequired: false, floorMultiplier: 0.8, effectiveFloorCpm: 80 }] }

  it('sits directly below DSP Integration in the nav for admins, with the prototype’s columns', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/advertisers': advertisers })))
    renderAt('/advertisers')
    await screen.findByText('Admin only')
    const nav = screen.getByRole('navigation', { name: 'Display Types and DSP Integration' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent?.replace(/^[a-z_]+/, ''))).toEqual(['Display Types', 'Playlist Management', 'DSP Integration', 'Advertisers', 'Campaigns (POC)'])
    expect(screen.getByRole('button', { name: 'Every advertiser using the platform, across all DSPs.' })).toBeInTheDocument()
  })

  it('is not in the nav for a non-admin session', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/session': { userId: 'u', name: 'HQ User (POC)', role: 'hq_user' } })))
    renderAt('/display-types')
    await screen.findByRole('link', { name: /DSP Integration/ })
    expect(screen.queryByRole('link', { name: /Advertisers/ })).not.toBeInTheDocument()
  })
})

describe('Campaigns (POC) stand-in', () => {
  it('is labelled as a stand-in and shows the approval filter with counts', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      '/api/admin/v1/campaigns': { items: [{ campaignId: 'c1', name: 'Swisse spring', source: 'api', advertiserId: 'swisse', advertiserName: 'Swisse', partnerId: 'p_google', partnerName: 'Google DSP', displayTypeId: 'portrait', pricingType: 'localised', activation: { enabled: false } }] },
      '/api/admin/v1/approvals': { counts: { draft: 0, awaiting_approval: 1, approved: 0, rejected: 0 }, items: [], nextCursor: null },
      '/api/admin/v1/campaigns/c1/approval': { campaignId: 'c1', status: 'awaiting_approval', mode: 'manual', assetVersion: 'v1', submittedAt: null, reviewedBy: null, reviewedAt: null, reason: null, checks: [] },
    })))
    renderAt('/campaigns-poc')
    expect(await screen.findByText('Campaigns (POC)', { selector: 'div' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Awaiting approval 1/ })).toBeInTheDocument()
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
        { start: '2026-09-22T00:00:00.000Z', status: 'booked', booking: { reservationId: 'r1', type: 'reserve', advertiserName: 'Swisse', partnerName: 'Google DSP', cpm: 175, assumedViews: 1236, bookedRevenue: 216.3, billedRevenue: null } },
      ],
    }],
    revenue: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', bookedWindows: 1, bookedRevenue: 216.3, billedRevenue: 0 }],
    totals: { bookedWindows: 1, bookedRevenue: 216.3, billedRevenue: 0 },
  }

  it('is linked from Available Inventory', async () => {
    renderAt('/dsp-integration/advertiser-settings')
    expect(await screen.findByRole('button', { name: /Booking schedule/ })).toBeInTheDocument()
  })

  it('shows booking revenue per display type and each slot’s windows, booked at their price, with no save bar', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/booking-schedule': schedule })))
    renderAt('/dsp-integration/booking-schedule')
    expect(await screen.findByRole('heading', { name: /Booking schedule/ })).toBeInTheDocument()
    const revenue = await screen.findByLabelText('Booking revenue')
    expect(await within(revenue).findAllByText('$216.30')).toHaveLength(2)
    const grid = screen.getByLabelText('Booking schedule')
    expect(await within(grid).findByText('Swisse')).toBeInTheDocument()
    expect(within(grid).getByText(/175 CPM/)).toBeInTheDocument()
    expect(within(grid).getByText('Available')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})
