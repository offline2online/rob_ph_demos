/* Which hosted build is running (src/demo/staticApi.ts decides at start-up):
   the live hosted API, or — when it can't be reached — the read-only
   snapshot. Components that behave differently in the snapshot (the booking
   schedule's fixed range) ask here at render time. */
export const demoMode = { snapshot: false }
export const isSnapshotDemo = () => import.meta.env.VITE_DEMO === '1' && demoMode.snapshot
