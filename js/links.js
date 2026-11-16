import { isTokenShape } from './policy.js'

function isAdminSegment(segment) {
  return /^admin(?:\.html?)?$/i.test(String(segment || ''))
}

function projectBasePath(pathname) {
  const segments = String(pathname || '/').split('/').filter(Boolean)
  const last = segments[segments.length - 1] || ''
  if (/^index\.html?$/i.test(last) && isAdminSegment(segments[segments.length - 2])) {
    segments.splice(-2, 2)
  } else if (isAdminSegment(last)) {
    segments.pop()
  }
  return segments.length ? `/${segments.join('/')}/` : '/'
}

/** Enlace público de una invitación, en el origen y la carpeta del proyecto. */
export function invitationUrl(token) {
  const { origin, pathname } = globalThis.location
  return `${origin}${projectBasePath(pathname)}?invitacion=${encodeURIComponent(token)}`
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
