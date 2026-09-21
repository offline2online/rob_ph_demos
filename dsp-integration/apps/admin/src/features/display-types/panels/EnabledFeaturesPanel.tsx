/* ENABLED FEATURES panel (spec §1): defaults inherited by every display of
   the type. Feature explanations are tooltips (decision 2). QR Control needs
   a phantom zone (prototype defect 3, fixed). */
import { ColorPicker, InputNumber, Select, Switch } from 'antd'
import type { DisplayType } from '@ph-dsp/types'
import type { ReactNode } from 'react'
import { CollapsiblePanel } from '../../../shared/CollapsiblePanel'
import { Field } from '../../../shared/Field'
import { Icon } from '../../../shared/Icon'
import { InfoTip, WithTip } from '../../../shared/InfoTip'
import { SummaryChip } from '../../../shared/SummaryChip'
import { T } from '../../../theme/phTheme'
import {
  COMPANY_FEATURE_AVAILABILITY, DETECTION_PRESETS, FEATURES, MIST_ZONES, MOBILE_SITE_TEMPLATES, VISION_MODES,
  featureConfig, featureOn, featuresSummary, qr, withFeature, withQr, type FeatureKey,
} from '../model'
import { TIPS } from '../tooltips'

const SubSettings = ({ children }: { children: ReactNode }) => (
  <div className="mt-3 ml-7 grid grid-cols-2 gap-3 rounded-md border p-3" style={{ background: T.surfaceAlt, borderColor: T.borderSubtle }}>{children}</div>
)
const hex = (c: { toHexString: () => string }) => c.toHexString()

export function EnabledFeaturesPanel({ d, update, open, onToggle }: { d: DisplayType; update: (fn: (d: DisplayType) => DisplayType) => void; open: boolean; onToggle: () => void }) {
  const q = qr(d)
  const phantomDefined = !!q.phantomArea?.enabled
  const setOn = (key: FeatureKey, on: boolean) =>
    update((t) => (key === 'qr_control' ? withQr(t, (x) => ({ ...x, enabled: on })) : withFeature(t, key, { enabled: on })))

  return (
    <CollapsiblePanel
      title="Enabled Features"
      open={open}
      onToggle={onToggle}
      summary={featuresSummary(d).map(({ key, ...c }) => <SummaryChip key={key} {...c} />)}
      badge={<InfoTip text={TIPS.enabledFeatures} />}
    >
      {FEATURES.map((f) => {
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
            {available && on && f.key === 'proximity_mist' && (
              <SubSettings>
                <Field label="Mode" htmlFor="mistMode">
                  <Select id="mistMode" className="w-full" value={(featureConfig(d, 'proximity_mist').mode as string) || 'zone'}
                    onChange={(v) => update((t) => withFeature(t, 'proximity_mist', { mode: v }))} options={[{ value: 'zone', label: 'Zone' }, { value: 'vbeacon', label: 'vBeacon' }]} />
                </Field>
                <Field label="Zone" htmlFor="mistZone">
                  <Select id="mistZone" className="w-full" value={(featureConfig(d, 'proximity_mist').zone as string) || MIST_ZONES[0]}
                    onChange={(v) => update((t) => withFeature(t, 'proximity_mist', { zone: v }))} options={MIST_ZONES.map((z) => ({ value: z, label: z }))} />
                </Field>
              </SubSettings>
            )}
            {available && on && f.key === 'vision_ai' && (
              <SubSettings>
                <Field label="Mode" htmlFor="visionMode">
                  <Select id="visionMode" className="w-full" value={(featureConfig(d, 'vision_ai').mode as string) || VISION_MODES[0]}
                    onChange={(v) => update((t) => withFeature(t, 'vision_ai', { mode: v }))} options={VISION_MODES.map((m) => ({ value: m, label: m }))} />
                </Field>
                <Field label="Detection preset" htmlFor="visionPreset">
                  <Select id="visionPreset" className="w-full" value={(featureConfig(d, 'vision_ai').preset as string) || 'Balanced'}
                    onChange={(v) => update((t) => withFeature(t, 'vision_ai', { preset: v, ...DETECTION_PRESETS[v] }))} options={Object.keys(DETECTION_PRESETS).map((k) => ({ value: k, label: k }))} />
                </Field>
              </SubSettings>
            )}
          </div>
        )
      })}
    </CollapsiblePanel>
  )
}
