/* Shared page layout (spec "Page layout"): a 260px list column, sticky while
   the page scrolls, and one content column taking the full remaining width.
   On a touch screen it has no scroller of its own — see .ph-sticky-pane in
   theme/index.css and useStickyTop. */
import { useRef, type ReactNode } from 'react'
import { useStickyTop } from './useStickyTop'

export function ListPageLayout({ list, children }: { list: ReactNode; children: ReactNode }) {
  const paneRef = useRef<HTMLDivElement>(null)
  useStickyTop(paneRef, 20)
  return (
    <div className="flex items-start gap-5">
      <div ref={paneRef} className="ph-sticky-pane ph-list-pane sticky top-5 w-[260px] shrink-0 overflow-x-hidden overflow-y-auto">
        {list}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
