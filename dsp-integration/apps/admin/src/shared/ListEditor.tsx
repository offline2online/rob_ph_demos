/* Whitelist / blacklist editor (spec §6): removable pills, free text plus
   suggested names, count on the right. Nothing sits on both lists: the page
   removes an added name from the other list. Tag input — components.md §13. */
import { Button, Input, Tag } from 'antd'
import { useState } from 'react'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function ListEditor({ label, tone, icon, items, suggestions = [], onAdd, onRemove, empty, addLabel = 'Add an advertiser…', suggestLabel = 'Seats:' }: {
  label: string
  tone: string
  icon: string
  items: string[]
  suggestions?: string[]
  onAdd: (name: string) => void
  onRemove: (name: string) => void
  empty: string
  addLabel?: string
  suggestLabel?: string
}) {
  const [draft, setDraft] = useState('')
  const has = (n: string) => items.some((x) => same(x, n))
  const add = (n: string) => {
    const v = n.trim()
    if (!v || has(v)) return
    onAdd(v)
    setDraft('')
  }
  const unused = suggestions.filter((s) => !has(s))
  return (
    <section aria-label={label} className="rounded-md border p-3" style={{ borderColor: T.borderSubtle }}>
      <div className="mb-2.5 flex items-center gap-1.5" style={{ fontSize: 12.5, color: tone }}>
        <Icon name={icon} size={15} />{label}<span className="ml-auto" style={{ color: T.micro }}>{items.length}</span>
      </div>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {items.map((x) => (
          <Tag key={x} closable onClose={(e) => { e.preventDefault(); onRemove(x) }} closeIcon={<span aria-label={`Remove ${x}`}><Icon name="close" size={13} /></span>}
            className="m-0 rounded-full" style={{ color: tone, borderColor: tone, background: '#fff', fontSize: 12 }}>
            {x}
          </Tag>
        ))}
        {items.length === 0 && <span style={{ fontSize: 11.5, color: T.micro }}>{empty}</span>}
      </div>
      <div className="flex gap-1.5">
        <Input size="small" aria-label={`${label}: ${addLabel}`} placeholder={addLabel} value={draft} onChange={(e) => setDraft(e.target.value)} onPressEnter={(e) => { e.preventDefault(); add(draft) }} />
        <Button color="primary" variant="outlined" size="small" disabled={!draft.trim() || has(draft)} onClick={() => add(draft)}>Add</Button>
      </div>
      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-[5px]">
          <span style={{ fontSize: 11, color: T.micro }}>{suggestLabel}</span>
          {unused.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="inline-flex h-5 cursor-pointer items-center rounded-full border border-dashed bg-white px-2"
              style={{ fontSize: 11.5, borderColor: T.border, color: T.muted }}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/* Add to one list and take it off the other (spec §6). */
export const addExclusive = (lists: { add: string[]; other: string[] }, name: string) => ({
  add: [...lists.add, name],
  other: lists.other.filter((x) => !same(x, name)),
})
