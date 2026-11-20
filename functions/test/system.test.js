import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { bootstrapDecision, secretsMatch, validateBootstrapAccount } from '../src/bootstrap-policy.js'
import { callableUrl, explainSetupFailure } from '../../js/setup-errors.js'
import { decryptToken, encryptToken, generateToken, hashToken } from '../src/tokens.js'
import {
  classifyToken,
  evaluateCheckIn,
  evaluateRsvp,
  evaluateSeatChange,
  isSafeImageFile,
  isTokenShape,
  sanitizeEventSettings,
  sanitizeSpotifyEmbed
} from '../src/policy.js'
import { csvCell, toCsv } from '../../js/csv.js'
import { adminIsActive, authFailureText, canCreateAdminAccount, describeFailure, setupNextStep } from '../../js/access.js'
import { invitationUrl, tokenFromScan, whatsappShareUrl } from '../../js/links.js'
import { countdownParts, formatLongDate, formatTimeLabel, zonedTimeToUtc } from '../../js/time.js'
import { qrcode } from '../../js/vendor/qrcode.mjs'
import jsQR from '../../js/vendor/jsQR.js'

const root = new URL('../../', import.meta.url)

test('la política del navegador y del servidor es la misma', () => {
  const normalize = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  assert.equal(normalize(new URL('../src/policy.js', import.meta.url)), normalize(new URL('../../js/policy.js', import.meta.url)))
})

test('el token es aleatorio, largo y no se guarda como texto reconocible', () => {
  const first = generateToken()
  const second = generateToken()
  assert.equal(first.length, 43)
  assert.equal(isTokenShape(first), true)
  assert.notEqual(first, second)
  assert.equal(hashToken(first), hashToken(first))
  assert.notEqual(hashToken(first), first)
  assert.equal(hashToken(first).length, 64)
  const key = Buffer.alloc(32, 7)
  const encrypted = encryptToken(first, key)
  assert.equal(decryptToken(encrypted, key), first)
  assert.notEqual(encrypted.ciphertext.includes(first), true)
  assert.throws(() => decryptToken(encrypted, Buffer.alloc(32, 8)))
})

test('la hora de Guatemala no se desplaza de día', () => {
  assert.equal(zonedTimeToUtc('2026-12-13', '18:00', 'America/Guatemala').toISOString(), '2026-12-14T00:00:00.000Z')
  assert.equal(formatTimeLabel('18:00'), '6:00 p. m.')
  assert.match(formatLongDate('2026-12-13', 'America/Guatemala'), /13/)
  assert.match(formatLongDate('2026-12-13', 'America/Guatemala'), /diciembre/i)
  const parts = countdownParts(Date.parse('2026-12-14T00:00:00.000Z'), Date.parse('2026-12-13T00:00:00.000Z'))
  assert.equal(parts.done, false)
  assert.equal(parts.days, 1)
})

test('confirmación, rechazo, cambio y límite de cupos', () => {
  const accepted = evaluateRsvp({ attending: true, guests: 3, maxSeats: 4, nowMs: 1, deadlineMs: 10, rsvpOpen: true })
  assert.deepEqual({ status: accepted.status, confirmedCount: accepted.confirmedCount }, { status: 'confirmado', confirmedCount: 3 })
  const changed = evaluateRsvp({ attending: true, guests: 4, maxSeats: 4, nowMs: 2, deadlineMs: 10, rsvpOpen: true })
  assert.equal(changed.confirmedCount, 4)
  const declined = evaluateRsvp({ attending: false, guests: 9, maxSeats: 4, nowMs: 3, deadlineMs: 10 })
  assert.deepEqual({ status: declined.status, confirmedCount: declined.confirmedCount }, { status: 'rechazado', confirmedCount: 0 })
  assert.equal(evaluateRsvp({ attending: true, guests: 5, maxSeats: 4, nowMs: 1, deadlineMs: 10 }).ok, false)
  assert.equal(evaluateRsvp({ attending: true, guests: '2', maxSeats: 4, nowMs: 1, deadlineMs: 10 }).ok, false)
  assert.equal(evaluateRsvp({ attending: true, guests: 2, maxSeats: 4, nowMs: 11, deadlineMs: 10 }).code, 'deadline')
  assert.equal(evaluateRsvp({ attending: true, guests: 2, maxSeats: 4, nowMs: 1, rsvpOpen: false }).code, 'closed')
  assert.equal(evaluateRsvp({ attending: false, guests: 0, maxSeats: 4, checkedInCount: 1, bypassWindow: true }).ok, false)
  assert.equal(evaluateSeatChange({ maxSeats: 2, confirmedCount: 3, checkedInCount: 0 }).ok, false)
  assert.equal(evaluateSeatChange({ maxSeats: 4, confirmedCount: 3, checkedInCount: 1 }).ok, true)
})

test('entrada parcial, tope y doble registro inmediato', () => {
  const first = evaluateCheckIn({ count: 2, confirmedCount: 4, checkedInCount: 0, nowMs: 1_000 })
  assert.equal(first.checkInStatus, 'parcial')
  const second = evaluateCheckIn({ count: 2, confirmedCount: 4, checkedInCount: first.checkedInCount, nowMs: 2_000 })
  assert.equal(second.checkInStatus, 'completo')
  const duplicate = evaluateCheckIn({
    count: 1,
    confirmedCount: 4,
    checkedInCount: second.checkedInCount,
    lastCheckInAt: new Date(2_000).toISOString(),
    nowMs: 3_000
  })
  assert.equal(duplicate.code, 'already')
  const tooSoon = evaluateCheckIn({
    count: 1,
    confirmedCount: 4,
    checkedInCount: 1,
    lastCheckInAt: new Date(10_000).toISOString(),
    nowMs: 12_000
  })
  assert.equal(tooSoon.code, 'recent')
  const allowed = evaluateCheckIn({
    count: 1,
    confirmedCount: 4,
    checkedInCount: 1,
    lastCheckInAt: new Date(10_000).toISOString(),
    nowMs: 12_000,
    confirmAdditional: true
  })
  assert.equal(allowed.ok, true)
  assert.equal(evaluateCheckIn({ count: 1, confirmedCount: 0, checkedInCount: 0 }).code, 'not-confirmed')
})

test('un token revocado, inactivo o desconocido no se confunde', () => {
  assert.equal(classifyToken(null, { active: true }), 'invalid')
  assert.equal(classifyToken({ status: 'revoked' }, { active: true }), 'revoked')
  assert.equal(classifyToken({ status: 'active' }, { active: false }), 'inactive')
  assert.equal(classifyToken({ status: 'active' }, { active: true }), 'valid')
})

test('spotify, imágenes y configuración rechazan datos inseguros', () => {
  assert.equal(sanitizeSpotifyEmbed('https://open.spotify.com/track/123'), null)
  assert.equal(
    sanitizeSpotifyEmbed('https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaaa'),
    'https://open.spotify.com/embed/track/aaaaaaaaaaaaaaaaaaaaaa'
  )
  assert.equal(
    sanitizeSpotifyEmbed('https://open.spotify.com/embed/track/6lanRgr6wXibZr8KgzXxBl?utm_source=generator&si=b2b935b5c9a44f17'),
    'https://open.spotify.com/embed/track/6lanRgr6wXibZr8KgzXxBl'
  )
  assert.equal(isSafeImageFile('../secreto.jpg'), false)
  assert.equal(isSafeImageFile('foto final.jpg'), true)
  const bad = sanitizeEventSettings({
    quinceaneraName: 'Heyli Orrego',
    eventDate: '2026-02-31',
    eventTime: '18:00',
    timezone: 'America/Guatemala',
    venueName: 'Colinas Country Club',
    mapUrl: 'https://evil.example/robo',
    rsvpDeadline: '2026-12-11T00:00:00.000Z',
    rsvpOpen: true
  })
  assert.equal(typeof bad.error, 'string')
  const good = sanitizeEventSettings({
    quinceaneraName: 'Heyli Orrego',
    eventDate: '2026-12-13',
    eventTime: '18:00',
    timezone: 'America/Guatemala',
    venueName: 'Colinas Country Club',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Colina+Country+Club+Quetzaltenango',
    rsvpDeadline: '2026-12-11T00:00:00.000Z',
    rsvpOpen: true,
    gallery: [{ file: 'placeholder-1.svg', alt: 'Temporal' }],
    music: { title: 'A Thousand Years', artist: 'Christina Perri', spotifyEmbedUrl: '' }
  })
  assert.equal(good.value.quinceaneraName, 'Heyli Orrego')
  assert.equal(good.value.dressCode, '')
  assert.deepEqual(good.value.agenda, [])
  assert.equal('token' in good.value, false)
})

test('csv y enlaces no filtran fórmulas ni arman mal el token', () => {
  assert.equal(csvCell('=cmd|'), "'=cmd|")
  assert.equal(csvCell('Familia; Pérez'), '"Familia; Pérez"')
  assert.match(toCsv([['nombre'], ['Familia Pérez']]), /sep=;/)
  const token = 'a'.repeat(43)
  const other = 'b'.repeat(43)
  const previous = globalThis.location
  const at = (href) => {
    const page = new URL(href)
    globalThis.location = { origin: page.origin, pathname: page.pathname, href: `${page.href}&arrastrado=admin.html` }
  }
  try {
    at('https://jeyson567.github.io/cumplea-os-heyli/admin')
    const pagesUrl = invitationUrl(token)
    at('https://dominio.com/proyecto/admin.html')
    const fileUrl = invitationUrl(token)
    at('https://dominio.com/proyecto/admin')
    const cleanUrl = invitationUrl(token)
    at('http://127.0.0.1:5500/admin.html')
    const localUrl = invitationUrl(other)
    at('https://dominio.com/proyecto/admin/')
    const slashUrl = invitationUrl(token)
    at('https://dominio.com/proyecto/admin/index.html')
    const nestedUrl = invitationUrl(token)
    const official = (value) => `http://heilyxv.com/?invitacion=${value}`
    assert.equal(pagesUrl, official(token))
    assert.equal(fileUrl, official(token))
    assert.equal(cleanUrl, official(token))
    assert.equal(localUrl, official(other))
    assert.equal(slashUrl, official(token))
    assert.equal(nestedUrl, official(token))
    for (const url of [pagesUrl, fileUrl, cleanUrl, localUrl, slashUrl, nestedUrl]) {
      assert.equal(url.includes('/admin'), false)
      assert.equal(url.includes('admin.html'), false)
      assert.equal(readInvitationQr(url), url)
    }
    assert.equal(tokenFromScan(pagesUrl), token)
    assert.equal(tokenFromScan(fileUrl), token)
    assert.equal(tokenFromScan(localUrl), other)
    const adminSource = fs.readFileSync(new URL('js/admin.js', root), 'utf8')
    assert.match(adminSource, /const url = invitationUrl\(token\)/)
    assert.match(adminSource, /value: url/)
    assert.match(adminSource, /copyText\(url\)/)
    assert.match(adminSource, /enlace: url/)
    assert.match(adminSource, /makeQrSvg\(url\)/)
  } finally {
    globalThis.location = previous
  }
  assert.equal(tokenFromScan(`https://cumpleheyli.web.app/index.html?invitacion=${other}`), other)
  assert.equal(tokenFromScan('no-es-token'), null)
  assert.match(whatsappShareUrl({ phone: '+502 5555-5555', message: 'Hola' }), /^https:\/\/wa\.me\/50255555555\?text=/)
})

function readInvitationQr(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  const scale = 8
  const margin = 2
  const size = (count + margin * 2) * scale
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / scale) - margin
      const my = Math.floor(y / scale) - margin
      const dark = mx >= 0 && my >= 0 && mx < count && my < count && qr.isDark(my, mx)
      const index = (y * size + x) * 4
      const color = dark ? 0 : 255
      data[index] = color
      data[index + 1] = color
      data[index + 2] = color
      data[index + 3] = 255
    }
  }
  return jsQR(data, size, size)?.data
}

test('el código QR cabe un enlace individual', () => {
  const qr = qrcode(0, 'M')
  qr.addData(`https://cumpleheyli.web.app/?invitacion=${'a'.repeat(43)}`)
  qr.make()
  assert.ok(qr.getModuleCount() >= 21)
})

test('la invitación pública no abre el panel ni relaja las reglas', () => {
  const index = fs.readFileSync(new URL('index.html', root), 'utf8')
  const adminHtml = fs.readFileSync(new URL('admin.html', root), 'utf8')
  const rules = fs.readFileSync(new URL('firestore.rules', root), 'utf8')
  const admin = fs.readFileSync(new URL('js/admin.js', root), 'utf8')
  const setup = fs.readFileSync(new URL('js/setup.js', root), 'utf8')
  const invitation = fs.readFileSync(new URL('js/invitation.js', root), 'utf8')
  const hosting = fs.readFileSync(new URL('firebase.json', root), 'utf8')
  const pages = fs.readFileSync(new URL('_config.yml', root), 'utf8')
  const service = fs.readFileSync(new URL('functions/src/service.js', root), 'utf8')
  assert.match(index, /property="og:title" content="XV años de Heily Pérez Orrego"/)
  assert.match(index, /property="og:description" content="Te invitamos a celebrar los XV años de Heily Pérez Orrego\. 13 de diciembre de 2026 \| 6:00 p\. m\."/)
  assert.doesNotMatch(index, /property="og:description"[^>]*Colina/)
  assert.doesNotMatch(index, /property="og:description"[^>]*Salón/)
  assert.match(index, /property="og:url" content="http:\/\/heilyxv\.com\/"/)
  assert.match(index, /property="og:image" content="https:\/\/heilyxv\.com\/assets\/img\/og-cover\.png\?v=20261119"/)
  assert.match(index, /name="twitter:title" content="XV años de Heily Pérez Orrego"/)
  assert.match(index, /name="twitter:description" content="Te invitamos a celebrar los XV años de Heily Pérez Orrego\. 13 de diciembre de 2026 \| 6:00 p\. m\."/)
  assert.doesNotMatch(index, /name="twitter:description"[^>]*Colina/)
  assert.match(index, /name="twitter:image" content="https:\/\/heilyxv\.com\/assets\/img\/og-cover\.png\?v=20261119"/)
  assert.match(invitation, /Si asistirás con acompañantes, estos deberán ser exclusivamente familiares tuyos/)
  assert.equal(index.includes('github.io'), false)
  assert.equal(index.includes('Colinas'), false)
  assert.equal(index.includes('Heyli'), false)
  assert.equal(index.includes('admin.html'), false)
  assert.equal(index.includes('setup-privado'), false)
  assert.equal(adminHtml.includes('setup-privado'), false)
  assert.equal(admin.includes('setup-privado'), false)
  assert.equal(index.includes('Abrir invitación'), true)
  assert.equal(rules.includes('if true'), false)
  assert.equal(rules.includes('token.admin'), false)
  assert.match(rules, /allow list: if isAdmin\(\)/)
  assert.match(rules, /allow create, update, delete: if false/)
  assert.match(rules, /match \/system\//)
  assert.equal(admin.includes('createUserWithEmailAndPassword'), false)
  assert.equal(admin.includes('callFunction'), false)
  assert.equal(invitation.includes('resolveInvitation'), false)
  assert.equal(invitation.includes("getElementById('cupos-box')"), false)
  assert.match(invitation, /cuposBox\.hidden/)
  assert.equal(invitation.includes('callFunction'), false)
  assert.equal(setup.includes('createUserWithEmailAndPassword'), true)
  assert.equal(setup.includes('bootstrapAdmin'), false)
  assert.equal(setup.includes('httpsCallable'), false)
  assert.match(hosting, /setup-privado\.html/)
  assert.match(pages, /setup-privado\.html/)
  assert.match(service, /runTransaction/)
  assert.match(service, /decision\.confirmedCount/)
  assert.equal(fs.existsSync(new URL('serviceAccount.json', root)), false)
})

test('la instalación acepta un solo administrador y no compara mal el secreto', () => {
  const secret = 'secreto-de-instalacion-16'
  assert.equal(secretsMatch(secret, secret), true)
  assert.equal(secretsMatch('otra-clave-distinta-16', secret), false)
  assert.equal(secretsMatch('corta', secret), false)
  assert.equal(secretsMatch(secret, ''), false)
  assert.equal(validateBootstrapAccount({ email: 'Admin@Correo.com', password: 'clave-segura' }).email, 'admin@correo.com')
  assert.equal(validateBootstrapAccount({ email: 'no-es-correo', password: 'clave-segura' }).ok, false)
  assert.equal(validateBootstrapAccount({ email: 'admin@correo.com', password: 'corta' }).ok, false)
  assert.equal(bootstrapDecision({ email: 'admin@correo.com' }).action, 'create')
  assert.equal(bootstrapDecision({ completed: true, email: 'admin@correo.com' }).reason, 'completed')
  assert.equal(bootstrapDecision({ anyAdmin: true, userIsAdmin: true, email: 'admin@correo.com' }).action, 'finish-existing')
  assert.equal(bootstrapDecision({ userExists: true, email: 'admin@correo.com' }).reason, 'email-exists')
  assert.equal(bootstrapDecision({
    pendingStatus: 'pending',
    pendingEmail: 'otro@correo.com',
    pendingAgeMs: 1000,
    email: 'admin@correo.com'
  }).reason, 'pending')
})

test('un fallo de instalación dice qué función y qué dirección fallaron', () => {
  const target = { region: 'us-central1', projectId: 'cumpleheyli' }
  const missing = explainSetupFailure(
    { code: 'functions/internal', message: 'Firebase: Error (functions/internal).' },
    'bootstrapAdmin',
    target
  )
  assert.match(missing, /bootstrapAdmin/)
  assert.match(missing, /us-central1/)
  assert.equal(missing.includes(callableUrl('us-central1', 'cumpleheyli', 'bootstrapAdmin')), true)
  assert.match(missing, /No se creó ningún administrador/)
  assert.equal(missing.includes('completada y bloqueada'), false)
  const secret = explainSetupFailure(
    { code: 'functions/permission-denied', message: 'El secreto de instalación no es válido.' },
    'bootstrapAdmin',
    target
  )
  assert.match(secret, /El secreto de instalación no es válido/)
  assert.match(secret, /functions\/permission-denied/)
})

test('la instalación no crea otra cuenta y el panel exige active', () => {
  const uid = 'mu81tHSQCARVz2GNe780uupXF4s1'
  assert.equal(canCreateAdminAccount({ completed: false, designatedUid: uid }), false)
  assert.equal(canCreateAdminAccount({ completed: true, designatedUid: '' }), false)
  assert.equal(canCreateAdminAccount({ completed: false, designatedUid: '' }), true)
  assert.equal(adminIsActive({ active: true }), true)
  assert.equal(adminIsActive({ active: false }), false)
  assert.equal(adminIsActive({}), false)
  assert.equal(setupNextStep({ completed: true, signedIn: false }), 'panel-only')
  assert.equal(setupNextStep({ completed: false, signedIn: false }), 'sign-in')
  assert.equal(setupNextStep({ signedIn: true, adminExists: false, active: false }), 'missing-document')
  assert.equal(setupNextStep({ signedIn: true, adminExists: true, active: false }), 'inactive-document')
  assert.equal(setupNextStep({ completed: true, signedIn: true, adminExists: true, active: true }), 'open-panel')
  assert.match(authFailureText('auth/unauthorized-domain'), /heilyxv\.com/)
  assert.match(authFailureText('auth/email-already-in-use'), /No se creará otra cuenta/)
  assert.match(authFailureText('auth/invalid-credential'), /incorrectos/)
  assert.match(authFailureText('auth/user-not-found'), /incorrectos/)
  assert.match(authFailureText('permission-denied'), /Firestore/)
  assert.match(authFailureText('failed-precondition'), /índice/)
  assert.match(describeFailure({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }, 'falló'), /Firestore/)
  const rules = fs.readFileSync(new URL('firestore.rules', root), 'utf8')
  assert.match(rules, /data\.active == true/)
  const setup = fs.readFileSync(new URL('js/setup.js', root), 'utf8')
  assert.match(setup, /admin\.html/)
  assert.equal(setup.includes('setDoc(doc(state.db, \'admins\''), false)
})

test('el cliente apunta a jsagency y los enlaces no usan su hosting', () => {
  const config = fs.readFileSync(new URL('js/firebase-config.js', root), 'utf8')
  const links = fs.readFileSync(new URL('js/links.js', root), 'utf8')
  assert.match(config, /projectId: 'jsagency-b607c'/)
  assert.match(config, /authDomain: 'jsagency-b607c\.firebaseapp\.com'/)
  assert.match(config, /getFirestore\(app, 'default'\)/)
  assert.equal(config.includes('cumpleheyli'), false)
  assert.equal(config.includes('.web.app'), false)
  assert.equal(links.includes('.web.app'), false)
  assert.equal(links.includes('jsagency'), false)
})

test('la galería usa el manifiesto y las fotografías que están en la carpeta', () => {
  const gallery = fs.readFileSync(new URL('js/gallery-config.js', root), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(new URL('media/gallery.json', root), 'utf8'))
  assert.equal(gallery.includes('WhatsApp Image'), false)
  assert.equal(gallery.includes('placeholder-1.svg'), false)
  assert.equal(manifest.video, 'HeilyPrez.mp4')
  assert.equal(fs.existsSync(new URL(`assets/img/${manifest.video}`, root)), true)
  assert.ok(Array.isArray(manifest.images) && manifest.images.length > 0)
  for (const file of manifest.images) {
    const name = typeof file === 'string' ? file : file.file
    assert.equal(isSafeImageFile(name), true)
    assert.equal(fs.existsSync(new URL(`assets/img/${name}`, root)), true)
  }
  assert.equal(isSafeImageFile('../secreto.jpg'), false)
  assert.equal(isSafeImageFile('fotos/heyli.jpg'), false)
})
