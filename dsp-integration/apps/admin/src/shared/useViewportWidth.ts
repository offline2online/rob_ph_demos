/* Width of the iframe's own viewport (the content frame is fluid). */
import { useEffect, useState } from 'react'

export function useViewportWidth() {
  const [w, setW] = useState(typeof window === 'undefined' ? 1280 : window.innerWidth)
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}
