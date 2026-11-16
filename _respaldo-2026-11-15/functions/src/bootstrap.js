import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { bootstrapDecision, secretsMatch, validateBootstrapAccount } from './bootstrap-policy.js'
import { ClientError } from './errors.js'

async function findAdminUser(auth) {
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    const found = page.users.find((user) => user.customClaims?.admin === true)
    if (found) return found
    pageToken = page.pageToken
  } while (pageToken)
  return null
}

async function markComplete(ref, user) {
  await ref.set({
    status: 'completed',
    completed: true,
    email: user.email || null,
    uid: user.uid,
    completedAt: FieldValue.serverTimestamp(),
    completedAtIso: new Date().toISOString()
  }, { merge: true })
}

export function createBootstrap(db, auth = getAuth()) {
  const ref = db.doc('system/bootstrap')

  return {
    async status() {
      const snap = await ref.get()
      return { completed: snap.exists && snap.get('completed') === true }
    },

    async install({ email, password, secret, expectedSecret }) {
      if (typeof expectedSecret !== 'string' || expectedSecret.length < 16) {
        throw new ClientError(
          'failed-precondition',
          'Falta el secreto de instalación en Cloud Functions. No se creó ningún usuario.',
          'secret-missing'
        )
      }
      if (!secretsMatch(secret, expectedSecret)) {
        throw new ClientError('permission-denied', 'El secreto de instalación no es válido.', 'secret')
      }

      const account = validateBootstrapAccount({ email, password })
      if (!account.ok) throw new ClientError('invalid-argument', account.error, 'input')

      const anyAdmin = await findAdminUser(auth)
      const snap = await ref.get()
      let existing = null
      try {
        existing = await auth.getUserByEmail(account.email)
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error
      }

      const pendingAt = Date.parse(snap.exists ? snap.get('pendingAtIso') || '' : '')
      const decision = bootstrapDecision({
        completed: snap.exists && snap.get('completed') === true,
        pendingEmail: snap.exists ? String(snap.get('email') || '') : '',
        pendingAgeMs: Number.isFinite(pendingAt) ? Date.now() - pendingAt : Number.POSITIVE_INFINITY,
        pendingStatus: snap.exists ? String(snap.get('status') || '') : '',
        email: account.email,
        userExists: Boolean(existing),
        userIsAdmin: existing?.customClaims?.admin === true,
        anyAdmin: Boolean(anyAdmin)
      })

      if (decision.action === 'finish-existing') {
        await markComplete(ref, existing)
        return { created: false, email: account.email, uid: existing.uid, admin: true }
      }
      if (decision.reason === 'completed') {
        if (anyAdmin && !(snap.exists && snap.get('completed') === true)) await markComplete(ref, anyAdmin)
        throw new ClientError(
          'already-exists',
          'La instalación ya fue completada. Este procedimiento quedó bloqueado.',
          'completed'
        )
      }
      if (decision.reason === 'pending') {
        throw new ClientError(
          'aborted',
          'Hay una instalación en curso. Espera dos minutos e inténtalo de nuevo.',
          'pending'
        )
      }
      if (decision.reason === 'email-exists') {
        throw new ClientError(
          'already-exists',
          'Ese correo ya existe en Authentication y no es administrador. Elige otro correo. No se otorgó ningún permiso.',
          'email-exists'
        )
      }

      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref)
        if (current.exists && current.get('completed') === true) {
          throw new ClientError(
            'already-exists',
            'La instalación ya fue completada. Este procedimiento quedó bloqueado.',
            'completed'
          )
        }
        tx.set(ref, {
          status: 'pending',
          completed: false,
          email: account.email,
          pendingAtIso: new Date().toISOString()
        }, { merge: true })
      })

      let user
      try {
        user = await auth.createUser({
          email: account.email,
          password,
          disabled: false
        })
      } catch (error) {
        if (error?.code !== 'auth/email-already-exists') throw error
        const again = await auth.getUserByEmail(account.email)
        if (again.customClaims?.admin === true) {
          await markComplete(ref, again)
          return { created: false, email: account.email, uid: again.uid, admin: true }
        }
        throw new ClientError(
          'already-exists',
          'Ese correo ya existe en Authentication y no es administrador. Elige otro correo. No se otorgó ningún permiso.',
          'email-exists'
        )
      }

      await auth.setCustomUserClaims(user.uid, { admin: true })
      const verified = await auth.getUser(user.uid)
      if (verified.customClaims?.admin !== true) {
        throw new ClientError(
          'internal',
          'El usuario se creó, pero el permiso de administrador no quedó asignado. No se creará otra cuenta.',
          'claim'
        )
      }

      await markComplete(ref, verified)
      await db.collection('auditLogs').add({
        action: 'bootstrap',
        summary: 'Instalación inicial del administrador',
        actor: account.email,
        uid: verified.uid,
        at: FieldValue.serverTimestamp(),
        atIso: new Date().toISOString()
      })
      return { created: true, email: account.email, uid: verified.uid, admin: true }
    }
  }
}
