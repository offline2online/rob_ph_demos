/* The one error shape the contract allows: { error: { code, message, details? } }. */
import type { ApiError } from '@ph-dsp/types'

type Code = ApiError['error']['code']
type Detail = NonNullable<ApiError['error']['details']>[number]

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: Code, message: string, readonly details?: Detail[]) {
    super(message)
  }
  body(): ApiError {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } }
  }
}

export const notFound = (what = 'Not found.') => new HttpError(404, 'not_found', what)
export const forbidden = (what = 'You do not have access to this.') => new HttpError(403, 'forbidden', what)
export const validationFailed = (details: Detail[], message = 'Some fields are invalid.') => new HttpError(400, 'validation_failed', message, details)
export const conflict = (message: string, details?: Detail[]) => new HttpError(409, 'conflict', message, details)
export const hasDependents = (message: string, details: Detail[]) => new HttpError(409, 'has_dependents', message, details)
