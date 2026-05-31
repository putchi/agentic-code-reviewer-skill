# Agentic Code Reviewer for VS Code

<p align="center">
  <img src="images/icon.png" alt="Agentic Code Reviewer brand image showing a robot inspecting code with a magnifying glass, a checklist, and an idea light bulb" width="128" />
</p>

Opens Agentic Code Reviewer sessions inside VS Code tabs instead of an external browser. It is intended for Claude Code, Codex, and other agents launched from the VS Code integrated terminal.

## Features

- Opens ACR review sessions in a VS Code webview tab.
- Injects `ACR_BROWSER` and `ACR_VSCODE_PORT` into new integrated terminals.
- Proxies localhost review sessions so cookies, close signals, and theme sync work inside the iframe.
- Lets you select code in the editor and add review annotations with `Cmd+Shift+.` or `Ctrl+Shift+.`.
- Provides a reset command for extension-local cookies, IPC state, panels, and editor annotations.

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
