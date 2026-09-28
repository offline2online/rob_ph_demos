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

  /* Ticket, 28 Sep 2026 ("the three zones are still being seen as a single
     inventory slot"): each zone's playlist has its own Maximum Campaigns
     Played In Rotation and its own slots — two Advertiser slots a zone is
     six positions — with no Zone column to pick per slot (Rob: "there's a
     separate playlist for every zone"). The display type's default
     playlist lays out the zones and has no rotation of its own. */
  it('gives each zone’s playlist its own rotation cap and slots, with no zone picker, and none on the zoned default playlist', async () => {
    const zone = (n: number, cap: number | null, x: number) => ({ id: `z${n}`, name: `Zone ${n}`, x, y: 0, width: 33.3, height: 100, playlistId: `pl_z${n}`, maximumCampaignsPlayedInRotation: cap })
    const zoned = {
      ...menuBoard,
      multiZone: { enabled: true, zones: [zone(1, 2, 0), zone(2, null, 33.3), zone(3, 2, 66.7)] },
      phExtensions: { slots: [
        { label: 'Slot 1', owner: 'internal', zoneId: 'z1' }, { label: 'Slot 2', owner: 'internal', zoneId: 'z1' },
        { label: 'Slot 1', owner: 'internal', zoneId: 'z3' }, { label: 'Slot 2', owner: 'advertiser', zoneId: 'z3', listMode: 'rtb' },
      ] },
    }
    const zonePlaylist = (n: number) => ({ id: `pl_z${n}`, name: `Menu Board / Zone ${n}`, autoCreatedFor: 'menu_board', playlistSettings: {}, assignments: [{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', zoneId: `z${n}`, zoneName: `Zone ${n}` }] })
    const zonedResponses: Record<string, unknown> = {
      ...responses,
      '/api/admin/v1/display-types': { items: [landscape, zoned] },
      '/api/admin/v1/playlists': { items: [...playlists.items.filter((p) => p.id !== 'pl_shared'), zonePlaylist(1), zonePlaylist(2), zonePlaylist(3)] },
    }
    const puts: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') puts.push({ url, body: JSON.parse(String(opts.body)) })
      return new Response(JSON.stringify(zonedResponses[url.split('?')[0]] ?? {}), { status: 200 })
    }))
    renderAt('/playlists', true)

    const grid = await screen.findByLabelText('Playlists')
    const row = async (name: string) => (await within(grid).findByText(name)).closest('.ag-row') as HTMLElement
    /* The collapsed summary is each zone's own: Zone 3 has 1 Headquarters + 1 Advertiser, Zone 2 nothing yet. */
    await waitFor(async () => expect(within(await row('Menu Board / Zone 3')).getByText('2 slots')).toBeInTheDocument())
    expect(within(await row('Menu Board / Zone 3')).getByText('1 Advertiser')).toBeInTheDocument()
    expect(within(await row('Menu Board / Zone 2')).queryByText(/slots/)).not.toBeInTheDocument()

    const makeAdvertiser = async (slot: number) => {
      fireEvent.click((await optionsOf(`Slot ${slot} owner`)).find((o) => o.textContent === 'Advertiser')!)
      await waitFor(() => expect(within(screen.getByTestId(`slot-card-${slot}`)).getByText('Advertiser')).toBeInTheDocument())
    }
    const open = async (name: string) => fireEvent.click(await screen.findByLabelText(`Show settings for ${name}`))

    /* The zoned display type's own default playlist: no rotation cap, no slot table. */
    await open('Menu Board Playlist')
    expect(await screen.findByText(/This playlist lays out 3 zones/)).toBeInTheDocument()
    expect(screen.queryByText('Maximum Campaigns Played In Rotation')).not.toBeInTheDocument()

    /* Zone 1: its own two slots, no Zone column; both made Advertiser. */
    await open('Menu Board / Zone 1')
    await screen.findByLabelText('Slot 1 owner', { selector: 'input' })
    expect(screen.getAllByRole('combobox', { name: /Slot \d owner/ })).toHaveLength(2)
    expect(screen.queryByRole('combobox', { name: /Slot \d zone/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Not zone-specific')).not.toBeInTheDocument()
    await makeAdvertiser(1)
    await makeAdvertiser(2)

    /* Zone 2 at the default cap has no slots; give it a rotation of 2 and it gets its own two. */
    await open('Menu Board / Zone 2')
    await waitFor(() => expect(screen.getAllByText('Maximum Campaigns Played In Rotation')).toHaveLength(1))
    expect(screen.queryByRole('combobox', { name: /Slot \d owner/ })).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Maximum Campaigns Played In Rotation' }))
    fireEvent.click(await screen.findByTitle('2'))
    await screen.findByLabelText('Slot 2 owner', { selector: 'input' })
    await makeAdvertiser(1)
    await makeAdvertiser(2)

    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(puts.some((p) => p.url.endsWith('/display-types/menu_board/extensions'))).toBe(true))
    /* Zone 2's cap is saved on the zone itself, with the display type record. */
    const record = puts.find((p) => p.url.endsWith('/display-types/menu_board/record'))!.body as { multiZone: { zones: { id: string; maximumCampaignsPlayedInRotation: number | null }[] } }
    expect(record.multiZone.zones.map((z) => [z.id, z.maximumCampaignsPlayedInRotation])).toEqual([['z1', 2], ['z2', 2], ['z3', 2]])
    /* One segment per zone, in zone order: five Advertiser positions on Available Inventory, two a zone but Zone 3's one. */
    const saved = (puts.find((p) => p.url.endsWith('/display-types/menu_board/extensions'))!.body as { slots: { owner: string; zoneId: string | null }[] }).slots
    expect(saved.map((s) => [s.owner, s.zoneId])).toEqual([
      ['advertiser', 'z1'], ['advertiser', 'z1'], ['advertiser', 'z2'], ['advertiser', 'z2'], ['internal', 'z3'], ['advertiser', 'z3'],
    ])
  }, 120000)

  /* Ticket, 28 Sep 2026: editing a playlist name pushed the caret to the end
     of the field on every keystroke, so a word at the start of the name
     couldn't be changed. The draft name was page state, so each keystroke
     re-rendered the grid and the rename input with it. */
  it('keeps the same rename input, and the caret where it was, while a name is being edited', async () => {
    renderAt('/playlists')
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Seasonal Overflow' }))
    const input = await screen.findByLabelText('Playlist name')
    expect(input).toHaveValue('Seasonal Overflow')
    input.focus()
    ;(input as HTMLInputElement).setSelectionRange(0, 0)
    fireEvent.change(input, { target: { value: 'XSeasonal Overflow', selectionStart: 1, selectionEnd: 1 } })
    /* Still the very same element — never unmounted and re-created. */
    expect(screen.getByLabelText('Playlist name')).toBe(input)
    expect(input).toHaveValue('XSeasonal Overflow')
    expect(document.activeElement).toBe(input)
    expect((input as HTMLInputElement).selectionStart).toBe(1)

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u, o]) => String(u).includes('/playlists/pl_seasonal/record') && (o as RequestInit)?.method === 'PUT' && String((o as RequestInit).body).includes('XSeasonal Overflow'))).toBe(true))
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
