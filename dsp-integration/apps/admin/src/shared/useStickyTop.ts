/* Keeps a sticky pane on screen on a touch tablet without a scroller of its own.
   A sticky pane taller than the visible viewport would otherwise have its lower
   rows cut off, and a nested scroller traps the swipe (see .ph-sticky-pane in
   theme/index.css). So the pane's `top` is lifted by however much it overhangs:
   the page scrolls it up until its bottom meets the screen, then it holds there.
   `gap` is the pane's normal offset from the top of the screen. */
import { useEffect, type RefObject } from 'react'

export function useStickyTop(ref: RefObject<HTMLElement | null>, gap = 0) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof window.matchMedia !== 'function') return
    const touch = window.matchMedia('(hover: none) and (pointer: coarse)')
    const update = () => {
      if (!touch.matches) { el.style.top = ''; return }
      const overhang = el.offsetHeight + gap - window.innerHeight
      el.style.top = `${Math.round(gap - Math.max(0, overhang))}px`
    }
    update()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    ro?.observe(el)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('orientationchange', update) }
  }, [ref, gap])
}
