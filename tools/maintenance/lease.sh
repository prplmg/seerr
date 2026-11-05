#!/bin/sh
# Invoked by the release process over its existing SSH connection.
set -eu
dir=/run/multimeldia-maintenance
case "${2:-}" in ''|*[!a-zA-Z0-9_-]*) exit 2;; esac
mkdir -p "$dir"
exec 9>"$dir/lock"
flock -x 9
owner=$(cat "$dir/active" 2>/dev/null || :)
case "$1" in
  start)
    [ -z "$owner" ] || [ "$owner" = "$2" ] || exit 1
    # An abandoned deploy must not keep the site in maintenance indefinitely.
    nohup sh -c 'sleep 600; exec "$0" finish "$1"' "$0" "$2" 9>&- </dev/null >/dev/null 2>&1 &
    printf '%s\n' "$2" > "$dir/next"
    mv "$dir/next" "$dir/active"
    ;;
  finish)
    if [ "$owner" = "$2" ]; then rm -f "$dir/active"; fi
    ;;
  *) exit 2;;
esac
