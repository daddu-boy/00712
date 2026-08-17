#!/usr/bin/env bash
# Redeploy Chauhaddi to Netlify.
#
#   ./deploy.sh
#
# Zips the static site and posts it to the Netlify deploy API. No build step,
# because there is nothing to build.
#
# The auth token is read from the Netlify CLI's own config on this machine
# (~/Library/Preferences/netlify/config.json). Nothing secret is stored in this
# repository, and nothing is read from the environment. If you have never logged
# in on this machine, run `npx netlify-cli login` once first.

set -euo pipefail

SITE_NAME="${NETLIFY_SITE_NAME:-chauhaddi}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$HOME/Library/Preferences/netlify/config.json"

if [ ! -f "$CFG" ]; then
  echo "No Netlify config at $CFG — run 'npx netlify-cli login' once, then retry." >&2
  exit 1
fi

TOKEN="$(python3 - "$CFG" <<'PY'
import json, sys, pathlib
d = json.loads(pathlib.Path(sys.argv[1]).read_text())
users = d.get("users") or {}
for u in users.values():
    tok = (u.get("auth") or {}).get("token")
    if tok:
        print(tok); break
PY
)"

if [ -z "$TOKEN" ]; then
  echo "No auth token in $CFG — run 'npx netlify-cli login' once, then retry." >&2
  exit 1
fi

api() { curl -sS -H "Authorization: Bearer $TOKEN" "$@"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ZIP="$TMP/site.zip"

# Responses go through a file rather than a pipe: a heredoc cannot both supply
# the Python program on stdin and carry piped JSON on the same stdin.
pyf() { python3 -c "$1" "$2"; }

echo "Resolving site '$SITE_NAME'…"
api "https://api.netlify.com/api/v1/sites?per_page=100" > "$TMP/sites.json"
SITE_ID="$(pyf '
import json, sys
name = "'"$SITE_NAME"'"
data = json.load(open(sys.argv[1]))
if isinstance(data, dict):
    sys.exit("Netlify API error: " + str(data.get("message") or data)[:200])
for s in data:
    if s.get("name") == name:
        print(s["id"]); break
' "$TMP/sites.json")"

if [ -z "$SITE_ID" ]; then
  echo "Site '$SITE_NAME' not found on this account. Create it in the Netlify UI, or set NETLIFY_SITE_NAME." >&2
  exit 1
fi

echo "Packing…"
# Ship only what the browser needs; .claude holds machine-local paths and .git is history.
rsync -a --exclude '.git' --exclude '.claude' --exclude '.DS_Store' --exclude 'deploy.sh' \
      "$HERE/" "$TMP/site/"
( cd "$TMP/site" && zip -qr "$ZIP" . )
echo "  $(du -h "$ZIP" | cut -f1)"

echo "Deploying to $SITE_NAME…"
api -X POST -H "Content-Type: application/zip" \
    --data-binary "@$ZIP" "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys" > "$TMP/deploy.json"

DEPLOY_ID="$(pyf 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "$TMP/deploy.json")"
if [ -z "$DEPLOY_ID" ]; then
  echo "Deploy failed:" >&2
  cat "$TMP/deploy.json" >&2
  exit 1
fi

printf 'Waiting for it to go live'
for _ in $(seq 1 40); do
  api "https://api.netlify.com/api/v1/deploys/$DEPLOY_ID" > "$TMP/state.json"
  STATE="$(pyf 'import json,sys; print(json.load(open(sys.argv[1])).get("state",""))' "$TMP/state.json")"
  case "$STATE" in
    ready) echo; echo "Live at https://$SITE_NAME.netlify.app"; exit 0 ;;
    error) echo; echo "Deploy errored. See https://app.netlify.com/sites/$SITE_NAME/deploys" >&2; exit 1 ;;
  esac
  printf '.'
  sleep 4
done

echo
echo "Still processing after ~3 minutes. Check https://app.netlify.com/sites/$SITE_NAME/deploys" >&2
