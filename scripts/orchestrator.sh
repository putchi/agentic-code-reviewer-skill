#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO=""
PR=""
PLATFORM_ARG=""
STATUS_INTERVAL="${ACR_STATUS_INTERVAL_SECONDS:-20}"
STATUS_MAX_SECONDS="${ACR_STATUS_MAX_SECONDS:-1800}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --pr) PR="$2"; shift 2 ;;
    --platform) PLATFORM_ARG="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

source "${SCRIPT_DIR}/acr-runtime.sh"
ACR_PLATFORM="$(acr_detect_platform "$PLUGIN_ROOT" "$PLATFORM_ARG")"
export ACR_PLATFORM
ACR_REVIEW_PROVIDER="$(acr_detect_provider "$PLUGIN_ROOT" "$ACR_PLATFORM")"
export ACR_REVIEW_PROVIDER

if [ -z "$REPO" ]; then
  REPO="$(pwd)"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required for agentic code review orchestration." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required for agentic code review." >&2
  exit 1
fi
acr_validate_provider "$ACR_REVIEW_PROVIDER"
if [ -n "$PR" ] && ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh is required for PR review mode." >&2
  exit 1
fi
if [ "$(git -C "$REPO" rev-parse --is-inside-work-tree 2>/dev/null || true)" != "true" ]; then
  echo "ERROR: agentic code review requires a git repository." >&2
  exit 1
fi

RUN_ID="$(python3 -c 'import datetime, secrets; print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+"-"+secrets.token_hex(3))')"
RUN_DIR="${REPO}/.claude/review-runs/${RUN_ID}"
mkdir -p "$RUN_DIR"

ARGS=(
  "python3" "${SCRIPT_DIR}/orchestrator.py"
  "--repo" "$REPO"
  "--run-id" "$RUN_ID"
  "--run-dir" "$RUN_DIR"
  "--plugin-root" "$PLUGIN_ROOT"
  "--platform" "${ACR_PLATFORM:-}"
  "--provider" "$ACR_REVIEW_PROVIDER"
)
if [ -n "$PR" ]; then
  ARGS+=("--pr" "$PR")
fi

nohup "${ARGS[@]}" >> "${RUN_DIR}/orchestrator.log" 2>&1 &
PID=$!

cat <<EOF
Review ${RUN_ID} started.
Status: .claude/review-runs/${RUN_ID}/run.json
Resume after decisions: /review-resume ${RUN_ID}
Background PID: ${PID}
EOF

if [ "${ACR_STATUS_POLL:-1}" = "0" ]; then
  exit 0
fi

if ! [[ "$STATUS_INTERVAL" =~ ^[0-9]+$ ]] || [ "$STATUS_INTERVAL" -lt 5 ]; then
  STATUS_INTERVAL=20
fi
if ! [[ "$STATUS_MAX_SECONDS" =~ ^[0-9]+$ ]] || [ "$STATUS_MAX_SECONDS" -lt "$STATUS_INTERVAL" ]; then
  STATUS_MAX_SECONDS=1800
fi

echo "Polling review status every ${STATUS_INTERVAL}s until the UI is ready..."

START_TIME="$(date +%s)"
while true; do
  python3 - "$RUN_DIR" <<'PY'
import datetime as dt
import json
import sys
from pathlib import Path

AGENTS = {
    "semantic-analyzer",
    "security-scanner",
    "architecture-reviewer",
    "test-coverage-analyzer",
    "senior-dev-reviewer",
}
LABELS = {
    "started": "starting",
    "snapshotting": "snapshotting diff",
    "reviewers_running": "reviewers running",
    "reviewers_complete": "reviewers complete",
    "synthesizing": "synthesizing verdict",
    "synthesis_complete": "synthesis complete",
    "synthesis_failed": "synthesis failed",
    "launching_ui": "opening UI",
    "awaiting_decisions": "UI ready",
    "no_changes": "no reviewable changes",
    "no_findings": "no findings",
    "diff_too_small": "diff too small",
    "failed": "review failed",
}

run_dir = Path(sys.argv[1])
run = {}
try:
    run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
except Exception:
    pass

agent_done = 0
agent_failed = 0
finding_count = 0
for path in (run_dir / "agents").glob("*.json"):
    if path.name.endswith(".raw.json"):
        continue
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        continue
    if data.get("agent") not in AGENTS:
        continue
    if data.get("status") in {"complete", "failed"}:
        agent_done += 1
        if data.get("status") == "failed":
            agent_failed += 1
        findings = data.get("findings")
        if isinstance(findings, list):
            finding_count += len(findings)

status = str(run.get("status") or "starting")
label = LABELS.get(status, status.replace("_", " "))
now = dt.datetime.now().strftime("%H:%M:%S")
parts = [f"[agentic-review {now}] {label}"]
if status not in {"starting", "started", "snapshotting", "no_changes", "no_findings", "diff_too_small"}:
    parts.append(f"agents {agent_done}/5")
    if agent_failed:
        parts.append(f"{agent_failed} failed")
    parts.append(f"{finding_count} raw findings")
if run.get("resume_command"):
    parts.append(str(run["resume_command"]))
print("; ".join(parts))
PY

  STATUS="$(python3 - "$RUN_DIR" <<'PY' 2>/dev/null || true
import json
import sys
from pathlib import Path
try:
    print(json.loads((Path(sys.argv[1]) / "run.json").read_text(encoding="utf-8")).get("status", ""))
except Exception:
    print("")
PY
)"
  if [ -f "$RUN_DIR/READY" ] || [ "$STATUS" = "awaiting_decisions" ] || [ "$STATUS" = "synthesis_failed" ] || [ "$STATUS" = "no_changes" ] || [ "$STATUS" = "no_findings" ] || [ "$STATUS" = "diff_too_small" ]; then
    break
  fi
  if [ "$STATUS" = "failed" ]; then
    echo "Review failed. Details: .claude/review-runs/${RUN_ID}/run.json (and orchestrator.log)"
    break
  fi

  NOW="$(date +%s)"
  if [ $((NOW - START_TIME)) -ge "$STATUS_MAX_SECONDS" ]; then
    echo "Status polling timed out; review is still running in the background."
    echo "Status: .claude/review-runs/${RUN_ID}/run.json"
    break
  fi
  sleep "$STATUS_INTERVAL"
done
