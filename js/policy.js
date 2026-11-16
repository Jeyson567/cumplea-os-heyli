/**
 * Validación compartida entre el navegador y Cloud Functions.
 * Este archivo debe permanecer idéntico a js/policy.js.
 * El servidor es la autoridad: el navegador solo adelanta errores.
 */

export const MIN_SEATS = 1
export const MAX_SEATS = 25
export const CHECKIN_GUARD_MS = 20_000

export const DEFAULT_COLORS = {
  ivory: '#F6F1EA',
  rose: '#C9898B',
  champagne: '#F3E6D4',
  gold: '#A68556',
  ink: '#3A302E'
}

const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9 ._() -]{0,80}\.(jpe?g|png|webp|gif|svg)$/i
const AUDIO_FILE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}\.(mp3|m4a|ogg|wav)$/i
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const MAP_HOSTS = new Set(['www.google.com', 'maps.google.com', 'google.com', 'goo.gl', 'maps.app.goo.gl'])
const SPOTIFY_KINDS = new Set(['track', 'album', 'playlist', 'episode'])

export function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function cleanMultiline(value, max) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
}

export function isDocId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9]{20}$/.test(value)
}

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function isTokenShape(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

export function isSafeFileName(value, pattern) {
  return typeof value === 'string'
    && value.length <= 90
    && !value.includes('..')
    && !value.includes('/')
    && !value.includes('\\')
    && pattern.test(value)
}

export function isSafeImageFile(value) {
  return isSafeFileName(value, IMAGE_FILE)
}

export function isSafeAudioFile(value) {
  return isSafeFileName(value, AUDIO_FILE)
}

export function isValidDateParts(value) {
  const match = DATE_RE.exec(value || '')
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 2024 || year > 2036) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isValidTime(value) {
  return TIME_RE.test(value || '')
}

export function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 64) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function validateName(value) {
  const name = cleanText(value, 80)
  if (name.length < 2 || !/\p{L}/u.test(name)) {
    return { error: 'Escribe el nombre del invitado o de la familia.' }
  }
  return { value: name }
}

export function validatePhone(value) {
  const phone = cleanText(value || '', 24)
  if (!phone) return { value: '' }
  if (!/^[0-9+().\-\s]+$/.test(phone)) {
    return { error: 'El teléfono solo puede tener números, espacios y los signos + ( ) - .' }
  }
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) {
    return { error: 'El teléfono debe tener entre 7 y 15 dígitos.' }
  }
  return { value: phone }
}

export function deriveCheckInStatus(checkedInCount, confirmedCount) {
  if (!checkedInCount || checkedInCount <= 0) return 'pendiente'
  if (confirmedCount > 0 && checkedInCount >= confirmedCount) return 'completo'
  return 'parcial'
}

export function evaluateSeatChange({ maxSeats, confirmedCount = 0, checkedInCount = 0 }) {
  if (!Number.isInteger(maxSeats) || maxSeats < MIN_SEATS || maxSeats > MAX_SEATS) {
    return { ok: false, message: `Los cupos deben ser un entero entre ${MIN_SEATS} y ${MAX_SEATS}.` }
  }
  if (maxSeats < confirmedCount) {
    return { ok: false, message: 'Los cupos no pueden ser menores que las personas ya confirmadas.' }
  }
  if (maxSeats < checkedInCount) {
    return { ok: false, message: 'Los cupos no pueden ser menores que las personas ya ingresadas.' }
  }
  return { ok: true }
}

export function evaluateRsvp({
  attending,
  guests,
  maxSeats,
  checkedInCount = 0,
  rsvpOpen = true,
  deadlineMs = null,
  nowMs = Date.now(),
  bypassWindow = false
}) {
  if (!bypassWindow && rsvpOpen === false) {
    return { ok: false, code: 'closed', message: 'Las confirmaciones están cerradas.' }
  }
  if (!bypassWindow && Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
    return { ok: false, code: 'deadline', message: 'La fecha límite para confirmar ya pasó.' }
  }
  if (attending !== true && attending !== false) {
    return { ok: false, code: 'attending', message: 'Indica si vas a asistir.' }
  }
  if (attending === false) {
    if (checkedInCount > 0) {
      return {
        ok: false,
        code: 'checked-in',
        message: 'Ya hay personas registradas en la entrada. No es posible dejar la confirmación por debajo de ese número.'
      }
    }
    return { ok: true, status: 'rechazado', confirmedCount: 0 }
  }
  if (!Number.isInteger(guests) || guests < 1 || guests > maxSeats) {
    const label = maxSeats === 1 ? 'persona' : 'personas'
    return { ok: false, code: 'seats', message: `Puedes confirmar entre 1 y ${maxSeats} ${label}.` }
  }
  if (guests < checkedInCount) {
    return {
      ok: false,
      code: 'checked-in',
      message: 'La confirmación no puede ser menor que las personas que ya ingresaron.'
    }
  }
  return { ok: true, status: 'confirmado', confirmedCount: guests }
}

export function evaluateCheckIn({
  count,
  confirmedCount = 0,
  checkedInCount = 0,
  lastCheckInAt = null,
  nowMs = Date.now(),
  confirmAdditional = false
}) {
  if (!Number.isInteger(confirmedCount) || confirmedCount < 1) {
    return { ok: false, code: 'not-confirmed', message: 'Esta invitación no tiene personas confirmadas para ingresar.' }
  }
  const remaining = confirmedCount - checkedInCount
  if (remaining <= 0) {
    return { ok: false, code: 'already', message: 'Todas las personas confirmadas ya fueron registradas en la entrada.' }
  }
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, code: 'count', message: 'Indica cuántas personas ingresan, con un número entero.' }
  }
  if (count > remaining) {
    const label = remaining === 1 ? 'lugar confirmado' : 'lugares confirmados'
    return { ok: false, code: 'exceeds', message: `Solo quedan ${remaining} ${label}.` }
  }
  if (lastCheckInAt && confirmAdditional !== true) {
    const delta = nowMs - Date.parse(lastCheckInAt)
    if (Number.isFinite(delta) && delta >= 0 && delta < CHECKIN_GUARD_MS) {
      return {
        ok: false,
        code: 'recent',
        message: 'Se acaba de registrar una entrada. Confirma si llegaron más personas para evitar un doble registro.'
      }
    }
  }
  const next = checkedInCount + count
  return {
    ok: true,
    checkedInCount: next,
    checkInStatus: deriveCheckInStatus(next, confirmedCount),
    remaining: confirmedCount - next
  }
}

export function classifyToken(indexRecord, invitation) {
  if (!indexRecord) return 'invalid'
  if (indexRecord.status === 'revoked') return 'revoked'
  if (!invitation || invitation.active === false) return 'inactive'
  return 'valid'
}

export function sanitizeSpotifyEmbed(input) {
  const text = cleanText(input || '', 300)
  if (!text) return ''
  let url
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  let kind = ''
  let id = ''
  if (parts[0] === 'embed' && SPOTIFY_KINDS.has(parts[1])) {
    kind = parts[1]
    id = parts[2] || ''
  } else if (SPOTIFY_KINDS.has(parts[0])) {
    kind = parts[0]
    id = parts[1] || ''
  }
  if (!SPOTIFY_KINDS.has(kind) || !/^[A-Za-z0-9]{22}$/.test(id)) return null
  return `https://open.spotify.com/embed/${kind}/${id}`
}

export function isSpotifySearch(input) {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' && url.pathname.startsWith('/search')
  } catch {
    return false
  }
}

export function sanitizeMapUrl(input) {
  const text = cleanText(input || '', 400)
  if (!text) return { value: '' }
  let url
  try {
    url = new URL(text)
  } catch {
    return { error: 'El enlace del mapa no es válido.' }
  }
  if (url.protocol !== 'https:' || !MAP_HOSTS.has(url.hostname)) {
    return { error: 'El mapa debe ser un enlace https de Google Maps.' }
  }
  return { value: url.toString() }
}

export function sanitizePublicSite(input) {
  const text = cleanText(input || '', 200)
  if (!text) return { value: '' }
  let url
  try {
    url = new URL(text)
  } catch {
    return { error: 'La dirección pública del sitio no es válida.' }
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    return { error: 'La dirección pública debe ser https, sin parámetros ni credenciales.' }
  }
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return { value: `${url.origin}${path}` }
}

export function sanitizeMusic(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const title = cleanText(source.title || 'A Thousand Years', 80) || 'A Thousand Years'
  const artist = cleanText(source.artist || 'Christina Perri', 80) || 'Christina Perri'
  const localFile = cleanText(source.localFile || '', 90)
  if (localFile && !isSafeAudioFile(localFile)) {
    return { error: 'El audio local debe ser un archivo de assets/audio con extensión mp3, m4a, ogg o wav.' }
  }
  let spotifyEmbedUrl = ''
  if (cleanText(source.spotifyEmbedUrl || '', 300)) {
    const embed = sanitizeSpotifyEmbed(source.spotifyEmbedUrl)
    if (!embed) {
      return { error: 'Pega un enlace real de Spotify (canción, álbum o playlist). No se aceptan identificadores incompletos.' }
    }
    spotifyEmbedUrl = embed
  }
  let spotifySearchUrl = cleanText(source.spotifySearchUrl || '', 300)
  if (spotifySearchUrl) {
    if (!isSpotifySearch(spotifySearchUrl)) {
      return { error: 'La búsqueda de Spotify debe empezar por https://open.spotify.com/search/' }
    }
  } else {
    spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`.trim())}`
  }
  return { value: { title, artist, localFile, spotifyEmbedUrl, spotifySearchUrl } }
}

export function sanitizeAgenda(input) {
  if (input == null || input === '') return { value: [] }
  if (!Array.isArray(input)) return { error: 'La agenda debe ser una lista.' }
  if (input.length > 12) return { error: 'La agenda admite hasta 12 momentos.' }
  const items = []
  for (const item of input) {
    if (!item || typeof item !== 'object') return { error: 'Hay un momento de la agenda con formato inválido.' }
    const time = cleanText(item.time || '', 20)
    const title = cleanText(item.title || '', 80)
    if (!title) continue
    items.push({ time, title })
  }
  return { value: items }
}

export function sanitizeGallery(input) {
  if (input == null || input === '') return { value: [] }
  if (!Array.isArray(input)) return { error: 'La galería debe ser una lista.' }
  if (input.length > 40) return { error: 'La galería admite hasta 40 fotografías.' }
  const items = []
  for (const item of input) {
    const file = cleanText(typeof item === 'string' ? item : item?.file || '', 90)
    const alt = cleanText(typeof item === 'string' ? 'Fotografía de la celebración' : item?.alt || 'Fotografía de la celebración', 140)
    if (!file) continue
    if (!isSafeImageFile(file)) {
      return { error: `«${file.slice(0, 40)}» no es un nombre de imagen permitido.` }
    }
    items.push({ file, alt, temporary: /^placeholder-/i.test(file) })
  }
  return { value: items }
}

export function sanitizeColors(input) {
  const colors = { ...DEFAULT_COLORS }
  if (input == null || input === '') return { value: colors }
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'Los colores no tienen un formato válido.' }
  for (const key of Object.keys(DEFAULT_COLORS)) {
    if (input[key] == null || input[key] === '') continue
    if (typeof input[key] !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(input[key])) {
      return { error: `El color ${key} debe ser hexadecimal, por ejemplo ${DEFAULT_COLORS[key]}.` }
    }
    colors[key] = input[key].toUpperCase()
  }
  return { value: colors }
}

export function sanitizeEventSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'La configuración no tiene un formato válido.' }
  }
  const quinceaneraName = cleanText(input.quinceaneraName, 80)
  if (quinceaneraName.length < 2 || !/\p{L}/u.test(quinceaneraName)) {
    return { error: 'Escribe el nombre de la quinceañera.' }
  }
  if (!isValidDateParts(input.eventDate)) return { error: 'La fecha del evento no es válida.' }
  if (!isValidTime(input.eventTime)) return { error: 'La hora del evento no es válida.' }
  const timezone = cleanText(input.timezone, 64)
  if (!isValidTimeZone(timezone)) return { error: 'La zona horaria no es válida.' }
  const venueName = cleanText(input.venueName, 120)
  if (venueName.length < 2) return { error: 'Escribe el lugar del evento.' }
  const map = sanitizeMapUrl(input.mapUrl)
  if (map.error) return map
  if (typeof input.rsvpDeadline !== 'string' || Number.isNaN(Date.parse(input.rsvpDeadline))) {
    return { error: 'La fecha límite de confirmación no es válida.' }
  }
  if (typeof input.rsvpOpen !== 'boolean') return { error: 'Indica si las confirmaciones están abiertas.' }
  const agenda = sanitizeAgenda(input.agenda)
  if (agenda.error) return agenda
  const gallery = sanitizeGallery(input.gallery)
  if (gallery.error) return gallery
  const colors = sanitizeColors(input.colors)
  if (colors.error) return colors
  const music = sanitizeMusic(input.music)
  if (music.error) return music
  const coverImage = cleanText(input.coverImage || '', 90)
  if (coverImage && !isSafeImageFile(coverImage)) {
    return { error: 'La fotografía de portada debe ser un archivo de assets/img.' }
  }
  const site = sanitizePublicSite(input.publicSiteUrl)
  if (site.error) return site
  const gallerySource = input.gallerySource === 'panel' ? 'panel' : 'archivo'
  return {
    value: {
      schemaVersion: 1,
      quinceaneraName,
      eventDate: input.eventDate,
      eventTime: input.eventTime,
      timezone,
      venueName,
      venueAddress: cleanText(input.venueAddress || '', 200),
      venueNote: cleanText(input.venueNote || '', 200),
      mapUrl: map.value,
      heroMessage: cleanMultiline(input.heroMessage || '', 800),
      closingMessage: cleanMultiline(input.closingMessage || '', 500),
      giftTitle: cleanText(input.giftTitle || 'Lluvia de sobres', 80) || 'Lluvia de sobres',
      giftMessage: cleanMultiline(input.giftMessage || '', 400),
      rsvpDeadline: new Date(input.rsvpDeadline).toISOString(),
      rsvpOpen: input.rsvpOpen,
      dressCode: cleanText(input.dressCode || '', 200),
      agenda: agenda.value,
      gallery: gallery.value,
      gallerySource,
      coverImage,
      music: music.value,
      colors: colors.value,
      whatsappTemplate: cleanMultiline(input.whatsappTemplate || '', 500),
      publicSiteUrl: site.value
    }
  }
}

export function mapEmbedSrc(mapUrl, venueName) {
  const fallback = venueName || 'Colinas Country Club'
  try {
    const url = new URL(mapUrl)
    const embeddable = url.protocol === 'https:' && ['www.google.com', 'maps.google.com', 'google.com'].includes(url.hostname)
    if (embeddable) {
      const query = url.searchParams.get('query') || url.searchParams.get('q') || fallback
      return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`
    }
  } catch {
    /* Se usa el nombre del lugar. */
  }
  return `https://maps.google.com/maps?q=${encodeURIComponent(fallback)}&z=15&output=embed`
}

export function tokenMessage(kind) {
  if (kind === 'revoked') {
    return 'Esta invitación fue reemplazada por un enlace nuevo. Pide el enlace actualizado.'
  }
  if (kind === 'inactive') return 'Esta invitación ya no está disponible.'
  if (kind === 'invalid') return 'Este enlace no corresponde a una invitación válida.'
  return ''
}
