# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root using `/opt/homebrew/bin/bun` (the system Bun; `~/.bun/bin/bun` hangs on install).

```bash
# Install workspace dependencies
bun install

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

# Start the server in dev mode (watch + hot reload)
bun run dev              # server on :7788, client dev server on :5173
```

The `compile` script (`bun run build && bun build packages/server/src/index.ts --compile --outfile dist/review-server`) embeds the built client HTML into the binary. Run `build` before `compile` whenever client code changes.

`bun build --compile` writes `.bun-build` cache files to the cwd — they are gitignored and safe to delete.

## Architecture

This is a **Bun workspace monorepo** with three packages and a top-level test suite:

```
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
| GET | `/api/review` | Load findings from the session JSON file |
| GET | `/api/version-check` | Compare installed vs. latest GitHub version |
| GET | `/api/settings` | Read `settings.json` from plugin root |
| GET | `/api/version` | Read version from `.claude-plugin/plugin.json` |
| POST | `/api/settings` | Persist settings patch |
| POST | `/api/chat/session` | Create a new Claude SDK streaming session |
| POST | `/api/chat/query` | Send a message to an active chat session |
| POST | `/api/chat/abort` | Abort an in-flight chat stream |
| POST | `/api/implement` | Write `implement` decision to `/tmp/*.decision` |
| POST | `/api/save` | Write markdown review to `docs/code-reviews/` |
| POST | `/api/done` | Write `done` decision and touch the `.done` sentinel |

`config.ts` reads CLI args (`--session`, `--findings-file`, `--save-dir`, `--port`) and derives all file paths. The session-scoped tmp files are `/tmp/claude-code-review-${sessionId}.{json,decision,done,blocked}`.

`settings.ts` persists user preferences (`autoCloseMs`, `chatModel`, `firstRunDone`) to `settings.json` in the plugin root directory.

### Client (`packages/client/src/`)

Single-page React app. `main.tsx` → `App.tsx` → three-panel layout:
- **Left panel** — findings list with severity filters (`FilterBar`) and per-finding detail (`LeftPanel/`)
- **Center** — unified/split diff viewer with annotation toolstrip (`DiffViewer/`)
- **Right panel** (collapsible, persisted in localStorage) — chat panel for asking Claude questions about the diff (`RightPanel/`)
- **Action bar** — Implement / Save / Done buttons (`ActionBar/`)
- **Modals** — first-run, settings, critical-findings guard (`modals/`)

Vite dev server proxies `/api` to `:7788`. For production the entire SPA is bundled to a single `index.html` by `vite-plugin-singlefile`.

### Shared types (`packages/shared/src/types/`)

Types consumed by both server and client: `Finding`, `ReviewData`, `ChatSession`, `Decision`, `Payload`. Import via `@acr/shared`.

### Skill / plugin layer

The actual Claude Code skill lives in `skills/agentic-code-reviewer/SKILL.md`. The five reviewer agent prompts are in `agents/`. The slash commands are in `commands/`. The Stop-hook gate (`hooks/code-review-gate.sh`) and update-check hook (`hooks/check-update.sh`) are registered in `hooks/hooks.json`.

The server is **not** started by the skill; the skill invokes the compiled binary (or `node server/review-server.js` for the legacy path) after writing the findings JSON to `/tmp/`.

### Release

CI (`release.yml`) triggers on `v*` tags. It builds three platform binaries (macOS arm64, macOS x64, Linux x64) and attaches them to the GitHub release. To publish: push a version tag (`git tag v1.x.x && git push origin v1.x.x`). Update `version` in `.claude-plugin/plugin.json` before tagging.

After every `git push`, delete any `.bun-build` cache files left in the repo root:

```bash
rm -f *.bun-build
```

These are content-addressed Bun compile artifacts that accumulate locally and are not useful after the push is done. They are gitignored but clutter the working directory.
