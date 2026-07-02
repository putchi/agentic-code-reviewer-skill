# Fix PR review routing + Ask AI silent first reply

Date: 2026-07-02

## Issue 1 — `code-review <pr>` reviewed in the terminal instead of the Web UI

**Root cause:** the message "All findings scored below the 80-confidence
threshold required to post a review comment" does not exist anywhere in this
repo. It comes from Anthropic's official `code-review` plugin
(`code-review:code-review — Code review a pull request`), which is also
installed. ACR's `/code-review` command ignores `$ARGUMENTS` entirely (PR flow
lives only in `/pr-review`), so a `code-review <pr>` request routed to the
other plugin, which reviews inline and gates comments at confidence ≥ 80.

**Fix (in our control):**
1. `commands/code-review.md` — accept an optional PR ref: when `$ARGUMENTS` is
   non-empty, pass `--pr "$ARGUMENTS"` to `orchestrator.sh` (which already
   supports `--pr`). Update the command description accordingly.
2. `skills/agentic-code-reviewer/SKILL.md` — add trigger/doc line so
   "code-review PR #N" / "review PR #N with the agentic code reviewer" routes
   to the ACR PR flow (orchestrator `--pr`), and note the name collision with
   the official code-review plugin.
3. `CLAUDE.md` skill-layer paragraph — one line documenting that `/code-review`
   now forwards an argument as a PR ref.

**Assumption:** we cannot control which plugin Claude Code picks for a bare
`/code-review` collision; we can only make ACR's command handle the PR
argument so it does the right thing whenever ACR is chosen.

## Issue 2 — Ask AI: first question produced no visible reply

**Root cause chain (two layers):**
1. Server (`packages/server/src/routes/chat.ts`): Claude chat runs
   `sdkQuery` with `maxTurns: 3` and default tools enabled. If the model
   spends its turns on tool calls (e.g. trying to read PR-head files that
   don't exist in the local working tree), the run ends with a `result`
   message whose subtype is `error_max_turns` and **zero** `text_delta`
   events. `processSDKMessages` emits `{type:'result', success:false}`.
2. Client (`packages/client/src/hooks/useChat.ts`): `result` events are
   ignored; the `finally` block inserts an **empty** assistant message —
   which renders as no reply. The second "?" message resumed the session and
   the model then answered in text.

**Fix:**
1. `chat.ts` / `processSDKMessages`: track whether any `text_delta` was
   emitted; when the `result` arrives with subtype !== 'success' **or** no
   text was emitted, emit `{type:'error', message:'The assistant finished
   without a reply (<subtype>). Try asking again.'}` so the UI always shows
   something.
2. Reduce the trigger: bump `maxTurns` 3 → 8 for Claude chat.
3. `chat-context.ts` + `findings.ts`: the diff is already embedded (up to
   40KB) — the gap is full-file context at the PR head. `run.json` already
   stores PR metadata (`number`, `headRefName`, `baseRefName`, `url`) and the
   server already reads it. Surface it into `ReviewData` and, for PR runs,
   add a "## Pull Request" section to the chat system prompt: PR number/URL/
   branches, plus explicit instructions that the local working tree may not
   match the PR head — to read full files, run
   `gh pr diff <n>` / `gh api repos/<owner>/<repo>/contents/<path>?ref=<headRef>`
   or `git fetch origin <headRef>` + `git show FETCH_HEAD:<path>`; otherwise
   answer from the embedded diff.
4. Unit tests in `tests/unit/` for `processSDKMessages`: (a) non-success
   result with no text → error event emitted; (b) success with text →
   unchanged behavior. Plus a test that PR runs produce the "## Pull Request"
   section in the chat system prompt.

## Files to change
- `commands/code-review.md`
- `skills/agentic-code-reviewer/SKILL.md`
- `CLAUDE.md`
- `packages/server/src/routes/chat.ts`
- `packages/server/src/chat-context.ts`
- `packages/server/src/findings.ts` (expose `run.json` PR metadata on ReviewData)
- `packages/shared/src/types/` (optional `pr` field on ReviewData)
- `tests/unit/` (new/extended chat test)

## Release note
Server/client changes → next tag needs a review-server binary rebuild.
Command/skill/doc changes take effect from `main` immediately.
