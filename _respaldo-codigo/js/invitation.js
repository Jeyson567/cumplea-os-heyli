import { el } from './dom.js'
import { eventDefaults } from './event-defaults.js'
import { doc, initFirebase, onSnapshot } from './firebase-config.js'
import { galleryItems, gallerySrc, galleryVerses } from './gallery-config.js'
import { mountMusic } from './music.js'
import { loadInvitation, settingsFromDoc, submitGuestRsvp } from './records.js'
import { isSafeImageFile, isTokenShape, mapEmbedSrc, sanitizeMapUrl } from './policy.js'
import { countdownParts, formatLongDate, formatTimeLabel, pad, zonedTimeToUtc } from './time.js'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const params = new URLSearchParams(location.search)
const state = {
  settings: { ...eventDefaults },
  token: params.get('invitacion') || '',
  invite: null,
  inviteError: '',
  lookingUp: false,
  gallery: galleryItems,
  photo: 0,
  timer: 0,
  music: null,
  pointerX: 0,
  db: null
}

function applyWindow() {
  if (!state.invite) return
  const deadline = Date.parse(state.settings.rsvpDeadline || '')
  const closed = state.settings.rsvpOpen === false
  const expired = Number.isFinite(deadline) && Date.now() > deadline
  state.invite = {
    ...state.invite,
    rsvpOpen: !closed && !expired,
    closedReason: closed ? 'closed' : expired ? 'deadline' : null
  }
}

function text(id, value) {
  const node = document.getElementById(id)
  if (node) node.textContent = value || ''
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/)
  if (parts.length < 2) return { first: name || 'Heyli', last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts.at(-1) }
}

function currentGallery(settings) {
  if (settings.gallerySource === 'panel' && Array.isArray(settings.gallery) && settings.gallery.length) {
    const safe = settings.gallery.filter((item) => isSafeImageFile(item.file))
    if (safe.length) return safe
  }
  return galleryItems
}

function applyColors(colors = {}) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(colors)) {
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) root.style.setProperty(`--${key}`, value)
  }
}

function imageOrFallback(src, alt, className = '') {
  const img = el('img', { src, alt, decoding: 'async' })
  img.addEventListener('error', () => {
    img.replaceWith(el('div', { class: `photo-fallback ${className}`.trim(), text: 'Fotografía por añadir' }))
  }, { once: true })
  return img
}

function coverFile() {
  const chosen = state.settings.coverImage
  if (chosen && isSafeImageFile(chosen) && !/^placeholder-/i.test(chosen)) return chosen
  const local = currentGallery(state.settings).find((item) => item.file && !item.temporary && !/^placeholder-/i.test(item.file))
  return local?.file || ''
}

function renderCover() {
  const frame = document.getElementById('cover')
  const file = coverFile()
  frame.replaceChildren()
  const src = gallerySrc(file)
  if (src) {
    const img = imageOrFallback(src, `Fotografía de ${state.settings.quinceaneraName}`)
    img.loading = 'eager'
    frame.append(img)
    return
  }
  const initial = (state.settings.quinceaneraName || 'H').trim().charAt(0).toUpperCase()
  frame.append(el('div', { class: 'monogram' }, [
    el('div', {}, [
      el('strong', { text: initial }),
      el('small', { text: 'Espacio para su fotografía' })
    ])
  ]))
}

function renderGallery() {
  const grid = document.getElementById('galeria')
  state.gallery = currentGallery(state.settings)
  const nodes = []
  let verse = 0
  state.gallery.forEach((item, index) => {
    const size = index % 6 === 0 ? 'feature' : index % 6 === 3 ? 'wide' : 'portrait'
    const img = imageOrFallback(gallerySrc(item.file), item.alt || 'Fotografía de la celebración')
    img.loading = index === 0 ? 'eager' : 'lazy'
    const button = el('button', { type: 'button', 'aria-label': item.alt || 'Abrir fotografía', onclick: () => openPhoto(index) }, [img])
    if (item.temporary || /^placeholder-/i.test(item.file)) button.append(el('span', { class: 'badge', text: 'Temporal' }))
    nodes.push(el('figure', { class: `shot shot--${size}` }, [button]))
    if ((index + 1) % 3 === 0 && verse < galleryVerses.length && index < state.gallery.length - 1) {
      nodes.push(el('p', { class: 'pull', text: galleryVerses[verse] }))
      verse += 1
    }
  })
  grid.replaceChildren(...nodes)
}

function showPhoto(index) {
  const items = state.gallery
  if (!items.length) return
  state.photo = (index + items.length) % items.length
  const item = items[state.photo]
  const img = document.getElementById('foto-grande')
  img.alt = item.alt || ''
  img.src = gallerySrc(item.file)
  text('foto-leyenda', `${item.alt || 'Fotografía'} · ${state.photo + 1} / ${items.length}`)
}

function openPhoto(index) {
  showPhoto(index)
  document.getElementById('lightbox').showModal()
}

function renderAgenda() {
  const section = document.getElementById('agenda')
  const list = document.getElementById('agenda-lista')
  const items = Array.isArray(state.settings.agenda) ? state.settings.agenda : []
  section.hidden = items.length === 0
  list.replaceChildren(...items.map((item) => el('li', {}, [
    el('strong', { text: item.time || '' }),
    el('span', { text: item.title || '' })
  ])))
}

function renderDress() {
  const section = document.getElementById('vestimenta')
  section.hidden = !state.settings.dressCode
  text('vestimenta-texto', state.settings.dressCode || '')
}

function renderMessage() {
  const name = state.settings.quinceaneraName || eventDefaults.quinceaneraName
  const parts = splitName(name)
  const title = document.getElementById('nombre')
  title.setAttribute('aria-label', name)
  title.replaceChildren(el('span', { text: parts.first }))
  if (parts.last) title.append(el('span', { text: parts.last }))
  text('intro-title', name)
  text('hero-message', state.settings.heroMessage)
  text('cierre', state.settings.closingMessage)
  text('regalo-titulo', state.settings.giftTitle || 'Lluvia de sobres')
  text('regalo-texto', state.settings.giftMessage)
  text('pie-nombre', name)
  text('lugar', state.settings.venueName)
  text('direccion', state.settings.venueAddress ? `Referencia provisional: ${state.settings.venueAddress}` : '')
  text('lugar-nota', state.settings.venueNote)
  const when = zonedTimeToUtc(state.settings.eventDate, state.settings.eventTime, state.settings.timezone)
  text('hero-day', state.settings.eventDate.slice(8, 10))
  text('hero-when', `${formatLongDate(state.settings.eventDate, state.settings.timezone).replace(/^\p{L}+,?\s*/u, '')}\n${formatTimeLabel(state.settings.eventTime)}`)
  text('fecha-larga', formatLongDate(state.settings.eventDate, state.settings.timezone))
  text('hora-larga', `${formatTimeLabel(state.settings.eventTime)} · ${state.settings.timezone}`)
  document.querySelector('.intro__date').textContent = `${formatLongDate(state.settings.eventDate, state.settings.timezone)} · ${formatTimeLabel(state.settings.eventTime)}`
  document.title = `XV años de ${name}`
  const map = sanitizeMapUrl(state.settings.mapUrl)
  const href = map.value || eventDefaults.mapUrl
  const link = document.getElementById('como-llegar')
  link.href = href
  document.getElementById('mapa').src = mapEmbedSrc(href, state.settings.venueName)
  document.getElementById('mapa').title = `Mapa de ${state.settings.venueName}`
  applyColors(state.settings.colors)
  renderCover()
  renderGallery()
  renderAgenda()
  renderDress()
  state.music = mountMusic(document.getElementById('music-root'), state.settings.music)
  startCountdown(when)
  void when
}

function startCountdown(target) {
  window.clearInterval(state.timer)
  const units = ['days', 'hours', 'minutes', 'seconds']
  let announced = ''
  const tick = () => {
    if (!target) return
    const parts = countdownParts(target.getTime())
    for (const unit of units) {
      const node = document.querySelector(`[data-unit="${unit}"]`)
      if (!node) continue
      const next = parts.done ? '00' : unit === 'days' ? String(parts[unit]) : pad(parts[unit])
      if (node.textContent !== next) {
        node.textContent = next
        if (!reduceMotion) {
          node.classList.remove('is-tick')
          void node.offsetWidth
          node.classList.add('is-tick')
        }
      }
    }
    document.getElementById('countdown').hidden = parts.done
    document.getElementById('countdown-done').hidden = !parts.done
    const summary = parts.done
      ? 'Hoy el sueño tiene fecha. Gracias por compartir esta noche conmigo.'
      : `Faltan ${parts.days} días, ${parts.hours} horas y ${parts.minutes} minutos.`
    if (summary !== announced) {
      announced = summary
      document.getElementById('countdown-text').textContent = summary
    }
  }
  tick()
  state.timer = window.setInterval(tick, 1000)
}

function renderPersonal() {
  const box = document.getElementById('personal')
  if (!state.invite) {
    box.hidden = true
    return
  }
  box.hidden = false
  const forLine = box.querySelector('[data-personal-for]')
  forLine.replaceChildren('Esta invitación es especialmente para ', el('em', { text: state.invite.name }))
  const places = state.invite.maxSeats === 1 ? 'lugar' : 'lugares'
  box.querySelector('[data-personal-seats]').textContent = `Hemos reservado hasta ${state.invite.maxSeats} ${places} para ti`
}

function responseCopy(invite) {
  if (invite.status === 'confirmado') return `Tu respuesta: asistirán ${invite.confirmedCount} ${invite.confirmedCount === 1 ? 'persona' : 'personas'}.`
  if (invite.status === 'rechazado') return 'Tu respuesta: no podrás asistir.'
  return 'Aún no has confirmado.'
}

function renderRsvp() {
  const root = document.getElementById('rsvp')
  root.replaceChildren()
  if (!state.token) {
    root.append(el('p', { text: 'La confirmación está disponible desde tu enlace personal. Ábrelo para indicar si nos acompañas.' }))
    return
  }
  if (!isTokenShape(state.token)) {
    root.append(el('p', { class: 'note note--bad', text: 'Este enlace no corresponde a una invitación válida.' }))
    return
  }
  if (state.lookingUp) {
    root.append(el('p', { text: 'Revisando tu invitación…' }))
    return
  }
  if (state.inviteError) {
    root.append(el('p', { class: 'note note--bad', text: state.inviteError }))
    return
  }
  const invite = state.invite
  if (state.notice) {
    root.append(el('p', { class: 'note', text: state.notice }))
    state.notice = ''
  }
  root.append(el('p', { text: responseCopy(invite) }))
  if (!invite.rsvpOpen) {
    const closed = invite.closedReason === 'deadline'
      ? 'La fecha límite para confirmar ya pasó.'
      : 'Las confirmaciones están cerradas.'
    root.append(el('p', { class: 'note', text: closed }))
    return
  }
  const attending = invite.status === 'rechazado' ? false : invite.status === 'confirmado'
  const selected = invite.confirmedCount || 1
  const yes = el('input', { type: 'radio', name: 'asiste', value: 'si', id: 'asiste-si' })
  const no = el('input', { type: 'radio', name: 'asiste', value: 'no', id: 'asiste-no' })
  if (attending || invite.status !== 'rechazado') yes.checked = invite.status !== 'rechazado'
  if (invite.status === 'rechazado') no.checked = true
  const seats = el('input', { name: 'cupos', type: 'number', min: '1', max: String(invite.maxSeats), value: String(Math.min(selected, invite.maxSeats)), inputmode: 'numeric', 'aria-label': 'Personas que asistirán' })
  const stepper = el('div', { class: 'stepper' }, [
    el('button', { type: 'button', text: '−', 'aria-label': 'Menos personas', onclick: () => { seats.value = String(Math.max(1, Number(seats.value) - 1)) } }),
    seats,
    el('button', { type: 'button', text: '+', 'aria-label': 'Más personas', onclick: () => { seats.value = String(Math.min(invite.maxSeats, Number(seats.value) + 1)) } })
  ])
  const status = el('p', { class: 'note', 'aria-live': 'polite' })
  const save = el('button', { class: 'btn', type: 'submit', text: 'Guardar respuesta' })
  const form = el('form', {}, [
    el('fieldset', {}, [
      el('legend', { text: '¿Nos acompañas?' }),
      el('div', { class: 'choice' }, [
        el('label', {}, [yes, 'Sí, asistiré']),
        el('label', {}, [no, 'No podré asistir'])
      ]),
      el('div', { id: 'cupos-box' }, [
        el('p', { text: `Puedes confirmar de 1 a ${invite.maxSeats}.` }),
        stepper
      ])
    ]),
    save,
    status
  ])
  const toggle = () => { document.getElementById('cupos-box').hidden = !yes.checked }
  yes.addEventListener('change', toggle)
  no.addEventListener('change', toggle)
  toggle()
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (save.dataset.busy === '1') return
    const willAttend = yes.checked
    const guests = willAttend ? Number(seats.value) : 0
    if (willAttend && (!Number.isInteger(guests) || guests < 1 || guests > invite.maxSeats)) {
      status.textContent = `Puedes confirmar entre 1 y ${invite.maxSeats} personas.`
      return
    }
    save.dataset.busy = '1'
    save.disabled = true
    save.textContent = 'Guardando…'
    status.textContent = ''
    try {
      const result = await submitGuestRsvp(state.db, state.token, {
        attending: willAttend,
        guests,
        maxSeats: invite.maxSeats,
        checkedInCount: invite.checkedInCount || 0,
        rsvpOpen: state.settings.rsvpOpen !== false,
        deadline: state.settings.rsvpDeadline
      })
      state.invite = { ...state.invite, ...result }
      state.notice = result.status === 'confirmado'
        ? `Guardamos tu respuesta. Asistirán ${result.confirmedCount} ${result.confirmedCount === 1 ? 'persona' : 'personas'}.`
        : 'Guardamos tu respuesta. Lamentamos que no puedas asistir.'
      renderPersonal()
      renderRsvp()
    } catch (error) {
      status.textContent = error.reason === 'rate'
        ? error.message
        : `${error.message} Tu confirmación no se registró.`
      save.disabled = false
      save.dataset.busy = '0'
      save.textContent = 'Guardar respuesta'
    }
  })
  root.append(form)
}

async function lookupInvitation(db) {
  state.db = db
  if (!state.token) {
    renderRsvp()
    return
  }
  if (!isTokenShape(state.token)) {
    state.inviteError = 'Este enlace no corresponde a una invitación válida.'
    renderRsvp()
    return
  }
  state.lookingUp = true
  renderRsvp()
  try {
    state.invite = await loadInvitation(db, state.token)
    applyWindow()
    state.inviteError = ''
  } catch (error) {
    state.invite = null
    state.inviteError = error.message || 'No pudimos consultar tu invitación.'
  } finally {
    state.lookingUp = false
    renderPersonal()
    renderRsvp()
  }
}

function bootEnvelope() {
  document.body.classList.add('is-booted')
  let opened = false
  document.getElementById('open-invite').addEventListener('click', () => {
    if (opened) return
    opened = true
    state.music?.playFromGesture()
    document.getElementById('music-invite')?.removeAttribute('hidden')
    if (!reduceMotion) document.getElementById('envelope').classList.add('is-open')
    window.setTimeout(() => {
      document.body.classList.add('is-open')
      document.getElementById('nombre').focus()
    }, reduceMotion ? 0 : 900)
  })
}

function bindGallery() {
  const dialog = document.getElementById('lightbox')
  document.getElementById('foto-cerrar').addEventListener('click', () => dialog.close())
  document.getElementById('foto-anterior').addEventListener('click', () => showPhoto(state.photo - 1))
  document.getElementById('foto-siguiente').addEventListener('click', () => showPhoto(state.photo + 1))
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') showPhoto(state.photo - 1)
    if (event.key === 'ArrowRight') showPhoto(state.photo + 1)
  })
  const figure = dialog.querySelector('figure')
  figure.addEventListener('pointerdown', (event) => { state.pointerX = event.clientX })
  figure.addEventListener('pointerup', (event) => {
    const delta = event.clientX - state.pointerX
    if (delta > 40) showPhoto(state.photo - 1)
    if (delta < -40) showPhoto(state.photo + 1)
  })
  document.getElementById('imprimir').addEventListener('click', () => window.print())
}

function watchSettings(db) {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    onSnapshot(doc(db, 'eventSettings', 'public'), (snap) => {
      state.settings = { ...eventDefaults, ...(snap.exists() ? settingsFromDoc(snap.data()) : {}) }
      if (snap.exists()) document.getElementById('aviso-config').hidden = true
      applyWindow()
      renderMessage()
      if (state.invite || state.inviteError) renderRsvp()
      finish()
    }, () => {
      state.settings = { ...eventDefaults }
      renderMessage()
      document.getElementById('aviso-config').hidden = false
      finish()
    })
    window.setTimeout(finish, 2800)
  })
}

function bindMotion() {
  document.documentElement.classList.add('js')
  if (reduceMotion) return
  const root = document.documentElement
  let ticking = false
  window.addEventListener('scroll', () => {
    if (ticking || document.hidden) return
    ticking = true
    requestAnimationFrame(() => {
      const shift = Math.max(-16, Math.min(16, window.scrollY * 0.02))
      root.style.setProperty('--py', `${shift}px`)
      ticking = false
    })
  }, { passive: true })
  document.addEventListener('visibilitychange', () => {
    root.classList.toggle('is-hidden', document.hidden)
  })
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in')
        observer.unobserve(entry.target)
      }
    }
  }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' })
  document.querySelectorAll('.reveal').forEach((node) => observer.observe(node))
}

async function main() {
  bindGallery()
  bindMotion()
  renderMessage()
  const fonts = document.fonts?.ready || Promise.resolve()
  try {
    const firebase = await initFirebase()
    await Promise.race([watchSettings(firebase.db), fonts])
    bootEnvelope()
    await lookupInvitation(firebase.db)
  } catch {
    renderMessage()
    document.getElementById('aviso-config').hidden = false
    bootEnvelope()
    state.inviteError = 'No pudimos conectar con la confirmación. La invitación sigue disponible.'
    renderRsvp()
  }
}

main()
