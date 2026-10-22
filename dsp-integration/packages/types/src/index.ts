/* Shared API types, generated from docs/dsp-integration/api/openapi.yaml
   (`npm run gen:types`). Never edit openapi.d.ts by hand. */
import type { components, paths } from './openapi'

export type { components, paths }
type S = components['schemas']

export type ApiError = S['Error']
export type DisplayType = S['DisplayType']
export type DisplayTypeExtensions = S['DisplayTypeExtensions']
export type StoreZone = NonNullable<DisplayTypeExtensions['storeZone']>
/* The IAB / IAB Europe in-store retail media zones, in the standard's order. */
export const STORE_ZONES: { value: StoreZone; label: string }[] = [
  { value: 'exterior', label: 'Exterior to store' },
  { value: 'entrance', label: 'Entrance and out of category' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'aisles', label: 'In aisles' },
  { value: 'other', label: 'Other' },
]
/* The label for a store zone value (null/undefined: not defined). */
export const storeZoneLabel = (z: StoreZone | null | undefined): string | null => STORE_ZONES.find((s) => s.value === z)?.label ?? null
export type OperatingHours = NonNullable<DisplayTypeExtensions['operatingHours']>
export type OperatingMode = OperatingHours['mode']
/* A display type's operating hours options, in the order the form lists them. */
export const OPERATING_MODES: { value: OperatingMode; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: 'store', label: 'Store hours' },
  { value: 'custom', label: 'Custom' },
]
/* The value a store zone starts operating hours at: Exterior and Entrance are 24 hours, every other zone (and none) follows the store. */
export const zoneOperatingMode = (z: StoreZone | null | undefined): OperatingMode => (z === 'exterior' || z === 'entrance' ? '24h' : 'store')
/* What a display type runs on: its saved setting, else its zone's value. */
export const operatingHoursOf = (ext: Pick<DisplayTypeExtensions, 'storeZone' | 'operatingHours'> | null | undefined): OperatingHours => ext?.operatingHours ?? { mode: zoneOperatingMode(ext?.storeZone) }
export type Slot = DisplayTypeExtensions['slots'][number]
export type SlotOwner = Slot['owner']
export type Venue = NonNullable<DisplayTypeExtensions['venue']>
export type Playlist = S['Playlist']
export type DeleteCheck = S['DeleteCheck']
export type Partner = S['Partner']
export type PartnerInput = S['PartnerInput']
export type Provider = S['Provider']
export type AdvertiserSettings = S['AdvertiserSettings']
export type AdvertiserSettingsInput = S['AdvertiserSettingsInput']
export type AvailableInventoryRow = S['AvailableInventoryRow']
export type PlaylistDisplayType = S['PlaylistDisplayType']
export type AssignedTo = S['AssignedTo']
export type BuyersList = S['BuyersList']
export type BuyersListDealType = BuyersList['dealType']
export type TimeZoneMode = NonNullable<BuyersList['timeZoneMode']>
/* A Direct advertiser deal (22 Oct 2026) is a Programmatic guaranteed deal with a direct advertiser as its single buyer: it takes every guaranteed rule (one buyer, delivery term, fixed CPM or term total, derived committed plays). Its buyer is stored as {partnerId: DIRECT_PARTNER_ID, seatId: <advertiserId>}; there is no DSP. */
export const DIRECT_PARTNER_ID = 'direct'
/* Two reserving deals (Programmatic guaranteed or Direct advertiser) whose flights overlap on one slot (Rob, 22 Oct 2026). */
export type ReservingConflict = S['ReservingConflict']
export const isGuaranteedLike = (d: BuyersListDealType | undefined): boolean => d === 'guaranteed' || d === 'direct'
export type BuyerAcceptance = S['BuyerAcceptance']
export type TermChange = S['TermChange']
export type TermCheck = S['TermCheck']
export type TermVersion = S['TermVersion']
export type LockedWin = S['LockedWin']
export type InvitedBuyer = S['InvitedBuyer']
export type Condition = S['Condition']
export type DspAdvertisers = S['DspAdvertisers']
export type BookingSchedule = S['BookingSchedule']
export type BookingCapacity = S['BookingCapacity']
export type Advertiser = S['Advertiser']
export type AdvertiserSetting = S['AdvertiserSetting']
export type Exchange = S['Exchange']
export type ExchangeInput = S['ExchangeInput']
export type Features = S['Features']
export type SharedVariable = S['SharedVariable']
export type TargetingAttribute = S['TargetingAttribute']
export type VariableAccess = S['VariableAccess']
export type VariableValues = Pick<SharedVariable, 'values' | 'freeText'>
export type Campaign = S['Campaign']
export type CampaignBrief = S['CampaignBrief']
export type Approval = S['Approval']
export type ApprovalStatus = S['ApprovalStatus']

export type Session = paths['/admin/v1/session']['get']['responses']['200']['content']['application/json']
export type Role = Session['role']
export * from './catalog'
export * from './iabTaxonomy'
export * from './analyticsEvent'
