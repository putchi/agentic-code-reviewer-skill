#!/usr/bin/env bash
set -e
FX=/tmp/claude-code-review-uiTest.json
cp tests/fixtures/sample-review.json "$FX"
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
bun packages/server/src/index.ts --session uiTest --findings-file "$FX" --port 9999 &
PID=$!; sleep 1
RESP=$(curl -s http://127.0.0.1:9999/api/review)
kill $PID 2>/dev/null || true
echo "$RESP" | grep -q '"severity":"CRITICAL"' && echo PASS || (echo FAIL; exit 1)
