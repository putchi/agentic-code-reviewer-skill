#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO=""
PR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --pr) PR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

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
CLAUDE_BIN="${ACR_CLAUDE_BIN:-claude}"
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  echo "ERROR: claude CLI with --print support is required before starting a background review." >&2
  exit 1
fi
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
