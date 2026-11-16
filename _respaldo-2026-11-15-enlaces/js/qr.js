import { qrcode } from './vendor/qrcode.mjs'

export function makeQrSvg(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const markup = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || svg.querySelector('script, foreignObject')) {
    throw new Error('No se pudo preparar el código QR.')
  }
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Código QR de la invitación')
  return svg
}
