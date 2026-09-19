/* DSP Integration (spec §7, "Page layout"): the list of company pages and
   DSPs beside one full-width page. Every page in the section edits one
   draft; Save changes / Cancel apply to all of it, and leaving a page with
   unsaved changes asks first (prototype PartnersView). */
import { useQueryClient } from '@tanstack/react-query'
import { App, Spin } from 'antd'
import { providerDef, type AdvertiserSettings, type AdvertiserSettingsInput, type ExchangeInput, type Partner, type Provider, type SharedVariable, type VariableAccess } from '@ph-dsp/types'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../../api/client'
import { ListPageLayout } from '../../shared/ListPageLayout'
import { SaveBar } from '../../shared/SaveBar'
import { useReportDirty } from '../../shared/UnsavedChanges'
import { deepEqual } from '../../shared/deepEqual'
import { useDraft } from '../../shared/useDraft'
import { addPartner, saveAdvertiserSettings, saveExchange, savePartner, saveVariableAccess, useAdvertiserSettings, useExchange, usePartners, useTargetingVariables } from './api'
import { DspList, PATHS } from './DspList'

/* The section's editable state. Later packages add their slices here. */
export interface SectionDraft {
  exchange: ExchangeInput
  settings: AdvertiserSettingsInput
  access: Record<string, VariableAccess>
  /* Keyed by partner id, or `new:<provider>` for a DSP added but not yet saved. */
  partners: Record<string, PartnerDraft>
}

/* A DSP page's editable fields. Secret credentials start empty: typing a
   value replaces the saved one on Save changes; leaving it empty keeps it. */
export interface PartnerDraft {
  provider: Provider
  isNew: boolean
  credentials: Record<string, string>
  bidderEndpoint: string
  seatIds: string
  mode: 'test' | 'live'
  listsLinked: boolean
  advertiserWhitelist: string[]
  advertiserBlacklist: string[]
}
export const newPartnerKey = (provider: string) => `new:${provider}`

export function partnerDraft(p: Partner): PartnerDraft {
  const fields = providerDef(p.provider)?.fields ?? []
  return {
    provider: p.provider, isNew: false,
    credentials: Object.fromEntries(fields.map((f) => [f.key, f.secret ? '' : String((p.credentials ?? {})[f.key] ?? '')])),
    bidderEndpoint: p.bidder?.bidderEndpoint ?? '', seatIds: (p.bidder?.seatIds ?? []).join(', '),
    mode: p.mode, listsLinked: p.listsLinked, advertiserWhitelist: p.advertiserWhitelist ?? [], advertiserBlacklist: p.advertiserBlacklist ?? [],
  }
}
export const blankPartnerDraft = (provider: Provider): PartnerDraft => ({
  provider, isNew: true,
  credentials: Object.fromEntries((providerDef(provider)?.fields ?? []).map((f) => [f.key, ''])),
  bidderEndpoint: '', seatIds: '', mode: 'test', listsLinked: true, advertiserWhitelist: [], advertiserBlacklist: [],
})

/* The PUT body for a DSP page (API.md: whole-page save; secrets write-only). */
export function partnerInput(d: PartnerDraft, before: PartnerDraft | undefined) {
  const fields = providerDef(d.provider)?.fields ?? []
  const credentials = Object.fromEntries(
    fields.filter((f) => (f.secret ? d.credentials[f.key] !== '' : d.isNew || d.credentials[f.key] !== before?.credentials[f.key])).map((f) => [f.key, d.credentials[f.key]]),
  )
  return {
    credentials,
    bidder: { bidderEndpoint: d.bidderEndpoint.trim(), seatIds: d.seatIds.split(',').map((x) => x.trim()).filter(Boolean) },
    mode: d.mode,
    listsLinked: d.listsLinked,
    ...(d.listsLinked ? {} : { advertiserWhitelist: d.advertiserWhitelist, advertiserBlacklist: d.advertiserBlacklist }),
  }
}

interface Section {
  draft: SectionDraft
  saved: SectionDraft
  update: <K extends keyof SectionDraft>(key: K, fn: (v: SectionDraft[K]) => SectionDraft[K]) => void
  partners: Partner[]
  settings: AdvertiserSettings
  variables: SharedVariable[]
  published: boolean
  /* Hide the save bar (the prototype hides it on the Add DSP card). */
  setShowSaveBar: (v: boolean) => void
}
const SectionContext = createContext<Section | null>(null)
export const useSection = () => {
  const s = useContext(SectionContext)
  if (!s) throw new Error('useSection outside DSP Integration')
  return s
}

const settingsInput = ({ whereTheseApply: _w, ...rest }: AdvertiserSettings): AdvertiserSettingsInput => rest
const exchangeInput = ({ organisation, domain, sellerId, contactEmail }: ExchangeInput): ExchangeInput => ({ organisation, domain, sellerId, contactEmail })

function Section({ partners, settings, exchange, published, variables }: { partners: Partner[]; settings: AdvertiserSettings; exchange: ExchangeInput; published: boolean; variables: SharedVariable[] }) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const saved = useMemo<SectionDraft>(
    () => ({
      exchange, settings: settingsInput(settings), access: Object.fromEntries(variables.map((v) => [v.key, v.access])),
      partners: Object.fromEntries(partners.map((p) => [p.id, partnerDraft(p)])),
    }),
    [exchange, settings, variables, partners],
  )
  const navigate = useNavigate()
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  useReportDirty(dirty)
  const [saving, setSaving] = useState(false)
  const [showSaveBar, setShowSaveBar] = useState(true)
  /* A newly added DSP moves to its own page once the saved data has replaced the draft. */
  const [goTo, setGoTo] = useState<string | null>(null)
  useEffect(() => {
    if (goTo && !dirty) {
      navigate(goTo, { replace: true })
      setGoTo(null)
    }
  }, [goTo, dirty, navigate])
  if (!draft) return null

  const update: Section['update'] = (key, fn) => setDraft((cur) => (cur ? { ...cur, [key]: fn(cur[key]) } : cur))

  const onSave = async () => {
    setSaving(true)
    try {
      if (!deepEqual(draft.exchange, saved.exchange)) await saveExchange(draft.exchange)
      if (!deepEqual(draft.settings, saved.settings)) await saveAdvertiserSettings(draft.settings)
      if (!deepEqual(draft.access, saved.access)) await saveVariableAccess(draft.access)
      let created: string | undefined
      for (const [key, d] of Object.entries(draft.partners)) {
        if (deepEqual(d, saved.partners[key])) continue
        const id = d.isNew ? (await addPartner(d.provider)).id : key
        if (d.isNew) created = id
        await savePartner(id, partnerInput(d, saved.partners[key]))
      }
      commitNext()
      if (created) setGoTo(PATHS.partner(created))
      await Promise.all(['exchange', 'advertiser-settings', 'available-inventory', 'targeting-variables', 'partners'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    } catch (e) {
      message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionContext.Provider value={{ draft, saved, update, partners, settings, variables, published, setShowSaveBar }}>
      <ListPageLayout list={<DspList />}>
        <Outlet />
        {showSaveBar && <SaveBar dirty={dirty} saving={saving} onSave={onSave} onCancel={reset} />}
      </ListPageLayout>
    </SectionContext.Provider>
  )
}

export function DspIntegrationLayout() {
  const { pathname } = useLocation()
  const partners = usePartners(true)
  const settings = useAdvertiserSettings(true)
  const exchange = useExchange()
  const variables = useTargetingVariables()
  const ex = useMemo(() => (exchange.data ? exchangeInput(exchange.data) : undefined), [exchange.data])
  if (!partners.data || !settings.data || !ex || !exchange.data || !variables.data) return <Spin />
  /* Keyed by page: leaving a page (after confirming) starts from the saved values. */
  return <Section key={pathname} partners={partners.data} settings={settings.data} exchange={ex} published={exchange.data.published} variables={variables.data} />
}
