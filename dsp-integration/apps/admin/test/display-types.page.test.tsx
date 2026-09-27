import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'
import { newDisplayType } from '../src/features/display-types/model'

const menuBoard = {
  ...newDisplayType('menu_board'),
  name: 'Menu Board — Long Format',
  displayCanvasSize: { width: 5760, height: 1080 },
  defaultPlaylistId: 'pl_menu',
  playlistSettings: { maximumCampaignsPlayedInRotation: 3 },
  phExtensions: { slots: [
    { label: 'Priority 1', owner: 'internal' }, { label: 'Supplier slot', owner: 'advertiser', listMode: 'rtb' }, { label: 'Store choice', owner: 'retail', storeScope: 'Store staff' },
  ] },
}
const landscape = { ...newDisplayType('landscape'), name: 'Landscape', defaultPlaylistId: 'pl_landscape' }
const responses: Record<string, unknown> = {
  '/api/admin/v1/session': { userId: 'u', name: 'HQ Admin (POC)', role: 'hq_admin' },
  '/api/admin/v1/display-types': { items: [landscape, menuBoard] },
  '/api/admin/v1/playlists': { items: [
    { id: 'pl_landscape', name: 'Landscape Playlist', autoCreatedFor: 'landscape', playlistSettings: {}, assignments: [] },
    { id: 'pl_menu', name: 'Menu Board Playlist', autoCreatedFor: 'menu_board', playlistSettings: {}, assignments: [] },
  ] },
  '/api/admin/v1/partners': { items: [] },
  '/api/admin/v1/advertiser-settings': { currency: 'AUD', floorCpm: 100, personalisedMultiplier: 1.5, interactiveCpe: 0.5, advertiserWhitelist: [], advertiserBlacklist: [], categoryWhitelist: [], categoryBlacklist: [], whereTheseApply: [] },
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

    /* Playlist Settings (and slot assignment) moved to Playlist Management,
       under each playlist, 26 Sep 2026 — no longer one of this page's panels
       (see playlist-management.test.tsx for its own coverage). */
    const panels = ['Phantom Zone', 'Enabled Features', 'Multi-Zone Layout'].map((t) => screen.getByRole('region', { name: t }))
    panels.forEach((p) => expect(within(p).getByRole('button', { expanded: false })).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Playlist Settings' })).not.toBeInTheDocument()

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

  /* Ticket, 27 Sep 2026: "Add new playlist" creates a playlist that doesn't
     exist on Playlist Management yet, so its own settings (what it'll
     actually be created with) are shown as a read-only preview right here
     while it's still a local draft — defaulting Auto-Rotation/Auto-Play
     off, not the "On" platform default a brand new, unconfigured playlist
     used to silently inherit — with a link to Playlist Management rather
     than a second, competing editor (Rob's own follow-up on the ticket),
     and disappearing from this page the moment Save actually creates it. */
  it('shows a read-only Playlist Settings preview, defaulting Auto-Rotation/Auto-Play off, only while the Default Playlist is still unsaved', async () => {
    renderAt('/display-types?id=landscape', true)
    await screen.findByText('Display Preview')
    expect(screen.queryByText(/Playlist Settings —/)).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Default Playlist' }))
    fireEvent.click(await screen.findByText('Add new playlist'))

    expect(await screen.findByText('Playlist Settings — Landscape Playlist 2')).toBeInTheDocument()
    const autoRotation = screen.getByRole('combobox', { name: 'Campaign Auto-Rotation' })
    const autoPlay = screen.getByRole('combobox', { name: 'Campaign Auto-Play' })
    expect(autoRotation.closest('.ant-select')).toHaveTextContent('Auto-Rotate Off')
    expect(autoRotation.closest('.ant-select')).toHaveClass('ant-select-disabled')
    expect(autoPlay.closest('.ant-select')).toHaveTextContent('Auto-Play Off')
    expect(autoPlay.closest('.ant-select')).toHaveClass('ant-select-disabled')

    /* A link to Playlist Management, not editable fields here. Leaving with
       this unsaved (the new playlist only exists as a local draft) goes
       through the usual discard-changes guard. */
    fireEvent.click(screen.getByRole('button', { name: /Playlist Management/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }))
    expect(await screen.findByRole('button', { name: 'Show settings for Landscape Playlist' })).toBeInTheDocument()
  })

  /* The real backend (ensureReferencedPlaylists) auto-creates the referenced
     playlist and persists the display type's new defaultPlaylistId, so a
     refetch after Save genuinely differs from before — this stateful mock
     reproduces that (a static mock wouldn't: react-query's structural
     sharing keeps the old, unsaved-draft-shaped reference around when a
     refetch returns data that looks identical to what's already cached). */
  it('no longer shows the Playlist Settings preview once the new Default Playlist has been saved', async () => {
    let savedLandscape = landscape
    const newPlaylists: { id: string; name: string; autoCreatedFor: string; playlistSettings: Record<string, unknown>; assignments: never[] }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      const path = url.split('?')[0]
      if (opts?.method === 'PUT' && path === '/api/admin/v1/display-types/landscape/record') {
        const body = JSON.parse(String(opts.body))
        if (body.defaultPlaylistId && !newPlaylists.some((p) => p.id === body.defaultPlaylistId) && body.defaultPlaylistId !== 'pl_landscape') {
          newPlaylists.push({ id: body.defaultPlaylistId, name: 'Landscape Playlist 2', autoCreatedFor: 'landscape', playlistSettings: body.playlistSettings ?? {}, assignments: [] })
        }
        savedLandscape = body
        return new Response(JSON.stringify(body), { status: 200 })
      }
      if (path === '/api/admin/v1/display-types') return new Response(JSON.stringify({ items: [savedLandscape, menuBoard] }), { status: 200 })
      if (path === '/api/admin/v1/playlists') {
        const base = (responses['/api/admin/v1/playlists'] as { items: unknown[] }).items
        return new Response(JSON.stringify({ items: [...base, ...newPlaylists] }), { status: 200 })
      }
      return new Response(JSON.stringify(responses[path] ?? {}), { status: 200 })
    }))

    renderAt('/display-types?id=landscape', true)
    await screen.findByText('Display Preview')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Default Playlist' }))
    fireEvent.click(await screen.findByText('Add new playlist'))
    expect(await screen.findByText(/Playlist Settings —/)).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByText(/Playlist Settings —/)).not.toBeInTheDocument())
  })
})
