#!/usr/bin/env bash
set -euo pipefail

# Stop hook: prompts, skips, or launches a fast review based on user settings.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

python3 "${PLUGIN_ROOT}/scripts/review-gate.py"
