import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Providers } from '../src/App'
import { DeleteDialog } from '../src/shared/DeleteDialog'
import { InfoTip } from '../src/shared/InfoTip'
import { ListPageLayout } from '../src/shared/ListPageLayout'
import { SaveBar } from '../src/shared/SaveBar'
import { UnsavedChangesProvider, useReportDirty } from '../src/shared/UnsavedChanges'
import { useDraft } from '../src/shared/useDraft'

describe('SaveBar', () => {
  it('is disabled with "No changes to save." until something changed', () => {
    const { rerender } = render(<SaveBar dirty={false} onSave={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('No changes to save.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    rerender(<SaveBar dirty onSave={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('is sticky to the bottom of the content column, never fixed', () => {
    render(<SaveBar dirty={false} onSave={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('region', { name: 'Save changes' }).className).toMatch(/\bsticky\b/)
    expect(screen.getByRole('region', { name: 'Save changes' }).className).not.toMatch(/\bfixed\b/)
  })
})

describe('useDraft', () => {
  it('is dirty only when the draft differs from the saved value, and reset restores it', () => {
    const { result } = renderHook(({ saved }) => useDraft(saved), { initialProps: { saved: { a: 1, b: [1, 2] } } })
    expect(result.current.dirty).toBe(false)
    act(() => result.current.setDraft({ a: 2, b: [1, 2] }))
    expect(result.current.dirty).toBe(true)
    act(() => result.current.setDraft({ b: [1, 2], a: 1 }))
    expect(result.current.dirty).toBe(false)
    act(() => result.current.setDraft({ a: 3, b: [] }))
    act(() => result.current.reset())
    expect(result.current.draft).toEqual({ a: 1, b: [1, 2] })
  })

  it('keeps unsaved edits when the server value refreshes, and takes the new value otherwise', () => {
    const { result, rerender } = renderHook(({ saved }) => useDraft(saved), { initialProps: { saved: { v: 1 } } })
    rerender({ saved: { v: 2 } })
    expect(result.current.draft).toEqual({ v: 2 })
    act(() => result.current.setDraft({ v: 9 }))
    rerender({ saved: { v: 3 } })
    expect(result.current.draft).toEqual({ v: 9 })
  })
})

describe('DeleteDialog', () => {
  it('allows Cancel and Delete when nothing depends on the item', () => {
    const onDelete = vi.fn()
    render(<Providers><DeleteDialog open name="Seasonal Overflow" onDelete={onDelete} onClose={() => {}}>This can't be undone.</DeleteDialog></Providers>)
    expect(screen.getByText('Delete Seasonal Overflow?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('disables Delete and offers only Close when something depends on it', () => {
    render(<Providers><DeleteDialog open name="Landscape" blockedReason="Displays are assigned to this display type" onDelete={() => {}} onClose={() => {}}>2 displays</DeleteDialog></Providers>)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})

describe('InfoTip', () => {
  it('shows its text on keyboard focus', async () => {
    render(<Providers><InfoTip text="Each zone runs its own playlist, so each has its own rotation." /></Providers>)
    fireEvent.focus(screen.getByRole('button', { name: /Each zone runs/ }))
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Each zone runs its own playlist'))
  })
})

describe('ListPageLayout', () => {
  it('has a 260px sticky list column and a full-width content column', () => {
    const { container } = render(<ListPageLayout list={<div>list</div>}><div>content</div></ListPageLayout>)
    const [list, content] = Array.from(container.firstElementChild!.children) as HTMLElement[]
    expect(list.className).toMatch(/w-\[260px\]/)
    expect(list.className).toMatch(/sticky/)
    expect(content.className).toMatch(/flex-1/)
  })
})

describe('unsaved-changes guard', () => {
  function Page() {
    const [dirty, setDirty] = useState(false)
    useReportDirty(dirty)
    return (
      <>
        <button onClick={() => setDirty(true)}>edit</button>
        <Link to="/other">leave</Link>
      </>
    )
  }
  const setup = () => {
    const router = createMemoryRouter(
      [{ path: '/', element: <UnsavedChangesProvider><Page /></UnsavedChangesProvider> }, { path: '/other', element: <div>other page</div> }],
      { initialEntries: ['/'] },
    )
    render(<Providers><RouterProvider router={router} /></Providers>)
    return router
  }

  it('leaves freely when nothing is unsaved', async () => {
    setup()
    fireEvent.click(screen.getByText('leave'))
    expect(await screen.findByText('other page')).toBeInTheDocument()
  })

  it('asks before leaving with unsaved changes, and stays on Cancel', async () => {
    const router = setup()
    fireEvent.click(screen.getByText('edit'))
    fireEvent.click(screen.getByText('leave'))
    expect((await screen.findAllByText('You have unsaved changes. Discard them?'))[0]).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('leaves after confirming the discard', async () => {
    setup()
    fireEvent.click(screen.getByText('edit'))
    fireEvent.click(screen.getByText('leave'))
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }))
    expect(await screen.findByText('other page')).toBeInTheDocument()
  })
})
