---
name: agentic-code-reviewer:last
description: "Open the last saved code review in the browser"
---

# Open Last Review

Find and open the most recent agentic code review.

## Steps

1. Find the most recent findings JSON:
   ```bash
   ls -t /tmp/claude-code-review-*.json 2>/dev/null | head -1
   ```

2. Find the most recent saved markdown:
   ```bash
   ls -t docs/code-reviews/*.md 2>/dev/null | head -1
   ```

3. If a JSON file exists, launch the review server:
   ```bash
   SKILL_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.codex/skills/agentic-code-reviewer}"
   LAST_JSON=$(ls -t /tmp/claude-code-review-*.json 2>/dev/null | head -1)
   node "${SKILL_ROOT}/server/review-server.js" \
     --session last \
     --findings-file "$LAST_JSON" \
     --save-dir "$(pwd)/docs/code-reviews"
   ```
   The server opens the browser automatically and blocks until the user takes an action.

4. If no JSON exists but a markdown file exists, open it:
   - macOS: `open <path>`
   - Linux: `xdg-open <path>`

5. If neither exists, print: `No saved review found.`
