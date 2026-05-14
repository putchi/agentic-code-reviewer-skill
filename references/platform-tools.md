# Platform Tool Mapping

The `agentic-code-reviewer` skill is written using Claude Code tool names. On Codex and Copilot CLI, use the equivalents below. The skill's behavior is the same on all three platforms.

## Tool equivalents

| Skill references         | Claude Code        | Codex                                  | Copilot CLI                                |
|--------------------------|--------------------|----------------------------------------|--------------------------------------------|
| Subagent dispatch        | `Agent` / `Task`   | `spawn_agent` (+ `wait_agent`)         | `task` with `agent_type: "general-purpose"` |
| Run shell commands       | `Bash`             | native shell tool                      | `bash`                                     |
| Read a file              | `Read`             | native file-read tool                  | `view`                                     |
| Grep file content        | `Grep`             | native grep                            | `grep`                                     |
| Glob filenames           | `Glob`             | native glob                            | `glob`                                     |
| Invoke another skill     | `Skill`            | skills load natively — follow the instructions | `skill`                            |

When the skill says "launch the 5 reviewers in parallel", make 5 simultaneous subagent-dispatch calls using whichever tool name your platform uses.

## Codex prerequisite: multi-agent support

Parallel subagent dispatch on Codex requires the `multi_agent` feature flag. Add this to `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

This enables `spawn_agent`, `wait_agent`, and `close_agent`. Without it, the fan-out step will fail.

## Passing agent definitions on non–Claude Code platforms

Claude Code reads `agents/*.md` natively (the frontmatter declares model, tools, color). Codex and Copilot CLI do not parse these files automatically.

On Codex and Copilot CLI: when dispatching a reviewer, pass the **body** of the corresponding `agents/<reviewer>.md` (everything after the frontmatter) as the dispatched agent's system prompt, and put the user-facing review instructions (the diff + scoring criteria) into the message. The frontmatter (`name`, `model`, `tools`, `color`) is ignored on those platforms and can be safely skipped.

## Platforms not covered

This skill targets Claude Code, Codex, and Copilot CLI only. Gemini CLI, OpenCode, Cursor, and Factory Droid are out of scope — adapt the skill manually via your platform's skill-activation mechanism if needed.
