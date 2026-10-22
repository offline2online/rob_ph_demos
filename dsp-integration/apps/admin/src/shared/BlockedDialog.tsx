/* One friendly dialog for every hard block (ticket z0qiB0GGHR010H0Shrj0, 22 Oct 2026).
   The API refuses a change that would break a commitment with 409 has_dependents; the
   screen used to show that as a red toast with the raw sentence. This says what was
   blocked, why (each reserved/sold window or dependent, listed), and what to do next.
   Close is the only action. */
import { Alert, Button, Modal } from 'antd'
import { ApiRequestError } from '../api/client'
import { T } from '../theme/phTheme'
import { Icon } from './Icon'

export interface Blocked {
  title: string
  /* Whether the user's edits were lost; false for a delete/archive, where nothing was being edited. */
  unsaved: boolean
  /* A save of several parts where only some were refused: the rest did save (E2E 22 Oct 2026, it said nothing was saved). */
  partial?: boolean
  reason: string
  items: { kind: string; text: string }[]
  next: string[]
}

type Action = 'save' | 'delete' | 'archive'

const WAIT = 'Wait until the listed play windows have finished playing, then try again.'
const REMOVE_BOOKING = 'Or remove the booking: open Campaign Status or Booking Schedule, cancel it, then try again.'

/* Turns a has_dependents refusal into dialog content, or null when the error is something
   else (those stay a toast). Matches on the API's sentence because the code is shared by
   every block; an unrecognised one still gets a generic dialog with the API's own text. */
export function describeBlock(e: unknown, action: Action, subject = 'This change'): Blocked | null {
  if (!(e instanceof ApiRequestError) || e.code !== 'has_dependents') return null
  const m = e.message
  const items = (e.body?.error.details ?? []).map((x) => ({ kind: x.field ?? '', text: x.reason ?? '' }))
  const unsaved = action === 'save'
  const n = items.length
  const windows = `${n} play window${n === 1 ? ' is' : 's are'} reserved or sold`
  if (/another owner/.test(m)) {
    return { title: "This slot's owner can't be changed", unsaved, items,
      reason: `An Advertiser slot keeps its owner while it is reserved or sold. ${windows} on it, and switching the owner would drop the advertiser and strand the booking.`,
      next: [WAIT, REMOVE_BOOKING, 'Or leave the slot as an Advertiser slot and lock it against new sales in Advertisers / Inventory.'] }
  }
  if (/playlist can't be changed|assigned playlist can't be changed/.test(m)) {
    return { title: "This playlist can't be changed", unsaved, items,
      reason: `Its display type's positions are reserved or sold, and changing the playlist would alter what the advertiser bought. ${windows}.`,
      next: [WAIT, REMOVE_BOOKING] }
  }
  if (/display type can't be deleted/.test(m)) {
    return { title: "This display type can't be deleted", unsaved, items,
      reason: 'Something still depends on it, so deleting it would leave displays or bookings without a home.',
      next: ['Move any displays to another display type.', 'Remove advertiser slots from its playlist in Playlist Management.', WAIT] }
  }
  if (/playlist can't be deleted/.test(m)) {
    return { title: "This playlist can't be deleted", unsaved, items,
      reason: "It is a display type's default playlist or is assigned to a zone, and a display type or zone is never left without one.",
      next: ['Assign another playlist to each display type or zone listed, save, then delete this one.'] }
  }
  if (/deal can't be archived/.test(m)) {
    return { title: "This deal can't be archived", unsaved, items,
      reason: 'A slot is still assigned to it, so archiving would leave that slot selling to a deal buyers can no longer see.',
      next: ['Open Advertisers / Inventory and assign each listed slot to another deal, or to no deal.', 'Then archive the deal again.'] }
  }
  /* An advertiser's audience (Visitor Segments value) that a live deal targets (PUT advertisers/:id/audiences). */
  if (/can't lose .*targeted by/.test(m)) {
    return { title: "This audience can't be removed", unsaved, items,
      reason: `${m.replace(/^.*?:\s*/, '')} Removing it would change who that live deal reaches.`,
      next: ['Edit the deal in Advertisers / Inventory → Deals and buyers lists and remove the segment from its targeting, then try again.', 'Or wait until the deal has ended and been archived.'] }
  }
  if (/can.t be removed|can't lose/.test(m)) {
    return { title: "This advertiser can't be removed from the slot", unsaved, items,
      reason: 'The slot is sold, so the advertiser stays on it while the booking runs. Existing bookings continue.',
      next: [WAIT, 'Or lock the slot against new sales; it releases by itself once nothing is booked.'] }
  }
  return { title: `${subject} can't be ${action === 'save' ? 'saved' : action === 'delete' ? 'deleted' : 'archived'}`, unsaved, items,
    reason: m, next: ['Resolve what is listed, then try again.'] }
}

export function BlockedDialog({ blocked, onClose }: { blocked: Blocked; onClose: () => void }) {
  const n = blocked.items.length
  return (
    <Modal
      open
      width={480}
      closable={false}
      onCancel={onClose}
      title={
        <span className="inline-flex items-center gap-2.5">
          <Icon name="block" size={20} style={{ color: T.warning }} />
          {blocked.title}
        </span>
      }
      footer={[<Button key="close" type="primary" onClick={onClose}>Close</Button>]}
    >
      <div style={{ fontSize: 13, lineHeight: 1.55 }}>
        <Alert
          className="mb-2.5"
          type="warning"
          message={<>{blocked.unsaved && <><b>{blocked.partial ? 'Your other changes were saved; this one was not.' : 'Your changes were not saved.'}</b>{' '}</>}{blocked.reason}</>}
        />
        {n > 0 && (
          <ul aria-label="What is holding this" className="m-0 mb-2.5 max-h-[180px] list-none overflow-y-auto rounded-md border p-0" style={{ borderColor: T.borderSubtle }}>
            {blocked.items.map((x, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-[7px]" style={{ fontSize: 12.5, borderBottom: i < n - 1 ? `1px solid ${T.borderSubtle}` : 'none' }}>
                <Icon name={x.kind === 'reservation' ? 'event_busy' : x.kind === 'slot' || x.kind === 'slots' ? 'storefront' : x.kind === 'display' ? 'tv' : 'link'} size={15} style={{ color: T.muted }} />
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div style={{ fontWeight: 500 }}>What you can do</div>
        {/* list-disc: Tailwind's base styles drop the bullets, so a wrapped line read as a new step (E2E 22 Oct 2026). */}
        <ul aria-label="What you can do" className="m-0 list-disc pl-5">
          {blocked.next.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </div>
    </Modal>
  )
}
