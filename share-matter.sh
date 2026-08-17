#!/usr/bin/env bash
# Hand a saved matter to a headset over your own wifi.
#
#   ./share-matter.sh                    # serves the newest chauhaddi_*.json in ~/Downloads
#   ./share-matter.sh path/to/matter.json
#
# Prints a short URL to type into Quest Browser. The file is served from this Mac
# to your local network only: it does not touch Netlify, GitHub, or any cloud, so
# a privileged matter stays inside the office. Stop it with Ctrl-C.
#
# Why this exists: the app keeps everything in the browser it was prepared in, so
# a matter built on a laptop is not on the headset. This is the transfer step.

set -euo pipefail

PORT="${PORT:-8777}"

SRC="${1:-}"
if [ -z "$SRC" ]; then
  SRC="$(ls -t "$HOME/Downloads"/chauhaddi_*.json 2>/dev/null | head -1 || true)"
  if [ -z "$SRC" ]; then
    echo "No matter file given and none found in ~/Downloads." >&2
    echo "In the app press Save first, then run this again." >&2
    exit 1
  fi
  echo "Using the newest saved matter: $(basename "$SRC")"
fi

if [ ! -f "$SRC" ]; then
  echo "Not a file: $SRC" >&2
  exit 1
fi

# Find the LAN address. en0 is wifi on most Macs; en1 covers the rest.
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$IP" ]; then
  echo "Could not work out this Mac's wifi address. Are you on a network?" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Two copies, same content. Some headset browsers will accept one extension and
# refuse to hand the page the bytes of another, so offer both and use whichever
# works. m.txt is the one that behaves more often.
cp "$SRC" "$TMP/m.json"
cp "$SRC" "$TMP/m.txt"

SIZE="$(du -h "$SRC" | cut -f1 | tr -d ' ')"

cat <<EOF

  Serving  $(basename "$SRC")  ($SIZE)  to your local network only.

  On the headset, in Quest Browser:

    1. open  http://$IP:$PORT/m.txt
             ...downloads the matter to the headset

    2. open  https://chauhaddi.netlify.app
             ...the app itself, on a real certificate, so VR works

    3. tap   Open, and pick the file you just downloaded
    4. tap   ENTER VR

  If step 3 fails, or the file reads as empty, open http://$IP:$PORT/m.txt again,
  select all, copy, then paste it into the Export tab's "Project text" box.

  Both devices must be on the same wifi. Ctrl-C to stop.

EOF

cd "$TMP"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
