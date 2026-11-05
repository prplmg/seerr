#!/bin/sh
set -eu
# Pass a fresh staging directory containing the three edge assets. Keep the
# test listener, lease, admin API and storage separate from production.
cd "${1:?staging directory required}"
test ! -e snippet
sed -e "s@/run/multimeldia-maintenance@$PWD/flag@" -e "s@/srv/multimeldia-maintenance@$PWD@" catalogue.caddy >snippet
sed "s@/run/multimeldia-maintenance@$PWD/flag@g;s/sleep 600/sleep 3/" lease.sh >test-lease
chmod +x test-lease
cat >Caddyfile <<CFG
{
  admin off
  auto_https off
}
http://127.0.0.1:29183 {
  import $PWD/snippet
}
CFG
export XDG_DATA_HOME="$PWD/data" XDG_CONFIG_HOME="$PWD/config"
caddy validate --config Caddyfile --adapter caddyfile >validate.log 2>&1 || { cat validate.log; exit 1; }
caddy run --config Caddyfile --adapter caddyfile >run.log 2>&1 & pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
sleep 1
url=http://127.0.0.1:29183
curl -fsS "$url/api/v1/status?checkUpdateAvailable=false" | grep -q version
./test-lease start test-1
curl -sS -H 'Accept: text/html' -D headers "$url/tv/2?k=hi" > page
grep -q ' 503 ' headers
grep -iq 'X-Multimeldia-Updating: 1' headers
grep -iq 'Cache-Control: no-store' headers
cmp updating.html page
curl -sS -X POST -H 'Accept: text/html' -D headers "$url/api/v1/reviews" >api
grep -q ' 503 ' headers
grep -iq 'Content-Type: application/json' headers
grep -q retryAfter api
./test-lease finish wrong-owner
test -f flag/active
./test-lease finish test-1
curl -fsS "$url/api/v1/status?checkUpdateAvailable=false" | grep -q version
./test-lease start abandoned
sleep 4
test ! -f flag/active
curl -fsS "$url/api/v1/status?checkUpdateAvailable=false" | grep -q version
echo 'PASS normal proxy, exact branded 503, uncached HTML, JSON API, owner-safe release and abandoned lease expiration'
