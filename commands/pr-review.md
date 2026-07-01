---
name: pr-review
description: Start a background agentic code review of a GitHub pull request — returns immediately; results open in the review UI when ready. Requires gh.
disable-model-invocation: true
---

bash "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)" --pr "$ARGUMENTS"
