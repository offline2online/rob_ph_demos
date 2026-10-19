/* Pre-handover review (18 Oct 2026): the admin UI's two crash-path fixes —
   the API client with a response that isn't the contract's error shape, and
   the route error element. See docs/dsp-integration/api/HANDOVER-REVIEW.md. */
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers, appRoutes } from '../src/App'
import { ApiRequestError, api } from '../src/api/client'
import { RouteError } from '../src/shared/RouteError'
import { envFlags } from '../src/flags'

const respond = (status: number, body: string, type = 'text/html') => vi.stubGlobal('fetch', vi.fn(async () => new Response(body === '' ? null : body, { status, headers: { 'content-type': type } })))
const failure = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('expected the call to fail')
}

describe('the API client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the status of an error page that is not JSON (a load balancer 502)', async () => {
    respond(502, '<html><body>502 Bad Gateway</body></html>')
    const e = await failure(api('GET', '/admin/v1/display-types'))
    expect(e).toBeInstanceOf(ApiRequestError)
    expect(e).toMatchObject({ status: 502, body: null, message: 'Request failed (502)' })
  })

  it('treats a gateway’s own JSON refusal as an error with no contract body', async () => {
    respond(403, '{"message":"Forbidden"}', 'application/json')
    const e = (await failure(api('GET', '/admin/v1/display-types'))) as ApiRequestError
    expect(e).toBeInstanceOf(ApiRequestError)
    expect(e.status).toBe(403)
    expect(e.body).toBeNull()
    expect(e.code).toBeUndefined()
  })

  it('passes the contract’s error through exactly as before', async () => {
    const body = { error: { code: 'validation_failed', message: 'Some fields are invalid.', details: [{ field: 'name', reason: 'Required.' }] } }
    respond(400, JSON.stringify(body), 'application/json')
    const e = (await failure(api('PUT', '/admin/v1/display-types/x', {}))) as ApiRequestError
    expect(e).toMatchObject({ status: 400, body, message: 'Some fields are invalid.', code: 'validation_failed' })
  })

  it('refuses a success that is not JSON, saying so, instead of a SyntaxError', async () => {
    respond(200, '<!doctype html><title>Sign in</title>')
    const e = await failure(api('GET', '/admin/v1/session'))
    expect(e).toBeInstanceOf(ApiRequestError)
    expect((e as Error).message).toBe('The API answered with something other than JSON (HTTP 200).')
  })

  it('still returns JSON and empty bodies', async () => {
    respond(200, '{"ok":true}', 'application/json')
    expect(await api('GET', '/x')).toEqual({ ok: true })
    respond(204, '')
    expect(await api('DELETE', '/x')).toBeUndefined()
  })
})

describe('a page that throws while rendering', () => {
  it('is replaced by a message, never a stack trace', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => {
      throw new Error('kaboom at render')
    }
    const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError frame /> }])
    render(<Providers><RouterProvider router={router} /></Providers>)
    expect(screen.getByText(/This page could not be shown/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByText(/kaboom/)).toBeNull()
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull()
    quiet.mockRestore()
  })
})

describe('an address no route matches', () => {
  it('says the page doesn’t exist, with nothing to reload', () => {
    const router = createMemoryRouter([{ path: '/', element: <div />, errorElement: <RouteError frame /> }], { initialEntries: ['/no-such-page'] })
    const { container } = render(<Providers><RouterProvider router={router} /></Providers>)
    expect(screen.getByText(/This page doesn’t exist/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(container.querySelector('[data-route-error="not-found"]')).not.toBeNull()
  })
})

describe('every route carries the error element', () => {
  it('the root and each section, with every flag on', () => {
    const flags = { ...envFlags(), dspIntegration: true, selfService: true, changeHistory: true }
    const [root] = appRoutes(flags)
    expect(root.errorElement).toBeTruthy()
    for (const child of root.children ?? []) expect(child.errorElement, child.path ?? 'index').toBeTruthy()
  })
})
