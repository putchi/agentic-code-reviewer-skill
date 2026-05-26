# Embed Client HTML into Compiled Binary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile runtime `dist/index.html` file lookup with a compile-time embed, so the `bun build --compile` binary is fully self-contained — no separate HTML file needed alongside it, exactly like Plannotator does.

**Architecture:** `packages/server/src/index.ts` imports the built `packages/client/dist/index.html` using Bun's `with { type: "text" }` import attribute, which causes `bun build --compile` to inline the HTML string into the binary at compile time. `serve-client.ts` is rewritten to accept the pre-loaded string instead of reading from disk. The `dist/` output folder stays gitignored; the `compile` script in root `package.json` is updated to run `bun run build` first (Vite) then `bun build --compile`. The Node shim (`server/review-server.js`) and `install.sh` are updated to remove the now-unnecessary `dist/index.html` copy step.

**Tech Stack:** Bun 1.x (`bun build --compile`, `with { type: "text" }` import attribute), TypeScript 5, existing Vite + React client build.

**Key reference:** Plannotator does exactly this at `apps/hook/server/index.ts:133–138`:
```ts
// @ts-ignore - Bun import attribute for text
import planHtml from "../dist/index.html" with { type: "text" };
const planHtmlContent = planHtml as unknown as string;
```
The `@ts-ignore` is required because TypeScript doesn't know this attribute; Bun handles it at bundle time.

---

## Context for the implementer

### What exists today (the problem)

`packages/server/src/serve-client.ts` currently reads `index.html` from disk at runtime using two candidate paths:

```ts
const execDir = dirname(process.execPath);
const candidates = [
  resolve(execDir, 'index.html'),           // production: binary + html must be co-located
  resolve(import.meta.dir, '../../client/dist/index.html'), // dev
];
```

This means:
- When the compiled binary runs, it looks for `index.html` next to itself — a separate file that must exist.
- `install.sh` must copy that file alongside the binary when installing.
- If the file is missing, the server returns a 503 error.

### What we want (the fix)

Use Bun's compile-time text import so the HTML is baked inside the binary:

```ts
// In packages/server/src/index.ts (top of file)
// @ts-ignore
import clientHtml from "../client/dist/index.html" with { type: "text" };
```

`bun build --compile` resolves this import path at build time, reads the file, and stores the string as a constant inside the binary. At runtime, `clientHtml` is just a string — no filesystem access needed.

In dev mode (`bun src/index.ts` without compiling), Bun also handles this import attribute natively, so dev mode works identically.

### Build order matters

The Vite client build (`bun run build`) **must run before** `bun build --compile`, because the compile step needs `packages/client/dist/index.html` to exist so it can inline it. The updated `compile` script in `package.json` must enforce this order.

---

## Files to change

| File | Change |
|------|--------|
| `packages/server/src/serve-client.ts` | Remove all filesystem logic; accept html string as parameter |
| `packages/server/src/index.ts` | Add `import clientHtml from ...` with text attribute; pass to `serveClient()` |
| `package.json` | Update `compile` script to run `build` then `bun build --compile` |
| `server/review-server.js` | Remove `dist/index.html` copy logic (none exists yet — no change needed) |
| `install.sh` | Remove `download_server_binary`'s `index.html` copy if any; ensure only the binary itself is placed |

---

## Task 1: Rewrite `serve-client.ts` to accept html string

**Files:**
- Modify: `packages/server/src/serve-client.ts`

This task removes all filesystem dependency from `serve-client.ts`. The function now just wraps a string in a Response.

- [ ] **Step 1: Replace the entire file**

```ts
let cached: Response | null = null;

export function serveClient(html: string): Response {
  cached ??= new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return cached;
}
```

The `cached` variable now stores the `Response` object (not the string) so we avoid constructing it on every request.

- [ ] **Step 2: Verify TypeScript is happy**

```bash
cd /path/to/agentic-code-reviewer-skill
/opt/homebrew/bin/bun run --cwd packages/server tsc --noEmit 2>&1 | head -20
```

Expected: no errors about `serve-client.ts` (there may be pre-existing errors elsewhere — ignore those for now).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/serve-client.ts
git commit -m "Simplify serve-client: accept html string, remove filesystem logic"
```

---

## Task 2: Add compile-time HTML import to `index.ts`

**Files:**
- Modify: `packages/server/src/index.ts`

This task adds the Bun import attribute that embeds the HTML at compile time and passes it to `serveClient()`.

- [ ] **Step 1: Add the import at the top of `index.ts`**

Add these two lines immediately after the existing imports, before any other code:

```ts
// @ts-ignore — Bun resolves this at compile time; TS doesn't know the attribute
import clientHtml from '../../client/dist/index.html' with { type: 'text' };
```

The path `../../client/dist/index.html` is relative to `packages/server/src/index.ts`, which puts it at `packages/client/dist/index.html`. This is the file Vite produces.

- [ ] **Step 2: Update the `serveClient()` call**

Find this line in `index.ts`:

```ts
if (url.pathname === '/')                   return serveClient();
```

Change it to:

```ts
if (url.pathname === '/')                   return serveClient(clientHtml as string);
```

The `as string` cast is needed because TypeScript treats the import as `unknown` due to the `@ts-ignore`.

- [ ] **Step 3: Build the client first, then smoke-test dev mode**

```bash
/opt/homebrew/bin/bun run build
```

Expected output ends with: `dist/index.html  ??? kB │ gzip: ??? kB` and `✓ built in ???ms`

Then start the server in dev mode:

```bash
cp tests/fixtures/sample-review.json /tmp/claude-code-review-t2.json
/opt/homebrew/bin/bun packages/server/src/index.ts --session t2 --port 7792 --findings-file /tmp/claude-code-review-t2.json &
sleep 1
curl -s http://127.0.0.1:7792/ | grep -o 'Agentic Code Review'
kill %1
```

Expected: `Agentic Code Review`

If you see `UI not built` — the `bun run build` step didn't run or the path is wrong. Double-check that `packages/client/dist/index.html` exists.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "Embed client HTML in server binary via Bun import attribute"
```

---

## Task 3: Update `compile` script to enforce build order

**Files:**
- Modify: `package.json`

The `compile` script currently only runs `bun build --compile`. It needs to run the Vite build first so `packages/client/dist/index.html` exists when `bun build --compile` reads it.

- [ ] **Step 1: Update `package.json` scripts**

Replace:
```json
"compile": "bun build packages/server/src/index.ts --compile --outfile dist/review-server"
```

With:
```json
"compile": "bun run build && bun build packages/server/src/index.ts --compile --outfile dist/review-server"
```

The full `scripts` block should now read:

```json
"scripts": {
  "build":       "bun run --cwd packages/client build",
  "dev":         "bun run --cwd packages/server dev & bun run --cwd packages/client dev",
  "start":       "bun packages/server/src/index.ts",
  "test":        "bun test tests/",
  "test:unit":   "bun test tests/unit/",
  "test:parity": "bun test tests/parity/",
  "compile":     "bun run build && bun build packages/server/src/index.ts --compile --outfile dist/review-server"
}
```

- [ ] **Step 2: Run the compile script end-to-end**

```bash
rm -rf packages/client/dist dist/review-server
/opt/homebrew/bin/bun run compile 2>&1
```

Expected sequence of output:
1. Vite build lines ending in `✓ built in ???ms`
2. Bun compile lines: `[???ms] bundle ?? modules` then `[???ms] compile dist/review-server`

Then verify the binary is self-contained — **no** `dist/index.html` should be needed:

```bash
rm -f dist/index.html   # remove any stale copy
cp tests/fixtures/sample-review.json /tmp/claude-code-review-t3.json
./dist/review-server --session t3 --port 7793 --findings-file /tmp/claude-code-review-t3.json &
sleep 1
curl -s http://127.0.0.1:7793/ | grep -o 'Agentic Code Review'
curl -s http://127.0.0.1:7793/api/review | python3 -c "import sys,json; d=json.load(sys.stdin); print('findings:', len(d['findings']))"
kill %1
```

Expected:
```
Agentic Code Review
findings: 3
```

If the HTML check fails, the import attribute embed didn't work — stop and investigate before proceeding.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "compile script: run Vite build before bun compile to embed HTML"
```

---

## Task 4: Clean up `serve-client.ts` imports and `install.sh`

**Files:**
- Modify: `packages/server/src/serve-client.ts` (remove now-unused node imports)
- Verify: `install.sh` (confirm no stale `index.html` copy needed)

- [ ] **Step 1: Verify `serve-client.ts` has no stale imports**

After Task 1, the file should only contain:

```ts
let cached: Response | null = null;

export function serveClient(html: string): Response {
  cached ??= new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return cached;
}
```

There should be **no** `import { resolve, dirname } from 'node:path'` or `import { readFileSync, existsSync } from 'node:fs'`. If Task 1 was done correctly these are already gone. If they're still there, remove them now.

- [ ] **Step 2: Check `install.sh` for any `index.html` copy logic**

```bash
grep -n "index\.html\|dist/" install.sh
```

The `download_server_binary()` function added in Task 24 of the architecture redesign creates `$target_dir/dist/review-server` (the binary). It does **not** copy an `index.html`. Confirm the output contains no line that copies `index.html` alongside the binary. If it does, remove that line.

- [ ] **Step 3: Run all tests**

```bash
/opt/homebrew/bin/bun test tests/ 2>&1
```

Expected: `12 pass  0 fail`

- [ ] **Step 4: Run the Node shim smoke test**

```bash
cp tests/fixtures/sample-review.json /tmp/claude-code-review-shim.json
node server/review-server.js --session shim --port 7794 --findings-file /tmp/claude-code-review-shim.json &
sleep 1
curl -s http://127.0.0.1:7794/ | grep -o 'Agentic Code Review'
kill %1
```

Expected: `Agentic Code Review` (shim finds the compiled binary in `dist/` and it now embeds the HTML).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/serve-client.ts install.sh
git commit -m "Remove stale filesystem imports from serve-client after HTML embed"
```

---

## Task 5: Audit build artifacts — `.bun-build` cache files and `dist/` gitignore

**Background you need before touching anything:**

When `bun build --compile` runs, it writes a content-addressed compile-cache file to the **current working directory** (the repo root), not next to `--outfile`. The file looks like `.18b32fdfe7ef3e7a-00000000.bun-build` — a hidden dot-file with a hash-based name. It is ~60 MB (the same size as the compiled binary) because it is essentially a cached copy of the binary.

There is **no Bun flag** to redirect where this file lands; it always goes to CWD. The only correct fix is to gitignore it.

Similarly, `dist/` (where the compiled binary lives) must be gitignored. The 60 MB binary must never be committed.

Both rules already exist in `.gitignore` as of this branch. This task verifies they are correct and adds a `bunfig.toml` comment to document the limitation for future developers.

**Files:**
- Verify: `.gitignore` (two rules: `*.bun-build` and `dist/`)
- Create: `bunfig.toml` (documents the `.bun-build` cache behavior)

- [ ] **Step 1: Confirm both gitignore rules are present**

```bash
grep -n "bun-build\|^dist/" .gitignore
```

Expected output (line numbers may differ):
```
19:*.bun-build
27:dist/
```

If `*.bun-build` is missing, add it. If `dist/` is missing, add it. The `.gitignore` block for Bun artifacts should read:

```
# Bun build artifacts
*.bun-build

# Bun workspace
node_modules/
packages/*/node_modules/
packages/client/dist/
packages/client/.vite/
bun.lockb
dist/
```

- [ ] **Step 2: Confirm existing `.bun-build` files are ignored**

```bash
git check-ignore -v .*.bun-build 2>/dev/null || echo "no .bun-build files present"
```

Expected: either `no .bun-build files present` (clean working tree), or a line like:
```
.gitignore:19:*.bun-build	.18b32fdfe7ef3e7a-00000000.bun-build
```

If the file is tracked (i.e. `git ls-files .*.bun-build` returns output), remove it from tracking:

```bash
git rm --cached .*.bun-build
```

- [ ] **Step 3: Confirm `dist/review-server` is ignored**

```bash
git check-ignore -v dist/review-server
```

Expected:
```
.gitignore:27:dist/	dist/review-server
```

If it shows as tracked, remove it:

```bash
git rm --cached dist/review-server
```

- [ ] **Step 4: Create `bunfig.toml` to document the cache behavior**

Bun reads `bunfig.toml` from the project root. This file is also where you would configure a custom cache dir if Bun ever adds that capability. Create it now as documentation:

```toml
# bunfig.toml — Bun workspace configuration
#
# Note on .bun-build files:
#   `bun build --compile` writes a content-addressed cache file (*.bun-build)
#   to the current working directory. There is no flag to change this location.
#   These files are gitignored via `*.bun-build` in .gitignore.
#   They are safe to delete at any time; Bun will recreate them on the next compile.
#
# The compiled binary itself is written to dist/review-server (also gitignored).
# To build: bun run compile  (runs `bun run build` then `bun build --compile`)
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore bunfig.toml
git commit -m "Document .bun-build cache behavior; confirm dist/ and *.bun-build are gitignored"
```

---

## Task 6: Update `.gitignore` and release workflow

**Files:**
- Verify: `.gitignore` (confirm `dist/` is still ignored — binaries and Vite output are both ephemeral)
- Modify: `.github/workflows/release.yml` (no `index.html` artifact upload needed)

- [ ] **Step 1: Confirm `.gitignore` is still correct after all prior tasks**

```bash
grep "^dist/\|bun-build" .gitignore
```

Expected:
```
*.bun-build
dist/
```

No change needed if both lines are present (Task 5 verified this earlier).

- [ ] **Step 2: Check the release workflow for stale `index.html` handling**

```bash
grep -n "index\.html" .github/workflows/release.yml
```

Expected: no output. If any lines reference copying or uploading `index.html`, remove them — the binary is now self-contained.

- [ ] **Step 3: Final end-to-end verification**

```bash
# Clean everything
rm -rf packages/client/dist dist/review-server

# Full rebuild + compile
/opt/homebrew/bin/bun run compile

# All tests
/opt/homebrew/bin/bun test tests/

# Binary smoke test (no index.html alongside it)
cp tests/fixtures/sample-review.json /tmp/claude-code-review-final.json
./dist/review-server --session final --port 7795 --findings-file /tmp/claude-code-review-final.json &
sleep 1
curl -s http://127.0.0.1:7795/ | grep -o 'Agentic Code Review' && echo "HTML: OK"
curl -s http://127.0.0.1:7795/api/review | python3 -c "import sys,json; d=json.load(sys.stdin); print('API: OK,', len(d['findings']), 'findings')"
kill %1
```

Expected:
```
HTML: OK
API: OK, 3 findings
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Verify release workflow needs no index.html upload (HTML embedded in binary)"
```

---

## Summary of what changes and why

| Concern | Before | After |
|---------|--------|-------|
| HTML at runtime | Read from disk (`dist/index.html` must exist next to binary) | Embedded in binary at compile time |
| `bun run compile` | Only compiles the server | Runs Vite first, then compiles (enforces correct order) |
| `serve-client.ts` | 28 lines with filesystem logic and path candidates | 5 lines — just wraps a string |
| Installation | Binary + `index.html` must both be downloaded/copied | Binary only |
| Dev mode | Works via `import.meta.dir` path candidate | Works identically — Bun handles `with { type: "text" }` in dev too |
| `.bun-build` cache files | Land in repo root (Bun behavior, no flag to change) | Gitignored via `*.bun-build`; documented in `bunfig.toml` |
| `dist/` folder | Gitignored | Gitignored (confirmed; binary never tracked) |
