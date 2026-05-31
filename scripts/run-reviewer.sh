#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/acr-runtime.sh"

RUN_ID=""
RUN_DIR=""
AGENT=""
REPO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --run-dir) RUN_DIR="$2"; shift 2 ;;
    --agent) AGENT="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --plugin-root) PLUGIN_ROOT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$RUN_ID" ] || [ -z "$RUN_DIR" ] || [ -z "$AGENT" ] || [ -z "$REPO" ]; then
  echo "Usage: run-reviewer.sh --run-id ID --run-dir DIR --agent NAME --repo REPO [--plugin-root ROOT]" >&2
  exit 2
fi

OUT_DIR="${RUN_DIR}/agents"
PROMPT_DIR="${RUN_DIR}/prompts"
mkdir -p "$OUT_DIR" "$PROMPT_DIR"

OUT_FILE="${OUT_DIR}/${AGENT}.json"
RAW_FILE="${OUT_DIR}/${AGENT}.raw.json"
PROMPT_FILE="${PROMPT_DIR}/${AGENT}.prompt.md"
AGENT_FILE="${PLUGIN_ROOT}/agents/${AGENT}.md"
DIFF_FILE="${RUN_DIR}/diff.txt"

STARTED_AT="$(python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"))')"
ROLE="balanced"
if [ "$AGENT" = "test-coverage-analyzer" ]; then
  ROLE="fast"
fi

{
  printf 'You are running as a non-interactive code-review subprocess.\n'
  printf 'Return ONLY a JSON object matching this schema, with no markdown fences:\n\n'
  printf '{"run_id":"%s","agent":"%s","status":"complete","started_at":"%s","completed_at":"ISO-8601","error":null,"findings":[{"id":"%s-1","severity":"CRITICAL","file":"src/example.ts","line":42,"location":"src/example.ts:42","finding":"Short finding title","reasoning":"Why this is real","evidence":"Concrete code excerpt","confidence":92}]}\n\n' "$RUN_ID" "$AGENT" "$STARTED_AT" "$AGENT"
  printf 'If there are no findings, return the same object with findings: [].\n\n'
  printf '<agent_instructions>\n'
  sed -n '/^---$/,/^---$/!p' "$AGENT_FILE"
  printf '\n</agent_instructions>\n\n'
  printf '<diff>\n'
  cat "$DIFF_FILE"
  printf '\n</diff>\n'
} > "$PROMPT_FILE"

acr_build_subprocess_command "$ROLE" "$RAW_FILE"

set +e
(cd "$REPO" && ACR_REVIEW_SUBPROCESS=1 "${ACR_SUBPROCESS_CMD[@]}" < "$PROMPT_FILE" > "$ACR_SUBPROCESS_STDOUT" 2> "${RAW_FILE}.stderr")
RC=$?
set -e

if [ "$ACR_SUBPROCESS_PROVIDER" = "codex" ] && [ ! -s "$RAW_FILE" ] && [ -s "$ACR_SUBPROCESS_STDOUT" ]; then
  cp "$ACR_SUBPROCESS_STDOUT" "$RAW_FILE"
fi

COMPLETED_AT="$(python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"))')"

if [ "$RC" -ne 0 ]; then
  ERR="${ACR_SUBPROCESS_PROVIDER} exited with status ${RC}: $(tr '\n' ' ' < "${RAW_FILE}.stderr" | cut -c1-500)"
  python3 "${SCRIPT_DIR}/claude_json.py" reviewer-failure \
    --out-file "$OUT_FILE" --run-id "$RUN_ID" --agent "$AGENT" \
    --started-at "$STARTED_AT" --completed-at "$COMPLETED_AT" --error "$ERR"
  exit 0
fi

python3 "${SCRIPT_DIR}/claude_json.py" reviewer \
  --raw-file "$RAW_FILE" --out-file "$OUT_FILE" --run-id "$RUN_ID" --agent "$AGENT" \
  --started-at "$STARTED_AT" --completed-at "$COMPLETED_AT"
