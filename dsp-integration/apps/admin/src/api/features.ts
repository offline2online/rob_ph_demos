/* Whether the retailer has DSP integration switched on (Exchange settings,
   Rob 24 Sep 2026). Readable by marketing users too, unlike Exchange
   settings, because it decides what the navigation shows everyone. Saving
   Exchange settings invalidates it, so the nav follows at once. */
import { useQuery } from '@tanstack/react-query'
import { Q } from './queries'

export const useFeatures = (enabled = true) =>
  useQuery({ ...Q.features, enabled })
