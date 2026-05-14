---
name: agentic-code-reviewer
description: >
  Use when code has been written or modified to perform deep multi-dimensional review.
  Launches 5 specialized sub-agents in parallel covering logic, security, architecture,
  tests, and senior dev best practices, then a final Chairman/Judge pass that dedupes,
  re-rates, and writes a verdict. Reports CRITICAL/HIGH/NOTES backed by code evidence.
  Outputs AGENTIC-REVIEW-COMPLETE marker and a session-scoped completion file when done.
---

# Agentic Code Review

You are performing a comprehensive multi-dimensional code review using 5 specialized sub-agents running in parallel, followed by a Chairman/Judge pass that produces the final report.

## Step 1: Pre-flight

### 1a. Git-repo guard

Run `git rev-parse --is-inside-work-tree 2>/dev/null`. If this returns anything other than `true`, you are NOT in a git repository.

If not in a git repo:
- Print: `Not in a git repository — agentic code review requires git. Skipping.`
- Output `<!-- AGENTIC-REVIEW-NOT-APPLICABLE -->` on its own line.
- Do NOT write the `.done` completion file.
- Stop. (The Stop hook will still block exit, which is intentional — the user is in an unusual state and should know.)

### 1b. Get the diff (text only, binary filtered)

Run `git diff --text HEAD` to get all staged and unstaged changes since last commit. If that returns nothing, run `git diff --text` for unstaged changes only. The `--text` flag prevents binary garbage from being treated as a diff.

Additionally filter out files matching these patterns (do NOT pass them to the reviewers):
- `*.lock`, `*.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `poetry.lock`, `Pipfile.lock`, `composer.lock`, `Gemfile.lock`
- `*.min.js`, `*.min.css`, `*.map`
- `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.svg`, `*.webp`, `*.ico`, `*.pdf`, `*.zip`, `*.tar`, `*.gz`
- Anything under `dist/`, `build/`, `node_modules/`, `.next/`, `.nuxt/`, `target/`, `__pycache__/`

A practical way: `git diff --text HEAD -- . ':!*.lock' ':!*.min.*' ':!*.png' ':!*.jpg' ':!*.svg' ':!dist/' ':!build/' ':!node_modules/'` (extend as needed).

### 1c. Empty-diff path

If the filtered diff is empty:
- Print: `No reviewable changes — nothing to review.`
- Touch the completion file: `touch "/tmp/claude-code-review-${CLAUDE_SESSION_ID:-unknown}.done"` (if `CLAUDE_SESSION_ID` is unavailable in your environment, use whatever session identifier the hook will also see; the hook reads `session_id` from its input JSON).
- Output `<!-- AGENTIC-REVIEW-COMPLETE -->` on its own line.
- Stop.

### 1d. Size cap + cost preview

Count the lines and files in the filtered diff. If lines > 2000 OR files > 50, print this warning before proceeding:

```
⚠ Large diff: <N> lines across <M> files.
This review will fan out to 5 parallel reviewers + 1 Chairman pass.
Estimated time: 30–90s. Estimated cost: ~$0.30–$0.80.
```

For smaller diffs, print a one-line preview:

```
Reviewing <N> lines across <M> files via 5 reviewers + Chairman.
```

## Step 2: Launch all 5 reviewer agents in parallel

Using your platform's subagent-dispatch tool, launch ALL FIVE reviewers simultaneously in a single response (5 parallel dispatch calls). Pass the filtered diff verbatim in each agent's prompt.

Tool name per platform:
- **Claude Code**: `Agent` / `Task`
- **Codex**: `spawn_agent` (requires `multi_agent = true` in `~/.codex/config.toml`)
- **Copilot CLI**: `task` with `agent_type: "general-purpose"`

See `references/platform-tools.md` for the full mapping. On platforms without a named subagent definition system, pass the corresponding `agents/<name>.md` body as the dispatched agent's system prompt.

The 5 reviewer agents:
- **semantic-analyzer**: Logic correctness, control flow bugs, race conditions, null handling
- **security-scanner**: OWASP Top 10, injection flaws, secrets/credentials in code
- **architecture-reviewer**: SOLID violations, tight coupling, design smells, layer violations
- **test-coverage-analyzer**: Missing test cases, untested edge cases, behavioral gaps
- **senior-dev-reviewer**: DRY violations, naming, error handling, conventions, YAGNI

For each agent, construct the prompt as:

```
Review the following git diff. Focus ONLY on your specialized area.
Only report findings with confidence >=80.
Format each finding as: [SEVERITY] file:line — finding — reasoning
SEVERITY levels: CRITICAL (confidence 90-100), HIGH (confidence 80-89)

<diff>
[PASTE FILTERED DIFF HERE]
</diff>
```

Capture each agent's **full raw output verbatim** — do not pre-aggregate or filter.

## Step 3: Chairman/Judge pass

Once all 5 reviewers return, dispatch the `chairman` agent (the Opus judge) using the same platform-specific subagent tool from Step 2. On platforms without named subagent definitions, pass the body of `agents/chairman.md` as the system prompt. Construct its prompt as:

```
<diff>
[PASTE THE SAME FILTERED DIFF HERE]
</diff>

<findings>
[semantic-analyzer]
[paste semantic-analyzer's full raw output]

[security-scanner]
[paste security-scanner's full raw output]

[architecture-reviewer]
[paste architecture-reviewer's full raw output]

[test-coverage-analyzer]
[paste test-coverage-analyzer's full raw output]

[senior-dev-reviewer]
[paste senior-dev-reviewer's full raw output]
</findings>
```

The Chairman dedupes, drops findings without code evidence, resolves contradictions, re-rates severity based on actual blast radius, and writes a top-line verdict. Its output IS the final report — do not modify or re-aggregate it.

## Step 4: Print the Chairman's report

Print the Chairman's output verbatim. It includes Verdict, CRITICAL, HIGH, NOTES, and Summary sections.

## Step 5: Completion signals

After printing the report:

1. **Write the session-scoped completion file**:
   ```bash
   touch "/tmp/claude-code-review-${CLAUDE_SESSION_ID:-unknown}.done"
   ```
   This file is consumed by the **Claude Code Stop hook only** (`hooks/code-review-gate.sh`) as the authoritative signal that the review has run. On Codex and Copilot CLI there is no equivalent gate, so the file is written but has no effect — leave the line as-is; it is harmless on platforms that don't read it. (If `CLAUDE_SESSION_ID` is unavailable in your shell environment, the hook will simply not gate exit — that's acceptable; the literal-marker check is no longer the primary gate.)

2. **Emit the legacy marker** for backward compatibility, on its own line with no surrounding text:

   ```
   <!-- AGENTIC-REVIEW-COMPLETE -->
   ```

That marker is no longer authoritative for the Claude Code Stop hook (the `.done` file is), but it's kept so any external tooling that grepped for it still works.
