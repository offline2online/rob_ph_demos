/* Requests per second for one bench row. A driver that runs out of work before --seconds ends (it returned
   null: every bid it had was sent) was only busy for the time it took, so dividing by --seconds would cap
   its rate at count / seconds. Divide by the elapsed time then. */
export const ratePerSecond = (count: number, seconds: number, elapsedMs: number, ranOut: boolean): number =>
  Math.round(count / (ranOut && elapsedMs > 0 ? Math.min(seconds, elapsedMs / 1000) : seconds))
