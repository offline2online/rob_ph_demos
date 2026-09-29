/* The ONLY seam between the approval module and the real campaigns.
   Engineering writes one implementation of this against the existing
   campaign service; nothing else in the module changes. See
   docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md. */
import type { Canvas, Creative } from '../types'

export interface CampaignRef {
  campaignId: string
  name: string
  /* hq campaigns skip approval (spec §8). */
  source: 'hq' | 'api' | 'dsp'
  advertiserId: string | null
  advertiserName: string | null
  partnerId: string | null
  partnerName: string | null
  activation: { enabled: boolean }
  /* Changes whenever the campaign's creative changes; approval is per version. */
  assetVersion: string
  /* Human-readable summary of the targeting rules, for the review panel. */
  targetingSummary: string
  /* The baseline creative and the target display type's canvas, for the review panel. */
  creative: Creative | null
  canvas: Canvas | null
  /* Every asset of the current version, one per role ("default" or a
     targeted version id), with its content hash when the adapter has one —
     what safe reuse (spec §3, Q40) compares. Omitted: nothing is ever
     reused, the safe default. */
  assets?: { assetId: string; contentHash?: string }[]
}

export interface CampaignFilter { sources?: CampaignRef['source'][]; ids?: string[] }

export interface CampaignSource {
  getCampaign(id: string): CampaignRef | null | Promise<CampaignRef | null>
  listCampaigns(filter?: CampaignFilter): CampaignRef[] | Promise<CampaignRef[]>
  setActivation(id: string, enabled: boolean): CampaignRef | null | Promise<CampaignRef | null>
  /* Called with a campaign id whenever it changes; returns an unsubscribe. */
  onCampaignChanged(listener: (id: string) => void): () => void
  /* Q38 (Rob, 29 Sep 2026): throw away every asset change made after
     `assetVersion` (a rejected edit), so the campaign's current version is
     that one again and the next edit builds on it, not on the rejected one. */
  discardEditsAfter(id: string, assetVersion: string): void | Promise<void>
}
