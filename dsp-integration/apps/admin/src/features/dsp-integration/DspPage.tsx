/* A DSP's page (spec §7), in order: issues at the top, Mode, Connection
   credentials (connect / re-test / disconnect), Bidder integration, then the
   advertiser whitelist / blacklist. Nothing pricing- or targeting-related. */
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Input, Segmented, Select, Tooltip } from 'antd'
import { providerDef, type Partner } from '@ph-dsp/types'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../../api/client'
import { Callout } from '../../shared/Callout'
import { Field } from '../../shared/Field'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { ListEditor, addExclusive } from '../../shared/ListEditor'
import { StatusPill } from '../../shared/Pill'
import { SectionLabel } from '../../shared/SectionLabel'
import { deepEqual } from '../../shared/deepEqual'
import { T } from '../../theme/phTheme'
import { connectPartner, disconnectPartner } from './api'
import { useSection, type PartnerDraft } from './DspIntegrationLayout'
import { PATHS } from './DspList'
import { SubPageHeader } from './SubPageHeader'

const STATUS = {
  connected: { label: 'Connected', colour: T.success, icon: 'check_circle' },
  draft: { label: 'Not connected', colour: T.micro, icon: 'radio_button_unchecked' },
  error: { label: 'Connection error', colour: T.error, icon: 'error' },
} as const
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const MASK = '••••••••••••'

/* "Today, 07:12" for a successful sync; the DSP's own reason otherwise. */
export function formatSync(lastSync: string | null | undefined, now = new Date()) {
  if (!lastSync) return null
  const t = new Date(lastSync)
  if (!/^\d{4}-\d\d-\d\dT/.test(lastSync) || Number.isNaN(t.getTime())) return lastSync
  const time = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return t.toDateString() === now.toDateString() ? `Today, ${time}` : `${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`
}

export function DspPage({ draftKey, partner }: { draftKey: string; partner: Partner | null }) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { draft, saved, update } = useSection()
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const d = draft.partners[draftKey]
  const before = saved.partners[draftKey]
  const def = providerDef(d.provider)!
  const set = (fn: (x: PartnerDraft) => PartnerDraft) => update('partners', (ps) => ({ ...ps, [draftKey]: fn(ps[draftKey]) }))
  const setCred = (k: string, v: string) => set((x) => ({ ...x, credentials: { ...x.credentials, [k]: v } }))

  const status = partner?.status ?? 'draft'
  const secretSet = (k: string) => !!(partner?.credentials as Record<string, unknown> | undefined)?.[k]
  const missing = def.fields.filter((f) => (f.secret ? !d.credentials[f.key] && !secretSet(f.key) : !d.credentials[f.key]?.trim())).map((f) => f.label)
  const bidderMissing = [!d.bidderEndpoint.trim() && 'Bidder endpoint', !d.seatIds.trim() && 'Seat IDs'].filter(Boolean) as string[]
  const credsUnsaved = d.isNew || !deepEqual(d.credentials, before?.credentials)
  const canGoLive = status === 'connected' && bidderMissing.length === 0

  const run = async (kind: 'connect' | 'disconnect') => {
    if (!partner) return
    setBusy(kind)
    try {
      await (kind === 'connect' ? connectPartner(partner.id) : disconnectPartner(partner.id))
      await Promise.all(['partners', 'advertiser-settings'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    } catch (e) {
      message.error(e instanceof ApiRequestError ? e.message : 'Could not reach the API.')
    } finally {
      setBusy(null)
    }
  }

  /* Issues at the top (spec §7): status stays on the page. */
  const issues = [
    status === 'error' && { tone: 'error' as const, icon: 'error', text: <><b>Connection error:</b> {partner?.lastSync || 'the last connection test failed'}. Re-enter the credentials below and re-test the connection.</> },
    missing.length > 0 && { tone: 'error' as const, icon: 'error', text: <><b>Missing credentials:</b> {missing.join(', ')}.</> },
    bidderMissing.length > 0 && { tone: 'warning' as const, icon: 'warning', text: <><b>Cannot receive bids yet:</b> missing {bidderMissing.join(', ')}.</> },
  ].filter(Boolean) as { tone: 'error' | 'warning'; icon: string; text: React.ReactNode }[]

  const connectDisabledReason = missing.length ? `Missing: ${missing.join(', ')}` : credsUnsaved ? 'Save changes first' : undefined

  return (
    <>
      <SubPageHeader
        icon={def.icon}
        iconColour={def.colour}
        title={partner?.name ?? def.label}
        sub={<>{def.sub}{formatSync(partner?.lastSync) && <> · {formatSync(partner?.lastSync)}</>}</>}
        right={<StatusPill colour={STATUS[status].colour} icon={STATUS[status].icon}>{STATUS[status].label}</StatusPill>}
      />

      <div className="mt-4 flex flex-col gap-2" aria-label="Issues">
        {issues.length ? issues.map((x, i) => <Callout key={i} tone={x.tone} icon={x.icon}>{x.text}</Callout>) : (
          <Callout tone="success" icon="check_circle">No issues — {d.mode === 'live' ? 'live and receiving bid requests.' : 'ready to receive bid requests in Test mode.'}</Callout>
        )}
      </div>

      <SectionLabel><WithTip tip="Test: the DSP receives bid requests during its certification period, with no real spend. Live: winning bids play and are billed. Live is available once the DSP is connected and its bidder integration is complete.">Mode</WithTip></SectionLabel>
      <Segmented
        aria-label="Mode"
        value={d.mode}
        onChange={(v) => set((x) => ({ ...x, mode: v as 'test' | 'live' }))}
        options={[
          { value: 'test', label: <span className="inline-flex items-center gap-1.5"><Icon name="science" size={16} />Test</span> },
          { value: 'live', disabled: !canGoLive && d.mode !== 'live', label: <Tooltip title={canGoLive ? undefined : 'Connect and complete the bidder integration first'}><span className="inline-flex items-center gap-1.5"><Icon name="bolt" size={16} />Live</span></Tooltip> },
        ]}
      />

      <SectionLabel><WithTip tip={def.blurb}>Connection credentials</WithTip></SectionLabel>
      <div className="mb-3 grid grid-cols-2 gap-3.5">
        {def.fields.map((f) => (
          <Field key={f.key} label={f.label} required tip={f.hint} htmlFor={`cred-${f.key}`}>
            {f.options ? (
              <Select id={`cred-${f.key}`} className="w-full" value={d.credentials[f.key] || undefined} onChange={(v) => setCred(f.key, v)} options={f.options.map((o) => ({ value: o, label: o }))} />
            ) : f.secret ? (
              /* Secrets are masked, never shown in full (defect fix 2). */
              <Input.Password id={`cred-${f.key}`} value={d.credentials[f.key]} placeholder={secretSet(f.key) ? MASK : f.placeholder} autoComplete="off" style={{ fontFamily: MONO }} onChange={(e) => setCred(f.key, e.target.value)} />
            ) : (
              <Input id={`cred-${f.key}`} value={d.credentials[f.key]} placeholder={f.placeholder} onChange={(e) => setCred(f.key, e.target.value)} />
            )}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip title={connectDisabledReason}>
          <Button type="primary" icon={<Icon name="link" size={16} />} disabled={!partner || !!connectDisabledReason} loading={busy === 'connect'} onClick={() => run('connect')}>
            {status === 'connected' ? 'Re-test connection' : 'Connect'}
          </Button>
        </Tooltip>
        {partner && status !== 'draft' && (
          <Button icon={<Icon name="link_off" size={16} />} loading={busy === 'disconnect'} onClick={() => run('disconnect')}>Disconnect</Button>
        )}
      </div>

      <SectionLabel><WithTip tip="Where we send OpenRTB bid requests for this DSP, and the seats its bids come from. QPS and timeout use platform defaults.">Bidder integration</WithTip></SectionLabel>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Bidder endpoint" required tip="Where we send the bid request." htmlFor="bidderEndpoint">
          <Input id="bidderEndpoint" value={d.bidderEndpoint} placeholder="https://…/openrtb2/bid" onChange={(e) => set((x) => ({ ...x, bidderEndpoint: e.target.value }))} />
        </Field>
        <Field label="Seat IDs" required tip="What the advertiser blocklist is matched against on the bid response." htmlFor="seatIds">
          <Input id="seatIds" value={d.seatIds} placeholder="Comma separated" onChange={(e) => set((x) => ({ ...x, seatIds: e.target.value }))} />
        </Field>
      </div>

      <SectionLabel><WithTip tip="The blacklist always applies and no position can opt out of it. Unlinking copies the company lists here; relinking discards this DSP's own lists.">Advertiser whitelist / blacklist</WithTip></SectionLabel>
      {d.listsLinked ? (
        <Callout tone="info" icon="link"
          action={<Button color="primary" variant="outlined" size="small" icon={<Icon name="link_off" size={15} />}
            onClick={() => set((x) => ({ ...x, listsLinked: false, advertiserWhitelist: [...draft.settings.advertiserWhitelist], advertiserBlacklist: [...draft.settings.advertiserBlacklist] }))}>Unlink and edit</Button>}>
          <b>Centrally managed.</b> This DSP uses the company lists.{' '}
          <a onClick={() => navigate(PATHS.advertiserSettings)} style={{ color: T.primary, textDecoration: 'underline', cursor: 'pointer' }}>View lists in Advertiser settings</a>
        </Callout>
      ) : (
        <>
          <Callout tone="warning" icon="link_off" className="mb-3"
            action={<Button size="small" icon={<Icon name="link" size={15} />} onClick={() => set((x) => ({ ...x, listsLinked: true, advertiserWhitelist: [], advertiserBlacklist: [] }))}>Relink to company lists</Button>}>
            <b>Unlinked — this DSP has its own lists.</b> Company changes no longer reach it; relinking discards these.
          </Callout>
          <div className="grid grid-cols-2 gap-3.5">
            {(['advertiserWhitelist', 'advertiserBlacklist'] as const).map((k) => {
              const other = k === 'advertiserWhitelist' ? 'advertiserBlacklist' : 'advertiserWhitelist'
              const white = k === 'advertiserWhitelist'
              return (
                <ListEditor
                  key={k}
                  label={white ? 'Whitelist — only these may win' : 'Blacklist — these may never win'}
                  tone={white ? T.success : T.error}
                  icon={white ? 'verified' : 'block'}
                  items={d[k]}
                  suggestions={(partner?.seats ?? []).map((s) => s.name)}
                  onAdd={(n) => set((x) => { const r = addExclusive({ add: x[k], other: x[other] }, n); return { ...x, [k]: r.add, [other]: r.other } })}
                  onRemove={(n) => set((x) => ({ ...x, [k]: x[k].filter((y) => y !== n) }))}
                  empty={white ? 'Empty — a position set to whitelist-only would never fill.' : 'Empty — nothing is blocked on this DSP.'}
                />
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
