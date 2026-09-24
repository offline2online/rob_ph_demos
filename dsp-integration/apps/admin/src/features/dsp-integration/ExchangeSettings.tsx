/* Exchange settings (spec §7): the four seller-of-record fields. Once saved
   and complete, the page shows where sellers.json is published. */
import { Input } from 'antd'
import type { ExchangeInput } from '@ph-dsp/types'
import { Callout } from '../../shared/Callout'
import { Field } from '../../shared/Field'
import { SectionLabel } from '../../shared/SectionLabel'
import { WithTip } from '../../shared/InfoTip'
import { StatusPill } from '../../shared/Pill'
import { T } from '../../theme/phTheme'
import { useSection } from './DspIntegrationLayout'
import { SubPageHeader } from './SubPageHeader'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
export const EXCHANGE_TIP =
  'Sets up your organisation as the seller of record for its screens. Configurable here: organisation name, domain, seller ID and ad-ops contact email, all required. Once saved and complete, sellers.json is published at https://[domain]/sellers.json and every bid request carries your domain and seller ID in its SupplyChain; until then no DSP is sent bid requests. Not configurable (platform defaults): seller type (Publisher), the DOOH object, the OpenOOH venue taxonomy, QPS and bid timeout. Bid requests use OpenRTB 2.6 as the minimum supported version for programmatic DOOH; the exchange is designed to adopt 2.7, 2.8 and later versions per DSP as the market moves.'

export function ExchangeSettings() {
  const { draft, saved, update, published } = useSection()
  const e = draft.exchange
  const set = (k: keyof ExchangeInput, v: string) => update('exchange', (x) => ({ ...x, [k]: v }))
  /* Status reflects what is live: the saved values (spec §7 "once saved and complete"). */
  const url = `https://${saved.exchange.domain}/sellers.json`
  return (
    <>
      <SubPageHeader
        icon="storefront"
        title="Exchange settings"
        tip={EXCHANGE_TIP}
        right={published ? <StatusPill colour={T.success} icon="check_circle">Published</StatusPill> : <StatusPill colour={T.warning} icon="warning">Incomplete</StatusPill>}
      />
      <SectionLabel><WithTip tip="All four fields are needed before any DSP is sent bid requests.">Seller of record</WithTip></SectionLabel>
      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <Field label="Organisation" required htmlFor="organisation">
          <Input id="organisation" value={e.organisation} placeholder="e.g. Demo Retail Group" onChange={(x) => set('organisation', x.target.value)} />
        </Field>
        <Field label="Domain" required htmlFor="domain" tip="sellers.json is published at https://[domain]/sellers.json and the domain is sent on every bid request.">
          <Input id="domain" value={e.domain} placeholder="e.g. demoretail.example" style={{ fontFamily: MONO }} onChange={(x) => set('domain', x.target.value)} />
        </Field>
        <Field label="Seller ID" required htmlFor="sellerId">
          <Input id="sellerId" value={e.sellerId} style={{ fontFamily: MONO }} onChange={(x) => set('sellerId', x.target.value)} />
        </Field>
        <Field label="Ad-ops contact email" required htmlFor="contactEmail">
          <Input id="contactEmail" value={e.contactEmail} placeholder="adops@…" onChange={(x) => set('contactEmail', x.target.value)} />
        </Field>
      </div>
      {published ? (
        <Callout tone="success" icon="public">sellers.json is published at <code>{url}</code>.</Callout>
      ) : (
        <Callout tone="warning" icon="warning">Complete all four fields before any DSP can be sent bid requests.</Callout>
      )}
    </>
  )
}
