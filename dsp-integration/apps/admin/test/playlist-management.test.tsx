import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'
import { newDisplayType } from '../src/features/display-types/model'

const menuBoard = {
  ...newDisplayType('menu_board'),
  name: 'Menu Board — Long Format',
  defaultPlaylistId: 'pl_menu',
  playlistSettings: { maximumCampaignsPlayedInRotation: 3 },
  phExtensions: { slots: [
    { label: 'Priority 1', owner: 'internal' }, { label: 'Supplier slot', owner: 'advertiser', listMode: 'rtb' }, { label: 'Store choice', owner: 'retail', storeScope: 'Store staff' },
  ] },
}
const landscape = { ...newDisplayType('landscape'), name: 'Landscape', defaultPlaylistId: 'pl_landscape' }

const playlists = { items: [
  { id: 'pl_landscape', name: 'Landscape Playlist', autoCreatedFor: 'landscape', playlistSettings: {}, assignments: [{ displayTypeId: 'landscape', displayTypeName: 'Landscape', zoneId: null, zoneName: null }] },
  { id: 'pl_menu', name: 'Menu Board Playlist', autoCreatedFor: 'menu_board', playlistSettings: {}, assignments: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', zoneId: null, zoneName: null }] },
  { id: 'pl_seasonal', name: 'Seasonal Overflow', autoCreatedFor: null, playlistSettings: {}, assignments: [] },
  { id: 'pl_shared', name: 'Shared Rotation', autoCreatedFor: null, playlistSettings: { assetPosition: 'Center' }, assignments: [
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

/* The options of the dropdown this Select has just opened — never another,
   still-closing one's (every Select shares one id under test, so its
   aria-controls can't tell them apart). Each Select here is opened once. */
const optionsOf = async (name: string) => {
  const box = await screen.findByLabelText(name, { selector: 'input' })
  const before = new Set(document.querySelectorAll('.ant-select-dropdown'))
  fireEvent.mouseDown(box)
  return waitFor(() => {
    const dropdown = [...document.querySelectorAll('.ant-select-dropdown')].find((d) => !before.has(d))
    const found = Array.from(dropdown?.querySelectorAll('.ant-select-item-option') ?? []) as HTMLElement[]
    expect(found.length).toBeGreaterThan(0)
    return found
  })
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
    /* Its own leftmost, bigger arrow (26 Sep 2026 fix) — not the small one
       nested inside the Settings text column. */
    const arrow = within(toggle).getByText('chevron_right')
    expect(arrow).toHaveStyle({ fontSize: '24px' })
    fireEvent.click(toggle)
    expect(await screen.findByText('Asset Position')).toBeInTheDocument()
    expect(screen.getByText('Campaign Auto-Play')).toBeInTheDocument()
    /* One assignment: the cap field shows, with no per-display-type heading. */
    expect(screen.getByText('Maximum Campaigns Played In Rotation')).toBeInTheDocument()
    expect(screen.queryByText('Menu Board — Long Format')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide settings for Menu Board Playlist' }))
    await waitFor(() => expect(screen.queryByText('Asset Position')).not.toBeInTheDocument())
  })

  /* The failed-testing feedback this fixes (26 Sep 2026): the settings arrow
     must show for a playlist with no assignments too, since a playlist's own
     settings can — and should — be set up before it's ever assigned to a
     display. Only Maximum Campaigns Played In Rotation and slot assignment,
     which are meaningless without a display type to sell positions on, stay
     out of an unassigned playlist's expanded row. */
  it('shows the settings arrow, and lets its own settings be edited, for a playlist with no assignments', async () => {
    renderAt('/playlists', true)
    const toggle = await screen.findByRole('button', { name: 'Show settings for Seasonal Overflow' })
    expect(screen.getByText('unused')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(await screen.findByText('Asset Position')).toBeInTheDocument()
    expect(screen.getByText('Campaign Auto-Play')).toBeInTheDocument()
    /* No display type assigned: no cap/slot-assignment section at all. */
    expect(screen.queryByText('Maximum Campaigns Played In Rotation')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /Slot 1 owner/ })).not.toBeInTheDocument()

    /* Editing and saving works the same as an assigned playlist's settings. */
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Asset Position' }))
    fireEvent.click(await screen.findByTitle('Center'))
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u, o]) => String(u).includes('/playlists/pl_seasonal/settings') && (o as RequestInit)?.method === 'PUT')).toBe(true))
  })

  it('shows one cap/slot-assignment block per assignment, labelled, for a playlist used by more than one display type — but one shared settings block', async () => {
    renderAt('/playlists', true)
    const toggle = await screen.findByRole('button', { name: 'Show settings for Shared Rotation' })
    fireEvent.click(toggle)
    /* One playlist-level settings block, not one per assignment. */
    expect(await screen.findAllByText('Asset Position')).toHaveLength(1)
    expect(await screen.findAllByText('Maximum Campaigns Played In Rotation')).toHaveLength(2)
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
    fireEvent.click(toggle)
    expect(await screen.findByText('Maximum Campaigns Played In Rotation')).toBeInTheDocument()
    expect(screen.queryByText('Slot assignment')).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => /partners|advertiser/.test(u))).toBe(false)
  })

  /* Ticket, 27 Sep 2026: each playlist name is led by its touch point's icon. */
  it('leads each playlist name with the touch point icon of the display types it fills', async () => {
    const kioskMenu = { ...menuBoard, touchPoint: 'Kiosk' }
    const withKiosk: Record<string, unknown> = { ...responses, '/api/admin/v1/display-types': { items: [landscape, kioskMenu] } }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(withKiosk[url.split('?')[0]] ?? {}), { status: 200 })))
    renderAt('/playlists')
    const grid = await screen.findByLabelText('Playlists')
    const row = async (name: string) => (await within(grid).findByText(name)).closest('.ag-row') as HTMLElement
    const icons = async (name: string) => within(await row(name)).queryAllByRole('img').map((i) => i.getAttribute('aria-label'))
    await waitFor(async () => expect(await icons('Landscape Playlist')).toEqual(['Digital Signage touch point']))
    expect(await icons('Menu Board Playlist')).toEqual(['Kiosk touch point'])
    expect(await icons('Shared Rotation')).toEqual(['Digital Signage touch point', 'Kiosk touch point'])
    /* Not on any screen yet: nothing to show. */
    expect(await icons('Seasonal Overflow')).toEqual([])
  })

  /* Ticket, 27 Sep 2026: the first release supports Headquarters and
     Advertiser slots only — Stores is no longer offered. */
  it('offers Headquarters and Advertiser as slot owners, and no longer Stores', async () => {
    renderAt('/playlists?displayTypeId=menu_board', true)
    const ownerOptions = async (slot: number) => {
      const out = (await optionsOf(`Slot ${slot} owner`)).map((o) => ({ label: o.textContent, disabled: o.classList.contains('ant-select-item-option-disabled') }))
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
      return out
    }
    expect(await ownerOptions(1)).toEqual([{ label: 'Headquarters', disabled: false }, { label: 'Advertiser', disabled: false }])
    /* A slot saved as Stores before still reads as Stores, but can't be picked again. */
    expect(await ownerOptions(3)).toEqual([
      { label: 'Headquarters', disabled: false }, { label: 'Advertiser', disabled: false }, { label: 'Stores', disabled: true },
    ])
  })

  /* Ticket, 27 Sep 2026: three zones each given an Advertiser slot showed
     one Available Inventory position, because every zone's table edits the
     display type's one set of slots — setting Slot 1 under each zone just
     re-tagged the same slot. A slot made Advertiser under a zone's playlist
     is now tagged to that zone, and locked under every other zone. */
  it('gives each zone its own Advertiser slot, and never lets one zone take another zone’s slot', async () => {
    const zoned = {
      ...menuBoard,
      multiZone: { enabled: true, zones: [
        { id: 'z1', name: 'Zone 1', x: 0, y: 0, width: 33.3, height: 100, playlistId: 'pl_z1' },
        { id: 'z2', name: 'Zone 2', x: 33.3, y: 0, width: 33.4, height: 100, playlistId: 'pl_z2' },
        { id: 'z3', name: 'Zone 3', x: 66.7, y: 0, width: 33.3, height: 100, playlistId: 'pl_z3' },
      ] },
      phExtensions: { slots: [{ label: 'Slot 1', owner: 'internal' }, { label: 'Slot 2', owner: 'internal' }, { label: 'Slot 3', owner: 'internal' }] },
    }
    const zonePlaylist = (n: number) => ({ id: `pl_z${n}`, name: `Menu Board / Zone ${n}`, autoCreatedFor: 'menu_board', playlistSettings: {}, assignments: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', zoneId: `z${n}`, zoneName: `Zone ${n}` }] })
    const zonedResponses: Record<string, unknown> = {
      ...responses,
      '/api/admin/v1/display-types': { items: [landscape, zoned] },
      '/api/admin/v1/playlists': { items: [...playlists.items.filter((p) => p.id !== 'pl_shared'), zonePlaylist(1), zonePlaylist(2), zonePlaylist(3)] },
    }
    const puts: { url: string; body: { slots: { owner: string; zoneId?: string | null }[] } }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') puts.push({ url, body: JSON.parse(String(opts.body)) })
      return new Response(JSON.stringify(zonedResponses[url.split('?')[0]] ?? {}), { status: 200 })
    }))
    renderAt('/playlists', true)

    const makeAdvertiser = async (slot: number) => {
      fireEvent.click((await optionsOf(`Slot ${slot} owner`)).find((o) => o.textContent === 'Advertiser')!)
      await waitFor(() => expect(within(screen.getByTestId(`slot-card-${slot}`)).getByText('Advertiser')).toBeInTheDocument())
    }
    const openZone = async (n: number) => {
      fireEvent.click(await screen.findByLabelText(`Show settings for Menu Board / Zone ${n}`))
      await screen.findByLabelText('Slot 1 owner', { selector: 'input' })
    }

    await openZone(1)
    await makeAdvertiser(1)
    expect(within(screen.getByTestId('slot-card-1')).getByText('Zone 1')).toBeInTheDocument()

    await openZone(2)
    /* Zone 1's slot is shown, but can't be changed from here. */
    await waitFor(() => expect(screen.getByLabelText('Slot 1 owner', { selector: 'input' }).closest('.ant-select')).toHaveClass('ant-select-disabled'))
    await makeAdvertiser(2)
    expect(within(screen.getByTestId('slot-card-2')).getByText('Zone 2')).toBeInTheDocument()

    await openZone(3)
    await makeAdvertiser(3)

    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(puts.some((p) => p.url.endsWith('/display-types/menu_board/extensions'))).toBe(true))
    const saved = puts.find((p) => p.url.endsWith('/display-types/menu_board/extensions'))!.body.slots
    /* Three advertiser positions, one per zone — three rows on Available Inventory. */
    expect(saved.map((s) => [s.owner, s.zoneId])).toEqual([['advertiser', 'z1'], ['advertiser', 'z2'], ['advertiser', 'z3']])
  }, 120000)

  /* Available Inventory's "Open" action (Rob, 20 Sep; moved here 26 Sep
     2026 when Playlist Settings, where slot assignment lives, moved off the
     display type): lands on that display type's default playlist, expanded. */
  it('opens straight into a display type’s settings from a ?displayTypeId= deep link', async () => {
    renderAt('/playlists?displayTypeId=menu_board', true)
    expect(await screen.findByText('Asset Position')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide settings for Menu Board Playlist' })).toBeInTheDocument()
  })
})
