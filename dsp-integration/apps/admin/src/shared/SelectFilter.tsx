/* A floating filter that lists the values in the column, rather than a blank
   box (ph-designer §3: the filter row holds funnel icons, text inputs or a
   select per column; Rob, 20 Sep: list the available filters by name). It
   drives AG Grid's own text filter, so nothing else changes. */
import { Select } from 'antd'
import type { IFloatingFilterParams } from 'ag-grid-community'
import { useMemo, useState } from 'react'

export interface SelectFilterParams extends IFloatingFilterParams {
  /* Every value the column can show, in the order they should be offered. */
  values: () => string[]
  label: string
}

export function SelectFilter(props: SelectFilterParams) {
  const [value, setValue] = useState<string | undefined>()
  const options = useMemo(() => [...new Set(props.values().filter(Boolean))].map((v) => ({ value: v, label: v })), [props])
  return (
    <Select
      size="small"
      allowClear
      className="w-full"
      aria-label={`${props.label} filter`}
      placeholder={props.label}
      value={value}
      options={options}
      onChange={(v) => {
        setValue(v)
        props.parentFilterInstance((filter) => {
          filter.onFloatingFilterChanged(v ? 'equals' : null, v ?? null)
        })
      }}
    />
  )
}
