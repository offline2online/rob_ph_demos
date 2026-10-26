/* Playback Strategy pills — components.md §5 (outlined, transparent, 24px,
   14px #333). One pill per targeting strategy the campaign uses, always in
   the order Localised, Personalised, Scheduled; a strategy with no rules is
   hidden, and no rules at all reads as a dash. Hovering a pill lists only
   that strategy's rules, one per line, with long lists cut to "+N more".
   "Personalised" is this project's name for what HQ Admin → Campaigns calls
   Targeted; that page keeps its own label. */
import { Tip } from './Tip'

export const MAX_TIP_RULES = 8

export interface PlaybackStrategyRules {
  localised?: string[]
  personalised?: string[]
  scheduled?: string[]
}

const STRATEGIES = [
  { key: 'localised', label: 'LOCALISED' },
  { key: 'personalised', label: 'PERSONALISED' },
  { key: 'scheduled', label: 'SCHEDULED' },
] as const

export const tipLines = (rules: string[], max = MAX_TIP_RULES): string[] =>
  rules.length > max ? [...rules.slice(0, max), `+${rules.length - max} more`] : rules

export function PlaybackStrategyPills({ rules }: { rules: PlaybackStrategyRules }) {
  const shown = STRATEGIES.filter((s) => rules[s.key]?.length)
  if (!shown.length) return <span style={{ color: '#6b7280' }}>—</span>
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="playback-strategy-pills">
      {shown.map((s) => (
        <Tip
          key={s.key}
          title={<div>{tipLines(rules[s.key]!).map((line, i) => <div key={i}>{line}</div>)}</div>}
        >
          <span
            tabIndex={0}
            data-pill={s.key}
            className="inline-flex h-6 items-center rounded-full border border-gray-300 px-4 whitespace-nowrap"
            style={{ fontSize: 14, color: '#333333', background: 'transparent' }}
          >
            {s.label}
          </span>
        </Tip>
      ))}
    </span>
  )
}
