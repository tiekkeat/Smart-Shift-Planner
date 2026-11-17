const timestamp = { type: 'string', format: 'date-time' }
const uuid = { type: 'string', format: 'uuid' }
const contact = {
  type: 'object', required: ['id', 'name'], properties: {
    id: uuid, name: { type: 'string' },
    phone: { type: ['string', 'null'] }, email: { type: 'string', format: 'email' },
    dingtalkId: { type: ['string', 'null'] },
  },
}
const shift = {
  type: 'object', required: ['id', 'start', 'end'], properties: { id: uuid, start: timestamp, end: timestamp, groupId: { ...uuid, description: 'Optional repeated-duty group identifier. Start/end always describe actual occurrence coverage.' } },
}
const jsonResponse = (description, schema) => ({ description, content: { 'application/json': { schema } } })
const param = (name, required = true, schema = timestamp, location = 'query') => ({ name, required, schema, in: location })
const errors = {
  400: { description: 'Invalid input' }, 401: { description: 'Missing or invalid credential' },
  403: { description: 'Insufficient scope' }, 429: { description: 'Rate limit exceeded' },
}
export const openapi = {
  openapi: '3.1.0',
  info: { title: 'Smart Timetable integration API', version: '1.0.0', description: 'One shared primary duty roster. Intervals include their start and exclude their end.' },
  security: [{ serviceToken: [] }],
  components: { securitySchemes: { serviceToken: { type: 'http', scheme: 'bearer', description: 'A scoped Smart Timetable service token' } } },
  paths: {
    '/api/v1/on-call': {
      get: {
        operationId: 'getOnCall', summary: 'Look up primary duty coverage',
        description: 'Requires on_call:read. Contact fields appear only when separately scoped. A coverage gap returns HTTP 200 with status uncovered. Repeated duty groups cover only their individual occurrences, never the daytime gaps.',
        parameters: [param('at', false)],
        responses: { ...errors, 200: jsonResponse('Coverage result', {
          type: 'object', required: ['status', 'at', 'timezone', 'shift', 'engineer'],
          properties: {
            status: { enum: ['covered', 'uncovered'] }, at: timestamp, timezone: { type: 'string' },
            shift: { anyOf: [shift, { type: 'null' }] }, engineer: { anyOf: [contact, { type: 'null' }] },
          },
        }) },
      },
    },
    '/api/v1/shifts': {
      get: {
        operationId: 'listShifts', summary: 'List published assignments intersecting a range',
        description: 'Requires shifts:read. The maximum query span is 63 days.',
        parameters: [param('from'), param('to')],
        responses: { ...errors, 200: jsonResponse('Assignments', {
          type: 'object', required: ['shifts'], properties: { shifts: {
            type: 'array', items: {
              type: 'object', required: [...shift.required, 'engineerId', 'engineerName', 'version'],
              properties: { ...shift.properties, engineerId: uuid, engineerName: { type: 'string' }, version: { type: 'integer' } },
            },
          } },
        }) },
      },
    },
    '/api/v1/engineers/{id}': {
      get: {
        operationId: 'getEngineer', summary: 'Get an active engineer profile',
        description: 'Requires engineers:read. Contact fields appear only when separately scoped.',
        parameters: [param('id', true, uuid, 'path')],
        responses: { ...errors, 200: jsonResponse('Profile', contact), 404: { description: 'Active engineer not found' } },
      },
    },
  },
}
