#!/usr/bin/env sh
set -eu
DEMO="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/src/main/webapp/index.html"
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$DEMO" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then open "$DEMO"
else printf 'Open this file in your browser:\n%s\n' "$DEMO"; fi
