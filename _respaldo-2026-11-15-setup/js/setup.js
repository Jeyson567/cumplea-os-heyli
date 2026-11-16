import {
  createUserWithEmailAndPassword,
  doc,
  getDoc,
  initFirebase,
  onAuthStateChanged,
  serverTimestamp,
  setDoc,
  signOut
} from './firebase-config.js'

const form = document.getElementById('setup-form')
const note = document.getElementById('setup-note')
const errorNode = document.getElementById('setup-error')
const resultNode = document.getElementById('setup-result')
const submit = document.getElementById('setup-submit')

const state = { auth: null, db: null, completed: false }

function line(text, className) {
  const node = document.createElement('p')
  if (className) node.className = className
  node.textContent = text
  return node
}

function showError(message) {
  errorNode.textContent = message || ''
}

function lock(message) {
  state.completed = true
  form.hidden = true
  for (const field of form.querySelectorAll('input, button')) field.disabled = true
  resultNode.hidden = false
  resultNode.replaceChildren(line(message, 'ok'))
  note.textContent = 'La instalación está marcada como completada. Esta pantalla ya no crea cuentas.'
}

function authMessage(error) {
  const code = error?.code || ''
  if (code === 'auth/email-already-in-use') {
    return 'Ese correo ya existe en Authentication. Abre Firebase Console, copia el UID de ese usuario y créalo a mano en admins. Esta pantalla no recupera la contraseña.'
  }
  if (code === 'auth/operation-not-allowed') {
    return 'El proveedor Correo/contraseña no está activado. En Firebase Console, Authentication, método de acceso, actívalo y vuelve a intentarlo.'
  }
  if (code === 'auth/invalid-email') return 'El correo no es válido.'
  if (code === 'auth/weak-password') return 'La contraseña es demasiado débil para Firebase. Usa al menos 8 caracteres.'
  if (code === 'auth/network-request-failed') return 'No hay conexión con Firebase Authentication.'
  return 'No se pudo crear la cuenta. No se guardó ninguna contraseña en el proyecto.'
}

function showAuthorization(user) {
  form.hidden = true
  resultNode.hidden = false
  const verify = document.createElement('button')
  verify.className = 'btn'
  verify.type = 'button'
  verify.textContent = 'Ya autoricé este UID'
  verify.addEventListener('click', () => confirmAuthorization(user, verify))
  resultNode.replaceChildren(
    line('La cuenta ya existe en Firebase Authentication. Todavía no es administradora.', 'ok'),
    line(`UID: ${user.uid}`),
    line('Copia ese UID. En Firebase Console, proyecto jsagency-b607c, abre Firestore y crea el documento admins/' + user.uid + '. Puedes añadir el campo active con el valor true. Las reglas no dejan que esta página lo cree.'),
    line('Para bloquear esta pantalla, crea también system/status con el campo completed en true (booleano). Ese documento tampoco puede escribirlo el navegador.'),
    line('Cuando el documento de admins exista, pulsa el botón. Luego entra por admin.html.'),
    line('El plan Spark no puede desactivar por completo el registro público de Authentication. Una cuenta nueva no administra nada: solo el documento creado a mano en admins otorga permiso.'),
    verify
  )
  note.textContent = 'Autoriza el UID en Firebase Console. Esta página no puede hacerlo sola.'
}

async function confirmAuthorization(user, button) {
  button.disabled = true
  showError('')
  try {
    const adminSnap = await getDoc(doc(state.db, 'admins', user.uid))
    const statusSnap = await getDoc(doc(state.db, 'system', 'status'))
    if (!adminSnap.exists()) {
      showError('Todavía no existe el documento admins/' + user.uid + '. Créalo en Firebase Console. El navegador no tiene permiso para crearlo.')
      button.disabled = false
      return
    }
    if (statusSnap.exists() && statusSnap.data().completed === true) {
      await signOut(state.auth).catch(() => {})
      lock('Este UID ya está autorizado y system/status.completed es true. La instalación quedó bloqueada. Entra por admin.html.')
      return
    }
    note.textContent = 'El UID ya es administrador. Falta bloquear esta pantalla: en Firestore crea system/status con completed = true y pulsa de nuevo el botón.'
    button.disabled = false
  } catch (error) {
    showError(error?.code === 'permission-denied'
      ? 'Firestore rechazó la lectura. Publica las reglas de este proyecto antes de autorizar el UID.'
      : 'No se pudo comprobar el documento de administrador.')
    button.disabled = false
  }
}

async function markBootstrap(user) {
  try {
    await setDoc(doc(state.db, 'system', 'bootstrap'), {
      pendingUid: user.uid,
      createdAt: serverTimestamp()
    })
  } catch {
    /* El documento solo puede crearse una vez y no concede permiso. */
  }
}

async function prepare() {
  if (location.protocol === 'file:') {
    lock('Abre esta página con la extensión Live Server de VS Code. No la abras como archivo.')
    return
  }
  const firebase = await initFirebase()
  state.auth = firebase.auth
  state.db = firebase.db
  try {
    const statusSnap = await getDoc(doc(state.db, 'system', 'status'))
    if (statusSnap.exists() && statusSnap.data().completed === true) {
      lock('La instalación ya está completada en system/status. Esta pantalla queda bloqueada.')
      return
    }
  } catch (error) {
    showError(error?.code === 'permission-denied'
      ? 'No se pudo leer system/status. Publica las reglas de Firestore de este proyecto.'
      : 'No se pudo leer el estado de la instalación.')
  }
  onAuthStateChanged(state.auth, (user) => {
    if (state.completed) return
    if (user) showAuthorization(user)
    else {
      form.hidden = false
      resultNode.hidden = true
      note.textContent = 'Crea la cuenta. Después autoriza su UID a mano en Firebase Console.'
    }
  })
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (state.completed || submit.disabled) return
  showError('')
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
  submit.disabled = true
  try {
    const credential = await createUserWithEmailAndPassword(state.auth, email, password)
    form.reset()
    await markBootstrap(credential.user)
    showAuthorization(credential.user)
  } catch (error) {
    showError(authMessage(error))
    submit.disabled = false
  }
})

prepare().catch(() => {
  showError('No se pudo preparar la instalación.')
})
