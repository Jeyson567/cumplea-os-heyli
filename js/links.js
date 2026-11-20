import { isTokenShape } from './policy.js'

const OFFICIAL_SITE = 'http://heilyxv.com'

/** Enlace público de una invitación, siempre en el dominio oficial. */
export function invitationUrl(token) {
  return `${OFFICIAL_SITE}/?invitacion=${encodeURIComponent(token)}`
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
