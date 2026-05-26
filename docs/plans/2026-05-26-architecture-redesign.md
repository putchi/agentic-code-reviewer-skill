# Web App Architecture Redesign — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this task-by-task. Steps use `- [ ]` checkboxes.

---

## Session Progress (as of 2026-05-26 session 2)

**Completed tasks (committed):**
- ✅ Task 1: Root `package.json` (Bun workspaces) + `.gitignore` update
- ✅ Task 2: `packages/shared` — `@acr/shared` types (findings, decisions, chat)
- ✅ Task 3: Test fixtures (`sample-review.json`, `empty-review.json`, `critical-only.json`)
- ✅ Task 4: Server scaffold — `config.ts`, `serve-client.ts`, minimal `index.ts`
- ✅ Task 5: `packages/server/src/findings.ts` + `/api/review` route + unit tests (2 pass)
- ✅ Task 6: `/api/version-check` route + `compareSemver` + unit tests (6 pass)
- ✅ Task 7: `saveMarkdown` + decisions routes (`/api/implement`, `/api/save`, `/api/done`) + unit tests (2 pass)
- ✅ Task 8: `chat-sessions.ts` + `/api/chat/{session,query,abort}` SSE route + unit tests (3 pass)
- ✅ Task 9: `timeout.ts`, `browser.ts`, final `index.ts` wiring — full smoke test passed
- ✅ Task 10: `tests/parity/route-parity.test.ts` (1 pass) + `tests/manual/*.sh` scripts
- ✅ Task 11: `server/review-server.js` replaced with thin Node→Bun shim

**Stopped at Task 12** (client scaffold) because:
- `bun install` was hanging at "Resolving dependencies" with `~/.bun/bin/bun` (1.3.14 installed from bun.sh)
- User confirmed Bun 1.3.14 is available at `/opt/homebrew/bin/bun`
- **Resume**: use `which bun` → `/opt/homebrew/bin/bun`. Add `BUN=/opt/homebrew/bin/bun` or ensure `PATH` picks up homebrew bun before running install/build.

**Architecture decision made during this session:**
- Distribution model updated to `bun build --compile` binary (no end-user Bun needed) — see revised Task 24 below.

**Remaining tasks:** 12–25 (client scaffold → E2E verification + Task 24 revised + CI workflow)

---

**Goal:** Restructure `agentic-code-reviewer-skill` to match Web App's monorepo architecture (React 19 + Vite 6 + Tailwind 4 + Bun) while preserving every existing capability (8 API routes, SSE chat streaming, annotation toolstrip, diff viewer, 30-min idle timeout, Stop hook integration).

**Architecture:** Bun workspaces with `packages/shared` (TS types), `packages/client` (React + Vite, built to a single `dist/index.html` via `vite-plugin-singlefile`), and `packages/server` (thin Bun HTTP server that reads `dist/index.html` and exposes the same 8 routes). The server is compiled with `bun build --compile` into a self-contained native binary (like Web App) — **no Bun installation required on end-user machines**. `install.sh` downloads the pre-built platform binary from the GitHub release. `server/review-server.js` remains as a thin shim that invokes the binary, keeping hooks paths intact.

**Distribution model (confirmed 2026-05-26):** Web App ships as a self-contained Mach-O arm64 binary compiled with `bun build --compile` — the Bun runtime is bundled inside (visible as `__BUN` section). This skill must follow the same pattern: CI produces platform binaries (darwin-arm64, darwin-x64, linux-x64) for each release; `install.sh` downloads the correct binary. End users never need Bun. Developers need Bun for `vite build` and `bun build --compile`.

**Tech Stack:** Bun (runtime + test + package manager), React 19, Vite 6, Tailwind CSS 4, `vite-plugin-singlefile`, `@fortawesome/react-fontawesome`, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-05-26-Web App-architecture-redesign.md`

---

## Source of truth for migration

The existing `server/review-server.js` (1959 lines) is the **authoritative reference** for:
- All HTML structure, CSS variables (Catppuccin Mocha), and JS behavior
- All 8 API route handlers (`/api/review`, `/api/version-check`, `/api/chat/{session,query,abort}`, `/api/implement`, `/api/save`, `/api/done`)
- The `saveMarkdown()` function (lines 150–206)
- The `buildChatSystemPrompt()` function (lines 87–117)
- The SSE streaming logic (lines 1822–1898) — including the `stream-json` parse rules for `obj.type === 'assistant'` and `obj.type === 'content_block_delta'`
- The decision file path: `/tmp/claude-code-review-${sessionId}.decision`
- The idle timer (30 min), browser launch (darwin/win32/linux), and exit timing (500ms for `implement`, 300ms for `done`)

When porting, copy the exact strings/logic — do not "improve" them.

---

## File Structure (after completion)

```
agentic-code-reviewer-skill/
├── [UNCHANGED] .claude-plugin/, agents/, commands/, hooks/, references/, skills/, docs/
│
├── package.json                  ← NEW: Bun workspaces root
├── .gitignore                    ← UPDATED: add node_modules, dist, .vite
│
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   └── src/types/
│   │       ├── index.ts          ← re-exports all types
│   │       ├── findings.ts
│   │       ├── decisions.ts
│   │       └── chat.ts
│   │
│   ├── client/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── globals.css
│   │       ├── lib/
│   │       │   ├── api.ts        ← fetch wrappers for /api/*
│   │       │   ├── diff.ts       ← parseDiff() ported from review-server.js
│   │       │   └── annotKey.ts   ← annotation key builder
│   │       ├── hooks/
│   │       │   ├── useReviewData.ts
│   │       │   ├── useLocalStorage.ts
│   │       │   ├── useAnnotations.ts
│   │       │   └── useChat.ts
│   │       └── components/
│   │           ├── Header.tsx
│   │           ├── FilterBar.tsx
│   │           ├── ActionBar.tsx
│   │           ├── LeftPanel/{index,FindingsList,FilesList}.tsx
│   │           ├── DiffViewer/{index,DiffTable,AnnotationToolstrip,MiniToolbar,CommentPopover,QuickLabelPicker}.tsx
│   │           ├── RightPanel/{index,CommentsPanel,ChatPanel}.tsx
│   │           └── modals/{HelpModal,SettingsPopover,UpdateToast}.tsx
│   │
│   └── server/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts          ← Bun.serve entry, route dispatch
│           ├── config.ts         ← CLI args, paths, constants
│           ├── serve-client.ts
│           ├── browser.ts
│           ├── timeout.ts
│           ├── findings.ts       ← readFindings, saveMarkdown
│           ├── chat-sessions.ts  ← in-memory Map + buildChatSystemPrompt
│           └── routes/
│               ├── review.ts
│               ├── version.ts
│               ├── chat.ts
│               └── decisions.ts
│
├── server/
│   └── review-server.js          ← REPLACED with thin Node shim (same path/name)
│
├── tests/
│   ├── unit/{routes,decisions,chat}.test.ts
│   ├── parity/route-parity.test.ts
│   ├── manual/{test-review-ui,test-chat,test-decision}.sh
│   └── fixtures/{sample-review,empty-review,critical-only}.json
│
└── install.sh                    ← UPDATED: ensure_bun() + build step
```

---

## Task Sequence

1. Setup (root package.json, gitignore)
2. Shared types (`@acr/shared`)
3. Test fixtures
4. Server scaffold + serve-client
5. Server: `/api/review` route + unit test
6. Server: `/api/version-check` route + unit test
7. Server: decisions routes + `saveMarkdown` + unit test
8. Server: chat sessions + SSE route + unit test
9. Server: idle timeout + browser launch + full wiring
10. Parity test + manual smoke scripts
11. Replace `server/review-server.js` with thin Node shim
12. Client scaffold (Vite + React + Tailwind + singlefile)
13. `globals.css` (Catppuccin Mocha verbatim)
14. Client `lib/` + `useLocalStorage`
15. `useReviewData` + App skeleton
16. `Header` + `FilterBar`
17. `LeftPanel` (FindingsList + FilesList)
18. `DiffViewer` (DiffTable, AnnotationToolstrip, MiniToolbar, CommentPopover, QuickLabelPicker, `useAnnotations`)
19. `RightPanel` + `CommentsPanel`
20. `ChatPanel` + `useChat` (SSE consumption)
21. `ActionBar` (Implement / Save / Done)
22. `HelpModal`, `SettingsPopover`, `UpdateToast`
23. Keyboard shortcuts
24. `install.sh`: auto-install Bun + build step
25. End-to-end verification

Each task ends with a commit. Detailed file contents for tasks 1–10, 12–13, and 24 are in this plan. Tasks 14–23 give component contracts plus references to the canonical markup in `server/review-server.js`. Final task 25 verifies the full system.

---

## Task 1: Workspace setup

**Files:** Create `package.json`, modify `.gitignore`.

- [ ] **Step 1: Write root `package.json`**

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

- [ ] **Step 2: Append to `.gitignore`**

```
node_modules/
packages/*/node_modules/
packages/client/dist/
packages/client/.vite/
bun.lockb
```

- [ ] **Step 3: Run** — `bun install`. Expected: lockfile + node_modules created.
- [ ] **Step 4: Commit** — `git add package.json .gitignore && git commit -m "Add Bun workspace root"`

---

## Task 2: Shared types package

**Files:** Create `packages/shared/package.json` and `packages/shared/src/types/{findings,decisions,chat,index}.ts`.

- [ ] **Step 1: `packages/shared/package.json`**

```json
{ "name": "@acr/shared", "private": true, "main": "src/types/index.ts", "types": "src/types/index.ts" }
```

- [ ] **Step 2: `findings.ts`**

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

- [ ] **Step 3: `decisions.ts`**

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

- [ ] **Step 4: `chat.ts`**

```ts
export interface ChatSessionInfo { id: string; model: string; firstQuery: boolean; }
export interface SSETextDelta { type: 'text_delta'; delta: string; }
export interface SSEError { type: 'error'; message: string; }
export type SSEEvent = SSETextDelta | SSEError;
```

- [ ] **Step 5: `index.ts`**

```ts
export * from './findings';
export * from './decisions';
export * from './chat';
```

- [ ] **Step 6: Commit** — `git add packages/shared && git commit -m "Add @acr/shared types package"`

---

## Task 3: Test fixtures

**Files:** Create `tests/fixtures/{sample-review,empty-review,critical-only}.json`.

- [ ] **Step 1: `tests/fixtures/sample-review.json`** — 3 findings (CRITICAL, HIGH, NOTE), 3 files with realistic diffs.

```json
{
  "verdict": "APPROVE WITH CHANGES — 1 CRITICAL must be addressed",
  "branch": "feat/example",
  "sessionId": "fixture-sample",
  "timestamp": "2026-05-26T10:00:00Z",
  "summary": "SQL injection in db.ts and a race condition in worker.ts.",
  "findings": [
    {"id":"f001","severity":"CRITICAL","file":"src/db.ts","line":42,"location":"src/db.ts:42","finding":"Unsanitized user input passed to query()","reasoning":"userId interpolated directly into SQL.","evidence":"query(`SELECT * FROM users WHERE id = ${userId}`)"},
    {"id":"f002","severity":"HIGH","file":"src/worker.ts","line":17,"location":"src/worker.ts:17","finding":"Race condition on shared cache","reasoning":"Two async handlers write without lock."},
    {"id":"f003","severity":"NOTE","file":"src/utils.ts","line":5,"location":"src/utils.ts:5","finding":"Function name `doStuff` is not descriptive"}
  ],
  "files": [
    {"path":"src/db.ts","diff":"@@ -40,4 +40,6 @@\n context\n-old\n+query(`SELECT * FROM users WHERE id = ${userId}`)"},
    {"path":"src/worker.ts","diff":"@@ -15,4 +15,6 @@\n context\n+cache.value = result;"},
    {"path":"src/utils.ts","diff":"@@ -3,3 +3,5 @@\n+function doStuff() {}"}
  ]
}
```

- [ ] **Step 2: `tests/fixtures/empty-review.json`**

```json
{"verdict":"","findings":[],"files":[],"summary":"","timestamp":"2026-05-26T10:00:00Z","branch":"","sessionId":"fixture-empty"}
```

- [ ] **Step 3: `tests/fixtures/critical-only.json`**

```json
{
  "verdict":"BLOCK — 2 CRITICAL findings",
  "branch":"feat/crit",
  "sessionId":"fixture-crit",
  "timestamp":"2026-05-26T10:00:00Z",
  "summary":"",
  "findings":[
    {"id":"c001","severity":"CRITICAL","file":"a.ts","line":1,"location":"a.ts:1","finding":"X"},
    {"id":"c002","severity":"CRITICAL","file":"b.ts","line":2,"location":"b.ts:2","finding":"Y"}
  ],
  "files":[{"path":"a.ts","diff":"@@ -0,0 +1 @@\n+x"},{"path":"b.ts","diff":"@@ -0,0 +1 @@\n+y"}]
}
```

- [ ] **Step 4: Commit** — `git add tests/fixtures && git commit -m "Add test fixtures"`

---

## Task 4: Server scaffold + serve-client

**Files:** Create `packages/server/package.json`, `tsconfig.json`, `src/{config,serve-client,index}.ts`.

- [ ] **Step 1: `packages/server/package.json`**

```json
{
  "name": "@acr/server",
  "private": true,
  "scripts": {
    "start": "bun src/index.ts",
    "dev":   "bun --watch src/index.ts --port 7788"
  },
  "dependencies": { "@acr/shared": "workspace:*" }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true, "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `config.ts`**

```ts
import { resolve } from 'node:path';
function arg(name: string): string | null {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] ?? null : null;
}
export const sessionId = arg('--session') || 'unknown';
export const findingsFile = arg('--findings-file') || `/tmp/claude-code-review-${sessionId}.json`;
export const saveDir = arg('--save-dir') || resolve(process.cwd(), 'docs', 'code-reviews');
export const portArg = parseInt(arg('--port') || '0', 10);
export const decisionFile = `/tmp/claude-code-review-${sessionId}.decision`;
export const PLUGIN_ROOT = resolve(import.meta.dir, '../../..');
export const MARKETPLACE_URL = 'https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/.claude-plugin/marketplace.json';
export const INSTALL_BASE = 'curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash';
export function detectPlatform(): string {
  const explicit = arg('--platform');
  if (explicit) return explicit;
  if (PLUGIN_ROOT.includes('/.claude/plugins/')) return 'claude';
  if (PLUGIN_ROOT.includes('/.codex/skills/')) return 'codex';
  return '';
}
export function buildInstallCommand(): string {
  const p = detectPlatform();
  return p ? `${INSTALL_BASE} -s -- --platform ${p}` : INSTALL_BASE;
}
```

- [ ] **Step 4: `serve-client.ts`**

```ts
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
const DIST_HTML = resolve(import.meta.dir, '../../client/dist/index.html');
let cached: string | null = null;
export function serveClient(): Response {
  if (!existsSync(DIST_HTML)) {
    return new Response('UI not built. Run: bun install && bun run build',
      { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
  cached ??= readFileSync(DIST_HTML, 'utf8');
  return new Response(cached, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
```

- [ ] **Step 5: minimal `index.ts`**

```ts
import { portArg } from './config';
import { serveClient } from './serve-client';
const server = Bun.serve({
  port: portArg || 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return serveClient();
    return new Response('Not found', { status: 404 });
  },
});
console.log(`Review server listening at http://${server.hostname}:${server.port}`);
```

- [ ] **Step 6: Smoke** — `bun packages/server/src/index.ts --session t --port 7788` then `curl http://127.0.0.1:7788/`. Expected: 503 "UI not built" body.
- [ ] **Step 7: Commit** — `git add packages/server && git commit -m "Add server scaffold + serve-client"`

---

## Task 5: Server — `/api/review` + unit test

**Files:** Create `packages/server/src/findings.ts`, `routes/review.ts`, `tests/unit/routes.test.ts`. Modify `index.ts`.

- [ ] **Step 1: `findings.ts`** — port `readFindings()` from `review-server.js:138-144`:

```ts
import { readFileSync } from 'node:fs';
import type { ReviewData } from '@acr/shared';
import { findingsFile, sessionId } from './config';
export function readFindings(): ReviewData {
  try { return JSON.parse(readFileSync(findingsFile, 'utf8')); }
  catch {
    return { verdict: '', findings: [], files: [], summary: '',
             timestamp: new Date().toISOString(), branch: '', sessionId };
  }
}
```

- [ ] **Step 2: `routes/review.ts`**

```ts
import { readFindings } from '../findings';
export function handleReview(): Response { return Response.json(readFindings()); }
```

- [ ] **Step 3: Wire into `index.ts`**

```ts
import { handleReview } from './routes/review';
// inside fetch handler, before the 404 return:
if (req.method === 'GET' && url.pathname === '/api/review') return handleReview();
```

- [ ] **Step 4: `tests/unit/routes.test.ts`**

```ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { copyFileSync, unlinkSync } from 'node:fs';
const FX = '/tmp/claude-code-review-test-routes.json';
beforeAll(() => { process.argv.push('--session', 'test-routes'); copyFileSync('tests/fixtures/sample-review.json', FX); });
afterAll(() => { try { unlinkSync(FX); } catch {} });

describe('handleReview', () => {
  test('returns parsed findings from file', async () => {
    const { handleReview } = await import('../../packages/server/src/routes/review');
    const data = await handleReview().json();
    expect(data.findings).toHaveLength(3);
    expect(data.findings[0].severity).toBe('CRITICAL');
  });
  test('returns fallback when file missing', async () => {
    unlinkSync(FX);
    const { handleReview } = await import('../../packages/server/src/routes/review');
    const data = await handleReview().json();
    expect(data.findings).toEqual([]);
    expect(data.files).toEqual([]);
  });
});
```

- [ ] **Step 5: Run** — `bun test tests/unit/routes.test.ts`. Expected: 2 pass.
- [ ] **Step 6: Commit** — `git add packages/server tests && git commit -m "Add /api/review route + tests"`

---

## Task 6: Server — `/api/version-check` + tests

**Files:** Create `packages/server/src/routes/version.ts`, modify `index.ts`, append to `routes.test.ts`.

- [ ] **Step 1: `routes/version.ts`** — port semver + version check logic, use Bun's native `fetch`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLUGIN_ROOT, MARKETPLACE_URL, detectPlatform, buildInstallCommand } from '../config';

export function compareSemver(a: string, b: string): number {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}
function getInstalledVersion(): string {
  try {
    const p = resolve(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
    return JSON.parse(readFileSync(p, 'utf8')).version || '';
  } catch { return ''; }
}
async function fetchLatestVersion(): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(MARKETPLACE_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return '';
    const json = await res.json() as { plugins?: Array<{ version?: string }> };
    return json.plugins?.[0]?.version || '';
  } catch { return ''; }
}
export async function handleVersionCheck(): Promise<Response> {
  const installed = getInstalledVersion();
  const latest = await fetchLatestVersion();
  const updateAvailable = !!(installed && latest && compareSemver(latest, installed) > 0);
  return Response.json({ installed, latest, updateAvailable,
    platform: detectPlatform(), installCommand: buildInstallCommand() });
}
```

- [ ] **Step 2: Wire into `index.ts`**

```ts
import { handleVersionCheck } from './routes/version';
if (req.method === 'GET' && url.pathname === '/api/version-check') return await handleVersionCheck();
```

- [ ] **Step 3: Append to `tests/unit/routes.test.ts`**

```ts
import { compareSemver } from '../../packages/server/src/routes/version';
describe('compareSemver', () => {
  test('a > b → 1', () => expect(compareSemver('1.2.0','1.1.9')).toBe(1));
  test('a < b → -1', () => expect(compareSemver('1.1.0','1.1.1')).toBe(-1));
  test('equal → 0', () => expect(compareSemver('1.1.1','1.1.1')).toBe(0));
  test('different lengths', () => expect(compareSemver('1.0','1.0.1')).toBe(-1));
});
```

- [ ] **Step 4: Run** — `bun test tests/unit/routes.test.ts`. Expected: 6 tests pass.
- [ ] **Step 5: Commit** — `git add packages/server tests && git commit -m "Add /api/version-check route + tests"`

---

## Task 7: Server — decisions routes + `saveMarkdown`

**Files:** Extend `findings.ts`, create `routes/decisions.ts`, modify `index.ts`, create `tests/unit/decisions.test.ts`.

- [ ] **Step 1: Append `saveMarkdown` to `findings.ts`** — port from `review-server.js:150-206`:

```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LineAnnotation } from '@acr/shared';
import { saveDir } from './config';

function ensureDir(dir: string) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

export function saveMarkdown(
  data: ReturnType<typeof readFindings> & { _decision?: any },
  lineAnnotations?: Record<string, LineAnnotation>
): string {
  ensureDir(saveDir);
  const date = new Date().toISOString().slice(0, 10);
  const branch = (data.branch || 'unknown').replace(/[^a-z0-9_-]/gi, '-');
  const filepath = join(saveDir, `${date}-${branch}.md`);

  const groups: Record<string, any[]> = { CRITICAL: [], HIGH: [], NOTE: [] };
  for (const f of data.findings || []) {
    const sev = (f.severity || 'NOTE').toUpperCase();
    (groups[sev] || groups.NOTE).push(f);
  }
  const decision = data._decision || {};
  const selectedIds = new Set<string>(decision.selectedIds || []);
  const comments: Record<string, string> = decision.comments || {};
  const globalComment: string = decision.globalComment || '';

  let md = `# Code Review — ${date} (branch: ${data.branch || 'unknown'})\n\n`;
  md += `**Verdict:** ${data.verdict || '_No verdict_'}\n\n`;
  if (globalComment) md += `> **Your notes:** ${globalComment}\n\n`;

  for (const [sev, items] of Object.entries(groups)) {
    md += `## ${sev}\n\n`;
    if (!items.length) { md += '_None._\n\n'; continue; }
    for (const f of items) {
      const status = selectedIds.has(f.id) ? '☑ selected for implementation' : '☐ not selected';
      md += `- **${f.location || f.file}** — ${f.finding}\n`;
      if (f.reasoning) md += `  - Reasoning: ${f.reasoning}\n`;
      if (f.evidence) md += `  - Evidence: \`${f.evidence}\`\n`;
      if (f.dimensions?.length) md += `  - Dimensions: ${f.dimensions.join(', ')}\n`;
      md += `  - Status: ${status}\n`;
      if (comments[f.id]) md += `  - Your comment: "${comments[f.id]}"\n`;
      md += '\n';
    }
  }
  md += `## Summary\n\n${data.summary || ''}\n\n`;

  const annots = lineAnnotations || {};
  const keys = Object.keys(annots);
  if (keys.length) {
    md += `## Line Annotations\n\n`;
    for (const k of keys) {
      const a = annots[k];
      md += `- **${a.file}** lines ${a.lineStart}–${a.lineEnd} (${a.side}): [${a.type}] ${a.text}\n`;
    }
    md += '\n';
  }
  md += `---\n_Generated by agentic-code-reviewer_\n`;
  writeFileSync(filepath, md, 'utf8');
  return filepath;
}
```

- [ ] **Step 2: `routes/decisions.ts`**

```ts
import { writeFileSync } from 'node:fs';
import type { DecisionPayload } from '@acr/shared';
import { decisionFile } from '../config';
import { readFindings, saveMarkdown } from '../findings';

export async function handleImplement(payload: DecisionPayload): Promise<Response> {
  try {
    writeFileSync(decisionFile, JSON.stringify({ action: 'implement', ...payload }), 'utf8');
    try {
      const rd: any = readFindings(); rd._decision = payload;
      saveMarkdown(rd, payload.lineAnnotations);
    } catch {}
    setTimeout(() => process.exit(0), 500);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
export async function handleSave(payload: DecisionPayload): Promise<Response> {
  try {
    const rd: any = readFindings(); rd._decision = payload;
    const savedPath = saveMarkdown(rd, payload.lineAnnotations);
    writeFileSync(decisionFile, JSON.stringify({ action: 'save', ...payload }), 'utf8');
    return Response.json({ ok: true, path: savedPath });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
export async function handleDone(payload: DecisionPayload): Promise<Response> {
  writeFileSync(decisionFile, JSON.stringify({ action: 'done', ...payload }), 'utf8');
  setTimeout(() => process.exit(0), 300);
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Wire POST handlers in `index.ts`**

```ts
import { handleImplement, handleSave, handleDone } from './routes/decisions';
if (req.method === 'POST') {
  const payload = await req.json().catch(() => ({}));
  if (url.pathname === '/api/implement') return await handleImplement(payload);
  if (url.pathname === '/api/save')      return await handleSave(payload);
  if (url.pathname === '/api/done')      return await handleDone(payload);
}
```

- [ ] **Step 4: `tests/unit/decisions.test.ts`**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync, rmSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpSave: string; let fxPath: string;
beforeEach(() => {
  tmpSave = mkdtempSync(join(tmpdir(), 'acr-save-'));
  fxPath = '/tmp/claude-code-review-test-dec.json';
  copyFileSync('tests/fixtures/sample-review.json', fxPath);
  process.argv.push('--session','test-dec','--save-dir',tmpSave,'--findings-file',fxPath);
});
afterEach(() => { rmSync(tmpSave, { recursive: true, force: true }); rmSync(fxPath, { force: true }); });

describe('saveMarkdown', () => {
  test('orders severities CRITICAL → HIGH → NOTE and marks selection', async () => {
    const { readFindings, saveMarkdown } = await import('../../packages/server/src/findings');
    const data: any = readFindings();
    data._decision = { selectedIds: ['f001'], comments: { f001: 'note' }, globalComment: 'overall' };
    const p = saveMarkdown(data, {});
    expect(existsSync(p)).toBe(true);
    const md = readFileSync(p, 'utf8');
    expect(md.indexOf('## CRITICAL')).toBeLessThan(md.indexOf('## HIGH'));
    expect(md.indexOf('## HIGH')).toBeLessThan(md.indexOf('## NOTE'));
    expect(md).toContain('☑ selected for implementation');
    expect(md).toContain('☐ not selected');
    expect(md).toContain('Your notes: overall');
  });
  test('renders Line Annotations section', async () => {
    const { readFindings, saveMarkdown } = await import('../../packages/server/src/findings');
    const annots = { 'src/db.ts|42|42|new': {
      file: 'src/db.ts', lineStart: 42, lineEnd: 42, side: 'new' as const,
      text: 'verify', linesText: 'q', type: 'COMMENT' as const,
    }};
    const md = readFileSync(saveMarkdown(readFindings(), annots), 'utf8');
    expect(md).toContain('## Line Annotations');
    expect(md).toContain('[COMMENT] verify');
  });
});
```

- [ ] **Step 5: Run** — `bun test tests/unit/decisions.test.ts`. Expected: 2 tests pass.
- [ ] **Step 6: Commit** — `git add packages/server tests && git commit -m "Add decisions routes + saveMarkdown + tests"`

---

## Task 8: Server — chat sessions + SSE route

**Files:** Create `packages/server/src/chat-sessions.ts`, `routes/chat.ts`, modify `index.ts`, create `tests/unit/chat.test.ts`.

- [ ] **Step 1: `chat-sessions.ts`** — port `createChatSession` and `buildChatSystemPrompt` from `review-server.js:77-117`:

```ts
import type { ReviewData } from '@acr/shared';
export interface ChatSession {
  id: string; model: string; firstQuery: boolean;
  proc: ReturnType<typeof Bun.spawn> | null;
}
export const chatSessions = new Map<string, ChatSession>();
let counter = 0;
export function createChatSession(model: string): string {
  const id = 'chat-' + (++counter) + '-' + Date.now();
  chatSessions.set(id, { id, model: model || 'claude-sonnet-4-6', firstQuery: true, proc: null });
  return id;
}
export function buildChatSystemPrompt(reviewData: ReviewData, currentFile?: string): string {
  const lines: string[] = [];
  lines.push('You are a code review assistant. The user is reviewing a git diff and has questions.');
  lines.push('Answer concisely based on the diff and findings below.');
  lines.push('', '## Verdict', reviewData.verdict || '(no verdict)', '');
  lines.push('## Findings');
  for (const f of (reviewData.findings || []).slice(0, 10)) {
    lines.push(`[${f.severity || 'NOTE'}] ${f.file || ''}:${f.line || ''} — ${f.finding || ''}`);
  }
  if (currentFile) lines.push('', '## Current File', currentFile);
  lines.push('', '## Full Diff', '```diff');
  const parts: string[] = [];
  for (const f of (reviewData.files || [])) if (f.diff) parts.push(`--- ${f.path}\n${f.diff}`);
  let fullDiff = parts.join('\n\n');
  if (fullDiff.length > 40000) fullDiff = fullDiff.slice(0, 40000) + '\n...(truncated)';
  lines.push(fullDiff, '```');
  return lines.join('\n');
}
```

- [ ] **Step 2: `routes/chat.ts`** — port SSE handler from `review-server.js:1795-1898`. Use `Bun.spawn` (not shell):

```ts
import { chatSessions, createChatSession, buildChatSystemPrompt } from '../chat-sessions';
import { readFindings } from '../findings';

export function handleChatSession(payload: { model?: string }): Response {
  return Response.json({ sessionId: createChatSession(payload.model || 'claude-sonnet-4-6') });
}
export function handleChatAbort(payload: { sessionId?: string }): Response {
  const s = payload.sessionId ? chatSessions.get(payload.sessionId) : undefined;
  if (s?.proc) { try { s.proc.kill(); } catch {} s.proc = null; }
  return Response.json({ ok: true });
}
export function handleChatQuery(payload: { sessionId?: string; prompt?: string; currentFile?: string }): Response {
  const session = payload.sessionId ? chatSessions.get(payload.sessionId) : undefined;
  if (!session) return Response.json({ error: 'session not found' }, { status: 404 });

  const userPrompt = payload.prompt || '';
  let fullPrompt: string;
  if (session.firstQuery) {
    session.firstQuery = false;
    fullPrompt = buildChatSystemPrompt(readFindings(), payload.currentFile) + '\n\n---\n\nUser question:\n' + userPrompt;
  } else { fullPrompt = userPrompt; }

  const proc = Bun.spawn(
    ['claude', '--output-format', 'stream-json', '--model', session.model, '--print', '-p', fullPrompt],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
  );
  session.proc = proc;

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const emit = (obj: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const emitRaw = (s: string) => ctrl.enqueue(enc.encode(s));
      const reader = proc.stdout!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            try {
              const obj: any = JSON.parse(t);
              if (obj.type === 'assistant' && obj.message?.content) {
                for (const block of obj.message.content) {
                  if (block.type === 'text') emit({ type: 'text_delta', delta: block.text });
                }
              } else if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
                emit({ type: 'text_delta', delta: obj.delta.text });
              }
            } catch { emit({ type: 'text_delta', delta: line + '\n' }); }
          }
        }
        if (buf.trim()) {
          try {
            const obj: any = JSON.parse(buf);
            if (obj.type === 'assistant' && obj.message?.content) {
              for (const block of obj.message.content) if (block.type === 'text') emit({ type: 'text_delta', delta: block.text });
            }
          } catch { emit({ type: 'text_delta', delta: buf }); }
        }
        emitRaw('data: [DONE]\n\n');
      } catch (e: any) {
        emit({ type: 'error', message: e?.message || String(e) });
        emitRaw('data: [DONE]\n\n');
      } finally { session.proc = null; ctrl.close(); }
    },
    cancel() { try { proc.kill(); } catch {} session.proc = null; },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
```

- [ ] **Step 3: Wire chat routes in `index.ts`** (inside POST branch, before decisions):

```ts
import { handleChatSession, handleChatQuery, handleChatAbort } from './routes/chat';
if (url.pathname === '/api/chat/session') return handleChatSession(payload);
if (url.pathname === '/api/chat/query')   return handleChatQuery(payload);
if (url.pathname === '/api/chat/abort')   return handleChatAbort(payload);
```

- [ ] **Step 4: `tests/unit/chat.test.ts`**

```ts
import { describe, test, expect } from 'bun:test';
import { createChatSession, chatSessions, buildChatSystemPrompt } from '../../packages/server/src/chat-sessions';
import type { ReviewData } from '@acr/shared';

describe('chat-sessions', () => {
  test('createChatSession registers session', () => {
    const id = createChatSession('claude-sonnet-4-6');
    expect(chatSessions.get(id)?.model).toBe('claude-sonnet-4-6');
    expect(chatSessions.get(id)?.firstQuery).toBe(true);
  });
  test('two sessions get different ids', () => {
    expect(createChatSession('m1')).not.toBe(createChatSession('m2'));
  });
  test('buildChatSystemPrompt has verdict + first 10 findings', () => {
    const rd: ReviewData = {
      verdict: 'V1', findings: Array.from({ length: 15 }, (_, i) => ({
        id: `f${i}`, severity: 'NOTE', file: 'a.ts', line: i, location: `a.ts:${i}`, finding: `F${i}`,
      })), files: [], summary: '', timestamp: '', branch: '', sessionId: 's',
    } as any;
    const out = buildChatSystemPrompt(rd, 'a.ts');
    expect(out).toContain('V1'); expect(out).toContain('## Current File');
    expect(out).toContain('F0'); expect(out).toContain('F9');
    expect(out).not.toContain('F10');
  });
});
```

- [ ] **Step 5: Run** — `bun test tests/unit/chat.test.ts`. Expected: 3 tests pass.
- [ ] **Step 6: Commit** — `git add packages/server tests && git commit -m "Add chat sessions + SSE route + tests"`

---

## Task 9: Server — idle timeout, browser launch, full wiring

**Files:** Create `timeout.ts`, `browser.ts`; replace `index.ts`.

- [ ] **Step 1: `timeout.ts`**

```ts
let timer: ReturnType<typeof setTimeout> | null = null;
export function resetIdle(onTimeout: () => void) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(onTimeout, 30 * 60 * 1000);
}
```

- [ ] **Step 2: `browser.ts`**

```ts
export function openBrowser(url: string) {
  const plat = process.platform;
  const cmd = plat === 'darwin' ? ['open', url]
            : plat === 'win32'  ? ['cmd', '/c', 'start', '', url]
            :                     ['xdg-open', url];
  try { Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' }).unref?.(); } catch {}
}
```

- [ ] **Step 3: Final `index.ts`**

```ts
import { portArg } from './config';
import { serveClient } from './serve-client';
import { handleReview } from './routes/review';
import { handleVersionCheck } from './routes/version';
import { handleChatSession, handleChatQuery, handleChatAbort } from './routes/chat';
import { handleImplement, handleSave, handleDone } from './routes/decisions';
import { resetIdle } from './timeout';
import { openBrowser } from './browser';

const onIdle = () => { console.log('Idle timeout — closing server.'); server.stop(); process.exit(0); };

const server = Bun.serve({
  port: portArg || 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    resetIdle(onIdle);
    const url = new URL(req.url);
    if (req.method === 'GET') {
      if (url.pathname === '/')                   return serveClient();
      if (url.pathname === '/api/review')         return handleReview();
      if (url.pathname === '/api/version-check')  return await handleVersionCheck();
    }
    if (req.method === 'POST') {
      const payload = await req.json().catch(() => ({}));
      if (url.pathname === '/api/chat/session') return handleChatSession(payload);
      if (url.pathname === '/api/chat/query')   return handleChatQuery(payload);
      if (url.pathname === '/api/chat/abort')   return handleChatAbort(payload);
      if (url.pathname === '/api/implement')    return await handleImplement(payload);
      if (url.pathname === '/api/save')         return await handleSave(payload);
      if (url.pathname === '/api/done')         return await handleDone(payload);
    }
    return new Response('Not found', { status: 404 });
  },
});

const url = `http://${server.hostname}:${server.port}`;
console.log(`Review server listening at ${url}`);
resetIdle(onIdle);
openBrowser(url);
```

- [ ] **Step 4: Smoke** — `bun packages/server/src/index.ts --session smoke --port 7788 &` then `curl -s http://127.0.0.1:7788/api/review`. Kill server.
- [ ] **Step 5: Commit** — `git add packages/server && git commit -m "Wire idle timeout, browser launch, full route dispatch"`

---

## Task 10: Parity test + manual smoke scripts

**Files:** Create `tests/parity/route-parity.test.ts` and `tests/manual/*.sh`.

- [ ] **Step 1: `tests/parity/route-parity.test.ts`**

```ts
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
const REQUIRED = [
  '/api/review', '/api/version-check',
  '/api/chat/session', '/api/chat/query', '/api/chat/abort',
  '/api/implement', '/api/save', '/api/done',
];
test('all required routes present in server index.ts', () => {
  const src = readFileSync('packages/server/src/index.ts', 'utf8');
  for (const r of REQUIRED) expect(src.includes(r), `missing route ${r}`).toBe(true);
});
```

- [ ] **Step 2: `tests/manual/test-review-ui.sh`**

```bash
#!/usr/bin/env bash
set -e
FX=/tmp/claude-code-review-uiTest.json
cp tests/fixtures/sample-review.json "$FX"
bun packages/server/src/index.ts --session uiTest --findings-file "$FX" --port 9999 &
PID=$!; sleep 1
RESP=$(curl -s http://127.0.0.1:9999/api/review)
kill $PID 2>/dev/null || true
echo "$RESP" | grep -q '"severity":"CRITICAL"' && echo PASS || (echo FAIL; exit 1)
```

- [ ] **Step 3: `tests/manual/test-chat.sh`**

```bash
#!/usr/bin/env bash
set -e
bun packages/server/src/index.ts --session chatTest --port 9998 &
PID=$!; sleep 1
SID=$(curl -s -X POST http://127.0.0.1:9998/api/chat/session -d '{"model":"claude-haiku-4-5"}' | jq -r .sessionId)
curl -s --no-buffer -X POST http://127.0.0.1:9998/api/chat/query -d "{\"sessionId\":\"$SID\",\"prompt\":\"hi\"}" | head -c 200
kill $PID 2>/dev/null || true
echo OK
```

- [ ] **Step 4: `tests/manual/test-decision.sh`**

```bash
#!/usr/bin/env bash
set -e
FX=/tmp/claude-code-review-decTest.json
DEC=/tmp/claude-code-review-decTest.decision
cp tests/fixtures/sample-review.json "$FX"
rm -f "$DEC"
bun packages/server/src/index.ts --session decTest --findings-file "$FX" --port 9997 &
PID=$!; sleep 1
curl -s -X POST http://127.0.0.1:9997/api/implement \
  -d '{"selectedIds":["f001"],"comments":{},"globalComment":"","lineAnnotations":{}}' >/dev/null
sleep 1
grep -q '"action":"implement"' "$DEC" && echo PASS || (echo FAIL; exit 1)
kill $PID 2>/dev/null || true
```

- [ ] **Step 5: `chmod +x tests/manual/*.sh`**
- [ ] **Step 6: Run** — `bun test tests/parity/route-parity.test.ts`. Expected: 1 test passes.
- [ ] **Step 7: Commit** — `git add tests && git commit -m "Add parity test + manual smoke scripts"`

---

## Task 11: Replace `server/review-server.js` with Node shim

**File:** Overwrite `server/review-server.js`.

- [ ] **Step 1: Rewrite `server/review-server.js`**

```js
#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const entry = path.resolve(__dirname, '../packages/server/src/index.ts');
const result = spawnSync('bun', [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status == null ? 1 : result.status);
```

- [ ] **Step 2: Smoke** — `node server/review-server.js --session shim --port 7788` boots the Bun server (UI 503 until client built).
- [ ] **Step 3: Commit** — `git add server/review-server.js && git commit -m "Replace review-server.js with thin shim"`

---

## Task 12: Client scaffold — Vite + React + Tailwind + singlefile

**Files:** Create `packages/client/{package.json, tsconfig.json, vite.config.ts, index.html, src/{main.tsx, App.tsx, globals.css}}`.

- [ ] **Step 1: `packages/client/package.json`**

```json
{
  "name": "@acr/client",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@acr/shared": "workspace:*",
    "@fortawesome/fontawesome-svg-core": "^6.5.2",
    "@fortawesome/free-solid-svg-icons": "^6.5.2",
    "@fortawesome/react-fontawesome": "^0.2.2"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.0",
    "vite-plugin-singlefile": "^2.0.3",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": true, "esModuleInterop": true,
    "skipLibCheck": true, "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: { outDir: 'dist', assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 100_000_000 },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:7788' } },
});
```

- [ ] **Step 4: `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agentic Code Review</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 5: `src/globals.css`** (Tailwind only for now)

```css
@import "tailwindcss";
```

- [ ] **Step 6: `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './globals.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 7: `src/App.tsx`** (placeholder)

```tsx
export default function App() { return <div>Agentic Code Review — loading…</div>; }
```

- [ ] **Step 8: Build** — `bun install && bun run build`. Expected: `packages/client/dist/index.html` exists.
- [ ] **Step 9: Serve E2E** — start the Bun server with the sample fixture; verify the page renders.
- [ ] **Step 10: Commit** — `git add packages/client && git commit -m "Add client scaffold (Vite + React + Tailwind singlefile)"`

---

## Task 13: globals.css — Catppuccin Mocha verbatim

**File:** Replace `packages/client/src/globals.css`.

- [ ] **Step 1: Replace `globals.css`** — port all CSS variables and dark/light blocks from `review-server.js:222-239`:

```css
@import "tailwindcss";

:root {
  --bg: #1e1e2e; --bg2: #181825; --bg3: #11111b;
  --surface: #313244; --surface2: #45475a;
  --text: #cdd6f4; --text-dim: #6c7086; --text-muted: #a6adc8;
  --accent: #89b4fa; --green: #a6e3a1; --red: #f38ba8;
  --purple: #cba6f7; --critical: #f38ba8; --high: #fab387; --note: #89b4fa;
  --border: #45475a; --radius: 6px;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #eff1f5; --bg2: #e6e9ef; --bg3: #dce0e8;
    --surface: #ccd0da; --surface2: #bcc0cc;
    --text: #4c4f69; --text-dim: #9ca0b0; --text-muted: #6c6f85;
    --accent: #1e66f5; --green: #40a02b; --red: #d20f39;
    --purple: #8839ef; --critical: #d20f39; --high: #fe640b; --note: #1e66f5;
    --border: #bcc0cc;
  }
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  height: 100%; overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px; background: var(--bg3); color: var(--text);
}
```

- [ ] **Step 2: Commit** — `git add packages/client/src/globals.css && git commit -m "Add Catppuccin Mocha CSS variables"`

---

## Task 14: Client lib + useLocalStorage

**Files:** Create `src/lib/{api,annotKey,diff}.ts` and `src/hooks/useLocalStorage.ts`.

- [ ] **Step 1: `lib/api.ts`**

```ts
import type { ReviewData, DecisionPayload } from '@acr/shared';
export async function fetchReview(): Promise<ReviewData> { return (await fetch('/api/review')).json(); }
export async function fetchVersionCheck() { return (await fetch('/api/version-check')).json(); }
export async function postDecision(action: 'implement'|'save'|'done', payload: Omit<DecisionPayload,'action'>) {
  const res = await fetch(`/api/${action}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  return res.json();
}
export async function createChatSession(model: string): Promise<string> {
  const res = await fetch('/api/chat/session', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model }) });
  return (await res.json()).sessionId;
}
export async function abortChat(sessionId: string) {
  await fetch('/api/chat/abort', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId }) });
}
```

- [ ] **Step 2: `lib/annotKey.ts`**

```ts
export function annotKey(file: string, lineStart: number, lineEnd: number, side: 'new'|'old') {
  return `${file}|${lineStart}|${lineEnd}|${side}`;
}
```

- [ ] **Step 3: `lib/diff.ts`** — port `parseDiff` from `review-server.js` (search the script block for `parseDiff`). Skeleton:

```ts
export interface DiffRow {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
  newLine?: number;
  oldLine?: number;
}
export function parseDiff(diffText: string): DiffRow[] {
  const rows: DiffRow[] = [];
  if (!diffText) return rows;
  let newLine = 0, oldLine = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = /@@ -(\d+),?\d* \+(\d+),?\d* @@/.exec(raw);
      if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10); }
      rows.push({ type: 'hunk', text: raw });
    } else if (raw.startsWith('+')) {
      rows.push({ type: 'add', text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith('-')) {
      rows.push({ type: 'del', text: raw.slice(1), oldLine: oldLine++ });
    } else {
      rows.push({ type: 'ctx', text: raw.replace(/^ /, ''), newLine: newLine++, oldLine: oldLine++ });
    }
  }
  return rows;
}
```

(If `review-server.js` has additional cases — empty lines, `\` no-newline-at-eof, etc. — port them verbatim.)

- [ ] **Step 4: `hooks/useLocalStorage.ts`**

```ts
import { useEffect, useState } from 'react';
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T|((p:T)=>T))=>void] {
  const [val, setVal] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw == null ? initial : JSON.parse(raw); }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }, [key, val]);
  return [val, setVal];
}
```

- [ ] **Step 5: Commit** — `git add packages/client && git commit -m "Add client lib + useLocalStorage"`

---

## Task 15: useReviewData + App skeleton

**Files:** Create `hooks/useReviewData.ts`, replace `App.tsx`.

- [ ] **Step 1: `hooks/useReviewData.ts`**

```ts
import { useEffect, useState } from 'react';
import type { ReviewData } from '@acr/shared';
import { fetchReview } from '../lib/api';
export function useReviewData() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchReview().then(setData).catch(e => setError(e.message)); }, []);
  return { data, isLoading: !data && !error, error };
}
```

- [ ] **Step 2: Replace `App.tsx`** with the 3-pane shell (header, filter bar slot, panels, action bar slot). Use `useReviewData` for data, `useLocalStorage` for split-view + right-panel visibility. Display "Loading…" while `isLoading`.
- [ ] **Step 3: Build + verify** — fixture branch name appears in the header.
- [ ] **Step 4: Commit** — `git add packages/client && git commit -m "App skeleton + useReviewData"`

---

## Tasks 16–23: Client components

Each task creates the listed components and wires them into `App.tsx`, then builds and verifies in the browser, then commits. The markup, classes, and behavior must match `server/review-server.js` exactly (port from the existing HTML/CSS/JS strings).

### Task 16: Header + FilterBar
Components: `components/Header.tsx`, `components/FilterBar.tsx`. Mount in App. Wire `activeFilter` state.

### Task 17: LeftPanel
Components: `components/LeftPanel/{index,FindingsList,FilesList}.tsx`. Tabs are local state. Use `useLocalStorage('acr-comments', {})` keyed `_checked_${id}`. CRITICAL pre-checked on first load.

### Task 18: DiffViewer + useAnnotations
Components: `components/DiffViewer/{index,DiffTable,AnnotationToolstrip,MiniToolbar,CommentPopover,QuickLabelPicker}.tsx`, `hooks/useAnnotations.ts`. Port CSS for `.diff-line-*`, `.gutter-dot-*`, `.line-selected`, `.pinpoint-mode`, `.diff-flagged*` into `globals.css`. Drag → mouseup detection drives `currentSelection`. Modes: markup / comment / redline / quickLabel. Annotations persist in `localStorage['acr-line-annotations']`.

### Task 19: RightPanel + CommentsPanel
Components: `components/RightPanel/{index,CommentsPanel}.tsx`. Close button toggles `acr-right-panel`. Cards rendered per checked finding; textarea bound to `acr-comments[_comment_${id}]`. Global notes textarea bound to `acr-comments[_global]`.

### Task 20: ChatPanel + useChat
Components: `components/RightPanel/ChatPanel.tsx`, `hooks/useChat.ts`. SSE consumption via `fetch` + `ReadableStream.getReader()`. Parse lines starting with `data: `. On `[DONE]`, stop. `Ask AI` from MiniToolbar/CommentPopover pre-fills the chat input with the selected text.

### Task 21: ActionBar
Component: `components/ActionBar.tsx`. Select All / Deselect All over `acr-comments`. Implement disabled when `selectedIds.length === 0`. Calls `postDecision`. After Implement/Done the server exits — page disconnect is expected.

### Task 22: HelpModal + SettingsPopover + UpdateToast
Components: `components/modals/{HelpModal,SettingsPopover,UpdateToast}.tsx`. Help modal: 2 tabs (Modes / What happens). Settings: model dropdown (`claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5`) persisted to `acr-chat-model`. Update toast: calls `fetchVersionCheck`, dismiss persists to `acr-toast-dismissed-${version}`.

### Task 23: Keyboard shortcuts
Add `useEffect` in `App.tsx` registering global `keydown`. Bindings: `j`/`k` next/prev finding (filtered list), `Space` toggle active checkbox, `Enter` show diff, `Escape` close any popover/modal/toolbar. Guard: skip if `e.target.tagName` ∈ {TEXTAREA, INPUT, SELECT} or contentEditable.

After each task: build, verify in browser, commit with a descriptive message.

---

## Task 24 (REVISED): install.sh — download pre-built binary

**Decision (2026-05-26):** End users must NOT need Bun installed. Distribution follows the Web App pattern: CI compiles `bun build --compile` platform binaries; `install.sh` downloads the correct one.

**Files:** Modify `install.sh`. Add `.github/workflows/release.yml` (CI build). Modify `server/review-server.js` shim to invoke the binary.

### Step 24a: `bun build --compile` target in `package.json`

Add to root `package.json` scripts:
```json
"compile": "bun build packages/server/src/index.ts --compile --outfile dist/review-server"
```

After `bun run build` (Vite), run `bun run compile` to produce `dist/review-server` (native binary).

### Step 24b: Update `server/review-server.js` to invoke binary

```js
#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
// Prefer the compiled binary in dist/; fall back to bun source for dev
const bin = path.resolve(__dirname, '../dist/review-server');
const src = path.resolve(__dirname, '../packages/server/src/index.ts');
const fs = require('fs');
let result;
if (fs.existsSync(bin)) {
  result = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit' });
} else {
  result = spawnSync('bun', [src, ...process.argv.slice(2)], { stdio: 'inherit' });
}
process.exit(result.status == null ? 1 : result.status);
```

### Step 24c: `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: darwin-arm64
            bun_target: bun-darwin-arm64
          - os: macos-13
            target: darwin-x64
            bun_target: bun-darwin-x64
          - os: ubuntu-latest
            target: linux-x64
            bun_target: bun-linux-x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build          # vite build → dist/index.html
      - run: bun build packages/server/src/index.ts --compile --target=${{ matrix.bun_target }} --outfile dist/review-server-${{ matrix.target }}
      - uses: actions/upload-artifact@v4
        with:
          name: review-server-${{ matrix.target }}
          path: dist/review-server-${{ matrix.target }}
  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v2
        with:
          files: 'review-server-*/*'
```

### Step 24d: Update `install.sh`

Replace `bun install + bun run build` block with binary download:

```bash
download_server_binary() {
  local target_dir="$1"
  local tag="${PLUGIN_VERSION:-latest}"  # set by install script from plugin.json
  local platform arch binary_name base_url

  case "$(uname -s)" in
    Darwin)
      case "$(uname -m)" in
        arm64) platform="darwin-arm64" ;;
        *)     platform="darwin-x64" ;;
      esac ;;
    Linux) platform="linux-x64" ;;
    *) echo "Warning: unsupported platform, server binary not downloaded" >&2; return 0 ;;
  esac

  binary_name="review-server-${platform}"
  base_url="https://github.com/putchi/agentic-code-reviewer-skill/releases/download/${tag}"

  echo "Downloading server binary (${platform})..."
  curl -fsSL "${base_url}/${binary_name}" -o "${target_dir}/dist/review-server"
  chmod +x "${target_dir}/dist/review-server"
  echo "Server binary installed."
}
```

Call `download_server_binary "$target_dir"` after the file copy in each install function.

- [ ] **Step 1: Add `compile` script to root `package.json`**
- [ ] **Step 2: Update `server/review-server.js` to prefer binary over bun source**
- [ ] **Step 3: Create `.github/workflows/release.yml`**
- [ ] **Step 4: Update `install.sh` with `download_server_binary()` and remove bun install step**
- [ ] **Step 5: Test end-to-end:** build locally with `bun run build && bun run compile`, verify `dist/review-server` works via `node server/review-server.js --session test --port 7788`
- [ ] **Step 6: Commit** — `git add package.json server/review-server.js .github/workflows/release.yml install.sh && git commit -m "Distribution: compile Bun binary, install.sh downloads from release"`

---

## Task 25: End-to-end verification

- [ ] **Step 1: Clean rebuild**

```bash
rm -rf packages/client/dist node_modules packages/*/node_modules
bun install
bun run build
```

Expected: `packages/client/dist/index.html` exists.

- [ ] **Step 2: All tests** — `bun test`. Expected: all green.

- [ ] **Step 3: Manual smoke** — `tests/manual/test-review-ui.sh` and `tests/manual/test-decision.sh` print `PASS`.

- [ ] **Step 4: Full E2E**

```bash
cp tests/fixtures/sample-review.json /tmp/claude-code-review-e2e.json
node server/review-server.js --session e2e --port 9991
```

In the browser, verify:
- 3 findings, verdict, branch shown
- Click a finding → diff opens, line highlighted
- Drag-select lines in Markup mode → mini-toolbar appears
- Click Comment → popover opens; Save persists
- Type in chat → streaming response appears (if `claude` CLI present)
- Click Save → markdown written to `docs/code-reviews/`
- Click Implement → `/tmp/claude-code-review-e2e.decision` written with `"action":"implement"`, server exits

- [ ] **Step 5: Verify Stop-hook contract** — read `hooks/code-review-gate.sh`. It checks for `/tmp/claude-code-review-${SESSION_ID}.done`. The new server writes only `.decision`. If `.done` is required, add a small `writeFileSync('/tmp/claude-code-review-${sessionId}.done', '')` call into each decision handler (implement/save/done). Re-run the manual test to confirm `.done` appears. Commit the fix.

- [ ] **Step 6: Final commit** if any tweaks made.

---

## Verification Summary

| Capability | Verified by |
|------------|-------------|
| 8 API routes preserved | Task 10 parity test |
| `readFindings` fallback | Task 5 unit test |
| `saveMarkdown` ordering + selection markers | Task 7 unit test |
| Chat session lifecycle | Task 8 unit test |
| SSE streaming | Task 20 (manual) + `tests/manual/test-chat.sh` |
| Decision file written + server exits | Task 21 (manual) + `tests/manual/test-decision.sh` |
| Diff rendering + line highlighting | Task 18 (manual) |
| Annotations persist | Task 18 (manual) |
| Comments + global notes persist | Task 19 (manual) |
| Keyboard shortcuts | Task 23 (manual) |
| Update toast | Task 22 (manual) |
| Build artifact gitignored, Bun auto-installed | Task 24 |
| Existing install.sh shim path works | Task 11 |
| Plugin/hooks/agents/commands untouched | No file in those dirs is modified |

---

## Risks / Notes

1. **`.done` sentinel** — Task 25 Step 5 asks the implementer to confirm whether `hooks/code-review-gate.sh` needs a `.done` file. If yes, write it from each decision handler.
2. **`claude` CLI dependency** — Chat features require the `claude` CLI on `$PATH`. The `test-chat.sh` manual script will fail gracefully if absent.
3. **Tailwind v4 syntax** — Tailwind 4 uses `@import "tailwindcss"` (no `@tailwind base/components/utilities`). Use `@tailwindcss/vite`, not the old PostCSS plugin.
4. **Bundle size** — The single inlined `dist/index.html` will likely be 500KB–1MB. Confirm it opens within ~1s. If too slow, lazy-load the chat panel.
5. **SKILL.md** — Continues to reference `server/review-server.js`; no change needed since the shim preserves that path. Audit if it references internals.
