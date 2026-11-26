# Integration API

The external `/api/v1` API is read-only and uses scoped Bearer tokens. Browser `/api/app` routes use a signed-in session and exact-origin checks; do not use browser session cookies as integration credentials.

## Authentication

Create a token in **Integrations → API tokens**, select its read/contact scopes, and keep the credential in your automation's secret store. The full token is shown when created. Revocation takes effect on subsequent calls; revoke a token before permanently deleting it. Use HTTPS outside a trusted LAN.

All requests below are `GET` requests with no JSON body. `Authorization` is a header, not a payload field. Replace `roster.example.com` with the actual server origin.

For shell examples, read the token without echoing it or putting it in shell history:

```bash
read -r -s -p 'API token: ' TIMETABLE_API_TOKEN
printf '\n'
export TIMETABLE_API_TOKEN
```

Avoid shell tracing (`set -x`) and sharing verbose HTTP output while handling credentials. Clear it with `unset TIMETABLE_API_TOKEN` when finished.

## On-duty engineer and phone

Required scopes: **Current duty lookup** (`on_call:read`) and **Phone numbers** (`contact:phone`).

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $TIMETABLE_API_TOKEN" \
  --header 'Accept: application/json' \
  'https://roster.example.com/api/v1/on-call'
```

Representative covered response (example data):

```json
{
  "status": "covered",
  "at": "2026-11-30T12:00:00.000Z",
  "timezone": "Asia/Kuala_Lumpur",
  "shift": {
    "id": "11111111-1111-4111-8111-111111111111",
    "start": "2026-11-30T10:30:00.000Z",
    "end": "2026-12-01T01:00:00.000Z",
    "groupId": "22222222-2222-4222-8222-222222222222"
  },
  "engineer": {
    "id": "33333333-3333-4333-8333-333333333333",
    "name": "Example Engineer",
    "phone": "+60123456789"
  }
}
```

Use `engineer.phone` only when `status` is `covered` and the field is present and populated. Without the phone scope, it is omitted. An uncovered interval returns HTTP **200** with `status: "uncovered"`, `shift: null`, and `engineer: null`; handle that separately from HTTP errors.

To query a specific instant, encode timezone offsets using `--data-urlencode`:

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $TIMETABLE_API_TOKEN" \
  --data-urlencode 'at=2026-11-30T18:30:00+08:00' \
  'https://roster.example.com/api/v1/on-call'
```

Duty intervals include their start and exclude their end. Repeated overnight duties do not cover daytime gaps. When confirmed assignments overlap, the latest-starting active shift wins, with shift ID as a deterministic tie-breaker. Calendar display order does not affect this result.

## Schedule and engineer profile

| Route | Required scope | Parameters |
| --- | --- | --- |
| `GET /api/v1/on-call` | `on_call:read` | Optional `at` timestamp. |
| `GET /api/v1/shifts` | `shifts:read` | Required `from` and `to`; maximum span 63 days. |
| `GET /api/v1/engineers/{id}` | `engineers:read` | Active engineer UUID. |
| `GET /api/v1/openapi.json` | None | Machine-readable API contract. |

Phone, email, and DingTalk fields require `contact:phone`, `contact:email`, and `contact:dingtalk` respectively, in addition to the endpoint's read scope.

```bash
curl --fail-with-body --get \
  --header "Authorization: Bearer $TIMETABLE_API_TOKEN" \
  --data-urlencode 'from=2026-11-30T00:00:00+08:00' \
  --data-urlencode 'to=2026-12-07T00:00:00+08:00' \
  'https://roster.example.com/api/v1/shifts'
```

The response is an object with a `shifts` array. Child occurrences have their own IDs and may include `groupId`. Query results describe actual duty intervals, not a continuous parent-group envelope. UI filters do not limit the API roster.

For n8n, configure an HTTP Request node with method `GET`, the `/api/v1/on-call` URL, and a Header Auth credential containing `Authorization: Bearer <token>`. Route covered results with a phone to the downstream calling service. Handle uncovered results, missing contacts, and request failures explicitly.

## Errors

Responses use JSON such as `{"error":"message"}`.

| HTTP status | Meaning |
| --- | --- |
| `400` | Invalid timestamps, range, or other input. |
| `401` | Missing, invalid, expired, or revoked token. |
| `403` | Required read scope missing. Contact fields are omitted when their scopes are absent. |
| `404` | Requested active engineer not found. |
| `429` | Rate limit reached; wait before retrying. |
| `500` | Server failure; check deployment health. |

## Signed webhooks

Set `WEBHOOK_ALLOWED_ORIGINS`, recreate API/worker services, and register a destination under **Integrations → Webhooks**. Webhooks use HTTPS and a separate signing secret; that secret is not the API token or `APP_SECRET`.

Events are `duty.assigned`, `duty.updated`, and `duty.cancelled`, with `shift` and `previousShift` data. Approvals, swaps, and reverts generate updates for affected shifts. These are asynchronous per-shift deliveries; consumers should query the current API roster rather than assuming delivery ordering across two swapped shifts.

Verify the exact raw request bytes before parsing JSON:

1. Read `X-Timetable-Timestamp` and reject timestamps outside your accepted freshness window.
2. Calculate HMAC-SHA256 with the webhook signing secret over `<timestamp>.<raw body>`.
3. Compare `sha256=<hex digest>` to `X-Timetable-Signature` in constant time.
4. Deduplicate `X-Timetable-Event` IDs and return a 2xx response after safely accepting the event.

Failed deliveries retry up to six total attempts. Check **Delivery history** for outcomes. Preserve the deployment's original `APP_SECRET` with its database, since stored webhook signing secrets are encrypted with it.

## Internal engineer batch requests

The browser's session-authenticated API supports `POST /api/app/changes/batch` for engineers. This is separate from the read-only Bearer-token integration API. The normal exact-origin check and session cookie are required.

Send `{ "proposals": [...] }` containing 1–63 proposal objects. Each uses `shiftId`, `version`, `engineerId`, UTC/offset `start` and `end`, a non-empty `reason` (up to 500 characters), and optional `allowOverlap`. A swap additionally supplies `swapShiftId` and `swapVersion`, with the target's exact dates and the requester's engineer ID. The browser repeats the shared reason on each proposal.

Success returns HTTP 201 with `{ "requests": [{ "id": "…", "shiftId": "…" }] }` in input order. Each ID is reviewed independently through the existing change-request review endpoints. A failed batch creates no requests, notifications, or audit entries; actionable per-duty errors include `{ "error": "…", "shiftId": "…" }`. Duplicate source duties or reused swap targets are rejected. Original and swap versions, ownership, active engineers, pending requests, dates, and overlaps are checked inside one roster transaction. Approval still revalidates the current roster. The existing single-proposal `POST /api/app/changes` remains supported.


## Internal shift types and reporting

Session-authenticated shift writes accept optional `templateId` (UUID or `null`). Omitting it preserves an existing duty's type; `null` explicitly chooses Unclassified. Selecting a template fills times in the UI, but changing times afterward does not change the saved type. Group rules also retain `templateId` and propagate it to actual occurrences. Shift/group occurrence responses include `templateId`, `templateName`, and `templateArchived`. Deleted templates are archived, retain their IDs/names, and disappear from the active `/api/app/shift-templates` list. Renames update report headings.

`GET /api/app/report?from=...&to=...` retains its array response and adds `types` to each engineer row: `{templateId, name, archived, shiftCount, durationMs}`. `templateId` is null for Unclassified. Optional `templateId=<UUID>` or `templateId=unclassified` filters the response. Engineers only receive their own rows; admins/managers can read all. `shiftCount` now counts starts in the half-open reporting interval. `durationMs` still clips actual occurrence coverage to that interval; carryovers may show zero starts and positive hours. Cancelled duties are excluded.

Admin-only `GET /api/app/report/classification-preview?from=...&to=...` accepts a range of up to 63 days. It returns `{from, to, fingerprint, units}`. Units have a `key`, status (`matched`, `ambiguous`, `unmatched`, or `pending`), matched templates, and all affected duty snapshots. Repeated-group units include every normal occurrence, even outside the selected range; exceptions are separate. A pending request on any group occurrence blocks its classification.

Admin-only `POST /api/app/report/classification` accepts `{from, to, fingerprint, keys}` with 1–1000 distinct matched unit keys from the preview. It recomputes matches and checks the fingerprint under the roster lock, updates selected units atomically, and returns `{classified: <number of duties>}`. Changes to duties, group rules, or active template definitions make the preview stale (409). Classification only updates types and optimistic versions, records audit entries, and emits no scheduling notifications/webhooks. It never changes times, engineers, or cancellation state. All browser mutation routes retain the session and exact-origin checks. The external read-only `/api/v1` response shapes remain unchanged.
