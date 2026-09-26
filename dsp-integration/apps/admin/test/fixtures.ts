/* API responses shaped like the seeded POC, for page tests. */
export const partners = { items: [
  { id: 'p_google', provider: 'google_dv360', name: 'Google DSP', status: 'connected', lastSync: 'Today, 07:12', mode: 'live', credentials: { partnerId: '884512', serviceAccountEmail: 'sa@x', privateKeyJson: { set: true } }, bidder: { bidderEndpoint: 'https://rtb.example/bid', seatIds: ['884512'] }, issues: [], seats: [{ id: 'g1', name: 'Nestlé' }, { id: 'g2', name: 'Swisse' }], listsLinked: true },
  { id: 'p_amazon', provider: 'amazon_dsp', name: 'Amazon Ads DSP', status: 'error', lastSync: 'Refresh token rejected — 3 days ago', mode: 'test', credentials: { region: 'Europe (EU)' }, bidder: {}, issues: [{ kind: 'connection_error', message: 'Refresh token rejected — 3 days ago' }], seats: [{ id: 'a1', name: "L'Oréal" }], listsLinked: false, advertiserWhitelist: ["L'Oréal"], advertiserBlacklist: ['Red Bull', 'Chemist Warehouse'] },
] }
export const advertiserSettings = {
  currency: 'AUD', floorCpm: 100, personalisedMultiplier: 1.5, interactiveCpe: 0.5,
  auctionOpensHours: 168, playWindowHours: 24, auctionCutoffTime: '18:00', pendingPlayWindowHours: null, pendingPlayWindowEffectiveFrom: null,
  advertiserWhitelist: ['Nestlé', 'Swisse', 'Arnott’s'], advertiserBlacklist: ['Red Bull', 'Monster Energy'], categoryWhitelist: ['Food & Drink', 'Health & Fitness'], categoryBlacklist: ['Finance'],
  whereTheseApply: [{ partnerId: 'p_google', name: 'Google DSP', adopting: true }, { partnerId: 'p_amazon', name: 'Amazon Ads DSP', adopting: false }],
}
export const exchange = { enabled: true, organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example', published: true, sellersJsonUrl: 'https://demoretail.example/sellers.json' }
export const variables = { items: [
  { key: 'store.hours', label: 'Store Open / Closed', group: 'localisation', exampleValues: 'Whether the store is open or closed at the time — e.g. Open, Closed', access: 'all' },
  { key: 'store.suburb', label: 'Suburb', group: 'localisation', exampleValues: 'e.g. Surry Hills, Parramatta', access: [] },
  { key: 'visitor.purchase_intent', label: 'Purchase Intent', group: 'personalisation', exampleValues: 'e.g. Browse, Replenish, Gift', access: ['p_google'] },
] }
export const session = { userId: 'u', name: 'HQ Admin (POC)', role: 'hq_admin' }

export const routes: Record<string, unknown> = {
  '/api/admin/v1/session': session,
  '/api/admin/v1/partners': partners,
  '/api/admin/v1/advertiser-settings': advertiserSettings,
  '/api/admin/v1/exchange': exchange,
  '/api/admin/v1/features': { dspIntegration: true },
  '/api/admin/v1/targeting-variables': variables,
  '/api/admin/v1/display-types': { items: [] },
  '/api/admin/v1/playlists': { items: [] },
}
export const fakeFetch = (overrides: Record<string, unknown> = {}) => async (url: string) =>
  new Response(JSON.stringify({ ...routes, ...overrides }[url.split('?')[0]] ?? {}), { status: 200 })
