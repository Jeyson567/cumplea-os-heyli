import { el } from './dom.js'
import { isSafeAudioFile, isSpotifySearch, sanitizeSpotifyEmbed } from './policy.js'

const EXACT_EMBED = 'https://open.spotify.com/embed/track/6lanRgr6wXibZr8KgzXxBl?utm_source=generator&si=b2b935b5c9a44f17'
const EXACT_ENTITY = 'https://open.spotify.com/track/6lanRgr6wXibZr8KgzXxBl?utm_source=generator&si=b2b935b5c9a44f17'
const EXACT_ID = '6lanRgr6wXibZr8KgzXxBl'

let controller = null
let host = null
let currentUrl = ''
let playing = false
let heardPlayback = false
let pendingPlay = false
let apiPromise = null
let blockedTimer = 0

function playerUrl(music) {
  const custom = sanitizeSpotifyEmbed(music?.spotifyEmbedUrl || '')
  if (custom && !custom.endsWith(`/${EXACT_ID}`)) return custom
  return EXACT_EMBED
}

function loadApi() {
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    const previous = window.onSpotifyIframeApiReady
    window.onSpotifyIframeApiReady = (api) => {
      if (typeof previous === 'function') previous(api)
      resolve(api)
    }
    if (document.querySelector('script[data-spotify-api]')) return
    const script = document.createElement('script')
    script.src = 'https://open.spotify.com/embed/iframe-api/v1'
    script.async = true
    script.dataset.spotifyApi = '1'
    script.addEventListener('error', () => resolve(null))
    document.head.appendChild(script)
  })
  return apiPromise
}

function paint(button, label) {
  if (!button || !label) return
  button.classList.toggle('is-playing', playing)
  button.hidden = false
  label.textContent = playing
    ? 'Pausar canción'
    : heardPlayback
      ? 'Reanudar canción'
      : 'Esta historia merece una canción... toca para escucharla'
}

function markPlaying(next) {
  playing = next
  if (next) heardPlayback = true
  const button = document.getElementById('music-invite')
  const label = document.getElementById('music-invite-label')
  paint(button, label)
}

function readPlaying(data) {
  if (!data || typeof data !== 'object') return null
  if (typeof data.isPaused === 'boolean') return !data.isPaused
  if (typeof data.isPlaying === 'boolean') return data.isPlaying
  return null
}

function watchPlayback() {
  window.clearTimeout(blockedTimer)
  blockedTimer = window.setTimeout(() => {
    if (!playing) markPlaying(false)
  }, 1600)
}

function attach(api, url) {
  if (!host || !api?.createController || controller) return
  api.createController(host, {
    width: '100%',
    height: 152,
    url: url.includes(EXACT_ID) ? EXACT_ENTITY : url.replace('/embed/', '/')
  }, (created) => {
    controller = created
    if (pendingPlay) {
      pendingPlay = false
      created.play()
      watchPlayback()
    }
    created.addListener('playback_update', (event) => {
      const next = readPlaying(event?.data)
      if (next !== null) markPlaying(next)
    })
    created.addListener('playback_started', () => {
      window.clearTimeout(blockedTimer)
      markPlaying(true)
    })
  })
}

function fallbackFrame(url) {
  const mount = document.getElementById('music-root')
  if (!mount || mount.querySelector('iframe')) return
  mount.append(el('iframe', {
    class: 'music__embed',
    src: url,
    title: 'A Thousand Years, Christina Perri en Spotify',
    width: '100%',
    height: '152',
    style: 'border-radius:12px',
    allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
    allowfullscreen: '',
    loading: 'eager',
    referrerpolicy: 'strict-origin-when-cross-origin'
  }))
}

export function mountMusic(container, music) {
  const data = music && typeof music === 'object' ? music : {}
  const url = playerUrl(data)
  const title = data.title || 'A Thousand Years'
  const artist = data.artist || 'Christina Perri'
  const search = isSpotifySearch(data.spotifySearchUrl || '')
    ? data.spotifySearchUrl
    : `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`.trim())}`
  const file = isSafeAudioFile(data.localFile || '') ? data.localFile : ''

  if (container.dataset.mounted === '1') {
    const heading = container.querySelector('h3')
    const artistNode = container.querySelector('[data-artist]')
    if (heading) heading.textContent = title
    if (artistNode) artistNode.textContent = artist
    const link = container.querySelector('[data-spotify-search]')
    if (link) link.href = search
    return controls()
  }

  container.dataset.mounted = '1'
  currentUrl = url
  host = el('div', { id: 'spotify-host', class: 'spotify-host' })
  const status = el('p', { class: 'music__status', text: 'La canción suena aquí, sin interrumpir la invitación.' })
  let audio = null
  let playButton = null

  if (file) {
    audio = new Audio(`assets/audio/${encodeURIComponent(file)}`)
    audio.preload = 'none'
    playButton = el('button', { type: 'button', class: 'music__play', text: 'Reproducir archivo' })
    playButton.addEventListener('click', () => {
      if (!audio.paused) {
        audio.pause()
        playButton.textContent = 'Reproducir archivo'
        return
      }
      audio.play().then(() => {
        playButton.textContent = 'Pausar archivo'
      }).catch(() => {
        status.textContent = 'El navegador no permitió el archivo local. Puedes usar el reproductor de Spotify.'
      })
    })
    audio.addEventListener('ended', () => { playButton.textContent = 'Reproducir archivo' })
    audio.addEventListener('error', () => {
      status.textContent = 'No se encontró el archivo de audio. Spotify sigue disponible.'
      playButton.disabled = true
    })
  }

  container.append(
    el('div', { class: 'music__card' }, [
      el('div', { class: 'music__disc', 'aria-hidden': 'true' }),
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'Canción' }),
        el('h3', { text: title }),
        el('p', { 'data-artist': 'true', text: artist }),
        el('div', { class: 'music__actions' }, [
          playButton,
          el('a', {
            class: 'text-link',
            'data-spotify-search': 'true',
            href: search,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: 'Abrir en Spotify'
          })
        ]),
        status
      ])
    ]),
    host
  )

  const invite = document.getElementById('music-invite')
  if (invite && invite.dataset.bound !== '1') {
    invite.dataset.bound = '1'
    invite.addEventListener('click', () => {
      if (playing) {
        controller?.pause()
        markPlaying(false)
        return
      }
      playNow()
    })
  }

  loadApi().then((api) => {
    if (!api) {
      fallbackFrame(url)
      return
    }
    try {
      attach(api, url)
    } catch {
      fallbackFrame(url)
    }
  })
  window.setTimeout(() => fallbackFrame(url), 4000)

  return controls()

  function playNow() {
    if (!controller) {
      pendingPlay = true
      markPlaying(false)
      return
    }
    pendingPlay = false
    controller.play()
    watchPlayback()
  }

  function controls() {
    return {
      playFromGesture() {
        playNow()
      },
      destroy() {
        audio?.pause()
      }
    }
  }
}
