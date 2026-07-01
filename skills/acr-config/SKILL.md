---
name: acr-config
description: >
  Configure the Agentic Code Reviewer for this repo by creating or updating
  .acr.json. Use when the user asks to configure code review, create or edit
  .acr.json, stop or pause reviews while they are still working, disable or
  re-enable the review gate, skip code reviews for this repo, exclude files or
  folders from review, or change review models. Also use proactively when the
  user has repeatedly declined the review-gate prompt.
---

# Configure Agentic Code Reviewer (.acr.json)

Create or update the repo-level `.acr.json` that controls the Agentic Code
Reviewer's Stop-hook gate, model choices, and review scope.

## Recognized `.acr.json` keys

Only these keys are read — never write anything else:

| Key | Type | Effect |
|---|---|---|
| `disableStopHook` | boolean | `true` fully disables the session-exit review gate for this repo |
| `stopHookMode` | `"prompt"` \| `"auto"` \| `"disabled"` | Gate behavior: ask before reviewing, review automatically, or stay silent |
| `models` | object | Per-role model overrides: `{ "balanced": "...", "fast": "...", "judge": "..." }`. Values must be **full model IDs** (e.g. `claude-haiku-4-5-20251001`), not aliases |
| `outOfScope` | string[] | Glob patterns for changed files reviewers should treat as out of scope (only CRITICAL security findings are kept for them) |

Related: a repo-level `.acrignore` file (gitignore-style patterns, no `!`
negation) excludes files from the review diff entirely.

## Steps

1. **Read existing config.** Check the working tree `.acr.json` first, then
   `git show HEAD:.acr.json`. Also check `.acrignore`. Preserve any existing
   keys you are not changing.

2. **Map the user's intent:**
   - *"Stop reviewing, I'm still working" / "pause reviews"* → set
     `"stopHookMode": "disabled"`. Mention the session-only alternative
     (`export ACR_STOP_HOOK_MODE=disabled`) and how to re-enable
     (`"stopHookMode": "prompt"` or delete the key).
   - *"Never review this repo"* → set `"disableStopHook": true`.
   - *"Only review when I ask"* → set `"stopHookMode": "disabled"` and note
     `/code-review` still works manually.
   - *"Ask me before reviewing"* → `"stopHookMode": "prompt"` (the default).
   - *"Review automatically"* → `"stopHookMode": "auto"`.
   - *"Reviews are too slow"* → suggest faster `models` overrides and pruning
     scope with `outOfScope` / `.acrignore`.
   - *"Don't review X"* → add glob(s) to `outOfScope` (kept but deprioritized)
     or `.acrignore` (excluded from the diff entirely). Prefer `outOfScope`
     unless the user explicitly wants files invisible to reviewers.

3. **Propose scope exclusions when creating a new file.** Inspect the project
   and suggest `outOfScope` globs for: generated code, vendored dirs,
   migrations, snapshots/fixtures (e.g. `**/__snapshots__/**`,
   `migrations/**`, `vendor/**`, `**/*.generated.*`). Lockfiles, minified
   assets, images, and build dirs are already excluded from the diff by
   default — do not add them. Show the proposed JSON and ask the user to
   confirm before writing.

4. **Write the file.** Valid JSON, 2-space indent, only recognized keys.
   `.acr.json` takes effect immediately — no commit needed (the gate reads
   HEAD first, then falls back to the working tree). Suggest committing it if
   the team should share the config.

5. **Confirm.** Summarize what changed and what behavior to expect at the next
   session exit.

## Proactive suggestion

The review gate records consecutive `no`/`skip` answers per repo in
`~/.claude/agentic-code-reviewer/skip-counts.json` (or `$ACR_SETTINGS_DIR`).
When the user has skipped 3+ prompts in a row, or their messages indicate they
are mid-work and don't want reviews yet, offer once — do not nag:

> You've skipped the last N review prompts. Want me to create `.acr.json` with
> `"stopHookMode": "disabled"` so the gate stays quiet while you work? You can
> re-enable it later or keep using `/code-review` manually.

Only write the file after the user agrees.
