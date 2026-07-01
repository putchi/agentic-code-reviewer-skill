---
name: code-review
description: "Start a background agentic code review of the current git diff — returns immediately; results open in the review UI when ready."
disable-model-invocation: true
---

bash "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)"
