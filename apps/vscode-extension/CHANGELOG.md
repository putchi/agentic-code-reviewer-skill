# Changelog

## [1.4.11] - 2026-06-10

### Fixed

- Stop hook no longer emits invalid JSON — `allow_stop()` now exits with no output, matching the Claude Code schema (`"approve"` | `"block"` only; `"allow"` was never valid).
- Review UI no longer opens a blank tab when the server is launched without a run directory (dev mode, stray launches). Legacy `--findings-file` launches still auto-open as before.
- Zero-findings reviews no longer open the review UI — synthesis that produces no findings writes a `READY` sentinel and exits silently. The Stop hook treats this as a clean allow.
- `diff_too_small` and `no_findings` statuses are now recognized as terminal allow statuses in the Stop hook gate, preventing hangs on otherwise-clean exits.

## [1.4.10] - 2026-06-09

### Fixed

- Action bar buttons (Implement / Dismiss / Save / Close) rendered correctly across all panel states.
- Copy-to-clipboard now works for finding code snippets and code blocks in the chat panel.
- `.gitignore` patterns are now respected when computing the reviewable diff.

## [1.4.9] - 2026-06-09

### Fixed

- Stop-hook JSON output validated against the correct schema.
- Deduplication quality improvements: near-duplicate findings from different reviewers are merged more reliably.
- `.acrignore` file support: project-level file exclusions for the review diff.
- `outOfScope` config key wired end-to-end from `.acr.json` to the diff scope resolver.
- Findings detail panel layout and overflow rendering fixed.

## [1.4.8] - 2026-06-04

### Fixed

- `.acr.json` is now read from the working tree when not yet committed, so a freshly created config file takes effect without requiring a commit.

## [1.4.7] - 2026-06-01

### Added

- Zod schemas for all review data types — malformed synthesis output is caught and reported rather than silently dropped.
- Reviewer retry logic: a failed reviewer agent retries once before being marked failed.
- Resume artifact written to the run directory so `/review-resume` can reconstruct context after a session restart.
- Smoke tests for the orchestrator launch and port-binding paths.

### Fixed

- `.mcp.json` structure corrected to use the `mcpServers` wrapper key.
- Action bar labels shortened for cleaner display at narrow widths.
- Chat panel "Thinking…" spinner no longer sticks after the response completes.

## [1.4.6] - 2026-05-31

### Changed

- Internal version alignment across plugin manifests.

## [1.4.5] - 2026-05-31

### Changed

- Refreshed the VS Code Marketplace README with the current webview tab, terminal environment injection, localhost proxy, theme sync, editor annotation, and reset command behavior.
- Replaced the marketplace README image reference with an absolute GitHub raw URL for the shared Agentic Code Reviewer brand asset.

## [0.1.0] - 2026-05-31

### Added

- Initial Agentic Code Reviewer VS Code webview extension.
- Local IPC router for `ACR_BROWSER`.
- Per-panel cookie proxy, close signal handling, and VS Code theme bridge.
- Editor-selection annotations posted back to the active ACR server.
- Reset command for extension-local state.
