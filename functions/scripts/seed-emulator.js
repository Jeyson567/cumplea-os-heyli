import { randomBytes, randomUUID } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { eventDefaults } from '../../js/event-defaults.js'
import { createApi } from '../src/service.js'

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || ''
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || ''
const local = /^(127\.0\.0\.1|localhost):\d+$/
if (!local.test(firestoreHost) || !local.test(authHost)) {
  console.error('Abortado. Este script solo escribe en los emuladores locales y no tocó producción.')
  process.exit(1)
}

process.env.GCLOUD_PROJECT = 'cumpleheyli'
initializeApp({ projectId: 'cumpleheyli' })
const db = getFirestore()
const auth = getAuth()
const email = 'admin.prueba@heyli.test'
const password = randomBytes(12).toString('base64url')

let user
try {
  user = await auth.getUserByEmail(email)
} catch {
  user = await auth.createUser({ email, password, emailVerified: true })
}
await auth.setCustomUserClaims(user.uid, { admin: true })

const settingsRef = db.collection('eventSettings').doc('public')
const settings = await settingsRef.get()
if (!settings.exists) {
  await settingsRef.set({ ...eventDefaults, updatedAt: new Date().toISOString() })
  console.log('Configuración base creada en el emulador.')
} else {
  console.log('La configuración del emulador ya existía y no se reemplazó.')
}

const api = createApi(db)
const created = await api.createInvitation({
  actor: { uid: user.uid, email },
  data: {
    requestId: randomUUID(),
    name: 'Familia de prueba',
    phone: '',
    maxSeats: 4,
    notes: 'Registro solo para el emulador'
  }
})

console.log('Usuario de prueba del emulador:', email)
console.log('Contraseña temporal del emulador:', password)
console.log('Invitación:', `http://127.0.0.1:5000/?invitacion=${created.token}&emuladores=1`)
console.log('Panel:', 'http://127.0.0.1:5000/admin.html?emuladores=1')
