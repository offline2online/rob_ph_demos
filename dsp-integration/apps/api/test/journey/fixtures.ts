/* The Run 6 creative package, generated (ticket 35PG44MjyR7S27iAMGY6):
   run6-package.zip was never checked in, so the package is built here from
   the Run 6 Runbook's version table with the same synthetic media the asset
   checks' unit tests use (test/media.ts). Files are written to
   test/journey/fixtures/ on demand and git-ignored; manifest.json is
   committed so the body and the expected results are reviewable. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mp4, png } from '../media'

export const CANVAS = { width: 1920, height: 1080 }

export interface Version { id: string; file: string; bytes: Buffer; targeting: null | { priority: number; pricingType: 'localised' | 'personalised'; rules: unknown[][] } }

export function versions(): Version[] {
  const rule = (variable: string, op: string, value: string) => [[{ source: 'store', variable, op, values: [value] }]]
  return [
    { id: 'default', file: 'default/Pharma-Brand-Default.mp4', bytes: mp4(1280, 720, 10, 4096), targeting: null },
    { id: 'personalised-cv-female', file: 'personalised/Pharma-Brand-CV-Female.png', bytes: png(1365, 768, 2048), targeting: { priority: 1, pricingType: 'personalised', rules: rule('store.cv_gender', 'equal', 'Female') } },
    { id: 'personalised-cv-male', file: 'personalised/Pharma-Brand-CV-Male.mp4', bytes: mp4(1280, 720, 10, 4096), targeting: { priority: 2, pricingType: 'personalised', rules: rule('store.cv_gender', 'equal', 'Male') } },
    { id: 'localised-cold-day', file: 'localised/Pharma-Brand-Cold-Day.mp4', bytes: mp4(1280, 720, 10, 4096), targeting: { priority: 3, pricingType: 'localised', rules: rule('store.variable_segments', 'match_exactly', 'Cold Day') } },
    { id: 'localised-hot-day', file: 'localised/Pharma-Brand-Hot-Day.mp4', bytes: mp4(1280, 720, 10, 4096), targeting: { priority: 4, pricingType: 'localised', rules: rule('store.variable_segments', 'match_exactly', 'Hot Day') } },
  ]
}

/* The portrait asset that must be refused on aspect_ratio only. */
export const BAD = { file: 'bad/Bad-Wrong-Canvas-1080x1920.png', bytes: png(1080, 1920, 1024) }

export function campaignBody(displayTypeId: string, advertiserId: string, slot = 1) {
  return {
    advertiserId, name: 'Run 6 — Pharma Brand (Swisse)', displayTypeId, slot,
    default: { pricingType: 'localised' },
    targeted: versions().filter((v) => v.targeting).map((v) => ({ id: v.id, priority: v.targeting!.priority, pricingType: v.targeting!.pricingType, rules: v.targeting!.rules })),
  }
}

/* Writes the files and manifest.json, as run6-package.zip's layout. */
export function writePackage(dir: string) {
  for (const v of [...versions(), { id: 'bad', ...BAD }]) {
    mkdirSync(join(dir, v.file.split('/')[0]), { recursive: true })
    writeFileSync(join(dir, v.file), v.bytes)
  }
  const manifest = {
    generated: 'test/journey/fixtures.ts — synthetic media, Run 6 Runbook version table',
    canvas: CANVAS,
    campaign: { body: campaignBody('<displayTypeId from the handover>', 'swisse') },
    versions: versions().map((v) => ({ id: v.id, file: v.file })),
    /* The ±5% aspect-ratio rule (PR 329039a): ratio within 5% of the canvas and
       each side at least 50% of it. 1280×720 and 1365×768 pass; 1080×1920 fails. */
    expectedUpload: { ...Object.fromEntries(versions().map((v) => [v.id, 'accepted'])), bad: 'refused: aspect_ratio' },
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}
