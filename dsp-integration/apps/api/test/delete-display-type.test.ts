import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { testContext } from './helpers'

describe('delete a display type (spec §1)', () => {
  it('is blocked while displays are assigned, listing each display with its store', async () => {
    const app = buildApp(await testContext())
    const check = await app.inject({ method: 'GET', url: '/api/admin/v1/display-types/menu_board/delete-check' })
    expectMatchesContract('GET', '/admin/v1/display-types/{displayTypeId}/delete-check', 200, check.json())
    expect(check.json()).toEqual({
      canDelete: false,
      dependents: [
        { kind: 'display', name: 'Menu Board', detail: 'Sydney CBD' },
        { kind: 'display', name: 'Menu Board', detail: 'Chatswood' },
        { kind: 'display', name: 'Menu Board', detail: 'Bondi Junction' },
      ],
    })
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/v1/display-types/menu_board' })
    expect(del.statusCode).toBe(409)
    expectMatchesContract('DELETE', '/admin/v1/display-types/{displayTypeId}', 409, del.json())
    expect(del.json().error.code).toBe('has_dependents')
    expect(del.json().error.details.map((d: { reason: string }) => d.reason)).toEqual(['Menu Board · Sydney CBD', 'Menu Board · Chatswood', 'Menu Board · Bondi Junction'])
  })

  it('deletes a display type with no displays, keeping its auto-created playlist', async () => {
    const ctx = await testContext()
    const app = buildApp(ctx)
    ctx.db.prepare("DELETE FROM displays WHERE display_type_id = 'portrait'").run()
    const check = await app.inject({ method: 'GET', url: '/api/admin/v1/display-types/portrait/delete-check' })
    expect(check.json()).toEqual({ canDelete: true, dependents: [] })
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/v1/display-types/portrait' })
    expect(del.statusCode).toBe(204)
    expectMatchesContract('DELETE', '/admin/v1/display-types/{displayTypeId}', 204, undefined)
    expect(ctx.displayTypes.get('portrait')).toBeNull()
    expect(ctx.playlists.get('pl_portrait')).toMatchObject({ name: 'Portrait Playlist' })
  })

  it('404s for an unknown display type', async () => {
    const app = buildApp(await testContext())
    for (const [method, url] of [['GET', '/api/admin/v1/display-types/nope/delete-check'], ['DELETE', '/api/admin/v1/display-types/nope']] as const) {
      const res = await app.inject({ method, url })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('not_found')
    }
  })
})
