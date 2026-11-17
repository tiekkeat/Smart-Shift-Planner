# Smart Timetable — Codex project instructions

## Project

This is a deployed support-duty roster application. Read `README.md` for product behavior and setup. Preserve existing roster data and configuration while making changes.

- Runtime: Node.js 24–26, JavaScript ES modules, npm with `package-lock.json`.
- Frontend: React 19, Vite, FullCalendar, Luxon, Radix Dialog, Tailwind/CSS, Lucide icons.
- Backend: Fastify, Zod, MySQL 8.4. Docker Compose runs `db`, `migrate`, `api`, `worker`, and nginx `web`.
- This workspace is a Git repository on `main`. The canonical remote is `tiekkeat/Smart-Shift-Planner`. Preserve existing commits and the configured remote; never force-push without explicit instruction.

## Source map

- `src/main.jsx`: authentication, navigation, sidebar, and branding context.
- `src/shift-dialog.jsx`, `src/change-request.jsx`: shared duty editor/change-request form and discovery of eligible assigned duties.
- `src/calendar.jsx`: calendar selection, shift editor, drag/resize, display ordering, and holiday presentation.
- `src/settings.jsx`, `src/schedule-settings.jsx`: branding, calendar preferences, shift templates, and holiday subscriptions.
- `src/people.jsx`, `src/integrations.jsx`, `src/workflow.jsx`: accounts, integration UI, and approvals/reports/notifications.
- `src/lib.js`, `src/ui.jsx`, `src/style.css`: shared frontend helpers, components, and styling.
- `server/app.js`: app routes, sessions, role checks, request-origin checks, and error handling.
- `server/roster.js`, `server/domain.js`: scheduling, approvals, notifications, audit records, and reports.
- `server/accounts.js`, `server/integrations.js`, `server/security.js`: accounts, scoped API tokens, webhooks, and credentials.
- `server/holidays.js`, `server/holiday-feed.js`, `server/templates.js`, `server/branding.js`: schedule settings and holiday-feed handling.
- `server/schema.sql`, `server/migrate.js`, `server/db.js`: schema, repeatable upgrades, and database access.
- `server/duty-groups.js`, `server/group-service.js`, `src/duty-groups.jsx`: repeated-duty interval expansion, persistence, exceptions, and grouped calendar editing.
- `server/teams.js`, `src/teams.jsx`: organizational teams, multi-membership management, and team label UI.
- `docs/DEPLOYMENT.md`, `docs/API.md`: deployment/upgrade/recovery procedures and integration examples.
- `server/worker.js`: webhook delivery and periodic holiday-feed refresh.
- `test/`: Node test-runner suites. Roster tests use a disposable SQLite fixture; they do not establish MySQL locking behavior.

## Development and validation

- Use `npm ci` for a clean install; update the lockfile when changing dependencies.
- Run `npm test` for backend or scheduling changes and `npm run build` for frontend changes.
- Development commands: `npm run dev`, `npm run api`, `npm run worker`, and `npm run migrate`. Backend commands require a configured MySQL database.
- For interaction changes, verify the affected flow in a browser at desktop and mobile sizes. Use fixtures or disposable data rather than changing real assignments or firing real webhooks.
- Keep changes focused and follow existing ES-module, JSX, and shared-component conventions. Edit source files rather than `dist/` or `node_modules/`.
- Report what was actually checked and any remaining limitations. No lint script is currently configured.

## Behavior to preserve

- The roster timezone defaults to `Asia/Kuala_Lumpur`. Keep explicit timezone handling and exclusive shift end boundaries, including overnight duties.
- Overlaps require an explicit in-app confirmation. Preserve optimistic version checks and role permissions.
- Cross-date dragging and resizing open the shift editor before saving. Month-view vertical reordering changes only display order, without changing duty times, versions, or webhook events.
- Repeated duty groups use a Month summary and actual timed occurrences in Week/Day views. Never use the outer group span as continuous coverage. Preserve single-night exceptions and optimistic group versions.
- Current-duty lookup prioritizes the latest-starting active shift, independently of display order.
- Team membership is multi-valued organizational metadata, not an authorization boundary. Admins define teams; managers can assign existing teams to engineers. Calendar filters use current memberships and actual occurrence assignments; public integration lookup remains global. Team colors are labels only.
- Approved-change reversion is admin-only, previews current versions, requires confirmation for later edits/cancellation and overlaps, and restores both sides of a swap in one transaction. Preserve approval history and rejoin group summaries only when the restored occurrence matches the current rule.
- Viewers have read-only timetable/group access and cannot submit change requests. Use explicit Admin/Manager write-role checks, never a “not engineer” test.
- Account deletion is admin-only, blocks self-deletion and active/upcoming assigned duty, revokes sessions, and removes the account from the directory while retaining historical name/audit references. Never hard-delete referenced user records.
- Engineer default colors apply unless a shift overrides them. Engineer colors and app settings are admin-managed.
- Holiday subscriptions retain cached data after refresh failures. Keep public-address validation, bounded downloads, and recurrence limits.
- Integration `/api/v1` routes are read-only, use Bearer tokens, and require separate contact scopes. Tokens must be revoked before permanent deletion.
- Shift copy/paste was deliberately removed. The collapsed desktop sidebar retains menu icons and has its expand control in the bottom footer beside the logout area.

## Deployment and data

- Deployment configuration is in `compose.yaml`, `Dockerfile`, and `nginx.conf`. The existing installation uses `http://172.60.20.10:8081`; verify current non-secret settings and service state before relying on that address.
- In this shell, Docker group membership may require `sg docker -c 'docker compose …'`. Use the existing group access rather than changing socket permissions.
- When deployment is in scope, frontend-only changes can use `docker compose build web` followed by `docker compose up -d --no-deps web`. Full-stack changes use `docker compose up -d --build` so migrations complete before services start.
- Check `docker compose ps -a` and `/api/health` after deployment. A successful `migrate` container exits with code 0.
- Schema updates must handle existing installations through `server/migrate.js`, not only new databases through `server/schema.sql`.
- Preserve the database volume and `APP_SECRET`. Do not reset volumes, replace deployment secrets, or alter unrelated services as part of routine changes.
- Never commit or print `.env` contents, passwords, API tokens, session cookies, or webhook secrets. Admin bootstrap credentials in `.env` do not necessarily match an existing account after password changes.
- `APP_ORIGIN` must exactly match the browser origin. Do not weaken origin validation to fix an address mismatch.
