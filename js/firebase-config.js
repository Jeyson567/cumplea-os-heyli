import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js'

/** Identificadores públicos del cliente. La autorización real está en Firestore Rules. */
export const firebaseConfig = {
  apiKey: 'AIzaSyBTD6Xe6nGUrYkQWxoei92_M0zUjGHL_uM',
  authDomain: 'jsagency-b607c.firebaseapp.com',
  projectId: 'jsagency-b607c',
  storageBucket: 'jsagency-b607c.firebasestorage.app',
  messagingSenderId: '890922772238',
  appId: '1:890922772238:web:e0b4e883f6ab440f4d195f'
}

/** Vacío hasta registrar la app en App Check. No bloquea la invitación. */
export const APP_CHECK_SITE_KEY = ''

let started = null

async function startFirebase() {
  const app = initializeApp(firebaseConfig)
  const auth = getAuth(app)
  // En este proyecto la base se llama default. La base automática (default) no existe.
  const db = getFirestore(app, 'default')
  if (shouldUseEmulators()) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
  await setPersistence(auth, browserLocalPersistence).catch(() => {})
  if (APP_CHECK_SITE_KEY) {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import('https://www.gstatic.com/firebasejs/13.3.0/firebase-app-check.js')
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    })
  }
  return { app, auth, db }
}

export function shouldUseEmulators() {
  const host = location.hostname
  const local = host === 'localhost' || host === '127.0.0.1'
  if (!local) return false
  const params = new URLSearchParams(location.search)
  return params.has('emuladores') || localStorage.getItem('heyli-emuladores') === '1'
}

export function initFirebase() {
  if (!started) {
    started = startFirebase().catch((error) => {
      started = null
      throw error
    })
  }
  return started
}

export {
  collection,
  createUserWithEmailAndPassword,
  doc,
  getDoc,
  onAuthStateChanged,
  onSnapshot,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  updateDoc,
  signOut,
  writeBatch
}
