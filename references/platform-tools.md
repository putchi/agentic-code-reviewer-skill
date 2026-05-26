# Platform Tool Mapping

The `agentic-code-reviewer` skill is written using Claude Code tool names. On Codex and Copilot CLI, use the equivalents below. The skill's behavior is the same on all three platforms.

## Tool equivalents

| Skill references         | Claude Code        | Codex                                  | Copilot CLI                                |
|--------------------------|--------------------|----------------------------------------|--------------------------------------------|
| Subagent dispatch        | `Agent` / `Task`   | `spawn_agent` → `wait_agent` → `close_agent` | `task` with `agent_type: "general-purpose"` |
| Run shell commands       | `Bash`             | native shell tool                      | `bash`                                     |
| Read a file              | `Read`             | native file-read tool                  | `view`                                     |
| Grep file content        | `Grep`             | native grep                            | `grep`                                     |
| Glob filenames           | `Glob`             | native glob                            | `glob`                                     |
| Invoke another skill     | `Skill`            | skills load natively — follow the instructions | `skill`                            |

When the skill says "launch the 5 reviewers in parallel", emit 5 simultaneous subagent-dispatch calls in the **same assistant turn** using whichever tool name your platform uses.

- **Claude Code**: 5 `Agent` tool calls in one response.
- **Codex**: 5 `spawn_agent` calls in one response (they are non-blocking, return agent IDs immediately) → a single `wait_agent` to harvest all 5 results → one `close_agent` per agent ID to free the concurrent-agent slots. Spawn-then-wait-then-close *per agent* runs them sequentially and defeats the fan-out. Forgetting `close_agent` leaks slots.
- **Copilot CLI**: 5 `task` calls in one response.

The Synthesizer (Step 3) is the **only** sequential step: it MUST wait until all 5 reviewer results have returned before being dispatched, because its job is to reconcile across the full set of outputs.

## Codex prerequisite: multi-agent support

Parallel subagent dispatch on Codex requires the `multi_agent` feature flag. Add this to `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

This enables `spawn_agent`, `wait_agent`, and `close_agent`. Without it, the fan-out step will fail. The 3-tool lifecycle is non-negotiable on Codex: spawn returns immediately (so 5 spawns in one turn run concurrently), wait blocks until results are ready, close releases the slot.

## Passing agent definitions on non–Claude Code platforms

Claude Code reads `agents/*.md` natively (the frontmatter declares model, tools, color). Codex and Copilot CLI do not parse these files automatically.

On Codex and Copilot CLI: when dispatching a reviewer, pass the **body** of the corresponding `agents/<reviewer>.md` (everything after the frontmatter) as the dispatched agent's system prompt, and put the user-facing review instructions (the diff + scoring criteria) into the message. The frontmatter (`name`, `model`, `tools`, `color`) is ignored on those platforms and can be safely skipped.

## Resolving the skill root for the web UI server

Step 5b of the skill launches `server/review-server.js` via Node. The skill root path differs per platform:

| Platform | Variable / path |
|----------|----------------|
| Claude Code | `$CLAUDE_PLUGIN_ROOT` (set automatically by the harness when the plugin runs) |
| Codex | `$HOME/.codex/skills/agentic-code-reviewer` (fixed install path; no equivalent env var) |
| Copilot CLI | wherever you cloned/copied the skill — pass the absolute path manually |

The skill uses `SKILL_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.codex/skills/agentic-code-reviewer}"` to cover Claude Code and Codex. On Copilot CLI, edit Step 5b in your local copy of `SKILL.md` to point at the path you installed the skill to.

## Platforms not covered

This skill targets Claude Code, Codex, and Copilot CLI only. Gemini CLI, OpenCode, Cursor, and Factory Droid are out of scope — adapt the skill manually via your platform's skill-activation mechanism if needed.
