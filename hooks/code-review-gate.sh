#!/usr/bin/env bash
set -euo pipefail

# Stop hook: prompts, skips, or launches a fast review based on user settings.

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
case "$SCRIPT_PATH" in
  */*) SCRIPT_DIR="${SCRIPT_PATH%/*}" ;;
  *) SCRIPT_DIR="." ;;
esac
SCRIPT_DIR="$(cd "$SCRIPT_DIR" && pwd -P)"

SCRIPT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
if [ -f "${SCRIPT_ROOT}/scripts/review-gate.py" ]; then
  PLUGIN_ROOT="$SCRIPT_ROOT"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
else
  PLUGIN_ROOT="$SCRIPT_ROOT"
fi

resolve_python() {
  if [ -n "${ACR_PYTHON_BIN:-}" ]; then
    if [ -x "$ACR_PYTHON_BIN" ]; then
      printf '%s\n' "$ACR_PYTHON_BIN"
      return 0
    fi
    echo "Agentic Code Reviewer Stop hook failed: ACR_PYTHON_BIN is not executable: $ACR_PYTHON_BIN" >&2
    return 127
  fi

  for candidate in \
    /opt/homebrew/opt/python@3.13/libexec/bin/python3 \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    /usr/bin/python3
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi

  echo "Agentic Code Reviewer Stop hook failed: python3 not found in PATH or known install paths" >&2
  return 127
}

PYTHON_BIN="$(resolve_python)" || exit $?
echo "Agentic Code Reviewer Stop hook: running $PYTHON_BIN ${PLUGIN_ROOT}/scripts/review-gate.py" >&2
exec "$PYTHON_BIN" "${PLUGIN_ROOT}/scripts/review-gate.py"
