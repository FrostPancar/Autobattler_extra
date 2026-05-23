#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_INDEX="${RENDER_SOURCE:-$SCRIPT_DIR/index_extra.html}"
PUBLISH_DIR="$SCRIPT_DIR/render-static"
PUBLISH_INDEX="$PUBLISH_DIR/index.html"

if [[ ! -f "$SOURCE_INDEX" ]]; then
    echo "Missing source file: $SOURCE_INDEX" >&2
    exit 1
fi

rm -rf "$PUBLISH_DIR"
mkdir -p "$PUBLISH_DIR"
cp "$SOURCE_INDEX" "$PUBLISH_INDEX"
cp "$SCRIPT_DIR/coop-ws-client.js" "$PUBLISH_DIR/coop-ws-client.js"

if grep -q 'Latest Deploy:' "$PUBLISH_INDEX"; then
    month="$(LC_ALL=C date '+%B')"
    day="$(date '+%d' | sed 's/^0//')"
    year="$(date '+%Y')"
    hm="$(date '+%H:%M')"
    deploy_stamp="$month $day, $year, $hm"
    if command -v perl >/dev/null 2>&1; then
        perl -0pi -e "s{(<span>Latest Deploy: )[^<]+(</span>)}{\$1$deploy_stamp\$2}" "$PUBLISH_INDEX" || true
    fi
fi

if [[ ! -f "$PUBLISH_INDEX" ]]; then
    echo "Publish artifact missing: $PUBLISH_INDEX" >&2
    exit 1
fi

echo "Prepared Render publish directory from $(basename "$SOURCE_INDEX") ($(wc -c < "$PUBLISH_INDEX") bytes)"
