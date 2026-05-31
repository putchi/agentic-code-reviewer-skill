# Platform Runtime Notes

The current `agentic-code-reviewer` runtime does **not** dispatch platform-native subagents. Claude Code `Agent`/`Task`, Codex `spawn_agent`, and Copilot `task` are not part of the review fan-out path anymore.

Review execution is owned by the local process orchestrator:

```bash
SKILL_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.codex/skills/agentic-code-reviewer}"
bash "${SKILL_ROOT}/scripts/orchestrator.sh" --repo "$(pwd)"
```

The orchestrator creates `.claude/review-runs/<run-id>/`, starts `scripts/orchestrator.py` with `nohup`, runs 5 reviewer subprocesses through `scripts/run-reviewer.sh`, runs `scripts/run-synthesizer.sh`, then launches the review UI with `--run-dir <path>`. The subprocess provider is selected from `ACR_PLATFORM`, `--platform`, `CLAUDE_SESSION_ID`, `CODEX_THREAD_ID`, install path, or `ACR_REVIEW_PROVIDER`.

## Host requirements

| Host | Invocation | Required local tools | Notes |
|---|---|---|---|
| Claude Code | `/agentic-code-reviewer`, `/pr-review`, `/review-resume` | `bash`, `python3`, `git`, `claude`; `gh` for PR mode | Stop hook and update-check hook are Claude Code only. |
| Codex | Tell Codex to run the installed `agentic-code-reviewer` skill | `bash`, `python3`, `git`, `codex`; `gh` for PR mode | Codex `multi_agent` is not required. The skill is normally installed at `~/.codex/skills/agentic-code-reviewer`. |
| Copilot CLI | Manual copy/invocation, untested | `bash`, `python3`, `git`, provider CLI; `gh` for PR mode | There is no installer path today. |

## Provider and model mapping

| Role | Claude provider | Codex provider |
|---|---|---|
| Balanced reviewers | `sonnet` | `gpt-5.4`, reasoning `medium` |
| Fast reviewer | `haiku` | `gpt-5.4-mini`, reasoning `low` |
| Synthesizer / judge | `opus` | `gpt-5.5`, reasoning `high` |
| Ask AI | `sonnet` | `gpt-5.4`, reasoning `medium` |

Override provider and model selection with `ACR_REVIEW_PROVIDER`, `ACR_CLAUDE_BIN`, `ACR_CODEX_BIN`, `ACR_MODEL_BALANCED`, `ACR_MODEL_FAST`, `ACR_MODEL_JUDGE`, and `ACR_CODEX_REASONING_*`.

## Skill root resolution

Claude Code sets `CLAUDE_PLUGIN_ROOT` when a plugin command runs. Codex does not, so installed Codex usage relies on the fixed install path:

```text
~/.codex/skills/agentic-code-reviewer
```

The server's `PLUGIN_ROOT` resolution tries, in order:

1. `CLAUDE_PLUGIN_ROOT`
2. The current repo root when `.claude-plugin/plugin.json` exists
3. Legacy Claude cache path `~/.claude/plugins/cache/agentic-code-reviewer`
4. Marketplace clone `~/.claude/plugins/marketplaces/agentic-code-reviewer-skill`
5. Codex skill path `~/.codex/skills/agentic-code-reviewer`
6. A persistent fallback settings directory at `~/.claude/agentic-code-reviewer`

## Auto-resume

When the UI handles **Implement** or **Close**, it writes `decisions.json`, touches the compatibility `.done` sentinel, and calls auto-resume:

- Claude Code: uses `CLAUDE_SESSION_ID` with `claude --resume <session-id> --print`.
- Codex: uses `CODEX_THREAD_ID` with `codex exec resume <thread-id>`.
- Otherwise: writes `auto-resume.json` with a `started: false` reason; the user can run `/review-resume <run-id>` manually.

Set `ACR_DISABLE_AUTO_RESUME=1` to disable this behavior.
