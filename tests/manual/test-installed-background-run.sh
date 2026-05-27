#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_VERSION="$(
  python3 - "$REPO_ROOT/.claude-plugin/plugin.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    print(json.load(fh)["version"])
PY
)"
PLUGIN_ROOT="${1:-$HOME/.claude/plugins/cache/agentic-code-reviewer-skill/agentic-code-reviewer/$PLUGIN_VERSION}"

if [ ! -x "$PLUGIN_ROOT/scripts/orchestrator.sh" ]; then
  echo "Missing installed orchestrator: $PLUGIN_ROOT/scripts/orchestrator.sh" >&2
  exit 1
fi
if [ ! -x "$PLUGIN_ROOT/dist/review-server" ]; then
  echo "Missing installed review server binary: $PLUGIN_ROOT/dist/review-server" >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d /private/tmp/acr-installed-smoke-XXXXXX)"
cleanup() {
  if [ -f "$TMP_ROOT/repo/.claude/review-runs/$RUN_ID/ui.pid" ]; then
    kill "$(cat "$TMP_ROOT/repo/.claude/review-runs/$RUN_ID/ui.pid")" 2>/dev/null || true
  fi
  if [ "${ACR_KEEP_SMOKE:-0}" = "1" ]; then
    echo "keeping smoke temp dir: $TMP_ROOT" >&2
    return 0
  fi
  rm -rf "$TMP_ROOT"
}
RUN_ID=""
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
  "run_id": "fake-run",
  "two_sentence_verdict": "This diff needs one targeted fix before shipping. Address the changed return value first.",
  "deduped_findings": [{
    "id": "f1",
    "severity": "HIGH",
    "file": "src/example.ts",
    "line": 1,
    "location": "src/example.ts:1",
    "finding": "Changed return value is incorrect",
    "reasoning": "The diff changes a stable return value in a way the smoke test can track.",
    "evidence": "return 2;",
    "source_agents": ["semantic-analyzer", "senior-dev-reviewer"],
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

REPO="$TMP_ROOT/repo"
mkdir -p "$REPO/src"
git -C "$REPO" init -b main >/dev/null
cat > "$REPO/src/example.ts" <<'TS'
export function value() {
  return 1;
}
TS
git -C "$REPO" add src/example.ts
git -C "$REPO" -c user.email=acr@example.test -c user.name=ACR commit -m init >/dev/null
cat > "$REPO/src/example.ts" <<'TS'
export function value() {
  return 2;
}
TS

LAUNCH_OUT="$TMP_ROOT/launch.out"
PATH="$FAKE_BIN:$PATH" \
CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
ACR_NO_OPEN=1 \
ACR_REVIEW_TIMEOUT_SECONDS=30 \
ACR_SYNTHESIS_TIMEOUT_SECONDS=30 \
bash "$PLUGIN_ROOT/scripts/orchestrator.sh" --repo "$REPO" > "$LAUNCH_OUT"

RUN_ID="$(awk '/^Review / {print $2}' "$LAUNCH_OUT")"
RUN_DIR="$REPO/.claude/review-runs/$RUN_ID"
test -n "$RUN_ID"

python3 - "$RUN_DIR/run.json" <<'PY'
import json, sys, time
path = sys.argv[1]
deadline = time.time() + 30
while time.time() < deadline:
    try:
        fh = open(path, encoding="utf-8")
    except FileNotFoundError:
        time.sleep(0.25)
        continue
    with fh:
        data = json.load(fh)
    if data.get("status") in {"awaiting_decisions", "synthesis_failed"}:
        print(data["status"])
        raise SystemExit(0)
    time.sleep(0.25)
raise SystemExit("run did not reach UI-ready state")
PY

python3 - "$RUN_DIR" <<'PY'
import json, pathlib, sys
run_dir = pathlib.Path(sys.argv[1])
agents = sorted(path for path in (run_dir / "agents").glob("*.json") if not path.name.endswith(".raw.json"))
assert len(agents) == 5, agents
for path in agents:
    data = json.loads(path.read_text())
    assert data["status"] == "complete", path
    assert data["findings"], path
synthesis = json.loads((run_dir / "synthesis.json").read_text())
assert synthesis["deduped_findings"][0]["id"] == "f1"
PY

URL="$(python3 - "$RUN_DIR/ui.log" <<'PY'
import re, sys, time
path = sys.argv[1]
deadline = time.time() + 20
while time.time() < deadline:
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except FileNotFoundError:
        text = ""
    match = re.search(r"Review server listening at (http://127\.0\.0\.1:\d+)", text)
    if match:
        print(match.group(1))
        raise SystemExit(0)
    time.sleep(0.25)
raise SystemExit("server URL not found in ui.log")
PY
)"

python3 - "$URL" <<'PY'
import json, sys, urllib.request
url = sys.argv[1]
with urllib.request.urlopen(url + "/api/review", timeout=5) as res:
    data = json.load(res)
assert data["runId"]
assert data["findings"][0]["id"] == "f1"
assert data["files"][0]["path"] == "src/example.ts"
PY

python3 - "$URL" "$RUN_ID" <<'PY'
import json, sys, urllib.request
url, run_id = sys.argv[1:3]
payload = {
    "runId": run_id,
    "findingDecisions": {
        "f1": {"action": "ask_claude_to_implement", "comment": "smoke test guidance"}
    },
    "globalComment": "installed smoke test",
    "lineAnnotations": {},
}
req = urllib.request.Request(
    url + "/api/save",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=5) as res:
    data = json.load(res)
assert data["ok"] is True
PY

python3 - "$RUN_DIR/decisions.json" "$RUN_ID" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data["run_id"] == sys.argv[2]
assert data["findings"]["f1"]["action"] == "ask_claude_to_implement"
assert data["global_comment"] == "installed smoke test"
PY

RESUME_OUT="$TMP_ROOT/resume.out"
(cd "$REPO" && bash "$PLUGIN_ROOT/scripts/review-resume.sh" --repo "$REPO" --run-id "$RUN_ID") > "$RESUME_OUT"
grep -q "ask_claude_to_implement (1): f1" "$RESUME_OUT"
grep -q "User comment: smoke test guidance" "$RESUME_OUT"

echo "installed-background-smoke-ok $RUN_ID"
