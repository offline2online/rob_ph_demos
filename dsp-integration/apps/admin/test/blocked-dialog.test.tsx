import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Providers } from '../src/App'
import { ApiRequestError } from '../src/api/client'
import { BlockedDialog, describeBlock } from '../src/shared/BlockedDialog'

const refusal = (message: string, details: { field: string; reason: string }[]) =>
  new ApiRequestError(409, { error: { code: 'has_dependents', message, details } } as never)

describe('Hard-block dialog (ticket z0qiB0GGHR010H0Shrj0)', () => {
  it('turns a refused slot-owner change into a reason, the booked windows and next steps', () => {
    const b = describeBlock(refusal("An Advertiser slot can't be changed to another owner while it is reserved or sold for a current or future window.", [{ field: 'reservation', reason: 'fridge-led-milk.s2 · window 2026-10-24 · sold' }]), 'save', 'Fridge LED Milk')
    expect(b).not.toBeNull()
    render(<Providers><BlockedDialog blocked={b!} onClose={() => {}} /></Providers>)
    expect(screen.getByText("This slot's owner can't be changed")).toBeInTheDocument()
    expect(screen.getByText(/Your changes were not saved/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'What is holding this' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['event_busyfridge-led-milk.s2 · window 2026-10-24 · sold'])
    expect(within(screen.getByRole('list', { name: 'What you can do' })).getAllByRole('listitem').length).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('says nothing was lost for a delete, and names the replacement step for a playlist', () => {
    const b = describeBlock(refusal("This playlist can't be deleted while it is assigned to a display type or zone.", [{ field: 'zone', reason: 'Portrait · Zone A' }]), 'delete', 'This playlist')!
    expect(b.unsaved).toBe(false)
    expect(b.title).toBe("This playlist can't be deleted")
    expect(b.next[0]).toMatch(/Assign another playlist/)
  })

  it('leaves other errors to the toast, and still dialogs an unrecognised block with the API text', () => {
    expect(describeBlock(new ApiRequestError(500, null), 'save')).toBeNull()
    expect(describeBlock(new Error('x'), 'save')).toBeNull()
    expect(describeBlock(refusal('Something else is holding this.', []), 'archive', 'This deal')).toMatchObject({ title: "This deal can't be archived", reason: 'Something else is holding this.' })
  })

  /* E2E 22 Oct 2026: the audience refusal fell into the slot-advertiser case; a partial save said nothing was saved; the steps had no bullets. */
  it('names an audience a live deal targets, says what did save on a partial save, and bullets the steps', () => {
    const b = describeBlock(refusal("Red Bull can't lose Energy fans: Energy fans is targeted by the live deal Red Bull direct.", []), 'save', 'This advertiser')!
    expect(b.title).toBe("This audience can't be removed")
    expect(b.reason).toMatch(/^Energy fans is targeted by the live deal Red Bull direct\./)
    expect(b.next[0]).toMatch(/remove the segment from its targeting/)
    render(<Providers><BlockedDialog blocked={{ ...b, partial: true }} onClose={() => {}} /></Providers>)
    expect(screen.getByText(/Your other changes were saved; this one was not\./)).toBeInTheDocument()
    expect(screen.queryByText(/^Your changes were not saved/)).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'What you can do' })).toHaveClass('list-disc')
  })
})
