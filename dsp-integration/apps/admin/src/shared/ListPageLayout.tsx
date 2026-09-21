/* Shared page layout (spec "Page layout"): a 260px list column, sticky while
   the page scrolls, and one content column taking the full remaining width. */
import type { ReactNode } from 'react'

export function ListPageLayout({ list, children }: { list: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-5">
      <div className="sticky top-5 w-[260px] shrink-0 overflow-x-hidden overflow-y-auto" style={{ maxHeight: 'calc(100vh - 40px)' }}>
        {list}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
