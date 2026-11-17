# Deployment and operations

This guide covers Smart Shift Planner, whose deployed application and Compose project retain the name Smart Timetable. Keeping the Compose project name `smart-timetable` preserves the existing `smart-timetable_database` volume when the checkout directory changes.

## Requirements

- Docker Engine with the Docker Compose plugin and permission to run Docker.
- Git access to `tiekkeat/Smart-Shift-Planner` for installation and future updates.
- Outbound access to npm/container registries while building, and subscribed holiday feeds/webhook destinations at runtime.
- A host port for nginx. Only `web` publishes a port; MySQL and the API stay inside the Compose network.

Compose builds `smart-timetable-mysql:8.4.13-bookworm` from `Dockerfile.mysql`, using Oracle's signed MySQL 8.4 packages on Debian. This supports older CPU feature sets, including QEMU guests without x86-64-v2 support; the upstream `mysql:8.4` Oracle Linux image can fail before starting on these hosts. Keep this database image built and current alongside the application images. For image-only deployment, see the [Portainer guide](PORTAINER.md).

On the existing machine, Docker access can require `sg docker -c 'docker compose …'`. Use that existing group access; do not change Docker socket permissions. Commands below use ordinary `docker compose` for readability.

## New installation

```bash
git clone https://github.com/tiekkeat/Smart-Shift-Planner.git
cd Smart-Shift-Planner
cp .env.example .env
chmod 600 .env
```

Edit `.env` locally, outside version control. Fill in all secret placeholders before starting. Generate distinct database passwords and an admin password of 12–128 characters. Generate a 32-byte application secret with `openssl rand -hex 32`, then store it in `APP_SECRET`; do not use the example file as your actual deployment configuration.

| Setting | Purpose |
| --- | --- |
| `DB_ROOT_PASSWORD` | Initial MySQL root password; required by Compose. |
| `DB_PASSWORD` | MySQL application-user password; required by Compose. |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Bootstrap the first active admin during migration. Existing active admins are not reset. |
| `APP_SECRET` | Exactly 64 hexadecimal characters; encrypts webhook signing secrets. Retain the same value with database backups. |
| `APP_ORIGIN` | Exact browser origin, including scheme and non-default port, without a trailing slash or path. |
| `COOKIE_SECURE` | `false` for HTTP; `true` for HTTPS. |
| `BIND_ADDRESS` | Published web interface. Defaults to `127.0.0.1`. |
| `WEB_PORT` | Published web port. Defaults to `8080`. |
| `ROSTER_TIMEZONE` | Defaults to `Asia/Kuala_Lumpur`. Use an IANA timezone. |
| `WEBHOOK_ALLOWED_ORIGINS` | Comma-separated HTTPS origins permitted for webhook destinations. Empty disables adding destinations. |

Then start the stack:

```bash
docker compose up -d --build
docker compose ps -a
curl --fail http://localhost:8080/api/health
```

Expected state: `db` and `api` healthy, `worker` and `web` running, and `migrate` exited with code **0**. Health returns `{"status":"ok"}`. Sign in using the configured initial admin credentials, add engineers under **Team directory**, and create duties from **Duty calendar**.

The MySQL image initializes its users/passwords only when the database volume is empty. Changing `DB_PASSWORD` or `DB_ROOT_PASSWORD` in `.env` alone does not rotate passwords in an existing database. Coordinate a password rotation with the database configuration instead of replacing the volume.

## Access from another computer

For an HTTP LAN installation, set the following non-secret settings using your server's reachable IP:

```dotenv
APP_ORIGIN=http://192.168.1.50:8081
BIND_ADDRESS=0.0.0.0
WEB_PORT=8081
COOKIE_SECURE=false
ROSTER_TIMEZONE=Asia/Kuala_Lumpur
```

Allow the selected port through the host/network firewall and browse to exactly the configured origin. Applying environment changes requires recreating the relevant services:

```bash
docker compose up -d
```

The existing installation was checked at `http://172.60.20.10:8081`, with HTTP cookies and `Asia/Kuala_Lumpur`. Its checkout is `/home/zstack/smart-timetable`. Recheck the live service/environment settings before assuming this address on a later installation. Do not copy a new `.env` over this installation's existing file.

## HTTPS behind a reverse proxy

Terminate TLS at a reverse proxy, keep the web port bound to loopback when the proxy is on the same machine, and forward requests to nginx's published port. Configure, for example:

```dotenv
APP_ORIGIN=https://roster.example.com
BIND_ADDRESS=127.0.0.1
WEB_PORT=8080
COOKIE_SECURE=true
```

Preserve the original `Host` header and forward all paths, including `/api/`, to the application. The bundled nginx proxies `/api/` to Fastify and sets its client forwarding header. Compose configures the API to trust the single bundled nginx hop. If your proxy topology changes, review client-IP forwarding and rate limits rather than trusting arbitrary forwarded headers.

Never bypass the API's exact-origin check. Choose one canonical browser origin and redirect alternate hosts to it at the external proxy.

## Upgrading an existing installation

1. Back up the database and matching `.env` using the backup procedure below. Record the current source commit with `git rev-parse HEAD`.
2. Review the incoming changes and update source with `git pull --ff-only`. Resolve local source changes before updating; do not overwrite `.env`.
3. Run `npm ci`, `npm test`, and `npm run build` with Node.js 24–26, or run validation in a separate checkout with the same lockfile.
4. Deploy the appropriate services:

```bash
# Frontend-only source changes
docker compose build web
docker compose up -d --no-deps web

# Backend, schema, dependency, or full-stack changes
docker compose up -d --build
```

5. Check `docker compose ps -a` and `/api/health`. For full-stack updates, confirm the `migrate` service exited **0** before the API/worker started. Check the affected UI flows and use a browser hard refresh after frontend updates.

`server/migrate.js` applies repeatable upgrades to existing databases. Editing only `server/schema.sql` does not upgrade an existing table. Keep migration logic with schema changes.

Do not run `docker compose down -v`, delete the `database` volume, change the Compose project name, or regenerate `APP_SECRET` during routine updates. These actions can discard the roster or make stored webhook credentials unreadable.

## Backup

Backups contain personal data, password hashes, token hashes, sessions, and encrypted integration credentials. Store them outside Git with restricted permissions and an off-host copy.

Run from the deployment checkout:

```bash
umask 077
mkdir -p backups
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --user=root --single-transaction --quick --routines --triggers --no-tablespaces "$MYSQL_DATABASE"' > "backups/roster-$backup_stamp.sql"
cp .env "backups/environment-$backup_stamp.env"
git rev-parse HEAD > "backups/source-$backup_stamp.txt"
```

Check the dump command's exit status and that the output file is non-empty. A failed dump can leave a partial file; do not treat it as a valid backup. Copy this matched database/environment/source set to restricted off-host storage. Encrypt backups at rest according to your operating practices. Practice recovery on an isolated host before relying on the backup.

For the existing shell without active Docker group membership, the dump command can be run as:

```bash
sg docker -c 'docker compose exec -T db sh -c '\''MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --user=root --single-transaction --quick --routines --triggers --no-tablespaces "$MYSQL_DATABASE"'\''' > "backups/roster-$backup_stamp.sql"
```

Stop application writes for a coordinated recovery-point backup when necessary. Do not copy raw live MySQL volume files as a substitute for a consistent database dump.

## Restore and rollback

A restore replaces database state. Test it on an isolated deployment and retain a fresh backup of the target before restoring. Keep recovery environments isolated from real webhook destinations; do not start a worker against copied production integration settings until destinations have been reviewed.

1. Use the source revision recorded with the backup and the matching `.env`/`APP_SECRET` on the recovery host. Keep the Compose project/volume identity correct.
2. Stop writers and start only MySQL:

```bash
docker compose stop web api worker
docker compose up -d db
```

3. Wait for MySQL to be healthy, then import the selected dump. Replace the filename with the verified backup:

```bash
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root "$MYSQL_DATABASE"' < backups/roster-YYYYMMDDTHHMMSSZ.sql
```

4. Deploy the selected compatible source with `docker compose up -d --build`, then verify migration success, service health, accounts, duties, app branding, and integration settings before reopening access.

Application rollback is a controlled return to a known source revision. Check schema compatibility first: there are no automatic down migrations. A code rollback does not undo roster edits, approved requests, or schema changes. If database recovery is required, use the matching database backup and environment rather than guessing how to undo SQL changes.

## Administration

- Bootstrap credentials apply only when no active admin exists. Changing `ADMIN_PASSWORD` in `.env` does not reset an existing admin account.
- An admin or manager can reset an engineer's password in **Team directory → Edit account**. Admins manage account roles and deletion. Contact an existing admin for an admin-account recovery; do not delete the users table or reset the database.
- Engineers submit requests from **Change requests → Request change** or a calendar duty. Only admins approve/reject and revert approved requests. Reversion previews later edits/cancellation and requires explicit confirmation.
- Admin-uploaded branding, templates, holiday subscriptions, memberships, accounts, roster records, requests, and audit history are stored in MySQL and covered by the database backup.
- UI team/engineer filters do not restrict the global integration API. Use scoped API tokens for external callers.

## Troubleshooting

| Symptom | Check and resolution |
| --- | --- |
| “The request origin is not allowed.” | Match `APP_ORIGIN` to the address bar's scheme, host, and port exactly. Recreate the API with `docker compose up -d`; use the canonical origin. Do not disable origin validation. |
| Another PC cannot connect | Verify `BIND_ADDRESS`, `WEB_PORT`, routing/firewall, and the host's reachable address. Default loopback binding only accepts local connections. |
| Login works over HTTPS but fails over HTTP | `COOKIE_SECURE=true` prevents the browser sending the session cookie over HTTP. Match it to your actual HTTPS/HTTP deployment. |
| “Assignment changed” / restore version conflict | Refresh the calendar or reopen the request/restore preview. Review current duty before retrying. |
| Cancelled moved night does not return through group editing | Group edits preserve exceptions. Open the approved request and use **Revert approved change** with its cancellation confirmation. |
| API is unavailable after an upgrade | Inspect `migrate` exit status, then database/API logs. Fix the cause before retrying the migration; preserve the volume. |
| Database exits with “CPU does not support x86-64-v2” | Use the current Compose file and rebuild `db` with `docker compose build db`. For Portainer, build `Dockerfile.mysql` and use its local image as described in the Portainer guide. Preserve the database volume and credentials. |
| Holiday feed refresh fails | Check the subscription error, public HTTPS URL, network access, and supported recurrence rules. Cached holidays remain available. |
| Webhook is rejected or unreadable | Check allowed HTTPS origins, receiver verification, delivery history, and the original `APP_SECRET`. Do not rotate the secret as a troubleshooting shortcut. |
| API token cannot read a phone number | Grant both `on_call:read` and `contact:phone`; see [API examples](API.md). |

Useful commands:

```bash
docker compose ps -a
docker compose logs --tail=100 migrate api worker web
curl --fail http://localhost:8080/api/health
```

Use the actual host/port for health requests. Review logs locally and redact sensitive details before sharing. Avoid printing `docker compose config` or container environments in shared logs: expanded configuration can include deployment secrets.
