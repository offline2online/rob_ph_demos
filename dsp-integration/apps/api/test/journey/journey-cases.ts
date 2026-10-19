/* The cases file the Run 6 journey writes for e2e-run.mjs, pure so a vitest can
   check it without starting the API. A run that stops on anything but StopRun
   (a failed `must` already recorded its own fail) gets one `journey:crash` fail
   case, so cases recorded before the crash can't read as a pass. */
export type Status = 'pass' | 'fail' | 'known-gap' | 'skipped'
export interface CaseResult { caseId: string; title: string; status: Status; expected: string; actual: string; phase: number }
export interface JourneyCase { id: string; caseId: string; run: 'Run 6'; title: string; status: Status; expected: string; actual: string; repro: string }

export class StopRun extends Error {}

const REPRO = 'npm run e2e:journey'

export const crashCase = (fatal: unknown): JourneyCase | null => {
  if (!fatal || fatal instanceof StopRun) return null
  const message = fatal instanceof Error ? fatal.message : String(fatal)
  return { id: 'journey:crash', caseId: 'journey:crash', run: 'Run 6', title: 'Journey stopped on an unexpected error', status: 'fail', expected: 'the journey runs to the end', actual: message.slice(0, 500), repro: REPRO }
}

export const journeyCasesFile = (results: CaseResult[], fatal: unknown): JourneyCase[] => {
  const cases = results.map((r): JourneyCase => ({ id: r.caseId, caseId: r.caseId, run: 'Run 6', title: r.title, status: r.status, expected: r.expected, actual: r.actual, repro: REPRO }))
  const crash = crashCase(fatal)
  return crash ? [...cases, crash] : cases
}
