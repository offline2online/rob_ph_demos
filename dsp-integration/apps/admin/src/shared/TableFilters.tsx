/* Column filters, exactly as Personalisation Hub does them (measured on
   HQ Admin → Displays & Devices → Assigned Devices, 20 Sep 2026). A column
   has one of two filters, never both:

   • Search — a plain text box in the filter row, no funnel. Once it has a
     value a small round ✕ appears inside it; that ✕ is how you clear it.
   • Set — a funnel icon and nothing else. Clicking it opens a small popup:
     a Search box when the list is long, then a checkbox per value, then a
     Clear Filter button. Several values can be ticked at once. The funnel
     is a grey outline when nothing is chosen and solid primary when it is.

   Above the table, the count line switches from "N things" to
   "Showing X of N things" whenever a filter is on (see `showingCount`).

   Both are floating filters over AG Grid's own text filter, so sorting,
   the filter model and everything else in the grid behave as usual. */
import { Button, Checkbox, Dropdown, Input } from 'antd'
import type { ColDef, IFloatingFilterParams, TextMatcherParams } from 'ag-grid-community'
import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { T } from '../theme/phTheme'

/* A set filter's chosen values travel through the text filter as JSON. */
const parse = (text: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(text || '[]')
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}
const setMatcher = ({ filterText, value }: TextMatcherParams) => {
  const chosen = parse(filterText)
  return chosen.length === 0 || chosen.includes(String(value ?? ''))
}

interface Params extends IFloatingFilterParams {
  label: string
  values?: () => string[]
}

/* The search box: type to filter, ✕ to clear. */
function SearchFilter(props: Params) {
  const [text, setText] = useState('')
  const change = (v: string) => {
    setText(v)
    props.parentFilterInstance((filter) => filter.onFloatingFilterChanged('contains', v || null))
  }
  return (
    <Input
      size="small"
      allowClear
      className="w-full"
      aria-label={`${props.label} search`}
      value={text}
      onChange={(e) => change(e.target.value)}
    />
  )
}

/* The funnel and its popup. `chosen` and `onChange` are the filter's state,
   wherever it is kept: AG Grid's filter model, or the page's own URL. */
export function Funnel({ label, values, chosen, onChange, single }: {
  label: string
  values: string[]
  chosen: string[]
  onChange: (next: string[]) => void
  /* One value at a time, for a filter the server applies (the booking schedule). */
  single?: boolean
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const shown = values.filter((v) => v.toLowerCase().includes(search.trim().toLowerCase()))
  const apply = onChange
  const menu = (
    <div className="rounded-md bg-white p-2 shadow-lg" style={{ border: `1px solid ${T.borderSubtle}`, minWidth: 200 }}>
      {values.length > 8 && (
        <Input size="small" className="mb-2" placeholder="Search..." aria-label={`${label} filter search`} value={search} onChange={(e) => setSearch(e.target.value)} />
      )}
      <div className="max-h-[260px] overflow-auto">
        {shown.map((v) => (
          <div key={v} className="px-1 py-1">
            <Checkbox
              checked={chosen.includes(v)}
              onChange={(e) => apply(e.target.checked ? (single ? [v] : [...chosen, v]) : chosen.filter((x) => x !== v))}
            >
              <span style={{ fontSize: 13 }}>{v}</span>
            </Checkbox>
          </div>
        ))}
        {shown.length === 0 && <div className="px-1 py-2" style={{ fontSize: 12.5, color: T.muted }}>Nothing to filter on yet.</div>}
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="primary" size="small" disabled={!chosen.length} onClick={() => { apply([]); setSearch('') }}>Clear Filter</Button>
      </div>
    </div>
  )
  return (
    <Dropdown open={open} onOpenChange={setOpen} trigger={['click']} placement="bottomLeft" popupRender={() => menu}>
      <button
        type="button"
        aria-label={`${label} filter`}
        aria-pressed={chosen.length > 0}
        className="flex h-full w-full cursor-pointer items-center justify-center border-0 bg-transparent"
        style={{ color: chosen.length ? T.primary : T.micro }}
      >
        <Icon name="filter_alt" size={18} style={{ fontVariationSettings: chosen.length ? "'FILL' 1" : undefined }} />
      </button>
    </Dropdown>
  )
}

/* The grid-backed set filter: AG Grid holds the chosen values. */
function SetFilter(props: Params) {
  const [chosen, setChosen] = useState<string[]>([])
  const values = useMemo(() => [...new Set((props.values?.() ?? []).filter(Boolean))], [props])
  return (
    <Funnel
      label={props.label}
      values={values}
      chosen={chosen}
      onChange={(next) => {
        setChosen(next)
        props.parentFilterInstance((filter) => filter.onFloatingFilterChanged('equals', next.length ? JSON.stringify(next) : null))
      }}
    />
  )
}

/* Column definitions: one or the other, as the platform does it. */
export const searchColumn = <Row,>(label: string): Partial<ColDef<Row>> => ({
  filter: 'agTextColumnFilter',
  /* The filter lives in the filter row only; the label row stays clean. */
  suppressHeaderMenuButton: true,
  suppressHeaderFilterButton: true,
  floatingFilter: true,
  suppressFloatingFilterButton: true,
  floatingFilterComponent: SearchFilter,
  floatingFilterComponentParams: { label },
})

export const setColumn = <Row,>(label: string, values: () => string[]): Partial<ColDef<Row>> => ({
  filter: 'agTextColumnFilter',
  filterParams: { textMatcher: setMatcher, maxNumConditions: 1, filterOptions: ['equals'] },
  suppressHeaderMenuButton: true,
  suppressHeaderFilterButton: true,
  floatingFilter: true,
  suppressFloatingFilterButton: true,
  floatingFilterComponent: SetFilter,
  floatingFilterComponentParams: { label, values },
})

/* A set filter the page owns rather than the grid: same funnel and popup,
   but the choice lives in the URL and the server applies it (the booking
   schedule filters every window, not just the rows on screen). */
export const externalSetColumn = <Row,>(label: string, values: string[], chosen: string | undefined, onChange: (value?: string) => void): Partial<ColDef<Row>> => ({
  filter: 'agTextColumnFilter',
  /* The server has already filtered; the grid shows what it sent. */
  filterParams: { textMatcher: () => true },
  suppressHeaderMenuButton: true,
  suppressHeaderFilterButton: true,
  floatingFilter: true,
  suppressFloatingFilterButton: true,
  floatingFilterComponent: () => (
    <Funnel label={label} values={values} chosen={chosen ? [chosen] : []} single onChange={(next) => onChange(next[0])} />
  ),
})

/* "3 Displays & Devices", or "Showing 2 of 3 Displays & Devices" when filtered. */
export const showingCount = (shown: number, total: number, noun: string) =>
  shown === total ? `${total} ${noun}` : `Showing ${shown} of ${total} ${noun}`
