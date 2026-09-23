#!/usr/bin/env bash
# Rebuild prototype/ — the hosted, read-only copy of the admin UI that the
# test links and GitHub Pages serve — from the source in this checkout.
#
#   scripts/rebuild-prototype.sh            # rebuild if the source moved since the last build
#   scripts/rebuild-prototype.sh --force    # rebuild regardless
#   scripts/rebuild-prototype.sh --check    # say whether it is stale; exit 1 if so, write nothing
#
# Why this exists (22 Sep 2026): prototype/ is a BUILT bundle checked into
# the repo. A ticket that changes apps/admin/src changes nothing a tester
# can see until someone rebuilds it — and the board automation can't,
# because it delivers patches through Firestore (1 MiB per document) and
# the bundle is ~2 MB. Three tickets in a row failed testing on a link that
# was still showing the previous build. .github/workflows/dsp-prototype.yml
# runs this on a runner for main and the deploy branch; a person can run it
# here with nothing more than Node installed — no .env needed, the API is
# started on a spare port against a throwaway database and seeded fresh.
#
# The build is stamped: prototype/build-info.json records a hash of the
# source tree it came from, so "is it stale?" is a cheap comparison and a
# scheduled run that finds nothing changed does nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE="${1:-}"

# Everything the bundle is built from. apps/admin/public/demo/ is excluded
# because the build itself rewrites it (the API snapshot), which would make
# every build look like new source.
SOURCE_PATHS=(apps packages package.json package-lock.json scripts/rebuild-prototype.sh)
source_stamp() {
  git ls-tree -r HEAD -- "${SOURCE_PATHS[@]}" | grep -v 'apps/admin/public/demo/' | git hash-object --stdin
}
recorded_stamp() {
  node -e 'try { console.log(require("./prototype/build-info.json").sourceStamp || "") } catch { console.log("") }'
}

current="$(source_stamp)"
recorded="$(recorded_stamp)"

if [ "$MODE" = "--check" ]; then
  if [ "$current" = "$recorded" ]; then
    echo "prototype/ is built from the current source ($current)."
    exit 0
  fi
  echo "prototype/ is STALE: built from ${recorded:-<no build-info.json>}, source is now $current."
  exit 1
fi

if [ "$MODE" != "--force" ] && [ "$current" = "$recorded" ]; then
  echo "prototype/ already matches the source ($current) — nothing to rebuild."
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "node_modules is missing — run 'npm ci' in $ROOT first." >&2
  exit 2
fi

# A throwaway API: fresh database, fresh seed, its own port, secrets key
# generated for the run. Exported variables win over .env (Node's
# loadEnvFile never overrides an existing variable), so a developer's own
# database and port are left alone.
TMP="$(mktemp -d)"
PORT="${PROTOTYPE_API_PORT:-4765}"
export PH_DB_FILE="$TMP/poc.sqlite"
export PH_ASSETS_DIR="$TMP/assets"
export API_PORT="$PORT"
export DSP_INTEGRATION_ENABLED=true
export POC_ROLE=hq_admin
export PH_SECRETS_KEY="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))')"
# Nothing listens here: the auction scheduler's ticks fail and are logged, which is fine for a read-side snapshot.
export DSP_MOCKS_URL="http://127.0.0.1:1"

npm run start -w @ph-dsp/api >"$TMP/api.log" 2>&1 &
API_PID=$!
cleanup() { kill "$API_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/api/admin/v1/session" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -sf "http://127.0.0.1:$PORT/api/admin/v1/session" >/dev/null 2>&1; then
  echo "The POC API did not come up on port $PORT. Its log:" >&2
  cat "$TMP/api.log" >&2
  exit 1
fi

DEMO_API="http://127.0.0.1:$PORT" npm run demo:capture -w @ph-dsp/admin
# The hosted API the prototype saves to (deploy/firebase/, Rob 23 Sep). The
# bundle tries it at start-up and falls back to the read-only snapshot if it
# doesn't answer, so building before it is deployed is harmless. Set
# PROTOTYPE_API_URL= (empty) to build a snapshot-only prototype.
API_URL="${PROTOTYPE_API_URL-https://us-central1-backlog-tracker-e4ed2.cloudfunctions.net/dspApi}"
(cd apps/admin && VITE_DEMO=1 VITE_API_URL="$API_URL" npx vite build --base=./)

# Replace, don't overlay: a previous build's hashed assets must not linger.
rm -rf prototype/assets prototype/demo prototype/index.html
mkdir -p prototype
cp -R apps/admin/dist/. prototype/

COMMIT="$(git rev-parse HEAD)"
BRANCH="${PROTOTYPE_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
node -e '
  const [stamp, commit, branch] = process.argv.slice(1)
  require("node:fs").writeFileSync("prototype/build-info.json", JSON.stringify({
    sourceStamp: stamp, commit, branch, builtAt: new Date().toISOString(),
    note: "What this hosted prototype was built from. Compare commit with the ticket to know whether the test link shows the change yet.",
  }, null, 2) + "\n")
' "$current" "$COMMIT" "$BRANCH"

echo "Rebuilt prototype/ from $COMMIT ($BRANCH), source stamp $current."
