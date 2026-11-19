import { el } from './dom.js'
import { eventDefaults } from './event-defaults.js'
import { doc, initFirebase, onSnapshot } from './firebase-config.js'
import { gallerySrc, videoSrc } from './gallery-config.js'
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
  gallery: [],
  photo: 0,
  timer: 0,
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

const PREVIOUS_COPY = {
  names: ['Heyli Orrego', 'HEYLI ORREGO'],
  venues: ['Colinas Country Club', 'Colina Country Club'],
  maps: [
    'https://www.google.com/maps/search/?api=1&query=Colina+Country+Club+Quetzaltenango',
    'https://www.google.com/maps/search/?api=1&query=Colinas+Country+Club+Quetzaltenango'
  ],
  addresses: ['Km 223.5 carretera CITO 180, Quetzaltenango, Guatemala'],
  notes: ['Pendiente de verificar. La referencia del mapa es provisional.'],
  heroes: ['Hay momentos que se convierten en recuerdos para toda la vida. Hoy queremos compartir contigo uno de los más especiales: la celebración de mis XV años.'],
  closings: ['Los mejores recuerdos no se guardan solamente en fotografías, se guardan en el corazón. Espero poder compartir contigo una noche llena de alegría, magia y momentos inolvidables.'],
  giftTitles: ['Un regalo especial'],
  gifts: [
    'Tu presencia es nuestro mejor regalo. Si deseas tener un detalle especial conmigo, tendremos lluvia de sobres.',
    'Tu presencia es el regalo más importante para mí. Si deseas tener un detalle adicional, agradeceré mucho tu cariño mediante una lluvia de sobres.\n\nCon mucho cariño, gracias por acompañarme en este día tan especial y por formar parte de un recuerdo que guardaré para siempre.',
    'Tu presencia es mi mejor regalo, pero si deseas obsequiarme algo, agradeceré que sea en efectivo.',
    'Tu presencia es mi mejor regalo, pero si deseas obsequiarme algo, agradeceré que sea en efectivo. Gracias.'
  ]
}

function preferOfficial(value, previous, official) {
  const current = String(value || '').trim()
  if (!current || previous.includes(current)) return official
  return current
}

function presentSettings(settings) {
  return {
    ...settings,
    quinceaneraName: preferOfficial(settings.quinceaneraName, PREVIOUS_COPY.names, eventDefaults.quinceaneraName),
    venueName: preferOfficial(settings.venueName, PREVIOUS_COPY.venues, eventDefaults.venueName),
    mapUrl: preferOfficial(settings.mapUrl, PREVIOUS_COPY.maps, eventDefaults.mapUrl),
    venueAddress: preferOfficial(settings.venueAddress, PREVIOUS_COPY.addresses, eventDefaults.venueAddress),
    venueNote: PREVIOUS_COPY.notes.includes(String(settings.venueNote || '').trim()) ? '' : (settings.venueNote || ''),
    heroMessage: preferOfficial(settings.heroMessage, PREVIOUS_COPY.heroes, eventDefaults.heroMessage),
    closingMessage: preferOfficial(settings.closingMessage, PREVIOUS_COPY.closings, eventDefaults.closingMessage),
    giftTitle: preferOfficial(settings.giftTitle, PREVIOUS_COPY.giftTitles, eventDefaults.giftTitle),
    giftMessage: preferOfficial(settings.giftMessage, PREVIOUS_COPY.gifts, eventDefaults.giftMessage)
  }
}

function nameLines(name) {
  if (name === 'Heily Pérez Orrego') return ['Heily', 'Pérez', 'Orrego']
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return [name || 'Heily']
  return [parts[0], parts.slice(1).join(' ')]
}

const GALLERY_LIMIT = 3
const SCORE_SRC = 'assets/audio/no-crezcas-mas-instrumental.mp3.mp3'

function playFilm(video) {
  if (!video) return
  video.muted = true
  video.defaultMuted = true
  video.loop = true
  video.playsInline = true
  video.autoplay = true
  video.controls = false
  const attempt = video.play()
  if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {})
}

function requestInvitationVideo() {
  playFilm(document.getElementById('film'))
}

function mountVideo(file) {
  const frame = document.getElementById('film-frame')
  const note = document.getElementById('film-note')
  const video = document.getElementById('film')
  const src = videoSrc(file)
  if (!frame) return
  if (!src) {
    if (video) video.remove()
    if (note) note.hidden = false
    return
  }
  if (video) {
    const source = video.querySelector('source')
    const current = source?.getAttribute('src') || ''
    if (current !== src && source) {
      source.src = src
      source.type = src.endsWith('.webm') ? 'video/webm' : 'video/mp4'
      video.load()
    }
    video.addEventListener('error', () => {
      video.remove()
      if (note) note.hidden = false
    }, { once: true })
    if (note) note.hidden = true
    video.controls = false
    video.muted = true
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    playFilm(video)
    return
  }
  const created = el('video', {
    id: 'film',
    autoplay: true,
    loop: true,
    muted: true,
    playsinline: true,
    preload: 'metadata'
  })
  created.append(el('source', { src, type: src.endsWith('.webm') ? 'video/webm' : 'video/mp4' }))
  created.addEventListener('error', () => {
    created.remove()
    if (note) note.hidden = false
  }, { once: true })
  frame.prepend(created)
  if (note) note.hidden = true
  playFilm(created)
}

function renderGallery() {
  const section = document.getElementById('galeria-seccion')
  const grid = document.getElementById('galeria')
  if (!section || !grid) return
  const items = state.gallery.slice(0, GALLERY_LIMIT)
  if (!items.length) {
    section.hidden = true
    grid.replaceChildren()
    return
  }
  section.hidden = false
  grid.replaceChildren(...items.map((item, index) => {
    const src = gallerySrc(item.file)
    const img = el('img', {
      alt: item.alt || 'Fotografía de la celebración',
      decoding: 'async',
      loading: 'eager',
      src
    })
    const figure = el('figure', { class: index === 0 ? 'shot shot--feature' : 'shot' }, [
      el('button', { type: 'button', 'aria-label': 'Ampliar fotografía', onclick: () => openPhoto(index) }, [img])
    ])
    img.addEventListener('error', () => {
      figure.remove()
      state.gallery = state.gallery.filter((entry) => entry.file !== item.file)
      if (!grid.querySelector('figure')) section.hidden = true
    }, { once: true })
    return figure
  }))
}

async function loadMedia() {
  let manifest = { video: 'HeilyPrez.mp4', images: [] }
  try {
    const response = await fetch('media/gallery.json', { cache: 'no-cache' })
    if (response.ok) {
      const data = await response.json()
      manifest = {
        video: typeof data.video === 'string' ? data.video : '',
        images: Array.isArray(data.images) ? data.images : []
      }
    }
  } catch {
    manifest.images = []
  }
  mountVideo(manifest.video)
  state.gallery = manifest.images.map((item) => {
    if (typeof item === 'string') return { file: item, alt: 'Fotografía de la celebración' }
    return { file: item?.file || '', alt: item?.alt || 'Fotografía de la celebración' }
  }).filter((item) => isSafeImageFile(item.file)).slice(0, GALLERY_LIMIT)
  renderGallery()
}

function showPhoto(index) {
  const items = state.gallery
  if (!items.length) return
  state.photo = (index + items.length) % items.length
  const item = items[state.photo]
  const img = document.getElementById('foto-grande')
  img.alt = item.alt || ''
  img.src = gallerySrc(item.file)
  text('foto-leyenda', item.alt || 'Fotografía')
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
  const title = document.getElementById('nombre')
  title.setAttribute('aria-label', name)
  title.replaceChildren(...nameLines(name).map((line) => el('span', { text: line })))
  text('intro-title', name)
  text('frase', state.settings.heroMessage)
  text('cierre', state.settings.closingMessage)
  const giftBody = String(state.settings.giftMessage || '')
    .split(/\n\n/)[0]
    .replace(/\s*Gracias\.?\s*$/u, '')
    .trim()
  text('regalo-titulo', state.settings.giftTitle)
  text('regalo-texto', giftBody)
  const giftSign = document.getElementById('regalo-cierre')
  if (giftSign) {
    giftSign.textContent = 'Gracias'
    giftSign.hidden = false
  }
  text('lugar', state.settings.venueName)
  text('direccion', state.settings.venueAddress || '')
  const note = document.getElementById('lugar-nota')
  if (note) {
    note.textContent = state.settings.venueNote || ''
    note.hidden = !note.textContent
  }
  const when = zonedTimeToUtc(state.settings.eventDate, state.settings.eventTime, state.settings.timezone)
  text('fecha-larga', formatLongDate(state.settings.eventDate, state.settings.timezone))
  text('hora-larga', formatTimeLabel(state.settings.eventTime))
  document.title = `XV años de ${name}`
  const map = sanitizeMapUrl(state.settings.mapUrl)
  const href = map.value || eventDefaults.mapUrl
  const link = document.getElementById('como-llegar')
  link.href = href
  document.getElementById('mapa').src = mapEmbedSrc(href, state.settings.venueName)
  document.getElementById('mapa').title = `Mapa de ${state.settings.venueName}`
  renderAgenda()
  renderDress()
  startCountdown(when)
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
      ? 'La celebración es hoy.'
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
    root.append(el('p', { class: 'note note--ok', text: state.notice }))
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
  const cuposBox = el('div', { id: 'cupos-box' }, [
    el('p', { text: `Puedes confirmar de 1 a ${invite.maxSeats}.` }),
    stepper
  ])
  const form = el('form', { novalidate: true }, [
    el('fieldset', {}, [
      el('legend', { text: '¿Nos acompañas?' }),
      el('div', { class: 'choice' }, [
        el('label', {}, [yes, 'Sí, asistiré']),
        el('label', {}, [no, 'No podré asistir'])
      ]),
      cuposBox
    ]),
    save,
    status
  ])
  const toggle = () => { cuposBox.hidden = !yes.checked }
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
        ? `Tu lugar está reservado. Asistirán ${result.confirmedCount} ${result.confirmedCount === 1 ? 'persona' : 'personas'}.`
        : 'Gracias por avisarnos. Guardamos que no podrás asistir.'
      renderPersonal()
      renderRsvp()
    } catch (error) {
      status.textContent = error.message || 'No se pudo guardar la respuesta.'
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
    if (!reduceMotion) document.getElementById('envelope').classList.add('is-open')
    requestInvitationVideo()
    requestScore()
    window.setTimeout(() => {
      document.body.classList.add('is-open')
      document.getElementById('nombre').focus()
    }, reduceMotion ? 0 : 900)
  })
}

function scoreLabel(playing) {
  const button = document.getElementById('score-toggle')
  if (!button) return
  button.hidden = false
  button.disabled = false
  button.textContent = playing ? 'Pausar música' : 'Escuchar música'
}

function requestScore() {
  const audio = document.getElementById('score-audio')
  const button = document.getElementById('score-toggle')
  if (!audio || !button) return
  button.hidden = false
  if (audio.error) {
    button.disabled = true
    button.textContent = 'Música no disponible'
    return
  }
  audio.play().then(() => scoreLabel(true)).catch(() => {
    if (audio.error) {
      button.disabled = true
      button.textContent = 'Música no disponible'
      return
    }
    scoreLabel(false)
  })
}

function bindScore() {
  const audio = document.getElementById('score-audio')
  const button = document.getElementById('score-toggle')
  if (!audio || !button) return
  audio.src = SCORE_SRC
  audio.preload = 'none'
  audio.addEventListener('error', () => {
    if (button.hidden) return
    button.disabled = true
    button.textContent = 'Música no disponible'
  })
  button.addEventListener('click', () => {
    if (!audio.paused) {
      audio.pause()
      scoreLabel(false)
      return
    }
    audio.play().then(() => scoreLabel(true)).catch(() => scoreLabel(false))
  })
}

function bindGallery() {
  const dialog = document.getElementById('lightbox')
  document.getElementById('foto-cerrar').addEventListener('click', () => dialog.close())
  document.getElementById('film-frame')?.addEventListener('click', () => {
    const video = document.getElementById('film')
    if (video?.paused) playFilm(video)
  })
  document.getElementById('imprimir').addEventListener('click', () => window.print())
  bindScore()
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
      state.settings = presentSettings({ ...eventDefaults, ...(snap.exists() ? settingsFromDoc(snap.data()) : {}) })
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
  void loadMedia()
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
