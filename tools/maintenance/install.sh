#!/bin/sh
# Install on Caddy's Alpine VM. Run from the unpacked maintenance directory.
set -eu
umask 077
dir=/srv/multimeldia-maintenance
mkdir -p "$dir"
chmod 755 "$dir"
for file in catalogue.caddy updating.html lease.sh; do
    cp "$file" "$dir/$file.new"
    chmod 644 "$dir/$file.new"
    mv "$dir/$file.new" "$dir/$file"
done
chmod 755 "$dir/lease.sh"
live=/etc/caddy/Caddyfile
candidate=$(mktemp /etc/caddy/Caddyfile-maintenance.XXXXXX)
trap 'rm -f "$candidate"' EXIT
# There are two catalogue listeners; require both to match and preserve all other routes.
awk '{line=$0; sub(/\r$/,"",line); if(line ~ /^[[:space:]]*reverse_proxy 192\.168\.68\.50:5055[[:space:]]*$/){sub(/reverse_proxy 192\.168\.68\.50:5055/,"import /srv/multimeldia-maintenance/catalogue.caddy"); count++} else if(line ~ /^[[:space:]]*import \/srv\/multimeldia-maintenance\/catalogue.caddy$/){count++} print} END {if(count!=2)exit 1}' "$live" >"$candidate"
caddy validate --config "$candidate" --adapter caddyfile
backup="$live.before-maintenance-$(date +%Y%m%d%H%M%S)"
cp -p "$live" "$backup"
cat "$candidate" >"$live"
if ! rc-service caddy reload; then cp -p "$backup" "$live"; rc-service caddy reload; exit 1; fi
