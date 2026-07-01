#!/usr/bin/env bash
# UserPromptSubmit hook: checks once per session if a newer version is available
# on GitHub and injects a systemMessage if so. All failures are silent.

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('session_id', 'unknown'))
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

SENTINEL="/tmp/acr-update-check-${SESSION_ID}"

# Already checked this session — skip.
if [ -f "$SENTINEL" ]; then
    exit 0
fi

# Record that we checked (regardless of outcome).
touch "$SENTINEL"

# Read installed version from the plugin's own manifest.
INSTALLED_VERSION=$(python3 -c "
import json, os, sys
path = os.environ.get('CLAUDE_PLUGIN_ROOT', '') + '/.claude-plugin/plugin.json'
try:
    with open(path) as f:
        print(json.load(f).get('version', ''))
except Exception:
    print('')
" 2>/dev/null)

if [ -z "$INSTALLED_VERSION" ]; then
    exit 0
fi

# Fetch the latest published version (5-second timeout; fail silently).
LATEST_JSON=$(curl -sf --max-time 5 \
    "https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/.claude-plugin/marketplace.json" \
    2>/dev/null)

if [ -z "$LATEST_JSON" ]; then
    exit 0
fi

LATEST_VERSION=$(echo "$LATEST_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data['plugins'][0]['version'])
except Exception:
    print('')
" 2>/dev/null)

if [ -z "$LATEST_VERSION" ]; then
    exit 0
fi

# Compare: if LATEST_VERSION sorts higher than INSTALLED_VERSION, an update exists.
HIGHER=$(printf '%s\n' "$INSTALLED_VERSION" "$LATEST_VERSION" | sort -V | tail -1)
if [ "$HIGHER" = "$LATEST_VERSION" ] && [ "$LATEST_VERSION" != "$INSTALLED_VERSION" ]; then
    # Detect if hook is running from within the plugin source directory.
    if [ -f "$PWD/.claude-plugin/plugin.json" ]; then
        UPDATE_CMD="./install.sh --platform claude"
    else
        UPDATE_CMD="/plugin update agentic-code-reviewer"
    fi

    python3 -c "
import json, sys
msg = (
    'agentic-code-reviewer v{latest} is available (installed: v{installed}). '
    'To update, run: {cmd} and afterwards run /reload-plugins'
).format(latest=sys.argv[1], installed=sys.argv[2], cmd=sys.argv[3])
print(json.dumps({'systemMessage': msg}))
" "$LATEST_VERSION" "$INSTALLED_VERSION" "$UPDATE_CMD"
fi

exit 0
