import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onCall } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { createBootstrap } from './src/bootstrap.js'
import { REGION } from './src/constants.js'
import { createApi } from './src/service.js'
import { assertAdmin, normalizeError } from './src/http.js'
import { assertRateLimit, clientIp, rateKey } from './src/rateLimit.js'

initializeApp()
const db = getFirestore()
const api = createApi(db)
const bootstrap = createBootstrap(db)
const installSecret = defineSecret('INSTALL_SECRET')
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === 'true'

function options(timeoutSeconds = 20) {
  return {
    region: REGION,
    cors: true,
    invoker: 'public',
    enforceAppCheck,
    timeoutSeconds,
    memory: '256MiB',
    maxInstances: 20
  }
}

function expose(name, { admin = false, limit, windowMs = 60_000, timeoutSeconds = 20 }, handler) {
  return onCall(options(timeoutSeconds), async (request) => {
    try {
      const actor = admin ? assertAdmin(request) : null
      const bucket = admin ? request.auth.uid : clientIp(request)
      await assertRateLimit(db, { key: rateKey(name, bucket), limit, windowMs })
      return await handler(request, actor)
    } catch (error) {
      const normalized = normalizeError(error)
      if (normalized.code === 'internal') logger.error(name, error)
      throw normalized
    }
  })
}

export const resolveInvitation = expose('resolve', { limit: 40 }, (request) => api.resolveInvitation(request.data))

export const submitRsvp = expose('rsvp', { limit: 8 }, (request) => api.submitRsvp(request.data))

export const createInvitation = expose('create', { admin: true, limit: 30 }, (request, actor) => {
  return api.createInvitation({ actor, data: request.data })
})

export const updateInvitation = expose('update', { admin: true, limit: 40 }, (request, actor) => {
  return api.updateInvitation({ actor, data: request.data })
})

export const setInvitationActive = expose('active', { admin: true, limit: 30 }, (request, actor) => {
  return api.setInvitationActive({ actor, data: request.data })
})

export const regenerateInvitationToken = expose('regenerate', { admin: true, limit: 15 }, (request, actor) => {
  return api.regenerateInvitationToken({ actor, data: request.data })
})

export const revealInvitationLink = expose('reveal', { admin: true, limit: 15 }, (request, actor) => {
  return api.revealInvitationLink({ actor, data: request.data })
})

export const adminUpdateRsvp = expose('adminRsvp', { admin: true, limit: 30 }, (request, actor) => {
  return api.adminUpdateRsvp({ actor, data: request.data })
})

export const previewCheckIn = expose('previewCheckIn', { admin: true, limit: 60 }, (request) => {
  return api.previewCheckIn(request.data)
})

export const commitCheckIn = expose('checkIn', { admin: true, limit: 60 }, (request, actor) => {
  return api.commitCheckIn({ actor, data: request.data })
})

export const updateEventSettings = expose('settings', { admin: true, limit: 20, timeoutSeconds: 30 }, (request, actor) => {
  return api.updateEventSettings({ actor, data: request.data })
})

export const bootstrapStatus = onCall(options(15), async (request) => {
  try {
    await assertRateLimit(db, { key: rateKey('bootstrapStatus', clientIp(request)), limit: 30, windowMs: 60_000 })
    return await bootstrap.status()
  } catch (error) {
    const normalized = normalizeError(error)
    if (normalized.code === 'internal') logger.error('bootstrapStatus', error)
    throw normalized
  }
})

export const bootstrapAdmin = onCall({ ...options(30), secrets: [installSecret] }, async (request) => {
  try {
    await assertRateLimit(db, { key: rateKey('bootstrapAdmin', clientIp(request)), limit: 5, windowMs: 15 * 60_000 })
    const data = request.data && typeof request.data === 'object' ? request.data : {}
    return await bootstrap.install({
      email: data.email,
      password: data.password,
      secret: data.secret,
      expectedSecret: installSecret.value()
    })
  } catch (error) {
    const normalized = normalizeError(error)
    if (normalized.code === 'internal') logger.error('bootstrapAdmin', error?.code || 'error')
    throw normalized
  }
})
