import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch
} from './firebase-config.js'
import { generateToken } from './token.js'
import {
  evaluateCheckIn,
  evaluateRsvp,
  evaluateSeatChange,
  validateName,
  validatePhone
} from './policy.js'

function fail(message, code = 'invalid') {
  const error = new Error(message)
  error.code = code
  error.reason = code
  return error
}

export function stamp(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  return ''
}

export function settingsFromDoc(data = {}) {
  const next = { ...data }
  if (next.rsvpDeadline && typeof next.rsvpDeadline !== 'string') next.rsvpDeadline = stamp(next.rsvpDeadline)
  return next
}

function history(existing, summary, actor) {
  const entry = { at: new Date().toISOString(), summary, actor: actor || 'panel' }
  const previous = Array.isArray(existing)
    ? existing.filter((item) => item && typeof item.summary === 'string').slice(-11)
    : []
  return [...previous, entry]
}

function invitationRef(db, id) {
  return doc(db, 'invitations', id)
}

function privateRef(db, id) {
  return doc(db, 'invitations', id, 'private', 'profile')
}

export function publicInvitation(id, data = {}) {
  return {
    id,
    name: data.name || '',
    maxSeats: data.maxSeats || 0,
    status: data.status || 'pendiente',
    confirmedCount: data.confirmedCount || 0,
    checkedInCount: data.checkedInCount || 0,
    active: data.active !== false,
    respondedAt: stamp(data.respondedAt),
    lastCheckInAt: stamp(data.lastCheckInAt),
    createdAt: stamp(data.createdAt),
    updatedAt: stamp(data.updatedAt),
    recentHistory: Array.isArray(data.recentHistory) ? data.recentHistory : []
  }
}

export async function userIsAdmin(db, uid) {
  const snap = await getDoc(doc(db, 'admins', uid))
  return snap.exists()
}

export async function loadInvitation(db, token) {
  let snap
  try {
    snap = await getDoc(invitationRef(db, token))
  } catch (error) {
    if (error?.code === 'permission-denied') {
      throw fail('Este enlace no corresponde a una invitación disponible.', 'permission-denied')
    }
    throw fail('No pudimos consultar tu invitación.', error?.code || 'unavailable')
  }
  if (!snap.exists()) throw fail('Este enlace no corresponde a una invitación válida.', 'not-found')
  return publicInvitation(snap.id, snap.data())
}

function deadlineMs(settings) {
  const parsed = Date.parse(stamp(settings?.rsvpDeadline) || '')
  return Number.isFinite(parsed) ? parsed : null
}

export async function submitGuestRsvp(db, token, { attending, guests, maxSeats, checkedInCount = 0, rsvpOpen = true, deadline = '' }) {
  const decision = evaluateRsvp({
    attending,
    guests,
    maxSeats,
    checkedInCount,
    rsvpOpen,
    deadlineMs: deadlineMs({ rsvpDeadline: deadline }),
    nowMs: Date.now()
  })
  if (!decision.ok) throw fail(decision.message, decision.code || 'invalid')
  const now = new Date().toISOString()
  try {
    await setDoc(invitationRef(db, token), {
      status: decision.status,
      confirmedCount: decision.confirmedCount,
      respondedAt: now,
      updatedAt: now
    }, { merge: true })
  } catch (error) {
    if (error?.code === 'permission-denied') {
      throw fail('La confirmación no se aceptó. Revisa los cupos, la fecha límite o que el enlace siga activo.', 'permission-denied')
    }
    throw fail('No pudimos guardar tu respuesta.', error?.code || 'unavailable')
  }
  return { status: decision.status, confirmedCount: decision.confirmedCount, respondedAt: now }
}

function guestInput({ name, phone, maxSeats, notes, confirmedCount = 0, checkedInCount = 0 }) {
  const cleanName = validateName(name)
  if (cleanName.error) throw fail(cleanName.error)
  const cleanPhone = validatePhone(phone)
  if (cleanPhone.error) throw fail(cleanPhone.error)
  const seats = evaluateSeatChange({ maxSeats: Number(maxSeats), confirmedCount, checkedInCount })
  if (!seats.ok) throw fail(seats.message)
  const cleanNotes = String(notes || '').trim().slice(0, 500)
  return { name: cleanName.value, phone: cleanPhone.value, maxSeats: Number(maxSeats), notes: cleanNotes }
}

async function writeAudit(batch, db, { action, summary, actor, invitationId }) {
  const ref = doc(collection(db, 'auditLogs'))
  batch.set(ref, {
    action,
    summary: String(summary).slice(0, 300),
    actor: String(actor || 'panel').slice(0, 120),
    invitationId: String(invitationId || '').slice(0, 80),
    at: serverTimestamp()
  })
}

export async function createInvitation(db, input, actor) {
  const clean = guestInput(input)
  const token = generateToken()
  const now = new Date().toISOString()
  const batch = writeBatch(db)
  batch.set(invitationRef(db, token), {
    name: clean.name,
    maxSeats: clean.maxSeats,
    status: 'pendiente',
    confirmedCount: 0,
    checkedInCount: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
    respondedAt: null,
    lastCheckInAt: null,
    recentHistory: history([], 'Invitación creada', actor)
  })
  batch.set(privateRef(db, token), { phone: clean.phone, notes: clean.notes })
  await writeAudit(batch, db, { action: 'crear', summary: `Invitación creada para ${clean.name}`, actor, invitationId: token })
  await batch.commit()
  return { token, stored: true, name: clean.name }
}

export async function updateInvitation(db, guest, input, actor) {
  const clean = guestInput({
    ...input,
    confirmedCount: guest.confirmedCount || 0,
    checkedInCount: guest.checkedInCount || 0
  })
  const now = new Date().toISOString()
  const batch = writeBatch(db)
  batch.set(invitationRef(db, guest.id), {
    name: clean.name,
    maxSeats: clean.maxSeats,
    updatedAt: now,
    recentHistory: history(guest.recentHistory, 'Datos actualizados', actor)
  }, { merge: true })
  batch.set(privateRef(db, guest.id), { phone: clean.phone, notes: clean.notes })
  await writeAudit(batch, db, { action: 'editar', summary: `Datos actualizados de ${clean.name}`, actor, invitationId: guest.id })
  await batch.commit()
}

export async function setInvitationActive(db, guest, active, actor) {
  const now = new Date().toISOString()
  const batch = writeBatch(db)
  batch.set(invitationRef(db, guest.id), {
    active: Boolean(active),
    updatedAt: now,
    recentHistory: history(guest.recentHistory, active ? 'Invitación reactivada' : 'Invitación desactivada', actor)
  }, { merge: true })
  await writeAudit(batch, db, {
    action: active ? 'reactivar' : 'desactivar',
    summary: `${active ? 'Reactivada' : 'Desactivada'} la invitación de ${guest.name}`,
    actor,
    invitationId: guest.id
  })
  await batch.commit()
}

export async function adminUpdateRsvp(db, guest, { attending, guests }, actor) {
  const decision = evaluateRsvp({
    attending,
    guests,
    maxSeats: guest.maxSeats,
    checkedInCount: guest.checkedInCount || 0,
    bypassWindow: true
  })
  if (!decision.ok) throw fail(decision.message, decision.code || 'invalid')
  const now = new Date().toISOString()
  const summary = decision.status === 'confirmado'
    ? `Confirmó ${decision.confirmedCount}`
    : 'Indicó que no asistirá'
  const batch = writeBatch(db)
  batch.set(invitationRef(db, guest.id), {
    status: decision.status,
    confirmedCount: decision.confirmedCount,
    respondedAt: now,
    updatedAt: now,
    recentHistory: history(guest.recentHistory, summary, actor)
  }, { merge: true })
  await writeAudit(batch, db, { action: 'respuesta', summary: `${guest.name}: ${summary}`, actor, invitationId: guest.id })
  await batch.commit()
}

export async function regenerateInvitation(db, guest, actor) {
  const token = generateToken()
  const now = new Date().toISOString()
  const batch = writeBatch(db)
  batch.set(invitationRef(db, token), {
    name: guest.name,
    maxSeats: guest.maxSeats,
    status: guest.status || 'pendiente',
    confirmedCount: guest.confirmedCount || 0,
    checkedInCount: guest.checkedInCount || 0,
    active: true,
    createdAt: now,
    updatedAt: now,
    respondedAt: guest.respondedAt || null,
    lastCheckInAt: guest.lastCheckInAt || null,
    recentHistory: history([], 'Enlace nuevo', actor)
  })
  batch.set(privateRef(db, token), { phone: guest.phone || '', notes: guest.notes || '' })
  batch.set(invitationRef(db, guest.id), {
    active: false,
    updatedAt: now,
    recentHistory: history(guest.recentHistory, 'Enlace revocado', actor)
  }, { merge: true })
  await writeAudit(batch, db, { action: 'regenerar', summary: `Enlace nuevo para ${guest.name}`, actor, invitationId: token })
  await batch.commit()
  return { token, stored: true }
}

export async function commitCheckIn(db, guest, { count, confirmAdditional, actor }) {
  const decision = evaluateCheckIn({
    count: Number(count),
    confirmedCount: guest.confirmedCount || 0,
    checkedInCount: guest.checkedInCount || 0,
    lastCheckInAt: guest.lastCheckInAt || null,
    nowMs: Date.now(),
    confirmAdditional
  })
  if (!decision.ok) throw fail(decision.message, decision.code || 'invalid')
  const now = new Date().toISOString()
  const batch = writeBatch(db)
  batch.set(invitationRef(db, guest.id), {
    checkedInCount: decision.checkedInCount,
    lastCheckInAt: now,
    updatedAt: now,
    recentHistory: history(guest.recentHistory, `Ingresaron ${count}`, actor)
  }, { merge: true })
  await writeAudit(batch, db, {
    action: 'entrada',
    summary: `${guest.name}: ingresaron ${count}`,
    actor,
    invitationId: guest.id
  })
  await batch.commit()
  return decision
}

export async function saveEventSettings(db, value) {
  const payload = { ...value }
  const deadline = Date.parse(payload.rsvpDeadline || '')
  if (Number.isFinite(deadline)) payload.rsvpDeadlineAt = new Date(deadline)
  await setDoc(doc(db, 'eventSettings', 'public'), payload, { merge: true })
}
