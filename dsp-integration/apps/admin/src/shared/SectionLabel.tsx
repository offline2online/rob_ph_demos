/* ALL CAPS muted section divider — components.md §11. */
import type { CSSProperties, ReactNode } from 'react'
import { T } from '../theme/phTheme'

export const SectionLabel = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div className="uppercase" style={{ fontSize: 12, letterSpacing: '0.5px', color: T.muted, marginTop: 24, marginBottom: 12, ...style }}>
    {children}
  </div>
)
