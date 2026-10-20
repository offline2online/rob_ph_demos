/* Every admin page. Advertisers / Inventory and the booking schedule need
   DSP integration switched on, which the snapshot has. */
export const PAGES = [
  { id: 'display-types', route: '/display-types' },
  { id: 'playlists', route: '/playlists' },
  { id: 'advertisers-inventory', route: '/advertisers' },
  { id: 'advertiser-bookings', route: '/booking-schedule' },
  { id: 'campaign-detail', route: '/campaign-status/c_breakfast' },
  { id: 'dsp-exchange-settings', route: '/dsp-integration/exchange' },
  { id: 'dsp-advertiser-settings', route: '/dsp-integration/advertiser-settings' },
  { id: 'dsp-targeting-variables', route: '/dsp-integration/targeting-variables' },
  { id: 'dsp-change-history', route: '/dsp-integration/change-history' },
  { id: 'dsp-partner-google', route: '/dsp-integration/partners/p_google' },
  { id: 'dsp-partner-amazon', route: '/dsp-integration/partners/p_amazon' },
  { id: 'dsp-partner-ttd', route: '/dsp-integration/partners/p_ttd' },
]

