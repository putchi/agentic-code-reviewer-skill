#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_ROOT="$(mktemp -d /private/tmp/acr-gate-smoke-XXXXXX)"

cleanup() {
  find "$TMP_ROOT" -path '*/.claude/review-runs/*/ui.pid' -type f -print0 2>/dev/null |
    while IFS= read -r -d '' pid_file; do
      kill "$(cat "$pid_file")" 2>/dev/null || true
    done
  if [ "${ACR_KEEP_SMOKE:-0}" = "1" ]; then
    echo "keeping smoke temp dir: $TMP_ROOT" >&2
    return 0
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/claude" <<'SH'
#!/usr/bin/env bash
prompt="$(cat)"
if printf '%s' "$prompt" | grep -q 'synthesis subprocess'; then
  python3 - <<'PY'
import json
payload = {
  "two_sentence_verdict": "This diff needs one targeted fix before shipping. Address the changed return value first.",
  "deduped_findings": [{
    "id": "f1",
    "severity": "HIGH",
    "file": "src/example.ts",
    "line": 1,
    "location": "src/example.ts:1",
    "finding": "Changed return value is incorrect",
    "reasoning": "The fake synthesis saw return 2 in the diff.",
    "evidence": "return 2;",
    "source_agents": ["semantic-analyzer"],
  }],
  "dropped_findings_with_reason": [],
  "contradictions_resolved": [],
  "severity_rationale": {"f1": "HIGH because callers now receive the wrong value."},
  "recommended_next_actions": ["Restore the intended return value."],
  "source_agent_result_files": [
    "agents/semantic-analyzer.json",
    "agents/security-scanner.json",
    "agents/architecture-reviewer.json",
    "agents/test-coverage-analyzer.json",
    "agents/senior-dev-reviewer.json",
  ],
}
print(json.dumps({"result": json.dumps(payload)}))
PY
else
  python3 - <<'PY'
import json
payload = {
  "status": "complete",
  "error": None,
  "findings": [{
    "severity": "HIGH",
    "file": "src/example.ts",
    "line": 1,
    "location": "src/example.ts:1",
    "finding": "Changed return value is incorrect",
    "reasoning": "The fake reviewer saw return 2 in the diff.",
    "evidence": "return 2;",
    "confidence": 91,
  }],
}
print(json.dumps({"result": json.dumps(payload)}))
PY
fi
SH
chmod +x "$FAKE_BIN/claude"

make_repo() {
  local repo="$1"
  mkdir -p "$repo/src"
  git -C "$repo" init -b main >/dev/null
  cat > "$repo/src/example.ts" <<'TS'
export function value() {
  return 1;
}
TS
  git -C "$repo" add src/example.ts
  git -C "$repo" -c user.email=acr@example.test -c user.name=ACR commit -m init >/dev/null
  cat > "$repo/src/example.ts" <<'TS'
export function value() {
  return 2;
}
TS
}

wait_for_url() {
  local repo="$1"
  python3 - "$repo" <<'PY'
import re
import sys
import time
from pathlib import Path

repo = Path(sys.argv[1])
deadline = time.time() + 45
while time.time() < deadline:
    for log in sorted((repo / ".claude" / "review-runs").glob("*/ui.log"), reverse=True):
        text = log.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"Review server listening at (http://127\.0\.0\.1:\d+)", text)
        if match:
            print(match.group(1))
            raise SystemExit(0)
    time.sleep(0.25)
raise SystemExit("server URL not found")
PY
}

run_hook_case() {
  local name="$1"
  local payload_json="$2"
  local expected="$3"
  local event_style="${4:-claude}"
  local repo="$TMP_ROOT/repo-$name"
  local out="$TMP_ROOT/$name.out"
  local err="$TMP_ROOT/$name.err"

  make_repo "$repo"
  local process_cwd="$repo"
  local hook_event
  if [ "$event_style" = "codex" ]; then
    process_cwd="$TMP_ROOT"
    hook_event="$(python3 - "$repo" "$name" <<'PY'
import json
import sys

print(json.dumps({
    "hook_event_name": "Stop",
    "session_id": f"gate-smoke-{sys.argv[2]}",
    "cwd": sys.argv[1],
}))
PY
)"
  else
    hook_event="{\"session_id\":\"gate-smoke-$name\"}"
  fi

  (
    cd "$process_cwd"
    PATH="/opt/homebrew/bin:$FAKE_BIN:$PATH" \
    CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    ACR_PLATFORM=claude \
    ACR_REVIEW_PROVIDER=claude \
    ACR_CLAUDE_BIN="$FAKE_BIN/claude" \
    ACR_NO_OPEN=1 \
    ACR_STOP_HOOK_MODE=auto \
    ACR_GATE_MAX_SECONDS=90 \
    ACR_GATE_POLL_INTERVAL_SECONDS=0.25 \
    ACR_REVIEW_TIMEOUT_SECONDS=30 \
    ACR_SYNTHESIS_TIMEOUT_SECONDS=30 \
    bash "$REPO_ROOT/hooks/code-review-gate.sh" >"$out" 2>"$err" <<JSON
$hook_event
JSON
  ) &
  local hook_pid=$!

  local url
  url="$(wait_for_url "$repo")"
  python3 - "$url" "$payload_json" <<'PY'
import json
import sys
import urllib.request

url = sys.argv[1]
payload = json.loads(sys.argv[2])
req = urllib.request.Request(
    url + "/api/implement",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=10) as res:
    data = json.load(res)
assert data["ok"] is True
PY

  wait "$hook_pid"
  if [ "$expected" = "block" ]; then
    python3 - "$out" <<'PY'
import json
import sys

data = json.loads(open(sys.argv[1], encoding="utf-8").read())
assert data["decision"] == "block", data
assert "review-resume.sh" in data["systemMessage"], data
PY
  else
    test ! -s "$out"
  fi
}

run_hook_case "implement" '{"runId":"ignored-by-server","findingDecisions":{"f1":{"action":"ask_claude_to_implement","comment":"smoke guidance"}},"globalComment":"","lineAnnotations":{}}' block
run_hook_case "codex-implement" '{"runId":"ignored-by-server","findingDecisions":{"f1":{"action":"ask_claude_to_implement","comment":"codex smoke guidance"}},"globalComment":"","lineAnnotations":{}}' block codex
run_hook_case "dismiss" '{"runId":"ignored-by-server","findingDecisions":{"f1":{"action":"ignore","comment":"not needed"}},"globalComment":"","lineAnnotations":{}}' allow

echo "review-gate-hook-smoke-ok"
