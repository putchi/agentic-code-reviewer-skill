# v1.5.0 / v1.5.1 Hardening Sessions — Plan, Implementation, and Summary

Date: 2026-07-01 · Releases: v1.5.0, v1.5.1 (+ two follow-up commits on main)

## Goal

Make agentic-code-reviewer the "go-to" agentic review tool: add a configuration
sub-skill, fix every confirmed bug across scripts/server/client/extension,
reduce false positives from the reviewer agents, cut runtime cost, and keep
Claude Code / Codex parity.

## Method

Two review rounds, both with adversarial verification:

1. **Round 1 (v1.5.0)** — 3 parallel exploration agents over scripts/hooks,
   server/client, and agent prompts. Findings triaged by hand; false positives
   rejected before implementation.
2. **Round 2 (v1.5.1)** — 48-agent workflow: 7 dimension finders (install/hooks,
   VS Code extension, client UI, server routes, orchestration, perf/cost, UX)
   with every finding re-verified against current code by an adversarial agent.
   Result: 35 confirmed, 6 refuted by verification, ~5 more rejected in triage.

---

## v1.5.0 — acr-config sub-skill + hardening pass

### A. New `acr-config` sub-skill
- `skills/acr-config/SKILL.md` — creates/updates `.acr.json` from natural
  intents ("stop reviewing, I'm still working" → `stopHookMode: disabled`,
  "never review" → `disableStopHook`, scope exclusions, model overrides).
- `commands/acr-config.md` — `/acr-config` slash command.
- Skip counter in `scripts/review-gate.py` — consecutive `no`/`skip` gate
  answers tracked per repo in `~/.claude/agentic-code-reviewer/skip-counts.json`;
  at 3+ the gate suggests `/acr-config`. `yes` resets.

### B. Runtime script fixes (`scripts/`)
- `orchestrator.py`: reviewer log fd leak (close parent copy after spawn);
  reap killed reviewer/UI processes (`proc.wait`); synthesizer
  `TimeoutExpired` → clear error + fallback path; fallback-synthesis return
  code checked into `run.json`.
- `review-gate.py`: confirmation-claim write failures no longer fake success
  (double-consume risk); skip counter (above).
- `codex-install-config.py`: PID-based temp file → `tempfile.mkstemp` atomic
  write.
- `run-reviewer.sh`: full stderr path referenced in errors; empty provider
  output now feeds the retry loop via a validation-error sidecar instead of
  failing silently; outdated-Codex-CLI hint on flag-parse errors.
- **Bonus real bug**: `validate_reviewer` accepted `status:"failed"`, making
  the entire reviewer retry loop dead code. Fixed — retries now actually run.

### C. Server / web UI fixes
- SSE chat streams reset the 30-min idle timer (long Ask-AI sessions no longer
  killed mid-stream).
- Atomic `decisions.json` / `.done` / `run.json` writes (`fs-atomic.ts`).
- 400 on malformed JSON bodies; finding actions validated against
  `FINDING_ACTIONS`.
- Editor annotations: path validation (no absolute//`..`/drive paths),
  integer line ranges, 500-entry cap.
- Chat session map FIFO-capped at 20; auto-resume fallback command
  shell-quoted; >40KB chat diff truncation now flagged to the model.
- Client: memoized diff parsing (biggest render win), review-fetch retry with
  "server closed — use /review-last" message, SSE parse errors surfaced,
  chat abort ordering fixed, annotation polling 500ms → 2s, localStorage
  failures logged.

### D. Anti-false-positive hardening
- All 5 reviewer prompts gained a **Reporting Discipline** block: zero
  findings is success; evidence must quote exact diff lines; mandatory
  calibrated `confidence`; self-refutation step; severity anti-inflation;
  truncated-context caution.
- Synthesizer: evidence cross-check (quote-exists ≠ claim-proven), refutation
  rule, precise "speculative" definition, verdict-must-match-findings rule.
- `claude_json.py` mechanical validation: findings **fail validation** (→
  retry with feedback) on missing confidence, line ≤ 0, empty file/evidence,
  or file not present in the diff; severity coercions logged to a warnings
  sidecar; synthesis rejects "ship as-is" verdicts alongside CRITICAL
  findings.
- Docs/frontmatter: all commands standardized (`name:` + async-behavior
  descriptions); SKILL.md reframed from "architecture documentation" to an
  invocable skill (Codex discovery).

---

## v1.5.1 — fan-out sweep fixes + cost controls

### Fixed (24 of 35 confirmed findings; the rest rejected in triage)
- **Install/hooks**: update message no longer suggests invalid
  `..., then /reload-plugins` shell syntax; Linux ARM64 supported
  (`linux-arm64` added to the release matrix + `uname -m` detection in
  `install.sh`) — first release with 4 binaries.
- **VS Code extension**: atomic IPC-registry writes; 10s HTTP timeout +
  Buffer-safe response handling (was `string += Buffer`, corrupting split
  multibyte chars); theme-bridge postMessage origin pinning + inbound CSS
  token validation; cookie POST capped at 16KB.
- **Client**: comment drafts FIFO-capped (100); "Saved" toast auto-dismisses;
  chat errors append instead of wiping streamed partial content.
- **Server**: port collision → graceful fallback to OS-assigned port;
  `readFindings()` mtime-cached (was re-parsing synthesis+context+diff+5
  agent files and shelling out to `git config` on every request).
- **Orchestration/UX**: top-level failure handler writes `status: failed` so
  the launcher poll stops immediately (was the "hangs 30 minutes" root
  cause); PR-mode `gh` failures produce a clear auth-hint error; run-dir
  retention (keep `ACR_RUNS_KEEP`, default 20); first-run modal explains how
  to change models; README Troubleshooting table.
- **Cost** (the big ones):
  - Zero-findings shortcut: all 5 reviewers clean → the synthesizer (most
    expensive judge-tier call) is skipped, verdict written deterministically.
  - Diff cap: `ACR_MAX_DIFF_BYTES` (400KB default) truncates at file
    boundaries with an explicit notice; the diff hash stays the full diff's
    hash so gate reuse/staleness still works.

### Model/effort audit (same release)
- Claude defaults stay as CLI aliases (`sonnet`/`haiku`/`opus`) — they resolve
  to the latest of each family (Sonnet 5 / Haiku 4.5 / Opus 4.8 today) and
  self-upgrade with the CLI. Pinning would go stale.
- **Judge effort `high` → `xhigh`** on both providers (Opus and `gpt-5.5`) —
  one call per run, the most intelligence-critical one.
- README `.acr.json` example modernized (`claude-sonnet-4-6` →
  `claude-sonnet-5`).

---

## Post-release commits on main (no tag needed — no server/client changes)
- `215b7c5` — docs accuracy pass (commands, repo tree, validation guarantees,
  artifact sidecars).
- `d81a5b5` — `tests/python/test_gate_confirmation.py`: stop-hook confirmation
  state machine tests (yes/no/skip classification incl. "yesterday"/"note"
  traps, marker lifecycle/expiry, one-time claim idempotency).

## Rejected findings (intentional designs — do not "fix")
- `gpt-5.4` / `gpt-5.4-mini` / `gpt-5.5` Codex defaults are the documented
  model set, not typos.
- Literal `/tmp/claude-code-review-*` sentinel paths are hardcoded on both
  sides (TS server + Python gate) deliberately; `tempfile.gettempdir()` would
  desync them on macOS.
- The synthesizer receives the full diff on purpose — required for the
  evidence cross-check rule.
- UI server outliving the orchestrator is by design; the 30-min idle
  shutdown is the cleanup.
- Background review continuing past the gate deadline is by design
  (`/review-last` picks it up); mid-run diff divergence is handled by the
  stale-hash check at decision time.

## Verification performed
- 167 bun + 30 python + 18 VS Code extension tests green.
- `bun run build` + `compile` + extension build clean.
- Stubbed-provider e2e: finding path → `awaiting_decisions` + UI; clean path
  → `no_findings` with no synthesizer prompt written; live HTTP checks of the
  new 400s and atomic saves; no leftover processes.
- v1.5.0 and v1.5.1 release CI green; v1.5.1 attaches all four binaries
  (darwin-arm64/x64, linux-x64/arm64).
