/* "DSPs that may target it" (spec §6): All connected DSPs (includes DSPs
   connected later) or individual DSPs, shown as pills. A multi-select, not a
   column per DSP, so the table doesn't grow as DSPs are added. */
import { Checkbox, Divider, Popover } from 'antd'
import { providerDef, type Partner, type VariableAccess } from '@ph-dsp/types'
import { useState } from 'react'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'

const Pill = ({ colour, icon, children }: { colour: string; icon?: string; children: string }) => (
  <span className="inline-flex h-[22px] items-center gap-1 rounded-full px-2 whitespace-nowrap" style={{ fontSize: 11.5, border: `1px solid ${colour}`, color: colour, background: '#fff' }}>
    {icon && <Icon name={icon} size={12} />}{children}
  </span>
)

export function DspPicker({ label, value, dsps, onChange }: { label: string; value: VariableAccess; dsps: Partner[]; onChange: (v: VariableAccess) => void }) {
  const [open, setOpen] = useState(false)
  const all = value === 'all'
  const ids = all ? [] : (value as string[])
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  const content = (
    <div className="min-w-[260px]" role="group" aria-label={`${label}: DSPs that may target it`}>
      <Checkbox checked={all} onChange={() => onChange(all ? [] : 'all')} className="w-full px-1 py-1">
        <span style={{ fontSize: 12.5 }}>All connected DSPs<div style={{ fontSize: 11, color: T.micro }}>Includes DSPs connected later</div></span>
      </Checkbox>
      <Divider className="my-1" />
      {dsps.map((d) => {
        const def = providerDef(d.provider)
        const sub = d.status === 'connected' ? null : d.status === 'error' ? 'Connection error' : 'Not connected'
        return (
          <Checkbox key={d.id} checked={all || ids.includes(d.id)} disabled={all} onChange={() => toggle(d.id)} className="w-full px-1 py-1">
            <span className="inline-flex items-start gap-1.5" style={{ fontSize: 12.5 }}>
              <Icon name={def?.icon ?? 'handshake'} size={15} style={{ color: def?.colour }} />
              <span>{d.name}{sub && <div style={{ fontSize: 11, color: T.micro }}>{sub}</div>}</span>
            </span>
          </Checkbox>
        )
      })}
      {dsps.length === 0 && <div className="p-2" style={{ fontSize: 12, color: T.muted }}>No DSPs configured yet.</div>}
    </div>
  )
  return (
    <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" content={content} arrow={false}>
      <button
        type="button"
        aria-label={`${label}: DSPs that may target it`}
        aria-expanded={open}
        className="relative flex min-h-7 w-full cursor-pointer flex-wrap items-center gap-1 rounded-md border bg-white py-[3px] pr-7 pl-1.5 text-left"
        style={{ borderColor: open ? T.primary : T.border }}
      >
        {all && <Pill colour={T.primary} icon="select_all">All connected DSPs</Pill>}
        {!all && ids.map((id) => {
          const d = dsps.find((x) => x.id === id)
          const def = d && providerDef(d.provider)
          return d ? <Pill key={id} colour={def?.colour ?? T.primary} icon={def?.icon}>{d.name}</Pill> : null
        })}
        {!all && ids.length === 0 && <span className="px-0.5" style={{ fontSize: 12, color: T.micro }}>None</span>}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} style={{ position: 'absolute', right: 6, top: 5, color: T.muted }} />
      </button>
    </Popover>
  )
}
