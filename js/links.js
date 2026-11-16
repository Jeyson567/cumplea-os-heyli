import { isTokenShape } from './policy.js'

/** Dominio real de Firebase Hosting de este proyecto. */
export const PUBLIC_SITE_ORIGIN = 'https://cumpleheyli.web.app'

function configuredOrigin(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`)
    if (url.protocol !== 'https:' || url.username || url.password) return ''
    return url.origin
  } catch {
    return ''
  }
}

function locationOrigin(locationLike) {
  if (!locationLike) return ''
  if (typeof locationLike === 'string') {
    try { return new URL(locationLike).origin } catch { return '' }
  }
  return typeof locationLike.origin === 'string' ? locationLike.origin : ''
}

function isLocalOrigin(origin) {
  try {
    const host = new URL(origin).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}

/**
 * Enlace público de una invitación. Siempre abre index.html con su token.
 * No usa la ruta de admin.html.
 */
export function invitationUrl(token, settings, locationLike = globalThis.location) {
  const configured = configuredOrigin(settings?.publicSiteUrl)
  const here = locationOrigin(locationLike)
  const origin = configured || (isLocalOrigin(here) ? here : PUBLIC_SITE_ORIGIN)
  return `${origin}/index.html?invitacion=${encodeURIComponent(token)}`
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
