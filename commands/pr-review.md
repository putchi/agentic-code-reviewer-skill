---
name: pr-review
description: Review a GitHub pull request using the agentic code reviewer (5 parallel reviewers + Synthesizer)
---

Review pull request $ARGUMENTS using the `agentic-code-reviewer:agentic-code-reviewer` skill, but fetch the diff from GitHub instead of git HEAD. Follow Step 0 of the skill for PR mode: extract the PR number from $ARGUMENTS (strip the GitHub URL prefix if present), fetch the diff with `gh pr diff`, and proceed with the full fan-out review.
