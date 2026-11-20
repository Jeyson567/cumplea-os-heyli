export function adminIsActive(data) {
  return data?.active === true
}

export function canCreateAdminAccount({ completed, designatedUid }) {
  return completed !== true && !designatedUid
}

/**
 * Qué debe hacer la instalación después de leer Auth y Firestore.
 * Nunca concede el permiso: solo describe el siguiente paso.
 */
export function setupNextStep({ completed, signedIn, adminExists, active }) {
  if (completed === true && signedIn !== true) return 'panel-only'
  if (signedIn !== true) return 'sign-in'
  if (adminExists !== true) return 'missing-document'
  if (active !== true) return 'inactive-document'
  return 'open-panel'
}

export function authFailureText(code) {
  const value = String(code || '')
  if (value === 'auth/unauthorized-domain') {
    return 'Este dominio no está autorizado en Firebase Authentication. En jsagency-b607c, Authentication, Settings, Authorized domains, agrega el dominio de esta página. El dominio oficial es heilyxv.com. localhost ya está permitido.'
  }
  if (value === 'auth/email-already-in-use') {
    return 'Ese correo ya tiene cuenta. Entra con ella. No se creará otra cuenta ni se cambiará la contraseña.'
  }
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(value)) {
    return 'Correo o contraseña incorrectos.'
  }
  if (value === 'auth/invalid-email') return 'El correo no es válido.'
  if (value === 'auth/weak-password') return 'La contraseña es demasiado débil. Usa al menos 8 caracteres.'
  if (value === 'auth/operation-not-allowed') return 'El acceso con correo y contraseña no está activado en Firebase Authentication.'
  if (value === 'auth/too-many-requests') return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'
  if (value === 'auth/network-request-failed') return 'No hay conexión con Firebase Authentication.'
  if (value === 'permission-denied' || value.endsWith('/permission-denied')) {
    return 'Firestore rechazó la operación. Esta cuenta no tiene permiso o las reglas publicadas no coinciden con el proyecto.'
  }
  if (value === 'failed-precondition' || value.endsWith('/failed-precondition')) {
    return 'Firestore no pudo completar la consulta. Falta un índice o la base todavía no está lista.'
  }
  if (value === 'unavailable' || value.endsWith('/unavailable')) return 'Firestore no está disponible en este momento.'
  return ''
}

export function describeFailure(error, fallback) {
  const code = String(error?.code || error?.reason || '')
  const known = authFailureText(code)
  if (known) return known
  const message = error?.message || fallback
  if (code && message && !message.includes(code)) return `${message} (${code})`
  return message || fallback
}
