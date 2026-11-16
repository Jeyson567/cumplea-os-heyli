import { toCsv } from './csv.js'
import { el, toast } from './dom.js'
import { eventDefaults } from './event-defaults.js'
import {
  collection,
  doc,
  getDoc,
  initFirebase,
  onAuthStateChanged,
  onSnapshot,
  signInWithEmailAndPassword,
  signOut
} from './firebase-config.js'
import { galleryItems } from './gallery-config.js'
import { fillTemplate, invitationUrl, tokenFromScan, whatsappShareUrl } from './links.js'
import { isTokenShape, sanitizeEventSettings } from './policy.js'
import {
  adminUpdateRsvp,
  commitCheckIn,
  createInvitation,
  publicInvitation,
  regenerateInvitation,
  saveEventSettings,
  setInvitationActive,
  settingsFromDoc,
  updateInvitation,
  userIsAdmin
} from './records.js'
import { makeQrSvg } from './qr.js'
import { formatInZone, formatLongDate, formatStamp, formatTimeLabel, zonedTimeToUtc } from './time.js'

const state = {
  auth: null,
  db: null,
  user: null,
  settings: { ...eventDefaults },
  invitations: [],
  filter: 'activas',
  query: '',
  sort: 'createdAt',
  selected: new Set(),
  settingsDirty: false,
  unsub: [],
  stopScan: null,
  preview: null
}

const modal = () => document.getElementById('modal')

function show(id) {
  for (const view of ['view-checking', 'view-login', 'view-denied', 'view-app']) {
    document.getElementById(view).hidden = view !== id
  }
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function authMessage(error) {
  const code = error?.code || ''
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code)) {
    return 'Correo o contraseña incorrectos.'
  }
  if (code === 'auth/too-many-requests') return 'Demasiados intentos. Espera un momento.'
  if (code === 'auth/network-request-failed') return 'No hay conexión con el servicio de acceso.'
  return 'No se pudo iniciar sesión.'
}

function percent(part, total) {
  if (!total) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

function activeItems() {
  return state.invitations.filter((item) => item.active !== false)
}

function visibleGuests() {
  const query = normalize(state.query)
  const items = state.invitations.filter((item) => {
    const active = item.active !== false
    if (state.filter === 'activas' && !active) return false
    if (state.filter === 'desactivadas' && active) return false
    if (['pendiente', 'confirmado', 'rechazado'].includes(state.filter) && (item.status !== state.filter || !active)) return false
    if (query && !normalize(item.name).includes(query)) return false
    return true
  })
  const direction = state.sort === 'name' ? 1 : -1
  return items.sort((a, b) => {
    const left = a[state.sort] ?? ''
    const right = b[state.sort] ?? ''
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * (state.sort === 'createdAt' ? -1 : 1)
    return String(left).localeCompare(String(right), 'es') * (state.sort === 'name' ? 1 : direction)
  })
}

function renderStats() {
  const active = activeItems()
  const pending = active.filter((item) => item.status === 'pendiente')
  const confirmed = active.filter((item) => item.status === 'confirmado')
  const declined = active.filter((item) => item.status === 'rechazado')
  const authorized = active.reduce((sum, item) => sum + Number(item.maxSeats || 0), 0)
  const people = active.reduce((sum, item) => sum + Number(item.confirmedCount || 0), 0)
  const openSeats = pending.reduce((sum, item) => sum + Number(item.maxSeats || 0), 0)
  const checked = active.reduce((sum, item) => sum + Number(item.checkedInCount || 0), 0)
  const set = (id, value) => { document.getElementById(id).textContent = String(value) }
  set('stat-issued', active.length)
  set('stat-pending', pending.length)
  set('stat-confirmed', confirmed.length)
  set('stat-declined', declined.length)
  set('stat-authorized', authorized)
  set('stat-people', people)
  set('stat-open', openSeats)
  set('stat-checked', checked)
  document.getElementById('stat-inactive').textContent = `${state.invitations.length - active.length} desactivadas, fuera de estos totales.`
  const parts = [
    { label: 'Confirmadas', value: confirmed.length, color: '#8d4f55' },
    { label: 'Pendientes', value: pending.length, color: '#d7b48a' },
    { label: 'Rechazadas', value: declined.length, color: '#cfc3bc' }
  ]
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1
  let cursor = 0
  const stops = parts.map((part) => {
    const start = (cursor / total) * 100
    cursor += part.value
    return `${part.color} ${start}% ${(cursor / total) * 100}%`
  })
  document.getElementById('donut').style.background = active.length ? `conic-gradient(${stops.join(',')})` : '#e7ddd4'
  document.getElementById('legend').replaceChildren(...parts.map((part) => el('li', {}, [
    el('span', {}, [el('i', { class: 'swatch', style: `background:${part.color}` }), part.label]),
    el('strong', { text: `${part.value} · ${percent(part.value, active.length)}` })
  ])), el('li', {}, [
    el('span', { text: 'Personas confirmadas' }),
    el('strong', { text: percent(people, authorized) })
  ]), el('li', {}, [
    el('span', { text: 'Ingreso en puerta' }),
    el('strong', { text: percent(checked, people) })
  ]))
}

function statusText(status) {
  if (status === 'confirmado') return 'Confirmado'
  if (status === 'rechazado') return 'No asiste'
  return 'Pendiente'
}

function renderGuests() {
  const items = visibleGuests()
  document.getElementById('guest-count').textContent = `${items.length} ${items.length === 1 ? 'registro' : 'registros'}`
  const list = document.getElementById('guest-list')
  if (!items.length) {
    list.replaceChildren(el('p', { class: 'muted', text: 'No hay invitaciones con este filtro.' }))
    return
  }
  list.replaceChildren(...items.map((item) => {
    const selected = el('input', { type: 'checkbox', checked: state.selected.has(item.id), 'aria-label': `Seleccionar ${item.name}` })
    selected.addEventListener('change', () => {
      if (selected.checked) state.selected.add(item.id)
      else state.selected.delete(item.id)
    })
    return el('article', { class: 'guest' }, [
      el('header', {}, [
        el('div', {}, [
          el('h3', { text: item.name }),
          el('p', { class: `status status--${item.status || 'pendiente'}`, text: item.active === false ? 'Desactivada' : statusText(item.status) })
        ]),
        el('label', { class: 'check' }, [selected])
      ]),
      el('p', { text: `${item.confirmedCount || 0} confirmadas de ${item.maxSeats} cupos · entrada ${item.checkedInCount || 0}` }),
      el('p', { class: 'muted', text: `${item.phone || 'Sin teléfono'} · respondió ${formatStamp(item.respondedAt, state.settings.timezone)}` }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Editar', onclick: (event) => editGuest(item, event.currentTarget) }),
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Respuesta', onclick: (event) => manualRsvp(item, event.currentTarget) }),
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Enlace', onclick: (event) => revealLink(item, event.currentTarget) }),
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Nuevo enlace', onclick: (event) => regenerate(item, event.currentTarget) }),
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Historial', onclick: () => showHistory(item) }),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          text: item.active === false ? 'Reactivar' : 'Desactivar',
          onclick: (event) => setActive(item, item.active === false, event.currentTarget)
        })
      ])
    ])
  }))
}

async function run(button, work) {
  if (!button || button.dataset.busy === '1') return
  button.dataset.busy = '1'
  button.disabled = true
  try {
    await work()
  } catch (error) {
    toast(error.message || 'No se pudo completar la operación.', 'bad')
  } finally {
    button.disabled = false
    button.dataset.busy = '0'
  }
}

function openModal(title, body) {
  const dialog = modal()
  dialog.replaceChildren(el('div', { class: 'modal' }, [
    el('div', { class: 'modal__head' }, [
      el('h2', { text: title }),
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cerrar', onclick: () => dialog.close() })
    ]),
    body
  ]))
  if (!dialog.open) dialog.showModal()
}

function showLink(guest, token, stored) {
  const url = invitationUrl(token, state.settings)
  const when = `${formatLongDate(state.settings.eventDate, state.settings.timezone)} · ${formatTimeLabel(state.settings.eventTime)}`
  const message = fillTemplate(state.settings.whatsappTemplate || eventDefaults.whatsappTemplate, {
    nombre: guest.name,
    quinceanera: state.settings.quinceaneraName,
    fecha: when,
    enlace: url,
    cupos: String(guest.maxSeats)
  })
  const link = el('input', { readonly: 'true', value: url })
  const qrBox = el('div', { class: 'qr' })
  try { qrBox.append(makeQrSvg(url)) } catch { qrBox.textContent = 'No se pudo dibujar el QR. El enlace sigue siendo válido.' }
  openModal(`Enlace de ${guest.name}`, el('div', { class: 'grid' }, [
    stored ? el('p', { text: 'Puedes copiarlo ahora o volver a abrirlo más tarde.' }) : el('p', { class: 'bad', text: 'Copia este enlace ahora. Sin clave de cifrado no se volverá a mostrar.' }),
    link,
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', type: 'button', text: 'Copiar', onclick: () => copyText(url) }),
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'WhatsApp', onclick: () => window.open(whatsappShareUrl({ phone: guest.phone, message }), '_blank', 'noopener,noreferrer') })
    ]),
    qrBox
  ]))
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value)
    toast('Enlace copiado.')
  } catch {
    toast('No se pudo copiar automáticamente. Selecciona el enlace y cópialo.', 'bad')
  }
}

function guestForm(guest) {
  return el('div', { class: 'grid' }, [
    el('label', {}, ['Nombre', el('input', { name: 'name', required: 'true', maxlength: '80', value: guest?.name || '' })]),
    el('label', {}, ['Teléfono', el('input', { name: 'phone', maxlength: '24', value: guest?.phone || '' })]),
    el('label', {}, ['Cupos', el('input', { name: 'maxSeats', type: 'number', min: '1', max: '25', required: 'true', value: String(guest?.maxSeats || 2) })]),
    el('label', {}, ['Notas internas', el('textarea', { name: 'notes', maxlength: '500', text: guest?.notes || '' })])
  ])
}

function readGuestForm(container) {
  return {
    name: container.querySelector('[name="name"]').value,
    phone: container.querySelector('[name="phone"]').value,
    maxSeats: Number(container.querySelector('[name="maxSeats"]').value),
    notes: container.querySelector('[name="notes"]').value
  }
}

function createGuest() {
  const fields = guestForm()
  const save = el('button', { class: 'btn', type: 'button', text: 'Crear invitación' })
  save.addEventListener('click', () => run(save, async () => {
    const data = readGuestForm(fields)
    const result = await createInvitation(state.db, data, state.user?.email)
    showLink({ ...data, name: result.name }, result.token, true)
    toast('Invitación creada.')
  }))
  openModal('Nueva invitación', el('div', { class: 'grid' }, [fields, save]))
}

function editGuest(guest, button) {
  const fields = guestForm(guest)
  const save = el('button', { class: 'btn', type: 'button', text: 'Guardar cambios' })
  save.addEventListener('click', () => run(save, async () => {
    const data = readGuestForm(fields)
    await updateInvitation(state.db, guest, data, state.user?.email)
    modal().close()
    toast('Cambios guardados.')
  }))
  openModal('Editar invitación', el('div', { class: 'grid' }, [fields, save]))
  void button
}

function manualRsvp(guest) {
  const yes = el('input', { type: 'radio', name: 'asiste', value: 'si' })
  const no = el('input', { type: 'radio', name: 'asiste', value: 'no' })
  if (guest.status === 'rechazado') no.checked = true
  else yes.checked = true
  const seats = el('input', { type: 'number', min: '1', max: String(guest.maxSeats), value: String(guest.confirmedCount || 1) })
  const save = el('button', { class: 'btn', type: 'button', text: 'Guardar respuesta' })
  save.addEventListener('click', () => run(save, async () => {
    const attending = yes.checked
    const guests = attending ? Number(seats.value) : 0
    await adminUpdateRsvp(state.db, guest, { attending, guests }, state.user?.email)
    modal().close()
    toast('Respuesta actualizada.')
  }))
  openModal(`Respuesta de ${guest.name}`, el('div', { class: 'grid' }, [
    el('label', { class: 'check' }, [yes, 'Asistirá']),
    el('label', { class: 'check' }, [no, 'No asistirá']),
    el('label', {}, ['Personas', seats]),
    save
  ]))
}

async function revealLink(guest, button) {
  await run(button, async () => {
    if (!isTokenShape(guest.id)) {
      throw new Error('Esta invitación es anterior al enlace directo y no puede mostrarse. Genera un enlace nuevo.')
    }
    showLink(guest, guest.id, true)
  })
}

async function regenerate(guest, button) {
  if (!window.confirm(`El enlace actual de ${guest.name} dejará de funcionar. ¿Generar uno nuevo?`)) return
  await run(button, async () => {
    const result = await regenerateInvitation(state.db, guest, state.user?.email)
    showLink(guest, result.token, true)
    toast('Enlace nuevo listo. El anterior quedó revocado.')
  })
}

function showHistory(guest) {
  const entries = Array.isArray(guest.recentHistory) ? [...guest.recentHistory].reverse() : []
  openModal(`Historial de ${guest.name}`, entries.length
    ? el('ul', {}, entries.map((entry) => el('li', { text: `${formatStamp(entry.at, state.settings.timezone)} · ${entry.summary} · ${entry.actor || ''}` })))
    : el('p', { text: 'Todavía no hay cambios registrados.' }))
}

async function setActive(guest, active, button) {
  const verb = active ? 'reactivar' : 'desactivar'
  if (!window.confirm(`¿Seguro que quieres ${verb} la invitación de ${guest.name}?`)) return
  await run(button, async () => {
    await setInvitationActive(state.db, guest, active, state.user?.email)
    toast(active ? 'Invitación reactivada.' : 'Invitación desactivada.')
  })
}

function exportCsv() {
  const selected = state.selected.size
    ? visibleGuests().filter((item) => state.selected.has(item.id))
    : visibleGuests()
  const rows = [[
    'nombre', 'telefono', 'cupos', 'estado', 'confirmados', 'ingresaron', 'activo', 'creado', 'respondio', 'notas'
  ], ...selected.map((item) => [
    item.name, item.phone || '', item.maxSeats, item.status, item.confirmedCount || 0,
    item.checkedInCount || 0, item.active === false ? 'no' : 'si', item.createdAt || '', item.respondedAt || '', item.notes || ''
  ])]
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const link = el('a', { href: URL.createObjectURL(blob), download: 'invitados-heyli.csv' })
  link.click()
  URL.revokeObjectURL(link.href)
  toast(`CSV con ${selected.length} registros.`)
}

async function deactivateSelected(button) {
  const ids = [...state.selected]
  if (!ids.length) {
    toast('Selecciona al menos una invitación.', 'bad')
    return
  }
  if (!window.confirm(`¿Desactivar ${ids.length} invitaciones?`)) return
  await run(button, async () => {
    for (const id of ids) {
      const guest = state.invitations.find((item) => item.id === id)
      if (!guest || guest.active === false) continue
      await setInvitationActive(state.db, guest, false, state.user?.email)
    }
    state.selected.clear()
    toast('Selección desactivada.')
  })
}

function agendaRow(item = { time: '', title: '' }) {
  const row = el('div', { class: 'agenda-row' }, [
    el('input', { value: item.time || '', maxlength: '20', 'aria-label': 'Hora', placeholder: '18:00' }),
    el('input', { value: item.title || '', maxlength: '80', 'aria-label': 'Momento' }),
    el('button', { class: 'btn btn--ghost', type: 'button', text: 'Quitar', onclick: () => row.remove() })
  ])
  return row
}

function fillSettings(settings) {
  const form = document.getElementById('settings-form')
  const deadline = formatInZone(settings.rsvpDeadline, settings.timezone)
  const values = {
    quinceaneraName: settings.quinceaneraName,
    publicSiteUrl: settings.publicSiteUrl || '',
    eventDate: settings.eventDate,
    eventTime: settings.eventTime,
    timezone: settings.timezone,
    venueName: settings.venueName,
    venueAddress: settings.venueAddress || '',
    venueNote: settings.venueNote || '',
    mapUrl: settings.mapUrl || '',
    heroMessage: settings.heroMessage || '',
    closingMessage: settings.closingMessage || '',
    giftTitle: settings.giftTitle || '',
    giftMessage: settings.giftMessage || '',
    dressCode: settings.dressCode || '',
    rsvpDate: deadline.date,
    rsvpTime: deadline.time,
    coverImage: settings.coverImage || '',
    musicTitle: settings.music?.title || '',
    musicArtist: settings.music?.artist || '',
    musicFile: settings.music?.localFile || '',
    musicSearch: settings.music?.spotifySearchUrl || '',
    musicEmbed: settings.music?.spotifyEmbedUrl || '',
    whatsappTemplate: settings.whatsappTemplate || '',
    galleryText: (settings.gallery || []).map((item) => item.alt ? `${item.file} | ${item.alt}` : item.file).join('\n')
  }
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements[name]
    if (field) field.value = value
  }
  form.elements.rsvpOpen.checked = settings.rsvpOpen !== false
  const source = settings.gallerySource === 'panel' ? 'panel' : 'archivo'
  form.querySelector(`[name="gallerySource"][value="${source}"]`).checked = true
  form.elements.colorIvory.value = settings.colors?.ivory || '#F6F1EA'
  form.elements.colorRose.value = settings.colors?.rose || '#C9898B'
  form.elements.colorChampagne.value = settings.colors?.champagne || '#F3E6D4'
  form.elements.colorGold.value = settings.colors?.gold || '#A68556'
  form.elements.colorInk.value = settings.colors?.ink || '#3A302E'
  const list = document.getElementById('agenda-list')
  list.replaceChildren(...(settings.agenda?.length ? settings.agenda : []).map(agendaRow))
}

function collectSettings() {
  const form = document.getElementById('settings-form')
  const data = Object.fromEntries(new FormData(form).entries())
  const deadline = zonedTimeToUtc(data.rsvpDate, String(data.rsvpTime || '').slice(0, 5), data.timezone)
  const gallery = String(data.galleryText || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [file, ...rest] = line.split('|')
    return { file: file.trim(), alt: rest.join('|').trim() }
  })
  return {
    quinceaneraName: data.quinceaneraName,
    publicSiteUrl: data.publicSiteUrl,
    eventDate: data.eventDate,
    eventTime: String(data.eventTime || '').slice(0, 5),
    timezone: data.timezone,
    venueName: data.venueName,
    venueAddress: data.venueAddress,
    venueNote: data.venueNote,
    mapUrl: data.mapUrl,
    heroMessage: data.heroMessage,
    closingMessage: data.closingMessage,
    giftTitle: data.giftTitle,
    giftMessage: data.giftMessage,
    dressCode: data.dressCode,
    rsvpDeadline: deadline ? deadline.toISOString() : '',
    rsvpOpen: form.elements.rsvpOpen.checked,
    coverImage: data.coverImage,
    gallerySource: data.gallerySource,
    gallery: data.gallerySource === 'panel' ? gallery : [],
    agenda: [...document.querySelectorAll('#agenda-list .agenda-row')].map((row) => {
      const [time, title] = row.querySelectorAll('input')
      return { time: time.value, title: title.value }
    }),
    music: {
      title: data.musicTitle,
      artist: data.musicArtist,
      localFile: data.musicFile,
      spotifySearchUrl: data.musicSearch,
      spotifyEmbedUrl: data.musicEmbed
    },
    colors: {
      ivory: data.colorIvory,
      rose: data.colorRose,
      champagne: data.colorChampagne,
      gold: data.colorGold,
      ink: data.colorInk
    },
    whatsappTemplate: data.whatsappTemplate
  }
}

function bindSettings() {
  const form = document.getElementById('settings-form')
  form.addEventListener('input', () => { state.settingsDirty = true })
  document.getElementById('agenda-add').addEventListener('click', () => {
    document.getElementById('agenda-list').append(agendaRow())
    state.settingsDirty = true
  })
  document.getElementById('reload-settings').addEventListener('click', () => {
    state.settingsDirty = false
    fillSettings(state.settings)
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const button = form.querySelector('[type="submit"]')
    run(button, async () => {
      const payload = collectSettings()
      const sanitized = sanitizeEventSettings(payload)
      if (sanitized.error) throw new Error(sanitized.error)
      await saveEventSettings(state.db, sanitized.value)
      state.settingsDirty = false
      document.getElementById('settings-status').textContent = 'Cambios guardados.'
      toast('Configuración guardada.')
    }).catch(() => {})
  })
}

function renderPreview(preview) {
  state.preview = preview
  const root = document.getElementById('scan-result')
  const count = el('input', { type: 'number', min: '1', max: String(Math.max(1, preview.remaining)), value: '1' })
  const status = el('p', { class: 'muted', role: 'status' })
  const save = el('button', { class: 'btn', type: 'button', text: 'Registrar entrada' })
  const extra = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Sí, llegaron más personas', hidden: true })
  const send = (confirmAdditional, button) => run(button, async () => {
    const guest = state.invitations.find((item) => item.id === preview.id)
    if (!guest) throw new Error('Esa invitación ya no está en la lista.')
    try {
      const result = await commitCheckIn(state.db, guest, {
        count: Number(count.value),
        confirmAdditional,
        actor: state.user?.email
      })
      status.textContent = `Entrada registrada. Ingresaron ${result.checkedInCount} de ${guest.confirmedCount}. Quedan ${result.remaining}.`
      extra.hidden = true
      guest.checkedInCount = result.checkedInCount
      guest.lastCheckInAt = new Date().toISOString()
      toast('Entrada registrada.')
    } catch (error) {
      if (error.reason === 'recent') extra.hidden = false
      throw error
    }
  })
  save.addEventListener('click', () => send(false, save))
  extra.addEventListener('click', () => send(true, extra))
  root.replaceChildren(el('div', { class: 'result grid' }, [
    el('h3', { text: preview.name }),
    el('p', { text: `Cupos autorizados: ${preview.maxSeats}` }),
    el('p', { text: `Personas confirmadas: ${preview.confirmedCount}` }),
    el('p', { text: `Ya ingresaron: ${preview.checkedInCount}` }),
    el('p', { text: `Pueden ingresar ahora: ${preview.remaining}` }),
    preview.notes ? el('p', { text: `Nota: ${preview.notes}` }) : null,
    el('label', {}, ['Personas que entran ahora', count]),
    el('div', { class: 'actions' }, [save, extra]),
    status
  ]))
}

async function consultToken(raw, button) {
  const token = tokenFromScan(raw)
  if (!token) {
    toast('Ese código no contiene una invitación válida.', 'bad')
    return
  }
  await run(button, async () => {
    state.scanToken = token
    const guest = state.invitations.find((item) => item.id === token)
    if (!guest || guest.active === false) {
      throw new Error('Ese enlace no corresponde a una invitación activa.')
    }
    renderPreview({
      id: guest.id,
      name: guest.name,
      maxSeats: guest.maxSeats,
      confirmedCount: guest.confirmedCount || 0,
      checkedInCount: guest.checkedInCount || 0,
      remaining: Math.max(0, (guest.confirmedCount || 0) - (guest.checkedInCount || 0)),
      notes: guest.notes || ''
    })
  })
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia || !('BarcodeDetector' in window)) {
    toast('Esta cámara no puede leer QR. Pega el enlace manualmente.', 'bad')
    return
  }
  const video = document.getElementById('scan-video')
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  video.srcObject = stream
  await video.play()
  const detector = new BarcodeDetector({ formats: ['qr_code'] })
  const timer = window.setInterval(async () => {
    try {
      const codes = await detector.detect(video)
      if (codes[0]?.rawValue) {
        stopCamera()
        consultToken(codes[0].rawValue, document.getElementById('scan-go'))
      }
    } catch { /* el cuadro todavía no está listo */ }
  }, 700)
  state.stopScan = () => {
    window.clearInterval(timer)
    stream.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  }
}

function stopCamera() {
  state.stopScan?.()
  state.stopScan = null
}

function bindApp() {
  document.getElementById('logout').addEventListener('click', () => signOut(state.auth))
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach((item) => item.setAttribute('aria-selected', String(item === button)))
      for (const id of ['resumen', 'invitados', 'evento', 'acceso']) {
        document.getElementById(`tab-${id}`).hidden = id !== button.dataset.tab
      }
      if (button.dataset.tab !== 'acceso') stopCamera()
    })
  })
  document.getElementById('new-guest').addEventListener('click', createGuest)
  document.getElementById('export-btn').addEventListener('click', exportCsv)
  document.getElementById('print-btn').addEventListener('click', () => {
    document.body.classList.add('is-printing')
    window.print()
    window.addEventListener('afterprint', () => document.body.classList.remove('is-printing'), { once: true })
  })
  document.getElementById('deactivate-btn').addEventListener('click', (event) => deactivateSelected(event.currentTarget))
  document.getElementById('guest-search').addEventListener('input', (event) => {
    state.query = event.target.value
    renderGuests()
  })
  document.getElementById('guest-filter').addEventListener('change', (event) => {
    state.filter = event.target.value
    renderGuests()
  })
  document.getElementById('guest-sort').addEventListener('change', (event) => {
    state.sort = event.target.value
    renderGuests()
  })
  document.getElementById('select-all').addEventListener('change', (event) => {
    const items = visibleGuests()
    if (event.target.checked) items.forEach((item) => state.selected.add(item.id))
    else items.forEach((item) => state.selected.delete(item.id))
    renderGuests()
  })
  document.getElementById('scan-start').addEventListener('click', () => startCamera().catch(() => toast('No se pudo usar la cámara.', 'bad')))
  document.getElementById('scan-stop').addEventListener('click', stopCamera)
  document.getElementById('scan-go').addEventListener('click', (event) => consultToken(document.getElementById('scan-manual').value, event.currentTarget))
  document.getElementById('gallery-hint').textContent = `La galería local usa ${galleryItems.length} fotografías de Heyli, con su nombre de archivo original.`
  bindSettings()
  fillSettings(state.settings)
}

function subscribe() {
  state.unsub.push(onSnapshot(doc(state.db, 'eventSettings', 'public'), (snap) => {
    state.settings = { ...eventDefaults, ...(snap.exists() ? settingsFromDoc(snap.data()) : {}) }
    if (!state.settingsDirty) fillSettings(state.settings)
  }, () => toast('No se pudo leer la configuración del evento.', 'bad')))
  let generation = 0
  state.unsub.push(onSnapshot(collection(state.db, 'invitations'), async (snap) => {
    const current = ++generation
    const items = await Promise.all(snap.docs.map(async (item) => {
      const guest = publicInvitation(item.id, item.data())
      try {
        const priv = await getDoc(doc(state.db, 'invitations', item.id, 'private', 'profile'))
        guest.phone = priv.exists() ? priv.data().phone || '' : ''
        guest.notes = priv.exists() ? priv.data().notes || '' : ''
      } catch {
        guest.phone = ''
        guest.notes = ''
      }
      return guest
    }))
    if (current !== generation) return
    state.invitations = items
    renderStats()
    renderGuests()
  }, () => toast('No se pudieron leer las invitaciones. Revisa el permiso de administrador y las reglas.', 'bad')))
}

function clearSubs() {
  state.unsub.forEach((stop) => stop())
  state.unsub = []
  stopCamera()
}

async function showApp(user) {
  state.user = user
  document.getElementById('admin-email').textContent = user.email || ''
  show('view-app')
  if (!state.bound) {
    bindApp()
    state.bound = true
  }
  clearSubs()
  subscribe()
}

function showDenied(user) {
  clearSubs()
  document.getElementById('denied-email').textContent = user.email || ''
  show('view-denied')
}

function showLogin(message = '') {
  clearSubs()
  document.getElementById('login-error').textContent = message
  show('view-login')
}

async function main() {
  const firebase = await initFirebase()
  state.auth = firebase.auth
  state.db = firebase.db
  document.getElementById('login-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const button = event.currentTarget.querySelector('button')
    run(button, async () => {
      document.getElementById('login-error').textContent = ''
      try {
        await signInWithEmailAndPassword(
          state.auth,
          document.getElementById('login-email').value.trim(),
          document.getElementById('login-password').value
        )
      } catch (error) {
        document.getElementById('login-error').textContent = authMessage(error)
      }
    })
  })
  document.getElementById('denied-logout').addEventListener('click', () => signOut(state.auth))
  onAuthStateChanged(state.auth, async (user) => {
    if (!user) {
      showLogin()
      return
    }
    try {
      const allowed = await userIsAdmin(state.db, user.uid)
      if (!allowed) {
        showDenied(user)
        return
      }
      await showApp(user)
    } catch (error) {
      if (error.code === 'auth/network-request-failed' || error.code === 'unavailable') {
        showLogin('No hay conexión para comprobar el permiso de administrador.')
        return
      }
      await signOut(state.auth).catch(() => {})
      showLogin('Tu sesión ya no es válida. Entra de nuevo.')
    }
  })
}

main().catch(() => {
  showLogin('No se pudo preparar el acceso.')
})
