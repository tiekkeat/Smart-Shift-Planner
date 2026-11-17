#!/bin/sh
# Run from an extracted private recovery package on the NEW Docker host.
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run this script with sudo on the new Docker host.' >&2
  exit 1
fi

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
base=/srv/smart-shift-planner
cd "$package_dir"

for file in SHA256SUMS roster.sql.gz images.tar.gz environment.env compose.portainer.yaml; do
  if [ ! -f "$file" ]; then
    printf 'Missing recovery file: %s\n' "$file" >&2
    exit 1
  fi
done

sha256sum -c SHA256SUMS
command -v docker >/dev/null

# Refuse to overwrite an initialized database or another deployment's settings.
if [ -d "$base/mysql" ] && [ -n "$(ls -A "$base/mysql")" ]; then
  printf 'Refusing to replace existing database files in %s/mysql.\n' "$base" >&2
  exit 1
fi
if [ -e "$base/.env" ]; then
  printf 'Refusing to overwrite existing configuration at %s/.env.\n' "$base" >&2
  exit 1
fi

install -d -m 0700 "$base"
install -d -m 0755 "$base/mysql" "$base/restore"
# The 0700 parent restricts host access; MySQL must read this bind-mounted file.
install -m 0644 roster.sql.gz "$base/restore/10-roster.sql.gz"
install -m 0600 environment.env "$base/.env"
install -m 0644 compose.portainer.yaml "$base/compose.portainer.yaml"
docker load --input images.tar.gz

printf '\n%s\n' 'Recovery files and local images are ready. No application services were started.'
printf '%s\n' 'Edit /srv/smart-shift-planner/.env: change APP_ORIGIN to the new browser URL.'
printf '%s\n' 'In Portainer, upload compose.portainer.yaml and load the matching .env in Environment variables.'
printf '%s\n' 'Keep ENABLE_WORKER=false until the old writer/worker is stopped and the new roster is verified.'
