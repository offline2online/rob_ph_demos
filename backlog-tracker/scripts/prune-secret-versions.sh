#!/usr/bin/env bash
# Reports, and optionally destroys, Secret Manager versions no deployed Cloud
# Function uses. Run from .github/workflows/secret-versions.yml.
#
#   scripts/prune-secret-versions.sh report    # default: read-only
#   scripts/prune-secret-versions.sh destroy   # destroys unused versions
#
# Why this exists (Firebase cost review, 5 Oct 2026): "Secret version replica
# storage" was A$39.55 of the month's bill and climbing every day, because
# every deploy until 4 Oct added a version of all five function secrets
# (NOTIFY_WEBHOOK_URL reached 297) and old versions are billed until they
# are destroyed — disabled ones included. `firebase functions:secrets:prune`
# reported "All secrets are in use", so this works from the live functions
# themselves instead of Firebase's labels.
#
# What destroy keeps, always:
#   - every version any deployed function (any codebase) is pinned to;
#   - the newest version of every secret;
#   - every version of a secret no function references at all (not ours to
#     judge — reported, never touched).
# It refuses to run if the functions listing can't be read or shows no
# pinned secrets, since "nothing is pinned" would mean destroying everything.
#
# Needs gcloud authenticated as the deploy service account, plus curl and jq.
set -euo pipefail

MODE="${1:-report}"
PROJECT="${FIREBASE_PROJECT:-backlog-tracker-e4ed2}"
PRICE_PER_VERSION_MONTH=0.06 # USD, per active version per location
case "$MODE" in report|destroy) ;; *) echo "usage: $0 [report|destroy]" >&2; exit 2 ;; esac

TOKEN="$(gcloud auth print-access-token)"
FUNCS="$(curl -sf -H "Authorization: Bearer $TOKEN" \
  "https://cloudfunctions.googleapis.com/v2/projects/$PROJECT/locations/-/functions?pageSize=1000")" \
  || { echo "Couldn't list Cloud Functions — refusing to go on." >&2; exit 1; }
if [ -n "$(jq -r '.nextPageToken // empty' <<<"$FUNCS")" ]; then
  echo "Functions listing is paginated beyond one page — refusing to go on." >&2; exit 1
fi
echo "Deployed functions: $(jq '.functions | length' <<<"$FUNCS")"

# "<secret> <version>" per pinned reference; the secret may be a bare name or
# a full resource path.
PINNED="$(jq -r '.functions[]?.serviceConfig.secretEnvironmentVariables[]? | "\(.secret | split("/") | last) \(.version)"' <<<"$FUNCS" | sort -u)"
[ -n "$PINNED" ] || { echo "No function has a pinned secret — refusing to go on." >&2; exit 1; }

total_active=0; total_destroyable=0
TO_DESTROY="$(mktemp)"
printf '\n%-28s %8s %8s %10s %s\n' SECRET ENABLED DISABLED DESTROYABLE "PINNED BY FUNCTIONS"
for secret in $(gcloud secrets list --project "$PROJECT" --format='value(name)' | sed 's#.*/##'); do
  versions="$(gcloud secrets versions list "$secret" --project "$PROJECT" --filter='state!=DESTROYED' --format=json \
    | jq -r '.[] | "\(.name | split("/") | last) \(.state)"')"
  enabled=$(grep -c ' ENABLED$' <<<"$versions" || true)
  disabled=$(grep -c ' DISABLED$' <<<"$versions" || true)
  total_active=$((total_active + enabled + disabled))
  pins="$(awk -v s="$secret" '$1==s {print $2}' <<<"$PINNED" | sort -n | tr '\n' ' ')"
  destroyable=0
  if [ -n "$pins" ] && [ -n "$versions" ]; then
    newest="$(awk '{print $1}' <<<"$versions" | sort -n | tail -1)"
    while read -r v state; do
      [ -n "$v" ] || continue
      [ "$v" = "$newest" ] && continue
      grep -qw -- "$v" <<<"$pins" && continue
      echo "$secret $v" >> "$TO_DESTROY"
      destroyable=$((destroyable + 1))
    done <<<"$versions"
  fi
  total_destroyable=$((total_destroyable + destroyable))
  printf '%-28s %8s %8s %10s %s\n' "$secret" "$enabled" "$disabled" "$destroyable" "${pins:-(none — left alone)}"
done

cost() { awk -v n="$1" -v p="$PRICE_PER_VERSION_MONTH" 'BEGIN { printf "%.2f", n * p }'; }
echo
echo "Active versions (billed): $total_active  ≈ US\$$(cost "$total_active")/month"
echo "Unused and destroyable:   $total_destroyable  ≈ US\$$(cost "$total_destroyable")/month saved"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### Secret versions ($MODE)"; echo; echo "- Active (billed): **$total_active** ≈ US\$$(cost "$total_active")/month"; echo "- Unused, destroyable: **$total_destroyable** ≈ US\$$(cost "$total_destroyable")/month"; } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$MODE" = report ]; then
  echo "Report only — nothing destroyed. Run with mode=destroy to remove the unused versions."
  exit 0
fi
[ "$total_destroyable" -gt 0 ] || { echo "Nothing to destroy."; exit 0; }
echo "Destroying $total_destroyable version(s)…"
FAILED="$(mktemp)"
export PROJECT FAILED
# Eight at a time: about a thousand versions one by one is ~25 minutes.
xargs -P 8 -L 1 sh -c 'gcloud secrets versions destroy "$1" --secret "$0" --project "$PROJECT" --quiet >/dev/null 2>&1 || echo "$0@$1" >> "$FAILED"' < "$TO_DESTROY"
failed=$(wc -l < "$FAILED" | tr -d ' ')
[ "$failed" -eq 0 ] || { echo "Couldn't destroy:"; sed 's/^/  /' "$FAILED"; }
echo "Done: $((total_destroyable - failed)) destroyed, $failed failed."
[ "$failed" -eq 0 ]
