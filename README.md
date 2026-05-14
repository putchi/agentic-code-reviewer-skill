# Agentic Code Reviewer

A portable skill that runs 5 specialized review agents in parallel over your git diff, then an Opus Chairman pass that dedupes findings, re-rates them by evidence, and writes a verdict. Works on **Claude Code**, **Codex**, and **Copilot CLI**.

## What it does

Five specialist reviewers — semantic, security, architecture, test-coverage, senior-dev — each look at the same `git diff` from their own angle and report only high-confidence findings (≥80). A final Chairman/Judge pass on Opus takes all five raw outputs, drops anything that can't cite concrete code, merges duplicates, resolves contradictions, re-rates severity by actual blast radius, and writes a 2-sentence top-line verdict.

On Claude Code there's an extra layer: a Stop hook that blocks the session from ending until the review has actually run (with a one-time escape hatch). On Codex and Copilot CLI you invoke the skill manually — see [Claude Code exclusive: session-exit gate](#claude-code-exclusive-session-exit-gate) below.

## The review council

| Agent | Focus | Model |
|---|---|---|
| `semantic-analyzer` | Logic correctness, control flow, null handling, off-by-one, race conditions | Opus |
| `security-scanner` | OWASP Top 10, injection, secrets in code, auth/authorization gaps | Sonnet |
| `architecture-reviewer` | Module boundaries, system-level SOLID, missing abstractions, YAGNI | Opus |
| `test-coverage-analyzer` | Behavioral test gaps, missing edge cases, untested error paths | Sonnet |
| `senior-dev-reviewer` | Local DRY, naming, error handling, project conventions, dead code | Opus |
| `chairman` (judge) | Dedupe, drop no-evidence findings, resolve contradictions, re-rate severity, write verdict | Opus |

## How it works

1. **Pre-flight.** Guard for being inside a git repo. Run `git diff --text HEAD` (then plain `git diff` as fallback) and filter out lockfiles, minified assets, images, and build directories. If the filtered diff is empty, exit cleanly with `No reviewable changes`. If the diff exceeds 2000 lines or 50 files, print a cost/time warning.
2. **Fan out.** Dispatch all 5 reviewer agents in parallel using your platform's subagent tool (see the [platform matrix](#platform-support-matrix)). Each agent gets the same filtered diff and a strict prompt: report only findings with confidence ≥80, formatted as `[SEVERITY] file:line — finding — reasoning`.
3. **Chairman pass.** Send the diff + all 5 raw outputs to the `chairman` agent. It applies judge rules (evidence required, semantic dedupe, contradiction resolution, severity re-rated by blast radius, drop speculation) and emits the final report.
4. **Print verdict.** The Chairman's output is the final report — Verdict / CRITICAL / HIGH / NOTES / Summary. No further aggregation.
5. **Completion signal.** Touch `/tmp/claude-code-review-${SESSION_ID}.done` and emit `<!-- AGENTIC-REVIEW-COMPLETE -->`. On Claude Code these unblock the Stop hook; on other platforms they are harmless no-ops.

## Platform support matrix

| Feature | Claude Code | Codex | Copilot CLI |
|---|---|---|---|
| Parallel subagent fan-out | ✅ | ✅ (requires `multi_agent = true`) | ✅ |
| Skill invocation | `/agentic-code-reviewer` + auto-trigger | skills load natively | `skill` tool |
| Session-exit auto-gate | ✅ | ❌ | ❌ |
| Subagent dispatch tool | `Agent` / `Task` | `spawn_agent` | `task agent_type: general-purpose` |

Full tool-name mapping is in [`references/platform-tools.md`](references/platform-tools.md).

## Installation

### Claude Code (primary)

**Option A — install from the published repo (recommended):**

The repo is a self-hosting marketplace, so register it first, then install the plugin from it:

```
/plugin marketplace add putchi/agentic-code-reviewer-skill
/plugin install agentic-code-reviewer@agentic-code-reviewer-skill
```

**Option B — local clone** (for local development):

```
git clone git@github.com-secondary:putchi/agentic-code-reviewer-skill.git ~/.claude/plugins/agentic-code-reviewer
```

Verify with `/plugin` and confirm `agentic-code-reviewer` is listed.

Required tools: `git`, `python3` (used by the Stop hook to parse hook JSON), `bash`.

### Codex (CLI + App)

1. Enable multi-agent support — add this to `~/.codex/config.toml`:

   ```toml
   [features]
   multi_agent = true
   ```

   Without this, parallel subagent dispatch will fail.

2. Manual install (until the plugin is published to the Codex marketplace): clone the repo and copy `skills/agentic-code-reviewer/`, `agents/`, and `references/` into your Codex skills directory.

   ```
   git clone git@github.com-secondary:putchi/agentic-code-reviewer-skill.git
   ```

### Copilot CLI

Manual install (until the plugin is published to the Copilot marketplace): clone the repo and copy `skills/agentic-code-reviewer/`, `agents/`, and `references/` into your Copilot CLI skills directory.

```
git clone git@github.com-secondary:putchi/agentic-code-reviewer-skill.git
```

## Usage

- **Claude Code**: run `/agentic-code-reviewer`, or let the Stop-hook gate prompt the agent to run it for you when you try to end a session with unreviewed changes.
- **Codex**: skills load natively — tell the agent `run the agentic-code-reviewer skill`.
- **Copilot CLI**: invoke the skill via the `skill` tool: `skill agentic-code-reviewer`.

On every platform, empty diffs exit cleanly (`No reviewable changes — nothing to review.`) and diffs above 2000 lines / 50 files print a cost and timing warning before fanning out.

## Output format

The Chairman emits a fixed structure. Severity buckets stay in the report even if empty (they read `_None._`).

```
## Code Review Results

### Verdict
[Two sentences. First: ship-readiness assessment. Second: the single most important issue.]

### CRITICAL
- [CRITICAL] file:line — finding — reasoning — EVIDENCE: `<code excerpt>` (dim: semantic, security, ...)

### HIGH
- [HIGH] file:line — finding — reasoning — EVIDENCE: `<code excerpt>` (dim: architecture, ...)

### NOTES
- [NOTE] file:line — finding — reasoning — EVIDENCE: `<code excerpt>` (dim: senior-dev)

### Summary
- X critical, Y high, Z notes retained; W findings dropped (D no-evidence, M merged, C contradictions resolved).
```

## Claude Code exclusive: session-exit gate

This part runs only on Claude Code; it has no Codex or Copilot CLI equivalent.

The Stop hook (`hooks/code-review-gate.sh`) does the following on every Stop event:

- Runs `git diff HEAD` (then `git diff`) to see if any code was changed this session.
- If there are changes **and** `/tmp/claude-code-review-${SESSION_ID}.done` is missing, returns `{"decision":"block"}` with a system message instructing the model to run the skill. It also touches `/tmp/claude-code-review-${SESSION_ID}.blocked`.
- The blocked sentinel is the **one-time escape hatch**: if it already exists, the next Stop is allowed through. You are never held hostage — you can always end the session by trying twice.
- Stale `.done` and `.blocked` sentinels older than 1 day are auto-cleaned on every invocation.
- Backward-compat fallback: if for some reason the `.done` file can't be written, the hook still honors a transcript grep for `AGENTIC-REVIEW-COMPLETE`.

On Codex and Copilot CLI you are responsible for invoking the skill before ending the session.

## What it does NOT do

- Does not auto-fix code — it only reports findings.
- Does not block commits or pushes — only gates the Stop event in the current Claude Code session.
- Does not review binary, lockfile, or build-artifact diffs (filtered out before fan-out).
- Does not report findings below 80% confidence.

## Costs and timing

For a large diff (>2000 lines or >50 files) the run fans out to 5 reviewers + 1 Chairman pass and takes roughly **30–90 seconds** at an estimated **~$0.30–$0.80**. Smaller diffs are proportionally cheaper. The Chairman runs on Opus; the reviewers are a mix of Opus and Sonnet (see [the review council](#the-review-council)).

## Project layout

```
.
├── .claude-plugin/plugin.json     # Claude Code manifest
├── agents/                        # 5 reviewers + chairman (prompts are portable)
│   ├── semantic-analyzer.md
│   ├── security-scanner.md
│   ├── architecture-reviewer.md
│   ├── test-coverage-analyzer.md
│   ├── senior-dev-reviewer.md
│   └── chairman.md
├── commands/agentic-code-reviewer.md   # Claude Code slash command
├── hooks/                              # Claude Code exclusive (Stop-event gate)
│   ├── hooks.json
│   └── code-review-gate.sh
├── references/
│   └── platform-tools.md          # Claude Code / Codex / Copilot CLI mapping
└── skills/agentic-code-reviewer/SKILL.md
```

## License

MIT — see [LICENSE](LICENSE).
