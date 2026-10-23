/* Typed fetch wrapper. Every error from the API has the contract's shape —
   but not every error reaching the browser comes from the API: behind PH
   Core's load balancer and gateway a 502 is an HTML page, a 429 may be plain
   text, and a gateway's own refusal is `{"message": …}`. Those used to throw
   a SyntaxError or a TypeError here, losing the HTTP status, and one screen
   showed "Unexpected token '<'" to the user (pre-handover review, 18 Oct
   2026). Now anything that isn't the contract's error shape is an
   ApiRequestError with its status and no body, so every caller's existing
   `instanceof ApiRequestError` handling applies; a contract error behaves
   exactly as before. */
import type { ApiError } from '@ph-dsp/types'

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly body: ApiError | null, message?: string) {
    super(message ?? body?.error.message ?? `Request failed (${status})`)
  }
  get code() {
    return this.body?.error.code
  }
}

const parse = (text: string): { ok: true; value: unknown } | { ok: false } => {
  if (!text) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/* The contract's error shape: { error: { code, message, details? } }. */
const isApiError = (v: unknown): v is ApiError => {
  const e = (v as { error?: unknown } | null)?.error as { message?: unknown } | undefined
  return !!e && typeof e === 'object' && typeof e.message === 'string'
}

export async function api<T>(method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const parsed = parse(await res.text())
  if (!res.ok) throw new ApiRequestError(res.status, parsed.ok && isApiError(parsed.value) ? parsed.value : null)
  if (!parsed.ok) throw new ApiRequestError(res.status, null, `The API answered with something other than JSON (HTTP ${res.status}).`)
  return parsed.value as T
}
