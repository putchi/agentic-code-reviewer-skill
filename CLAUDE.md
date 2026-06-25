# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisites

Install Bun via Homebrew (required — `~/.bun/bin/bun` installed via the official script hangs on `bun install` in this repo):

```bash
brew tap oven-sh/bun
brew install bun
```

After a fresh clone, install all workspace dependencies with `bun install`. Do **not** use `npm install` or `yarn` — the monorepo uses Bun's `workspace:*` protocol which only Bun understands.

Runtime review orchestration also requires `bash`, `python3`, `git`, and the active provider CLI: `claude` with `--print` support on Claude Code, or `codex` on Codex. `/pr-review` additionally requires `gh`.

## Commands

All commands run from the repo root using `/opt/homebrew/bin/bun` (the system Bun; `~/.bun/bin/bun` hangs on install).

```bash
# Run all tests
bun test tests/

# Run unit tests only
bun test tests/unit/

# Run a single test file
bun test tests/unit/decisions.test.ts

# Run parity tests (route-level)
bun test tests/parity/

# Build the React client (required before compile)
bun run build

# Build the distributable self-contained binary
bun run compile          # → dist/review-server

# VS Code extension
bun run build:vscode
bun run dev:vscode
bun run test:vscode
bun run package:vscode

# Start the server in dev mode (watch + hot reload)
bun run dev              # server on :7788, client dev server on :5173
```

The `compile` script (`bun run build && bun build packages/server/src/index.ts --compile --outfile dist/review-server`) embeds the built client HTML into the binary. Run `build` before `compile` whenever client code changes.

`bun build --compile` writes `.bun-build` cache files to the cwd — they are gitignored and safe to delete.

## Architecture

This is a **Bun workspace monorepo** with three packages and a top-level test suite:

```
apps/vscode-extension — VS Code webview extension for opening ACR sessions in editor tabs
packages/shared   — TypeScript types shared between server and client (@acr/shared)
packages/server   — Bun HTTP server (@acr/server), compiled to a self-contained binary
packages/client   — React 19 + Vite + Tailwind 4 SPA (@acr/client), built to a single HTML file
tests/            — Bun test runner (unit + parity), runs against packages/server source directly
```

### Distribution model

The server binary is compiled with `bun build --compile`. The built client HTML (`packages/client/dist/index.html`) is **statically imported** into `packages/server/src/index.ts` at compile time using Bun's `with { type: 'text' }` import attribute. The resulting binary is fully self-contained — no Bun runtime is needed on end-user machines.

### Server (`packages/server/src/`)

`index.ts` is the entry point. It sets up a `Bun.serve` router with an idle-timeout that shuts the process down automatically when unused. Routes:

| Method | Path | Handler |
|--------|------|---------|
| GET | `/` | Serve embedded client HTML |
| GET | `/api/review` | Load review data from `--run-dir` synthesis/context/diff files, with legacy `/tmp/*.json` fallback |
| GET | `/api/version-check` | Compare installed vs. latest GitHub version |
| GET | `/api/settings` | Read persisted UI settings |
| GET | `/api/version` | Read version from `.claude-plugin/plugin.json` |
| GET | `/api/editor-annotations` | Read ephemeral VS Code editor annotations |
| POST | `/api/settings` | Persist settings patch |
| POST | `/api/settings/reset` | Reset persisted user settings to defaults |
| POST | `/api/editor-annotation` | Add an ephemeral VS Code editor annotation |
| DELETE | `/api/editor-annotation?id=...` | Delete an ephemeral VS Code editor annotation |
| POST | `/api/chat/session` | Create a new provider-backed Ask AI streaming session |
| POST | `/api/chat/query` | Send a message to an active chat session |
| POST | `/api/chat/abort` | Abort an in-flight chat stream |
| POST | `/api/implement` | Write implementation decisions, save markdown, touch `.done`, and try auto-resume |
| POST | `/api/save` | Write non-final `decisions.json`, compatibility `/tmp/*.decision`, and markdown review |
| POST | `/api/done` | Write final decisions, touch `.done`, and try auto-resume |

`config.ts` reads CLI args (`--session`, `--run-dir`, `--findings-file`, `--save-dir`, `--port`, `--platform`) and derives all file paths. Current runs prefer `.claude/review-runs/<run-id>/{synthesis.json,context.json,diff.txt,run.json,decisions.json}`. The session-scoped `/tmp/claude-code-review-${sessionId}.{json,decision,done,blocked}` files remain for legacy compatibility and the Stop hook. `/api/save` is intentionally non-final; only `/api/implement` and `/api/done` touch `.done`.

`settings.ts` persists user preferences (`autoCloseMs`, `firstRunDone`, `stopHookMode`) to `~/.claude/agentic-code-reviewer/settings.json` by default and returns read-only runtime metadata (`platform`, `provider`, `providerLabel`, `chatModel`, `chatModelLabel`, `modelRole`) derived from the launch host. `stopHookMode` defaults to `prompt`, including upgraded users with older settings files that do not yet have the key. `ACR_SETTINGS_DIR` and `ACR_SETTINGS_FILE` override the location; legacy plugin-root `settings.json` is migrated on read.

### Client (`packages/client/src/`)

Single-page React app. `main.tsx` → `App.tsx` → three-panel layout:
- **Left panel** — findings list with severity filters (`FilterBar`) and per-finding detail (`LeftPanel/`)
- **Center** — unified/split diff viewer with annotation toolstrip (`DiffViewer/`)
- **Right panel** (collapsible, persisted in localStorage) — chat panel for asking the active AI provider questions about the diff (`RightPanel/`)
- **Action bar** — Implement / Dismiss / Save decisions / Close controls (`ActionBar/`)
- **Modals** — first-run, settings, critical-findings guard (`modals/`)

Vite dev server proxies `/api` to `:7788`. For production the entire SPA is bundled to a single `index.html` by `vite-plugin-singlefile`.

### VS Code extension (`apps/vscode-extension/`)

The optional VS Code extension opens review sessions in editor tabs instead of an external browser. It injects `ACR_BROWSER` and `ACR_VSCODE_PORT` into new integrated terminals, maintains the IPC registry at `~/.claude/agentic-code-reviewer/vscode-ipc.json` by default, proxies local review URLs into webviews, bridges VS Code theme colors, and can create ephemeral editor annotations through the server's `/api/editor-annotation` routes. Build/test/package it through the top-level `build:vscode`, `test:vscode`, and `package:vscode` scripts.

### Shared types (`packages/shared/src/types/`)

Types consumed by both server and client: `Finding`, `FileEntry`, `ReviewData`, `LineAnnotation`, `DecisionPayload`, `ChatSession`. The `buildDecisionPayload` helper (in `payload.ts`) transforms client-side state into the wire format. Import everything via `@acr/shared`.

### Skill / plugin layer

The actual Claude Code skill lives in `skills/agentic-code-reviewer/SKILL.md`. The five reviewer agent prompts and the synthesizer prompt (`synthesizer.md`) are in `agents/`. The slash commands are in `commands/` (`code-review.md`, `pr-review.md`, `review-resume.md`, `review-last.md`). The Stop-hook gate (`hooks/code-review-gate.sh` -> `scripts/review-gate.py`) and update-check hook (`hooks/check-update.sh`) are registered in `hooks/hooks.json` for Claude Code and are loaded user-wide through the enabled plugin in `~/.claude/settings.json`; do not also add a raw user hook unless intentionally migrating away from plugin hooks. Codex Stop-hook support is installed by `install.sh --platform codex`, which merges the same gate command into `~/.codex/hooks.json` and enables `[features] hooks = true` in `~/.codex/config.toml`.

The slash commands are lightweight launchers. `/code-review` is the intended short command for the main review launcher; Claude Code may also display the plugin-qualified `/agentic-code-reviewer:code-review` form. `/code-review` starts `scripts/orchestrator.sh`, which creates `.claude/review-runs/<run-id>/`, starts `scripts/orchestrator.py` with `nohup`, and returns immediately. `/review-last` opens the latest saved review; `agentic-code-reviewer-last` and `agentic-code-reviewer:last` remain as deprecated compatibility aliases only and should not be advertised in user-facing docs. The five reviewers run as separate non-interactive provider processes through `scripts/run-reviewer.sh`; `scripts/run-synthesizer.sh` runs only after all reviewer result files exist and validate. Claude launches use `claude --print --output-format json`; Codex launches use `codex exec --json --sandbox read-only` with model/reasoning mapping from `scripts/acr-runtime.sh`. The Bun server is launched with `--run-dir <path>` and reads `synthesis.json`; decisions are written to `decisions.json`. The `/tmp/claude-code-review-*` files remain only for compatibility. `orchestrator.py` also reads `models.balanced`, `models.fast`, and `models.judge` from `.acr.json` and sets `ACR_MODEL_BALANCED`, `ACR_MODEL_FAST`, and `ACR_MODEL_JUDGE` in `os.environ` before spawning any subprocesses; shell-exported env vars take priority. Values must be full model IDs (not shorthand aliases like `haiku`). `balanced` applies to four of the five reviewer agents and Ask AI chat; `fast` applies to test-coverage-analyzer; `judge` applies to the synthesizer.

Codex discovery relies on the installed skill metadata, not `commands/`. Keep `skills/agentic-code-reviewer/SKILL.md` discoverable for phrases like `run code-review on this repo`, `run the code-reviewer skill`, and `run the agentic-code-reviewer skill`; these are trigger phrases only and do not rename the skill path or package identity. Codex users may need to review/trust the installed Stop hook through `/hooks`.

Host Stop-hook flow: when changed code exists and the session has not been marked reviewed for the current diff, `scripts/review-gate.py` parses the hook JSON, uses `cwd` when present (Codex supplies it), and resolves the Git repo. It reads `.acr.json` from `HEAD` first and then the working tree fallback, so a newly created or gitignored file can take effect without requiring a commit. Boolean `"disableStopHook": true` exits silently before diffing, launching, reusing, or waiting for a review. Otherwise the hook resolves `stopHookMode` from `ACR_STOP_HOOK_MODE`, global user settings, repo `.acr.json`, then the default `prompt`. In `prompt` mode, the hook emits one block with the exact review command and writes a prompt marker; a second Stop with the same diff exits cleanly. In `disabled` mode, it exits silently after the no-diff checks. In `auto` mode, it reuses a matching run or launches `scripts/orchestrator.sh` with `ACR_STATUS_POLL=0`, `ACR_DISABLE_AUTO_RESUME=1`, `ACR_REVIEW_TIMEOUT_SECONDS=120`, `ACR_SYNTHESIS_TIMEOUT_SECONDS=45`, and `ACR_REVIEWER_MAX_RETRIES=0`. The hook default deadline is 180 seconds and the registered hook timeout is 210 seconds. Before using completed review decisions, the hook recomputes the diff hash; if the diff changed, it writes `review-gate-stale.json` and allows Stop without waking the host agent. The `/tmp/claude-code-review-*` sentinel names remain for compatibility on both Claude Code and Codex, but `.done` sentinels are now diff-aware.

For non-hook launches, after UI decisions are saved, `packages/server/src/auto-resume.ts` still tries to resume the active host session: Claude Code via `CLAUDE_SESSION_ID` and `claude --resume`, Codex via `CODEX_THREAD_ID` and `codex exec resume`. `auto-resume.json` records the outcome and a concrete `review-resume.sh --repo <repo> --run-id <run-id>` fallback command; the UI surfaces failures before closing. Manual fallback is `/review-resume <run-id>`. That command reads `synthesis.json` and `decisions.json`, then the host agent implements only findings marked `ask_claude_to_implement` or `accept_fix`, skips `ignore`, answers `ask_claude_to_explain`, and reports `create_follow_up_task` items.

**Run ID / session ID:** `scripts/orchestrator.sh` creates a UTC timestamp + random hex run id and passes it as `--session` to the UI server. Direct legacy server invocations without `--session` still default to `unknown`, so new launch paths should always pass the run id explicitly.

**Plugin root resolution** tries these paths in order: `CLAUDE_PLUGIN_ROOT` env var → current repo root when `.claude-plugin/plugin.json` exists → legacy `~/.claude/plugins/cache/agentic-code-reviewer` → `~/.claude/plugins/marketplaces/agentic-code-reviewer-skill` → `~/.codex/skills/agentic-code-reviewer` → persistent fallback `~/.claude/agentic-code-reviewer`.

**Codex repo instructions:** Codex's equivalent to `CLAUDE.md` is `AGENTS.md`. This repo keeps detailed maintenance guidance in `CLAUDE.md`; `AGENTS.md` should remain a small Codex entry point that tells Codex to follow `CLAUDE.md` to avoid drifting duplicate docs.

### Release

CI (`release.yml`) triggers on `v*` tags. It builds three platform binaries (macOS arm64, macOS x64, Linux x64) and attaches them to the GitHub release.

#### When to tag a new release

A new review-server binary is only needed when `packages/server/` or `packages/client/` code changes, because the binary embeds the compiled client HTML. Changes to `install.sh`, `scripts/`, `skills/`, `agents/`, `hooks/`, `references/`, or `.claude-plugin/` do **not** require a review-server rebuild — `install.sh` copies the full repo tree and users get those changes from `main` immediately. Changes under `apps/vscode-extension/` require the VS Code extension build/package flow, not a review-server binary rebuild.

#### Version bump checklist

Every version bump must update **all three** of these files — they must always match:

1. `.claude-plugin/plugin.json` — the `"version"` field
2. `.claude-plugin/marketplace.json` — the `"version"` field inside `plugins[0]`
3. `apps/vscode-extension/package.json` — the `"version"` field

Forgetting `marketplace.json` means the update-check toast will never show (it compares installed version against `marketplace.json`), and Claude Code will keep creating a stale versioned cache directory named after the old version. Forgetting `apps/vscode-extension/package.json` means `vsce publish` will fail in CI because that version is already live on the VS Code Marketplace.

#### plugin.json schema rules

The `plugin.json` manifest must **not** include a `commands` field. Claude Code discovers commands automatically from the `commands/` directory. Adding `"commands": "commands/"` (or any value) causes a schema validation error on `/reload-plugins`:

```
Validation errors: commands: Invalid input
```

Valid manifest fields: `name`, `description`, `version`, `author`, `repository`, `homepage`, `keywords`. Nothing else.

#### Release steps

```bash
# 1. Bump version in all three version files
# 2. Commit
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json apps/vscode-extension/package.json
git commit -m "Bump version to X.Y.Z"

# 3. Push commits
git push origin main

# 4. Tag and push (triggers CI)
git tag vX.Y.Z
git push origin vX.Y.Z

# 5. Verify CI and release assets
gh run list --limit 5
gh release view vX.Y.Z   # confirm all 3 binaries attached
```

After every `git push`, delete any `.bun-build` cache files left in the repo root:

```bash
find . -maxdepth 1 -type f -name '*.bun-build' -exec rm -f {} +
```

These are content-addressed Bun compile artifacts that accumulate locally and are not useful after the push is done. They are gitignored but clutter the working directory.

## Playwright / Browser Debugging

When using the Playwright MCP for UI debugging or visual verification, screenshots are saved to `.playwright-screenshots/` (gitignored). This is configured via `.mcp.json` in the project root using `--output-dir .playwright-screenshots`.

Never pass explicit root-relative filenames like `screenshot.png` to `browser_take_screenshot` — omit the `filename` parameter and let the output dir handle it.
