---
name: agentic-code-reviewer
description: >
  Use when code has been written or modified to perform deep multi-dimensional review.
  Launches 5 specialized sub-agents in parallel covering logic, security, architecture,
  tests, and senior dev best practices, then a final Synthesizer pass that dedupes,
  re-rates, and writes a verdict. Reports CRITICAL/HIGH/NOTES backed by code evidence.
  Outputs AGENTIC-REVIEW-COMPLETE marker and a session-scoped completion file when done.
---

# Agentic Code Review

You are performing a comprehensive multi-dimensional code review using 5 specialized sub-agents running in parallel, followed by a Synthesizer pass that produces the final report.

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
This review will fan out to 5 parallel reviewers + 1 Synthesizer pass.
Estimated time: 30–90s. Estimated cost: ~$0.08–$0.25.
```

For smaller diffs, print a one-line preview:

```
Reviewing <N> lines across <M> files via 5 reviewers + Synthesizer.
```

## Step 2: Launch all 5 reviewer agents in parallel

**CRITICAL — PARALLEL EXECUTION IS MANDATORY.** The 5 reviewers MUST be dispatched concurrently, not one after another. This is the whole point of the fan-out — running them serially defeats the design, costs the user 3–5× more wall-clock time, and breaks the latency contract advertised in the skill.

### How to dispatch in parallel

On Claude Code: emit **all 5 `Agent` tool calls in a single assistant message turn**. The harness only runs subagents concurrently when their tool-call blocks appear together in the same response. If you send them across multiple turns (one Agent call, wait for result, next Agent call, …) they execute sequentially. That is the failure mode you must avoid.

On Codex: the parallel fan-out uses a **3-step lifecycle** per agent (`spawn_agent` → `wait_agent` → `close_agent`), but only the spawn step must be batched. Emit **all 5 `spawn_agent` calls together in one assistant turn** (they are non-blocking and return agent IDs), then issue **a single `wait_agent` call** to harvest all results, then call `close_agent` once per agent ID to free the slots. Do NOT spawn-then-wait per agent — that runs them sequentially. (Requires `multi_agent = true` in `~/.codex/config.toml`; without it, the spawn/wait/close tools are not available.)

On Copilot CLI: emit **all 5 `task` calls** in the same response.

#### Right vs. wrong (Claude Code)

✅ **RIGHT** — one assistant turn containing 5 Agent tool calls:
```
<assistant turn>
  Agent(subagent_type=semantic-analyzer, prompt=...)
  Agent(subagent_type=security-scanner, prompt=...)
  Agent(subagent_type=architecture-reviewer, prompt=...)
  Agent(subagent_type=test-coverage-analyzer, prompt=...)
  Agent(subagent_type=senior-dev-reviewer, prompt=...)
</assistant turn>
```
The harness runs all 5 in parallel; you receive 5 results in one tool-result batch.

❌ **WRONG** — 5 separate turns:
```
<assistant turn 1> Agent(semantic-analyzer) </assistant turn 1>
<tool result>
<assistant turn 2> Agent(security-scanner) </assistant turn 2>
<tool result>
... etc
```
The harness runs them sequentially. Do NOT do this.

#### Right vs. wrong (Codex)

✅ **RIGHT** — batched spawns, one harvest, then cleanup:
```
<assistant turn 1>
  spawn_agent(agent_type=semantic-analyzer, prompt=...)   → returns id_1
  spawn_agent(agent_type=security-scanner, prompt=...)    → returns id_2
  spawn_agent(agent_type=architecture-reviewer, prompt=...) → returns id_3
  spawn_agent(agent_type=test-coverage-analyzer, prompt=...) → returns id_4
  spawn_agent(agent_type=senior-dev-reviewer, prompt=...)  → returns id_5
</assistant turn 1>

<assistant turn 2>
  wait_agent(ids=[id_1, id_2, id_3, id_4, id_5])  → returns all 5 results
  close_agent(id=id_1)  close_agent(id=id_2)  close_agent(id=id_3)
  close_agent(id=id_4)  close_agent(id=id_5)
</assistant turn 2>
```
All 5 reviewers run concurrently; `wait_agent` blocks until they all finish.

❌ **WRONG** — spawn-and-wait per agent:
```
<assistant turn 1> spawn_agent(semantic-analyzer)  wait_agent(id_1)  close_agent(id_1) </assistant turn 1>
<assistant turn 2> spawn_agent(security-scanner)   wait_agent(id_2)  close_agent(id_2) </assistant turn 2>
... etc
```
Reviewers run one at a time. Do NOT do this — it defeats the entire fan-out.

⚠ **Also wrong** — forgetting `close_agent`. Leaked slots can exhaust Codex's concurrent-agent pool over a long session, causing later spawns to fail. Always close every agent ID you spawned, even on error paths.

### Tool name per platform

| Platform | Dispatch tool(s) | Notes |
|---|---|---|
| Claude Code | `Agent` (a.k.a. `Task`) | Set `subagent_type` to the agent name (e.g. `semantic-analyzer`) |
| Codex | `spawn_agent` → `wait_agent` → `close_agent` | Batch all 5 spawns in one turn, harvest with a single `wait_agent`, then close each agent ID. Requires `multi_agent = true` |
| Copilot CLI | `task` with `agent_type: "general-purpose"` | Pass the agent body as system prompt |

See `references/platform-tools.md` for the full mapping. On platforms without a named subagent definition system, pass the corresponding `agents/<name>.md` body (after the frontmatter) as the dispatched agent's system prompt.

### The 5 reviewer agents

- **semantic-analyzer**: Logic correctness, control flow bugs, race conditions, null handling
- **security-scanner**: OWASP Top 10, injection flaws, secrets/credentials in code
- **architecture-reviewer**: SOLID violations, tight coupling, design smells, layer violations
- **test-coverage-analyzer**: Missing test cases, untested edge cases, behavioral gaps
- **senior-dev-reviewer**: DRY violations, naming, error handling, conventions, YAGNI

### Prompt template (use for ALL 5)

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

Capture each agent's **full raw output verbatim** — do not pre-aggregate or filter between Step 2 and Step 3.

## Step 3: Synthesizer pass (sequential — runs ONLY after all 5 reviewers complete)

This step is intentionally **sequential**: the Synthesizer must wait until ALL 5 reviewer results from Step 2 have returned, because its entire job is to dedupe and reconcile across all five outputs. Dispatching it before the fan-out completes (or in parallel with the reviewers) gives it incomplete input and breaks the judge logic.

Once all 5 reviewers return, dispatch the `synthesizer` agent (the Opus judge) using the same platform-specific subagent tool from Step 2 — this time as a **single** dispatch call, not as part of a parallel batch. On platforms without named subagent definitions, pass the body of `agents/synthesizer.md` as the system prompt. Construct its prompt as:

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

The Synthesizer dedupes, drops findings without code evidence, resolves contradictions, re-rates severity based on actual blast radius, and writes a top-line verdict. Its output IS the final report — do not modify or re-aggregate it.

## Step 4: Print the Synthesizer's report

Print the Synthesizer's output verbatim. It includes Verdict, CRITICAL, HIGH, NOTES, and Summary sections.

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

## Step 5b: Launch review web UI

After writing the `.done` file and emitting the legacy marker:

1. **Serialize the Synthesizer's structured output** (findings list + verdict) as JSON and write to:
   `/tmp/claude-code-review-${CLAUDE_SESSION_ID:-unknown}.json`

   JSON schema:
   ```json
   {
     "verdict": "...",
     "findings": [
       { "id": "f1", "severity": "CRITICAL|HIGH|NOTE",
         "location": "file:line", "file": "hooks/gate.sh", "line": 47,
         "finding": "...", "reasoning": "...",
         "evidence": "...", "dimensions": ["semantic"] }
     ],
     "files": [
       { "path": "hooks/code-review-gate.sh", "diff": "<raw unified diff for this file>" }
     ],
     "summary": "...",
     "timestamp": "ISO8601",
     "branch": "...",
     "sessionId": "..."
   }
   ```
   The `files` array is populated by splitting the full filtered diff by file (each `diff --git a/... b/...` block) so the UI can show per-file diffs in the center panel.

2. **Run the review server.** Resolve the skill root depending on platform:
   - **Claude Code**: `CLAUDE_PLUGIN_ROOT` is set automatically to the plugin's cache directory.
   - **Codex**: `CLAUDE_PLUGIN_ROOT` is not set; use the fixed Codex skill path instead.

   ```bash
   SKILL_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.codex/skills/agentic-code-reviewer}"
   # --platform is optional: the server auto-detects from its install path,
   # but passing it explicitly is more robust (e.g. for symlinked or custom installs).
   PLATFORM_FLAG=""
   if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then PLATFORM_FLAG="--platform claude"
   elif [ -d "$HOME/.codex/skills/agentic-code-reviewer" ]; then PLATFORM_FLAG="--platform codex"
   fi
   node "${SKILL_ROOT}/server/review-server.js" \
     --session "${CLAUDE_SESSION_ID:-unknown}" \
     --findings-file "/tmp/claude-code-review-${CLAUDE_SESSION_ID:-unknown}.json" \
     --save-dir "$(pwd)/docs/code-reviews" \
     $PLATFORM_FLAG
   ```
   The server opens the browser and blocks until the user decides.

3. **After the server exits**, read `/tmp/claude-code-review-${CLAUDE_SESSION_ID:-unknown}.decision` if it exists.
   Decision file schema:
   ```json
   {
     "action": "implement|save|done",
     "selectedIds": ["f1", "f2"],
     "comments": { "f1": "user annotation text", "f2": "" },
     "globalComment": "overall note from user"
   }
   ```
   - If `action === "implement"`: implement each selected finding as a code change. For each finding, the user's comment (if any) and the global comment are passed as context to guide the implementation. Run relevant tests after changes.
   - If `action === "save"` or `"done"`: no further code changes. The markdown file was already written by the server.
