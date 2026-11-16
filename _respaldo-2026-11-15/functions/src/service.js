import { FieldValue } from 'firebase-admin/firestore'
import { ClientError } from './errors.js'
import { FALLBACK_RSVP_DEADLINE } from './constants.js'
import {
  classifyToken,
  cleanMultiline,
  cleanText,
  deriveCheckInStatus,
  evaluateCheckIn,
  evaluateRsvp,
  evaluateSeatChange,
  isDocId,
  isTokenShape,
  isUuid,
  sanitizeEventSettings,
  tokenMessage,
  validateName,
  validatePhone
} from './policy.js'
import { decryptToken, encryptToken, encryptionKey, generateToken, hashToken } from './tokens.js'

function asRecord(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ClientError('invalid-argument', 'La solicitud no tiene un formato válido.')
  }
  return data
}

function mustUuid(value) {
  if (!isUuid(value)) {
    throw new ClientError('invalid-argument', 'No se pudo identificar la operación. Actualiza la página e inténtalo de nuevo.')
  }
  return value
}

function mustId(value) {
  if (!isDocId(value)) throw new ClientError('invalid-argument', 'La invitación indicada no es válida.')
  return value
}

function history(invitation, entry) {
  const previous = Array.isArray(invitation.recentHistory) ? invitation.recentHistory.slice(-14) : []
  return [...previous, entry]
}

function trimChecks(list) {
  return Array.isArray(list) ? list.slice(-19) : []
}

function tokenError(kind) {
  const code = kind === 'invalid' ? 'not-found' : 'failed-precondition'
  return new ClientError(code, tokenMessage(kind), kind)
}

function settingsWindow(settings) {
  const deadline = settings?.rsvpDeadline ? Date.parse(settings.rsvpDeadline) : Date.parse(FALLBACK_RSVP_DEADLINE)
  return {
    rsvpOpen: settings ? settings.rsvpOpen !== false : true,
    deadlineMs: Number.isNaN(deadline) ? Date.parse(FALLBACK_RSVP_DEADLINE) : deadline,
    rsvpDeadline: settings?.rsvpDeadline || FALLBACK_RSVP_DEADLINE
  }
}

function closedReason(window, nowMs) {
  if (window.rsvpOpen === false) return 'closed'
  if (nowMs > window.deadlineMs) return 'deadline'
  return null
}

export function createApi(db) {
  const settingsRef = db.collection('eventSettings').doc('public')

  function audit(tx, entry) {
    tx.set(db.collection('auditLogs').doc(), {
      ...entry,
      at: FieldValue.serverTimestamp(),
      atIso: entry.atIso
    })
  }

  async function readStoredToken(invitationId) {
    const snap = await db.collection('invitations').doc(invitationId).collection('secret').doc('link').get()
    if (!snap.exists || snap.get('stored') !== true) {
      throw new ClientError(
        'failed-precondition',
        'Este enlace no quedó guardado. Genera uno nuevo para copiarlo.',
        'not-stored'
      )
    }
    const key = encryptionKey()
    if (!key) {
      throw new ClientError(
        'failed-precondition',
        'El servidor no tiene clave de cifrado. Genera un enlace nuevo: se mostrará una sola vez.',
        'not-stored'
      )
    }
    try {
      return decryptToken(snap.data(), key)
    } catch {
      throw new ClientError('internal', 'No se pudo recuperar el enlace. Genera uno nuevo.')
    }
  }

  function secretPayload(token) {
    const tokenHash = hashToken(token)
    const key = encryptionKey()
    if (!key) return { stored: false, tokenHash }
    return encryptToken(token, key)
  }

  async function locate(token) {
    if (!isTokenShape(token)) return { kind: 'invalid' }
    const indexSnap = await db.collection('tokenIndex').doc(hashToken(token)).get()
    if (!indexSnap.exists) return { kind: 'invalid' }
    const record = indexSnap.data()
    if (record.status === 'revoked') return { kind: 'revoked' }
    const invitationId = record.invitationId
    if (!isDocId(invitationId)) return { kind: 'invalid' }
    const ref = db.collection('invitations').doc(invitationId)
    const invSnap = await ref.get()
    if (!invSnap.exists) return { kind: 'invalid' }
    const invitation = invSnap.data()
    const kind = classifyToken(record, invitation)
    if (kind !== 'valid') return { kind }
    return { kind, ref, invitation, invitationId }
  }

  return {
    async resolveInvitation(data) {
      const body = asRecord(data)
      const found = await locate(body.token)
      if (found.kind !== 'valid') throw tokenError(found.kind)
      const now = new Date().toISOString()
      const last = found.invitation.lastAccessAt ? Date.parse(found.invitation.lastAccessAt) : 0
      if (!Number.isFinite(last) || Date.now() - last > 10 * 60 * 1000) {
        await found.ref.update({ lastAccessAt: now }).catch(() => {})
      }
      const settingsSnap = await settingsRef.get()
      const window = settingsWindow(settingsSnap.exists ? settingsSnap.data() : null)
      const reason = closedReason(window, Date.now())
      return {
        name: found.invitation.name,
        maxSeats: found.invitation.maxSeats,
        status: found.invitation.status,
        confirmedCount: found.invitation.confirmedCount || 0,
        respondedAt: found.invitation.respondedAt || null,
        rsvpOpen: reason == null,
        rsvpDeadline: window.rsvpDeadline,
        closedReason: reason
      }
    },

    async submitRsvp(data) {
      const body = asRecord(data)
      const requestId = mustUuid(body.requestId)
      if (!isTokenShape(body.token)) throw tokenError('invalid')
      const tokenHash = hashToken(body.token)
      const indexRef = db.collection('tokenIndex').doc(tokenHash)
      return db.runTransaction(async (tx) => {
        const indexSnap = await tx.get(indexRef)
        if (!indexSnap.exists) throw tokenError('invalid')
        if (indexSnap.get('status') === 'revoked') throw tokenError('revoked')
        const invitationId = indexSnap.get('invitationId')
        if (!isDocId(invitationId)) throw tokenError('invalid')
        const ref = db.collection('invitations').doc(invitationId)
        const opRef = ref.collection('ops').doc(requestId)
        const invSnap = await tx.get(ref)
        const opSnap = await tx.get(opRef)
        const settingsSnap = await tx.get(settingsRef)
        if (opSnap.exists && opSnap.get('action') === 'rsvp') return opSnap.get('result')
        if (!invSnap.exists || invSnap.get('active') === false) throw tokenError(invSnap.exists ? 'inactive' : 'invalid')
        const invitation = invSnap.data()
        const window = settingsWindow(settingsSnap.exists ? settingsSnap.data() : null)
        const decision = evaluateRsvp({
          attending: body.attending,
          guests: body.guests,
          maxSeats: invitation.maxSeats,
          checkedInCount: invitation.checkedInCount || 0,
          rsvpOpen: window.rsvpOpen,
          deadlineMs: window.deadlineMs,
          nowMs: Date.now()
        })
        if (!decision.ok) throw new ClientError('failed-precondition', decision.message, decision.code)
        const now = new Date().toISOString()
        const summary = decision.status === 'confirmado'
          ? `Confirmó ${decision.confirmedCount} ${decision.confirmedCount === 1 ? 'persona' : 'personas'}`
          : 'Indicó que no podrá asistir'
        const result = {
          name: invitation.name,
          maxSeats: invitation.maxSeats,
          status: decision.status,
          confirmedCount: decision.confirmedCount,
          respondedAt: now,
          rsvpOpen: true,
          rsvpDeadline: window.rsvpDeadline,
          closedReason: null
        }
        tx.update(ref, {
          status: decision.status,
          confirmedCount: decision.confirmedCount,
          respondedAt: now,
          updatedAt: now,
          checkInStatus: deriveCheckInStatus(invitation.checkedInCount || 0, decision.confirmedCount),
          recentHistory: history(invitation, { at: now, action: 'rsvp', summary, actor: 'invitado' })
        })
        tx.set(opRef, { action: 'rsvp', result, at: now })
        audit(tx, {
          invitationId,
          invitationName: invitation.name,
          action: 'rsvp',
          summary,
          actorUid: 'guest',
          actorEmail: null,
          atIso: now,
          changes: {
            status: { from: invitation.status, to: decision.status },
            confirmedCount: { from: invitation.confirmedCount || 0, to: decision.confirmedCount }
          }
        })
        return result
      })
    },

    async createInvitation({ actor, data }) {
      const body = asRecord(data)
      const requestId = mustUuid(body.requestId)
      const name = validateName(body.name)
      if (name.error) throw new ClientError('invalid-argument', name.error)
      const phone = validatePhone(body.phone)
      if (phone.error) throw new ClientError('invalid-argument', phone.error)
      const seats = evaluateSeatChange({ maxSeats: body.maxSeats, confirmedCount: 0, checkedInCount: 0 })
      if (!seats.ok) throw new ClientError('invalid-argument', seats.message)
      const notes = cleanMultiline(body.notes || '', 500)
      const opRef = db.collection('createOps').doc(requestId)
      const existing = await opRef.get()
      if (existing.exists) {
        const invitationId = existing.get('invitationId')
        const token = await readStoredToken(invitationId)
        return { id: invitationId, token, stored: true, replayed: true }
      }
      const token = generateToken()
      const secret = secretPayload(token)
      const invitationRef = db.collection('invitations').doc()
      const now = new Date().toISOString()
      try {
        await db.runTransaction(async (tx) => {
          const opSnap = await tx.get(opRef)
          if (opSnap.exists) {
            const error = new Error('REPLAY')
            error.invitationId = opSnap.get('invitationId')
            throw error
          }
          const indexRef = db.collection('tokenIndex').doc(secret.tokenHash)
          const indexSnap = await tx.get(indexRef)
          if (indexSnap.exists) {
            throw new ClientError('aborted', 'No se pudo generar el enlace. Inténtalo de nuevo.')
          }
          tx.set(invitationRef, {
            schemaVersion: 1,
            name: name.value,
            phone: phone.value || null,
            notes,
            maxSeats: body.maxSeats,
            status: 'pendiente',
            confirmedCount: 0,
            createdAt: now,
            updatedAt: now,
            respondedAt: null,
            active: true,
            lastAccessAt: null,
            checkInStatus: 'pendiente',
            checkedInCount: 0,
            lastCheckInAt: null,
            checkIns: [],
            recentHistory: [{ at: now, action: 'create', summary: 'Invitación creada', actor: actor.email || actor.uid }],
            createdBy: actor.uid
          })
          tx.set(indexRef, { invitationId: invitationRef.id, status: 'active', createdAt: now })
          tx.set(invitationRef.collection('secret').doc('link'), { ...secret, updatedAt: now })
          tx.set(opRef, { invitationId: invitationRef.id, createdAt: now })
          audit(tx, {
            invitationId: invitationRef.id,
            invitationName: name.value,
            action: 'create',
            summary: 'Invitación creada',
            actorUid: actor.uid,
            actorEmail: actor.email,
            atIso: now
          })
        })
      } catch (error) {
        if (error.message === 'REPLAY') {
          const tokenReplay = await readStoredToken(error.invitationId)
          return { id: error.invitationId, token: tokenReplay, stored: true, replayed: true }
        }
        throw error
      }
      return { id: invitationRef.id, token, stored: secret.stored === true, replayed: false }
    },

    async updateInvitation({ actor, data }) {
      const body = asRecord(data)
      const id = mustId(body.id)
      const requestId = mustUuid(body.requestId)
      const name = validateName(body.name)
      if (name.error) throw new ClientError('invalid-argument', name.error)
      const phone = validatePhone(body.phone)
      if (phone.error) throw new ClientError('invalid-argument', phone.error)
      const notes = cleanMultiline(body.notes || '', 500)
      const ref = db.collection('invitations').doc(id)
      return db.runTransaction(async (tx) => {
        const opRef = ref.collection('ops').doc(requestId)
        const invSnap = await tx.get(ref)
        const opSnap = await tx.get(opRef)
        if (opSnap.exists && opSnap.get('action') === 'update') return opSnap.get('result')
        if (!invSnap.exists) throw new ClientError('not-found', 'No se encontró la invitación.')
        const invitation = invSnap.data()
        const seats = evaluateSeatChange({
          maxSeats: body.maxSeats,
          confirmedCount: invitation.confirmedCount || 0,
          checkedInCount: invitation.checkedInCount || 0
        })
        if (!seats.ok) throw new ClientError('failed-precondition', seats.message, 'seats')
        const now = new Date().toISOString()
        const result = { id, name: name.value, maxSeats: body.maxSeats, updatedAt: now }
        tx.update(ref, {
          name: name.value,
          phone: phone.value || null,
          notes,
          maxSeats: body.maxSeats,
          updatedAt: now,
          recentHistory: history(invitation, {
            at: now,
            action: 'update',
            summary: 'Datos de la invitación actualizados',
            actor: actor.email || actor.uid
          })
        })
        tx.set(opRef, { action: 'update', result, at: now })
        audit(tx, {
          invitationId: id,
          invitationName: name.value,
          action: 'update',
          summary: 'Datos de la invitación actualizados',
          actorUid: actor.uid,
          actorEmail: actor.email,
          atIso: now,
          changes: {
            name: { from: invitation.name, to: name.value },
            maxSeats: { from: invitation.maxSeats, to: body.maxSeats }
          }
        })
        return result
      })
    },

    async setInvitationActive({ actor, data }) {
      const body = asRecord(data)
      const id = mustId(body.id)
      const requestId = mustUuid(body.requestId)
      if (body.active !== true && body.active !== false) {
        throw new ClientError('invalid-argument', 'Indica si la invitación queda activa.')
      }
      const ref = db.collection('invitations').doc(id)
      return db.runTransaction(async (tx) => {
        const opRef = ref.collection('ops').doc(requestId)
        const invSnap = await tx.get(ref)
        const opSnap = await tx.get(opRef)
        if (opSnap.exists && opSnap.get('action') === 'active') return opSnap.get('result')
        if (!invSnap.exists) throw new ClientError('not-found', 'No se encontró la invitación.')
        const invitation = invSnap.data()
        const now = new Date().toISOString()
        const summary = body.active ? 'Invitación reactivada' : 'Invitación desactivada'
        const result = { id, active: body.active, updatedAt: now }
        tx.update(ref, {
          active: body.active,
          updatedAt: now,
          recentHistory: history(invitation, { at: now, action: 'active', summary, actor: actor.email || actor.uid })
        })
        tx.set(opRef, { action: 'active', result, at: now })
        audit(tx, {
          invitationId: id,
          invitationName: invitation.name,
          action: body.active ? 'activate' : 'deactivate',
          summary,
          actorUid: actor.uid,
          actorEmail: actor.email,
          atIso: now
        })
        return result
      })
    },

    async regenerateInvitationToken({ actor, data }) {
      const body = asRecord(data)
      const id = mustId(body.id)
      const requestId = mustUuid(body.requestId)
      const ref = db.collection('invitations').doc(id)
      const secretRef = ref.collection('secret').doc('link')
      const token = generateToken()
      const secret = secretPayload(token)
      const now = new Date().toISOString()
      return db.runTransaction(async (tx) => {
        const opRef = ref.collection('ops').doc(requestId)
        const invSnap = await tx.get(ref)
        const secretSnap = await tx.get(secretRef)
        const opSnap = await tx.get(opRef)
        if (!invSnap.exists) throw new ClientError('not-found', 'No se encontró la invitación.')
        if (opSnap.exists && opSnap.get('action') === 'regenerate') {
          if (secretSnap.exists && secretSnap.get('tokenHash') === opSnap.get('tokenHash') && secretSnap.get('stored') === true) {
            const key = encryptionKey()
            if (!key) throw new ClientError('failed-precondition', 'No se pudo recuperar el enlace generado.', 'not-stored')
            return { id, token: decryptToken(secretSnap.data(), key), stored: true, replayed: true }
          }
          throw new ClientError('failed-precondition', 'Ese enlace ya fue reemplazado de nuevo. Consulta el enlace vigente.', 'stale')
        }
        const invitation = invSnap.data()
        const previousHash = secretSnap.exists ? secretSnap.get('tokenHash') : null
        if (previousHash) {
          tx.set(db.collection('tokenIndex').doc(previousHash), {
            invitationId: id,
            status: 'revoked',
            revokedAt: now
          }, { merge: true })
        }
        tx.set(db.collection('tokenIndex').doc(secret.tokenHash), {
          invitationId: id,
          status: 'active',
          createdAt: now
        })
        tx.set(secretRef, { ...secret, updatedAt: now })
        tx.update(ref, {
          updatedAt: now,
          recentHistory: history(invitation, {
            at: now,
            action: 'regenerate',
            summary: 'Enlace regenerado y el anterior revocado',
            actor: actor.email || actor.uid
          })
        })
        tx.set(opRef, { action: 'regenerate', tokenHash: secret.tokenHash, at: now })
        audit(tx, {
          invitationId: id,
          invitationName: invitation.name,
          action: 'regenerate_token',
          summary: 'Enlace regenerado y el anterior revocado',
          actorUid: actor.uid,
          actorEmail: actor.email,
          atIso: now
        })
        return { id, token, stored: secret.stored === true, replayed: false }
      })
    },

    async revealInvitationLink({ actor, data }) {
      const body = asRecord(data)
      const id = mustId(body.id)
      const ref = db.collection('invitations').doc(id)
      const snap = await ref.get()
      if (!snap.exists) throw new ClientError('not-found', 'No se encontró la invitación.')
      const token = await readStoredToken(id)
      const now = new Date().toISOString()
      await db.collection('auditLogs').add({
        invitationId: id,
        invitationName: snap.get('name'),
        action: 'reveal_link',
        summary: 'Enlace consultado por el administrador',
        actorUid: actor.uid,
        actorEmail: actor.email,
        at: FieldValue.serverTimestamp(),
        atIso: now
      })
      await ref.update({
        updatedAt: now,
        recentHistory: history(snap.data(), {
          at: now,
          action: 'reveal_link',
          summary: 'Enlace consultado',
          actor: actor.email || actor.uid
        })
      })
      return { id, token, stored: true }
    },

    async adminUpdateRsvp({ actor, data }) {
      const body = asRecord(data)
      const id = mustId(body.id)
      const requestId = mustUuid(body.requestId)
      const ref = db.collection('invitations').doc(id)
      return db.runTransaction(async (tx) => {
        const opRef = ref.collection('ops').doc(requestId)
        const invSnap = await tx.get(ref)
        const opSnap = await tx.get(opRef)
        if (opSnap.exists && opSnap.get('action') === 'admin-rsvp') return opSnap.get('result')
        if (!invSnap.exists) throw new ClientError('not-found', 'No se encontró la invitación.')
        const invitation = invSnap.data()
        const decision = evaluateRsvp({
          attending: body.attending,
          guests: body.guests,
          maxSeats: invitation.maxSeats,
          checkedInCount: invitation.checkedInCount || 0,
          bypassWindow: true
        })
        if (!decision.ok) throw new ClientError('failed-precondition', decision.message, decision.code)
        const now = new Date().toISOString()
        const summary = decision.status === 'confirmado'
          ? `El administrador confirmó ${decision.confirmedCount} ${decision.confirmedCount === 1 ? 'persona' : 'personas'}`
          : 'El administrador marcó que no asistirá'
        const result = {
          id,
          status: decision.status,
          confirmedCount: decision.confirmedCount,
          respondedAt: now
        }
        tx.update(ref, {
          status: decision.status,
          confirmedCount: decision.confirmedCount,
          respondedAt: now,
          updatedAt: now,
          checkInStatus: deriveCheckInStatus(invitation.checkedInCount || 0, decision.confirmedCount),
          recentHistory: history(invitation, { at: now, action: 'admin_rsvp', summary, actor: actor.email || actor.uid })
        })
        tx.set(opRef, { action: 'admin-rsvp', result, at: now })
        audit(tx, {
          invitationId: id,
          invitationName: invitation.name,
          action: 'admin_rsvp',
          summary,
          actorUid: actor.uid,
          actorEmail: actor.email,
          atIso: now,
          changes: {
            status: { from: invitation.status, to: decision.status },
            confirmedCount: { from: invitation.confirmedCount || 0, to: decision.confirmedCount }
          }
        })
        return result
      })
    },

    async previewCheckIn(data) {
      const body = asRecord(data)
      const found = await locate(body.token)
      if (found.kind !== 'valid') throw tokenError(found.kind)
      const invitation = found.invitation
      const confirmedCount = invitation.confirmedCount || 0
      const checkedInCount = invitation.checkedInCount || 0
      return {
        id: found.invitationId,
        name: invitation.name,
        phone: invitation.phone || '',
        notes: invitation.notes || '',
        maxSeats: invitation.maxSeats,
        status: invitation.status,
        confirmedCount,
        checkedInCount,
        remaining: Math.max(0, confirmedCount - checkedInCount),
        checkInStatus: invitation.checkInStatus || 'pendiente',
        active: invitation.active !== false
      }
    },

    async commitCheckIn({ actor, data }) {
      const body = asRecord(data)
      const requestId = mustUuid(body.requestId)
      if (!isTokenShape(body.token)) throw tokenError('invalid')
      const indexRef = db.collection('tokenIndex').doc(hashToken(body.token))
      return db.runTransaction(async (tx) => {
        const indexSnap = await tx.get(indexRef)
        if (!indexSnap.exists) throw tokenError('invalid')
        if (indexSnap.get('status') === 'revoked') throw tokenError('revoked')
        const invitationId = indexSnap.get('invitationId')
        if (!isDocId(invitationId)) throw tokenError('invalid')
        const ref = db.collection('invitations').doc(invitationId)
        const opRef = ref.collection('ops').doc(requestId)
        const invSnap = await tx.get(ref)
        const opSnap = await tx.get(opRef)
        if (opSnap.exists && opSnap.get('action') === 'check-in') return opSnap.get('result')
        if (!invSnap.exists || invSnap.get('active') === false) throw tokenError(invSnap.exists ? 'inactive' : 'invalid')
        const invitation = invSnap.data()
        const decision = evaluateCheckIn({
          count: body.count,
          confirmedCount: invitation.confirmedCount || 0,
          checkedInCount: invitation.checkedInCount || 0,
          lastCheckInAt: invitation.lastCheckInAt || null,
          nowMs: Date.now(),
          confirmAdditional: body.confirmAdditional === true
        })
        if (!decision.ok) throw new ClientError('failed-precondition', decision.message, decision.code)
        const now = new Date().toISOString()
        const entry = {
          at: now,
          count: body.count,
          operatorUid: actor.uid,
          operatorEmail: actor.email || ''
        }
        const summary = `Ingresaron ${body.count} ${body.count === 1 ? 'persona' : 'personas'}`
        const result = {
          id: invitationId,
          name: invitation.name,
          maxSeats: invitation.maxSeats,
          confirmedCount: invitation.confirmedCount || 0,
          checkedInCount: decision.checkedInCount,
          remaining: decision.remaining,
          checkInStatus: decision.checkInStatus
        }
        tx.update(ref, {
          checkedInCount: decision.checkedInCount,
          checkInStatus: decision.checkInStatus,
          lastCheckInAt: now,
          updatedAt: now,
          checkIns: [...trimChecks(invitation.checkIns), entry],
          recentHistory: history(invitation, { at: now, action: 'check_in', summary, actor: actor.email || actor.uid })
        })
        tx.set(opRef, { action: 'check-in', result, at: now })
        audit(tx, {
          invitationId,
          invitationName: invitation.name,
          action: 'check_in',
          summary,
          actorUid: actor.uid,
          actorEmail: actor.email,
          atIso: now,
          changes: {
            checkedInCount: { from: invitation.checkedInCount || 0, to: decision.checkedInCount }
          }
        })
        return result
      })
    },

    async updateEventSettings({ actor, data }) {
      const sanitized = sanitizeEventSettings(data)
      if (sanitized.error) throw new ClientError('invalid-argument', sanitized.error)
      const now = new Date().toISOString()
      await settingsRef.set({ ...sanitized.value, updatedAt: now })
      await db.collection('auditLogs').add({
        invitationId: null,
        invitationName: sanitized.value.quinceaneraName,
        action: 'settings',
        summary: 'Configuración del evento actualizada',
        actorUid: actor.uid,
        actorEmail: actor.email,
        at: FieldValue.serverTimestamp(),
        atIso: now
      })
      return { ok: true, updatedAt: now }
    }
  }
}
