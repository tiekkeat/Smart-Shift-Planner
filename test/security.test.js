import assert from 'node:assert/strict'
import test from 'node:test'
import { decrypt, encrypt, hash, passwordHash, passwordMatches, secret } from '../server/security.js'
import { interval } from '../server/domain.js'
import { openapi } from '../server/openapi.js'

test('overnight assignment retains its full elapsed duration', () => {
  const shift = interval('2026-11-29T18:00:00+08:00', '2026-11-30T01:00:00+08:00')
  assert.equal(shift.endsAt - shift.startsAt, 7 * 3_600_000)
  assert.throws(() => interval('2026-11-29T18:00:00+08:00', '2026-11-29T01:00:00+08:00'), { statusCode: 400 })
})

test('password verification and per-user salt', async () => {
  const password = 'A sufficiently long test password'
  const stored = await passwordHash(password)
  assert.notEqual(await passwordHash(password), stored)
  assert.equal(await passwordMatches(password, stored), true)
  assert.equal(await passwordMatches('wrong password', stored), false)
  assert.equal(await passwordMatches(password), false)
})

test('webhook credentials encrypt and service tokens have the expected format', () => {
  process.env.APP_SECRET = 'a1'.repeat(32)
  const signingSecret = secret('wh_')
  const ciphertext = encrypt(signingSecret)
  assert.notEqual(ciphertext, signingSecret)
  assert.equal(decrypt(ciphertext), signingSecret)
  const damaged = Buffer.from(ciphertext, 'base64url')
  damaged[30] ^= 1
  assert.throws(() => decrypt(damaged.toString('base64url')))
  const token = secret('st_')
  assert.match(token, /^st_[A-Za-z0-9_-]{43}$/)
  assert.equal(hash(token).length, 64)
})

test('integration endpoints are all read-only and documented', () => {
  assert.deepEqual(Object.keys(openapi.paths), ['/api/v1/on-call', '/api/v1/shifts', '/api/v1/engineers/{id}'])
  for (const endpoint of Object.values(openapi.paths)) assert.deepEqual(Object.keys(endpoint), ['get'])
})
