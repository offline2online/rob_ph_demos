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

    /* Playlist Settings editing (and slot assignment) moved to Playlist
       Management, under each playlist, 26 Sep 2026 (see
       playlist-management.test.tsx for its own coverage) — but a read-only
       preview of it stays here too, always last (ticket, 27 Sep 2026). */
    const panels = ['Phantom Zone', 'Enabled Features', 'Multi-Zone Layout', 'Playlist Settings'].map((t) => screen.getByRole('region', { name: t }))
    panels.forEach((p) => expect(within(p).getByRole('button', { expanded: false })).toBeInTheDocument())

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

  /* Ticket, 27 Sep 2026: Playlist Settings is a collapsible panel like
     Phantom Zone / Enabled Features / Multi-Zone Layout, always last, with
     a single "Default settings" tab — editable while the Default Playlist
     is still a local draft (a brand-new display type's, or an existing
     one's just swapped via "Add new playlist"), defaulting Auto-Rotation/
     Auto-Play off rather than the "On" platform default a new, unconfigured
     playlist used to silently inherit; read-only, with a comment and a
     Playlist Management CTA, once the playlist is real. */
  it('Playlist Settings: read-only with a Playlist Management comment for a real playlist, editable while still a local draft', async () => {
    renderAt('/display-types?id=landscape', true)
    await screen.findByText('Display Preview')

    const panel = () => screen.getByRole('region', { name: 'Playlist Settings' })
    const header = () => within(panel()).getByRole('button', { expanded: false })
    expect(header()).toBeInTheDocument()
    /* Collapsed, the header carries the same summary pill as the other
       panels, and the Playlist Management CTA stays inside the panel rather
       than on its header (failed-testing feedback, 27 Sep 2026). */
    expect(within(header()).getByText('Default settings')).toHaveAttribute('data-tone', 'default')
    expect(within(panel()).queryByRole('button', { name: 'Playlist Management' })).not.toBeInTheDocument()
    fireEvent.click(header())

    expect(within(panel()).getByText('Settings managed within Playlist Management.')).toBeInTheDocument()
    expect(within(panel()).getByRole('tab', { name: 'Default settings' })).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Playlist Management' })).toBeInTheDocument()
    expect(within(panel()).getByRole('combobox', { name: 'Campaign Auto-Rotation' }).closest('.ant-select')).toHaveClass('ant-select-disabled')

    fireEvent.click(within(panel()).getByRole('button', { expanded: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Add new playlist' }))

    fireEvent.click(within(panel()).getByRole('button', { expanded: false }))
    expect(within(panel()).getByText(/This new playlist will be created with these settings/)).toBeInTheDocument()
    const autoRotation = within(panel()).getByRole('combobox', { name: 'Campaign Auto-Rotation' })
    const autoPlay = within(panel()).getByRole('combobox', { name: 'Campaign Auto-Play' })
    expect(autoRotation.closest('.ant-select')).toHaveTextContent('Auto-Rotate Off')
    expect(autoRotation.closest('.ant-select')).not.toHaveClass('ant-select-disabled')
    expect(autoPlay.closest('.ant-select')).toHaveTextContent('Auto-Play Off')
    expect(autoPlay.closest('.ant-select')).not.toHaveClass('ant-select-disabled')

    /* The Playlist Management CTA stays available throughout. Leaving with
       this unsaved (the new playlist only exists as a local draft) goes
       through the usual discard-changes guard. */
    fireEvent.click(within(panel()).getByRole('button', { name: 'Playlist Management' }))
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }))
    expect(await screen.findByRole('button', { name: 'Show settings for Landscape Playlist' })).toBeInTheDocument()
  }, 30000)

  /* Ticket, 27 Sep 2026: "Add new playlist" is a button above the Default
     Playlist dropdown, top right, not the dropdown's last option. */
  it('adds a new playlist from a button above the Default Playlist dropdown, not from inside it', async () => {
    renderAt('/display-types?id=landscape', true)
    await screen.findByText('Display Preview')
    const add = screen.getByRole('button', { name: 'Add new playlist' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Default Playlist' }))
    await waitFor(() => expect(screen.getAllByTitle(/^Landscape Playlist/).length).toBeGreaterThan(1))
    expect(screen.getAllByText('Add new playlist')).toHaveLength(1)
    fireEvent.click(add)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled())
  })

  /* The real backend (ensureReferencedPlaylists) auto-creates the referenced
     playlist and persists the display type's new defaultPlaylistId, so a
     refetch after Save genuinely differs from before — this stateful mock
     reproduces that (a static mock wouldn't: react-query's structural
     sharing keeps the old, unsaved-draft-shaped reference around when a
     refetch returns data that looks identical to what's already cached). */
  it('Playlist Settings switches from editable to a read-only Playlist Management preview once the new Default Playlist has been saved', async () => {
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
    const panel = () => screen.getByRole('region', { name: 'Playlist Settings' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add new playlist' }))
    fireEvent.click(within(panel()).getByRole('button', { expanded: false }))
    expect(within(panel()).getByText(/This new playlist will be created with these settings/)).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(within(panel()).getByText('Settings managed within Playlist Management.')).toBeInTheDocument())
  })
})
