---
name: review-resume
description: Resume a backgrounded agentic code review run after UI decisions have been saved.
---

Run the resume reader, then follow the printed decision instructions exactly:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/review-resume.sh" --repo "$(pwd)" --run-id "$ARGUMENTS"
```

Implement only findings marked `ask_claude_to_implement` or `accept_fix`; skip ignored findings; answer explain requests in chat; summarize follow-up-task requests in the final response.
