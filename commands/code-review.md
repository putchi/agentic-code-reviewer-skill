---
name: code-review
description: "Start a background agentic code review — of the current git diff, or of a GitHub PR when a PR number/URL is given. Returns immediately; results open in the review UI when ready."
disable-model-invocation: true
---

ACR_PR="$ARGUMENTS"; if [ -n "$ACR_PR" ]; then bash "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)" --pr "$ACR_PR"; else bash "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)"; fi
