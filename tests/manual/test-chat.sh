#!/usr/bin/env bash
set -e
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
bun packages/server/src/index.ts --session chatTest --port 9998 &
PID=$!; sleep 1
SID=$(curl -s -X POST http://127.0.0.1:9998/api/chat/session \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-haiku-4-5"}' | jq -r .sessionId)
curl -s --no-buffer -X POST http://127.0.0.1:9998/api/chat/query \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"prompt\":\"hi\"}" | head -c 200
kill $PID 2>/dev/null || true
echo OK
