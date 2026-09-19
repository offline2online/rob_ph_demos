/* Display type list (list column): New display type, then one row per type
   with its touch point, name, canvas size and structure/feature badges. */
import { Button } from 'antd'
import { touchPointIcon, type DisplayType } from '@ph-dsp/types'
import { Icon } from '../../shared/Icon'
import { T } from '../../theme/phTheme'
import { STRUCTURE_MARKERS, enabledFeatures } from './model'

const Badge = ({ icon, title, tone }: { icon: string; title: string; tone: 'structure' | 'feature' }) => (
  <span title={title} aria-label={title} className="inline-flex h-5 w-5 items-center justify-center rounded"
    style={{ background: tone === 'structure' ? T.primaryTint : 'rgba(82,196,26,0.12)' }}>
    <Icon name={icon} size={13} style={{ color: tone === 'structure' ? T.primary : T.success }} />
  </span>
)

export function DisplayTypeList({ types, selectedId, onSelect, onNew }: { types: DisplayType[]; selectedId: string | undefined; onSelect: (id: string) => void; onNew: () => void }) {
  return (
    <>
      <Button type="primary" block className="mb-2.5" icon={<Icon name="add" size={16} />} onClick={onNew}>New display type</Button>
      <div className="overflow-hidden rounded-lg border" style={{ borderColor: T.borderSubtle }} role="listbox" aria-label="Display types">
        {types.map((t) => {
          const active = t.id === selectedId
          return (
            <div
              key={t.id}
              role="option"
              aria-selected={active}
              tabIndex={0}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(t.id)}
              className="cursor-pointer border-b px-3 py-2.5"
              style={{ borderColor: T.borderSubtle, background: active ? T.primaryTint : 'transparent' }}
            >
              <div className="flex min-w-0 items-center gap-[7px]">
                <Icon name={touchPointIcon(t.touchPoint)} size={17} style={{ color: active ? T.primary : T.muted, flexShrink: 0 }} />
                <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, color: active ? T.primary : T.text }}>{t.name}</span>
              </div>
              <div className="mt-[3px] ml-6" style={{ fontSize: 11, color: T.muted }}>{t.displayCanvasSize.width}×{t.displayCanvasSize.height}</div>
              <div className="mt-[5px] ml-6 flex flex-wrap gap-[5px]">
                {STRUCTURE_MARKERS.filter((m) => m.test(t)).map((m) => <Badge key={m.key} icon={m.icon} title={m.label} tone="structure" />)}
                {enabledFeatures(t).map((f) => <Badge key={f.key} icon={f.icon} title={f.label} tone="feature" />)}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
