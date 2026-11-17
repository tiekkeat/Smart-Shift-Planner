import test from 'node:test'
import assert from 'node:assert/strict'
import { brandingSchema, defaultBranding, saveBranding } from '../server/branding.js'
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGv8AAAAASUVORK5CYII='
test('branding accepts bounded PNGs and rejects other formats and invalid names', () => {
  assert.equal(brandingSchema.parse({ ...defaultBranding, logo: png, favicon: png }).logo, png)
  for (const logo of ['data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,AAAA', 'https://example.com/logo.png']) {
    assert.equal(brandingSchema.safeParse({ ...defaultBranding, logo }).success, false)
  }
  const huge = Buffer.from(png.split(',')[1], 'base64'); huge.writeUInt32BE(5000, 16)
  assert.equal(brandingSchema.safeParse({ ...defaultBranding, logo: 'data:image/png;base64,' + huge.toString('base64') }).success, false)
  assert.equal(brandingSchema.safeParse({ ...defaultBranding, appName: ' ' }).success, false)
  for (const holidayPlacement of ['top', 'bottom', 'outside']) assert.equal(brandingSchema.parse({ ...defaultBranding, holidayPlacement }).holidayPlacement, holidayPlacement)
  assert.equal(brandingSchema.safeParse({ ...defaultBranding, holidayPlacement: 'mixed' }).success, false)
})
test('branding writes require admin access', async () => {
  await assert.rejects(saveBranding({ role: 'engineer' }, defaultBranding), { statusCode: 403 })
  await assert.rejects(saveBranding({ role: 'manager' }, defaultBranding), { statusCode: 403 })
})
