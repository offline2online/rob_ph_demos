/* Exchange settings: the client running this instance as seller of record. */
import type { ExchangeInput } from '@ph-dsp/types'
import type { Db } from '../db/db'

export interface ExchangeRepo {
  get(): ExchangeInput
  save(e: ExchangeInput): ExchangeInput
}

const ID = 'exchange'
interface Row { organisation: string; domain: string; seller_id: string; contact_email: string }

export function sqliteExchangeRepo(db: Db): ExchangeRepo {
  const now = () => new Date().toISOString()
  const get = (): ExchangeInput => {
    db.prepare('INSERT INTO exchange (id, updated_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(ID, now())
    const r = db.prepare('SELECT * FROM exchange WHERE id = ?').get(ID) as unknown as Row
    return { organisation: r.organisation, domain: r.domain, sellerId: r.seller_id, contactEmail: r.contact_email }
  }
  return {
    get,
    save(e) {
      get()
      db.prepare('UPDATE exchange SET organisation = ?, domain = ?, seller_id = ?, contact_email = ?, updated_at = ? WHERE id = ?')
        .run(e.organisation, e.domain, e.sellerId, e.contactEmail, now(), ID)
      return get()
    },
  }
}
