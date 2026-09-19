/* The parts of OpenRTB 2.6 a DOOH bid request from this exchange uses
   (IAB Tech Lab OpenRTB 2.6: BidRequest, Imp, Video, Banner, Qty, DOOH,
   Publisher, Source, SupplyChain, SupplyChainNode). Closed: an object with
   a field the spec doesn't define here fails, and there is no `user`,
   `app`, `site` or visitor data anywhere. `device` is allowed by the spec
   but this exchange doesn't send one (no store geo yet). */
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const int = { type: 'integer' }
const num = { type: 'number' }
const str = { type: 'string' }
const strs = { type: 'array', items: str }

export const OPENRTB_26_DOOH_REQUEST = closed({
  id: str,
  imp: {
    type: 'array', minItems: 1, items: closed({
      id: str,
      video: closed({ w: int, h: int, minduration: int, maxduration: num }, ['w', 'h']),
      banner: closed({ w: int, h: int }, ['w', 'h']),
      bidfloor: num,
      bidfloorcur: { type: 'string', pattern: '^[A-Z]{3}$' },
      /* 2.6 impression multiplier: sourcetype 1 measurement vendor/estimate, 2 publisher/counted. */
      qty: closed({ multiplier: num, sourcetype: { enum: [0, 1, 2] }, vendor: str }, ['multiplier']),
      exp: int,
      ext: { type: 'object' },
    }, ['id', 'bidfloor', 'bidfloorcur']),
  },
  dooh: closed({
    id: str, name: str, venuetype: strs, venuetypetax: int,
    publisher: closed({ id: str, name: str, domain: str }, ['id']),
    domain: str, keywords: str,
  }),
  source: closed({
    schain: closed({
      complete: { enum: [0, 1] }, ver: { const: '1.0' },
      nodes: { type: 'array', minItems: 1, items: closed({ asi: str, sid: str, hp: { enum: [0, 1] }, rid: str, name: str, domain: str }, ['asi', 'sid', 'hp']) },
    }, ['complete', 'ver', 'nodes']),
  }, ['schain']),
  cur: strs,
  bcat: strs,
  badv: strs,
  tmax: int,
  at: { enum: [1, 2] },
}, ['id', 'imp', 'dooh', 'source', 'cur', 'tmax', 'at'])
