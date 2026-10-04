#!/usr/bin/env bash
# Regenerates public/pickleserve21_scoresheet.pdf from the built site.
# The @media print rules render only the scoresheet, so printing the page = the PDF.
# Needs a Chromium/Chrome binary: set CHROME, or it falls back to Playwright's cached build.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | tail -1)}"
[ -x "$CHROME" ] || { echo "Set CHROME to a Chromium/Chrome binary" >&2; exit 1; }

PORT=4179
npm run build >/dev/null
./node_modules/.bin/vite preview --port "$PORT" --strictPort >/dev/null 2>&1 &
PREVIEW=$!
trap 'kill $PREVIEW' EXIT
until curl -s -o /dev/null "http://localhost:$PORT/"; do sleep 0.2; done

"$CHROME" --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=public/pickleserve21_scoresheet.pdf "http://localhost:$PORT/" 2>/dev/null
echo "Wrote public/pickleserve21_scoresheet.pdf"
