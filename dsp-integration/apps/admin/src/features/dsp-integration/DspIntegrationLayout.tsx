/* DSP Integration (spec §7, "Page layout"): the list of company pages and
   DSPs beside one full-width page. Every page in the section edits one
   draft; Save changes / Cancel apply to all of it, and leaving a page with
   unsaved changes asks first (prototype PartnersView). */
import { useQueryClient } from '@tanstack/react-query'
import { App, Spin } from 'antd'
import type { AdvertiserSettings, AdvertiserSettingsInput, ExchangeInput, Partner } from '@ph-dsp/types'
import { createContext, useContext, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ApiRequestError } from '../../api/client'
import { ListPageLayout } from '../../shared/ListPageLayout'
import { SaveBar } from '../../shared/SaveBar'
import { useReportDirty } from '../../shared/UnsavedChanges'
import { deepEqual } from '../../shared/deepEqual'
import { useDraft } from '../../shared/useDraft'
import { saveAdvertiserSettings, saveExchange, useAdvertiserSettings, useExchange, usePartners } from './api'
import { DspList } from './DspList'

/* The section's editable state. Later packages add their slices here. */
export interface SectionDraft {
  exchange: ExchangeInput
  settings: AdvertiserSettingsInput
}

interface Section {
  draft: SectionDraft
  saved: SectionDraft
  update: <K extends keyof SectionDraft>(key: K, fn: (v: SectionDraft[K]) => SectionDraft[K]) => void
  partners: Partner[]
  settings: AdvertiserSettings
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

function Section({ partners, settings, exchange, published }: { partners: Partner[]; settings: AdvertiserSettings; exchange: ExchangeInput; published: boolean }) {
  const { message } = App.useApp()
  const qc = useQueryClient()
  const saved = useMemo<SectionDraft>(() => ({ exchange, settings: settingsInput(settings) }), [exchange, settings])
  const { draft, setDraft, dirty, reset, commitNext } = useDraft(saved)
  useReportDirty(dirty)
  const [saving, setSaving] = useState(false)
  const [showSaveBar, setShowSaveBar] = useState(true)
  if (!draft) return null

  const update: Section['update'] = (key, fn) => setDraft((cur) => (cur ? { ...cur, [key]: fn(cur[key]) } : cur))

  const onSave = async () => {
    setSaving(true)
    try {
      if (!deepEqual(draft.exchange, saved.exchange)) await saveExchange(draft.exchange)
      if (!deepEqual(draft.settings, saved.settings)) await saveAdvertiserSettings(draft.settings)
      commitNext()
      await Promise.all(['exchange', 'advertiser-settings', 'available-inventory'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    } catch (e) {
      message.error(e instanceof ApiRequestError ? [e.message, ...(e.body?.error.details ?? []).map((d) => d.reason)].join(' ') : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionContext.Provider value={{ draft, saved, update, partners, settings, published, setShowSaveBar }}>
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
  const ex = useMemo(() => (exchange.data ? exchangeInput(exchange.data) : undefined), [exchange.data])
  if (!partners.data || !settings.data || !ex || !exchange.data) return <Spin />
  /* Keyed by page: leaving a page (after confirming) starts from the saved values. */
  return <Section key={pathname} partners={partners.data} settings={settings.data} exchange={ex} published={exchange.data.published} />
}
