#!/usr/bin/env bash
# Wipes local dev data, to start over as a brand new player.
#
#   scripts/reset-dev.sh [all|desktop|api] [--seed]
#
#   desktop  the app's saved state (private island, garden session), for both
#            `pnpm dev` (an unbundled binary, blob-land-desktop) and a built
#            app (its identifier, dev.blobland.desktop).
#   api      the garden's Postgres (every account, island and timeline), made
#            again, empty, with its tables. A running API carries on with it.
#   --seed   then fills islands for testing, through the running API
#            (DEV_TOOLS=1): 449 blobs (one place left for yours), 225, 112, 337.
#
# Never touches apps/api/.env or anything but dev data.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHAT="all"
SEED=0
for arg in "$@"; do
  case "$arg" in
    all | desktop | api) WHAT="$arg" ;;
    --seed) SEED=1 ;;
    -h | --help) sed -n 2,14p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (see --help)" >&2; exit 1 ;;
  esac
done

IDENTIFIER="$(sed -n 's/.*"identifier": *"\([^"]*\)".*/\1/p' "$ROOT/apps/desktop/src-tauri/tauri.conf.json")"
BINARY="blob-land-desktop"
API="${API_URL:-http://localhost:8787}"

remove() {
  if [ -e "$1" ]; then
    echo "  - $1"
    rm -rf "$1"
  fi
}

reset_desktop() {
  # A running app would write its state back on the way out.
  if pgrep -x "$BINARY" >/dev/null || pgrep -x "Blob Land" >/dev/null; then
    echo "Quit the Blob Land app first, then run this again." >&2
    exit 1
  fi
  echo "Desktop data ($IDENTIFIER, $BINARY):"
  for name in "$IDENTIFIER" "$BINARY"; do
    case "$(uname -s)" in
      Darwin*)
        remove "$HOME/Library/Application Support/$name"
        remove "$HOME/Library/WebKit/$name"
        remove "$HOME/Library/Caches/$name"
        remove "$HOME/Library/HTTPStorages/$name"
        remove "$HOME/Library/Preferences/$name.plist"
        remove "$HOME/Library/Saved Application State/$name.savedState"
        ;;
      Linux*)
        remove "${XDG_DATA_HOME:-$HOME/.local/share}/$name"
        remove "${XDG_CONFIG_HOME:-$HOME/.config}/$name"
        remove "${XDG_CACHE_HOME:-$HOME/.cache}/$name"
        ;;
      MINGW* | MSYS* | CYGWIN*)
        remove "${APPDATA:-$USERPROFILE/AppData/Roaming}/$name"
        remove "${LOCALAPPDATA:-$USERPROFILE/AppData/Local}/$name"
        ;;
      *) echo "unsupported system: $(uname -s)" >&2; exit 1 ;;
    esac
  done
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$ROOT/apps/api/docker-compose.yml" "$@"
  else
    docker-compose -f "$ROOT/apps/api/docker-compose.yml" "$@"
  fi
}

reset_api() {
  echo "Garden database (Postgres, apps/api/docker-compose.yml):"
  compose rm -sfv db
  docker volume rm -f api_db >/dev/null
  compose up -d db
  printf "  waiting for Postgres"
  for _ in $(seq 1 60); do
    if compose exec -T db pg_isready -U blob -d blob_land >/dev/null 2>&1; then
      echo " ready"
      break
    fi
    printf "."
    sleep 1
  done
  pnpm --dir "$ROOT/apps/api" --silent db:migrate
  echo "  tables made"
}

seed() {
  curl -sf "$API/health" >/dev/null || { echo "The API isn't answering at $API: start it (pnpm --filter @blob-land/api dev), then run with --seed again." >&2; exit 1; }
  echo "Seeding islands through $API:"
  for island in 0:449 1:225 2:112 3:337; do
    region="${island%%:*}" count="${island##*:}"
    curl -sf -X POST "$API/__dev/populate" -H 'content-type: application/json' -d "{\"count\":$count,\"region\":$region}" >/dev/null ||
      { echo "populate failed: is DEV_TOOLS=1 in apps/api/.env?" >&2; exit 1; }
    echo "  island $region: $count blobs"
  done
}

case "$WHAT" in
  desktop) reset_desktop ;;
  api) reset_api ;;
  all) reset_desktop; reset_api ;;
esac
if [ "$SEED" = 1 ]; then seed; fi
echo "Done."
