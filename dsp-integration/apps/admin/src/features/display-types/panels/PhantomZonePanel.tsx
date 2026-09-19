/* PHANTOM ZONE panel (spec §1). The existing QR Control (phantom zone)
   settings, unchanged; summary chips when collapsed. */
import { InputNumber, Select, Switch } from 'antd'
import { PLATFORM_DEFAULTS, type DisplayType } from '@ph-dsp/types'
import { CollapsiblePanel } from '../../../shared/CollapsiblePanel'
import { Field } from '../../../shared/Field'
import { WithTip } from '../../../shared/InfoTip'
import { SummaryChip } from '../../../shared/SummaryChip'
import { T } from '../../../theme/phTheme'
import { DefaultSelect } from '../DefaultSelect'
import { PHANTOM_POSITIONS, PHANTOM_SIZING_MODES, phantomSummary, qr, withQr } from '../model'
import { TIPS } from '../tooltips'

export function PhantomZonePanel({ d, update, open, onToggle }: { d: DisplayType; update: (fn: (d: DisplayType) => DisplayType) => void; open: boolean; onToggle: () => void }) {
  const pa = qr(d).phantomArea
  const setArea = (patch: Partial<typeof pa>) => update((t) => withQr(t, (q) => ({ ...q, phantomArea: { ...q.phantomArea, ...patch } })))
  return (
    <CollapsiblePanel title="Phantom Zone" open={open} onToggle={onToggle} summary={phantomSummary(d).map(({ key, ...c }) => <SummaryChip key={key} {...c} />)}>
      <div className="flex items-center justify-between" style={{ marginBottom: pa.enabled ? 14 : 0 }}>
        <WithTip tip={TIPS.definePhantomZone}><span style={{ fontSize: 13.5 }}>Define phantom zone</span></WithTip>
        <Switch
          aria-label="Define phantom zone"
          checked={!!pa.enabled}
          /* Removing the phantom zone also turns QR Control off. */
          onChange={(v) => update((t) => withQr(t, (q) => ({ ...q, enabled: v ? q.enabled : false, phantomArea: { ...q.phantomArea, enabled: v } })))}
        />
      </div>
      {pa.enabled && (
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Phantom Area(s) Size">
            <div className="flex items-center gap-1.5">
              <span style={{ color: T.muted, fontSize: 13 }}>W</span>
              <InputNumber aria-label="Phantom width" min={1} precision={0} value={pa.width} onChange={(v) => setArea({ width: Number(v ?? 0) })} style={{ width: 80 }} />
              <span style={{ color: T.muted, fontSize: 13 }}>H</span>
              <InputNumber aria-label="Phantom height" min={1} precision={0} value={pa.height} onChange={(v) => setArea({ height: Number(v ?? 0) })} style={{ width: 80 }} />
            </div>
          </Field>
          <Field label="Phantom Area(s) Position" htmlFor="phantomPosition">
            <DefaultSelect id="phantomPosition" value={pa.position} onChange={(v) => setArea({ position: v })} fallback={PLATFORM_DEFAULTS.phantomAreaPosition} options={PHANTOM_POSITIONS} />
          </Field>
          <Field label="Phantom Area(s) Sizing Mode" htmlFor="phantomSizing">
            <Select id="phantomSizing" className="w-full" value={pa.sizingMode} onChange={(v) => setArea({ sizingMode: v })} options={PHANTOM_SIZING_MODES.map((o) => ({ value: o, label: o }))} />
          </Field>
        </div>
      )}
    </CollapsiblePanel>
  )
}
