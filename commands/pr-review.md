---
name: pr-review
description: Launch a fully backgrounded agentic code review run for a GitHub pull request.
disable-model-invocation: true
---

bash "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)" --pr "$ARGUMENTS"
