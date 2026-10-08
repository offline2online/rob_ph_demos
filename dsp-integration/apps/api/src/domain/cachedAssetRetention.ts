/* Pre-cache retention (Rob, 8 Oct 2026): how long PH Core's PWA player may keep
   a pre-cached, approved creative. Company-wide, whole hours, default 48 (as
   Broadsign Air's pre-cache horizon). It is an upper bound, not a guarantee:
   rejection evicts at once and the player's disk cap / LRU eviction still apply.
   The exchange only stores and publishes the value; the player enforces it. */
export const DEFAULT_CACHED_ASSET_RETENTION_HOURS = 48

export const cachedAssetRetentionOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1
