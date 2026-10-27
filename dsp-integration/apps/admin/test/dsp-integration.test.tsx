import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'
import { SWITCH_TIP } from '../src/features/dsp-integration/ExchangeSettings'
import { advertiserSettings, exchange, fakeFetch } from './fixtures'
import { slow } from './timeouts'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(fakeFetch())))
afterEach(() => vi.unstubAllGlobals())

/* Advertisers / Inventory: two advertisers, and two sellable slots — one
   left at the default (localised only), one opened up. */
const ADVERTISER_PAGE = {
  '/api/admin/v1/advertisers': {
    currency: 'AUD', floorCpm: 100,
    items: [
      { advertiserId: 'nestle', name: 'Nestlé', via: ['Google DSP'], dspSeats: [{ partnerId: 'p_google', seatId: 'seat-nestle', partnerName: 'Google DSP', seatName: null, synced: true }], approvalRequired: false, bookings: 3, campaigns: { draft: 0, awaiting_approval: 1, approved: 2, rejected: 0 } },
      { advertiserId: 'swisse', name: 'Swisse', via: ['Google DSP', 'Amazon Ads DSP'], approvalRequired: true, bookings: 0, campaigns: { draft: 1, awaiting_approval: 0, approved: 0, rejected: 0 } },
    ],
  },
  '/api/admin/v1/available-inventory': {
    items: [
      {
        displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', playlistId: 'pl_menu', unassigned: false, displayCount: 12, scored: true, unsellableReason: null, slot: 2, zoneSlot: 2, position: 'Supplier slot',
        assignedTo: { partnerIds: ['p_google'], partnerNames: ['Google DSP'], advertisers: [], whitelistOnly: false }, qrControl: true, visionAi: true,
        floorCpm: 100, floorCpmOverride: null, platformFloorCpm: 100,
      },
      {
        displayTypeId: 'portrait', displayTypeName: 'Portrait', touchPoint: 'Digital Signage', playlistName: 'Portrait Playlist', playlistId: 'pl_portrait', unassigned: false, displayCount: 1, scored: true, unsellableReason: null, slot: 1, zoneSlot: 1, position: 'Slot 1',
        assignedTo: { partnerIds: [], partnerNames: [], advertisers: [], whitelistOnly: false }, qrControl: false, visionAi: false,
        floorCpm: 100, floorCpmOverride: null, platformFloorCpm: 100,
      },
    ],
    dsps: [
      { partnerId: 'p_google', name: 'Google DSP', advertisers: [{ advertiserId: 'nestle', name: 'Nestlé' }, { advertiserId: 'swisse', name: 'Swisse' }] },
      { partnerId: 'p_amazon', name: 'Amazon Ads DSP', advertisers: [{ advertiserId: 'loreal', name: "L'Oréal" }] },
    ],
  },
}

const renderAt = (path: string, dspIntegration = true, selfService = false, changeHistory = true, dealTargeting = false) => {
  const router = createMemoryRouter(appRoutes({ dspIntegration, selfService, changeHistory, dealTargeting }), { initialEntries: [path] })
  render(<Providers><RouterProvider router={router} /></Providers>)
  return router
}

describe('DSP Integration section', () => {
  /* Ticket pM0Bc2pO8WnxeV9UpI8e (28 Sep 2026): the explanation of DSP
     integration sits on the page title, like Playlist Management's and
     Advertisers / Inventory's, and no longer beside the switch; Display
     Types gets a page-title tooltip of its own. */
  it('explains DSP integration from the page title, not from the switch', async () => {
    renderAt('/dsp-integration/exchange')
    const toggle = await screen.findByRole('switch', { name: 'Enable DSP Integration' })
    expect(screen.getByRole('button', { name: SWITCH_TIP })).toBeInTheDocument()
    expect(within(toggle.parentElement as HTMLElement).queryByRole('button', { name: SWITCH_TIP })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: SWITCH_TIP })).toHaveLength(1)
  })

  it('gives Display Types a page-title tooltip', async () => {
    renderAt('/display-types')
    expect(await screen.findByRole('button', { name: /A display type describes a kind of screen/ }, { timeout: 10000 })).toBeInTheDocument()
  })

  it('lists the company pages and the three DSPs in onboarding order, with their state', async () => {
    renderAt('/dsp-integration/exchange')
    const nav = await screen.findByRole('navigation', { name: 'DSP Integration' })
    expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual([
      'DSP integration', 'Advertiser settings', 'Shared Targeting Variables', 'Change history',
      'Google DSP — Live', 'Amazon Ads DSP — Connection error', 'The Trade Desk — Not set up yet',
    ])
    expect(within(nav).getByText('Floor CPM, play configuration, real-time bidding, category lists')).toBeInTheDocument()
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
    /* Advertiser settings and the DSPs wait; the rest of the company pages stay (Rob, 9 Oct 2026). */
    const list = screen.getByRole('navigation', { name: 'DSP Integration' })
    expect(within(list).getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual(['DSP integration', 'Shared Targeting Variables', 'Change history'])
    expect(within(list).getByText('Exchange settings')).toBeInTheDocument()
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
    await waitFor(async () => expect(await navLabels()).toContain('Advertisers / Inventory'))

    fireEvent.click(await screen.findByRole('switch', { name: 'Enable DSP Integration' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    /* Nothing is thrown away: the seller of record goes back as it was. */
    expect(calls[0].body).toEqual({ enabled: false, organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example', globalDealEnabled: false })
    /* Advertisers / Inventory stays: direct advertisers use it with no DSP (Rob, 9 Oct 2026). */
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(await navLabels()).toContain('Advertisers / Inventory')
    expect(await navLabels()).toContain('Advertiser Settings')

    fireEvent.click(await screen.findByRole('switch', { name: 'Enable DSP Integration' }))
    expect((screen.getByLabelText(/Organisation/) as HTMLInputElement).value).toBe('Demo Retail Group')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toMatchObject({ enabled: true })
    await waitFor(async () => expect(await navLabels()).toContain('Advertisers / Inventory'))
    expect(await screen.findByText('Published')).toBeInTheDocument()
  }, slow(30_000))

  it('switched off: Advertisers / Inventory and Shared Targeting Variables stay open; Campaign schedule is hidden', async () => {
    const advertisers = { currency: 'AUD', floorCpm: 100, items: [] }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/exchange': OFF, '/api/admin/v1/features': { dspIntegration: false }, '/api/admin/v1/advertisers': advertisers })))
    const router = renderAt('/advertisers')
    await waitFor(async () => expect(await navLabels()).toEqual(['Display Types', 'Playlist Management', 'Advertisers / Inventory', 'Advertiser Settings']))
    expect(router.state.location.pathname).toBe('/advertisers')
    cleanup()
    const variables = renderAt('/dsp-integration/targeting-variables')
    expect(await screen.findByRole('heading', { name: /Shared Targeting Variables/ })).toBeInTheDocument()
    expect(variables.state.location.pathname).toBe('/dsp-integration/targeting-variables')
    cleanup()
    const settings = renderAt('/dsp-integration/advertiser-settings')
    expect(await screen.findByRole('heading', { name: /Exchange settings/ })).toBeInTheDocument()
    expect(settings.state.location.pathname).toBe('/dsp-integration/exchange')
    cleanup()
    /* Campaign Status is no longer a nav item of its own — it's the second
       tab of Campaign schedule, gated the same way. */
    const campaigns = renderAt('/booking-schedule')
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
  it('shows Pricing, Play configuration, Real-time bidding and the category lists, in that order, with no Play config boxes, with no auction timing', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/available-inventory': { items: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', displayCount: 12, slot: 2, position: 'Supplier slot', partnerName: 'Google DSP' }] } })))
    renderAt('/dsp-integration')
    expect(await screen.findByRole('heading', { name: /Advertiser settings/ })).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    const order = ['Pricing', 'Play configuration', 'Real-time bidding', 'Category lists'].map((h) => text.indexOf(h))
    /* Available Inventory moved to Advertisers / Inventory (Rob, 20 Sep). */
    expect(text).not.toContain('Available Inventory')
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(screen.getByLabelText(/Currency/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Guarantee buffer/, { selector: 'input' })).toBeInTheDocument()
    /* Default committed plays is retired (21 Oct 2026): a guaranteed deal's plays are derived from its slots. */
    expect(screen.queryByLabelText(/Default committed plays/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Max play length/, { selector: 'input' })).toBeInTheDocument()
    expect(document.getElementById('uncachedRestriction')).not.toBeNull()
    expect(document.getElementById('uncachedRestrictionStart')).toBeNull()
    expect(text).not.toContain('Committed delivery volume')
    expect(text).not.toContain('Play defaults')
    expect(screen.queryByRole('group', { name: 'Play config' })).not.toBeInTheDocument()
    for (const gone of ['Deals and reservations', 'Time (derived display only)']) expect(text).not.toContain(gone)
    /* Bid lookahead: company-wide, in seconds, defaulting to 35. */
    expect(screen.getByLabelText(/Digital signage bid lookahead/, { selector: 'input' })).toHaveValue('35')
    /* Cached asset retention sits beside it: company-wide, in hours, defaulting to 48. */
    expect(screen.getByLabelText(/Cached asset retention/, { selector: 'input' })).toHaveValue('48')
    for (const gone of ['Auction schedule', 'Auction opens', 'Auction cutoff time', 'Play-window length']) expect(text).not.toContain(gone)
    expect(document.getElementById('auctionOpensHours')).toBeNull()
    expect(document.getElementById('playWindowHours')).toBeNull()
    expect(document.getElementById('auctionCutoffTime')).toBeNull()
    for (const l of ['Categories — whitelist', 'Categories — blacklist']) expect(screen.getByRole('region', { name: l })).toBeInTheDocument()
    /* Advertiser lists are each DSP's own: none at company level. */
    for (const l of ['Advertisers — whitelist', 'Advertisers — blacklist']) expect(screen.queryByRole('region', { name: l })).not.toBeInTheDocument()
    /* Categories are central only: chosen from the IAB list, never typed, and no per-DSP "where these apply". */
    expect(screen.queryByText('Where these apply')).not.toBeInTheDocument()
    const cats = screen.getByRole('region', { name: 'Categories — whitelist' })
    expect(within(cats).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(cats).getByRole('combobox', { name: /Choose an IAB category/ })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /Variables advertisers can use to localise and target campaigns/ })).toBeInTheDocument()
  })

  it('has a Values column: inactive until the variable is shared, then a multi-select with a Free text tick', async () => {
    renderAt('/dsp-integration/targeting-variables')
    await screen.findByRole('heading', { name: /Shared Targeting Variables/ })
    expect((await screen.findAllByText('Values')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Share with a DSP to define values').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Postcode values')).not.toBeInTheDocument()
    expect((await screen.findAllByLabelText('Store Open / Closed values')).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('checkbox', { name: 'Free text' }).length).toBeGreaterThan(0)
  })
})

describe('DSP page', () => {
  it('shows issues first, then Mode, Connection credentials, Bidder integration and the lists; secrets masked', async () => {
    renderAt('/dsp-integration/partners/p_amazon')
    expect(await screen.findByRole('heading', { name: 'Amazon Ads DSP' })).toBeInTheDocument()
    const issues = screen.getByLabelText('Issues')
    expect(issues.textContent).toContain('Connection error: Refresh token rejected — 3 days ago. Re-enter the credentials below and re-test the connection.')
    const text = document.body.textContent ?? ''
    const order = ['Mode', 'Connection credentials', 'Bidder integration', 'Advertiser lists'].map((h) => text.indexOf(h))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(screen.getByLabelText(/Refresh token/)).toHaveAttribute('type', 'password')
    expect(screen.getByText(/Every DSP, this one included, uses the company IAB category lists/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unlink|Relink/ })).not.toBeInTheDocument()
    /* Currency stays company-wide; the DSP's own floor is the one pricing field here (bid floor hierarchy, 7 Oct 2026). */
    expect(screen.queryByText(/currency/i, { selector: 'label' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Floor price \(CPM\)/)).toHaveAttribute('placeholder', 'Platform floor')
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
  const advertisers = { currency: 'AUD', floorCpm: 100, items: [{ advertiserId: 'nestle', name: 'Nestlé', via: ['Google DSP'], approvalRequired: false, campaigns: { draft: 0, awaiting_approval: 1, approved: 2, rejected: 0 } }] }

  it('sits below Playlist Management and above DSP Integration in the nav for admins, with the prototype’s columns', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/advertisers': advertisers })))
    renderAt('/advertisers')
    await screen.findByText('1 advertiser')
    const nav = screen.getByRole('navigation', { name: 'Display Types and DSP Integration' })
    /* Campaign Status is no longer a nav item of its own (ticket, 26 Sep
       2026) — it's the second tab of Campaign schedule, opened contextually
       from here rather than listed in the nav. */
    expect(within(nav).getAllByRole('link').map((l) => l.textContent?.replace(/^[a-z_]+/, ''))).toEqual(['Display Types', 'Playlist Management', 'Advertisers / Inventory', 'Advertiser Settings'])
    expect(screen.getByRole('button', { name: /Every advertiser using the platform, across all DSPs, and the inventory they can buy/ })).toBeInTheDocument()
  })

  it('is read-only for a marketing user, who doesn’t get DSP Integration at all', async () => {
    const advertisers = { currency: 'AUD', floorCpm: 100, items: [{ advertiserId: 'nestle', name: 'Nestlé', via: ['Google DSP'], approvalRequired: false, campaigns: { draft: 0, awaiting_approval: 1, approved: 2, rejected: 0 } }] }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/session': { userId: 'u', name: 'HQ Marketing (POC)', role: 'hq_marketing' }, '/api/admin/v1/advertisers': advertisers })))
    renderAt('/advertisers')
    const nav = await screen.findByRole('navigation', { name: 'Display Types and DSP Integration' })
    /* Advertisers / Inventory joins once the switch is known to be on. */
    await waitFor(() => expect(within(nav).getAllByRole('link').map((l) => l.textContent?.replace(/^[a-z_]+/, ''))).toEqual(['Display Types', 'Playlist Management', 'Advertisers / Inventory']))
    expect(await screen.findByText('Read only')).toBeInTheDocument()
    expect(await screen.findByLabelText('Nestlé: campaign approval')).toBeDisabled()
    expect(screen.queryByLabelText('Nestlé: floor multiplier')).not.toBeInTheDocument()
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
    displayTypeId: 'portrait', pricingType: 'localised', activation: { enabled: false }, schedule: { nextWindowStart: '2026-09-22T00:00:00.000Z', bookedWindows: 2 }, lastPlayedAt: null,
    brief: { details: 'Spring immunity range.', promotedProducts: ['Ultiboost Immune'], objective: 'Brand Awareness', touchPoints: ['Digital Signage'] },
    /* One playlist: the mandatory default layer plus one localised upsell (spec §6). */
    campaignCount: 2, localisedVariables: ['Fixed Store Segments'], localisedRuleLines: ['metro-open (priority 10): Fixed Store Segments includes selected Metro'],
    personalisedVariables: [], personalisedRuleLines: [],
  }
  const hq = {
    campaignId: 'c_zinger', name: 'Zinger Box — hero', source: 'hq', advertiserId: null, advertiserName: null, partnerId: null, partnerName: null, displayTypeId: 'landscape', pricingType: null, activation: { enabled: true }, schedule: { nextWindowStart: null, bookedWindows: 0 },
    campaignCount: 0, localisedVariables: [], localisedRuleLines: [], personalisedVariables: [], personalisedRuleLines: [],
  }
  const approval = {
    campaignId: 'c1', campaignName: 'Swisse spring', status: 'awaiting_approval', mode: 'manual', assetVersion: 'v1', submittedAt: null, reviewedBy: null, reviewedAt: null, reason: null,
    checks: [{ name: 'dimensions', passed: true, detail: '1080×1920 for 1080×1920.' }], targetingSummary: 'Default (localised)', creative: null, canvas: null, audit: [],
  }
  const routes = {
    '/api/admin/v1/campaigns': { items: [campaign, hq] },
    '/api/admin/v1/campaigns/c1/approval': approval,
    '/api/admin/v1/booking-schedule': { currency: 'AUD', windows: [], positions: [], revenue: [], dsps: [], byPricingType: [], totals: { bookedWindows: 0, bookedRevenue: 0, billedRevenue: 0 } },
  }

  it('lists only advertiser and DSP campaigns, with the status filter in the column', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(routes)))
    /* Campaign Status is the Campaign schedule section's second tab now
       (ticket, 26 Sep 2026), not its own route. */
    renderAt('/booking-schedule?tab=campaign-status')
    /* Heading: total + per-status counts, no "submitted by advertisers and
       DSPs" copy and no Draft count (ticket, 22 Sep — Draft never surfaces
       in a retailer-facing view). */
    await waitFor(() => expect(document.body.textContent).toMatch(/1 campaign/), { timeout: 10000 })
    /* The Approved / Awaiting approval / Rejected selector is gone (ticket dinPPBl9Rk95UbrXoRbt): status is filtered in its column. */
    expect(screen.queryByRole('button', { name: /^Awaiting approval\s*\d/ })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/submitted by advertisers and DSPs/)
    expect(document.body.textContent).not.toMatch(/Draft/)
    const grid = screen.getByLabelText('Campaign Status')
    await new Promise((r) => setTimeout(r, 300))
    expect(await within(grid).findByText('Swisse spring', {}, { timeout: 10000 })).toBeInTheDocument()
    /* HQ's own campaigns aren't this build's business. */
    expect(within(grid).queryByText('Zinger Box — hero')).not.toBeInTheDocument()
    /* The status filter is a column filter. */
    expect(grid.querySelectorAll('.ag-floating-filter').length).toBeGreaterThan(0)
    /* The filters name themselves and list what is there (Rob, 20 Sep). */
    expect((await within(grid).findAllByLabelText('Advertiser / Campaign name filter', {}, { timeout: 10000 })).length).toBeGreaterThan(0)
    /* One locked Advertiser / Campaign name column: search and funnel; no DSP column (ticket QstRAlo3YCi7erFD0maN). */
    expect(within(grid).getByLabelText('Advertiser / Campaign name search')).toBeInTheDocument()
    expect(within(grid).queryByLabelText('DSP filter')).not.toBeInTheDocument()
    /* Touch points and Display types filter from a list; Creative ID and Deal ID take pasted text. */
    expect(within(grid).getAllByLabelText('Touch points filter').length).toBeGreaterThan(0)
    expect(within(grid).getAllByLabelText('Display types filter').length).toBeGreaterThan(0)
    expect(within(grid).getByLabelText('Creative ID search')).toBeInTheDocument()
    expect(within(grid).getByLabelText('Deal ID search')).toBeInTheDocument()
    /* Pinned left: the selection box, Status and Advertiser; one row is one campaign
       (ticket IDGsyELBJsjlAYjizSqT), grouped by advertiser. Order per ticket
       HDh2GwTa7m8jaqidBvBY: Activation sits right of Playback Strategy, Received right of Activation, Last used last. */
    expect([...grid.querySelectorAll('.ag-header-cell-text')].map((h) => h.textContent)).toEqual([
      '', 'Status', 'Advertiser / Campaign name', 'Touch point(s)', 'Display type(s)', 'Creative ID', 'Deal ID', 'Playback Strategy', 'Activation', 'Flight start', 'Received', 'Last used', '',
    ])
    expect(await within(grid).findByText('Swisse spring', {}, { timeout: 10000 })).toBeInTheDocument()
    /* The touch points it runs on, and its Playback Strategy pill (the localised layer; hover lists its rules). */
    expect(within(grid).getByText('Digital Signage')).toBeInTheDocument()
    expect(within(grid).getByText('LOCALISED')).toBeInTheDocument()
    expect(within(grid).getByLabelText('Playback Strategy filter')).toBeInTheDocument()
    /* Nothing targeted on the personalised layer for this playlist. */
    expect(within(grid).getAllByText('—').length).toBeGreaterThan(0)
    /* And a row menu for opening, undoing a rejection, or switching a campaign on — approving and rejecting are by selection. */
    expect(within(grid).getByLabelText('Swisse spring: options')).toBeInTheDocument()
    fireEvent.click(within(grid).getByLabelText('Swisse spring: options'))
    /* Awaiting approval, not Rejected, so Undo rejection is offered but disabled; the decide actions are offered (ticket jPQSz9EBmt0P2geHXp6l). */
    expect(await screen.findByRole('menuitem', { name: /Undo rejection/ }, { timeout: 10000 })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Approve campaign' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Reject campaign' })).toBeInTheDocument()
  }, slow(45000))

  /* Ticket gtkZHpDXBXqYk1GFL2Mf: hovering Rejected shows why. */
  it('shows the rejection details when hovering a Rejected status', async () => {
    const rejected = { ...approval, status: 'rejected', reasonCode: 'other', reason: 'Logo is blurry', reviewedBy: 'hq@retailer.test', reviewedAt: '2026-10-20T01:00:00.000Z' }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/campaigns/c1/approval': rejected })))
    renderAt('/booking-schedule?tab=campaign-status')
    const grid = await screen.findByLabelText('Campaign Status', {}, { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 300))
    fireEvent.mouseEnter(within(grid).getByTestId('rejection-hover'))
    await new Promise((r) => setTimeout(r, 800))
    expect(document.body.textContent).toContain('Logo is blurry')
    expect(document.body.textContent).toContain('hq@retailer.test')
  })

  /* Ticket XE6l6fyqZvpLhgIQpb7P: Flight start column, and the deal section in the campaign name hover. */
  it('shows the flight start and a deal section in the campaign name hover, only for a campaign linked to a deal', async () => {
    const dealt = { ...campaign, dealId: 'PH-DEAL1' }
    const list = { id: 'bl_1', dealId: 'PH-DEAL1', name: 'Swisse always-on', description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: '2026-11-03T09:00:00.000Z', activeTo: '2026-12-01T00:00:00.000Z', dealType: 'guaranteed', termTotal: 12500, effectiveCommittedPlays: { min: null, max: null, source: 'none' } }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/campaigns': { items: [dealt, hq] }, '/api/admin/v1/buyers-lists': { items: [list] } })))
    renderAt('/booking-schedule?tab=campaign-status')
    const grid = await screen.findByLabelText('Campaign Status', {}, { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 300))
    fireEvent.mouseEnter(await within(grid).findByText('Swisse spring', {}, { timeout: 10000 }))
    const tip = await screen.findByTestId('deal-tip-c1', {}, { timeout: 10000 })
    for (const t of ['Swisse always-on', 'PH-DEAL1', 'Programmatic guaranteed', '3 Nov 2026 09:00', '1 Dec 2026 00:00', 'USD 12,500']) expect(tip.textContent).toContain(t)
    expect(tip.textContent).not.toMatch(/pacing/i)
  }, slow(45000))
  it('has no deal section when the campaign is not linked to a deal', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(routes)))
    renderAt('/booking-schedule?tab=campaign-status')
    const grid = await screen.findByLabelText('Campaign Status', {}, { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 300))
    fireEvent.mouseEnter(await within(grid).findByText('Swisse spring', {}, { timeout: 10000 }))
    await screen.findByText('Touch points:', {}, { timeout: 10000 })
    expect(screen.queryByTestId('deal-tip-c1')).not.toBeInTheDocument()
  }, slow(45000))

  /* Ticket BGxKMB89DIOgWuwgfrej: the two tabs are back (removed 13 Oct 2026 by BG4LKXiqTMYNm8jRNFDk). */
  it('has Booking schedule and Campaign Approval tabs, Booking schedule first', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(routes)))
    renderAt('/booking-schedule')
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Booking schedule', 'Campaign Approval'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(tabs[1])
    expect(await screen.findByLabelText('Campaign Status', {}, { timeout: 10000 })).toBeInTheDocument()
  })

  it('opens Campaign Approval from ?tab=campaign-status', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(routes)))
    const router = renderAt('/booking-schedule?tab=campaign-status')
    expect(await screen.findByLabelText('Campaign Status', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Campaign Approval' })).toHaveAttribute('aria-selected', 'true')
    expect(router.state.location.search).toBe('?tab=campaign-status')
  })

  /* Ticket bhiyhqKpLPBDlySEfGNB: the Booking revenue table shows an expected fill for real-time inventory, labelled expected, while % sold stays a dash. */
  it('shows an expected fill beside % sold in the Booking revenue table', async () => {
    const start = new Date().toISOString()
    const schedule = {
      currency: 'AUD', windows: [{ start, end: start }], dsps: [], directAdvertisers: [], byPricingType: [], positions: [],
      revenue: [{ displayTypeId: 'portrait', displayTypeName: 'Portrait', bookedWindows: 0, sellableWindows: 0, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 8, realtimeFilled: 6 }],
      totals: { bookedWindows: 0, sellableWindows: 0, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 8, realtimeFilled: 6 },
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/booking-schedule': schedule })))
    renderAt('/booking-schedule')
    expect(await screen.findByText('Expected fill (real-time)', {}, { timeout: 10000 })).toBeInTheDocument()
    expect((await screen.findAllByText('75%', {}, { timeout: 10000 })).length).toBeGreaterThan(0)
    expect(screen.getAllByText('expected').length).toBeGreaterThan(0)
  }, slow(45000))

  /* Ticket eNlz3fJab4Ehqg9hbf4C: assumed views (VAC-d) under each cell and per display type in the Booking revenue table. */
  it('shows assumed views under a cell and total, booked and available assumed views per display type', async () => {
    const start = new Date().toISOString()
    const schedule = {
      currency: 'AUD', windows: [{ start, end: start }], dsps: [], directAdvertisers: [], byPricingType: [],
      revenue: [{ displayTypeId: 'portrait', displayTypeName: 'Portrait', bookedWindows: 0, sellableWindows: 1, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 12345, bookedViews: 5000, availableViews: 7345, availableWindows: 3, availableValue: 456.5 }],
      totals: { bookedWindows: 0, sellableWindows: 1, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0, totalViews: 12345, bookedViews: 5000, availableViews: 7345, availableWindows: 3, availableValue: 456.5 },
      positions: [{ positionId: 'p1', displayTypeId: 'portrait', displayTypeName: 'Portrait', slot: 0, slotLabel: 'Slot 1', displayCount: 1, zoneName: null, zoneSlot: 0, partnerNames: [], assignment: 'deal', realTime: false, recentPlays: null,
        windows: [{ start, status: 'available', booking: null, assumedViews: 4321 }] }],
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/booking-schedule': schedule })))
    renderAt('/booking-schedule')
    expect(await screen.findByText('4,321 assumed views', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(screen.getByText('Total assumed views')).toBeInTheDocument()
    expect(screen.getByText('Booked assumed views')).toBeInTheDocument()
    expect(screen.getByText('Available assumed views')).toBeInTheDocument()
    expect(screen.getByText('Available (at floor CPM)')).toBeInTheDocument()
    expect((await screen.findAllByText(/456\.50/)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('12,345')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('5,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('7,345').length).toBeGreaterThan(0)
  }, slow(45000))

  /* Ticket ByeH6mIkaRqOJjnHu31z: a Booking Schedule tile opens its campaign in Campaign Approval. */
  it('opens a booking tile\'s campaign in Campaign Approval, even one the list normally hides', async () => {
    const start = new Date().toISOString()
    const tile = (campaignId: string, advertiserName: string) => ({
      reservationId: `r_${campaignId}`, campaignId, advertiserId: 'a', partnerId: 'direct', pricingType: 'default', type: 'reserve', advertiserName, partnerName: 'Direct', cpm: 5, assumedViews: 1000, bookedRevenue: 5, billedRevenue: null,
      layers: { default: true, localised: false, personalised: false }, personalisedTriggers: null,
      approval: { defaultApproved: false, defaultRisk: 'at_risk', startsInDays: 1, localised: { approved: 0, submitted: 0 }, personalised: { approved: 0, submitted: 0 } },
    })
    const schedule = {
      currency: 'AUD', windows: [{ start, end: start }], revenue: [], dsps: [], directAdvertisers: [], byPricingType: [], totals: { bookedWindows: 1, sellableWindows: 1, bookedRevenue: 5, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0 },
      positions: [{ positionId: 'p1', displayTypeId: 'portrait', displayTypeName: 'Portrait', slot: 0, slotLabel: 'Slot 1', displayCount: 1, zoneName: null, zoneSlot: 0, partnerNames: [], assignment: 'open', realTime: false, recentPlays: null,
        windows: [{ start, status: 'booked', booking: tile('c_zinger', 'Zinger Direct') }] }],
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/booking-schedule': schedule })))
    const router = renderAt('/booking-schedule')
    fireEvent.click(await screen.findByRole('link', { name: /Open Zinger Direct in Campaign Approval/ }, { timeout: 10000 }))
    expect(await screen.findByLabelText('Campaign Status', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?tab=campaign-status&campaignId=c_zinger')
    /* The HQ campaign is hidden from the list as a rule; the one the tile opened is shown. */
    await waitFor(() => expect(within(screen.getByLabelText('Campaign Status')).getByText('Zinger Box — hero')).toBeInTheDocument(), { timeout: 10000 })
  }, slow(45000))

  /* Ticket CXmiVdLcDzkcojpSnJic (27 Oct 2026): a booking's hover carries its deal - the flight on top, then the Details hover of Deals and buyers
     lists, and delivery pacing for a Programmatic guaranteed deal. A booking under no deal keeps the earlier hover. */
  it('shows the deal on a booking tile\'s hover: flight, the Details block and, for a guaranteed deal, delivery pacing', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const row = { ...inv.items[0], displayTypeId: 'portrait', displayTypeName: 'Portrait', displayCount: 12, slotCount: 3, displayTypeBillingUnitHours: 24, billingUnitHoursOverride: null, maxPlayLengthSecOverride: null, displayTypeMaxPlayLengthSec: null, companyMaxPlayLengthSec: 15, openHoursPerDay: 24 }
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 16) + ':00Z'
    const flight = { activeFrom: iso(-5), activeTo: iso(5), timeZoneMode: 'platform', description: '', invitedCategories: [], targeting: [], deals: [] }
    const lists = [
      { ...flight, id: 'bl_pg', dealId: 'PH-PG1', name: 'Nestlé PG', dealType: 'guaranteed', status: 'shared', invitedBuyers: [], termTotal: 500, committedPlays: 1000, deliveredPlays: 100, assignedSlots: [{ positionId: 'portrait.s1' }] },
      { ...flight, id: 'bl_d', dealId: 'PH-DIRECT0001', name: 'Direct deal', dealType: 'direct', status: 'shared', invitedBuyers: [{ partnerId: 'direct', seatId: 'adv_x' }], effectiveRateCpm: { min: 4, max: 4, source: 'buyer' }, assignedSlots: [{ positionId: 'portrait.s2' }] },
    ]
    const tile = (campaignId: string, advertiserId: string, advertiserName: string, partnerId: string) => ({
      reservationId: `r_${campaignId}`, campaignId, advertiserId, partnerId, pricingType: 'default', type: 'reserve', advertiserName, partnerName: 'P', cpm: 5, assumedViews: 1000, bookedRevenue: 5, billedRevenue: null,
      layers: { default: true, localised: false, personalised: false }, personalisedTriggers: null,
      approval: { defaultApproved: true, defaultRisk: 'secured', startsInDays: 1, localised: { approved: 0, submitted: 0 }, personalised: { approved: 0, submitted: 0 } },
    })
    const position = (n: number, b: ReturnType<typeof tile>) => ({ positionId: `portrait.s${n}`, displayTypeId: 'portrait', displayTypeName: 'Portrait', slot: n, slotLabel: `Slot ${n}`, displayCount: 1, zoneName: null, zoneSlot: n, partnerNames: [], assignment: 'open', realTime: false, recentPlays: null, windows: [{ start, status: 'booked', booking: b }] })
    const schedule = {
      currency: 'AUD', windows: [{ start, end: start }], revenue: [], dsps: [], directAdvertisers: [], byPricingType: [], totals: { bookedWindows: 3, sellableWindows: 3, bookedRevenue: 15, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0 },
      positions: [position(1, tile('c_pg', 'nestle', 'Nestle Pacing', 'dv360')), position(2, tile('c_d', 'adv_x', 'Direct Brand', 'direct')), position(3, tile('c_bid', 'bidder', 'Bid Brand', 'dv360'))],
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...routes, ...ADVERTISER_PAGE, '/api/admin/v1/booking-schedule': schedule, '/api/admin/v1/buyers-lists': { items: lists },
      '/api/admin/v1/campaigns': { items: [{ campaignId: 'c_pg', dealId: 'PH-PG1' }] },
      '/api/admin/v1/available-inventory': { ...inv, items: [1, 2, 3].map((slot) => ({ ...row, slot, zoneSlot: slot })) },
    })))
    renderAt('/booking-schedule')
    /* A guaranteed deal, found by the campaign's deal ID: 11 days at 1,920 plays x 12 displays, and 100 of 1,000 committed plays delivered at the flight's half way. */
    fireEvent.mouseOver(await screen.findByRole('link', { name: 'Show Nestle Pacing in Campaign Approval' }, { timeout: 10000 }))
    const pg = await screen.findByTestId('details-tip-bl_pg')
    expect(screen.getByText('Flight')).toBeInTheDocument()
    expect(screen.getByText(/→.*\(Platform time zone\)/)).toBeInTheDocument()
    expect(pg).toHaveTextContent('Programmatic guaranteed')
    expect(pg).toHaveTextContent('Deal total: 253,440 plays · USD 500')
    expect(pg).not.toHaveTextContent('Deal ID')
    expect(within(pg).getByTestId('pacing-bl_pg')).toHaveTextContent('Delivered: 100 of 1,000 committed plays')
    expect(within(pg).getByTestId('pacing-bl_pg')).toHaveTextContent('20% of the plays due by now')
    expect(within(pg).getByTestId('pacing-bl_pg')).toHaveTextContent('Behind')
    /* A Direct advertiser deal: found by its advertiser and slot; the Deal ID row, no pacing. */
    fireEvent.mouseOver(screen.getByRole('link', { name: 'Show Direct Brand in Campaign Approval' }))
    const direct = await screen.findByTestId('details-tip-bl_d')
    expect(direct).toHaveTextContent('Deal ID: PH-DIRECT0001')
    expect(direct).toHaveTextContent('253,440 plays · USD 1,014')
    expect(screen.queryByTestId('pacing-bl_d')).toBeNull()
    /* No deal: the earlier hover. */
    fireEvent.mouseOver(screen.getByRole('link', { name: 'Show Bid Brand in Campaign Approval' }))
    await waitFor(() => expect(screen.getAllByText('Booking value').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('details-tip-bl_none')).toBeNull()
  }, slow(45000))

  /* 26 Oct 2026 (ivtzBF4eaaW7BnS0ooI8): the first pinned column reads Advertiser / Deal; hovering the advertiser lists its DSP and slots,
     hovering the position shows zone and operating times. */
  it('names the first column Advertiser / Deal and hovers deal and position details', async () => {
    const start = new Date().toISOString()
    const booking = {
      reservationId: 'r_h', campaignId: 'c_h', advertiserId: 'a', partnerId: 'direct', pricingType: 'default', type: 'reserve', advertiserName: 'Hover Brand', partnerName: 'Direct', cpm: 5, assumedViews: 1000, bookedRevenue: 5, billedRevenue: null,
      layers: { default: true, localised: false, personalised: false }, personalisedTriggers: null,
      approval: { defaultApproved: false, defaultRisk: 'at_risk', startsInDays: 1, localised: { approved: 0, submitted: 0 }, personalised: { approved: 0, submitted: 0 } },
    }
    const schedule = {
      currency: 'AUD', windows: [{ start, end: start }], revenue: [], dsps: [], directAdvertisers: [], byPricingType: [], totals: { bookedWindows: 1, sellableWindows: 1, bookedRevenue: 5, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0 },
      positions: [{ positionId: 'p1', displayTypeId: 'portrait', displayTypeName: 'Portrait', slot: 0, slotLabel: 'Slot 1', displayCount: 1, playbackWindow: 'Store hours', zoneName: 'Zone A', zoneSlot: 1, partnerNames: [], assignment: 'open', realTime: false, recentPlays: null,
        windows: [{ start, status: 'booked', booking }] }],
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/booking-schedule': schedule })))
    renderAt('/booking-schedule')
    expect(await screen.findByText('Advertiser / Deal', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(screen.queryByText('Advertiser / DSP')).not.toBeInTheDocument()
    fireEvent.mouseEnter((await screen.findAllByText('Hover Brand'))[0])
    expect(await screen.findByText(/DSP: Direct/, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText(/Portrait · Zone A \/ Slot 1 · 1 window/)).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getAllByText('Portrait', { selector: '.truncate' })[0])
    expect(await screen.findByText('Store hours', {}, { timeout: 5000 })).toBeInTheDocument()
  }, slow(45000))

  /* 23 Oct 2026: a Direct deal window whose advertiser has no campaign that fits the slot is red with no campaign behind it,
     and did nothing when clicked. It opens Campaign Approval on the advertiser, which says why nothing plays there. */
  it('opens Campaign Approval on the advertiser from a tile with no campaign, and says it has none', async () => {
    const start = new Date().toISOString()
    const booking = {
      reservationId: 'deal_x', campaignId: '', advertiserId: 'nobrand', partnerId: 'direct', pricingType: 'default', type: 'reserve', advertiserName: 'NoBrand (Direct)', partnerName: 'Direct', cpm: 5, assumedViews: 1000, bookedRevenue: 5, billedRevenue: null,
      layers: { default: true, localised: false, personalised: false }, personalisedTriggers: null,
      approval: { defaultApproved: false, defaultRisk: 'at_risk', startsInDays: 1, localised: { approved: 0, submitted: 0 }, personalised: { approved: 0, submitted: 0 } },
    }
    const schedule = {
      currency: 'AUD', windows: [{ start, end: start }], revenue: [], dsps: [], directAdvertisers: [], byPricingType: [], totals: { bookedWindows: 1, sellableWindows: 1, bookedRevenue: 5, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0 },
      positions: [{ positionId: 'p1', displayTypeId: 'portrait', displayTypeName: 'Portrait', slot: 0, slotLabel: 'Slot 1', displayCount: 1, zoneName: null, zoneSlot: 0, partnerNames: [], assignment: 'open', realTime: false, recentPlays: null,
        windows: [{ start, status: 'booked', booking }] }],
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/booking-schedule': schedule })))
    const router = renderAt('/booking-schedule')
    fireEvent.click(await screen.findByRole('link', { name: /Open NoBrand \(Direct\) in Campaign Approval/ }, { timeout: 10000 }))
    expect(await screen.findByLabelText('Campaign Status', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(new URLSearchParams(router.state.location.search).get('advertiserId')).toBe('nobrand')
    expect(await screen.findByText('NoBrand (Direct) has not yet provided creative for these slots.', {}, { timeout: 10000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all campaigns' }))
    await waitFor(() => expect(router.state.location.search).toBe('?tab=campaign-status'), { timeout: 10000 })
    expect(screen.queryByText(/has not yet provided creative/)).not.toBeInTheDocument()
  }, slow(45000))

  /* Ticket 53EvxhdKrShqDt1OIFMq: the advertiser's name on a tile opens Campaign Approval filtered to that advertiser, on a mouse too. */
  it('opens Campaign Approval filtered to the advertiser from the name on a tile', async () => {
    const start = new Date().toISOString()
    const booking = {
      reservationId: 'r_z', campaignId: 'c_zinger', advertiserId: 'zinger', partnerId: 'direct', pricingType: 'default', type: 'reserve', advertiserName: 'Zinger Direct', partnerName: 'Direct', cpm: 5, assumedViews: 1000, bookedRevenue: 5, billedRevenue: null,
      layers: { default: true, localised: false, personalised: false }, personalisedTriggers: null,
      approval: { defaultApproved: false, defaultRisk: 'at_risk', startsInDays: 1, localised: { approved: 0, submitted: 0 }, personalised: { approved: 0, submitted: 0 } },
    }
    const schedule = {
      currency: 'AUD', windows: [{ start, end: start }], revenue: [], dsps: [], directAdvertisers: [], byPricingType: [], totals: { bookedWindows: 1, sellableWindows: 1, bookedRevenue: 5, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0 },
      positions: [{ positionId: 'p1', displayTypeId: 'portrait', displayTypeName: 'Portrait', slot: 0, slotLabel: 'Slot 1', displayCount: 1, zoneName: null, zoneSlot: 0, partnerNames: [], assignment: 'open', realTime: false, recentPlays: null,
        windows: [{ start, status: 'booked', booking }] }],
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/booking-schedule': schedule })))
    const router = renderAt('/booking-schedule')
    fireEvent.click(await screen.findByRole('link', { name: /Show Zinger Direct in Campaign Approval/ }, { timeout: 10000 }))
    expect(await screen.findByLabelText('Campaign Status', {}, { timeout: 10000 })).toBeInTheDocument()
    const q = new URLSearchParams(router.state.location.search)
    expect(q.get('advertiserId')).toBe('zinger')
    expect(q.get('campaignId')).toBeNull()
  }, slow(45000))

  /* The Status column's own funnel is the only status filter (ticket dinPPBl9Rk95UbrXoRbt);
     it stays on until cleared from that funnel. */
  it('filters by status from the Status column funnel, until the filter is cleared', async () => {
    const approved = { ...campaign, campaignId: 'c2', name: 'Blackmores autumn' }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...routes,
      '/api/admin/v1/campaigns': { items: [campaign, approved, hq] },
      '/api/admin/v1/campaigns/c2/approval': { ...approval, campaignId: 'c2', campaignName: 'Blackmores autumn', status: 'approved' },
    })))
    renderAt('/booking-schedule?tab=campaign-status')
    /* Re-query the grid each time: AG Grid redraws its rows as the filter changes. */
    const grid = () => screen.getByLabelText('Campaign Status')
    const shown = (name: string) => waitFor(() => expect(within(grid()).getByText(name)).toBeInTheDocument(), { timeout: 10000 })
    const hidden = (name: string) => waitFor(() => expect(within(grid()).queryByText(name)).not.toBeInTheDocument(), { timeout: 10000 })
    await shown('Blackmores autumn')
    await shown('Swisse spring')
    /* No selector above the table, and no select-all CTA. */
    expect(screen.queryByRole('button', { name: /^Approved\s*\d/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Select all awaiting/ })).not.toBeInTheDocument()

    fireEvent.click(await within(grid()).findByLabelText('Status filter', {}, { timeout: 10000 }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Approved' }))
    await hidden('Swisse spring')
    await shown('Blackmores autumn')
    await waitFor(() => expect(within(grid()).getAllByLabelText('Status filter')[0]).toHaveAttribute('aria-pressed', 'true'))

    /* Clearing the column filter is the way back to every campaign. */
    fireEvent.click(within(grid()).getAllByLabelText('Status filter')[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Filter' }))
    await shown('Blackmores autumn')
    await shown('Swisse spring')
  }, slow(45000))

  /* Ticket pHOcPNaBqRDzNTENqnZE (12 Oct 2026): every column filter on the table works,
     not just the Status and Advertiser funnels. */
  it('filters by every column: advertiser / campaign name, touch points, display types, creative ID and deal ID', async () => {
    const other = {
      ...campaign, campaignId: 'c2', name: 'Blackmores autumn', advertiserId: 'blackmores', advertiserName: 'Blackmores',
      partnerId: 'p_ttd', partnerName: 'The Trade Desk', displayTypeId: 'landscape', dealId: 'DEAL-77',
      brief: { ...campaign.brief, touchPoints: ['Mobile'] },
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...routes,
      '/api/admin/v1/campaigns': { items: [{ ...campaign, dealId: 'DEAL-11' }, other, hq] },
      '/api/admin/v1/campaigns/c1/approval': { ...approval, creativeId: 'CR-AAA' },
      '/api/admin/v1/campaigns/c2/approval': { ...approval, campaignId: 'c2', campaignName: 'Blackmores autumn', status: 'approved', creativeId: 'CR-BBB' },
    })))
    renderAt('/booking-schedule?tab=campaign-status')
    const grid = () => screen.getByLabelText('Campaign Status')
    const shown = (name: string) => waitFor(() => expect(within(grid()).getAllByText(name).length).toBeGreaterThan(0), { timeout: 10000 })
    const hidden = (name: string) => waitFor(() => expect(within(grid()).queryByText(name)).not.toBeInTheDocument(), { timeout: 10000 })
    await shown('Swisse spring')
    await shown('Blackmores autumn')
    /* The approvals arrive after the campaigns; wait for them so the columns settle before filtering. */
    await waitFor(() => expect(within(grid()).getByText('CR-AAA')).toBeInTheDocument(), { timeout: 10000 })

    for (const [label, text, keep, drop] of [
      ['Advertiser / Campaign name', 'autumn', 'Blackmores autumn', 'Swisse spring'],
      ['Advertiser / Campaign name', 'Swisse', 'Swisse spring', 'Blackmores autumn'],
      ['Creative ID', 'CR-AAA', 'Swisse spring', 'Blackmores autumn'],
      ['Deal ID', 'DEAL-77', 'Blackmores autumn', 'Swisse spring'],
    ] as const) {
      fireEvent.change(within(grid()).getByLabelText(`${label} search`), { target: { value: text } })
      await hidden(drop)
      await shown(keep)
      fireEvent.change(within(grid()).getByLabelText(`${label} search`), { target: { value: "" } })
      await shown(drop)
    }
    for (const [label, value, keep, drop] of [
      ['Touch points', 'Mobile', 'Blackmores autumn', 'Swisse spring'],
      ['Display types', 'landscape', 'Blackmores autumn', 'Swisse spring'],
    ] as const) {
      fireEvent.click(within(grid()).getAllByLabelText(`${label} filter`)[0])
      const box = await screen.findByRole('checkbox', { name: new RegExp(`^${value}$`, 'i') })
      fireEvent.click(box)
      await hidden(drop)
      await shown(keep)
      fireEvent.click(await screen.findByRole('button', { name: 'Clear Filter' }))
      await shown(drop)
      /* Close this funnel's popup so the next one is the only one open. */
      fireEvent.click(within(grid()).getAllByLabelText(`${label} filter`)[0])
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear Filter' })).not.toBeInTheDocument(), { timeout: 10000 })
    }
  }, slow(90000))

  it('never lists a Draft campaign — a retailer only ever sees one that has been submitted', async () => {
    const draftApproval = { ...approval, status: 'draft', mode: null, submittedAt: null }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...routes, '/api/admin/v1/campaigns/c1/approval': draftApproval })))
    renderAt('/booking-schedule?tab=campaign-status')
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

/* Ticket IDGsyELBJsjlAYjizSqT: campaigns are approved one at a time and
   grouped under a creative ID (the grouping a DSP bids on). */
describe('Upcoming Campaign Approval — creative IDs', () => {
  const base = {
    source: 'api', partnerId: 'p_google', partnerName: 'Google DSP', displayTypeId: 'portrait', pricingType: 'localised', activation: { enabled: false },
    schedule: { nextWindowStart: null, bookedWindows: 0 }, lastPlayedAt: null, brief: { details: 'x', touchPoints: ['Digital Signage'] },
    campaignCount: 1, localisedVariables: ['Fixed Store Segments'], localisedRuleLines: [], personalisedVariables: [], personalisedRuleLines: [],
  }
  const camp = (campaignId: string, name: string, advertiserId: string, advertiserName: string, extra: object = {}) => ({ ...base, campaignId, name, advertiserId, advertiserName, ...extra })
  const approvalOf = (c: { campaignId: string; name: string }, status = 'awaiting_approval', creativeId: string | null = null) => ({
    campaignId: c.campaignId, campaignName: c.name, status, mode: 'manual', assetVersion: 'v1', submittedAt: '2026-10-01T00:00:00.000Z', reviewedBy: null, reviewedAt: null, reason: null, checks: [], creativeId,
  })
  const spring = camp('c1', 'Swisse spring', 'swisse', 'Swisse')
  const kids = camp('c2', 'Swisse kids', 'swisse', 'Swisse', { brief: { details: 'x', touchPoints: ['Digital Signage', 'Mobile Site'] } })
  const winter = camp('c3', 'Nestlé winter', 'nestle', 'Nestlé')
  const autumn = camp('c4', 'Swisse autumn', 'swisse', 'Swisse')
  const resubmitted = camp('c5', 'Swisse summer', 'swisse', 'Swisse')
  /* Nestlé does not require approval: its campaigns were approved on submission (mode 'auto'). */
  const oat = camp('c6', 'Nestlé oats', 'nestle', 'Nestlé')
  const milk = camp('c7', 'Nestlé milk', 'nestle', 'Nestlé')
  const campaigns = [spring, kids, winter, autumn, resubmitted, oat, milk]
  const routes = {
    '/api/admin/v1/campaigns': { items: campaigns },
    '/api/admin/v1/campaigns/c1/approval': approvalOf(spring),
    '/api/admin/v1/campaigns/c2/approval': approvalOf(kids),
    '/api/admin/v1/campaigns/c3/approval': approvalOf(winter),
    '/api/admin/v1/campaigns/c4/approval': approvalOf(autumn, 'approved', 'CR-AAAA1111'),
    '/api/admin/v1/campaigns/c5/approval': approvalOf(resubmitted, 'awaiting_approval', 'CR-AAAA1111'),
    '/api/admin/v1/campaigns/c6/approval': { ...approvalOf(oat, 'approved'), mode: 'auto' },
    '/api/admin/v1/campaigns/c7/approval': { ...approvalOf(milk, 'approved'), mode: 'auto' },
    '/api/admin/v1/creative-ids': {
      items: [
        { creativeId: 'CR-AAAA1111', advertiserId: 'swisse', advertiserName: 'Swisse', createdAt: '2026-10-01T00:00:00.000Z', campaigns: [{ campaignId: 'c4', name: 'Swisse autumn', touchPoints: ['Digital Signage'] }, { campaignId: 'c5', name: 'Swisse summer', touchPoints: ['Mobile Site'] }] },
        { creativeId: 'CR-BBBB2222', advertiserId: 'swisse', advertiserName: 'Swisse', createdAt: '2026-10-02T00:00:00.000Z', campaigns: [{ campaignId: 'c9', name: 'Swisse winter', touchPoints: ['Digital Signage'] }] },
      ],
    },
    '/api/admin/v1/booking-schedule': { currency: 'AUD', windows: [], positions: [], revenue: [], dsps: [], byPricingType: [], totals: { bookedWindows: 0, bookedRevenue: 0, billedRevenue: 0 } },
  }
  const posts: { url: string; body: any }[] = []
  beforeEach(() => {
    posts.length = 0
    const get = fakeFetch(routes)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify({ creativeId: 'CR-NEW00000', approvals: [] }), { status: 200 })
      }
      return get(url)
    }))
  })
  const open = async () => {
    renderAt('/booking-schedule?tab=campaign-status')
    const grid = await screen.findByLabelText('Campaign Status')
    await within(grid).findByLabelText('Select Swisse spring', {}, { timeout: 10000 })
    return grid
  }
  const tick = (grid: HTMLElement, name: string) => fireEvent.click(within(grid).getByLabelText(`Select ${name}`))
  const cta = (name: RegExp | string) => screen.queryByRole('button', { name })

  it('has no per-row approve or reject, and every campaign has exactly one box', async () => {
    const grid = await open()
    expect(within(grid).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(within(grid).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(within(grid).getByLabelText('Select Swisse autumn')).toBeInTheDocument()
    /* Seven campaigns and two advertisers: seven row boxes and two group boxes, nothing doubled. */
    const labels = [...grid.querySelectorAll('input[aria-label^="Select "]')].map((i) => i.getAttribute('aria-label'))
    expect(new Set(labels).size).toBe(9)
    expect(labels.filter((l) => l?.startsWith('Select all '))).toHaveLength(2)
    /* An approved campaign shows the creative ID it was grouped under; a resubmission says so. */
    expect(within(grid).getAllByText(/CR-AAAA1111/).length).toBe(2)
    expect(within(grid).getByText('(resubmission)')).toBeInTheDocument()
  }, slow(45000))

  it('shows the campaign’s details on hover', async () => {
    const grid = await open()
    fireEvent.mouseEnter(within(grid).getByRole('button', { name: 'Swisse kids' }))
    expect(await screen.findByText('Pricing:', {}, { timeout: 5000 })).toBeInTheDocument()
    for (const label of ['Touch points:', 'Localised variables:']) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Digital Signage, Mobile Site', { exact: false }).length).toBeGreaterThan(1)
    /* Hovering the advertiser above it shows the advertiser and its DSP (there is no DSP column). */
    fireEvent.mouseEnter(within(grid).getAllByText('Swisse')[0])
    expect((await screen.findAllByText('DSP:', {}, { timeout: 5000 })).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Advertiser:').length).toBeGreaterThan(0)
  }, slow(45000))

  it('offers the assign actions only while the ticked campaigns are one advertiser’s', async () => {
    const grid = await open()
    expect(cta(/^Approve/)).not.toBeInTheDocument()
    tick(grid, 'Swisse spring')
    tick(grid, 'Swisse kids')
    expect(await screen.findByRole('button', { name: 'Approve Selected' })).toBeInTheDocument()
    expect(cta('Approve and add to existing creative ID')).toBeInTheDocument()
    tick(grid, 'Nestlé winter')
    await waitFor(() => expect(cta(/^Approve/)).not.toBeInTheDocument())
    expect(cta('Reject Selected')).toBeInTheDocument()
    tick(grid, 'Nestlé winter')
    expect(await screen.findByRole('button', { name: 'Approve Selected' })).toBeInTheDocument()
  }, slow(45000))

  it('approves one campaign from its row menu, leaving the others alone (ticket jPQSz9EBmt0P2geHXp6l)', async () => {
    const grid = await open()
    fireEvent.click(within(grid).getByLabelText('Swisse spring: options'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Approve campaign' }))
    await waitFor(() => expect(posts.map((p) => p.url)).toEqual(['/api/admin/v1/approvals/approve-assign']))
    expect(posts[0].body).toEqual({ items: [{ campaignId: 'c1', assetVersion: 'v1' }] })
  }, slow(45000))

  it('rejects one campaign from its row menu', async () => {
    const grid = await open()
    fireEvent.click(within(grid).getByLabelText('Swisse spring: options'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reject campaign' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Reject Swisse spring?')).toBeInTheDocument()
  }, slow(45000))

  it('approves the ticked campaigns into a new creative ID', async () => {
    const grid = await open()
    tick(grid, 'Swisse spring')
    tick(grid, 'Swisse kids')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Selected' }))
    await waitFor(() => expect(posts.map((p) => p.url)).toEqual(['/api/admin/v1/approvals/approve-assign']))
    /* Grouped by advertiser, then name: kids before spring. */
    expect(posts[0].body).toEqual({ items: [{ campaignId: 'c2', assetVersion: 'v1' }, { campaignId: 'c1', assetVersion: 'v1' }] })
  }, slow(45000))

  it('picks an existing creative ID by its campaigns, pre-highlighting the one a resubmission came from', async () => {
    const grid = await open()
    tick(grid, 'Swisse summer')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and add to existing creative ID' }))
    const dialog = await screen.findByRole('dialog')
    /* Each ID with its member campaigns and their touch points. */
    expect(await within(dialog).findByText('CR-BBBB2222', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(within(dialog).getByText('Swisse winter — Digital Signage')).toBeInTheDocument()
    expect(within(dialog).getByText('Swisse summer — Mobile Site')).toBeInTheDocument()
    expect(within(dialog).getByText('original (resubmission)')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /CR-AAAA1111/ })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('radio', { name: /CR-BBBB2222/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and add to CR-BBBB2222' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].body).toEqual({ items: [{ campaignId: 'c5', assetVersion: 'v1' }], creativeId: 'CR-BBBB2222' })
  }, slow(45000))

  it('lets an auto-approved advertiser group its own campaigns under a new or existing creative ID, with no approve or reject', async () => {
    const grid = await open()
    tick(grid, 'Nestlé oats')
    tick(grid, 'Nestlé milk')
    expect(await screen.findByRole('button', { name: 'Generate creative ID' })).toBeInTheDocument()
    expect(cta(/^Approve/)).not.toBeInTheDocument()
    expect(cta('Reject Selected')).not.toBeInTheDocument()
    /* Mixed with a campaign awaiting the retailer: no action suits every row. */
    tick(grid, 'Nestlé winter')
    await waitFor(() => expect(cta('Generate creative ID')).not.toBeInTheDocument())
    tick(grid, 'Nestlé winter')
    fireEvent.click(await screen.findByRole('button', { name: 'Generate creative ID' }))
    await waitFor(() => expect(posts.map((p) => p.url)).toEqual(['/api/admin/v1/approvals/assign-creative-id']))
    expect(posts[0].body).toEqual({ campaignIds: ['c7', 'c6'] })
    tick(grid, 'Nestlé oats')
    fireEvent.click(await screen.findByRole('button', { name: 'Assign to existing creative ID' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('radio', { name: /CR-BBBB2222/ }, { timeout: 5000 }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to CR-BBBB2222' }))
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].body).toEqual({ campaignIds: ['c6'], creativeId: 'CR-BBBB2222' })
  }, slow(60000))

  it('rejects only once a coded reason is chosen and a reason is typed, and sends both', async () => {
    const grid = await open()
    tick(grid, 'Nestlé winter')
    fireEvent.click(await screen.findByRole('button', { name: 'Reject Selected' }))
    const dialog = await screen.findByRole('dialog')
    const reject = within(dialog).getByRole('button', { name: 'Reject' })
    expect(reject).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Price shown in the artwork.' } })
    /* Text alone isn't enough: the pick-list is required too. */
    expect(reject).toBeDisabled()
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Rejection reason' }))
    fireEvent.click(await screen.findByText('Price or offer in artwork'))
    await waitFor(() => expect(reject).toBeEnabled())
    fireEvent.click(reject)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ url: '/api/admin/v1/campaigns/c3/reject', body: { assetVersion: 'v1', reason: 'Price shown in the artwork.', reasonCode: 'price_or_offer_in_artwork' } })
  }, slow(45000))
})

describe('Booking schedule (not in the initial release)', () => {
  it('has no Booking schedule button on Advertisers / Inventory', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    renderAt('/advertisers')
    expect(await screen.findByLabelText('Available Inventory')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Booking schedule/ })).not.toBeInTheDocument()
  })
})

describe('Advertisers / Inventory', () => {
  /* Max campaigns is back without any flag (12 Oct 2026), between Floor CPM and Plays per window. */
  it('shows the Max campaigns column between Floor CPM and Plays per window, with no flag needed', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    expect([...inventory.querySelectorAll('.ag-header-cell-text')].map((h) => h.textContent))
      .toEqual(['Playlist', 'Slot', 'Assigned to', 'Floor CPM', 'Max campaigns', 'Plays per window', 'Max play length', 'Slots playing', ''])
  })

  it('shows buyers list and campaign counts on the Advertisers table, in the specified column order', async () => {
    const page = { ...ADVERTISER_PAGE, '/api/admin/v1/partners': { items: [{ id: 'p_google', name: 'Google DSP', status: 'connected', seats: [{ id: 'seat-swisse', name: 'Swisse' }] }] }, '/api/admin/v1/buyers-lists': { items: [
      { id: 'l1', name: 'List one', invitedBuyers: [{ partnerId: 'p_google', seatId: 'seat-nestle' }], invitedCategories: [] },
      { id: 'l2', name: 'List two', invitedBuyers: [{ partnerId: 'p_google', seatId: 'seat-nestle' }, { partnerId: 'p_other', seatId: 'x' }], invitedCategories: [] },
      { id: 'l3', name: 'List three', invitedBuyers: [{ partnerId: 'p_other', seatId: 'x' }, { partnerId: 'p_google', seatId: 'seat-swisse' }], invitedCategories: [] },
      { id: 'l4', name: 'Direct deal', invitedBuyers: [{ partnerId: 'direct', seatId: 'acme-foods' }], invitedCategories: [] },
    ] } }
    vi.stubGlobal('fetch', vi.fn(fakeFetch(page)))
    renderAt('/advertisers')
    const advertisers = await screen.findByLabelText('Advertisers')
    const heads = [...advertisers.querySelectorAll('.ag-header-cell-text')].map((h) => h.textContent)
    expect(heads.slice(0, 8)).toEqual(['Advertiser', 'Via', 'Buyers list', 'Campaign approval', 'Campaigns', 'Awaiting approval', 'Approved', 'Rejected'])
    await waitFor(() => {
      const row = advertisers.querySelector('.ag-center-cols-container [row-id="nestle"]')!
      const cells = [...row.querySelectorAll('[role="gridcell"]')].map((c) => c.textContent)
      expect(cells.slice(2, 3).concat(cells.slice(4, 8))).toEqual(['2', '3', '1', '2', '0'])
    })
    /* Swisse: draft campaigns are not counted; it has no mapped seat but a synced seat of its name is invited on l3. */
    const swisse = advertisers.querySelector('.ag-center-cols-container [row-id="swisse"]')!
    expect([...swisse.querySelectorAll('[role="gridcell"]')].map((c) => c.textContent).filter((_, i) => i === 2 || (i >= 4 && i <= 7))).toEqual(['1', '0', '0', '0', '0'])
  })

  it('lists a direct advertiser as "Direct advertiser" in Via and and is not offered in the Assigned to options, and lets an admin add one', async () => {
    const page = { ...ADVERTISER_PAGE, '/api/admin/v1/advertisers': { ...ADVERTISER_PAGE['/api/admin/v1/advertisers'], items: [...ADVERTISER_PAGE['/api/admin/v1/advertisers'].items, { advertiserId: 'acme-foods', name: 'Acme Foods', via: [], direct: true, approvalRequired: true, bookings: 0, campaigns: { draft: 0, awaiting_approval: 0, approved: 0, rejected: 0 } }] } }
    vi.stubGlobal('fetch', vi.fn(fakeFetch(page)))
    renderAt('/advertisers')
    const advertisers = await screen.findByLabelText('Advertisers')
    expect(await within(advertisers).findByText('Direct advertiser')).toBeInTheDocument()
    /* A direct advertiser on no buyers list reads 0 (it can be the named buyer of a direct deal, so never N/A). */
    const acme = advertisers.querySelector('.ag-center-cols-container [row-id="acme-foods"]')!
    expect([...acme.querySelectorAll('[role="gridcell"]')][2].textContent).toBe('0')
    /* No inline add field any more: a top-right CTA opens a pop-up (ticket d4q91vrL5z4gLHBKypHo). */
    expect(screen.queryByLabelText('Direct advertiser name')).not.toBeInTheDocument()
    /* View campaign approvals sits immediately left of Add new Advertiser and opens Campaign Approval in a new tab (ticket CcPh14VeSzSMZHO35d0s). */
    const approvals = screen.getByRole('button', { name: 'View campaign approvals' })
    expect(approvals.nextElementSibling).toBe(screen.getByRole('button', { name: /Add new Advertiser/ }))
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(approvals)
    expect(open).toHaveBeenCalledWith(expect.stringContaining('/booking-schedule?tab=campaign-status'), '_blank', 'noopener')
    open.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: /Add new Advertiser/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Advertiser name')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add advertiser' })).toBeDisabled()
    /* Audiences were removed from the platform (ticket GknBt80ENeXkt0EEyDwr). */
    expect(within(dialog).queryByText('Audiences')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    /* Only a direct advertiser has Edit (ticket usIHp1uhtllLCP29teBu): its name can be changed and saved. */
    expect(within(advertisers).getAllByRole('button', { name: /^Edit / })).toHaveLength(1)
    fireEvent.click(within(advertisers).getByRole('button', { name: 'Edit Acme Foods' }))
    const edit = await screen.findByRole('dialog')
    expect(within(edit).getByLabelText('Advertiser name')).toBeEnabled()
    expect(within(edit).getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(within(edit).queryByText('Audiences')).not.toBeInTheDocument()
    fireEvent.change(within(edit).getByLabelText('Advertiser name'), { target: { value: 'Acme Foods Ltd' } })
    expect(within(edit).getByRole('button', { name: 'Save changes' })).toBeEnabled()
    fireEvent.click(within(edit).getByRole('button', { name: 'Cancel' }))
    /* Only a direct advertiser can be deleted. */
    expect(within(advertisers).getByRole('button', { name: 'Delete Acme Foods' })).toBeInTheDocument()
    expect(within(advertisers).getAllByRole('button', { name: /^Delete / })).toHaveLength(1)
  })

  it('filters both tables by column, and shows who may buy each slot', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    renderAt('/advertisers')
    const advertisers = await screen.findByLabelText('Advertisers')
    /* Column filters, as on every other table: search on the name, funnels on the value columns. */
    expect(within(advertisers).getByLabelText('Advertiser search')).toBeInTheDocument()
    expect(within(advertisers).getByLabelText('Via filter')).toBeInTheDocument()
    expect(within(advertisers).getByLabelText('Campaign approval filter')).toBeInTheDocument()
    expect(screen.getByText('2 advertisers')).toBeInTheDocument()
    /* Campaigns and Bookings columns removed (Rob's ticket, 26 Sep 2026):
       already covered in Campaign Status and the booking schedule. */
    expect(within(advertisers).queryByRole('button', { name: /Bookings/ })).not.toBeInTheDocument()

    /* Advertisers table sits last, under Available Inventory and Buyers and targeting (ticket AkDMbOJn0QBV0ZcEM5tm). */
    expect(screen.getByText('Deals and buyers lists').compareDocumentPosition(advertisers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    /* Deals and buyers lists lead the page, above Available Inventory (ticket nTxDlW4zBjEKE9k1yKWO). */
    expect(screen.getByText('Deals and buyers lists').compareDocumentPosition(screen.getByText('Available Inventory')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const inventory = await screen.findByLabelText('Available Inventory')
    /* Playlist leads the table; Display type was removed as its own column
       (ticket "Available Inventory: playlist-primary table (drop Display
       type column) with Unassigned indicator", 27 Sep 2026). */
    expect([...inventory.querySelectorAll('.ag-header-cell-text')].map((h) => h.textContent))
      .toEqual(['Playlist', 'Slot', 'Assigned to', 'Floor CPM', 'Max campaigns', 'Plays per window', 'Max play length', 'Slots playing', ''])
    /* No interactive-only column: interactive is deferred (5 Oct 2026). */
    expect(within(inventory).getByLabelText('Playlist search')).toBeInTheDocument()
    /* Targeting is defined on the buyers and targeting list, not per slot (Rob, 7 Oct 2026). */
    expect(within(inventory).queryByLabelText('Targeting supported filter')).not.toBeInTheDocument()
    /* QR Control and Vision/AI moved onto the Playlist cell along with the
       rest of the display type's carried-over features (same ticket): QR
       Control is flagged on the display type that has it, and only that
       display type can support interactive targeting (Rob, 20 Sep). Vision/AI
       is flagged the same way, alongside it (ticket "show a computer vision
       icon when computer vision is enabled on a specific display type", 22
       Sep). */
    expect(within(inventory).getAllByLabelText('QR Control enabled')).toHaveLength(1)
    expect(within(inventory).getAllByLabelText('Vision/AI enabled')).toHaveLength(1)
    /* Assigned to is a pill column: who may buy the slot, plus the removable Included in global deals chip (slot default, 9 Oct 2026). */
    const cellOf = (label: string) => within(inventory).getAllByLabelText(`Menu Board — Long Format slot 2: ${label}`)[0].closest('.ag-cell') as HTMLElement
    expect([...cellOf('assigned to').querySelectorAll('.ant-select-selection-item')].map((t) => t.textContent)).toEqual(['Google DSP', 'Included in global deals'])
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

  })

  /* Ticket zEGSLHFUWdogfU77KljK (25 Oct 2026): the Assigned to funnel offers only DSP names, buyers lists and Whitelist only, and filters by them. */
  it('filters Available Inventory by Assigned to using only DSP names, buyers lists and Whitelist only', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    fireEvent.click(await within(inventory).findByLabelText('Assigned to filter', {}, { timeout: 10000 }))
    const options = (await screen.findAllByRole('checkbox')).map((c) => c.getAttribute('aria-label') ?? c.closest('label')?.textContent ?? '')
    expect(options).toContain('Google DSP')
    expect(options).toContain('Whitelist only')
    for (const legacy of ['Included in global deals', 'Unassigned', 'Nestlé']) expect(options).not.toContain(legacy)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Whitelist only' }))
    await waitFor(() => expect(within(screen.getByLabelText('Available Inventory')).queryAllByLabelText(/slot 2: assigned to/)).toHaveLength(0), { timeout: 10000 })
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Filter' }))
    await waitFor(() => expect(within(screen.getByLabelText('Available Inventory')).getAllByLabelText(/slot 2: assigned to/).length).toBeGreaterThan(0), { timeout: 10000 })
  }, slow(45000))

  /* "Unassigned": the display type has advertiser slots but no physical
     display is playing them (ticket "Available Inventory: playlist-primary
     table (drop Display type column) with Unassigned indicator", 27 Sep
     2026) — a separate fixture so it doesn't perturb the row/text
     assertions the other Available Inventory tests make against
     ADVERTISER_PAGE. */
  it('flags a playlist as Unassigned when its display type has no physical display', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/available-inventory': {
        ...ADVERTISER_PAGE['/api/admin/v1/available-inventory'],
        items: [{ ...ADVERTISER_PAGE['/api/admin/v1/available-inventory'].items[0], unassigned: true }],
      },
    })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    expect(within(inventory).getByLabelText('Unassigned')).toBeInTheDocument()
  })

  /* Ticket LFs0YIJs65DX8Aevfgn0, 8 Oct 2026: registered display count beside the playlist name; plays per window shows per-display (fleet total). */
  it('shows the registered display count after the playlist name and the fleet total after plays per window', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/available-inventory': {
        ...ADVERTISER_PAGE['/api/admin/v1/available-inventory'],
        items: [{ ...ADVERTISER_PAGE['/api/admin/v1/available-inventory'].items[0], displayCount: 12, slotCount: 3, billingUnitHours: 24, maxPlayLengthSec: 15, companyMaxPlayLengthSec: 15 }],
      },
    })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    expect(await within(inventory).findByLabelText('12 registered displays')).toHaveTextContent('(12)')
    expect(within(inventory).getByText('1,920')).toBeInTheDocument()
    expect(within(inventory).getByText('(23,040)')).toBeInTheDocument()
  })

  /* 25 Oct 2026: the Plays per window hover names the billing period basis, its times and the calculation. */
  it('shows the billing period basis, its times and the calculation on the Plays per window hover', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/available-inventory': {
        ...ADVERTISER_PAGE['/api/admin/v1/available-inventory'],
        items: [{ ...ADVERTISER_PAGE['/api/admin/v1/available-inventory'].items[0], displayCount: 12, slotCount: 3, billingUnitHours: 24, maxPlayLengthSec: 15, companyMaxPlayLengthSec: 15, openHoursPerDay: 13, operatingMode: 'store', operatingTimes: '08:00–21:00', playsPerWindow: 1040 }],
      },
    })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    fireEvent.mouseOver(await within(inventory).findByText('1,040'))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Billing period: Store hours, 08:00–21:00 (13 open hours a day).')
    expect(tip).toHaveTextContent('24 h billing unit × 13 ÷ 24 open hours = 13 open h; ÷ (15 s max play length × 3 slots playing = 45 s loop) = 1,040 plays (rounded down).')
  }, slow(45000))

  /* Ticket NPs6MBZQ6CfhFPHmBuGp (14 Oct 2026): hovering the playlist names it plus each assigned display type and its description. */
  it('shows the playlist name with its assigned display types and their descriptions on hover', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const playlistDisplayTypes = [
      { id: 'menu_board', name: 'Menu Board — Long Format', description: 'Portrait menu screens above the counter' },
      { id: 'portrait', name: 'Portrait', description: null },
    ]
    /* 19 Oct 2026: the list is sent once at the top level, keyed by playlist id, not on every row. */
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/available-inventory': { ...inv, playlistDisplayTypes: { [inv.items[0].playlistId]: playlistDisplayTypes } } })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    fireEvent.mouseOver(await within(inventory).findByLabelText('Playlist: Menu Board Playlist'))
    expect(await screen.findByText('Assigned display types:')).toBeInTheDocument()
    expect(screen.getByText(/Portrait menu screens above the counter/)).toBeInTheDocument()
    expect(screen.getByText(/\(no description\)/)).toBeInTheDocument()
  }, slow(45000))

  it('shows only the playlist name on hover when the list has no entry for the playlist', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/available-inventory': { ...inv, playlistDisplayTypes: { some_other_playlist: [{ id: 'x', name: 'X', description: null }] } } })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    fireEvent.mouseOver(await within(inventory).findByLabelText('Playlist: Menu Board Playlist'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Menu Board Playlist')
    expect(screen.queryByText('Assigned display types:')).not.toBeInTheDocument()
  }, slow(45000))

  /* Ticket ZglKshE5dUVasljNcIPH (8 Oct 2026): a buyers list shows the sum of the fleet plays per window of every position it is assigned to. */
  it('no longer shows committed or estimated volume columns in the deals and buyers lists table', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const row = { ...inv.items[0], displayCount: 12, slotCount: 3, billingUnitHours: 24, maxPlayLengthSec: 15, companyMaxPlayLengthSec: 15 }
    const assigned = { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: 'bl_1', buyersListIds: ['bl_1'] }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', name: 'Pharma brands', description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'guaranteed' }] },
      '/api/admin/v1/available-inventory': { ...inv, items: [{ ...row, assignedTo: assigned }, { ...row, slot: 5, zoneSlot: 5, displayTypeId: 'portrait', displayTypeName: 'Portrait', displayCount: 1, assignedTo: assigned }] },
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    expect(await within(table).findByText('Pharma brands')).toBeInTheDocument()
    /* Ticket KmX6jT2vmp50yrG1sRVy (14 Oct 2026): the two volume columns were removed from this table. */
    expect(within(table).queryByText('Committed volume')).toBeNull()
    expect(within(table).queryByText('Estimated volume')).toBeNull()
    expect(within(table).queryByText('24,960')).toBeNull()
  })

  /* Ticket nfDLP1CZiPjGfN8FG764 (22 Oct 2026): the Details hover totals each slot's plays and value over the whole flight, with the deal total, and carries no per-window slot copy. */
  it('shows each slot’s total plays and value over the flight, and the deal total, on the Details hover', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const row = { ...inv.items[0], displayCount: 12, slotCount: 3, billingUnitHours: 24, maxPlayLengthSec: 15, companyMaxPlayLengthSec: 15 }
    const assigned = { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: 'bl_1', buyersListIds: ['bl_1'] }
    const base = { description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: '2026-11-01T00:00:00Z', activeTo: '2026-11-10T00:00:00Z' }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [
        { ...base, id: 'bl_1', name: 'Pharma brands', dealType: 'guaranteed', termTotal: 500, equivalentCpm: { min: 5, max: 5 } },
        { ...base, id: 'bl_2', dealId: 'PH-DIRECT0001', name: 'Direct deal', dealType: 'direct', invitedBuyers: [{ partnerId: 'direct', seatId: 'adv_x' }], effectiveRateCpm: { min: 4, max: 4, source: 'buyer' } },
      ] },
      '/api/admin/v1/available-inventory': { ...inv, items: [{ ...row, assignedTo: assigned }, { ...row, slot: 5, zoneSlot: 5, displayCount: 1, assignedTo: { ...assigned, buyersListId: 'bl_2', buyersListIds: ['bl_2'] } }] },
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    /* 1,920 plays per window per display x 12 displays x 1 window a day x 10 days. */
    expect(await within(table).findByTestId('details-summary-bl_1')).toHaveTextContent('Programmatic guaranteed · 1 slot · 230,400 plays · USD 500')
    expect(within(table).getByTestId('rate-type-bl_1')).toHaveTextContent('Fixed per term')
    fireEvent.mouseOver(within(table).getByTestId('details-summary-bl_1'))
    const tip = await screen.findByTestId('details-tip-bl_1')
    expect(within(tip).getByTestId('details-slot-bl_1-0')).toHaveTextContent('230,400 plays · USD 500')
    expect(within(tip).getByTestId('details-total-bl_1')).toHaveTextContent('Deal total: 230,400 plays · USD 500')
    expect(tip).toHaveTextContent('USD 500 for the term')
    /* The flight's length sits in its own Period line (22 Oct 2026). */
    expect(tip).toHaveTextContent('Period: 10 days')
    expect(tip).not.toHaveTextContent(/per window|IAB zone|buffer/)
    /* A Direct advertiser deal gets the same cell, with the advertiser and the internal deal ID. 19,200 plays x 4 CPM / 1000. */
    fireEvent.mouseOver(within(table).getByTestId('details-summary-bl_2'))
    const direct = await screen.findByTestId('details-tip-bl_2')
    expect(direct).toHaveTextContent('Advertiser: adv_x')
    expect(direct).toHaveTextContent('Deal ID: PH-DIRECT0001')
    expect(within(direct).getByTestId('details-total-bl_2')).toHaveTextContent('Deal total: 19,200 plays · USD 77')
  }, slow(30000))

  /* Ticket 5CCgGEYSkVoDTH9yNSYu (10 Oct 2026): the deal ID is minted by the platform, shown read-only, and never part of the save payload. */
  it('shows a read-only Deal ID in the buyers table and edit modal, and warns that changing the deal type mints a new deal', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', dealId: 'PH-7K2M9QXW4B', name: 'Pharma brands', description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction' }] },
      '/api/admin/v1/available-inventory': inv,
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    expect(await within(table).findByText('PH-7K2M9QXW4B')).toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: 'Edit Pharma brands' }))
    const dialog = await screen.findByRole('dialog')
    const id = within(dialog).getByRole('textbox', { name: 'Deal ID' })
    expect(id).toHaveValue('PH-7K2M9QXW4B')
    expect(id).toHaveAttribute('readonly')
    expect(within(dialog).queryByTestId('deal-type-new-deal-note')).not.toBeInTheDocument()
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Deal type' }))
    /* POC: Private auction and Preferred deal stay visible but cannot be picked. */
    const preferred = (await screen.findByText('Preferred deal')).closest('.ant-select-item-option') as HTMLElement
    expect(preferred).toHaveClass('ant-select-item-option-disabled')
    fireEvent.click(preferred)
    expect(within(dialog).queryByTestId('deal-type-new-deal-note')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByText('Programmatic guaranteed', { selector: '.ant-select-item-option-content' }))
    expect(await within(dialog).findByTestId('deal-type-new-deal-note')).toHaveTextContent('new Deal ID')
  })

  /* Ticket krIPF8rPnMwVOmynHNRh (22 Oct 2026): Direct advertiser is an enabled deal type beside Programmatic guaranteed; Private auction and Preferred stay greyed out. Its buyer is one direct advertiser, never a DSP seat. */
  it('offers Direct advertiser as an enabled deal type whose buyers are direct advertisers only', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/advertisers': { items: [{ advertiserId: 'acme-foods', name: 'Acme Foods', via: [], direct: true, dspSeats: [] }] },
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', dealId: 'PH-7K2M9QXW4B', name: 'Pharma brands', description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction' }] },
      '/api/admin/v1/available-inventory': inv,
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    fireEvent.click(await within(table).findByRole('button', { name: 'Edit Pharma brands' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Deal type' }))
    const option = async (name: string) => (await waitFor(() => { const o = screen.getAllByText(name).map((e) => e.closest('.ant-select-item-option')).find(Boolean); if (!o) throw new Error(`no option ${name}`); return o })) as HTMLElement
    expect(await option('Private auction')).toHaveClass('ant-select-item-option-disabled')
    expect(await option('Preferred deal')).toHaveClass('ant-select-item-option-disabled')
    expect(await option('Direct advertiser')).not.toHaveClass('ant-select-item-option-disabled')
    fireEvent.click(await option('Direct advertiser'))
    expect(await within(dialog).findByTestId('deal-type-note')).toHaveTextContent('not sent to a DSP')
    /* Same price choice as Programmatic guaranteed. */
    expect(within(dialog).getByRole('combobox', { name: 'Price type' })).toBeInTheDocument()
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Buyers' }))
    expect(await screen.findByText('Acme Foods (Direct)')).toBeInTheDocument()
  }, slow(30000))

  /* Ticket OMwDvy3OUmY9raBtTf7v (22 Oct 2026): a deal whose flight overlaps another reserving deal on its slot shows the warning inline, naming the deal, advertiser, slot and dates, and cannot be saved. */
  it('warns inline and blocks Save when a deal\'s flight overlaps another reserving deal on its slot', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const conflict = { dealId: 'bl_2', dealName: 'Beta direct', dealCode: 'PH-BETA', advertiser: 'Beta Co', displayTypeId: 'portrait', playlist: 'Portrait', slot: 1, slotLabel: 'Ad', positionId: 'portrait.s1', overlapFrom: '2026-11-20', overlapTo: '2026-11-30', message: 'x' }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/advertisers': { items: [{ advertiserId: 'acme-foods', name: 'Acme Foods', via: [], direct: true, dspSeats: [] }] },
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', dealId: 'PH-7K2M9QXW4B', name: 'Pharma brands', description: '', invitedBuyers: [{ partnerId: 'direct', seatId: 'acme-foods' }], invitedCategories: [], targeting: [], activeFrom: '2026-11-01T00:00:00.000Z', activeTo: '2026-11-30T23:59:59.999Z', dealType: 'direct', status: 'shared', floorCpm: 150 }] },
      '/api/admin/v1/available-inventory': inv,
      '/api/admin/v1/reserving-conflicts': { conflicts: [conflict], candidates: {} },
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    fireEvent.click(await within(table).findByRole('button', { name: 'Edit Pharma brands' }))
    const dialog = await screen.findByRole('dialog')
    const warning = await within(dialog).findByTestId('reserving-conflict')
    expect(warning).toHaveTextContent('Beta direct')
    expect(warning).toHaveTextContent('Beta Co')
    expect(warning).toHaveTextContent('Portrait, slot 1 (Ad)')
    expect(warning).toHaveTextContent('2026-11-20 to 2026-11-30')
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled()
  }, slow(30000))

  /* Ticket KcqiJpzR5RXy4TWODYlG: term versions. The pop-up shows the version and acceptance, saves a name change silently, and warns before a rate change that makes accepted buyers re-accept. */
  const TERMS_LIST = { id: 'bl_1', dealId: 'PH-7K2M9QXW4B', name: 'Pharma brands', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction', floorCpm: 120, termVersion: 3, buyerAcceptance: [{ partnerId: 'p_google', seatId: '5130001', state: 'accepted', acceptedVersion: 3, acceptedAt: '2026-10-10T00:00:00Z' }] }
  const termsFetch = (requiresReacceptance: boolean, puts: unknown[]) => vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]
    if (init?.method === 'POST' && path.endsWith('/term-check')) {
      return new Response(JSON.stringify({ currentVersion: 3, nextVersion: 4, changes: [], requiresReacceptance, affectedBuyers: requiresReacceptance ? [{ partnerId: 'p_google', partnerName: 'Google DSP', seatId: '5130001', acceptedVersion: 3 }] : [] }), { status: 200 })
    }
    if (init?.method === 'PUT') { puts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ...TERMS_LIST, termVersion: 4 }), { status: 200 }) }
    return fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: [TERMS_LIST] } })(url)
  })
  const openTermsEditor = async () => {
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    fireEvent.click(await within(table).findByRole('button', { name: 'Edit Pharma brands' }))
    return screen.findByRole('dialog')
  }

  /* Deal lifecycle (ticket QG40V1vVwqp9NtFmlC9H): Save as draft -> Finalise -> Share deal. */
  const draftFetch = (slots: { positionId: string; label: string }[], calls: { method: string; url: string; body?: unknown }[]) => {
    const draft = { ...TERMS_LIST, status: 'draft', sharedAt: null, termVersion: 1, buyerAcceptance: [], assignedSlots: slots }
    return vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0]
      if (init?.method === 'PUT') { calls.push({ method: 'PUT', url: path, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify(draft), { status: 200 }) }
      if (path.endsWith('/deal-sheet')) return new Response(JSON.stringify({ buyersListId: 'bl_1', name: 'Pharma brands', dealType: 'private_auction', currency: 'USD', rateCpm: 120, rateKind: 'floor', activeFrom: null, activeTo: null, auctionCloses: null, committedPlays: null, entries: [], creativeRequirements: [{ canvas: { width: 1080, height: 1920 }, orientation: 'portrait', maxPlayLengthSec: 15, formats: ['image', 'video'], positionIds: slots.map((s) => s.positionId) }] }), { status: 200 })
      if (init?.method === 'POST' && path.endsWith('/term-check')) return new Response(JSON.stringify({ currentVersion: 1, nextVersion: 1, changes: [], requiresReacceptance: false, affectedBuyers: [] }), { status: 200 })
      if (init?.method === 'POST' && path.endsWith('/share')) { calls.push({ method: 'POST', url: path }); return new Response(JSON.stringify({ ...draft, status: 'shared', sharedAt: '2026-10-12T00:00:00Z' }), { status: 200 }) }
      return fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: [draft] } })(url)
    })
  }

  it('a draft with no assigned slot cannot be finalised and is marked as not shared', async () => {
    vi.stubGlobal('fetch', draftFetch([], []))
    const dialog = await openTermsEditor()
    expect(within(dialog).getByTestId('deal-status-note')).toHaveTextContent('Draft: not shared with any DSP')
    expect(within(dialog).getByRole('button', { name: 'Save draft' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Finalise deal terms' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  }, slow(30000))

  /* Ticket yOginusgiFgFkwVHTRFH (22 Oct 2026): the flight has start and end times and a Time zone dropdown above it (Platform time zone by default); the chosen mode is saved with the deal and shown where the flight is. */
  it('shows a Time zone dropdown above the flight, defaulting to the platform time zone, and saves the chosen mode', async () => {
    const puts: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', termsFetch(false, puts as unknown[]))
    const dialog = await openTermsEditor()
    const zone = within(dialog).getByRole('combobox', { name: 'Time zone' })
    expect(within(dialog).getByText('Platform time zone')).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('Start date and time')).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('End date and time')).toBeInTheDocument()
    fireEvent.mouseDown(zone)
    fireEvent.click(await screen.findByText('Local store time'))
    fireEvent.click(within(dialog).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ timeZoneMode: 'store' })
  }, slow(30000))

  /* Ticket LjkTqL4rdegolMoFCYVJ (21 Oct 2026): a Programmatic guaranteed deal covers a whole delivery term, priced as a fixed CPM or a total for the term; its committed plays are derived from the assigned slots and shown read-only once there are some. */
  const perTermFetch = (list: Record<string, unknown>, puts: unknown[]) => vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]
    if (init?.method === 'POST' && path.endsWith('/term-check')) return new Response(JSON.stringify({ currentVersion: 1, nextVersion: 1, changes: [], requiresReacceptance: false, affectedBuyers: [] }), { status: 200 })
    if (init?.method === 'PUT') { puts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(list), { status: 200 }) }
    return fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: [list] } })(url)
  })
  const PG_LIST = { ...TERMS_LIST, dealType: 'guaranteed', status: 'draft', sharedAt: null, termVersion: 1, buyerAcceptance: [], committedPlays: null, termTotal: null, floorCpm: null, equivalentCpm: null }
  const SLOT = { positionId: 'menu_board.s2', label: 'Menu Board — Long Format' }

  it('a guaranteed deal is priced as a fixed CPM or a total for the term, never per day', async () => {
    const puts: unknown[] = []
    vi.stubGlobal('fetch', perTermFetch({ ...PG_LIST, termTotal: 500, equivalentCpm: { min: 5, max: 5 }, assignedSlots: [SLOT] }, puts))
    const dialog = await openTermsEditor()
    expect(within(dialog).queryByRole('spinbutton', { name: 'Rate per day' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Price type' })).toBeInTheDocument()
    const total = within(dialog).getByRole('spinbutton', { name: 'Total for the term' })
    expect(total).toHaveValue('500.00')
    expect(within(dialog).getByTestId('rate-type')).toHaveTextContent('Fixed per term')
    expect(within(dialog).getByTestId('equivalent-cpm')).toHaveTextContent('Equivalent CPM 5')
    /* The flight is picked in whole days: no time-of-day picker. */
    expect(dialog.querySelector('.ant-picker-time-panel')).toBeNull()
    fireEvent.change(total, { target: { value: '1000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ dealType: 'guaranteed', termTotal: 1000 })
    expect(puts[0]).not.toHaveProperty('ratePerDay')
    expect(puts[0]).not.toHaveProperty('committedPlays')
  }, slow(30000))

  it('hides committed plays until slots are assigned, then shows the derived figure read-only and never sends it', async () => {
    const puts: unknown[] = []
    vi.stubGlobal('fetch', perTermFetch({ ...PG_LIST, assignedSlots: [] }, puts))
    let dialog = await openTermsEditor()
    expect(within(dialog).queryByLabelText('Committed plays')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Guaranteed impressions')).not.toBeInTheDocument()
    cleanup()
    vi.stubGlobal('fetch', perTermFetch({ ...PG_LIST, committedPlays: 155520, assignedSlots: [SLOT] }, puts))
    dialog = await openTermsEditor()
    const plays = within(dialog).getByLabelText('Committed plays')
    expect(plays).toHaveValue('155,520')
    expect(plays).toHaveAttribute('readonly')
    expect(within(dialog).getByTestId('committed-plays')).toHaveTextContent('guarantee buffer')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).not.toHaveProperty('committedPlays')
  }, slow(30000))

  it('warns that a changed term changes the committed plays and the deal must be re-shared, and cancelling saves nothing', async () => {
    const puts: unknown[] = []
    const shared = { ...PG_LIST, status: 'shared', sharedAt: '2026-10-20T00:00:00.000Z', committedPlays: 1000, assignedSlots: [SLOT] }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0]
      if (init?.method === 'POST' && path.endsWith('/term-check')) return new Response(JSON.stringify({ currentVersion: 1, nextVersion: 2, changes: [{ field: 'committedPlays', from: 1000, to: 1500, requiresReacceptance: true }], requiresReacceptance: true, affectedBuyers: [{ partnerId: 'p_google', partnerName: 'Google DV360', seatId: '5130001', acceptedVersion: 1 }] }), { status: 200 })
      if (init?.method === 'PUT') { puts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(shared), { status: 200 }) }
      return fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: [shared] } })(url)
    }))
    const dialog = await openTermsEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    const warning = await screen.findByTestId('reacceptance-warning')
    expect(within(warning).getByTestId('committed-plays-change')).toHaveTextContent('from 1,000 to 1,500')
    expect(warning).toHaveTextContent('re-shared and accepted again by the buyer')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByTestId('reacceptance-warning')).not.toBeInTheDocument())
    expect(puts).toHaveLength(0)
  }, slow(30000))

  it('warns when the price is below the platform floor and saves it again with the override on confirm', async () => {
    const bodies: Record<string, unknown>[] = []
    const reason = 'Floor price (CPM) can\'t be below the platform floor of 5 USD. Send belowFloorOverride: true to save it anyway.'
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0]
      if (init?.method === 'POST' && path.endsWith('/term-check')) return new Response(JSON.stringify({ error: { code: 'validation_failed', message: 'Invalid.', details: [{ field: 'floorCpm', reason }] } }), { status: 400 })
      if (init?.method === 'PUT') {
        const b = JSON.parse(String(init.body)) as Record<string, unknown>
        bodies.push(b)
        return b.belowFloorOverride
          ? new Response(JSON.stringify({ ...PG_LIST, floorCpm: 2, termTotal: null, belowFloorOverride: true }), { status: 200 })
          : new Response(JSON.stringify({ error: { code: 'validation_failed', message: 'Invalid.', details: [{ field: 'floorCpm', reason }] } }), { status: 400 })
      }
      return fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: [PG_LIST] } })(url)
    }))
    const dialog = await openTermsEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }))
    const warning = await screen.findByTestId('below-floor-warning')
    expect(warning).toHaveTextContent('below the platform floor of 5 USD')
    expect(warning).not.toHaveTextContent('Send belowFloorOverride')
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway (override)' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[0]).not.toHaveProperty('belowFloorOverride')
    expect(bodies[1]).toMatchObject({ belowFloorOverride: true })
  }, slow(30000))

  it('Finalise confirms the slots and terms, and Share deal shares the deal', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', draftFetch([{ positionId: 'menu_board.s2', label: 'Menu Board — Long Format' }], calls))
    const dialog = await openTermsEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Finalise deal terms' }))
    const summary = await screen.findByTestId('finalise-summary')
    expect(within(summary).getByTestId('finalise-slots')).toHaveTextContent('Menu Board — Long Format')
    expect(summary).toHaveTextContent('PH-7K2M9QXW4B')
    /* The creative the DSP must supply: supported formats and pixel resolution per slot. */
    const creative = await within(summary).findByText(/image \+ video, 1080×1920 \(portrait\), max play 15s/)
    expect(creative.closest('div')).toHaveTextContent('Menu Board — Long Format')
    expect(calls.map((c) => c.method)).toEqual(['PUT'])
    expect(calls.some((c) => c.url.endsWith('/share'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and share deal with DSPs' }))
    await waitFor(() => expect(calls.map((c) => c.url.split('/').pop())).toEqual(['bl_1', 'share']))
  }, slow(30000))

  it('shows the term version and saves a change that needs no re-acceptance without a warning', async () => {
    const puts: unknown[] = []
    vi.stubGlobal('fetch', termsFetch(false, puts))
    const dialog = await openTermsEditor()
    expect(within(dialog).getByTestId('term-version')).toHaveTextContent('Term version 3 · 1 of 1 buyers on this version')
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Q4 FMCG private auction'), { target: { value: 'Pharma brands 2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(screen.queryByText('Buyers will need to re-accept this deal')).not.toBeInTheDocument()
  }, slow(30000))

  it('warns before saving a term change that makes accepted buyers re-accept; Keep editing saves nothing', async () => {
    const puts: unknown[] = []
    vi.stubGlobal('fetch', termsFetch(true, puts))
    const dialog = await openTermsEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    const warning = await screen.findByTestId('reacceptance-warning')
    expect(screen.getAllByText('Buyers will need to re-accept this deal').length).toBeGreaterThan(0)
    expect(warning).toHaveTextContent('term version 4')
    expect(warning).toHaveTextContent('5130001 (Google DSP)')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByTestId('reacceptance-warning')).not.toBeInTheDocument())
    expect(puts).toHaveLength(0)
  }, slow(30000))

  it('saves the term change once the retailer chooses Save and request re-acceptance', async () => {
    const puts: unknown[] = []
    vi.stubGlobal('fetch', termsFetch(true, puts))
    const dialog = await openTermsEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save and request re-acceptance' }))
    await waitFor(() => expect(puts).toHaveLength(1))
  }, slow(30000))

  /* Ticket fgBVnNItNcu7qMBUtqH7: a list that invites seats on two DSPs shows one deal ID per DSP. */
  it('shows one deal ID per DSP on a cross-DSP buyers list', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const deals = [{ partnerId: 'p_google', dealId: 'PH-AAAAAAAAAA', retiredAt: null }, { partnerId: 'p_ttd', dealId: 'PH-BBBBBBBBBB', retiredAt: null }, { partnerId: 'p_old', dealId: 'PH-CCCCCCCCCC', retiredAt: '2026-10-01T00:00:00Z' }]
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', dealId: 'PH-AAAAAAAAAA', deals, name: 'Cross DSP', description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction' }] },
      '/api/admin/v1/available-inventory': inv,
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    expect(await within(table).findByText('PH-AAAAAAAAAA, PH-BBBBBBBBBB')).toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: 'Edit Cross DSP' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('textbox', { name: /Deal ID — Google/ })).toHaveValue('PH-AAAAAAAAAA')
    expect(within(dialog).getAllByRole('textbox', { name: /^Deal ID/ })).toHaveLength(2)
  })

  /* Ticket DbSVEGXNIWlYW68UQnY3: the table reads in DV360's terms. */
  it('labels the table in DV360 terms: Rate with its rate type, Buyers, Flight dates, and Pending / Active beside Shared', async () => {
    const base = { description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, status: 'shared', termVersion: 2 }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [
        { ...base, id: 'bl_1', dealId: 'PH-AAAAAAAAAA', name: 'Floor deal', dealType: 'private_auction', effectiveRateCpm: { min: 5, max: 5, source: 'buyer' }, buyerAcceptance: [{ partnerId: 'p_google', seatId: '5130001', state: 'accepted', acceptedVersion: 2, acceptedAt: null }] },
        { ...base, id: 'bl_2', dealId: 'PH-BBBBBBBBBB', name: 'Fixed deal', dealType: 'guaranteed', effectiveRateCpm: { min: 7, max: 7, source: 'buyer' }, buyerAcceptance: [{ partnerId: 'p_google', seatId: '5130001', state: 'reacceptance_required', acceptedVersion: 1, acceptedAt: null }] },
      ] },
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    expect(await within(table).findByText('Floor deal')).toBeInTheDocument()
    for (const h of ['Details', 'Buyer(s)', 'Flight dates', 'Deal ID']) expect(within(table).getAllByText(h).length).toBeGreaterThan(0)
    /* Ticket nfDLP1CZiPjGfN8FG764: Rate and Deal type are one Details column. */
    for (const gone of ['Rate', 'Deal type']) expect(within(table).queryByText(gone)).toBeNull()
    expect(within(table).getByTestId('details-summary-bl_1')).toHaveTextContent('Private auction')
    for (const old of ['CPM', 'Invited buyers', 'Delivery term']) expect(within(table).queryByText(old)).toBeNull()
    expect(within(table).getByTestId('rate-type-bl_1')).toHaveTextContent('CPM floor')
    expect(within(table).getByTestId('rate-type-bl_2')).toHaveTextContent('CPM fixed')
    expect(within(table).getByTestId('status-bl_1')).toHaveTextContent('Shared · Active')
    expect(within(table).getByTestId('status-bl_2')).toHaveTextContent('Shared · Pending · re-acceptance required')
  })

  /* Ticket NVW5Dvyg60QeYQbEPBZM: the Deals table filters in its column headers like the other tables: Buyer(s) and Slots pick from a list, name and Deal ID are free text. */
  it('filters the deals table from its column headers: a buyer list, a slot list and free-text name and Deal ID', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', dealId: 'PH-AAAAAAAAAA', name: 'Floor deal', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction', status: 'shared', termVersion: 1 }] },
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    expect(await within(table).findByText('Floor deal')).toBeInTheDocument()
    expect(within(table).getByLabelText('Buyer(s) filter')).toBeInTheDocument()
    expect(within(table).getByLabelText('Slots filter')).toBeInTheDocument()
    expect(within(table).queryByLabelText('Buyer(s) search')).toBeNull()
    expect(within(table).getByLabelText('Deals and buyers lists search')).toBeInTheDocument()
    expect(within(table).getByLabelText('Deal ID search')).toBeInTheDocument()
    fireEvent.click(within(table).getByLabelText('Buyer(s) filter'))
    expect((await screen.findAllByRole('checkbox')).length).toBeGreaterThan(0)
  })

  /* Ticket 2DfVi3PvWSKARQXoWtGy: hovering Invited buyers lists them; hovering Deal ID names each DSP's deal. */
  it('shows the invited buyers and each DSP deal ID on hover', async () => {
    const deals = [{ partnerId: 'p_google', dealId: 'PH-AAAAAAAAAA', retiredAt: null }, { partnerId: 'p_ttd', dealId: 'PH-BBBBBBBBBB', retiredAt: null }]
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', dealId: 'PH-AAAAAAAAAA', deals, name: 'Cross DSP', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }, { partnerId: 'p_ttd', seatId: 'x1' }], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction' }] },
    })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    fireEvent.mouseOver(await within(table).findByText('2 buyers'))
    expect(await within(await screen.findByRole('tooltip')).findByText('Buyers')).toBeInTheDocument()
    fireEvent.mouseOver(within(table).getByText('PH-AAAAAAAAAA, PH-BBBBBBBBBB'))
    expect(await screen.findByText('PH-BBBBBBBBBB')).toBeInTheDocument()
  })

  /* Ticket oUZbsA7WrkPHSmbYd5B6: hovering a deal's name lists its targeting criteria, with or without a description. */
  it('shows a deal’s targeting criteria when its name is hovered', async () => {
    const base = { invitedBuyers: [], invitedCategories: [], activeFrom: null, activeTo: null, dealType: 'private_auction' }
    const lists = [
      { ...base, id: 'bl_1', name: 'Eastern states', description: 'Big metros', targeting: [{ source: 'store', variable: 'store.state', op: 'include', values: ['NSW', 'VIC'] }] },
      { ...base, id: 'bl_2', name: 'No blurb', description: '', targeting: [{ source: 'store', variable: 'store.state', op: 'include', values: ['QLD'] }] },
    ]
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: lists } })))
    renderAt('/advertisers', true, false, true, true)
    const table = await screen.findByLabelText('Deals and buyers lists')
    fireEvent.mouseOver(await within(table).findByText('No blurb'))
    const tip = await screen.findByTestId('targeting-tip-bl_2')
    expect(tip).toHaveTextContent('Targeting criteria')
    expect(tip).toHaveTextContent('State: includes selected QLD')
  }, slow(45000))

  /* Ticket ROSvBDdeLr3jCHgqRcUR: a deal never finalised and shared (a draft, programmatic guaranteed or Direct advertiser) can be deleted for good; a shared one only archived. */
  it('deletes a draft deal from its row, and offers no Delete on a shared deal', async () => {
    const base = { invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, description: '' }
    const draft = { ...base, status: 'draft', dealType: 'guaranteed', id: 'bl_1', dealId: 'PH-DRAFT00001', name: 'Draft PG deal' }
    const direct = { ...base, status: 'draft', dealType: 'direct', id: 'bl_3', dealId: 'PH-DIRECT0001', name: 'Draft direct deal' }
    const shared = { ...base, status: 'shared', dealType: 'guaranteed', id: 'bl_2', dealId: 'PH-SHARED0001', name: 'Shared PG deal' }
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        calls.push(url)
        return new Response(null, { status: 204 })
      }
      return fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: [draft, direct, shared] } })(url)
    }))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    expect(await within(table).findByLabelText('Delete Draft direct deal')).toBeInTheDocument()
    expect(within(table).queryByLabelText('Delete Shared PG deal')).toBeNull()
    fireEvent.click(within(table).getByLabelText('Delete Draft PG deal'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete Draft PG deal?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls).toEqual(['/api/admin/v1/buyers-lists/bl_1']))
  }, slow(45000))

  /* Ticket bCcJ2e00CRLxtd98Utlr: deals are archived, never deleted. The row action is Archive; View Archived Deals is an AG Grid table with a filter on every column. */
  it('archives a deal from its row and lists archived deals under View Archived Deals', async () => {
    const base = { invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction', description: '', status: 'draft' }
    const live = { ...base, status: 'shared', id: 'bl_1', dealId: 'PH-LIVE000001', name: 'Live deal' }
    const old = { ...base, id: 'bl_2', dealId: 'PH-OLD0000001', name: 'Ended deal', status: 'archived', archivedAt: '2026-10-01T00:00:00.000Z', archivedBy: 'system', assignedSlots: [{ positionId: 'portrait.s1', label: 'Portrait — Hero', displayTypeName: 'Portrait', slot: 1, zoneName: null, zoneSlot: 1, description: 'Entrance', storeZone: null }, { positionId: 'portrait.s2', label: 'Portrait — slot 2', displayTypeName: 'Portrait', slot: 2, zoneName: null, zoneSlot: 2, description: null, storeZone: null }] }
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/archive')) {
        calls.push(url)
        return new Response(JSON.stringify({ ...live, status: 'archived' }), { status: 200 })
      }
      return fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: url.includes('archived=true') ? [old] : [live] } })(url)
    }))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    expect(within(table).queryByLabelText('Delete Live deal')).toBeNull()
    fireEvent.click(await within(table).findByLabelText('Archive Live deal'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Archive Live deal?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(calls).toEqual(['/api/admin/v1/buyers-lists/bl_1/archive']))
    fireEvent.click(await screen.findByRole('button', { name: /View Archived Deals/ }))
    /* A page of its own (ticket cy45L5xGDqKwzt4diBBa), not a dialog. */
    expect(screen.queryByRole('dialog')).toBeNull()
    const archive = await screen.findByLabelText('Archived deals')
    expect(await within(archive).findByText('Ended deal')).toBeInTheDocument()
    expect(within(archive).getByText('PH-OLD0000001')).toBeInTheDocument()
    expect(within(archive).getByText('system')).toBeInTheDocument()
    /* The slots the deal held when it was archived, one per line (ticket VHuSQiHQoGCPPvreusgK). */
    expect(within(archive).getByText('Portrait (Entrance), slot 1')).toBeInTheDocument()
    expect(within(archive).getByText('Portrait, slot 2')).toBeInTheDocument()
    expect(archive.querySelectorAll('.ag-floating-filter').length).toBe(8)
    /* One page header, with the back link beside it and the explanation in its tooltip. */
    expect(screen.getAllByText('Archived deals')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Advertisers \/ Inventory/ })).toHaveAttribute('href', '/advertisers')
    expect(screen.queryByText(/Deals are archived, never deleted/)).toBeNull()
  }, slow(45000))

  /* Ticket Zxw7VRUSytMAovkbDFKt: with the dealTargeting flag off (the default) a deal's tooltip shows no targeting. */
  it('hides a deal’s targeting criteria in its tooltip when targeting is off', async () => {
    const lists = [{ id: 'bl_1', name: 'Eastern states', description: 'Big metros', invitedBuyers: [], invitedCategories: [], activeFrom: null, activeTo: null, dealType: 'private_auction', targeting: [{ source: 'store', variable: 'store.state', op: 'include', values: ['NSW'] }] }]
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: lists } })))
    renderAt('/advertisers')
    const table = await screen.findByLabelText('Deals and buyers lists')
    fireEvent.mouseOver(await within(table).findByText('Eastern states'))
    expect(await screen.findByText('Big metros')).toBeInTheDocument()
    expect(screen.queryByTestId('targeting-tip-bl_1')).toBeNull()
  }, slow(45000))

  /* Ticket Y3GzIlj2goQMJaGUwTey (9 Oct 2026): deals above an explicit Open auction, the DSPs it runs across below it. */
  it('shows an Open auction separator under the deals, with the DSP or All DSPs beneath it', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const lists = [{ id: 'bl_1', name: 'Pharma brands', description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction' }]
    const assigned = { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: 'bl_1', buyersListIds: ['bl_1'], openAuction: true }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: lists }, '/api/admin/v1/available-inventory': { ...inv, items: [{ ...inv.items[0], assignedTo: assigned }] } })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const cell = within(inventory).getAllByLabelText('Menu Board — Long Format slot 2: assigned to')[0].closest('.ag-cell') as HTMLElement
    expect(within(cell).getByRole('separator', { name: 'Open auction' })).toBeInTheDocument()
    expect(within(within(cell).getByRole('list', { name: /open auction DSPs/ })).getByText('All DSPs')).toBeInTheDocument()
  }, slow(45000))

  /* Ticket qyzG6XXIYZEJb2YZEQEH (15 Oct 2026): define Assigned to once on a slot, replicate it to the display type's other slots. */
  it('replicates one slot\'s Assigned to to the other slots on the same display type', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const row = inv.items[0]
    const items = [{ ...row, assignedTo: { ...row.assignedTo, openAuction: true } }, { ...row, slot: 3, zoneSlot: 3, assignedTo: { partnerIds: [], partnerNames: [], advertisers: [], whitelistOnly: false } }, inv.items[1]]
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/available-inventory': { ...inv, items } })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const selected = (n: number) => {
      const cell = within(inventory).getAllByLabelText(`Menu Board — Long Format slot ${n}: assigned to`)[0].closest('.ag-cell') as HTMLElement
      return [...cell.querySelectorAll('.ant-select-selection-item')].map((t) => t.textContent)
    }
    expect(selected(3)).not.toContain('Google DSP')
    expect(within(inventory).queryByLabelText('Portrait slot 1: copy assigned to all other slots on this display type')).toBeNull()
    fireEvent.click(within(inventory).getByLabelText('Menu Board — Long Format slot 2: copy assigned to all other slots on this display type'))
    await waitFor(() => expect(selected(3)).toContain('Google DSP'))
  }, slow(45000))

  /* Ticket 3FFOpIpry1XM29TimpJy (12 Oct 2026): Included in global deals stays selectable on a buyers-list slot and sits in the open tier, unnumbered. */
  it('keeps Included in global deals selectable with a buyers list, listed in the open auction beneath the numbered lists', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const lists = [{ id: 'bl_1', name: 'Confectionery', description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType: 'private_auction' }]
    const assigned = { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: 'bl_1', buyersListIds: ['bl_1'], openAuction: false }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: lists }, '/api/admin/v1/available-inventory': { ...inv, items: [{ ...inv.items[0], assignedTo: assigned, inGlobalDeal: true }] } })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const cell = within(inventory).getAllByLabelText('Menu Board — Long Format slot 2: assigned to')[0].closest('.ag-cell') as HTMLElement
    expect([...cell.querySelectorAll('.ant-select-selection-item')].map((t) => t.textContent)).toEqual(['Confectionery', 'Included in global deals'])
    expect(within(cell).getByRole('separator', { name: 'Open auction' })).toBeInTheDocument()
    const open = within(cell).getByRole('list', { name: /open auction DSPs/ })
    expect(within(open).getByText('Included in global deals')).toBeInTheDocument()
    expect(within(open).queryByLabelText(/^Position/)).toBeNull()
  }, slow(45000))

  /* Ticket z7qPFTdA4NOC3K9hYOAs (22 Oct 2026): deals that reserve the whole slot are not ranked in the waterfall. */
  it('ranks only the deals that share a slot; reserving deals sit apart, unnumbered', async () => {
    const inv = ADVERTISER_PAGE['/api/admin/v1/available-inventory']
    const mk = (id: string, name: string, dealType: string) => ({ id, name, description: '', invitedBuyers: [], invitedCategories: [], targeting: [], activeFrom: null, activeTo: null, dealType })
    const lists = [mk('bl_pg', 'Coke PG', 'guaranteed'), mk('bl_a', 'Auction A', 'private_auction'), mk('bl_b', 'Auction B', 'private_auction')]
    const assigned = { partnerIds: [], advertisers: [], whitelistOnly: false, buyersListId: 'bl_pg', buyersListIds: ['bl_pg', 'bl_a', 'bl_b'], openAuction: false }
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/buyers-lists': { items: lists }, '/api/admin/v1/available-inventory': { ...inv, items: [{ ...inv.items[0], assignedTo: assigned }] } })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const cell = within(inventory).getAllByLabelText('Menu Board — Long Format slot 2: assigned to')[0].closest('.ag-cell') as HTMLElement
    const ranked = within(cell).getByRole('list', { name: /buyers lists in priority order/ })
    expect(within(ranked).getAllByLabelText(/^Position/).map((n) => n.textContent)).toEqual(['1', '2'])
    expect(within(ranked).queryByText('Coke PG')).toBeNull()
    /* Reserving deals are not repeated under the picker: no list, no "Reserves the whole slot" line. */
    expect(within(cell).queryByRole('list', { name: /deals reserving the whole slot/ })).toBeNull()
    expect(within(cell).queryByText(/Reserves the whole slot/)).toBeNull()
  }, slow(45000))

  /* Ticket, 30 Sep 2026: a slot with no audience score is flagged in place; it can still be saved. */
  it('warns on a slot with no audience score', async () => {
    const reason = 'No audience score yet.'
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/available-inventory': {
        ...ADVERTISER_PAGE['/api/admin/v1/available-inventory'],
        items: [{ ...ADVERTISER_PAGE['/api/admin/v1/available-inventory'].items[0], scored: false, unsellableReason: reason }],
      },
    })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    expect(within(inventory).getByRole('status')).toHaveTextContent(reason)
  })

  /* Ticket hWXYjK6GPVVQTXpKw3Rm (9 Oct 2026): global deal membership is a removable chip in Assigned to. */
  it('removes and re-adds the Included in global deals chip, saving the slot flag', async () => {
    const calls: { url: string; body: unknown }[] = []
    const saved = () => calls.filter((c) => c.url.includes('available-inventory')).at(-1)?.body as { items: { inGlobalDeal?: boolean }[] } | undefined
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') calls.push({ url, body: JSON.parse(String(init.body)) })
      return fakeFetch(ADVERTISER_PAGE)(url)
    }))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const cell = () => within(inventory).getAllByLabelText('Menu Board — Long Format slot 2: assigned to')[0].closest('.ag-cell') as HTMLElement
    const chip = () => [...cell().querySelectorAll('.ant-select-selection-item')].find((t) => t.textContent === 'Included in global deals')
    expect(chip()).toBeTruthy()
    fireEvent.click(chip()!.querySelector('.ant-select-selection-item-remove')!)
    await waitFor(() => expect(chip()).toBeFalsy())
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(saved()?.items[0].inGlobalDeal).toBe(false))
  }, slow(45000))

  it('puts the global deal switch in Advertiser settings, not Exchange settings', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    renderAt('/dsp-integration/advertiser-settings')
    expect(await screen.findByRole('switch', { name: 'Enable global deal' })).toBeInTheDocument()
  }, slow(45000))

  it('offers no buyer by name in Assigned to (22 Oct 2026: slots are sold through deals), and never offers interactive targeting', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch(ADVERTISER_PAGE)))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    const combo = (row: string, label: string) =>
      within(within(inventory).getAllByLabelText(`${row}: ${label}`)[0].closest('.ag-cell') as HTMLElement).getByRole('combobox')

    /* The picker lists DSPs and deals, never an advertiser: neither a DSP's (Nestlé via Google DSP) nor a direct one. */
    fireEvent.mouseDown(combo('Menu Board — Long Format slot 2', 'assigned to'))
    expect((await screen.findAllByTitle('Google DSP')).length).toBeGreaterThan(0)
    expect(screen.queryByTitle('Nestlé (Google DSP)')).not.toBeInTheDocument()
    expect(screen.queryByText('Advertisers', { selector: '.ant-select-item-group' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  }, slow(45000))

  /* Floor CPM replaced Reserve price (Rob, 17 Oct 2026): every slot shows the
     platform floor as inherited, a typed value overrides it for that slot and
     is what gets saved, and the reset button clears it back to inherited. */
  it('shows the platform floor on every slot, saves a slot override, and resets it to inherited', async () => {
    const calls: { url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') calls.push({ url, body: JSON.parse(String(init.body)) })
      return fakeFetch(ADVERTISER_PAGE)(url)
    }))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    expect(within(inventory).queryByText('Reserve price')).not.toBeInTheDocument()
    expect(within(inventory).queryByText('Interactive reserve price')).not.toBeInTheDocument()
    const floor = () => within(inventory).getByLabelText('Menu Board — Long Format slot 2: floor CPM (inherited from the platform floor)') as HTMLInputElement
    expect(floor().placeholder).toBe('100')
    expect(floor().value).toBe('')
    expect(within(inventory).getAllByText('inherited').length).toBe(2)

    fireEvent.change(floor(), { target: { value: '150' } })
    const overridden = await within(inventory).findByLabelText('Menu Board — Long Format slot 2: floor CPM (override)')
    expect((overridden as HTMLInputElement).value).toBe('150')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.find((c) => c.url.includes('available-inventory'))?.body).toMatchObject({ items: [{ displayTypeId: 'menu_board', slot: 2, floorCpm: 150 }] }))

    /* Reset returns the draft to inheriting the platform floor. */
    fireEvent.click(await within(inventory).findByRole('button', { name: 'Menu Board — Long Format slot 2: reset floor CPM to the platform floor' }))
    expect((await within(inventory).findByLabelText('Menu Board — Long Format slot 2: floor CPM (inherited from the platform floor)') as HTMLInputElement).value).toBe('')
  }, slow(45000))

  /* Round 2 (23 Sep) failed testing twice on this exact picker: once because
     the buyers-lists group sat after Advertisers instead of directly under
     DSPs, and — after that was fixed — again because "Add buyer list is now
     missing completely from the drop-down menu". The suite that shipped
     with that second build never actually asserted the option was there at
     all, so it went green while the picker was reported broken. This test
     is that missing assertion: the option group's position, the option
     itself, and that it actually opens the modal. */
  it.each([false, true])('offers "+ Add new deal and buyers list…" in the Assigned to picker, and opens the modal (dealTargeting %s)', async (dealTargeting) => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({
      ...ADVERTISER_PAGE,
      '/api/admin/v1/buyers-lists': { items: [{ id: 'bl_1', name: 'Q4 FMCG Private Auction', description: '', invitedBuyers: [{ partnerId: 'p_google', seatId: '5130001' }], activeFrom: null, activeTo: null }] },
    })))
    renderAt('/advertisers', true, false, true, dealTargeting)
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
    fireEvent.change(combo, { target: { value: 'Add new deal' } })
    const addOption = await screen.findByText('+ Add new deal and buyers list…')
    expect(addOption).toBeInTheDocument()

    /* Choosing it is a picker action, not a real choice: it opens the
       modal and leaves this slot's own assignment untouched. (There are two
       BuyersListModal instances in the tree — this one and the Buyers
       lists table's own — so scope to the one that's actually open.) */
    fireEvent.click(addOption)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('New deal and buyers list')).toBeInTheDocument()
    /* Invited buyers is one dropdown of synced advertisers: nothing to type, no identifier type to pick. */
    expect(within(dialog).getByRole('combobox', { name: 'Buyers' })).toBeInTheDocument()
    /* One object carries who may buy AND the targeting criteria appended to the deal. */
    /* Targeting is behind the dealTargeting flag (off for the first release): no picker when off, the picker when on. */
    if (dealTargeting) expect(within(dialog).getByRole('combobox', { name: 'Targeting criteria' })).toBeInTheDocument()
    else expect(within(dialog).queryByRole('combobox', { name: 'Targeting criteria' })).toBeNull()
    expect(within(dialog).queryByText(/PH brand entity|identifier type/i)).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Add buyer/ })).toBeNull()
    /* The deal type drives the fields: a new list is programmatic guaranteed (the POC's only selectable type): committed plays, no auction window. */
    expect(within(dialog).getByRole('combobox', { name: 'Deal type' })).toBeInTheDocument()
    expect(within(dialog).getByTestId('deal-type-note')).toHaveTextContent('there is no bidding')
    expect(within(dialog).queryByLabelText('Auction closes')).toBeNull()
  }, slow(30000))

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
    fireEvent.change(combo, { target: { value: 'Add new deal' } })
    fireEvent.click(await screen.findByText('+ Add new deal and buyers list…'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('New deal and buyers list')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Q4 FMCG private auction'), { target: { value: 'Test deal' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }))

    /* The modal stays open (the save failed) but says so, rather than
       silently doing nothing. */
    expect(await screen.findByText(/the data is a snapshot/)).toBeInTheDocument()
    expect(within(dialog).getByText('New deal and buyers list')).toBeInTheDocument()
  }, slow(30000))

  it('in the hosted build, puts the route in the hash under the bundle\u2019s base', async () => {
    vi.stubEnv('VITE_DEMO', '1')
    vi.stubEnv('BASE_URL', './')
    const { externalUrl } = await import('../src/features/booking-schedule/path')
    expect(externalUrl('/booking-schedule')).toBe('./#/booking-schedule')
    expect(externalUrl('/booking-schedule?advertiserId=nestle')).toBe('./#/booking-schedule?advertiserId=nestle')
    vi.unstubAllEnvs()
    expect(externalUrl('/booking-schedule')).toBe('/booking-schedule')
  })

  it('shows a marketing user who may buy each slot, without letting them change it', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ ...ADVERTISER_PAGE, '/api/admin/v1/session': { role: 'hq_marketing', scopes: ['sections'] } })))
    renderAt('/advertisers')
    const inventory = await screen.findByLabelText('Available Inventory')
    /* Read-only: the same values as plain text, with nothing to open. */
    expect(within(inventory).getByText('Google DSP, Included in global deals')).toBeInTheDocument()
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
    const tip = (label: string) => screen.getByText(label, { exact: true }).closest('label')!.querySelector('[role="button"]') as HTMLElement
    fireEvent.mouseEnter(tip('CPM floor'))
    expect(await screen.findByText(/× attention \(VAC: the share who actually look\)/)).toBeInTheDocument()
    expect(screen.getByText(/100 × 27 ÷ 1,000/)).toBeInTheDocument()

    expect(screen.queryByText('Personalised multiplier')).not.toBeInTheDocument()

    /* Interactive campaigns are deferred (5 Oct 2026): no engagement field in Pricing. */
    expect(screen.queryByText('Interactive cost per engagement')).not.toBeInTheDocument()
  })
})

describe('Change history page', () => {
  const entry = (over: Record<string, unknown>) => ({
    id: 'aud_1', at: '2026-10-09T08:30:00.000Z', changeId: 'chg_1', request: 'PUT /api/admin/v1/available-inventory', reason: null,
    objectType: 'display_type', objectId: 'menu_board', objectLabel: 'Menu Board — Long Format', changeType: 'updated',
    field: 'slots[2].floorCpm', oldValue: 150, newValue: 250,
    actor: { type: 'agent', id: 'agent:cpm-tuner', name: 'CPM tuner', sessionUserId: 'u_hq_admin' }, ...over,
  })

  it('lists who changed which setting, from what to what, telling people from agents', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/ssp-audit-log': { items: [
      entry({}),
      entry({ id: 'aud_2', objectType: 'exchange', objectId: 'exchange', objectLabel: 'Exchange settings', field: 'globalDealEnabled', oldValue: false, newValue: true, reason: 'Open to deal-only DSPs', actor: { type: 'human', id: 'u_hq_admin', name: 'HQ Admin (POC)', sessionUserId: 'u_hq_admin' } }),
    ], next: null } })))
    renderAt('/dsp-integration/change-history')
    expect(await screen.findByRole('heading', { name: /Change history/ })).toBeInTheDocument()
    expect(await screen.findByText('slots[2].floorCpm')).toBeInTheDocument()
    expect(screen.getByText('CPM tuner')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('Person')).toBeInTheDocument()
    expect(screen.getByText('globalDealEnabled')).toBeInTheDocument()
    expect(screen.getByText('Reason: Open to deal-only DSPs')).toBeInTheDocument()
  })

  /* Behind the changeHistory flag (Rob, 9 Oct 2026): no menu row while it is off. */
  it('hides the menu row and the page while the changeHistory flag is off', async () => {
    renderAt('/dsp-integration/exchange', true, false, false)
    const nav = await screen.findByRole('navigation', { name: 'DSP Integration' })
    expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('aria-label'))).not.toContain('Change history')
  })

  it('says so when nothing has changed yet, and filters through the API', async () => {
    const fetchMock = vi.fn(fakeFetch({ '/api/admin/v1/ssp-audit-log': { items: [], next: null } }))
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/dsp-integration/change-history')
    expect(await screen.findByText(/No settings have been changed yet/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'floorCpm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('fieldPrefix=floorCpm'))).toBe(true))
    expect(await screen.findByText('No changes match these filters.')).toBeInTheDocument()
  })
})


/* Deal IDs (ticket DLhjuhbTqJS2uAvhh0I8): the table groups advertiser → deal ID →
   campaign; the group cells carry tick-all boxes on the one selection set. */
describe('Upcoming Campaign Approval — deal IDs', () => {
  const base = {
    source: 'api', partnerId: 'p_google', partnerName: 'Google DSP', displayTypeId: 'portrait', pricingType: 'localised', activation: { enabled: false },
    schedule: { nextWindowStart: null, bookedWindows: 0 }, lastPlayedAt: null, brief: { details: 'x', touchPoints: ['Digital Signage'] },
    campaignCount: 1, localisedVariables: [], localisedRuleLines: [], personalisedVariables: [], personalisedRuleLines: [],
  }
  const camp = (campaignId: string, name: string, advertiserId: string, advertiserName: string, dealId?: string) => ({ ...base, campaignId, name, advertiserId, advertiserName, ...(dealId ? { dealId } : {}) })
  const approvalOf = (c: { campaignId: string; name: string }, status = 'awaiting_approval', creativeId: string | null = null, dealId: string | null = null) => ({
    campaignId: c.campaignId, campaignName: c.name, status, mode: 'manual', assetVersion: 'v1', submittedAt: '2026-10-01T00:00:00.000Z', reviewedBy: null, reviewedAt: null, reason: null, checks: [], creativeId, dealId,
  })
  const a1 = camp('d1', 'Swisse sleep', 'swisse', 'Swisse', 'PMP-1')
  const a2 = camp('d2', 'Swisse energy', 'swisse', 'Swisse', 'PMP-1')
  const a3 = camp('d3', 'Swisse focus', 'swisse', 'Swisse', 'PMP-2')
  const a4 = camp('d4', 'Swisse direct', 'swisse', 'Swisse')
  const n1 = camp('d5', 'Nestlé oats', 'nestle', 'Nestlé', 'PMP-9')
  const campaigns = [a1, a2, a3, a4, n1]
  const routes: Record<string, unknown> = {
    '/api/admin/v1/campaigns': { items: campaigns },
    ...Object.fromEntries(campaigns.map((c) => [`/api/admin/v1/campaigns/${c.campaignId}/approval`, approvalOf(c, 'awaiting_approval', null, c.dealId ?? null)])),
    '/api/admin/v1/creative-ids': {
      items: [{ creativeId: 'CR-DEAL0001', advertiserId: 'swisse', advertiserName: 'Swisse', dealId: 'PMP-1', dealIds: ['PMP-1'], direct: false, createdAt: '2026-10-01T00:00:00.000Z', campaigns: [{ campaignId: 'd9', name: 'Swisse nap', touchPoints: ['Digital Signage'], dealId: 'PMP-1', dealIds: ['PMP-1'], direct: false }] }],
    },
    '/api/admin/v1/booking-schedule': { currency: 'AUD', windows: [], positions: [], revenue: [], dsps: [], byPricingType: [], totals: { bookedWindows: 0, bookedRevenue: 0, billedRevenue: 0 } },
  }
  const posts: { url: string; body: any }[] = []
  const gets: string[] = []
  beforeEach(() => {
    posts.length = 0
    gets.length = 0
    const get = fakeFetch(routes as never)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify({ creativeId: 'CR-NEW00000', approvals: [] }), { status: 200 })
      }
      gets.push(url)
      return get(url)
    }))
  })
  const open = async () => {
    renderAt('/booking-schedule?tab=campaign-status')
    const grid = await screen.findByLabelText('Campaign Status')
    await within(grid).findByLabelText('Select Swisse sleep', {}, { timeout: 10000 })
    return grid
  }
  const ticked = (grid: HTMLElement) => [...grid.querySelectorAll<HTMLInputElement>('input[aria-label^="Select "]:checked')].map((i) => i.getAttribute('aria-label')).filter((l) => !l?.startsWith('Select all '))

  const tickRow = (grid: HTMLElement, name: string) => fireEvent.click(within(grid).getByLabelText(`Select ${name}`))

  it('shows each advertiser once on a group row with the one tick-all box, and each deal on its campaigns', async () => {
    const grid = await open()
    expect(within(grid).getAllByLabelText(/^Select all /)).toHaveLength(2)
    expect(within(grid).getAllByLabelText('Select all Swisse')).toHaveLength(1)
    expect(within(grid).getAllByLabelText('Select all Nestlé')).toHaveLength(1)
    /* One box on every row, a group row included: 5 campaigns + 2 advertisers. */
    expect(new Set([...grid.querySelectorAll('input[aria-label^="Select "]')].map((i) => i.getAttribute('aria-label'))).size).toBe(7)
    expect(within(grid).getAllByText('PMP-1')).toHaveLength(2)
  }, slow(45000))

  it('ticks an advertiser’s campaigns from its box, and shows partial', async () => {
    const grid = await open()
    fireEvent.click(within(grid).getByLabelText('Select all Swisse'))
    await waitFor(() => expect(ticked(grid)).toHaveLength(4))
    expect(await screen.findByText('4 selected')).toBeInTheDocument()
    fireEvent.click(within(grid).getByLabelText('Select Swisse direct'))
    await waitFor(() => expect((within(grid).getByLabelText('Select all Swisse') as HTMLInputElement).indeterminate).toBe(true))
  }, slow(45000))

  it('keeps the approve actions across deals of one advertiser, hides them across advertisers, keeping Reject Selected', async () => {
    const grid = await open()
    tickRow(grid, 'Swisse sleep')
    tickRow(grid, 'Swisse energy')
    expect(await screen.findByRole('button', { name: 'Approve Selected' })).toBeInTheDocument()
    tickRow(grid, 'Swisse focus')
    expect(await screen.findByRole('button', { name: 'Approve Selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject Selected' })).toBeInTheDocument()
    tickRow(grid, 'Nestlé oats')
    await waitFor(() => expect(screen.getByText(/one advertiser/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Approve Selected' })).not.toBeInTheDocument()
  }, slow(45000))

  it('asks for the deal’s IDs and pre-highlights the deal’s only one, tagged same deal', async () => {
    const grid = await open()
    tickRow(grid, 'Swisse sleep')
    tickRow(grid, 'Swisse energy')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and add to existing creative ID' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('same deal (PMP-1)', {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /CR-DEAL0001/ })).toBeChecked())
    expect(gets.some((u) => u.includes('creative-ids') && !u.includes('dealId='))).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Approve and add to CR-DEAL0001' })).toBeInTheDocument()
  }, slow(45000))
})
/* Ticket 7eg5M9Z6AT2wA6iKrXrs: the filter-row totals follow the DSP filter, ignore the advertiser filter, and run in date order. */
describe('booking schedule filter-row totals', () => {
  const day = (date: string, totalPlays: number, availableToBid: number) => ({ date, totalPlays, firmPlays: totalPlays - availableToBid, availableToBid, deals: [], segments: [] })
  const position = (positionId: string) => ({ positionId, displayTypeId: 'portrait', displayTypeName: 'Portrait', slot: 0, slotLabel: 'Slot 1', displayCount: 1, zoneName: null, zoneSlot: 0, partnerNames: [], assignment: 'open', realTime: false, recentPlays: null, windows: [] })
  const schedule = (dates: string[], ids = ['p1', 'p2']) => ({
    currency: 'AUD', windows: dates.map((d) => ({ start: `${d}T00:00:00.000Z`, end: `${d}T23:59:59.000Z` })), revenue: [], dsps: [{ partnerId: 'p_google', name: 'Google DSP', advertisers: [] }], directAdvertisers: [], byPricingType: [],
    totals: { bookedWindows: 0, sellableWindows: 0, bookedRevenue: 0, billedRevenue: 0, realtimeOpportunities: 0, realtimeFilled: 0 },
    positions: ids.map((id) => ({ ...position(id), windows: dates.map((d) => ({ start: `${d}T00:00:00.000Z`, status: 'available', booking: null })) })),
  })
  /* Each handler sees the query string, which fakeFetch drops. */
  const stub = (sched: unknown, capacity: (query: URLSearchParams) => unknown) => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      const [path, qs] = url.split('?')
      if (path === '/api/admin/v1/booking-schedule') return new Response(JSON.stringify(sched), { status: 200 })
      if (path === '/api/admin/v1/booking-schedule/capacity') return new Response(JSON.stringify(capacity(new URLSearchParams(qs))), { status: 200 })
      return fakeFetch()(url)
    }))
    return calls
  }
  const chip = (label: RegExp) => screen.findByLabelText(label, {}, { timeout: 10000 })

  it('asks for the picked DSP only, and returns to the whole estate when it is cleared', async () => {
    const dates = ['2026-10-27']
    const calls = stub(schedule(dates), (q) => ({ days: dates, positions: q.get('partnerId') === 'p_google' ? [{ ...position('p1'), days: [day(dates[0], 100, 40)] }] : [{ ...position('p1'), days: [day(dates[0], 100, 40)] }, { ...position('p2'), days: [day(dates[0], 50, 10)] }] }))
    const router = renderAt('/booking-schedule')
    expect(await chip(/Plays and plays available to bid, Tue 27 Oct/)).toHaveTextContent('150 plays')
    router.navigate('/booking-schedule?partnerId=p_google')
    await waitFor(() => expect(screen.getByLabelText(/Plays and plays available to bid, Tue 27 Oct/)).toHaveTextContent('100 plays'), { timeout: 10000 })
    expect(calls.some((u) => u.includes('/capacity') && u.includes('partnerId=p_google'))).toBe(true)
    router.navigate('/booking-schedule')
    await waitFor(() => expect(screen.getByLabelText(/Plays and plays available to bid, Tue 27 Oct/)).toHaveTextContent('150 plays'), { timeout: 10000 })
  }, slow(45000))

  it('does not change with the advertiser filter, whatever positions the schedule narrows to', async () => {
    const dates = ['2026-10-27']
    const calls = stub(schedule(dates, ['p1']), () => ({ days: dates, positions: [{ ...position('p1'), days: [day(dates[0], 100, 40)] }, { ...position('p2'), days: [day(dates[0], 50, 10)] }] }))
    renderAt('/booking-schedule?advertiserId=nestle')
    expect(await chip(/Plays and plays available to bid, Tue 27 Oct/)).toHaveTextContent('150 plays')
    expect(calls.filter((u) => u.includes('/capacity')).every((u) => !u.includes('advertiserId'))).toBe(true)
  }, slow(45000))

  it('reads the Monthly roll-up cells as N of M booked, with the layer counts', async () => {
    const months = ['2026-10-27', '2026-11-01']
    const sched = schedule(months, ['p1'])
    const rollup = (booked: number) => ({ windows: 4, booked, open: 4 - booked, reserved: 0, localised: booked, personalised: 0, advertisers: booked ? ['Swisse'] : [], bookedRevenue: booked * 10 })
    sched.positions[0].windows = months.map((d, i) => ({ start: `${d}T00:00:00.000Z`, status: i ? 'available' : 'booked', booking: null, assumedViews: 100, rollup: rollup(i ? 0 : 3) })) as never
    stub(sched, () => ({ days: [], positions: [] }))
    renderAt('/booking-schedule')
    fireEvent.click(await screen.findByText('Monthly', {}, { timeout: 10000 }))
    expect(await screen.findByText('3 of 4 booked', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(screen.getByText('4 open')).toBeInTheDocument()
  }, slow(45000))

  /* Ticket Hh87Dja2TgYrug606Uq0: Monthly defaults to a 12-month range, the server rolls it up (view=monthly), and the plays totals (capped at 92 days) are skipped. */
  it('asks for the 12-month Monthly roll-up and shows no plays chips beyond the 92-day cap', async () => {
    const dates = ['2026-10-27', '2026-11-03', '2026-12-01', '2027-01-05']
    const calls = stub(schedule(dates), () => ({ days: dates, positions: [{ ...position('p1'), days: dates.map((d) => day(d, 10, 5)) }] }))
    renderAt('/booking-schedule')
    fireEvent.click(await screen.findByText('Monthly', {}, { timeout: 10000 }))
    await waitFor(() => expect(calls.some((u) => u.includes('/booking-schedule?') && u.includes('view=monthly'))).toBe(true), { timeout: 10000 })
    const monthly = new URL(calls.filter((u) => u.includes('view=monthly')).pop() as string, 'http://x')
    expect((Date.parse(monthly.searchParams.get('to') as string) - Date.parse(monthly.searchParams.get('from') as string)) / 86_400_000).toBe(365)
    expect(screen.queryAllByLabelText(/Plays and plays available to bid, /)).toHaveLength(0)
    const capacityDays = calls.filter((u) => u.includes('/capacity')).map((u) => { const q = new URL(u, 'http://x').searchParams; return (Date.parse(q.get('to') as string) - Date.parse(q.get('from') as string)) / 86_400_000 })
    expect(Math.max(...capacityDays)).toBeLessThanOrEqual(92)
  }, slow(45000))
})
