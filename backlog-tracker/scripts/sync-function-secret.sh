#!/usr/bin/env bash
# Puts one repo secret into Secret Manager for the backlog-tracker Cloud
# Functions, WITHOUT touching any function. Usage (value on stdin):
#
#   printf '%s' "$VALUE" | scripts/sync-function-secret.sh NOTIFY_WEBHOOK_URL
#
# Why not `firebase functions:secrets:set --force` (what deploy-backlog-
# tracker.yml used until 4 Oct 2026): it adds a new secret version on EVERY
# deploy, unchanged or not (NOTIFY_WEBHOOK_URL had reached version 297), and
# then redeploys every function bound to that secret, six at once. When one
# of those six updates failed (a transient 503), the CLI exited while the
# other five were still running on Google's side; the retry 20s later then
# collided with them ("409, unable to queue the operation") on every
# attempt, and the job died before hosting was deployed (run 37189515221).
#
# Here an unchanged value is a no-op, and a changed value only adds a
# version. The `firebase deploy --only functions` step that follows pins each
# function to the latest version of every secret it declares, so functions
# pick the new value up there, in one deploy, with nothing else racing it.
#
# Needs gcloud authenticated as the deploy service account.
set -euo pipefail

NAME="${1:?usage: sync-function-secret.sh SECRET_NAME < value}"
PROJECT="${FIREBASE_PROJECT:-backlog-tracker-e4ed2}"
VALUE="$(cat)"

retry() {
  local attempt
  for attempt in 1 2 3 4; do
    if "$@"; then return 0; fi
    [ "$attempt" = 4 ] && return 1
    echo "  …failed (attempt $attempt/4), retrying in $((attempt * 15))s"
    sleep $((attempt * 15))
  done
}

if ! gcloud secrets describe "$NAME" --project "$PROJECT" >/dev/null 2>&1; then
  echo "$NAME: creating the secret"
  retry gcloud secrets create "$NAME" --project "$PROJECT" \
    --replication-policy=automatic --labels=firebase-managed=true --quiet
fi

# Unreadable (no versions yet, or no accessor role) counts as "changed": adding
# a version is harmless, skipping one that was needed is not.
CURRENT="$(gcloud secrets versions access latest --secret "$NAME" --project "$PROJECT" 2>/dev/null || printf '\001unreadable')"
if [ "$CURRENT" = "$VALUE" ]; then
  echo "$NAME: unchanged, nothing to do"
  exit 0
fi

echo "$NAME: value changed, adding a new version (functions pick it up in the deploy step)"
TMP="$(mktemp)"; chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
printf '%s' "$VALUE" > "$TMP"
retry gcloud secrets versions add "$NAME" --project "$PROJECT" --data-file="$TMP" --quiet
