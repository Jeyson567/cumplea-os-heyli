/**
 * Galería local. Los archivos de Heyli están en la raíz del proyecto,
 * con el nombre original. No se renombran ni se sustituyen.
 * Un nombre suelto, sin carpeta, se busca en assets/img.
 */
export function gallerySrc(file) {
  const name = String(file || '').trim()
  if (!name || name.includes('..') || name.includes('\\') || name.includes('\0')) return ''
  const parts = name.split('/').filter(Boolean).map((part) => encodeURIComponent(part))
  if (parts.length === 1 && !name.startsWith('WhatsApp ')) return `assets/img/${parts[0]}`
  return parts.join('/')
}

export const galleryVerses = [
  'Una noche para guardar despacio.',
  'Quince años, y la luz tranquila de quien empieza a soñar en voz alta.',
  'Entre flores, un vestido y el campo que parece detenerse.',
  'Hay imágenes que se quedan. Y hay miradas que se vuelven recuerdo.'
]

export const galleryItems = [
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.57 PM.jpeg',
    alt: 'Heyli Orrego con globos de quince años, vestido rosa y botas, junto a una cerca blanca.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.56.51 PM.jpeg',
    alt: 'Heyli Orrego con corona y vestido rosa, recostada en una cerca blanca entre los árboles.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.56.54 PM.jpeg',
    alt: 'Heyli Orrego a caballo, con sombrero claro y el caballo adornado de flores.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.58 PM (5).jpeg',
    alt: 'Heyli Orrego de espaldas, cabalgando entre los árboles.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.56.54 PM (1).jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.56.55 PM.jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.56.56 PM.jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.56.56 PM (1).jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.57 PM (1).jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.57 PM (2).jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.58 PM.jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.58 PM (1).jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.58 PM (2).jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.58 PM (3).jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  },
  {
    file: 'WhatsApp Image 2026-11-12 at 11.59.58 PM (4).jpeg',
    alt: 'Fotografía de Heyli Orrego en su sesión de quince años.',
    temporary: false
  }
]
