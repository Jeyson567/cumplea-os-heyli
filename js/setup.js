import { canCreateAdminAccount, describeFailure, setupNextStep } from './access.js'
import {
  createUserWithEmailAndPassword,
  doc,
  getDoc,
  initFirebase,
  onAuthStateChanged,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut
} from './firebase-config.js'

const DESIGNATED_ADMIN_UID = 'mu81tHSQCARVz2GNe780uupXF4s1'

const createForm = document.getElementById('setup-form')
const loginForm = document.getElementById('setup-login')
const note = document.getElementById('setup-note')
const errorNode = document.getElementById('setup-error')
const resultNode = document.getElementById('setup-result')
const createButton = document.getElementById('setup-submit')
const loginButton = document.getElementById('setup-login-submit')

const state = { auth: null, db: null, completed: false, busy: false }

function line(text, className) {
  const node = document.createElement('p')
  if (className) node.className = className
  node.textContent = text
  return node
}

function showError(message) {
  errorNode.textContent = message || ''
}

function setBusy(button, busy, busyLabel, idleLabel) {
  state.busy = busy
  button.disabled = busy
  button.textContent = busy ? busyLabel : idleLabel
}

function lockCreate(message) {
  state.completed = true
  createForm.hidden = true
  for (const field of createForm.querySelectorAll('input, button')) field.disabled = true
  note.textContent = message
}

function goToPanel() {
  window.location.assign('admin.html')
}

function showAuthorization(user) {
  loginForm.hidden = true
  resultNode.hidden = false
  if (user.uid !== DESIGNATED_ADMIN_UID) {
    const leave = document.createElement('button')
    leave.className = 'btn'
    leave.type = 'button'
    leave.textContent = 'Cerrar esta sesión'
    leave.addEventListener('click', () => signOut(state.auth))
    resultNode.replaceChildren(
      line('Esta sesión no es el administrador indicado.', 'bad'),
      line(`UID de esta sesión: ${user.uid}`),
      line('No se creará otra cuenta ni se escribirá un permiso. Entra con la cuenta del administrador.'),
      leave
    )
    note.textContent = 'Usa la cuenta que ya existe.'
    return
  }
  const verify = document.createElement('button')
  verify.className = 'btn'
  verify.type = 'button'
  verify.textContent = 'Ya autoricé este UID'
  verify.addEventListener('click', () => confirmAuthorization(user, verify))
  resultNode.replaceChildren(
    line('Sesión iniciada. El permiso sigue dependiendo del documento en Firestore.', 'ok'),
    line(`UID: ${user.uid}`),
    line('En la base (default), admins/' + user.uid + ' debe existir y active debe ser true. Esta página no puede crearlo ni modificarlo.'),
    line(state.completed
      ? 'system/status ya bloquea cuentas nuevas. El administrador sigue entrando por el panel.'
      : 'Si todavía no existe system/status con completed = true, créalo para bloquear cuentas nuevas. No impide entrar al panel.'),
    verify
  )
  note.textContent = 'Pulsa el botón para comprobar el documento. Si es válido, se abre el panel.'
}

async function confirmAuthorization(user, button) {
  setBusy(button, true, 'Comprobando…', 'Ya autoricé este UID')
  showError('')
  try {
    const adminSnap = await getDoc(doc(state.db, 'admins', user.uid))
    const statusSnap = await getDoc(doc(state.db, 'system', 'status'))
    const completed = statusSnap.exists() && statusSnap.data().completed === true
    const step = setupNextStep({
      completed,
      signedIn: true,
      adminExists: adminSnap.exists(),
      active: adminSnap.exists() ? adminSnap.data().active : false
    })
    if (step === 'missing-document') {
      showError('No existe admins/' + user.uid + ' en la base (default). Créalo en Firebase Console con active = true. Esta página no tiene permiso para crearlo.')
      return
    }
    if (step === 'inactive-document') {
      showError('El documento admins/' + user.uid + ' existe, pero active no es true. Cámbialo en Firebase Console. Esta página no puede modificarlo.')
      return
    }
    note.textContent = completed
      ? 'Permiso confirmado. La instalación sigue bloqueada para cuentas nuevas. Abriendo el panel…'
      : 'Permiso confirmado. Abriendo el panel. Para bloquear cuentas nuevas, crea system/status con completed = true.'
    goToPanel()
  } catch (error) {
    showError(describeFailure(error, 'No se pudo comprobar el documento de administrador.'))
  } finally {
    if (document.body.contains(button)) setBusy(button, false, 'Comprobando…', 'Ya autoricé este UID')
  }
}

async function markBootstrap(user) {
  try {
    await setDoc(doc(state.db, 'system', 'bootstrap'), {
      pendingUid: user.uid,
      createdAt: serverTimestamp()
    })
  } catch (error) {
    showError(describeFailure(error, 'No se anotó el UID pendiente. Eso no concede permiso.'))
  }
}

async function prepare() {
  if (location.protocol === 'file:') {
    lockCreate('Abre esta página con un servidor local. No la abras como archivo.')
    loginForm.hidden = true
    return
  }
  const firebase = await initFirebase()
  state.auth = firebase.auth
  state.db = firebase.db
  loginButton.disabled = false
  try {
    const statusSnap = await getDoc(doc(state.db, 'system', 'status'))
    if (statusSnap.exists() && statusSnap.data().completed === true) {
      lockCreate('La instalación está bloqueada para cuentas nuevas. El administrador entra aquí o directamente en el panel.')
    }
  } catch (error) {
    showError(describeFailure(error, 'No se pudo leer system/status.'))
  }
  onAuthStateChanged(state.auth, (user) => {
    if (!user) {
      loginForm.hidden = false
      resultNode.hidden = true
      if (!state.completed) note.textContent = 'Entra con la cuenta del administrador. No se creará otra.'
      return
    }
    showAuthorization(user)
  })
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (loginButton.disabled) return
  showError('')
  setBusy(loginButton, true, 'Entrando…', 'Entrar y verificar')
  try {
    await signInWithEmailAndPassword(
      state.auth,
      document.getElementById('setup-login-email').value.trim(),
      document.getElementById('setup-login-password').value
    )
    loginForm.reset()
  } catch (error) {
    showError(describeFailure(error, 'No se pudo iniciar sesión.'))
  } finally {
    setBusy(loginButton, false, 'Entrando…', 'Entrar y verificar')
  }
})

createForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (state.busy || createButton.disabled) return
  showError('')
  if (!canCreateAdminAccount({ completed: state.completed, designatedUid: DESIGNATED_ADMIN_UID })) {
    showError('El administrador ya existe. Entra con su correo. Esta pantalla no crea otra cuenta ni cambia la contraseña.')
    return
  }
  const email = document.getElementById('setup-email').value.trim()
  const password = document.getElementById('setup-password').value
  const repeat = document.getElementById('setup-password-2').value
  if (password !== repeat) {
    showError('Las contraseñas no coinciden.')
    return
  }
  if (password.length < 8 || password.length > 128) {
    showError('La contraseña debe tener entre 8 y 128 caracteres.')
    return
  }
  setBusy(createButton, true, 'Creando…', 'Crear cuenta')
  try {
    const credential = await createUserWithEmailAndPassword(state.auth, email, password)
    createForm.reset()
    await markBootstrap(credential.user)
    showAuthorization(credential.user)
  } catch (error) {
    showError(describeFailure(error, 'No se pudo crear la cuenta. No se guardó ninguna contraseña en el proyecto.'))
  } finally {
    setBusy(createButton, false, 'Creando…', 'Crear cuenta')
  }
})

prepare().catch((error) => {
  showError(describeFailure(error, 'No se pudo preparar la instalación.'))
})
