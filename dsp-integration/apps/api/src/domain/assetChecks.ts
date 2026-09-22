/* Automated checks on upload (spec §3), run before a human sees anything.
   File checks run on each upload; default_present and targeting_permitted
   run on submit. A failed check returns the reasons to the advertiser and
   the file never reaches the review queue. */
import type { DisplayType } from '@ph-dsp/types'
import type { Config } from '../config'
import { type MediaInfo, isVideo } from './media'
import { slotDurationSec } from './slots'

export type CheckName = 'file_type' | 'file_size' | 'bitrate' | 'dimensions' | 'aspect_ratio' | 'duration' | 'default_present' | 'targeting_permitted'
/* assetId is the role a check ran against ('default' or a targeted version
   id) — set for every per-file check (ticket, 22 Sep: "make automated
   check results asset-scoped too"). Left unset for a campaign-level check
   (default_present, targeting_permitted) that isn't about one asset. */
export interface Check { name: CheckName; passed: boolean; detail?: string; assetId?: string }

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

const sameRatio = (a: Size, b: Size) => Math.abs(a.width / a.height - b.width / b.height) / (b.width / b.height) <= 0.01
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
    /* At least the target size (it is scaled down, never up), in the same shape. */
    const shaped = sizes.filter((s) => sameRatio(size, s))
    checks.push({ name: 'aspect_ratio', passed: shaped.length > 0, detail: `${size.width}×${size.height} for ${list}.` })
    const fits = shaped.some((s) => size.width >= s.width && size.height >= s.height)
    checks.push({ name: 'dimensions', passed: fits, detail: fits ? `${size.width}×${size.height} for ${list}.` : `${size.width}×${size.height} is smaller than ${list}.` })
  }

  const slot = dt ? slotDurationSec(dt) : null
  if (!video) checks.push({ name: 'duration', passed: true, detail: 'Not applicable to an image.' })
  else if (!media.durationSec) checks.push({ name: 'duration', passed: false, detail: 'The video has no readable duration.' })
  else if (slot === null) checks.push({ name: 'duration', passed: true, detail: `${media.durationSec}s; the campaign has no slot duration to check against.` })
  else checks.push({ name: 'duration', passed: media.durationSec <= slot, detail: `${media.durationSec}s; the slot is ${slot}s.` })

  return tag(checks, assetId)
}

export const failed = (checks: Check[]) => checks.filter((c) => !c.passed)
export const failureDetails = (checks: Check[]) => failed(checks).map((c) => ({ field: c.name, reason: c.detail ?? 'Failed.' }))
