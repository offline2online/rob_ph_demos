/* Shared page layout (spec "Page layout"): a 260px list column, sticky while
   the page scrolls, and one content column taking the full remaining width.
   Not sticky on a touch screen — see .ph-sticky-pane in theme/index.css. */
import type { ReactNode } from 'react'

export function ListPageLayout({ list, children }: { list: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-5">
      <div className="ph-sticky-pane ph-list-pane sticky top-5 w-[260px] shrink-0 overflow-x-hidden overflow-y-auto">
        {list}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
