import { z } from 'zod'
import { httpError } from './domain.js'

export const id = z.uuid()
export const timestamp = z.iso.datetime({ offset: true })
export const range = z.object({ from: timestamp, to: timestamp })
export const version = z.number().int().positive()
export const email = z.email().max(254).transform((value) => value.toLowerCase())
export const password = z.string().min(12).max(128)
export const note = z.string().trim().max(400).default('')
export const color = z.enum(['blue', 'purple', 'green', 'orange', 'pink', 'cyan']).nullable().optional()
export const assignment = z.object({ engineerId: id, start: timestamp, end: timestamp, note, color, allowOverlap: z.boolean().default(false) })
export const proposal = assignment.omit({ note: true }).extend({
  shiftId: id, version, swapShiftId: id.optional(), swapVersion: version.optional(), reason: z.string().trim().min(1).max(500),
})
export const roles = ['admin', 'manager', 'engineer', 'viewer']
export const person = z.object({
  name: z.string().trim().min(1).max(120), email, color, teamIds:z.array(id).optional(),
  phone: z.union([z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, such as +60123456789.'), z.literal('')]),
  dingtalkId: z.string().trim().max(120).default(''),
  role: z.enum(roles).default('engineer'),
  active: z.boolean().default(true),
  password: z.union([password, z.literal('')]).default(''),
})

export function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    const { path, message } = result.error.issues[0]
    throw httpError(400, path.length ? path.join('.') + ': ' + message : message)
  }
  return result.data
}
