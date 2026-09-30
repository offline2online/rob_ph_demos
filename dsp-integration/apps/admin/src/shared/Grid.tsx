/* AG Grid (Alpine) for every table (ph-designer: HQ Admin tables are AG
   Grid). Grows with its rows and fits its columns to the content column, so
   the page never scrolls sideways at 1163px. AG Grid's own resize detection
   doesn't fire reliably inside collapsible panels, so the wrapper's width
   drives the fit. */
import type { ColDef, GridApi, GridOptions } from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { useEffect, useRef } from 'react'

/* Module-level on purpose: an inline object is new on every render, which
   AG Grid reads as changed options and answers by resetting every column to
   its defined width — undoing a dragged column edge whenever a row expands. */
const DEFAULT_COL_DEF: ColDef = { sortable: false, suppressKeyboardEvent: () => true }

export function Grid<Row>({ rows, columns, context, getRowId, label, height, stickyHeader, ...options }: {
  rows: Row[]
  columns: ColDef<Row>[]
  /* Latest values for cell renderers, read through params.context.current. */
  context?: unknown
  getRowId: (row: Row) => string
  label?: string
  /* A fixed height scrolls the rows inside the grid, so the header stays put. */
  height?: number
  /* Keep the header in view while the page scrolls past a long table. */
  stickyHeader?: boolean
} & Omit<GridOptions<Row>, 'rowData' | 'columnDefs' | 'context' | 'getRowId'>) {
  const wrapper = useRef<HTMLDivElement>(null)
  const api = useRef<GridApi<Row> | null>(null)
  const ctx = useRef(context)
  ctx.current = context
  /* Once someone has dragged a column edge, sizeColumnsToFit would throw
     their widths away (it re-derives every width from the column
     definitions) the next time it runs — including when a row expands and
     the page gains a scrollbar. So after a drag, keep their widths and only
     scale the flexible columns proportionally if the total no longer fits. */
  const dragged = useRef(false)
  const fit = () => {
    const w = wrapper.current?.clientWidth
    const a = api.current
    if (!w || !a || a.isDestroyed()) return
    if (!dragged.current) {
      a.sizeColumnsToFit(w - 2)
      return
    }
    const state = a.getColumnState().filter((c) => !c.hide)
    const fixed = (id: string) => !!a.getColumn(id)?.getColDef().suppressSizeToFit
    const fixedTotal = state.filter((c) => fixed(c.colId)).reduce((n, c) => n + (c.width ?? 0), 0)
    const flexTotal = state.filter((c) => !fixed(c.colId)).reduce((n, c) => n + (c.width ?? 0), 0)
    const room = w - 2 - fixedTotal
    if (flexTotal <= 0 || Math.abs(flexTotal - room) < 1) return
    const k = room / flexTotal
    a.applyColumnState({ state: state.filter((c) => !fixed(c.colId)).map((c) => ({ colId: c.colId, width: Math.floor((c.width ?? 0) * k) })) })
  }
  useEffect(() => {
    if (!wrapper.current) return
    const ro = new ResizeObserver(fit)
    ro.observe(wrapper.current)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={wrapper} className={`ag-theme-alpine w-full${stickyHeader ? ' ag-sticky-header' : ''}`} aria-label={label} style={height ? { height } : undefined}>
      <AgGridReact<Row>
        rowData={rows}
        columnDefs={columns}
        context={ctx}
        getRowId={(p) => getRowId(p.data)}
        domLayout={height ? 'normal' : 'autoHeight'}
        headerHeight={40}
        rowHeight={42}
        suppressCellFocus
        suppressMovableColumns
        suppressHorizontalScroll
        defaultColDef={DEFAULT_COL_DEF}
        {...options}
        onColumnResized={(e) => {
          if (e.finished && e.source === 'uiColumnResized') dragged.current = true
          options.onColumnResized?.(e)
        }}
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
