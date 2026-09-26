import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'
import { newDisplayType } from '../src/features/display-types/model'

const menuBoard = {
  ...newDisplayType('menu_board'),
  name: 'Menu Board — Long Format',
  defaultPlaylistId: 'pl_menu',
  playlistSettings: { assetPosition: null, assetFill: null, maximumCampaignsPlayedInRotation: 3, campaignTransition: null, campaignAutoRotation: null, campaignAutoPlay: null },
  phExtensions: { slots: [
    { label: 'Priority 1', owner: 'internal' }, { label: 'Supplier slot', owner: 'advertiser', listMode: 'rtb' }, { label: 'Store choice', owner: 'retail', storeScope: 'Store staff' },
  ] },
}
const landscape = { ...newDisplayType('landscape'), name: 'Landscape', defaultPlaylistId: 'pl_landscape' }

const playlists = { items: [
  { id: 'pl_landscape', name: 'Landscape Playlist', autoCreatedFor: 'landscape', assignments: [{ displayTypeId: 'landscape', displayTypeName: 'Landscape', zoneId: null, zoneName: null }] },
  { id: 'pl_menu', name: 'Menu Board Playlist', autoCreatedFor: 'menu_board', assignments: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', zoneId: null, zoneName: null }] },
  { id: 'pl_seasonal', name: 'Seasonal Overflow', autoCreatedFor: null, assignments: [] },
  { id: 'pl_shared', name: 'Shared Rotation', autoCreatedFor: null, assignments: [
    { displayTypeId: 'landscape', displayTypeName: 'Landscape', zoneId: null, zoneName: null },
    { displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', zoneId: 'z1', zoneName: 'Zone 1' },
  ] },
] }

const responses: Record<string, unknown> = {
  '/api/admin/v1/session': { userId: 'u', name: 'HQ Admin (POC)', role: 'hq_admin' },
  '/api/admin/v1/display-types': { items: [landscape, menuBoard] },
  '/api/admin/v1/playlists': playlists,
  '/api/admin/v1/partners': { items: [] },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(responses[url.split('?')[0]] ?? {}), { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

const renderAt = (path: string, dspIntegration = false) => {
  const router = createMemoryRouter(appRoutes({ dspIntegration }), { initialEntries: [path] })
  render(<Providers><RouterProvider router={router} /></Providers>)
  return router
}

describe('Playlist Management page', () => {
  it('shows the count line, a titled page, rename and delete per row, and no New playlist (decision 4)', async () => {
    renderAt('/playlists')
    await waitFor(() => expect(screen.getByText(/Playlists ·/)).toBeInTheDocument())
    expect(screen.getByText(/Playlists ·/).textContent).toBe('4 Playlists · 1 unused')
    expect(screen.getByRole('button', { name: /A playlist is created automatically/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New playlist/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Playlist Management/ })).toBeInTheDocument()
  })

  /* The ticket this moved for (26 Sep 2026): Playlist Settings comes off the
     display type and shows under its playlist here instead, same disclosure
     pattern (chevron + summary chips), same Save changes bar as a page. */
  it('expands a playlist row to show its settings, with the page-level Save changes bar', async () => {
    renderAt('/playlists', true)
    expect(await screen.findByText('No changes to save.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    const toggle = await screen.findByRole('button', { name: 'Show settings for Menu Board Playlist' })
    expect(within(toggle).getByText('3 slots')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(await screen.findByText('Asset Position')).toBeInTheDocument()
    expect(screen.getByText('Campaign Auto-Play')).toBeInTheDocument()
    /* One assignment: no per-display-type heading. */
    expect(screen.queryByText('Menu Board — Long Format')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide settings for Menu Board Playlist' }))
    await waitFor(() => expect(screen.queryByText('Asset Position')).not.toBeInTheDocument())
  })

  it('shows one settings block per assignment, labelled, for a playlist used by more than one display type', async () => {
    renderAt('/playlists', true)
    const toggle = await screen.findByRole('button', { name: 'Show settings for Shared Rotation' })
    expect(within(toggle).getByText('2 display types')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(await screen.findAllByText('Asset Position')).toHaveLength(2)
    expect(screen.getByText('Landscape')).toBeInTheDocument()
    expect(screen.getByText('Menu Board — Long Format')).toBeInTheDocument()
    expect(screen.getByText('Zone 1')).toBeInTheDocument()
  })

  /* Rob, 24 Sep 2026: with DSP integration switched off (Exchange settings),
     Advertiser is greyed out — not hidden — for a slot that isn't one, and
     an existing Advertiser slot is left as it is. Ported from the display
     type's own test when slot assignment moved here, 26 Sep 2026. */
  it('greys out Advertiser for a new slot while DSP integration is switched off, and keeps the existing one', async () => {
    const off: Record<string, unknown> = { ...responses, '/api/admin/v1/features': { dspIntegration: false } }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(off[url.split('?')[0]] ?? {}), { status: 200 })))
    renderAt('/playlists?displayTypeId=menu_board', true)
    const advertiserOption = async (slot: number) => {
      fireEvent.mouseDown(await screen.findByRole('combobox', { name: `Slot ${slot} owner` }))
      const opts = await waitFor(() => {
        const found = Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option'))
        expect(found.length).toBeGreaterThan(0)
        return found
      })
      const adv = opts.find((o) => o.textContent === 'Advertiser')!
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
      return adv
    }
    /* Slot 1 (Headquarters): Advertiser is there, greyed out, and says why. */
    const s1 = await advertiserOption(1)
    await waitFor(() => expect(s1.getAttribute('aria-disabled') ?? String(s1.classList.contains('ant-select-item-option-disabled'))).toBe('true'))
    expect(s1.getAttribute('title')).toMatch(/Enable DSP Integration/)
    /* Slot 2 is already an Advertiser slot: left as it is. */
    expect(within(screen.getByTestId('slot-card-2')).getByText('Advertiser')).toBeInTheDocument()
    const s2 = await advertiserOption(2)
    expect(s2.classList.contains('ant-select-item-option-disabled')).toBe(false)
  })

  it('hides slot ownership with the dspIntegration flag off and never asks for DSP data', async () => {
    renderAt('/playlists', false)
    const toggle = await screen.findByRole('button', { name: 'Show settings for Menu Board Playlist' })
    expect(within(toggle).getByText('3 slots')).toBeInTheDocument()
    expect(within(toggle).queryByText('1 Advertiser')).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => /partners|advertiser/.test(u))).toBe(false)
  })

  /* Available Inventory's "Open" action (Rob, 20 Sep; moved here 26 Sep
     2026 when Playlist Settings, where slot assignment lives, moved off the
     display type): lands on that display type's default playlist, expanded. */
  it('opens straight into a display type’s settings from a ?displayTypeId= deep link', async () => {
    renderAt('/playlists?displayTypeId=menu_board', true)
    expect(await screen.findByText('Asset Position')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide settings for Menu Board Playlist' })).toBeInTheDocument()
  })
})
