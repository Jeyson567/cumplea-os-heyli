import { isTokenShape } from './policy.js'

export function invitationUrl(token, settings, href = window.location.href) {
  const configured = String(settings?.publicSiteUrl || '').replace(/\/$/, '')
  if (configured) return `${configured}/?invitacion=${encodeURIComponent(token)}`
  const url = new URL(href)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/admin\.html$/i, '').replace(/index\.html$/i, '')
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  url.searchParams.set('invitacion', token)
  return url.toString()
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
