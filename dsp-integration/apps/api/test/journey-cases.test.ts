import { describe, expect, it } from 'vitest'
import { journeyCasesFile, StopRun, type CaseResult } from './journey/journey-cases'

const passes: CaseResult[] = [
  { caseId: 'J0a', title: 'first', status: 'pass', expected: 'x', actual: 'x', phase: 0 },
  { caseId: 'J0b', title: 'second', status: 'pass', expected: 'y', actual: 'y', phase: 0 },
]

describe('journeyCasesFile', () => {
  it('adds a journey:crash fail case when the run stopped on an unexpected error', () => {
    const cases = journeyCasesFile(passes, new Error('boom'.repeat(300)))
    expect(cases).toHaveLength(3)
    const crash = cases[2]
    expect(crash).toMatchObject({ id: 'journey:crash', caseId: 'journey:crash', run: 'Run 6', title: 'Journey stopped on an unexpected error', status: 'fail', expected: 'the journey runs to the end', repro: 'npm run e2e:journey' })
    expect(crash.actual).toHaveLength(500)
    expect(cases.slice(0, 2).every((c) => c.status === 'pass')).toBe(true)
  })

  it('adds nothing for a StopRun, whose failing case is already recorded', () => {
    expect(journeyCasesFile(passes, new StopRun('J0c failed')).map((c) => c.caseId)).toEqual(['J0a', 'J0b'])
  })

  it('returns the results unchanged when nothing stopped the run', () => {
    const cases = journeyCasesFile(passes, null)
    expect(cases.map((c) => c.caseId)).toEqual(['J0a', 'J0b'])
    expect(cases[0]).toMatchObject({ run: 'Run 6', title: 'first', status: 'pass', repro: 'npm run e2e:journey' })
  })
})
