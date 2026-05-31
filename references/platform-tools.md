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
| Claude Code | `/code-review`, `/pr-review`, `/review-resume`, `/review-last` | `bash`, `python3`, `git`, `claude`; `gh` for PR mode | `/code-review` is the intended short launcher, though Claude Code may display plugin-qualified forms such as `/agentic-code-reviewer:code-review`. Stop hook and update-check hook are registered by the Claude plugin manifest. |
| Codex | Tell Codex `run code-review on this repo`, `run the code-reviewer skill`, or `run the agentic-code-reviewer skill` | `bash`, `python3`, `git`, `codex`; `gh` for PR mode | Codex `multi_agent` is not required. The skill is normally installed at `~/.codex/skills/agentic-code-reviewer`; the Stop hook is merged into `~/.codex/hooks.json`. |
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

## Stop hooks

Claude Code loads the Stop hook from `hooks/hooks.json` through the plugin manifest. Codex does not read that manifest, so `install.sh --platform codex` updates user-level Codex files instead:

```text
~/.codex/hooks.json
~/.codex/config.toml
```

The installer preserves existing hooks, appends this Stop command when missing, and ensures `[features] hooks = true`:

```bash
bash "$HOME/.codex/skills/agentic-code-reviewer/hooks/code-review-gate.sh"
```

Codex may require reviewing or trusting the hook through `/hooks`. Manual skill invocation still works when the hook is installed or disabled.

The gate parses hook JSON and uses `cwd` when present, which lets Codex run the hook from outside the repo while still reviewing the intended workspace. Hook-launched reviews set `ACR_DISABLE_AUTO_RESUME=1`; continuation is handled by the hook's deterministic `review-resume.sh --repo <repo> --run-id <run-id>` block.

## Auto-resume

When the UI handles **Implement** or **Close**, it writes `decisions.json`, touches the compatibility `.done` sentinel, and calls auto-resume:

- Claude Code: uses `CLAUDE_SESSION_ID` with `claude --resume <session-id> --print`.
- Codex: uses `CODEX_THREAD_ID` with `codex exec resume <thread-id>`.
- Otherwise: writes `auto-resume.json` with a `started: false` reason and a `review-resume.sh --repo <repo> --run-id <run-id>` fallback command; the user can run `/review-resume <run-id>` manually.

Set `ACR_DISABLE_AUTO_RESUME=1` to disable this behavior.
