/* Display Types tooltips (spec §1 "Tooltips" and "Help text"). Wording is
   the prototype's; explanations the prototype showed as page copy are
   tooltips here (decision 2). */
export const TIPS = {
  slotAssignment:
    "Headquarters: filled from eligible HQ campaigns by priority. Advertiser: sold through a DSP, open to RTB bidding by default, or reserved to one of that DSP's advertisers. Stores: store staff activate approved campaigns. Ownership decides who can fill the slot; playback itself is unchanged.",
  definePhantomZone:
    'The phantom zone sits outside campaign rotation, so anything placed in it survives every campaign transition. Defining it makes Enable QR Control available.',
  enabledFeatures:
    "Defaults inherited by every display of this type, including each feature's own settings. A display can override any of them on its Enabled Features tab.",
  enableZones: 'Each zone runs its own playlist, so each has its own rotation.',
} as const
