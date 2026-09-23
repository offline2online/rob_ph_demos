/* Shared API types, generated from docs/dsp-integration/api/openapi.yaml
   (`npm run gen:types`). Never edit openapi.d.ts by hand. */
import type { components, paths } from './openapi'

export type { components, paths }
type S = components['schemas']

export type ApiError = S['Error']
export type DisplayType = S['DisplayType']
export type DisplayTypeExtensions = S['DisplayTypeExtensions']
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
export type AssignedTo = S['AssignedTo']
export type BuyersList = S['BuyersList']
export type LockedWin = S['LockedWin']
export type InvitedBuyer = S['InvitedBuyer']
export type IdentifierType = InvitedBuyer['identifierType']
export type DspAdvertisers = S['DspAdvertisers']
export type BookingSchedule = S['BookingSchedule']
export type Advertiser = S['Advertiser']
export type AdvertiserSetting = S['AdvertiserSetting']
export type Exchange = S['Exchange']
export type ExchangeInput = S['ExchangeInput']
export type SharedVariable = S['SharedVariable']
export type TargetingAttribute = S['TargetingAttribute']
export type VariableAccess = S['VariableAccess']
export type Campaign = S['Campaign']
export type CampaignBrief = S['CampaignBrief']
export type Approval = S['Approval']
export type ApprovalStatus = S['ApprovalStatus']

export type Session = paths['/admin/v1/session']['get']['responses']['200']['content']['application/json']
export type Role = Session['role']
export * from './catalog'
export * from './analyticsEvent'
