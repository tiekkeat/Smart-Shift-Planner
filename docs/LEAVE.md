# Compensation leave

Compensation leave is earned from the **saved shift template**, not the duty name, weekday, or holiday date. An engineer’s balance is an auditable history of credits and debits. One stored unit equals half a day; the interface displays days. Unused days never expire.

## Initial admin setup

1. In **App settings → Compensation leave settings**, add a rate for each qualifying template. For example, Weekend duty = 1 day and Public holiday duty = 2 days. Add a Public holiday template in Shift time templates if needed. Templates without a rate earn zero. Rates must be effective on or before the duties being credited.
2. Select **Set up automatic earning**, choose a historical earning start date, and enter days already taken by each engineer since that date. Existing manual credits remain part of the balance; avoid entering the same entitlement twice.
3. Preview every completed duty and engineer total. Unclassified duties earn zero; classify them through Duty hours first if appropriate. Review all values and confirm activation.

Automatic earning remains off until activation. Activation is transactional and can run only once. Thereafter, new rate versions must start on a future date; each duty uses the rate effective on its local start date. Existing rule versions cannot be overwritten after activation. Renaming/archiving a template preserves its rule history.

## Earning and balances

An uncancelled duty earns its configured credit after its end time. Repeated groups earn per actual occurrence. Upcoming/in-progress duties show as Projected only. The worker catches up after downtime, and opening the balance module also reconciles completed duties. Unique source records and the roster transaction lock prevent duplicate credits.

Cancelling, moving, reassigning, restoring, or reclassifying a credited duty reverses its previous credit and applies its current entitlement. Every reversal remains in history. If already-spent credit is reversed, Available may become negative; new spending is blocked until corrected. This assumes a completed assignment was worked; no attendance integration is included.

**Compensation leave** shows Balance, Reserved, Available, Projected, and transaction history. Available = Balance − Reserved. Managers/admins can add credit with a reason. Only admins can enter negative corrections. Engineers see their own balances and requests; viewers cannot access these modules. Team membership does not restrict staff access.

## Applying and approving

Engineers open **Leave applications → Apply for leave**. Select a range of up to 63 days, choose full or half days per weekday, enter a reason, and preview the deduction. Dates must start today or later. Saturday/Sunday and the union of subscribed public holidays are excluded. Last good holiday-feed caches remain usable after refresh failures; an unreadable feed blocks calculation until repaired.

All dates use the roster timezone. Morning is midnight–12:00, afternoon is 12:00–midnight, and a full day is midnight–midnight with an exclusive end.

Submission reserves available days. Managers/admins approve or reject pending requests. Approval converts the reservation into a deduction. Rejection or engineer withdrawal releases it. A holiday change affecting the itemized dates blocks approval: reject and resubmit with a fresh preview. Pending requests with a start date in the past can be rejected or withdrawn but cannot be approved.

Engineers can cancel an entire approved request before its first charged interval starts, with a reason, restoring the deduction. Started leave requires an admin cancellation/correction with a reason. Requests cannot be edited or partially cancelled; withdraw and resubmit to change a pending request.

Applications cannot overlap existing pending/approved leave or assigned duty. Duty must be reassigned before submitting/approving leave. Approved leave also blocks ordinary/group duty assignment, swaps, and approved-change restorations. Pending leave does not block scheduling; approval rechecks conflicts and balance.

## Session API

All routes use `/api/app/leave`, existing session authentication, role checks, and exact-origin validation on writes. Amounts are **integer half-day units**. Engineers can only read their own data. External `/api/v1` routes are unchanged.

| Route | Purpose |
| --- | --- |
| `GET /balances` | Enabled flag and engineer balance/reserved/available/projected units |
| `GET /history/:engineerId` | Up to 500 latest ledger entries, including actor and source key |
| `POST /adjustments` | Staff credit; admin debit. Body: `{engineerId, units, reason, operationId}` |
| `GET /settings` | Admin configuration, active templates, rate history |
| `POST /rules` | Admin rate: `{templateId, effectiveOn: "YYYY-MM-DD", units}` |
| `POST /setup-preview` | Admin preview: `{from: "YYYY-MM-DD", openingDebits: [{engineerId, units}]}` |
| `POST /activate` | Same setup input plus the preview `fingerprint` |
| `POST /preview` | Engineer application preview: `{from, to, halves: [{date, part: "am" or "pm"}]}` |
| `POST /requests` | Preview input plus `{reason, fingerprint, operationId}` |
| `GET /requests` | Up to 500 latest applications, scoped by role |
| `POST /requests/:id/action` | `{version, action: "approve", "reject", "withdraw", or "cancel", reason}` |

Preview fingerprints reject stale setup or holiday calculations. Staff adjustments and submissions use client-generated UUID operation IDs to handle retries. Application transitions use optimistic versions. Repeated matching transitions do not deduct/refund twice.

## Validation and deployment

Run `npm test` and `npm run build`. The default leave suite uses disposable SQLite; to verify MySQL row locking, run `LEAVE_MYSQL_TEST=1 node --test test/leave.test.js` with DB variables pointing to a **disposable empty database**. This creates fixture users/duties and must never run against production.

Deploy API, worker, and web together after a database/configuration backup. The existing repeatable migrator creates the new leave tables on existing installations; it does not credit duties or activate earning. Verify the migration exits 0, `/api/health`, the new pages, and disabled setup state before administering rates/initialization.
