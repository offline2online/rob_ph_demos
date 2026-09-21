/* Material Symbols (Outlined), the platform's icon set. */
export const Icon = ({ name, size = 18, color }: { name: string; size?: number; color?: string }) => (
  <span aria-hidden className="material-symbols-outlined" style={{ fontSize: size, color, lineHeight: 1, verticalAlign: 'middle' }}>{name}</span>
)
