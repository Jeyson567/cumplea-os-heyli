/**
 * Rutas de la carpeta assets/img.
 * Las fotografías que se muestran están en media/gallery.json.
 */
export function gallerySrc(file) {
  const name = String(file || '').trim()
  if (!name || name.includes('..') || name.includes('\\') || name.includes('/') || name.includes('\0')) return ''
  return `assets/img/${encodeURIComponent(name)}`
}

export function videoSrc(file) {
  const name = String(file || '').trim()
  if (!/^[\w .()-]+\.(mp4|webm)$/i.test(name)) return ''
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return ''
  return `assets/img/${encodeURIComponent(name)}`
}
