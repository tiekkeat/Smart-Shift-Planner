# Deploy the locally built images with Portainer

Use [compose.portainer.yaml](../compose.portainer.yaml) with a **Docker Standalone** environment on the same host where the images were built. It has no source checkout or build requirement in Portainer. The API, worker, and migration share one image; nginx and the frontend use the web image.

## Build on the Docker host

From the repository root:

```bash
docker build --target api --tag smart-timetable-api:736d810 .
docker build --target web --tag smart-timetable-web:736d810 .
docker build -f Dockerfile.mysql --tag smart-timetable-mysql:8.4.13-bookworm .
```

`736d810` identifies the application source revision used for this initial build. For future application builds, choose a new tag for both application images and set the stack's `IMAGE_TAG` to that tag. Keep the previous images for rollback after reviewing database compatibility. Local images must remain on this Docker host; no registry push is needed.

The database image installs Oracle's signed MySQL 8.4.13 Debian packages on Bookworm and copies the official image's initialization entrypoint. This avoids the Oracle Linux 9 userspace requirement for x86-64-v2 CPU features, which some QEMU VMs do not expose. It preserves the MySQL engine and the existing `MYSQL_*` variables and data directory. Build this image too; the registry's `mysql:8.4` image is not a substitute on these hosts. Package versions and the repository signing-key checksum are pinned in `Dockerfile.mysql`; review and rebuild them when applying MySQL security updates.

## Create the stack

1. In Portainer, select this host's Docker environment, then **Stacks → Add stack**.
2. Name the stack `smart-timetable`. Choose **Web editor** and paste the complete contents of `compose.portainer.yaml`.
3. Under **Environment variables**, add the settings below (or paste them in advanced mode). Replace every `REPLACE_...` value before deployment. These values belong in Portainer, outside Git.

```dotenv
IMAGE_TAG=736d810
DB_ROOT_PASSWORD=REPLACE_WITH_UNIQUE_ROOT_PASSWORD
DB_PASSWORD=REPLACE_WITH_UNIQUE_APPLICATION_DB_PASSWORD
ADMIN_EMAIL=REPLACE_WITH_YOUR_ADMIN_EMAIL
ADMIN_NAME=Roster Admin
ADMIN_PASSWORD=REPLACE_WITH_12_TO_128_CHARACTER_PASSWORD
APP_SECRET=REPLACE_WITH_64_HEXADECIMAL_CHARACTERS
APP_ORIGIN=http://172.60.20.220:8081
COOKIE_SECURE=false
BIND_ADDRESS=0.0.0.0
WEB_PORT=8081
ROSTER_TIMEZONE=Asia/Kuala_Lumpur
DATABASE_VOLUME=smart-timetable_database
WEBHOOK_ALLOWED_ORIGINS=
```

The host's LAN address was checked as `172.60.20.220`, and port `8081` was free when preparing this stack. Use the actual address clients will browse to. `APP_ORIGIN` must match its scheme, hostname/IP, and port exactly, without a trailing slash. For HTTPS through a reverse proxy, use the HTTPS origin and `COOKIE_SECURE=true`; see [reverse-proxy setup](DEPLOYMENT.md#https-behind-a-reverse-proxy).

Generate the application secret privately with `openssl rand -hex 32`. Generate distinct database passwords, for example with `openssl rand -hex 24` for each. Store these values securely alongside backups. Do not paste secret output into chat or commit it.

4. Leave **Re-pull image** / **Pull latest image** disabled if offered. All three images are local and their Compose entries use `pull_policy: never`.
5. Click **Deploy the stack**. MySQL becomes healthy, migration runs to completion, then the API/worker start; web waits for the API to become healthy.

Portainer supports interpolating the variables entered in the stack form into `${VARIABLE}` expressions. No `env_file` or host `.env` is required by this file. See [Portainer's stack creation documentation](https://docs.portainer.io/user/docker/stacks/add).

## Verify after deployment

In Portainer, expect `db` and `api` healthy, `worker` and `web` running, and `migrate` exited with code **0**. A stopped migration container is expected. Check the migration logs first if application startup fails.

```bash
docker ps -a --filter label=com.docker.compose.project=smart-timetable
curl --fail http://172.60.20.220:8081/api/health
```

Health should return `{"status":"ok"}`. Browse to `http://172.60.20.220:8081` and sign in with the configured initial admin credentials.

## Data and future updates

The explicit volume name is `smart-timetable_database`, independent of Portainer's project naming. Keep this volume and the same `APP_SECRET` on redeployment. MySQL data, accounts, branding, and duties persist there. Bootstrap admin settings only create an admin if no active admin exists.

For an existing installation, first back up its database and matching secrets, set `DATABASE_VOLUME` to the existing volume, and retain its actual database credentials and `APP_SECRET`. Changing a MySQL password environment variable does not change a password already stored in MySQL. This Compose file uses database/user `timetable`, matching the repository's standard deployment.

For updates, build both images under a new tag on this host, change `IMAGE_TAG` in Portainer, and update the stack without forcing registry pulls. Ensure `migrate` runs successfully for the new image before accepting traffic. Follow the [backup and upgrade procedures](DEPLOYMENT.md) and retain the volume when removing/recreating a stack.

If an earlier stack failed with `Fatal glibc error: CPU does not support x86-64-v2`, build the database image above, replace the stack YAML with the current `compose.portainer.yaml`, and redeploy with the same settings and volume. The `db` service must use `smart-timetable-mysql:8.4.13-bookworm`. Do not delete the volume or change database passwords to address this CPU error.
