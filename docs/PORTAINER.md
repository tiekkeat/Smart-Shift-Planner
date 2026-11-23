# Recover on another host with Portainer

Use **Portainer → Docker Standalone → Stacks** for this Compose file. It is not a Docker Swarm stack: it relies on Compose startup conditions and bind mounts on one Docker host.

For an update on the existing Docker host using locally built images and a named database volume, use the [same-host deployment guide](PORTAINER-LOCAL.md). Keep your existing persistence layout when updating an installed stack.

## What is persistent

All app data is in MySQL: accounts/password hashes, duties and repeated groups, requests/approvals/reverts, team memberships, branding/logo/favicon, templates, holidays, tokens, webhook configuration, notifications, and audit history. There is no separate application upload volume.

The original installation uses the named volume `smart-timetable_database`, mounted inside MySQL at `/var/lib/mysql`. Its Docker-managed source directory is `/var/lib/docker/volumes/smart-timetable_database/_data`. Do not copy that directory while MySQL is running. The recovery package uses a consistent transactional SQL dump that can initialize a new MySQL 8.4 database.

The package also preserves the matching application secret and credentials. **Do not regenerate `APP_SECRET` when restoring**: existing webhook secrets need the original key.

## New host paths

| New host path | Container destination | Purpose |
| --- | --- | --- |
| `/srv/smart-shift-planner/mysql` | `/var/lib/mysql` on `db` | Live persistent database files; read/write. |
| `/srv/smart-shift-planner/restore` | `/docker-entrypoint-initdb.d` on `db` | SQL restore source; read-only. |
| `/srv/smart-shift-planner/.env` | Import into Portainer's stack environment variables | Protected configuration, including matching secrets. |

The paths belong to the Docker endpoint host, not the Portainer UI server. In a remote Agent environment, create these paths and load the images on the Agent's Docker host.

## Recovery package

The private archive contains:

- `roster.sql.gz`: consistent application database dump.
- `environment.env`: matching `.env`, plus image tags, bind paths, and paused-worker setting. Contains real deployment secrets; never commit it or paste it into chat.
- `images.tar.gz`: exact deployed API, web, and MySQL images, with snapshot-specific tags. The exported images are **linux/amd64**; an ARM host requires rebuilding compatible images from source.
- `compose.portainer.yaml`: image-only stack, without local build contexts.
- `prepare-portainer-host.sh`: checks checksums, refuses an initialized target, prepares paths, and loads images. It does not start services.
- `backup-metadata.json`, `restore-test.json`, and `SHA256SUMS`: snapshot metadata, isolated restoration results, and integrity checks.
- `PORTAINER.md`: this recovery guide.

Transfer the archive privately, for example with `scp`, to the new host. Keep the archive and its extracted directory readable only by the operator/root. A SQL dump is a point-in-time snapshot: later changes on the source host are not included.

## 1. Prepare the new host

Docker and Portainer must already be installed. Extract the archive into a private working directory; replace the archive/directory names with your actual snapshot names:

```bash
umask 077
mkdir -p ~/smart-shift-recovery
cd ~/smart-shift-recovery
tar -xzf /path/to/smart-shift-planner-portainer-YYYYMMDDTHHMMSSZ.tar.gz
cd portainer-YYYYMMDDTHHMMSSZ
sha256sum -c SHA256SUMS
sudo sh ./prepare-portainer-host.sh
```

The script refuses to overwrite a non-empty `/srv/smart-shift-planner/mysql` or existing `/srv/smart-shift-planner/.env`. To restore an existing host, stop its stack and preserve its data/configuration separately before deliberately preparing a fresh target. Do not empty a database directory while its container is running.

The parent `/srv/smart-shift-planner` is root-only (`0700`). The restore file is readable by MySQL inside its bind mount; do not make the whole parent directory world-readable or use `chmod 777`.

## 2. Set the new browser origin

Edit the protected environment file locally:

```bash
sudoedit /srv/smart-shift-planner/.env
```

Keep `DB_ROOT_PASSWORD`, `DB_PASSWORD`, and `APP_SECRET` unchanged. Set these non-secret entries for the destination host:

```dotenv
APP_ORIGIN=http://NEW_HOST_IP:8081
BIND_ADDRESS=0.0.0.0
WEB_PORT=8081
COOKIE_SECURE=false
MYSQL_DATA_DIR=/srv/smart-shift-planner/mysql
RESTORE_DIR=/srv/smart-shift-planner/restore
ENABLE_WORKER=false
```

Replace `NEW_HOST_IP` with the reachable IP or DNS name. For HTTPS, use the exact `https://...` browser origin and `COOKIE_SECURE=true`. Allow the selected web port through the destination's firewall. A wrong origin causes “The request origin is not allowed.”

Preserve the `API_IMAGE`, `WEB_IMAGE`, and `MYSQL_IMAGE` values from the package. These identify the images imported by `docker load`; they do not require a registry login. The Compose file uses `pull_policy: never` to prevent replacing them with unrelated registry images. Disable any Portainer option that forces images to be re-pulled.

## 3. Deploy in Portainer

1. Select the new **Docker Standalone** endpoint.
2. Open **Stacks → Add stack** and name it `smart-shift-planner`.
3. Upload or paste the package's `compose.portainer.yaml`.
4. In **Environment variables**, use Portainer's `.env` import to load the edited `/srv/smart-shift-planner/.env`. Obtain the file through your existing secure administration channel. Do not put actual secret values into the Compose editor or Git. The Compose file explicitly forwards required variables to each service.
5. Leave `ENABLE_WORKER=false` for initial verification and deploy the stack.

For a CLI deployment using the same prepared files:

```bash
sudo docker compose \
  --env-file /srv/smart-shift-planner/.env \
  -f /srv/smart-shift-planner/compose.portainer.yaml \
  up -d
```

On the first start with an empty `mysql` directory, the MySQL image initializes the database/user, imports `restore/10-roster.sql.gz`, and then becomes healthy over TCP. `migrate` runs against the restored data before API/worker startup. The API and web then start. Imports can take longer on larger databases; the recovery health check allows extra initialization time.

Expected state: database/API healthy, migration exited with code 0, and web running. The worker container runs idle while `ENABLE_WORKER=false`; its logs explain that background work is paused. It does not send webhooks or refresh holiday feeds until enabled.

## 4. Verify and cut over

Browse to the new `APP_ORIGIN`. Use existing account passwords: bootstrap environment values do not reset accounts in the restored database.

Check the calendar, changed/reverted nights, directory, app branding, settings, request history, and API health. Do not create real assignments, refresh real feeds, or test real webhooks until the destination is ready to become the active installation.

For migration of the active service:

1. Arrange a final cutover window. Stop accepting changes on the old host, stop its API and worker, and take a fresh final dump if changes occurred after this backup. This prepared package is a snapshot, not continuous replication.
2. Restore/verify that final snapshot on the target. Redirect the browser URL/DNS/proxy to it and keep `APP_ORIGIN` exact.
3. Stop the old worker before setting `ENABLE_WORKER=true` on the new stack. Redeploy to apply the new worker setting.
4. Retain the source and backup as a rollback reference until the new host is verified.

Do not operate two independently writable copies as if they were a synchronized roster. The databases diverge, and queued webhook deliveries copied from a backup may be delivered again; receivers should deduplicate event IDs.

## 5. After restoration

MySQL processes `/docker-entrypoint-initdb.d` **only when its data directory is first initialized**. Restarting the restored stack does not reimport the dump. Replacing `10-roster.sql.gz` does not overwrite an already initialized database.

After successful recovery and retaining an off-host backup, remove the staged dump if desired and keep the empty restore directory in place, since the Compose file still mounts it:

```bash
sudo rm /srv/smart-shift-planner/restore/10-roster.sql.gz
```

Future backups must cover the new MySQL database and matching protected environment. Do not delete or replace `/srv/smart-shift-planner/mysql` during image updates. Application services need no bind mounts for their source, `node_modules`, or `dist`.

## Updating application images after recovery

Build the new API and web images on the destination Docker host. In the existing Portainer stack, update `API_IMAGE` and `WEB_IMAGE` to their complete image names. For the guided duty-request build:

```dotenv
API_IMAGE=smart-timetable-api:duty-requests-20261123
WEB_IMAGE=smart-timetable-web:duty-requests-20261123
```

Update the stack with image re-pulling disabled. Retain the existing `MYSQL_IMAGE`, bind paths, credentials, `APP_SECRET`, and chosen `ENABLE_WORKER` setting. This recovery Compose file uses full image names rather than `IMAGE_TAG`. Do not switch a running deployment between bind mounts and named volumes as part of an application update.

## References

- [Portainer: add a stack and import environment variables](https://docs.portainer.io/user/docker/stacks/add).
- [Official MySQL image initialization and persistent data behavior](https://github.com/docker-library/docs/blob/master/mysql/README.md).
- [General deployment, backup, and recovery guide](DEPLOYMENT.md).
