import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
export const hash = (value) => createHash('sha256').update(value).digest('hex')
export const secret = (prefix) => prefix + randomBytes(32).toString('base64url')
const cost = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }

export async function passwordHash(password) {
  const salt = randomBytes(16)
  const digest = await derive(password, salt, 64, cost)
  return salt.toString('hex') + ':' + digest.toString('hex')
}

export async function passwordMatches(password, stored) {
  const [salt, digest] = (stored || '0'.repeat(32) + ':' + '0'.repeat(128)).split(':')
  const expected = Buffer.from(digest, 'hex')
  const actual = await derive(password, Buffer.from(salt, 'hex'), expected.length, cost)
  return timingSafeEqual(actual, expected) && Boolean(stored)
}

function encryptionKey() {
  const key = process.env.APP_SECRET || ''
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('APP_SECRET must contain 64 hexadecimal characters.')
  return Buffer.from(key, 'hex')
}

export function encrypt(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

export function decrypt(value) {
  const data = Buffer.from(value, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
}
