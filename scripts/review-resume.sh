#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(pwd)"
RUN_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    *) RUN_ID="$1"; shift ;;
  esac
done

if [ -z "$RUN_ID" ]; then
  echo "Usage: review-resume.sh --repo REPO --run-id RUN_ID" >&2
  exit 2
fi

python3 "${SCRIPT_DIR}/review-resume.py" --repo "$REPO" --run-id "$RUN_ID"
