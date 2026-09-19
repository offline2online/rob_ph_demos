/* In-memory state of the three mock DSPs. Testers change it through the
   control API (and its page); the mock DSP APIs serve it. A restart or
   POST /_control/reset restores the seed. */
import { randomUUID } from 'node:crypto'

export type DspKey = 'google_dv360' | 'amazon_dsp' | 'the_trade_desk'
export const DSPS: DspKey[] = ['google_dv360', 'amazon_dsp', 'the_trade_desk']

export interface Seat { seatId: string; name: string }
export interface MockAdvertiser { id: string; name: string; seatId: string; domain: string; categories: string[]; currency: string }
export interface AuthBehaviour { accept: boolean; error: string; description: string }
/* bid: a bid at priceCpm; no_bid: 204; below_floor: half the request's bidfloor.
   advertiserId picks who bids (default: the first advertiser); crid and adomain
   override the creative ID and advertiser domain (e.g. an unapproved crid or a
   blocked domain) to test pre-auction enforcement. */
export interface BidderBehaviour { mode: 'bid' | 'no_bid' | 'below_floor'; priceCpm: number; advertiserId?: string; crid?: string; adomain?: string }
export interface DspState {
  /* DV360 partner ID, Amazon Ads profile ID, or TTD partner ID the account lives under. */
  accountId: string
  seats: Seat[]
  advertisers: MockAdvertiser[]
  auth: AuthBehaviour
  bidder: BidderBehaviour
}

const ok: AuthBehaviour = { accept: true, error: '', description: '' }

export function seedState(): Record<DspKey, DspState> {
  return {
    google_dv360: {
      accountId: '884512',
      seats: [{ seatId: '884512', name: 'Seat 884512' }, { seatId: '884513', name: 'Seat 884513' }],
      advertisers: [
        { id: '5130001', name: 'Nestlé', seatId: '884512', domain: 'nestle.com', categories: ['Food & Drink'], currency: 'AUD' },
        { id: '5130002', name: 'Swisse', seatId: '884513', domain: 'swisse.com', categories: ['Health & Fitness'], currency: 'AUD' },
      ],
      auth: { ...ok },
      bidder: { mode: 'bid', priceCpm: 150 },
    },
    amazon_dsp: {
      accountId: '3390127745',
      seats: [{ seatId: 'amzn-seat-1', name: 'Amazon DSP seat' }],
      advertisers: [{ id: '588104411', name: "L'Oréal", seatId: 'amzn-seat-1', domain: 'loreal.com', categories: ['Beauty'], currency: 'AUD' }],
      /* Seeded to fail, like the prototype: "Refresh token rejected". */
      auth: { accept: false, error: 'invalid_grant', description: 'The request has an invalid grant parameter : refresh_token' },
      bidder: { mode: 'bid', priceCpm: 150 },
    },
    the_trade_desk: {
      accountId: 'phub-retail',
      seats: [{ seatId: 'ttd-seat-1', name: 'TTD seat' }],
      advertisers: [{ id: 'ttd-adv-1', name: 'Arnott’s', seatId: 'ttd-seat-1', domain: 'arnotts.com', categories: ['Food & Drink'], currency: 'AUD' }],
      auth: { ...ok },
      bidder: { mode: 'bid', priceCpm: 150 },
    },
  }
}

export class MockStore {
  state = seedState()
  /* Access tokens issued by each mock's auth endpoint. */
  readonly tokens = new Map<string, DspKey>()

  reset() {
    this.state = seedState()
    this.tokens.clear()
  }
  issueToken(dsp: DspKey) {
    const t = `mock-${dsp}-${randomUUID()}`
    this.tokens.set(t, dsp)
    return t
  }
  tokenValid(dsp: DspKey, header: string | undefined) {
    const m = /^Bearer\s+(.+)$/i.exec(header ?? '')
    return !!m && this.tokens.get(m[1]) === dsp
  }
}
