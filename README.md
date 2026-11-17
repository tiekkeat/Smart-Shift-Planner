# Smart Shift Planner

Smart Shift Planner runs one shared support duty roster with engineer duty assignments and confirmed overlapping coverage. It includes a month, week, and day calendar, engineer contact and account management, approval for shift changes, an in-app notification feed, scheduled duty-hour reporting, and a scoped integration API.

The deployed interface may display **Smart Timetable** or an administrator's custom branding. The repository name does not change existing installation names, database volumes, or branding.

- [Deployment and upgrades](docs/DEPLOYMENT.md): local/LAN/HTTPS setup, environment settings, backups, restore, and troubleshooting.
- [Integration API](docs/API.md): Bearer authentication, on-duty phone lookup, schedule queries, and webhook verification.
- [Project instructions](AGENTS.md): source map, validation requirements, and roster invariants for contributors and Codex.

## Features

- Month, Week, and Day duty calendars, repeated overnight duties, engineer/team filters, and **My shifts**.
- Approval-based change requests, atomic two-engineer swaps, and audited restoration of approved changes.
- Admin, Manager, Engineer, and Viewer accounts, team memberships, contact details, and engineer colors.
- Custom branding, logo/favicon, shift time templates, and subscribed public holiday calendars.
- Duty-hour reports, notifications, read-only scoped API tokens, and signed webhook deliveries.

## Run with Docker Compose

1. Install Docker with Compose and copy `.env.example` to `.env`. Set distinct `DB_ROOT_PASSWORD` and `DB_PASSWORD` values and choose `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the initial admin. Use at least 12 characters for the password.
2. Generate `APP_SECRET` using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` or `openssl rand -hex 32`. Keep this value with your deployment secrets. The worker uses it to decrypt webhook signing secrets.
3. Run `docker compose up -d --build`. Check the service state with `docker compose ps -a`. The migration service initializes the database and exits successfully before the API and worker start.
4. Open [http://localhost:8080](http://localhost:8080) and sign in with the initial admin credentials. Add an engineer from **Team directory**, then select **New shift** in the calendar.

For an HTTPS deployment, route the web service through your HTTPS reverse proxy, set `APP_ORIGIN` to the exact browser origin (for example `https://roster.example.com`), and set `COOKIE_SECURE=true`. The database and API have no published host ports. Retain and back up the MySQL volume and retain the matching `APP_SECRET`. For account provisioning, provide accounts with initial passwords through your team’s existing secure channel. An admin or manager can reset an engineer password from Team directory.

## Team groups and filters

Admins use **Team directory → Manage teams** to create, rename, color-label, or delete organizational teams such as Cloud and Security. Users can belong to multiple teams; choose their **Teams** when creating or editing an account. Managers can assign existing teams when editing engineer accounts, but only admins manage team definitions. Membership changes do not grant additional permissions or change on-call duty priority.

The directory shows collapsible sections for each team and **Unassigned**. A person in several teams appears in each corresponding section; these are references to the same account. Search includes team names and expands matching sections temporarily. Collapse preferences are saved per signed-in user in this browser.

On the duty calendar, expand **Teams** to select one or several color-labeled teams, **Unassigned**, or **All teams**. Multiple teams match any selected team; the engineer selector narrows those results further. Engineers can toggle **My shifts** beside the engineer selector to show their own assigned duties in Month, Week, and Day. Enabling it clears team filters; toggle it off or choose All engineers to return to the full roster.

The calendar, entry counts, engineer legend, **On call now**, and **Next handoff** follow the filters. Filtered cards are labeled. Public holidays stay visible, and the external integration API remains global and unchanged.

Team filtering uses the engineer's current memberships, including for historical duties and repeated-group exceptions. Month summaries reflect matching nights; opening a summary still displays the complete group. Week and Day show matching actual occurrences. Account deletion retains historical membership links; deleting a team removes its membership/filter association without deleting users or duties. Team colors are labels only and do not override engineer or shift colors. Existing users begin Unassigned; no example teams are created automatically.

## Accounts, deletion, and Viewer access

Admins can create a **Viewer (read-only timetable)** account from **Team directory → Add team member → Role**. Viewers can sign in and browse Month, Week, Day, public holidays, and duty-group/occurrence details. They cannot create or edit shifts/groups, reorder entries, submit change requests, or access account management and app settings. A viewer does not need an engineer phone number or engineer color.

Admins can use the trash action beside a team member to **Delete account**, with confirmation. An admin cannot delete their own account. Reassign or cancel active/upcoming duties first. Deletion removes the account from Team directory, disables login, invalidates sessions, clears contact details, and releases the email address for a new account. Historical roster records retain the user's name and audit history; deletion does not remove these records. Managers retain their existing engineer-account management permissions but cannot delete accounts or assign the Viewer role.

## Branding and engineer colors

Admins can open **App settings** to change the app/browser title, header name, subtitle, PNG logo, and PNG favicon. PNG uploads support up to 256 KB and 2048 × 2048 pixels each. Branding is stored in MySQL and included in database backups.

In **Team directory → Edit account**, admins can choose an **Engineer color**. Shifts set to **Automatic (engineer color)** inherit this default. A shift's explicitly chosen color takes precedence. Managers and engineers cannot change engineer color defaults.

## Repeated duty groups

Use **New shift → Create repeated duty group** to assign recurring daily duty windows across a finite range of up to 63 start dates. Select the engineer, first/last start dates, weekdays, start/end times, and whether the end is on the next day. A preview lists the actual coverage intervals before saving. Public holidays do not automatically skip selected nights.

For example, choose 16–20 November 2026, Monday–Friday, 18:30–09:00 next day. This creates five real nightly occurrences totaling 72.5 scheduled hours, ending Saturday 21 November at 09:00. The daytime gaps are not duty coverage. Existing ordinary shifts remain continuous unless explicitly converted using **Convert to repeated duty group** in their editor.

Month view presents consecutive unchanged nights as a summary. Missing or cancelled nights break the summary, and individually changed nights appear as separate shift blocks on their actual dates. Week and Day show the actual nightly occurrences in the hourly grid, including overnight continuations, with daytime gaps left empty. Clicking a night opens that occurrence; **View duty group** opens the full group. Open the Month summary to see every occurrence, its engineer, and any cancellation or individual change. Long month-view entries may wrap at week boundaries.

Admins and managers can edit/cancel the group or edit/cancel individual nights. Individual changes become exceptions and are preserved on later group edits. Removing dates containing exceptions requires confirmation. Engineers request changes to their own nights using the existing approval process. Moving a group shifts its dates and exceptions together and opens the group editor for review. Resizing reviews the selected date range without changing nightly clock times.

Duty lookup, reports, and integration schedule responses use actual occurrences. Each occurrence has its own shift ID and an optional `groupId`. Group versions prevent stale bulk edits from overwriting single-night changes. Group display order never changes on-call priority.

## Calendar display order

In Month view, admins and managers can drag a shift vertically within the same date to place it above or below another shift. The display order is saved for the team and follows the shift across dates where it appears. Reordering does not change duty times, on-call lookup priority, or integration events. Dragging across dates still opens the shift editor to review the new times.

In **App settings → Public holiday placement**, choose **Above shifts**, **Below shifts**, or **Separate panel outside calendar**, then **Save settings**. Month view keeps holiday labels together at the chosen edge. In Week and Day views, Above uses a dedicated Holidays row; Below and Outside show a separate panel beneath the calendar. Highlight colors continue to mark holiday dates in every mode.

## Holiday subscriptions and shift templates

Under **App settings → Public holiday calendars**, subscribe to a region preset (Malaysia, Kuala Lumpur, or Selangor) or paste a public HTTPS iCalendar `.ics` URL. Set a highlight color for the subscription. Holidays appear as highlighted dates and named calendar entries; Week and Day views show a Holidays row. Feeds refresh daily in the worker. Use **Refresh** to update immediately or **Unsubscribe** to remove the feed. Failed refreshes retain the previous calendar and show an error in settings. Dates and regional coverage follow the feed provider.

Under **App settings → Shift time templates**, add, edit, or delete reusable times. For example, **Night duty** starts at `18:30`, ends at `01:00`, and uses **Next day**. **Weekend duty** starts at `09:00`, ends at `09:00`, and also uses **Next day**. Choose a template in the shift editor to fill its start/end times on the selected start date, then review and save. Changing or deleting templates does not change saved shifts.

## How scheduling works

- Admins and managers can create, edit, and cancel duty shifts. Use the exact-date form or drag and resize calendar entries. Enter the next day's date for an overnight end time. Choose a shift color or keep the automatic engineer color. Selecting dates includes the full last selected day, with midnight on the following day as the exclusive end. Drag a shift to move it or pull its edge to resize; the shift editor opens with the new dates, and changes are applied only when you save. Overlaps require an explicit confirmation before saving.
- Admins can open an approved request under **Change requests → View → Revert approved change** to restore its original assignment. The preview includes current/cancelled duty and original dates; swaps restore both assignments together. Later edits or cancellation require explicit confirmation, and overlapping duty requires a separate confirmation. Pending follow-up requests must be resolved first. Version checks protect changes made after the preview. Reversion reactivates cancelled occurrences and rejoins the Month summary when they match the current group rule. It records a Reverted status, audit entries, notifications, and integration updates while retaining approval history. Existing approved requests are supported; cancelled whole groups must be reviewed separately.
- Engineers can start a request from **Change requests → Request change**. The app finds their active/upcoming assigned duties, preselects the nearest eligible duty, and lets them choose a different occurrence. **Find duties from** searches 60 days ahead from the selected date. Ended/cancelled duties and their own pending requests are excluded. **Continue to request** opens the shared change/swap form with the original engineer, exact dates, and version filled in. Requests can still be started from the calendar.
- Engineers can optionally **Swap with another engineer's existing shift** in the request form. Set the desired date range, select the exact existing duty, and review both resulting assignments. Approval exchanges the two duty periods together; rejection or withdrawal changes neither. Both shifts must remain current and cannot be part of another pending request. Other overlaps still require confirmation. For repeated groups, both exchanged occurrences become individual exceptions; other nights stay unchanged.
- Engineers can view the published roster and submit a change request for one of their own active or upcoming shifts. Admins approve or reject requests under **Change requests**. A change is applied only if the original version is current and any overlapping assignment is confirmed by the admin.
- The app refreshes the in-app notification feed every 20 seconds. Engineers receive updates for their assignments and decisions. Changes are recorded in the database audit log.
- Reports show scheduled duty hours, clipped to the boundaries of the week or month in the roster timezone. Weeks start Monday. An overnight shift can contribute hours to two periods. Cancelled shifts are excluded.

## Connect n8n to CloudTalk

Create a token under **Integrations → API tokens** with the **Current duty lookup** and **Phone numbers** permissions. Store it in n8n's credential store and use the HTTP Request node to call:

    GET https://roster.example.com/api/v1/on-call
    Authorization: Bearer <your-token>

In the n8n workflow, route `status = covered` and a populated `engineer.phone` to CloudTalk. Route `status = uncovered` to your fallback. Handle HTTP failures in the workflow's error branch. For deterministic tests, add an `at` query parameter with an ISO 8601 timestamp containing its UTC offset. The active interval includes the start and excludes the end. When shifts overlap, the shift with the latest start time takes priority (ties use shift ID order).

| Route | Required read scope |
|---|---|
| `GET /api/v1/on-call?at=…` | `on_call:read` |
| `GET /api/v1/shifts?from=…&to=…` | `shifts:read` |
| `GET /api/v1/engineers/{id}` | `engineers:read` |

Phone, email, and DingTalk ID each require a corresponding contact scope. To rotate a token, issue its replacement, update the caller, then revoke the old token. Revoked tokens can be permanently deleted from the list; their audit history remains. The credential Copy button supports HTTP LAN access through a browser clipboard fallback. If the browser blocks copying, it selects the credential and shows a keyboard-copy instruction. The OpenAPI document is available at `/api/v1/openapi.json`.

### Webhook deliveries

Set `WEBHOOK_ALLOWED_ORIGINS` to the HTTPS origins you control and restart the API and worker with `docker compose up -d`. Register the full webhook URL under **Integrations → Webhooks**. The app signs the exact body bytes using HMAC-SHA256 with the displayed signing secret.

- `X-Timetable-Event` is the event ID. Use it to deduplicate repeat deliveries.
- `X-Timetable-Timestamp` is the signing time in Unix seconds. Verify that it is recent.
- `X-Timetable-Signature` is `sha256=<hex>`, calculated over the timestamp, one period, and the exact raw body. Compare in constant time.
- A 2xx response acknowledges delivery. Failures are retried up to six total attempts. The **Delivery history** tab shows the most recent attempts.

Events include `duty.assigned`, `duty.updated`, and `duty.cancelled`. Each provides `shift` and `previousShift` with assignment identifiers and times. For integrations that act on the current roster, use the lookup API to get its latest state.

## Local development

Use Node.js 24–26, npm, and a running MySQL 8.4 server. Docker builds use Node.js 24. Create a local database and user with the settings in `.env`. Add `DB_HOST`, `DB_PORT`, `DB_NAME`, and `DB_USER` if they differ from the defaults. Set the local `APP_ORIGIN` to `http://localhost:5173` and `COOKIE_SECURE=false`.

Run `npm ci`, then `npm run migrate`. Start `npm run api` and `npm run dev` in separate terminals. Start `npm run worker` to process webhook deliveries. Run `npm test` for the automated checks. Run `npm run build` to compile the frontend.


The database client defaults are `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME=timetable`, and `DB_USER=timetable`. Compose keeps MySQL internal to its network; running the API directly on your host requires a separate reachable development MySQL instance. The Vite development server proxies `/api` to `http://127.0.0.1:3000`. Prefer disposable development data over the production database.

## Validation

```bash
npm ci
npm test
npm run build
```

The Node test suites cover scheduling, repeated duties, approvals, swaps/reverts, permissions, integration scopes, holiday feeds, branding, and templates. The roster fixture uses disposable SQLite with the production query code; it does not prove MySQL locking or real webhook delivery behavior. For UI changes, check the affected flows at desktop and mobile sizes with fixtures. No lint script or end-to-end browser runner is checked into this repository.

A successful build currently reports a bundle-size advisory for the main JavaScript chunk. This is a performance improvement opportunity, not a build failure.

## Architecture

| Area | Implementation |
| --- | --- |
| Frontend | React 19, Vite, FullCalendar, Luxon, Radix Dialog, Lucide, Tailwind/CSS |
| Application API | Fastify, Zod, cookie sessions, role checks, exact-origin validation |
| Persistence | MySQL 8.4; repeatable schema upgrades through `server/migrate.js` |
| Background work | Worker for signed webhook retries and public holiday refresh |
| Deployment | Docker Compose: `db`, `migrate`, `api`, `worker`, nginx `web` |

`src/shift-dialog.jsx` contains the shared shift/change/swap form. `src/change-request.jsx` discovers an engineer's eligible duties for the Change requests page. `src/calendar-events.js` builds Month summaries from actual consecutive occurrences. The scheduling transaction uses a shared roster lock; individual and group versions protect against stale writes.

## Repository and configuration

The canonical repository is [tiekkeat/Smart-Shift-Planner](https://github.com/tiekkeat/Smart-Shift-Planner). Commit source, tests, documentation, and `package-lock.json`. Keep `.env`, credentials, database dumps, dependencies, generated `dist/`, and local editor files outside version control. `.env.example` contains placeholders only.

Use `main` as the default branch. Before deploying a later commit, back up the database and matching environment configuration, run the validation commands, then follow the [upgrade guide](docs/DEPLOYMENT.md#upgrading-an-existing-installation). Git does not back up the live roster database or admin-uploaded branding; these live in MySQL.
