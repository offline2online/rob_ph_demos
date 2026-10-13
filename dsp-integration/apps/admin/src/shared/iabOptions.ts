/* IAB category pickers (Advertiser settings lists, buyers-list invited categories):
   one alphabetical option list and one search, so every picker behaves the same.
   Alphabetical by full name, so a tier 1 is followed by its own subcategories
   ("Food & Drink", then "Food & Drink › Vegan"). */
import { IAB_TAXONOMY } from '@ph-dsp/types'

export interface IabOption { value: string; label: string }

export const IAB_OPTIONS_SORTED: IabOption[] = [...IAB_TAXONOMY]
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  .map((c) => ({ value: c.name, label: `${c.name} (${c.code})` }))

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/* Every word typed must appear somewhere in the category — any word of its name, its parent, or its code,
   in any order and ignoring case and punctuation ("vegan food" finds "Food & Drink › Vegan"). */
export const iabFilterOption = (input: string, option?: { label?: unknown }): boolean => {
  const text = norm(String(option?.label ?? ''))
  return norm(input).split(' ').filter(Boolean).every((w) => text.includes(w))
}
