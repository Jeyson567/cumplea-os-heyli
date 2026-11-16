import { timingSafeEqual } from 'node:crypto'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  if (left.length < 16 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function validateBootstrapAccount({ email, password }) {
  const clean = String(email || '').trim().toLowerCase()
  if (!EMAIL.test(clean) || clean.length > 120) {
    return { ok: false, error: 'Escribe un correo válido.' }
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return { ok: false, error: 'La contraseña debe tener entre 8 y 128 caracteres.' }
  }
  return { ok: true, email: clean }
}

/**
 * Decide el único camino permitido. El secreto ya fue comprobado antes de llamar.
 * Una cuenta existente que no sea administrador nunca recibe el permiso.
 */
export function bootstrapDecision({
  completed = false,
  pendingEmail = '',
  pendingAgeMs = Number.POSITIVE_INFINITY,
  pendingStatus = '',
  email = '',
  userExists = false,
  userIsAdmin = false,
  anyAdmin = false
}) {
  if (userIsAdmin) return { action: 'finish-existing' }
  if (completed || anyAdmin) return { action: 'reject', reason: 'completed' }
  if (pendingStatus === 'pending' && pendingEmail && pendingEmail !== email && pendingAgeMs < 120_000) {
    return { action: 'reject', reason: 'pending' }
  }
  if (userExists) return { action: 'reject', reason: 'email-exists' }
  return { action: 'create' }
}
