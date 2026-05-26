#!/usr/bin/env bash
set -e
FX=/tmp/claude-code-review-decTest.json
DEC=/tmp/claude-code-review-decTest.decision
cp tests/fixtures/sample-review.json "$FX"
rm -f "$DEC"
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
bun packages/server/src/index.ts --session decTest --findings-file "$FX" --port 9997 &
PID=$!; sleep 1
curl -s -X POST http://127.0.0.1:9997/api/implement \
  -H 'Content-Type: application/json' \
  -d '{"selectedIds":["f001"],"comments":{},"globalComment":"","lineAnnotations":{}}' >/dev/null
sleep 1
grep -q '"action":"implement"' "$DEC" && echo PASS || (echo FAIL; exit 1)
kill $PID 2>/dev/null || true
