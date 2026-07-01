---
name: agentic-code-reviewer
description: >
  Launches a fully backgrounded local code-review run for the current repo. Use
  when the user asks to run code-review, run the code-reviewer skill, run the
  agentic-code-reviewer skill, or run a code review on this repo. The launcher
  starts an external orchestrator and returns immediately; reviewer and synthesis
  work happens in separate non-interactive provider CLI processes.
---

# Agentic Code Review

This skill launches a fully backgrounded code review of the current git diff:
5 specialist reviewer processes in parallel, a synthesizer judge pass, and a
local review UI for triaging findings. Runtime review execution is owned by the
process-based orchestrator in `scripts/`; the rest of this document is the
architecture reference for that runtime.

## Runtime Model

Codex should treat requests like `run code-review on this repo`, `run the
code-reviewer skill`, or `run the agentic-code-reviewer skill` as requests to
launch this skill.

`/code-review` runs:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)"
```

`/pr-review <number-or-url>` runs the same launcher with `--pr "$ARGUMENTS"`.

On Codex, `CLAUDE_PLUGIN_ROOT` is not set. Resolve the installed skill root
before launching:

```bash
SKILL_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.codex/skills/agentic-code-reviewer}"
bash "${SKILL_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)"
```

The launcher validates required tools, creates `.claude/review-runs/<run-id>/`,
starts `scripts/orchestrator.py` with `nohup`, then prints a compact status
line every 20 seconds until the review UI is ready. Set
`ACR_STATUS_POLL=0` to return immediately without polling.

In Claude Code and in Codex installs with hooks enabled, the Stop hook is
controlled by `stopHookMode` in
`~/.claude/agentic-code-reviewer/settings.json`. The default is `prompt`,
including upgraded installs whose older settings files do not have this key.
Claude Code reads the hook from the plugin manifest; Codex reads the user-level
entry installed in `~/.codex/hooks.json`. `hooks/code-review-gate.sh`
delegates to `scripts/review-gate.py`, which uses hook JSON `cwd` when present,
hashes the current reviewable diff, and then follows the resolved mode:
`prompt` stops the turn and waits for the user's next yes/no/skip reply,
`disabled` exits silently, and `auto` launches or reuses a fast review with a 3
minute hook budget. Codex may require reviewing or trusting the hooks through
`/hooks`.

Claude Code named subagents and Codex `spawn_agent` are not used as the review
execution primitive. The five reviewers run as independent provider subprocesses
through `scripts/run-reviewer.sh`, one output file per reviewer:

- `agents/semantic-analyzer.json`
- `agents/security-scanner.json`
- `agents/architecture-reviewer.json`
- `agents/test-coverage-analyzer.json`
- `agents/senior-dev-reviewer.json`

The synthesizer runs only after all five reviewer result files exist and parse.
It writes `synthesis.json`, and the Bun review UI is launched with
`--run-dir <path>`.

Runtime provider selection is automatic:

- Claude Code uses `claude --print --output-format json`
- Codex uses `codex exec --json --sandbox read-only`

Override with `ACR_PLATFORM`, `ACR_REVIEW_PROVIDER`, `ACR_CLAUDE_BIN`,
`ACR_CODEX_BIN`, `ACR_MODEL_BALANCED`, `ACR_MODEL_FAST`, `ACR_MODEL_JUDGE`,
or `ACR_CODEX_REASONING_*`.

## Run Directory

Each run writes:

```text
.claude/review-runs/<run-id>/
  run.json
  context.json
  diff.txt
  orchestrator.log
  review-gate.json
  READY
  ui.pid
  prompts/*.prompt.md
  agents/*.json
  synthesis.json
  decisions.json
```

Reviewer failures, timeouts, and invalid JSON are recorded as explicit
`status: "failed"` reviewer JSON files so synthesis can still proceed with
partial evidence.

## Continuation

When `auto` mode launches or watches a run, server auto-resume is disabled and
the hook owns continuation. Implement / Done / confirmed Dismiss write final
decisions; Save decisions is non-final. If any decision is actionable and the
diff hash still matches, the hook wakes the host agent with instructions to run
the resume reader and act on the result. If the diff changed while review was
running, the hook marks the run stale and allows the session to finish without
using outdated findings. A user-confirmed `prompt` launch behaves like a manual
launch and leaves server auto-resume enabled when host session metadata is
available.

Manual fallback:

```text
/review-resume <run-id>
```

The resume command reads `synthesis.json` and `decisions.json`, validates the
decision actions, and prints deterministic implementation instructions. The
host agent then implements only findings marked `ask_claude_to_implement` or
`accept_fix`, skips `ignore`, answers `ask_claude_to_explain`, and records
`create_follow_up_task` items for the user.

## Decision Actions

Each finding has exactly one action:

- `accept_fix`
- `ignore`
- `create_follow_up_task`
- `ask_claude_to_explain`
- `ask_claude_to_implement`

Per-finding comments, line annotations, and a global comment are preserved in
`decisions.json`.
