import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

describe('Playlist Management API (spec §2)', () => {
  it('renames a playlist', async () => {
    const app = buildApp(testContext())
    const res = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_seasonal/record', payload: { name: '  Summer Overflow ' } })
    expect(res.statusCode).toBe(200)
    expectMatchesContract('PUT', '/admin/v1/playlists/{playlistId}/record', 200, res.json())
    expect(res.json()).toEqual({ id: 'pl_seasonal', name: 'Summer Overflow', autoCreatedFor: null, assignments: [] })
  })

  it('rejects an empty name and assignment changes (rename only)', async () => {
    const app = buildApp(testContext())
    const empty = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_seasonal/record', payload: { name: ' ' } })
    expect(empty.statusCode).toBe(400)
    expectMatchesContract('PUT', '/admin/v1/playlists/{playlistId}/record', 400, empty.json())
    const assign = await app.inject({ method: 'PUT', url: '/api/admin/v1/playlists/pl_seasonal/record', payload: { name: 'x', assignments: [] } })
    expect(assign.statusCode).toBe(400)
  })

  it('blocks deleting a default or zone playlist, listing where it is assigned', async () => {
    const app = buildApp(testContext())
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
    const ctx = testContext()
    const app = buildApp(ctx)
    expect((await app.inject({ method: 'GET', url: '/api/admin/v1/playlists/pl_archive/delete-check' })).json()).toEqual({ canDelete: true, dependents: [] })
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/v1/playlists/pl_archive' })
    expect(del.statusCode).toBe(204)
    expect(ctx.playlists.get('pl_archive')).toBeNull()
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/v1/playlists/pl_archive' })).statusCode).toBe(404)
  })
})
