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
  it('shows Pricing, the four lists, Where these apply and Available Inventory, in that order', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch({ '/api/admin/v1/available-inventory': { items: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', touchPoint: 'Digital Signage', playlistName: 'Menu Board Playlist', slot: 2, position: 'Supplier slot', partnerName: 'Google DSP' }] } })))
    renderAt('/dsp-integration')
    expect(await screen.findByRole('heading', { name: /Advertiser settings/ })).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    const order = ['Pricing', 'List management', 'Where these apply', 'Available Inventory'].map((h) => text.indexOf(h))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(screen.getByLabelText(/Currency/)).toBeInTheDocument()
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
