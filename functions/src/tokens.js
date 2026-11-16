import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { ClientError } from './errors.js'

export function generateToken() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function encryptionKey() {
  const raw = (process.env.TOKEN_ENC_KEY || '').trim()
  if (!raw) return null
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new ClientError(
      'failed-precondition',
      'La clave de cifrado del servidor no es válida. Revisa TOKEN_ENC_KEY.',
      'key'
    )
  }
  return key
}

export function encryptToken(token, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    stored: true,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    tokenHash: hashToken(token)
  }
}

export function decryptToken(payload, key) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
  const plain = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ])
  return plain.toString('utf8')
}
