#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/acr-runtime.sh"

RUN_ID=""
RUN_DIR=""
REPO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --run-dir) RUN_DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --plugin-root) PLUGIN_ROOT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$RUN_ID" ] || [ -z "$RUN_DIR" ] || [ -z "$REPO" ]; then
  echo "Usage: run-synthesizer.sh --run-id ID --run-dir DIR --repo REPO [--plugin-root ROOT]" >&2
  exit 2
fi

PROMPT_DIR="${RUN_DIR}/prompts"
mkdir -p "$PROMPT_DIR"

PROMPT_FILE="${PROMPT_DIR}/synthesizer.prompt.md"
RAW_FILE="${RUN_DIR}/synthesis.raw.json"
OUT_FILE="${RUN_DIR}/synthesis.json"
DIFF_FILE="${RUN_DIR}/diff.txt"
SYNTH_FILE="${PLUGIN_ROOT}/agents/synthesizer.md"
AGENT_FILES=(
  "agents/semantic-analyzer.json"
  "agents/security-scanner.json"
  "agents/architecture-reviewer.json"
  "agents/test-coverage-analyzer.json"
  "agents/senior-dev-reviewer.json"
)

{
  printf 'You are running as a non-interactive synthesis subprocess.\n'
  printf 'Return ONLY a JSON object matching this schema, with no markdown fences:\n\n'
  printf '{"run_id":"%s","two_sentence_verdict":"Sentence one. Sentence two.","deduped_findings":[{"id":"f1","severity":"HIGH","file":"src/example.ts","line":42,"location":"src/example.ts:42","finding":"Short finding title","reasoning":"Judge reasoning","evidence":"Concrete code excerpt","source_agents":["semantic-analyzer"]}],"dropped_findings_with_reason":[],"contradictions_resolved":[],"severity_rationale":{"f1":"HIGH because it causes incorrect behavior under plausible input"},"recommended_next_actions":["Fix f1 before shipping"],"source_agent_result_files":["agents/semantic-analyzer.json","agents/security-scanner.json","agents/architecture-reviewer.json","agents/test-coverage-analyzer.json","agents/senior-dev-reviewer.json"]}\n\n' "$RUN_ID"
  printf '<synthesizer_instructions>\n'
  sed -n '/^---$/,/^---$/!p' "$SYNTH_FILE"
  printf '\n</synthesizer_instructions>\n\n'
  printf '<diff>\n'
  cat "$DIFF_FILE"
  printf '\n</diff>\n\n'
  printf '<findings>\n'
  for rel in "${AGENT_FILES[@]}"; do
    agent="$(basename "$rel" .json)"
    printf '[%s]\n' "$agent"
    cat "${RUN_DIR}/${rel}"
    printf '\n\n'
  done
  printf '</findings>\n'
} > "$PROMPT_FILE"

acr_build_subprocess_command "judge" "$RAW_FILE"

set +e
(cd "$REPO" && ACR_REVIEW_SUBPROCESS=1 "${ACR_SUBPROCESS_CMD[@]}" < "$PROMPT_FILE" > "$ACR_SUBPROCESS_STDOUT" 2> "${RAW_FILE}.stderr")
RC=$?
set -e

if [ "$ACR_SUBPROCESS_PROVIDER" = "codex" ] && [ ! -s "$RAW_FILE" ] && [ -s "$ACR_SUBPROCESS_STDOUT" ]; then
  cp "$ACR_SUBPROCESS_STDOUT" "$RAW_FILE"
fi

if [ "$RC" -ne 0 ]; then
  echo "${ACR_SUBPROCESS_PROVIDER} synthesizer exited with status ${RC}: $(tr '\n' ' ' < "${RAW_FILE}.stderr" | cut -c1-500)" >&2
  exit "$RC"
fi

python3 "${SCRIPT_DIR}/claude_json.py" synthesis \
  --raw-file "$RAW_FILE" --out-file "$OUT_FILE" --run-id "$RUN_ID" \
  --agent-files "${AGENT_FILES[@]}"
