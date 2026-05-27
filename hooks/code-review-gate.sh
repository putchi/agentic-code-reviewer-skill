#!/usr/bin/env bash
# Stop hook: gates session exit if code was modified but agentic review not yet run.
#
# Completion signal:
#   The skill writes /tmp/claude-code-review-${SESSION_ID}.done when it finishes a
#   real review. The hook checks for that file's existence. This replaces the older
#   transcript-grep for the AGENTIC-REVIEW-COMPLETE string, which was false-positive
#   prone (the literal string can appear in chat / code / docs).
#
# Escape sentinel:
#   The first time we block, we write /tmp/claude-code-review-${SESSION_ID}.blocked.
#   On the second Stop attempt, we allow exit — so the user can abandon a session
#   without being held hostage.
#
# Cleanup:
#   Stale .blocked and .done files older than 1 day are deleted on every invocation.

INPUT=$(cat)

# Reviewer and synthesizer subprocesses are already part of an active
# agentic-code-reviewer run. Let them terminate normally instead of recursively
# triggering this gate and asking to launch another orchestrator.
if [ "${ACR_REVIEW_SUBPROCESS:-}" = "1" ]; then
    exit 0
fi

SESSION_ID=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('session_id', 'unknown'))
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

TRANSCRIPT=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('transcript_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

BLOCKED_SENTINEL="/tmp/claude-code-review-${SESSION_ID}.blocked"
DONE_SENTINEL="/tmp/claude-code-review-${SESSION_ID}.done"

# Cleanup: stale sentinels older than 1 day. Idempotent, cheap, runs every invocation.
find /tmp -maxdepth 1 -name 'claude-code-review-*.blocked' -mtime +1 -delete 2>/dev/null
find /tmp -maxdepth 1 -name 'claude-code-review-*.done' -mtime +1 -delete 2>/dev/null

# Escape hatch: if we already blocked once this session, allow exit.
# Prevents holding the user hostage when they want to abandon work without reviewing.
if [ -f "$BLOCKED_SENTINEL" ]; then
    exit 0
fi

# Check for code changes (staged or unstaged vs HEAD)
CHANGES=$(git diff HEAD --name-only 2>/dev/null | head -5)
if [ -z "$CHANGES" ]; then
    CHANGES=$(git diff --name-only 2>/dev/null | head -5)
fi

# No code changes this session — nothing to review
if [ -z "$CHANGES" ]; then
    exit 0
fi

# Authoritative completion check: did the skill actually run and finish?
if [ -f "$DONE_SENTINEL" ]; then
    exit 0
fi

# Background architecture completion check: a review run for this repo has reached
# a state where the UI is ready or decisions have been saved. This is scoped to the
# current git repo so old runs in other projects do not satisfy the gate.
RUN_STATE=$(python3 - <<'PY' 2>/dev/null || true
import glob, json, os
root = os.popen('git rev-parse --show-toplevel 2>/dev/null').read().strip()
if not root:
    raise SystemExit(0)
valid = {'awaiting_decisions', 'decisions_ready', 'no_changes', 'synthesis_complete', 'synthesis_failed'}
for path in sorted(glob.glob(os.path.join(root, '.claude', 'review-runs', '*', 'run.json')), reverse=True):
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        if data.get('repo') == root and data.get('status') in valid:
            print(data.get('status'))
            break
    except Exception:
        pass
PY
)
if [ -n "$RUN_STATE" ]; then
    touch "$DONE_SENTINEL"
    exit 0
fi

# Backward-compat fallback: if for some reason the skill couldn't write the .done
# file (e.g. SESSION_ID was unavailable in its environment), still honor the legacy
# marker — but only when present in the transcript file, not just any text.
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && grep -q "AGENTIC-REVIEW-COMPLETE" "$TRANSCRIPT" 2>/dev/null; then
    exit 0
fi

# Block and request review. Write sentinel so a second attempt is allowed.
touch "$BLOCKED_SENTINEL"

REASON="Code changes detected but agentic code review has not been run. Please run the agentic-code-reviewer skill before finishing."
SYSTEM_MSG="IMPORTANT: Code was modified this session. You MUST invoke the agentic-code-reviewer skill now to perform a comprehensive review before the session ends. Use the Skill tool with skill name 'agentic-code-reviewer'."

python3 -c "
import json, sys
print(json.dumps({
    'decision': 'block',
    'reason': sys.argv[1],
    'systemMessage': sys.argv[2]
}))
" "$REASON" "$SYSTEM_MSG"

exit 0
