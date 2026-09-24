/* Exchange settings: the client running this instance as seller of record,
   and its DSP integration switch (migration 0023: off until switched on). */
import type { ExchangeInput } from '@ph-dsp/types'
import { type Db, prepared } from '../db/db'

export interface ExchangeRepo {
  get(): ExchangeInput
  save(e: ExchangeInput): ExchangeInput
}

const ID = 'exchange'
interface Row { enabled: number; organisation: string; domain: string; seller_id: string; contact_email: string }

export function sqliteExchangeRepo(db: Db): ExchangeRepo {
  const now = () => new Date().toISOString()
  /* Read on every Partner API request (the switch), so a read never writes:
     the row is created only the first time it is missing. */
  const get = (): ExchangeInput => {
    const select = () => prepared(db, 'SELECT * FROM exchange WHERE id = ?').get(ID) as unknown as Row | undefined
    let r = select()
    if (!r) {
      prepared(db, 'INSERT INTO exchange (id, updated_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(ID, now())
      r = select()!
    }
    return { enabled: r.enabled === 1, organisation: r.organisation, domain: r.domain, sellerId: r.seller_id, contactEmail: r.contact_email }
  }
  return {
    get,
    save(e) {
      get()
      prepared(db, 'UPDATE exchange SET enabled = ?, organisation = ?, domain = ?, seller_id = ?, contact_email = ?, updated_at = ? WHERE id = ?')
        .run(e.enabled ? 1 : 0, e.organisation, e.domain, e.sellerId, e.contactEmail, now(), ID)
      return get()
    },
  }
}
