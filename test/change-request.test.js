import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildProposal, requestDraft } from '../src/change-request-model.js'
import { batchProposal } from '../server/validation.js'

const shift = { id: randomUUID(), engineerId: randomUUID(), version: 3, start: '2045-11-24T10:30:00Z', end: '2045-11-25T01:00:00Z' }
const replacementId = randomUUID()
const options = { kind: 'replace', replacementId, individual: false, timezone: 'Asia/Kuala_Lumpur', userId: shift.engineerId, reason: 'Away' }

test('bulk replacement retains each duty interval and supports individual overrides', () => {
  const draft = requestDraft(shift, options.timezone)
  assert.equal(draft.start, '2045-11-24T18:30')
  assert.equal(draft.end, '2045-11-25T09:00')
  const proposal = buildProposal(shift, draft, options)
  assert.equal(proposal.start, shift.start)
  assert.equal(proposal.end, shift.end)
  assert.equal(proposal.engineerId, replacementId)
  const override = randomUUID()
  assert.equal(buildProposal(shift, { ...draft, engineerId: override }, { ...options, individual: true }).engineerId, override)
  assert.equal(buildProposal(shift, { ...draft, engineerId: override }, options).engineerId, replacementId)
})

test('date changes keep the requesting engineer and convert local overnight times', () => {
  const draft = { ...requestDraft(shift, options.timezone), start: '2045-11-26T18:30', end: '2045-11-27T09:00' }
  const proposal = buildProposal(shift, draft, { ...options, kind: 'dates' })
  assert.equal(proposal.engineerId, shift.engineerId)
  assert.equal(Date.parse(proposal.start), Date.parse('2045-11-26T10:30Z'))
  assert.equal(Date.parse(proposal.end) - Date.parse(proposal.start), 14.5 * 3600000)
  assert.equal(buildProposal(shift, draft, options).start, shift.start)
  assert.equal(buildProposal(shift, { ...draft, editTimes: true }, options).start, proposal.start)
})

test('swap proposals use exact target times and both optimistic versions', () => {
  const target = { id: randomUUID(), version: 8, start: '2045-12-01T10:30Z', end: '2045-12-02T01:00Z' }
  const draft = { ...requestDraft(shift, options.timezone), swap: target }
  const proposal = buildProposal(shift, draft, { ...options, kind: 'swap' })
  assert.equal(proposal.start, target.start)
  assert.equal(proposal.end, target.end)
  assert.equal(proposal.swapShiftId, target.id)
  assert.equal(proposal.swapVersion, 8)
  assert.equal(proposal.version, 3)
  assert.equal(proposal.engineerId, shift.engineerId)
  assert.throws(() => buildProposal(shift, { ...draft, swap: null }, { ...options, kind: 'swap' }), /Choose a duty/)
})

test('incomplete, unchanged, reversed and ambiguous dates cannot reach review', () => {
  const draft = requestDraft(shift, options.timezone)
  assert.throws(() => buildProposal(shift, draft, { ...options, replacementId: '' }), /replacement/)
  assert.throws(() => buildProposal(shift, draft, { ...options, kind: 'dates' }), /Choose new dates/)
  assert.throws(() => buildProposal(shift, { ...draft, end: draft.start }, { ...options, kind: 'dates' }), /End must follow/)
  assert.throws(() => buildProposal(shift, { ...draft, start: '' }, { ...options, kind: 'dates' }), /unambiguous/)
  assert.throws(() => buildProposal(shift, { ...draft, end: '2045-12-10T09:00' }, { ...options, kind: 'dates' }), /7 days/)
  assert.throws(() => buildProposal(shift, { ...draft, start: '2045-11-05T01:30', end: '2045-11-05T04:30' }, { ...options, kind: 'dates', timezone: 'America/New_York' }), /unambiguous/)
})

test('batch payloads are bounded and retain original single-proposal validation', () => {
  const proposal = buildProposal(shift, requestDraft(shift, options.timezone), options)
  assert.equal(batchProposal.safeParse({ proposals: [proposal] }).success, true)
  assert.equal(batchProposal.safeParse({ proposals: Array(63).fill(proposal) }).success, true)
  for (const proposals of [[], Array(64).fill(proposal), [{ ...proposal, version: 0 }], [{ ...proposal, reason: '' }]]) {
    assert.equal(batchProposal.safeParse({ proposals }).success, false)
  }
})


test('time template choices persist requested type while replacements retain the original type', () => {
  const typed = { ...shift, templateId: randomUUID() }
  const draft = { ...requestDraft(typed, options.timezone), templateId: randomUUID() }
  assert.equal(buildProposal(typed, draft, options).templateId, typed.templateId)
  assert.equal(buildProposal(typed, draft, { ...options, kind: 'dates' }).templateId, draft.templateId)
  const swap = { id: randomUUID(), version: 1, start: '2045-12-01T10:30Z', end: '2045-12-02T01:00Z', templateId: randomUUID() }
  assert.equal(buildProposal(typed, { ...draft, swap }, { ...options, kind: 'swap' }).templateId, swap.templateId)
})
