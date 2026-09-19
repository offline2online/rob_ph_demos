import { render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'
import { newDisplayType } from '../src/features/display-types/model'

const menuBoard = {
  ...newDisplayType('menu_board'),
  name: 'Menu Board — Long Format',
  displayCanvasSize: { width: 5760, height: 1080 },
  defaultPlaylistId: 'pl_menu',
  playlistSettings: { assetPosition: null, assetFill: null, maximumCampaignsPlayedInRotation: 3, campaignTransition: null, campaignAutoRotation: null, campaignAutoPlay: null },
  phExtensions: { slots: [
    { label: 'Priority 1', owner: 'internal' }, { label: 'Supplier slot', owner: 'advertiser', listMode: 'rtb' }, { label: 'Store choice', owner: 'retail', storeScope: 'Store staff' },
  ] },
}
const landscape = { ...newDisplayType('landscape'), name: 'Landscape', defaultPlaylistId: 'pl_landscape' }
const responses: Record<string, unknown> = {
  '/api/admin/v1/session': { userId: 'u', name: 'HQ Admin (POC)', role: 'hq_admin' },
  '/api/admin/v1/display-types': { items: [landscape, menuBoard] },
  '/api/admin/v1/playlists': { items: [
    { id: 'pl_landscape', name: 'Landscape Playlist', autoCreatedFor: 'landscape', assignments: [] },
    { id: 'pl_menu', name: 'Menu Board Playlist', autoCreatedFor: 'menu_board', assignments: [] },
  ] },
  '/api/admin/v1/partners': { items: [] },
  '/api/admin/v1/advertiser-settings': { currency: 'AUD', floorCpm: 100, personalisedMultiplier: 1.5, interactiveMultiplier: 3, advertiserWhitelist: [], advertiserBlacklist: [], categoryWhitelist: [], categoryBlacklist: [], whereTheseApply: [] },
  '/api/admin/v1/advertisers': { currency: 'AUD', floorCpm: 100, items: [] },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(responses[url.split('?')[0]] ?? {}), { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

const renderAt = (path: string, dspIntegration: boolean) => {
  const router = createMemoryRouter(appRoutes({ dspIntegration }), { initialEntries: [path] })
  render(<Providers><RouterProvider router={router} /></Providers>)
}

describe('Display Types page', () => {
  it('matches the prototype structure: title, list, one-column form, collapsed panels, save bar', async () => {
    renderAt('/display-types?id=menu_board', true)
    expect(await screen.findByText('Display Types Details')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Display Types/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /New display type/ })).toBeInTheDocument()
    const list = screen.getByRole('listbox', { name: 'Display types' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Landscape'), expect.stringContaining('Menu Board — Long Format')])

    const labels = Array.from(document.querySelectorAll('label')).map((l) => l.textContent)
    expect(labels.slice(0, 5)).toEqual(['Touch Point', '*Display Type Name', '*Display Canvas Size (Resolution)', 'Background Color', 'Default Playlist'])

    const panels = ['Playlist Settings', 'Phantom Zone', 'Enabled Features', 'Multi-Zone Layout'].map((t) => screen.getByRole('region', { name: t }))
    panels.forEach((p) => expect(within(p).getByRole('button', { expanded: false })).toBeInTheDocument())
    expect(within(panels[0]).getByText('3 slots')).toBeInTheDocument()
    expect(within(panels[0]).getByText('1 Advertiser')).toBeInTheDocument()

    expect(screen.getByText('No changes to save.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('offers only Digital Signage and Kiosk, with no pairing toggle (decision 1)', async () => {
    renderAt('/display-types?id=landscape', true)
    await screen.findByText('Display Preview')
    expect(screen.queryByText('Idle')).not.toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Responsive Web|Mobile Store Site|Element Type/)
  })

  it('hides slot ownership with the dspIntegration flag off and never asks for DSP data', async () => {
    renderAt('/display-types?id=menu_board', false)
    const panel = await screen.findByRole('region', { name: 'Playlist Settings' })
    expect(within(panel).getByText('3 slots')).toBeInTheDocument()
    expect(within(panel).queryByText('1 Advertiser')).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => /partners|advertiser/.test(u))).toBe(false)
  })
})
