import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

describe('Playlist Management API (spec §2)', () => {
  it('renames a playlist', async () => {
    const app = buildApp(await testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_seasonal/record', payload: { name: '  Summer Overflow ' } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/playlists/{playlistId}/record', 200, res.json())
    expect(res.json()).toEqual({ id: 'pl_seasonal', name: 'Summer Overflow', autoCreatedFor: null, playlistSettings: {}, assignments: [] })
  })

  it('rejects an empty name and assignment changes (rename only)', async () => {
    const app = buildApp(await testContext())
    const empty = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_seasonal/record', payload: { name: ' ' } })
    expect(empty.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/playlists/{playlistId}/record', 400, empty.json())
    const assign = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_seasonal/record', payload: { name: 'x', assignments: [] } })
    expect(assign.statusCode).toBe(400)
  })

  it('blocks deleting a default or zone playlist, listing where it is assigned', async () => {
    const app = buildApp(await testContext())
    const def = await app.inject({ method: 'GET', url: '/api/admin/v1/playlists/pl_menu/delete-check' })
    expectMatchesContract('GET', '/admin/v1/playlists/{playlistId}/delete-check', 200, def.json())
    expect(def.json()).toEqual({ canDelete: false, dependents: [{ kind: 'display_type_default', name: 'Menu Board — Long Format', detail: 'Default playlist' }] })
    const zone = await app.inject({ method: 'GET', url: '/api/admin/v1/playlists/pl_zone_menu_board_3/delete-check' })
    expect(zone.json().dependents).toEqual([{ kind: 'zone', name: 'Menu Board — Long Format', detail: 'Zone 3' }])
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/v1/playlists/pl_zone_menu_board_3' })
    expect(del.statusCode).toBe(409)
    expectMatchesContract('DELETE', '/admin/v1/playlists/{playlistId}', 409, del.json())
    expect(del.json().error.details).toEqual([{ field: 'zone', reason: 'Menu Board — Long Format · Zone 3' }])
  })

  it('deletes an unused playlist', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/playlists/pl_archive/delete-check' })).json()).toEqual({ canDelete: true, dependents: [] })
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/v1/playlists/pl_archive' })
    expect(del.statusCode).toBe(204)
    expect(ctx.playlists.get('pl_archive')).toBeNull()
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/playlists/pl_archive' })).statusCode).toBe(404)
  })

  /* Playlist settings (26 Sep 2026): a playlist's own Asset Position/Fill,
     Campaign Transition, Auto-Rotation and Auto-Play, editable whether or
     not it is currently assigned to a display type — unlike Maximum
     Campaigns Played In Rotation and slot assignment, which stay on the
     display type and are refused here. */
  describe('playlist settings', () => {
    it('saves settings on an unassigned playlist', async () => {
      const app = buildApp(await testContext())
      const res = await app.inject({
        method: 'PUT', url: '/api/admin/v1/playlists/pl_archive/settings',
        payload: { assetPosition: 'Center', assetFill: null, campaignTransition: 'Fade', campaignAutoRotation: null, campaignAutoPlay: 'Auto-Play Off' },
      })
      expect(res.statusCode).toBe(200)
      expectMatchesContract('PUT', '/admin/v1/playlists/{playlistId}/settings', 200, res.json())
      expect(res.json()).toEqual({
        id: 'pl_archive', name: 'Archived Q1 Campaigns', autoCreatedFor: null, assignments: [],
        playlistSettings: { assetPosition: 'Center', assetFill: null, campaignTransition: 'Fade', campaignAutoRotation: null, campaignAutoPlay: 'Auto-Play Off' },
      })
    })

    it('saves settings on an assigned playlist independently of its display type', async () => {
      const app = buildApp(await testContext())
      const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_menu/settings', payload: { assetPosition: 'Top-Right' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().playlistSettings).toEqual({ assetPosition: 'Top-Right' })
      expect(res.json().assignments).toEqual([{ displayTypeId: 'menu_board', displayTypeName: 'Menu Board — Long Format', zoneId: null, zoneName: null }])
    })

    it('rejects Maximum Campaigns Played In Rotation and unknown fields', async () => {
      const app = buildApp(await testContext())
      const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_archive/settings', payload: { maximumCampaignsPlayedInRotation: 4, bogus: 1 } })
      expect(res.statusCode).toBe(400)
      expectMatchesContract('PUT', '/admin/v1/playlists/{playlistId}/settings', 400, res.json())
      expect(res.json().error.details).toEqual([
        { field: 'maximumCampaignsPlayedInRotation', reason: "Not accepted here: edited per assignment, on the display type’s own /extensions endpoint." },
        { field: 'bogus', reason: 'Not accepted: one of assetPosition, assetFill, campaignTransition, campaignAutoRotation, campaignAutoPlay.' },
      ])
    })

    /* Ticket QclCnAKYGdXuyCvCIPcs (28 Sep 2026): "not found" on saving
       playlist settings — the hosted API was two days behind the client and
       had no /settings route yet. Every value the admin offers for each of
       the five settings (display-types/model.ts), saved one at a time on an
       unassigned and an assigned playlist, and read back from the list. */
    const EVERY_OPTION: Record<string, string[]> = {
      assetPosition: ['Top-Left', 'Top-Right', 'Center', 'Bottom-Left', 'Bottom-Right'],
      assetFill: ['Fit to Display', 'Maintain Asset Property', 'Fill', 'Stretch'],
      campaignAutoRotation: ['Auto-Rotate On', 'Auto-Rotate Off'],
      campaignAutoPlay: ['Auto-Play On', 'Auto-Play Off'],
      campaignTransition: ['None', 'Fade', 'Slide'],
    }
    for (const playlistId of ['pl_archive', 'pl_menu']) {
      it(`saves every option of all five settings on ${playlistId}`, async () => {
        const app = buildApp(await testContext())
        for (const [field, values] of Object.entries(EVERY_OPTION)) {
          for (const value of values) {
            const res = await app.inject({ method: 'PUT', url: `/api/admin/v1/playlists/${playlistId}/settings`, payload: { [field]: value } })
            expect(res.statusCode, `${field} = ${value}`).toBe(200)
            expect(res.json().playlistSettings[field]).toBe(value)
          }
        }
        const all = Object.fromEntries(Object.entries(EVERY_OPTION).map(([f, v]) => [f, v[0]]))
        expect((await app.inject({ method: 'PUT', url: `/api/admin/v1/playlists/${playlistId}/settings`, payload: all })).statusCode).toBe(200)
        const list = await app.inject({ method: 'GET', url: '/api/admin/v1/playlists' })
        const saved = (list.json().items ?? list.json()).find((p: { id: string }) => p.id === playlistId)
        expect(saved.playlistSettings).toMatchObject(all)
      })
    }

    it('404s for an unknown playlist', async () => {
      const app = buildApp(await testContext())
      const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_nope/settings', payload: {} })
      expect(res.statusCode).toBe(404)
    })
  })
})
