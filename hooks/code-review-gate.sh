#!/usr/bin/env bash
set -euo pipefail

# Stop hook: launches/reuses the review UI, waits for the user's final UI
# action, then returns the hook decision that wakes Claude when work remains.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

python3 "${PLUGIN_ROOT}/scripts/review-gate.py"
