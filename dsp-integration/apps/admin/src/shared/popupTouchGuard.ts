/* Touch scrolling inside pop-ups (ticket EaqjQcujKZEUQL1V2kEv, 23 Oct 2026).
   On an iPad, scrolling a time column or the time zone list inside a date/time
   picker or a drop-down scrolled the page behind it instead — Safari hands a
   swipe to the nearest scroller that can still move, and the page (or the
   modal under the pop-up) always can. While a pop-up is open this guard
   cancels any touch-scroll that is not going to be absorbed by a scrollable
   part of that pop-up, so the background stays put. It also covers a pop-up
   opened from within a modal: the modal is "outside" the pop-up like the page. */
const POPUP_SELECTOR = [
  '.ant-picker-dropdown',
  '.ant-select-dropdown',
  '.ant-dropdown',
  '.ant-popover',
  '.ant-cascader-dropdown',
].join(',')

const isOpen = (el: Element) => !/-hidden\b/.test(el.className.toString())

const openPopups = (doc: Document) => Array.from(doc.querySelectorAll(POPUP_SELECTOR)).filter(isOpen)

const scrollsVertically = (el: HTMLElement) => {
  const oy = getComputedStyle(el).overflowY
  return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1
}

/** True when a touch-move starting on `target` should be cancelled. `dy` is the
 *  finger's vertical travel since the last event (positive = finger moving down,
 *  i.e. content scrolling up). */
export function shouldBlockTouchMove(target: EventTarget | null, dy: number, doc: Document = document): boolean {
  const popups = openPopups(doc)
  if (popups.length === 0) return false
  const start = target instanceof Element ? target : null
  const popup = start ? popups.find((p) => p.contains(start)) : undefined
  if (!popup) return true // the page or the modal behind an open pop-up: locked
  for (let el = start as HTMLElement | null; el && popup.contains(el); el = el.parentElement) {
    if (!scrollsVertically(el)) continue
    const atTop = el.scrollTop <= 0
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
    if ((dy > 0 && atTop) || (dy < 0 && atBottom)) continue // would chain to the next scroller up
    return false // this scroller takes the gesture
  }
  return true // nothing inside the pop-up can take it, so it must not reach the page
}

/** Installs the guard on the document; returns an uninstall function. */
export function installPopupTouchGuard(doc: Document = document): () => void {
  let lastY = 0
  const onStart = (e: TouchEvent) => { lastY = e.touches[0]?.clientY ?? 0 }
  const onMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY ?? lastY
    const dy = y - lastY
    lastY = y
    if (e.touches.length === 1 && e.cancelable && shouldBlockTouchMove(e.target, dy, doc)) e.preventDefault()
  }
  doc.addEventListener('touchstart', onStart, { passive: true })
  doc.addEventListener('touchmove', onMove, { passive: false })
  return () => {
    doc.removeEventListener('touchstart', onStart)
    doc.removeEventListener('touchmove', onMove)
  }
}
