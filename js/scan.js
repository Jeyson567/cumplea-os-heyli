import jsQR from './vendor/jsQR.js'

export function cameraErrorText(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Permiso de cámara denegado. Puedes pegar el enlace manualmente.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'No hay una cámara disponible. Puedes pegar el enlace manualmente.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'La cámara está en uso por otra aplicación.'
  }
  if (name === 'SecurityError') {
    return 'La cámara solo puede usarse en HTTPS o en localhost.'
  }
  return 'No se pudo abrir la cámara. Puedes pegar el enlace manualmente.'
}

export function createScanner({ video, status, cameraSelect, onCode }) {
  let stream = null
  let timer = 0
  let detector = null
  let stopped = true
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })

  function setStatus(text) {
    if (status) status.textContent = text || ''
  }

  function stopTracks() {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    if (!video) return
    video.srcObject = null
    video.classList.remove('is-live')
  }

  function stop(options = {}) {
    stopped = true
    window.clearInterval(timer)
    timer = 0
    detector = null
    stopTracks()
    if (!options.silent) setStatus('')
  }

  async function detect() {
    if (!video || video.readyState < 2) return
    try {
      if (detector) {
        const codes = await detector.detect(video)
        if (codes[0]?.rawValue) finish(codes[0].rawValue)
        return
      }
      const width = video.videoWidth
      const height = video.videoHeight
      if (!width || !height || !context) return
      canvas.width = width
      canvas.height = height
      context.drawImage(video, 0, 0, width, height)
      const image = context.getImageData(0, 0, width, height)
      const code = jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' })
      if (code?.data) finish(code.data)
    } catch {
      /* el cuadro todavía no está listo */
    }
  }

  function finish(value) {
    stop()
    setStatus('Código leído. Revisando la invitación.')
    onCode(value)
  }

  async function fillCameras() {
    if (!cameraSelect || !navigator.mediaDevices?.enumerateDevices) return
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === 'videoinput')
    const label = cameraSelect.closest('label') || cameraSelect
    if (devices.length < 2) {
      label.hidden = true
      return
    }
    const current = stream?.getVideoTracks()[0]?.getSettings()?.deviceId || ''
    cameraSelect.replaceChildren(...devices.map((device, index) => {
      const option = document.createElement('option')
      option.value = device.deviceId
      option.textContent = device.label || `Cámara ${index + 1}`
      return option
    }))
    if (current) cameraSelect.value = current
    label.hidden = false
  }

  async function open(deviceId) {
    if (!window.isSecureContext) {
      setStatus('La cámara solo funciona en HTTPS o en localhost.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Este navegador no permite usar la cámara. Pega el enlace manualmente.')
      return
    }
    stop({ silent: true })
    stopped = false
    setStatus('El navegador pedirá permiso para usar la cámara.')
    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: 'environment' } }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false })
    } catch (error) {
      if (!stopped) setStatus(cameraErrorText(error))
      stopTracks()
      return
    }
    if (stopped) {
      stopTracks()
      return
    }
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.classList.add('is-live')
    try {
      await video.play()
    } catch {
      stop({ silent: true })
      setStatus('No se pudo mostrar la cámara.')
      return
    }
    setStatus('Apunta la cámara al código QR.')
    await fillCameras()
    if ('BarcodeDetector' in window) {
      try { detector = new BarcodeDetector({ formats: ['qr_code'] }) } catch { detector = null }
    }
    timer = window.setInterval(() => { void detect() }, 350)
  }

  return {
    open,
    stop,
    switchCamera(deviceId) { return open(deviceId) }
  }
}
