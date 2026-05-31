# Agentic Code Reviewer

A portable skill that launches a background code-review run for your git diff. It starts 5 specialized reviewer processes in parallel, runs a Synthesizer pass after they finish, and opens a local web UI where you can triage findings, annotate code, save decisions, and resume the agent with deterministic follow-up instructions.

## What it does

Five specialist reviewers — semantic, security, architecture, test-coverage, senior-dev — each inspect the same filtered diff from their own angle and return structured JSON findings with confidence >=80. The Synthesizer reads the diff plus all reviewer result files, drops weak or duplicate findings, resolves contradictions, re-rates severity by actual blast radius, and writes a 2-sentence top-line verdict to `synthesis.json`.

The current runtime is process-based: `/code-review` starts `scripts/orchestrator.sh`, which creates `.claude/review-runs/<run-id>/`, launches `scripts/orchestrator.py` with `nohup`, and returns after printing status. Claude Code named subagents and Codex `spawn_agent` are not used as the execution primitive.

On Claude Code there is an extra layer: a Stop hook that blocks the session from ending until a review run has actually reached a completed/UI-ready state, with a one-time escape hatch. On Codex you invoke the skill manually; review subprocesses run through `codex exec`.

## The review council

| Agent | Focus | Model hint |
|---|---|---|
| `semantic-analyzer` | Logic correctness, control flow, null handling, off-by-one, race conditions | Sonnet |
| `security-scanner` | OWASP Top 10, injection, secrets in code, auth/authorization gaps | Sonnet |
| `architecture-reviewer` | Module boundaries, system-level SOLID, missing abstractions, YAGNI | Sonnet |
| `test-coverage-analyzer` | Behavioral test gaps, missing edge cases, untested error paths | Haiku |
| `senior-dev-reviewer` | Local DRY, naming, error handling, project conventions, dead code | Sonnet |
| `synthesizer` (judge) | Dedupe, drop no-evidence findings, resolve contradictions, re-rate severity, write verdict | Opus |

The launcher resolves the active provider from `ACR_PLATFORM`, `--platform`, host session environment, and install path. Claude launches use `claude`; Codex launches use `codex exec`. Defaults are Sonnet / Haiku / Opus on Claude and `gpt-5.4` / `gpt-5.4-mini` / `gpt-5.5` on Codex.

Advanced overrides:

- `ACR_REVIEW_PROVIDER=claude|codex`
- `ACR_CLAUDE_BIN=/path/to/claude`
- `ACR_CODEX_BIN=/path/to/codex`
- `ACR_MODEL_BALANCED`, `ACR_MODEL_FAST`, `ACR_MODEL_JUDGE`
- `ACR_CODEX_REASONING_BALANCED`, `ACR_CODEX_REASONING_FAST`, `ACR_CODEX_REASONING_JUDGE`

## How it works

1. **Launch.** `/code-review` runs `scripts/orchestrator.sh --repo "$(pwd)"`. `/pr-review <number|URL>` adds `--pr "$ARGUMENTS"` and requires `gh`.
2. **Snapshot.** The orchestrator validates required tools, creates `.claude/review-runs/<run-id>/`, captures `git diff --text HEAD` with excludes for lockfiles, minified assets, images, archives, and build directories, then writes `diff.txt` and `context.json`. PR mode uses `gh pr view` and `gh pr diff`.
3. **Fan out.** `scripts/orchestrator.py` starts 5 subprocesses through `scripts/run-reviewer.sh`. Each subprocess uses the resolved provider command against the same `diff.txt` and writes `agents/<reviewer>.json`.
4. **Synthesize.** `scripts/run-synthesizer.sh` runs after all reviewer files are present. It writes `synthesis.json`; if synthesis fails, `scripts/claude_json.py synthesis-fallback` aggregates raw reviewer findings into a fallback result.
5. **Open UI.** The compiled `dist/review-server` binary opens the browser with `--run-dir <path>`. It reads `synthesis.json`, `context.json`, `diff.txt`, and raw reviewer files. A Node wrapper at `server/review-server.js` falls back to Bun source in development.
6. **Decide and resume.** The UI writes `decisions.json` in the run directory and a compatibility `/tmp/claude-code-review-${run-id}.decision` file. `/review-resume <run-id>` reads `synthesis.json` and `decisions.json`, then prints exact implementation instructions for the agent.

## Platform support matrix

| Feature | Claude Code | Codex | Copilot CLI |
|---|---|---|---|
| Background process fan-out | ✅ via `claude` | ✅ via `codex exec` | ⚠ manual/untested |
| Skill invocation | `/code-review` + Stop-hook prompt | skills load natively | manual copy/untested |
| Session-exit auto-gate | ✅ | ❌ | ❌ |
| Interactive review web UI | ✅ | ✅ | ⚠ untested |
| Auto-resume after UI decisions | ✅ via `CLAUDE_SESSION_ID` | ✅ via `CODEX_THREAD_ID` when available | ❌ |

Runtime notes for non-Claude hosts are in [`references/platform-tools.md`](references/platform-tools.md).

## Installation

### Claude Code (primary)

**Option A — one-line install (recommended):**

```bash
curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash
```

Or with an explicit platform flag to skip the prompt:

```bash
curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash -s -- --platform claude
```

**Option B — local clone** (for local development):

```
git clone git@github.com-secondary:putchi/agentic-code-reviewer-skill.git
cd agentic-code-reviewer-skill
./install.sh --platform claude
```

Verify with `/plugin` and confirm `agentic-code-reviewer` is listed.

Required tools: `git`, `python3`, `bash`, and the `claude` CLI with `--print` support. PR review mode also requires `gh`. No runtime is required for the review UI when the release binary is available; the installer downloads or copies the self-contained `dist/review-server` binary.

### Codex (CLI + App)

**Option A — one-line install (recommended):**

```bash
curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash -s -- --platform codex
```

Or install for both Claude Code and Codex at once:

```bash
curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash -s -- --platform both
```

**Upgrading an existing install:** when the skill is already installed, the installer asks before overwriting. To skip the prompt and force-overwrite both platforms in place, add `--force` (alias: `-y` or `--yes`):

```bash
curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash -s -- --platform both --force
```

`--force` also removes any legacy manual install at `~/.claude/plugins/agentic-code-reviewer/` without asking. If you pass `--force` without `--platform` and Codex is detected, the installer auto-picks `both`.

**Option B — from a local clone:**

```bash
git clone git@github.com-secondary:putchi/agentic-code-reviewer-skill.git
cd agentic-code-reviewer-skill
./install.sh --platform codex
```

Codex does **not** need `multi_agent = true` for this skill. The installed Codex skill launches the same local orchestrator, and the orchestrator handles reviewer parallelism with Codex subprocesses. Required tools: `git`, `python3`, `bash`, and the `codex` CLI. PR review mode also requires `gh`.

### Copilot CLI

The `install.sh` does not have a Copilot CLI path. Manual install is untested: clone the repo and symlink or copy the directories your Copilot CLI skills loader expects (`skills/agentic-code-reviewer/`, `agents/`, `references/`, `packages/server/`, `server/`, `scripts/`, `dist/`).

```bash
git clone https://github.com/putchi/agentic-code-reviewer-skill.git
```

> ⚠ Copilot CLI support is untested. The review UI ships as a self-contained binary when a release asset is available.

## Usage

- **Claude Code**: run `/code-review` for the current branch diff, or `/pr-review <number|URL>` to review a specific GitHub PR. The Stop-hook gate will also prompt the agent to run `/code-review` when you try to end a session with unreviewed changes.
- **Codex**: skills load natively — tell the agent `run code-review on this repo`, `run the code-reviewer skill`, or `run the agentic-code-reviewer skill`. The skill is installed under `~/.codex/skills/agentic-code-reviewer` and shells out to `codex exec` for reviewer subprocesses.
- **Copilot CLI**: invoke the skill via the `skill` tool: `skill agentic-code-reviewer`.

Empty diffs exit cleanly by writing a no-findings `synthesis.json` and setting the run status to `no_changes`.

## Run artifacts

Every run is stored under `.claude/review-runs/<run-id>/`:

```text
run.json                 # status, repo, run id, UI pid, resume command
context.json             # repo, branch/PR metadata, timestamp, changed files
diff.txt                 # filtered diff reviewed by every subprocess
orchestrator.log         # background orchestration log
READY                    # present when the UI/no-change result is ready
ui.pid                   # review-server process id when the UI starts
ui.log                   # review-server output
prompts/*.prompt.md      # exact reviewer/synthesizer prompts
agents/*.json            # one normalized reviewer result per reviewer
agents/*.raw.json        # raw provider output
synthesis.json           # final verdict, deduped findings, drops, rationale
decisions.json           # UI decisions, comments, and line annotations
auto-resume.json         # auto-resume attempt result, when applicable
```

Reviewer JSON files have `status: "complete"` or `status: "failed"` and always include a `findings` array. Synthesis findings are grouped by the UI into CRITICAL, HIGH, and NOTE severities.

## Interactive review UI

After synthesis, the skill launches a self-contained binary (`dist/review-server`) that opens the browser. No external runtime is required when the binary is present — the entire React app is embedded in the executable.

### Layout

**Header** — shows branch name, timestamp/status, run id, and the Synthesizer verdict. The **≡** button opens Settings.

**Filter bar** — one-click severity filters: All / CRITICAL / HIGH / NOTE with per-severity counts.

**Left panel** — two tabs:
- *Findings* — all findings with severity badges and decision controls. Use `j`/`k` to navigate, `Space` to mark the active finding for implementation, `Enter` to jump to the diff.
- *Files* — affected files with per-file finding counts.

**Diff viewer (center)** — unified or split diff view. Annotation toolstrip:
- *Select* — drag to select a range of lines
- *Pinpoint* — click a single line to target it
- *Markup* — highlight selected lines
- *Comment* — select then immediately add a comment
- *Redline* — mark selected lines for deletion
- *Label* — apply a quick severity label to selected lines

**Right panel (collapsible)** — two tabs:
- *Comments* — per-finding comment fields for decided findings, saved line annotations, and a Global Notes field. Everything here is included in `decisions.json`.
- *Ask AI* — chat with the active host AI about the diff. Settings show the resolved provider and model. Annotation toolstrip has a quick-link to pre-fill the chat with context about the selected line.

**Action bar** — bottom bar with:
- *All / None* — bulk mark findings for implementation
- *Implement* — save decisions, close the tab, and try to resume the active Claude/Codex session
- *Dismiss* — mark selected findings, or all findings when none are selected, as ignored with an optional reason
- *Save decisions* — write `decisions.json` and a markdown review record to `docs/code-reviews/`
- *Close* — save final decisions and close. If there are undecided CRITICAL findings, a guard modal asks for confirmation first.

**Settings pane** (≡ menu) — active AI runtime display, auto-close delay, and version display. Settings persist in `~/.claude/agentic-code-reviewer/settings.json` by default; `ACR_SETTINGS_DIR` and `ACR_SETTINGS_FILE` override the location.

**First-run modal** — shown on first launch to confirm the detected AI runtime and auto-close preference.

**Session status polling** — after launch, the command prints a compact status line every 20 seconds until the review UI is ready. Set `ACR_STATUS_POLL=0` to disable polling, or `ACR_STATUS_INTERVAL_SECONDS=30` to slow it down.

**Update toast** — shown when a newer version is available, with a one-click copy of the install command.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous finding |
| `Space` | Mark / unmark selected finding for implementation |
| `Enter` | Jump to finding's diff |
| `Escape` | Close modal or menu |

## Claude Code exclusive: session-exit gate

This part runs only on Claude Code; it has no Codex or Copilot CLI equivalent.

The Stop hook (`hooks/code-review-gate.sh`) does the following on every Stop event:

- Runs `git diff HEAD` (then `git diff`) to see if any code was changed this session.
- If there are changes and no completion signal is present, returns `{"decision":"block"}` with a system message instructing the model to run the skill. It also touches `/tmp/claude-code-review-${SESSION_ID}.blocked`.
- Completion is satisfied by either `/tmp/claude-code-review-${SESSION_ID}.done` or the newest repo-local `.claude/review-runs/*/run.json` reaching `awaiting_decisions`, `decisions_ready`, `no_changes`, `synthesis_complete`, or `synthesis_failed`.
- The blocked sentinel is the **one-time escape hatch**: if it already exists, the next Stop is allowed through. You are never held hostage — you can always end the session by trying twice.
- Stale `.done` and `.blocked` sentinels older than 1 day are auto-cleaned on every invocation.
- Backward-compat fallback: the hook still honors a transcript grep for `AGENTIC-REVIEW-COMPLETE`.

On Codex and Copilot CLI you are responsible for invoking the skill before ending the session.

## What it does NOT do

- Does not auto-fix code unless you explicitly choose **Implement** or mark findings with `accept_fix` / `ask_claude_to_implement`.
- Does not block commits or pushes — only gates the Stop event in the current Claude Code session.
- Does not review binary, lockfile, or build-artifact diffs (filtered out before fan-out).
- Does not report findings below 80% confidence.

## Costs and timing

The run starts 5 reviewer subprocesses plus 1 Synthesizer subprocess. In practice, small and medium diffs usually complete in tens of seconds, while large diffs depend on provider CLI latency and the configured model. Reviewer timeout defaults to 900 seconds (`ACR_REVIEW_TIMEOUT_SECONDS`); synthesis timeout defaults to 600 seconds (`ACR_SYNTHESIS_TIMEOUT_SECONDS`).

## Screenshots

### Full review UI
![Full review UI — three-panel layout with findings list, diff viewer, and comments panel](docs/screenshots/review-ui.png)

### Annotation toolstrip and diff viewer
![Diff viewer with annotation toolstrip showing Select, Pinpoint, Markup, Comment, Redline, and Label modes](docs/screenshots/annotation.png)

### Ask AI chat panel
![Ask AI tab in the right panel with a chat input ready to query the active AI provider about the diff](docs/screenshots/chat-panel.png)

## Project layout

```
.
├── .claude-plugin/plugin.json          # Claude Code plugin manifest
├── AGENTS.md                           # Codex project instructions; points Codex at CLAUDE.md
├── CLAUDE.md                           # Claude Code / repo maintenance guide
├── agents/                             # 5 reviewers + synthesizer (prompts are portable)
│   ├── semantic-analyzer.md
│   ├── security-scanner.md
│   ├── architecture-reviewer.md
│   ├── test-coverage-analyzer.md
│   ├── senior-dev-reviewer.md
│   └── synthesizer.md
├── commands/code-review.md             # Claude Code slash command
├── commands/pr-review.md               # /pr-review <number|URL> command
├── docs/
│   ├── code-reviews/                   # Saved markdown reviews (git-ignored)
│   └── screenshots/                    # UI screenshots for README
├── hooks/                              # Claude Code exclusive (Stop-event gate)
│   ├── hooks.json
│   ├── code-review-gate.sh
│   └── check-update.sh
├── packages/
│   ├── shared/                         # @acr/shared — TypeScript types (Finding, Decision, Payload, etc.)
│   ├── server/                         # @acr/server — Bun HTTP server, compiled to self-contained binary
│   └── client/                         # @acr/client — React 19 + Vite + Tailwind 4 SPA, built to single HTML
├── references/
│   └── platform-tools.md              # Runtime notes for non-Claude hosts
├── scripts/
│   ├── orchestrator.sh/.py            # launch wrapper + background orchestrator
│   ├── run-reviewer.sh                # one provider subprocess per reviewer
│   ├── run-synthesizer.sh             # provider synthesis subprocess
│   ├── review-resume.sh/.py           # reads decisions and prints follow-up instructions
│   └── capture-screenshots.js         # Playwright screenshot capture for docs
├── skills/agentic-code-reviewer/SKILL.md
├── tests/                             # Bun test runner — unit + parity tests
└── install.sh                          # Installer for Claude Code plugin + Codex skill
```

The server binary is compiled with `bun build --compile`. The built client HTML is statically imported at compile time — the resulting binary is fully self-contained with no runtime dependency on the end-user machine.

## License

MIT — see [LICENSE](LICENSE).
