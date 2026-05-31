---
description: "Launch a fully backgrounded agentic code review run for the current git diff."
disable-model-invocation: true
---

bash "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)"
