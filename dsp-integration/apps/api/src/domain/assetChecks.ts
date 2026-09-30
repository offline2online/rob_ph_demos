/* Automated checks on upload (spec §3), run before a human sees anything.
   File checks run on each upload; default_present and targeting_permitted
   run on submit. A failed check returns the reasons to the advertiser and
   the file never reaches the review queue. */
import type { DisplayType } from '@ph-dsp/types'
import type { Config } from '../config'
import { type MediaInfo, isVideo } from './media'
import { slotDurationSec } from './slots'

export type CheckName = 'file_type' | 'file_size' | 'bitrate' | 'dimensions' | 'aspect_ratio' | 'duration' | 'default_present' | 'targeting_permitted' | 'dsp_audit' | 'previously_cleared'
/* assetId is the role a check ran against ('default' or a targeted version
   id) — set for every per-file check (ticket, 22 Sep: "make automated
   check results asset-scoped too"). Left unset for a campaign-level check
   (default_present, targeting_permitted) that isn't about one asset. */
/* advisory (Q40, 29 Sep 2026): recorded for the reviewer — a DSP's own
   creative audit (dsp_audit), an asset unchanged since a human cleared it
   (previously_cleared) — but never a gate: failed() ignores it, and a
   passed one approves nothing. */
export interface Check { name: CheckName; passed: boolean; detail?: string; assetId?: string; advisory?: boolean }

interface Size { width: number; height: number }
const MB = 1024 * 1024
const fmtMb = (n: number) => (n >= MB ? `${Math.round((n / MB) * 10) / 10} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/* The sizes a creative may target: the canvas, or one of its zones (spec §3). */
export function targetSizes(dt: DisplayType | null): Size[] {
  if (!dt) return []
  const canvas = dt.displayCanvasSize
  const mz = dt.multiZone as { enabled?: boolean; zones?: { width: number; height: number }[] }
  const zones = mz?.enabled ? (mz.zones ?? []).map((z) => ({ width: Math.round((canvas.width * z.width) / 100), height: Math.round((canvas.height * z.height) / 100) })) : []
  return [canvas, ...zones]
}

/* Shape, not pixels (30 Sep 2026): the player scales to fit, so a creative is
   right if its aspect ratio is within ±5% of the target's (a near miss plays
   with modest letterboxing) and it is at least half the target in each
   dimension (a smaller one would be upscaled into mush). Larger is fine —
   downscaling is clean. */
export const RATIO_TOLERANCE = 0.05
export const MIN_SCALE = 0.5
const sameRatio = (a: Size, b: Size) => Math.abs(a.width / a.height - b.width / b.height) / (b.width / b.height) <= RATIO_TOLERANCE
const meetsFloor = (a: Size, b: Size) => a.width >= b.width * MIN_SCALE && a.height >= b.height * MIN_SCALE
const floorOf = (s: Size) => `${Math.ceil(s.width * MIN_SCALE)}×${Math.ceil(s.height * MIN_SCALE)}`
const tag = (checks: Check[], assetId?: string): Check[] => (assetId ? checks.map((c) => ({ ...c, assetId })) : checks)

export function fileChecks(media: MediaInfo | null, sizeBytes: number, dt: DisplayType | null, limits: Config['assetLimits'], assetId?: string): Check[] {
  if (!media) {
    return tag([
      { name: 'file_type', passed: false, detail: 'Not a PNG, JPEG or MP4 file.' },
    ], assetId)
  }
  const video = isVideo(media.kind)
  const checks: Check[] = [{ name: 'file_type', passed: true, detail: media.mimeType }]

  const max = video ? limits.maxVideoBytes : limits.maxImageBytes
  checks.push({ name: 'file_size', passed: sizeBytes <= max, detail: `${fmtMb(sizeBytes)}; the limit is ${fmtMb(max)}.` })

  if (!video) checks.push({ name: 'bitrate', passed: true, detail: 'Not applicable to an image.' })
  else if (!media.durationSec) checks.push({ name: 'bitrate', passed: false, detail: 'The video has no readable duration.' })
  else {
    const kbps = Math.round((sizeBytes * 8) / 1000 / media.durationSec)
    checks.push({ name: 'bitrate', passed: kbps <= limits.maxBitrateKbps, detail: `${kbps} kbps; the limit is ${limits.maxBitrateKbps} kbps.` })
  }

  const sizes = targetSizes(dt)
  const size = media.width && media.height ? { width: media.width, height: media.height } : null
  if (!size) {
    checks.push({ name: 'dimensions', passed: false, detail: 'The file has no readable dimensions.' })
    checks.push({ name: 'aspect_ratio', passed: false, detail: 'The file has no readable dimensions.' })
  } else if (!sizes.length) {
    const d = `${size.width}×${size.height}; the campaign has no display type to check against.`
    checks.push({ name: 'dimensions', passed: true, detail: d })
    checks.push({ name: 'aspect_ratio', passed: true, detail: d })
  } else {
    const list = sizes.map((s) => `${s.width}×${s.height}`).join(' or ')
    const shaped = sizes.filter((s) => sameRatio(size, s))
    const pct = Math.round(RATIO_TOLERANCE * 100)
    checks.push({
      name: 'aspect_ratio',
      passed: shaped.length > 0,
      detail: shaped.length
        ? `${size.width}×${size.height} matches ${shaped.map((s) => `${s.width}×${s.height}`).join(' or ')} within ±${pct}%.`
        : `${size.width}×${size.height} is not within ±${pct}% of the shape of ${list}.`,
    })
    /* The floor is measured against the targets the shape matched; when none did, against all of them, so a wrong shape is reported once (as its ratio) unless the file is also too small. */
    const pool = shaped.length ? shaped : sizes
    const fits = pool.filter((s) => meetsFloor(size, s))
    const uniq = (xs: string[]) => [...new Set(xs)]
    checks.push({
      name: 'dimensions',
      passed: fits.length > 0,
      detail: fits.length
        ? `${size.width}×${size.height}; the minimum is ${floorOf(fits[0])}.`
        : `${size.width}×${size.height} is below the minimum of ${uniq(pool.map(floorOf)).join(' or ')} (half of ${uniq(pool.map((s) => `${s.width}×${s.height}`)).join(' or ')}).`,
    })
  }

  const slot = dt ? slotDurationSec(dt) : null
  if (!video) checks.push({ name: 'duration', passed: true, detail: 'Not applicable to an image.' })
  else if (!media.durationSec) checks.push({ name: 'duration', passed: false, detail: 'The video has no readable duration.' })
  else if (slot === null) checks.push({ name: 'duration', passed: true, detail: `${media.durationSec}s; the campaign has no slot duration to check against.` })
  else checks.push({ name: 'duration', passed: media.durationSec <= slot, detail: `${media.durationSec}s; the slot is ${slot}s.` })

  return tag(checks, assetId)
}

export const failed = (checks: Check[]) => checks.filter((c) => !c.passed && !c.advisory)
export const failureDetails = (checks: Check[]) => failed(checks).map((c) => ({ field: c.name, reason: c.detail ?? 'Failed.' }))
