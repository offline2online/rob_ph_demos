/* The DSP provider contract (dsp/DspProvider.ts): every DSP is one module
   behind one shape, and nothing outside dsp/ branches on which DSP it is. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROVIDERS } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { dspProviders, providerOf } from '../src/dsp/registry'
import { buildApp } from '../src/http/app'
import { NOW, mockDsps, testContext } from './helpers'

const config = loadConfig({ DSP_MOCKS_URL: 'http://mocks.test' })
const dsps = dspProviders(config.dsp, config.bidders)

describe('DSP providers', () => {
  it('registers exactly one provider per catalog DSP, under its own key', () => {
    expect(Object.keys(dsps).sort()).toEqual(PROVIDERS.map((p) => p.key).sort())
    for (const [key, dsp] of Object.entries(dsps)) {
      expect(dsp.key).toBe(key)
      expect(typeof dsp.connect).toBe('function')
      expect(dsp.bidUrl).toBe(config.bidders[dsp.key].bidUrl)
    }
  })

  it('looks a provider up by its stored key, and knows no other', () => {
    expect(providerOf(dsps, 'the_trade_desk')).toBe(dsps.the_trade_desk)
    expect(providerOf(dsps, 'someone_else')).toBeUndefined()
    expect(providerOf(dsps, 'constructor')).toBeUndefined()
  })

  it('each DSP owns only its own creative path', () => {
    expect(dsps.google_dv360.ownsCreativeUrl('http://mocks.test/dv360/creatives/a.png')).toBe(true)
    expect(dsps.google_dv360.ownsCreativeUrl('http://mocks.test/ttd/creatives/a.png')).toBe(false)
    expect(dsps.the_trade_desk.ownsCreativeUrl('http://mocks.test/ttd/creatives/a.png')).toBe(true)
    expect(dsps.amazon_dsp.ownsCreativeUrl('http://mocks.test/amazon/creatives/../../dv360/creatives/a.png')).toBe(false)
    /* No creative base configured: nothing is ever fetched. */
    expect(dspProviders(config.dsp, {}).amazon_dsp.ownsCreativeUrl('http://mocks.test/amazon/creatives/a.png')).toBe(false)
    expect(dspProviders(config.dsp, {}).amazon_dsp.bidUrl).toBeUndefined()
  })

  it('each DSP reads its own audit shape, advisory only, and ignores the others', () => {
    const dv360 = { reviewStatus: { approvalStatus: 'APPROVAL_STATUS_APPROVED_SERVABLE' } }
    const ttd = { approvedBy: 'ops@ttd' }
    const amazon = { moderationStatus: 'rejected', policyViolations: [{ reason: 'Alcohol' }, { reason: 'Claims' }] }
    expect(dsps.google_dv360.auditCheck(dv360)).toMatchObject({ name: 'dsp_audit', passed: true, advisory: true, detail: expect.stringMatching(/^Display & Video 360’s own creative audit: approved\./) })
    expect(dsps.the_trade_desk.auditCheck(ttd)).toMatchObject({ passed: true, detail: expect.stringMatching(/^The Trade Desk’s own creative audit: approved \(by ops@ttd\)/) })
    expect(dsps.amazon_dsp.auditCheck(amazon)).toMatchObject({ passed: false, advisory: true, detail: expect.stringMatching(/^Amazon DSP’s own creative audit: rejected \(Alcohol; Claims\)/) })
    expect(dsps.google_dv360.auditCheck(ttd)).toBeNull()
    expect(dsps.the_trade_desk.auditCheck(amazon)).toBeNull()
    expect(dsps.amazon_dsp.auditCheck(dv360)).toBeNull()
    expect(dsps.amazon_dsp.auditCheck(null)).toBeNull()
  })

  it('nothing outside dsp/ (and the config and seed data) names a DSP', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url))
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
    })
    const allowed = /[\\/]src[\\/](dsp[\\/]|seed[\\/]|config\.ts$)/
    const offenders = files(src).filter((f) => !allowed.test(f) && /['"](google_dv360|amazon_dsp|the_trade_desk)['"]/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('A credential the DSP fixes once connected', () => {
  it('Amazon’s region is refused once connected; The Trade Desk’s region is not fixed', async () => {
    const mocks = mockDsps()
    const app = buildApp(await testContext({ dspFetch: mocks.fetchImpl, clock: () => NOW }))
    const call = (method: 'PUT' | 'POST', url: string, payload?: object) => app.inject({ method, url: `/api/admin/v1${url}`, payload })
    await mocks.app.inject({ method: 'PUT', url: '/_control/amazon_dsp/auth', payload: { accept: true } })
    expect((await call('POST', '/partners/p_amazon/connect')).json().status).toBe('connected')
    const moved = await call('PUT', '/partners/p_amazon', { credentials: { region: 'North America (NA)' } })
    expect(moved.statusCode).toBe(400)
    expect(moved.json().error.details).toEqual([{ field: 'credentials.region', reason: 'Region is fixed once connected.' }])

    await call('POST', '/partners', { provider: 'the_trade_desk' })
    await call('PUT', '/partners/p_the_trade_desk', { credentials: { supplySourceId: 'ss-481', ttdPartnerId: 'phub-retail', apiToken: 'ttd-secret-token', region: 'APAC' } })
    expect((await call('POST', '/partners/p_the_trade_desk/connect')).json().status).toBe('connected')
    expect((await call('PUT', '/partners/p_the_trade_desk', { credentials: { region: 'EMEA' } })).statusCode).toBe(200)
  })
})
