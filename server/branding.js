import { z } from 'zod'
import { query } from './db.js'
import { parse } from './validation.js'
import { httpError } from './domain.js'

export const defaultBranding = { appName: 'Smart Timetable', headerName: 'Support operations', subtitle: 'Engineer duty roster', logo: null, favicon: null, holidayPlacement: 'top' }
const png = z.string().max(350000).nullable().refine((value) => {
  if (value === null) return true
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  const bytes = Buffer.from(value.split(',')[1], 'base64')
  return bytes.length <= 256 * 1024 && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 2048 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 2048
}, 'Upload a PNG up to 256 KB and 2048 × 2048 pixels.')
export const brandingSchema = z.object({ appName: z.string().trim().min(1).max(60), headerName: z.string().trim().min(1).max(80), subtitle: z.string().trim().max(100), logo: png, favicon: png, holidayPlacement: z.enum(['top', 'bottom', 'outside']).default('top') })
export async function readBranding() {
  const [row] = await query('SELECT payload FROM app_settings WHERE id = 1')
  return row ? { ...defaultBranding, ...JSON.parse(row.payload) } : defaultBranding
}
export async function saveBranding(actor, input) {
  if (actor.role !== 'admin') throw httpError(403, 'Only admins can change branding.')
  const settings = parse(brandingSchema, input)
  await query('INSERT INTO app_settings (id, payload) VALUES (1, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload)', [JSON.stringify(settings)])
  return settings
}
