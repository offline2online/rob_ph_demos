/* Inherited-or-override select: "Default (…)" means inherit (null) and is
   shown muted, so an inherited value is visually distinct from an override
   (spec §1 configuration inheritance). */
import { Select } from 'antd'
import { T } from '../../theme/phTheme'

const DEFAULT = '__default__'

export function DefaultSelect({ id, value, onChange, options, fallback, disabled }: { id?: string; value: string | null; onChange: (v: string | null) => void; options: string[]; fallback: string; disabled?: boolean }) {
  return (
    <Select
      id={id}
      className="w-full"
      disabled={disabled}
      value={value ?? DEFAULT}
      onChange={(v) => onChange(v === DEFAULT ? null : v)}
      options={[{ value: DEFAULT, label: <span style={{ color: T.muted }}>Default ({fallback})</span> }, ...options.map((o) => ({ value: o, label: o }))]}
    />
  )
}
