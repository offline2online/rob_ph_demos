/* Add a DSP (spec §7): its own Add partner / Cancel step, then an unsaved
   DSP kept only once saved. It starts in Test and adopts the company lists. */
import { Button } from 'antd'
import { providerDef, type Provider } from '@ph-dsp/types'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { blankPartnerDraft, newPartnerKey, useSection } from './DspIntegrationLayout'
import { DspPage } from './DspPage'
import { PATHS } from './DspList'

export function AddPartnerRoute() {
  const { provider = '' } = useParams()
  const navigate = useNavigate()
  const { draft, update, partners, setShowSaveBar } = useSection()
  const def = providerDef(provider)
  const existing = partners.find((p) => p.provider === provider)
  const key = newPartnerKey(provider)
  const adding = !!draft.partners[key]
  useEffect(() => {
    setShowSaveBar(adding)
    return () => setShowSaveBar(true)
  }, [adding, setShowSaveBar])
  /* Opened for a DSP that is already set up: go to its page. (Right after
     saving a new DSP the section redirects instead, once the draft is clean.) */
  useEffect(() => {
    if (existing && !adding) navigate(PATHS.partner(existing.id), { replace: true })
  }, [existing, adding, navigate])
  if (!def || (existing && !adding)) return null
  if (adding) return <DspPage draftKey={key} partner={null} />

  return (
    <section aria-label={`Add ${def.label}`} className="overflow-hidden rounded-lg border" style={{ borderColor: T.borderSubtle }}>
      <div className="flex items-center gap-2.5 border-b px-4 py-3" style={{ background: T.surfaceAlt, borderColor: T.borderSubtle }}>
        <Icon name={def.icon} size={20} style={{ color: def.colour }} />
        <div>
          <h2 className="m-0" style={{ fontSize: 14, fontWeight: 500 }}><WithTip tip="The DSP starts in Test mode and adopts the company advertiser lists automatically.">Add {def.label}</WithTip></h2>
          <div style={{ fontSize: 11.5, color: T.muted }}>{def.sub}</div>
        </div>
      </div>
      <div className="p-4">
        {/* The provider's setup note is this section's tooltip (decision 2). */}
        <SectionLabel style={{ marginTop: 0 }}><WithTip tip={def.blurb}>You will need</WithTip></SectionLabel>
        <ul className="m-0 pl-[18px]" style={{ fontSize: 13, lineHeight: 1.9 }}>
          {def.fields.map((f) => <li key={f.key}>{f.label}</li>)}
          <li>Bidder endpoint and seat IDs</li>
        </ul>
        <div className="mt-[18px] flex gap-2">
          <Button type="primary" icon={<Icon name="add" size={16} />} onClick={() => update('partners', (ps) => ({ ...ps, [key]: blankPartnerDraft(provider as Provider) }))}>Add partner</Button>
          <Button onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </div>
    </section>
  )
}

export function PartnerRoute() {
  const { id = '' } = useParams()
  const { partners, draft } = useSection()
  const partner = partners.find((p) => p.id === id)
  if (!partner || !draft.partners[id]) return null
  return <DspPage draftKey={id} partner={partner} />
}
