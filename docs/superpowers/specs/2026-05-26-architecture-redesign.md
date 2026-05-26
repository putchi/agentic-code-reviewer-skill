# Spec: Restructure agentic-code-reviewer-skill to Web App Architecture

**Date:** 2026-05-26  
**Status:** Approved

---

## Context

The skill's current `server/review-server.js` is a 1960-line monolith that embeds the entire UI (HTML, CSS, JavaScript) as string literals inside a Node.js HTTP server. This is the anti-pattern Web App solves: a proper separation between frontend (React + Vite build → `dist/index.html`) and a thin HTTP server that just reads and serves that file.

The goal is to adopt Web App's architecture exactly — same folder structure, same build pipeline, same serving model — while keeping every existing capability intact: routes, decision files, SSE chat streaming, annotation toolstrip, diff viewer, 30-min idle timeout, Stop hook integration.

---

## New Directory Structure

```
agentic-code-reviewer-skill/
│
├── [UNCHANGED] agents/, commands/, hooks/, references/, skills/, .claude-plugin/
│
├── package.json                   ← root: Bun workspaces, build/dev/test scripts
│
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   └── src/types/
│   │       ├── findings.ts        ← Finding, FileEntry, ReviewData
│   │       ├── decisions.ts       ← LineAnnotation, DecisionPayload
│   │       └── chat.ts            ← ChatSession, SSEEvent
│   │
│   ├── client/
│   │   ├── package.json           ← React 19, Vite 6, Tailwind 4, vite-plugin-singlefile, @fortawesome
│   │   ├── vite.config.ts         ← singlefile plugin, Tailwind, API proxy :5173→:7788
│   │   ├── index.html             ← Vite entry (thin shell)
│   │   ├── dist/
│   │   │   └── index.html         ← BUILD OUTPUT (committed to git, ~500KB)
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx            ← global state, keydown handlers, layout
│   │       ├── globals.css        ← Catppuccin Mocha CSS variables + base styles
│   │       ├── components/
│   │       │   ├── Header.tsx
│   │       │   ├── FilterBar.tsx
│   │       │   ├── ActionBar.tsx
│   │       │   ├── LeftPanel/
│   │       │   │   ├── index.tsx
│   │       │   │   ├── FindingsList.tsx
│   │       │   │   └── FilesList.tsx
│   │       │   ├── DiffViewer/
│   │       │   │   ├── index.tsx
│   │       │   │   ├── DiffTable.tsx
│   │       │   │   ├── AnnotationToolstrip.tsx
│   │       │   │   ├── MiniToolbar.tsx
│   │       │   │   ├── CommentPopover.tsx
│   │       │   │   └── QuickLabelPicker.tsx
│   │       │   ├── RightPanel/
│   │       │   │   ├── index.tsx
│   │       │   │   ├── CommentsPanel.tsx
│   │       │   │   └── ChatPanel.tsx
│   │       │   └── modals/
│   │       │       ├── HelpModal.tsx
│   │       │       ├── SettingsPopover.tsx
│   │       │       └── UpdateToast.tsx
│   │       └── hooks/
│   │           ├── useReviewData.ts
│   │           ├── useAnnotations.ts
│   │           ├── useChat.ts
│   │           └── useLocalStorage.ts
│   │
│   └── server/
│       ├── package.json
│       └── src/
│           ├── index.ts           ← CLI args, Bun.serve(), browser open, idle timer
│           ├── serve-client.ts    ← reads dist/index.html, serves GET /
│           ├── browser.ts         ← cross-platform browser launch (darwin/win32/linux)
│           ├── timeout.ts         ← 30-min idle timer
│           └── routes/
│               ├── review.ts      ← GET /api/review
│               ├── chat.ts        ← POST /api/chat/session, /query (SSE), /abort
│               ├── decisions.ts   ← POST /api/implement, /save, /done
│               └── version.ts     ← GET /api/version-check
│
├── server/
│   └── index.js                   ← SHIM: delegates to packages/server/src/index.ts
│                                     (keeps path that install.sh + SKILL.md reference)
│
├── tests/
│   ├── unit/
│   │   ├── routes.test.ts
│   │   ├── decisions.test.ts
│   │   └── chat.test.ts
│   ├── parity/
│   │   └── route-parity.test.ts
│   ├── manual/
│   │   ├── test-review-ui.sh
│   │   ├── test-chat.sh
│   │   └── test-decision.sh
│   └── fixtures/
│       ├── sample-review.json
│       ├── empty-review.json
│       └── critical-only.json
│
└── install.sh                     ← +2 lines: bun install && bun run build
```

---

## Package Setup

### Root `package.json`

```json
{
  "name": "agentic-code-reviewer-skill",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build":       "bun run --cwd packages/client build",
    "dev":         "bun run --cwd packages/server dev & bun run --cwd packages/client dev",
    "start":       "bun packages/server/src/index.ts",
    "test":        "bun test tests/",
    "test:unit":   "bun test tests/unit/",
    "test:parity": "bun test tests/parity/"
  }
}
```

### `packages/client/package.json` (key deps)

```json
{
  "name": "@acr/client",
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@acr/shared": "workspace:*",
    "@fortawesome/react-fontawesome": "^0.2",
    "@fortawesome/free-solid-svg-icons": "^6"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "vite-plugin-singlefile": "^2.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

### `packages/server/package.json`

```json
{
  "name": "@acr/server",
  "scripts": {
    "start": "bun src/index.ts",
    "dev":   "bun --watch src/index.ts --port 7788"
  },
  "dependencies": { "@acr/shared": "workspace:*" }
}
```

No external runtime deps — Bun's stdlib covers everything.

---

## Serving Model

### `packages/client/vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:7788' },
  },
});
```

### `packages/server/src/serve-client.ts`

```ts
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const DIST_HTML = resolve(import.meta.dir, '../../client/dist/index.html');
let cachedHtml: string | null = null;

export function serveClient(): Response {
  if (!existsSync(DIST_HTML)) {
    return new Response(
      'UI not built. Run: bun install && bun run build',
      { status: 503, headers: { 'Content-Type': 'text/plain' } }
    );
  }
  cachedHtml ??= readFileSync(DIST_HTML, 'utf8');
  return new Response(cachedHtml, { headers: { 'Content-Type': 'text/html' } });
}
```

### `server/index.js` (shim — keeps existing path)

```js
#!/usr/bin/env node
const { spawnSync } = require('child_process');
const result = spawnSync('bun', [
  require('path').resolve(__dirname, '../packages/server/src/index.ts'),
  ...process.argv.slice(2)
], { stdio: 'inherit' });
process.exit(result.status ?? 1);
```

---

## Shared Types

### `packages/shared/src/types/findings.ts`

```ts
export interface Finding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'NOTE';
  file: string;
  line: number;
  location: string;
  finding: string;
  reasoning?: string;
  evidence?: string;
  dimensions?: string[];
}

export interface FileEntry { path: string; diff: string; }

export interface ReviewData {
  verdict: string;
  findings: Finding[];
  files: FileEntry[];
  summary: string;
  timestamp: string;
  branch: string;
  sessionId: string;
}
```

### `packages/shared/src/types/decisions.ts`

```ts
export interface LineAnnotation {
  file: string; lineStart: number; lineEnd: number;
  side: 'new' | 'old'; text: string; linesText: string;
  type: 'COMMENT' | 'REDLINE' | 'LABEL';
}

export interface DecisionPayload {
  action: 'implement' | 'save' | 'done';
  selectedIds: string[];
  comments: Record<string, string>;
  globalComment: string;
  lineAnnotations: Record<string, LineAnnotation>;
}
```

---

## Client Architecture

### `App.tsx` — global state

All state that crosses component boundaries lives here:
- `reviewData: ReviewData | null` — fetched by `useReviewData()`
- `activeFilter: 'ALL' | 'CRITICAL' | 'HIGH' | 'NOTE'`
- `activeFindingId: string | null`
- `activeFile: string | null`
- `splitView: boolean` — persisted `acr-split`
- `rightPanelVisible: boolean` — persisted `acr-right-panel`
- `inputMethod: 'drag' | 'pinpoint'`
- `editorMode: 'markup' | 'comment' | 'redline' | 'quickLabel'`
- `currentSelection: LineSelection | null`
- `chatPrefill: string | null` — set when "Ask AI" fired from popover

Global `keydown` listener registered via `useEffect`:
- `j` / `k`: next/prev finding (guard: not in textarea/input)
- `Space`: toggle checkbox of active finding
- `Enter`: show diff for active finding
- `Escape`: close any open modal/popover/mini-toolbar

### Component responsibilities

| Component | Responsibility |
|-----------|---------------|
| `Header` | Verdict, branch/date/session meta, settings gear |
| `FilterBar` | ALL/CRITICAL/HIGH/NOTE chip buttons + counts |
| `LeftPanel` | Tab switcher for FindingsList / FilesList |
| `FindingsList` | Checkboxes, badges, click-to-select, pre-check CRITICAL |
| `FilesList` | Files with finding count badges, click-to-view |
| `DiffViewer/index` | Diff header nav, toolstrip, floating overlays |
| `DiffTable` | parseDiff() + table render, gutter dots, line highlighting, selection event |
| `AnnotationToolstrip` | 6 mode buttons, help link |
| `MiniToolbar` | Floating toolbar above selection (Comment/Ask AI/Copy/Redline/Cancel) |
| `CommentPopover` | Fixed popover for text annotation input |
| `QuickLabelPicker` | 2-col emoji label grid |
| `RightPanel` | Collapse/expand shell, localStorage persistence |
| `CommentsPanel` | Per-finding comment cards + global notes |
| `ChatPanel` | Messages, streaming text, model label, send input |
| `ActionBar` | Select All/Deselect, Implement(N)/Save/Done buttons |
| `HelpModal` | Two-tab help (Modes / What happens) |
| `SettingsPopover` | Model dropdown, anchored to gear button |
| `UpdateToast` | Bottom-right update notification |

### Custom hooks

| Hook | Purpose |
|------|---------|
| `useReviewData` | `GET /api/review` on mount → `{ reviewData, isLoading, error }` |
| `useAnnotations` | localStorage `acr-line-annotations` CRUD |
| `useChat` | Session create, SSE stream via `fetch` + `ReadableStream`, abort |
| `useLocalStorage<T>` | Generic key+default → `[value, setter]` |

### localStorage keys — preserved exactly

| Key | Component |
|-----|-----------|
| `acr-comments` | CommentsPanel, FindingsList, ActionBar |
| `acr-line-annotations` | useAnnotations hook |
| `acr-chat-model` | SettingsPopover, useChat |
| `acr-split` | DiffViewer |
| `acr-right-panel` | RightPanel |
| `acr-toast-dismissed-{version}` | UpdateToast |

### Styling

`globals.css` contains the full Catppuccin Mocha CSS variable block verbatim from `review-server.js`, plus the `@media (prefers-color-scheme: light)` override. Tailwind components use `bg-[var(--bg)]` arbitrary value syntax. No color values are hardcoded in component files.

---

## Server Architecture

### `packages/server/src/index.ts`

- CLI arg parsing: `--session`, `--findings-file`, `--save-dir`, `--port`, `--platform`
- Module-level constants exported: `sessionId`, `findingsFile`, `saveDir`, `decisionFile`, `PLUGIN_ROOT`
- `Bun.serve({ port, hostname: '127.0.0.1', fetch(req) { ... } })`
- Route dispatch by `url.pathname + req.method`
- Each request calls `resetIdle(server)` before routing
- On listen: log URL, call `openBrowser(url)`

### Route dispatch table

| Method + Path | Handler |
|--------------|---------|
| `GET /` | `serveClient()` |
| `GET /api/review` | `handleReview()` |
| `GET /api/version-check` | `handleVersionCheck()` |
| `POST /api/chat/session` | `handleChatSession(req)` |
| `POST /api/chat/query` | `handleChatQuery(req)` |
| `POST /api/chat/abort` | `handleChatAbort(req)` |
| `POST /api/implement` | `handleDecision(req, 'implement')` |
| `POST /api/save` | `handleDecision(req, 'save')` |
| `POST /api/done` | `handleDecision(req, 'done')` |

### Key migration notes for routes

**`routes/review.ts`:** Use `Bun.file(findingsFile).json()` instead of `fs.readFileSync`. Same fallback empty object.

**`routes/version.ts`:** Use `fetch(MARKETPLACE_URL)` (native in Bun) instead of `require('https').get()`. Same `compareSemver()` logic.

**`routes/chat.ts`:** SSE streaming uses `Bun.spawn(['claude', ...])` + `ReadableStream`. The `chatSessions` Map and `buildChatSystemPrompt()` are ported verbatim (same Claude subprocess command, same prompt structure, same SSE frame format).

**`routes/decisions.ts`:** `saveMarkdown()` uses `Bun.write()` instead of `fs.writeFileSync()`. Decision file written to same `/tmp/claude-code-review-${sessionId}.decision` path. Exit after 500ms for implement/300ms for done — same timing.

---

## Tests

### Unit tests (Bun test runner)

**`tests/unit/routes.test.ts`**
- `handleReview` with fixture → correct finding count and structure
- `handleReview` with missing file → fallback object returned
- `handleVersionCheck` mocked: installed > latest → `updateAvailable: false`
- `handleVersionCheck` mocked: installed < latest → `updateAvailable: true`

**`tests/unit/decisions.test.ts`**
- `saveMarkdown()` writes correctly named `.md` file with correct content
- CRITICAL findings appear before HIGH before NOTE
- Selected findings marked `☑`, unselected marked `☐`
- Line annotations section rendered when annotations present
- Decision file written to correct `/tmp/` path with correct JSON

**`tests/unit/chat.test.ts`**
- `createChatSession(model)` inserts into sessions Map, returns string ID
- Second call with different model returns different ID
- `handleChatAbort` clears proc from session
- `buildChatSystemPrompt` includes verdict, up to 10 findings, currentFile

### Parity tests

**`tests/parity/route-parity.test.ts`**
Reads `packages/server/src/index.ts` as text, asserts all 8 required route strings are present:
```ts
const REQUIRED = ['/api/review', '/api/version-check', '/api/chat/session',
  '/api/chat/query', '/api/chat/abort', '/api/implement', '/api/save', '/api/done'];
```

### Manual tests (bash)

**`tests/manual/test-review-ui.sh`**: Copies `sample-review.json` → `/tmp/`, starts server on port 9999, curls `/api/review`, asserts non-empty findings array, prints PASS/FAIL.

**`tests/manual/test-chat.sh`**: Creates chat session, sends a query via curl `--no-buffer`, verifies at least one `data:` SSE line received.

**`tests/manual/test-decision.sh`**: POSTs to `/api/implement` with fixture payload, reads `/tmp/*.decision`, asserts `"action":"implement"`.

### Fixtures

**`tests/fixtures/sample-review.json`**: 3 findings (1 CRITICAL, 1 HIGH, 1 NOTE), 3 files with real diffs.  
**`tests/fixtures/empty-review.json`**: `{ verdict: '', findings: [], files: [], summary: '', ... }`.  
**`tests/fixtures/critical-only.json`**: 2 CRITICAL findings, no HIGH/NOTE, to test pre-check behavior.

---

## install.sh Changes

Bun is required. If missing, `install.sh` auto-installs it via the official one-liner before proceeding. Add a function near the top of `install.sh`:

```bash
ensure_bun() {
  if command -v bun >/dev/null 2>&1; then return 0; fi
  echo "bun not found — installing from https://bun.sh..."
  curl -fsSL https://bun.sh/install | bash
  # Add bun to PATH for the remainder of this script
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    echo "Error: bun install failed. Install manually from https://bun.sh and re-run." >&2
    exit 1
  fi
  echo "bun installed at $(command -v bun)"
}
```

Then call `ensure_bun` at the start of both `install_claude_plugin()` and `install_codex_skill()`, and append the build step after the existing file copy:

```bash
ensure_bun
# ... existing copy logic ...
echo "Building review UI..."
(cd "$target_dir" && bun install --frozen-lockfile && bun run build)
```

The `copy_repo_tree` function already copies all files (including `packages/`), so no other changes to install.sh are needed.

---

## Git Tracking

Matches Web App exactly — `dist/` is gitignored, not committed.

- `packages/client/dist/` — **gitignored** (generated by build step)
- `packages/client/.vite/` — add to `.gitignore`
- `packages/client/node_modules/` — add to `.gitignore`

`install.sh` makes Bun a **required** dependency. If `bun` is not found, the install prints a clear error pointing to `bun.sh` and exits non-zero. `bun install --frozen-lockfile && bun run build` is the last step of every install path.

---

## Verification

1. `bun install` — all workspace packages resolve
2. `bun run build` — produces `packages/client/dist/index.html`
3. Copy `tests/fixtures/sample-review.json` to `/tmp/claude-code-review-test.json`
4. `bun run start -- --session test --port 9999` — server starts, browser opens
5. Browser shows correct 3-panel UI with 3 findings
6. Click a finding → diff appears in center panel
7. Annotate a line → annotation persists in localStorage
8. Chat with Claude → SSE streaming works (requires `claude` CLI)
9. Click "Implement Selected" → `/tmp/claude-code-review-test.decision` written
10. `bun test` — all unit + parity tests pass
11. `tests/manual/test-review-ui.sh` — prints PASS
