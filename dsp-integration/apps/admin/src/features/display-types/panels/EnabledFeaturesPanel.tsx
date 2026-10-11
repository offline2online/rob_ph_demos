/* ENABLED FEATURES panel (spec §1): defaults inherited by every display of
   the type. Feature explanations are tooltips (decision 2). QR Control needs
   a phantom zone (prototype defect 3, fixed). */
import { ColorPicker, InputNumber, Select, Switch } from 'antd'
import { hasStructuralFeatures, type DisplayType } from '@ph-dsp/types'
import { useState, type ReactNode } from 'react'
import { CollapsiblePanel } from '../../../shared/CollapsiblePanel'
import { Field } from '../../../shared/Field'
import { Icon } from '../../../shared/Icon'
import { InfoTip, WithTip } from '../../../shared/InfoTip'
import { SummaryChip } from '../../../shared/SummaryChip'
import { T } from '../../../theme/phTheme'
import {
  COMPANY_FEATURE_AVAILABILITY, DETECTION_PRESETS, FEATURES, MOBILE_SITE_TEMPLATES, VISION_MODES,
  featureConfig, featureOn, featuresSummary, qr, withFeature, withQr, type FeatureKey,
} from '../model'
import { TIPS } from '../tooltips'
import { PRESET_TIP, VISION_SECTIONS, type VisionSection } from '../visionSettings'

const SubSettings = ({ children }: { children: ReactNode }) => (
  <div className="mt-3 ml-7 grid grid-cols-2 gap-3 rounded-md border p-3" style={{ background: T.surfaceAlt, borderColor: T.borderSubtle }}>{children}</div>
)
function VisionSectionBlock({ section, d, update }: { section: VisionSection; d: DisplayType; update: (fn: (d: DisplayType) => DisplayType) => void }) {
  const [open, setOpen] = useState(true)
  const cfg = featureConfig(d, 'vision_ai')
  const set = (key: string, value: unknown) => update((t) => withFeature(t, 'vision_ai', { [key]: value }))
  return (
    <section className="col-span-2" aria-label={section.title}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mb-2 flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left" style={{ fontSize: 13.5, fontWeight: 500, color: T.text }}>
        <Icon name={open ? 'expand_more' : 'chevron_right'} size={18} style={{ color: T.muted }} />
        {section.title}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-3">
          {section.fields.map((f) => {
            const value = cfg[f.key] ?? f.default
            return (
              <Field key={f.key} label={f.label} tip={f.tip} htmlFor={`vision-${f.key}`}>
                {f.kind === 'number' && (
                  <InputNumber id={`vision-${f.key}`} className="w-full" min={f.min} step={f.step} precision={f.precision}
                    value={value as number} onChange={(v) => set(f.key, Number(v ?? f.min ?? 0))} />
                )}
                {f.kind === 'select' && (
                  <Select id={`vision-${f.key}`} className="w-full" value={value as string} onChange={(v) => set(f.key, v)} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
                )}
                {f.kind === 'switch' && <Switch id={`vision-${f.key}`} aria-label={f.label} checked={!!value} onChange={(v) => set(f.key, v)} />}
              </Field>
            )
          })}
        </div>
      )}
    </section>
  )
}
const visionMode = (d: DisplayType) => {
  const m = featureConfig(d, 'vision_ai').mode as string
  return VISION_MODES.includes(m) ? m : VISION_MODES[0]
}
const hex = (c: { toHexString: () => string }) => c.toHexString()

export function EnabledFeaturesPanel({ d, update, open, onToggle }: { d: DisplayType; update: (fn: (d: DisplayType) => DisplayType) => void; open: boolean; onToggle: () => void }) {
  const q = qr(d)
  const phantomDefined = !!q.phantomArea?.enabled
  const setOn = (key: FeatureKey, on: boolean) =>
    update((t) => (key === 'qr_control' ? withQr(t, (x) => ({ ...x, enabled: on })) : withFeature(t, key, { enabled: on })))
  /* Website and Mobile App keep QR Control (Phantom Zone/QR Control "as
     today") but hide every other feature — they have no physical display
     for in-store radio or on-device Vision/AI to run on
     (ticket, 28 Sep 2026). */
  const visibleFeatures = hasStructuralFeatures(d.touchPoint) ? FEATURES : FEATURES.filter((f) => f.key === 'qr_control')

  return (
    <CollapsiblePanel
      title="Enabled Features"
      open={open}
      onToggle={onToggle}
      summary={featuresSummary(d).map(({ key, ...c }) => <SummaryChip key={key} {...c} />)}
      badge={<InfoTip text={TIPS.enabledFeatures} />}
    >
      {visibleFeatures.map((f) => {
        const available = COMPANY_FEATURE_AVAILABILITY[f.key]
        const on = featureOn(d, f.key)
        const blockedByPhantom = f.key === 'qr_control' && !phantomDefined
        return (
          <div key={f.key} className="border-b py-[11px]" style={{ borderColor: T.borderSubtle, opacity: available ? 1 : 0.45 }}>
            <div className="flex items-center gap-2.5">
              <Icon name={f.icon} size={18} style={{ color: available ? T.text : T.micro }} />
              <span className="min-w-0 flex-1" style={{ fontSize: 13.5 }}>
                <WithTip tip={f.hint}>{f.label}</WithTip>
              </span>
              <Switch aria-label={f.label} checked={on} disabled={!available || blockedByPhantom} onChange={(v) => setOn(f.key, v)} />
            </div>
            {!available && <div className="mt-[5px] ml-7" style={{ fontSize: 11.5, color: T.muted }}>Not enabled for this company — contact Platform Admin.</div>}

            {available && on && f.key === 'qr_control' && (
              <SubSettings>
                <Field label="QR size (px)">
                  <InputNumber aria-label="QR size (px)" className="w-full" min={1} precision={0} value={q.qrCode?.size ?? 100}
                    onChange={(v) => update((t) => withQr(t, (x) => ({ ...x, qrCode: { ...x.qrCode, size: Number(v ?? 0) } })))} />
                </Field>
                <Field label="QR colour">
                  <ColorPicker value={q.qrCode?.colour || '#000000'} onChange={(c) => update((t) => withQr(t, (x) => ({ ...x, qrCode: { ...x.qrCode, colour: hex(c) } })))} />
                </Field>
                <Field label="Connected icon colour">
                  <ColorPicker value={q.connectedIconColour || '#169bc2'} onChange={(c) => update((t) => withQr(t, (x) => ({ ...x, connectedIconColour: hex(c) })))} />
                </Field>
                <Field label="Mobile site template" htmlFor="mobileSiteTemplate">
                  <Select id="mobileSiteTemplate" className="w-full" value={q.mobileSiteTemplate || MOBILE_SITE_TEMPLATES[0]}
                    onChange={(v) => update((t) => withQr(t, (x) => ({ ...x, mobileSiteTemplate: v })))} options={MOBILE_SITE_TEMPLATES.map((m) => ({ value: m, label: m }))} />
                </Field>
              </SubSettings>
            )}
            {available && on && f.key === 'vision_ai' && (
              <SubSettings>
                <Field label="Mode" htmlFor="visionMode">
                  <Select id="visionMode" className="w-full" value={visionMode(d)}
                    onChange={(v) => update((t) => withFeature(t, 'vision_ai', { mode: v }))} options={VISION_MODES.map((m) => ({ value: m, label: m }))} />
                </Field>
                {visionMode(d) === VISION_MODES[0] && (
                  <Field label="Detection Preset" tip={PRESET_TIP} htmlFor="visionPreset">
                    <Select id="visionPreset" className="w-full" value={(featureConfig(d, 'vision_ai').preset as string) || 'Balanced'}
                      onChange={(v) => update((t) => withFeature(t, 'vision_ai', { preset: v, ...DETECTION_PRESETS[v] }))} options={Object.keys(DETECTION_PRESETS).map((k) => ({ value: k, label: k }))} />
                  </Field>
                )}
                {visionMode(d) === VISION_MODES[0] && featureConfig(d, 'vision_ai').preset === 'Custom' && (
                  <div className="col-span-2 grid grid-cols-2 gap-3" role="group" aria-label="Custom detection settings">
                    {VISION_SECTIONS.map((s) => <VisionSectionBlock key={s.id} section={s} d={d} update={update} />)}
                  </div>
                )}
              </SubSettings>
            )}
          </div>
        )
      })}
    </CollapsiblePanel>
  )
}
