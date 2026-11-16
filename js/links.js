import { isTokenShape } from './policy.js'

function projectBasePath(pathname) {
  const path = String(pathname || '/')
  const segments = (path.startsWith('/') ? path : `/${path}`).split('/')
  const last = segments[segments.length - 1]
  if (last && /\.html?$/i.test(last)) segments.pop()
  const directory = segments.join('/')
  return directory.endsWith('/') ? directory : `${directory}/`
}

/** Enlace público de una invitación, en el mismo dominio y carpeta del panel. */
export function invitationUrl(token) {
  const location = globalThis.location
  const origin = location.origin
  const base = projectBasePath(location.pathname)
  return `${origin}${base}index.html?invitacion=${encodeURIComponent(token)}`
}

export function fillTemplate(template, vars) {
  return String(template || '').replace(/\{(nombre|quinceanera|fecha|enlace|cupos)\}/g, (_, key) => vars[key] ?? '')
}

export function whatsappShareUrl({ phone, message }) {
  const digits = String(phone || '').replace(/\D/g, '')
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(message)}`
}

export function tokenFromScan(value) {
  const text = String(value || '').trim()
  if (isTokenShape(text)) return text
  try {
    const url = new URL(text)
    const token = url.searchParams.get('invitacion')
    if (isTokenShape(token)) return token
  } catch {
    return null
  }
  return null
}
