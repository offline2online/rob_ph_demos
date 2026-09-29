import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Providers } from '../src/App'
import { DeleteDisplayType } from '../src/features/display-types/DeleteDisplayType'

describe('Delete display type dialog', () => {
  it('lists the assigned displays with their store and disables Delete', () => {
    render(
      <Providers>
        <DeleteDisplayType name="Landscape" deleting={false} onDelete={() => {}} onClose={() => {}}
          check={{ canDelete: false, dependents: [{ kind: 'display', name: 'Entrance Screen', detail: 'Sydney CBD' }, { kind: 'display', name: 'Checkout Screen', detail: 'Sydney CBD' }] }} />
      </Providers>,
    )
    expect(screen.getByText('Delete Landscape?')).toBeInTheDocument()
    expect(screen.getByText(/2 displays are assigned to it/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'What depends on this display type' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['tvEntrance Screen· Sydney CBD', 'tvCheckout Screen· Sydney CBD'])
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('blocks while a future window is reserved or sold, listing each window (Q47)', () => {
    render(
      <Providers>
        <DeleteDisplayType name="Portrait" deleting={false} onDelete={() => {}} onClose={() => {}}
          check={{ canDelete: false, dependents: [{ kind: 'reservation', name: 'portrait.s1', detail: 'window 2026-09-22 · reserved' }] }} />
      </Providers>,
    )
    expect(screen.getByText(/1 play window is reserved or sold on its positions/)).toBeInTheDocument()
    expect(screen.queryByText(/displays? (is|are) assigned/)).toBeNull()
    expect(within(screen.getByRole('list', { name: 'What depends on this display type' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['event_busyportrait.s1· window 2026-09-22 · reserved'])
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('confirms a permanent delete when nothing is assigned', () => {
    render(<Providers><DeleteDisplayType name="Kiosk" deleting={false} onDelete={() => {}} onClose={() => {}} check={{ canDelete: true, dependents: [] }} /></Providers>)
    expect(screen.getByText(/This permanently deletes the display type and its settings/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
