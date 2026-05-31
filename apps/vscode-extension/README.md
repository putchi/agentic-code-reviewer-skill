# Agentic Code Reviewer for VS Code

<p align="center">
  <img src="https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/docs/assets/agentic-code-reviewer.png" alt="Agentic Code Reviewer brand image showing a robot inspecting code with a magnifying glass, a checklist, and an idea light bulb" width="180" />
</p>

Open Agentic Code Reviewer sessions inside VS Code editor tabs instead of sending them to an external browser. The extension is intended for Claude Code, Codex, and compatible agent launchers running in the VS Code integrated terminal.

## Details

Agentic Code Reviewer launches a local review UI. This extension registers a workspace-local IPC bridge and injects `ACR_BROWSER` and `ACR_VSCODE_PORT` into new integrated terminals so local review URLs open as VS Code webview tabs.

Each review tab proxies the localhost ACR server through a per-panel `127.0.0.1` proxy. The proxy preserves ACR cookies, forwards close signals back to VS Code, and keeps the review UI aligned with the active VS Code theme. From an active review, selected editor text can be attached as an ACR annotation and sent to the review server.

Use **Agentic Code Reviewer: Reset Settings to Defaults** to clear extension-local cookies, IPC state, active panels, and editor annotation state.

## Features

- Opens local ACR review sessions in VS Code webview tabs.
- Injects `ACR_BROWSER` and `ACR_VSCODE_PORT` into new integrated terminals.
- Proxies localhost review sessions so cookies, close signals, and VS Code theme sync work inside the webview.
- Adds editor-selection annotations to the active ACR session with `Cmd+Shift+.` or `Ctrl+Shift+.`.
- Resets extension-local cookies, IPC state, active panels, and editor annotations from the command palette.

## Setup

Install this extension, then open a new integrated terminal before launching Agentic Code Reviewer. Terminals opened before activation will not have the injected environment variables.

## Commands

| Command | Keybinding | Description |
| --- | --- | --- |
| Agentic Code Reviewer: Open URL in Editor | | Manually open a local ACR URL |
| Agentic Code Reviewer: Add Annotation | `Cmd+Shift+.` / `Ctrl+Shift+.` | Annotate selected editor text |
| Agentic Code Reviewer: Reset Settings to Defaults | | Reset extension-local state |

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `agenticCodeReviewerWebview.injectBrowser` | `true` | Redirect ACR browser opens into VS Code |
