/* Material Symbols (Outlined) — the platform's only icon set. */
import type { CSSProperties } from 'react'

export function Icon({ name, size = 20, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  return (
    <span aria-hidden className={`material-symbols-outlined ${className ?? ''}`} style={{ fontSize: size, ...style }}>
      {name}
    </span>
  )
}
