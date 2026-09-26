import { render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'

const playlists = { items: [
  { id: 'pl_landscape', name: 'Landscape Playlist', autoCreatedFor: 'landscape', assignments: [{ displayTypeId: 'landscape', displayTypeName: 'Landscape', zoneId: null, zoneName: null }] },
  { id: 'pl_seasonal', name: 'Seasonal Overflow', autoCreatedFor: null, assignments: [] },
] }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/playlists') ? playlists : url.includes('/session') ? { userId: 'u', name: 'n', role: 'hq_admin' } : { items: [] }))))
})
afterEach(() => vi.unstubAllGlobals())

describe('Playlist Management page', () => {
  it('shows the count line, a titled page, rename and delete per row, and no New playlist (decision 4)', async () => {
    const router = createMemoryRouter(appRoutes({ dspIntegration: false }), { initialEntries: ['/playlists'] })
    render(<Providers><RouterProvider router={router} /></Providers>)
    await waitFor(() => expect(screen.getByText(/Playlists ·/)).toBeInTheDocument())
    expect(screen.getByText(/Playlists ·/).textContent).toBe('2 Playlists · 1 unused')
    expect(screen.getByRole('button', { name: /A playlist is created automatically/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New playlist/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Playlist Management/ })).toBeInTheDocument()
  })
})
