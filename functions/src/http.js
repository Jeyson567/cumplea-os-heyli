import { HttpsError } from 'firebase-functions/v2/https'
import { ClientError } from './errors.js'

export function assertAdmin(request) {
  if (!request.auth?.uid || request.auth.token?.admin !== true) {
    throw new ClientError('permission-denied', 'No tienes autorización para esta acción.', 'admin')
  }
  return {
    uid: request.auth.uid,
    email: typeof request.auth.token.email === 'string' ? request.auth.token.email : null
  }
}

export function normalizeError(error) {
  if (error instanceof HttpsError) return error
  if (error instanceof ClientError) {
    return new HttpsError(error.code, error.message, { reason: error.reason || null })
  }
  return new HttpsError('internal', 'No se pudo completar la operación.')
}
