/* Typed fetch wrapper. Every error from the API has the contract's shape. */
import type { ApiError } from '@ph-dsp/types'

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly body: ApiError | null) {
    super(body?.error.message ?? `Request failed (${status})`)
  }
  get code() {
    return this.body?.error.code
  }
}

export async function api<T>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiRequestError(res.status, (json as ApiError) ?? null)
  return json as T
}
