/* AG Grid (Alpine) for every table (ph-designer: HQ Admin tables are AG
   Grid). Grows with its rows and fits its columns to the content column, so
   the page never scrolls sideways at 1163px. AG Grid's own resize detection
   doesn't fire reliably inside collapsible panels, so the wrapper's width
   drives the fit. */
import type { ColDef, GridApi, GridOptions } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { useEffect, useRef } from 'react'

export function Grid<Row>({ rows, columns, context, getRowId, label, ...options }: {
  rows: Row[]
  columns: ColDef<Row>[]
  /* Latest values for cell renderers, read through params.context.current. */
  context?: unknown
  getRowId: (row: Row) => string
  label?: string
} & Omit<GridOptions<Row>, 'rowData' | 'columnDefs' | 'context' | 'getRowId'>) {
  const wrapper = useRef<HTMLDivElement>(null)
  const api = useRef<GridApi<Row> | null>(null)
  const ctx = useRef(context)
  ctx.current = context
  const fit = () => {
    const w = wrapper.current?.clientWidth
    if (w && api.current && !api.current.isDestroyed()) api.current.sizeColumnsToFit(w - 2)
  }
  useEffect(() => {
    if (!wrapper.current) return
    const ro = new ResizeObserver(fit)
    ro.observe(wrapper.current)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={wrapper} className="ag-theme-alpine w-full" aria-label={label}>
      <AgGridReact<Row>
        rowData={rows}
        columnDefs={columns}
        context={ctx}
        getRowId={(p) => getRowId(p.data)}
        domLayout="autoHeight"
        headerHeight={40}
        rowHeight={42}
        suppressCellFocus
        suppressMovableColumns
        suppressHorizontalScroll
        defaultColDef={{ sortable: false, suppressKeyboardEvent: () => true }}
        {...options}
        onGridReady={(e) => {
          api.current = e.api
          fit()
          options.onGridReady?.(e)
        }}
        /* New column definitions reset the widths (e.g. a re-render while a
           dialog opens), and the wrapper's size hasn't changed, so fit again. */
        onNewColumnsLoaded={(e) => {
          fit()
          options.onNewColumnsLoaded?.(e)
        }}
      />
    </div>
  )
}
