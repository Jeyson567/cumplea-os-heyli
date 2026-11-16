const OPAQUE = /^(internal|not-found|unavailable|deadline-exceeded|cancelled|unknown)$/i

export function callableUrl(region, projectId, name) {
  return `https://${region}-${projectId}.cloudfunctions.net/${name}`
}

function cleanMessage(error) {
  const raw = typeof error?.message === 'string' ? error.message : ''
  return raw
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^Firebase:\s*/i, '')
    .trim()
}

export function explainSetupFailure(error, name, target) {
  const code = typeof error?.code === 'string' && error.code ? error.code : 'sin-código'
  const url = callableUrl(target.region, target.projectId, name)
  const cleaned = cleanMessage(error)
  const unreachable = code === 'functions/not-found'
    || code === 'functions/unavailable'
    || code === 'functions/deadline-exceeded'
    || (code === 'functions/internal' && (
      !cleaned
      || OPAQUE.test(cleaned)
      || /functions\/internal/i.test(cleaned)
      || /failed to fetch|network error|cors/i.test(cleaned)
    ))
  if (unreachable) {
    return `La función ${name} no respondió en ${target.region} del proyecto ${target.projectId}. La llamada usa ${url}. El código es ${code}: esa dirección no tiene una función callable publicada, así que el navegador no puede leer la respuesta. No se creó ningún administrador.`
  }
  if (cleaned && !OPAQUE.test(cleaned)) return `${cleaned} Código: ${code}.`
  return `La función ${name} falló. Código: ${code}. No se creó ningún administrador.`
}
