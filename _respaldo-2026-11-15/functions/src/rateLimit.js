import { createHash } from 'node:crypto'
import { ClientError } from './errors.js'

export function clientIp(request) {
  const forwarded = request.rawRequest?.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 80)
  }
  return String(request.rawRequest?.ip || 'desconocida').slice(0, 80)
}

export function rateKey(action, bucket) {
  return createHash('sha256').update(`${action}|${bucket}`).digest('hex')
}

export async function assertRateLimit(db, { key, limit, windowMs }) {
  const ref = db.collection('rateLimits').doc(key)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const now = Date.now()
    if (!snap.exists || now - Number(snap.get('windowStart') || 0) >= windowMs) {
      tx.set(ref, { count: 1, windowStart: now })
      return
    }
    const count = Number(snap.get('count') || 0)
    if (count >= limit) {
      throw new ClientError(
        'resource-exhausted',
        'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
        'rate'
      )
    }
    tx.update(ref, { count: count + 1 })
  })
}
