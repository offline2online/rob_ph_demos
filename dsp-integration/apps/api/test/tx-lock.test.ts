/* The transaction lock (ticket cUdX4dmTMB2mvxJczHvT, Rob 1 Oct 2026). With
   awaitable seams a transaction body yields at every await, and on SQLite's
   one connection anything that ran then would execute inside it. So: one
   transaction at a time per database (FIFO), a transaction inside another
   in the same call chain joins it, and every statement from outside waits
   (gate / onFree). */
import { describe, expect, it } from 'vitest'
import { busy, gate, onFree, openDb, tx, txSync } from '../src/db/db'
import { testContext } from './helpers'

const fresh = () => {
  const db = openDb(':memory:')
  db.exec('CREATE TABLE log (seq INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL)')
  return db
}
const tick = () => new Promise<void>((r) => setImmediate(r))
const write = (db: ReturnType<typeof fresh>, who: string) => db.prepare('INSERT INTO log (who) VALUES (?)').run(who)
const log = (db: ReturnType<typeof fresh>) => (db.prepare('SELECT who FROM log ORDER BY seq').all() as { who: string }[]).map((r) => r.who)

describe('the transaction lock', () => {
  it('runs overlapping transactions one after the other, never interleaving their statements', async () => {
    const db = fresh()
    const body = (who: string) => async () => {
      for (let i = 0; i < 3; i++) {
        write(db, `${who}${i}`)
        await tick()
      }
    }
    await Promise.all([tx(db, body('a')), tx(db, body('b')), tx(db, body('c'))])
    expect(log(db)).toEqual(['a0', 'a1', 'a2', 'b0', 'b1', 'b2', 'c0', 'c1', 'c2'])
  })

  it('a throw rolls the transaction back and releases the lock for the next one', async () => {
    const db = fresh()
    const failing = tx(db, async () => {
      write(db, 'doomed')
      await tick()
      throw new Error('boom')
    })
    const next = tx(db, async () => write(db, 'next'))
    await expect(failing).rejects.toThrow('boom')
    await next
    expect(log(db)).toEqual(['next'])
    expect(busy(db)).toBeNull()
  })

  it('a transaction inside another, in the same call chain, joins it: one BEGIN, no deadlock', async () => {
    const db = fresh()
    await tx(db, async () => {
      write(db, 'outer')
      await tick()
      await tx(db, async () => {
        write(db, 'inner')
        await tick()
      })
    })
    expect(log(db)).toEqual(['outer', 'inner'])
    /* A failure in the inner one rolls back the whole outer transaction. */
    await expect(tx(db, async () => {
      write(db, 'outer2')
      await tx(db, async () => { throw new Error('inner failed') })
    })).rejects.toThrow('inner failed')
    expect(log(db)).toEqual(['outer', 'inner'])
  })

  it('a statement from outside the open transaction waits for it to end (onFree), then runs at once', async () => {
    const db = fresh()
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const open = tx(db, async () => {
      write(db, 'tx-start')
      await held
      write(db, 'tx-end')
    })
    await tick()
    expect(busy(db)).not.toBeNull()
    const outside = onFree(db, () => write(db, 'outside'))
    expect(outside).toBeInstanceOf(Promise)
    await tick()
    expect(log(db)).toEqual(['tx-start'])
    release()
    await open
    await outside
    expect(log(db)).toEqual(['tx-start', 'tx-end', 'outside'])
    /* With nothing open it runs synchronously and returns the value itself. */
    expect(onFree(db, () => 42)).toBe(42)
  })

  it('a rolled-back transaction takes none of an outsider\'s writes with it', async () => {
    const db = fresh()
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const open = tx(db, async () => {
      write(db, 'tx')
      await held
      throw new Error('rolled back')
    })
    await tick()
    const outside = onFree(db, () => write(db, 'outside'))
    release()
    await expect(open).rejects.toThrow('rolled back')
    await outside
    expect(log(db)).toEqual(['outside'])
  })

  it('gate() puts every method of a seam behind the lock, and passes a promise-returning one through', async () => {
    const db = fresh()
    const seam = gate(db, {
      add(who: string) { write(db, who); return who },
      async remote(who: string) { await tick(); write(db, who); return who },
    })
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const open = tx(db, async () => {
      seam.add('inside')
      await held
    })
    await tick()
    const waiting = seam.add('outside')
    expect(waiting).toBeInstanceOf(Promise)
    release()
    await open
    expect(await waiting).toBe('outside')
    expect(await seam.remote('remote')).toBe('remote')
    expect(log(db)).toEqual(['inside', 'outside', 'remote'])
    /* The wrapper is cached per method, not rebuilt on every access. */
    expect(seam.add).toBe(seam.add)
  })

  it('txSync (start-up only) refuses to begin inside an open async transaction', async () => {
    const db = fresh()
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const open = tx(db, async () => { await held })
    await tick()
    expect(() => txSync(db, () => write(db, 'nested'))).toThrow(/already open/)
    release()
    await open
    expect(txSync(db, () => { write(db, 'after'); return 1 })).toBe(1)
    expect(log(db)).toEqual(['after'])
  })

  it('in a real context, a seam call from another request waits for an open transaction', async () => {
    const ctx = await testContext()
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const before = (await ctx.company.get()).floorCpm
    const open = tx(ctx.db, async () => {
      const c = await ctx.company.get()
      await ctx.company.save({ ...c, floorCpm: before + 1 })
      await held
      throw new Error('abandoned')
    })
    await tick()
    /* Another request reads while the transaction is open: it must not see the uncommitted write. */
    const read = Promise.resolve(ctx.company.get())
    release()
    await expect(open).rejects.toThrow('abandoned')
    expect((await read).floorCpm).toBe(before)
  })
})
