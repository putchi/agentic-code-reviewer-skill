import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createIpcServer } from "./ipc-server";
import { createCookieProxy, type CookieProxy } from "./cookie-proxy";
import { PanelManager } from "./panel-manager";
import {
  resetEditorAnnotationState,
  setActiveProxyPort,
  registerEditorAnnotationCommand,
} from "./editor-annotations";

const IPC_PORT_KEY = "ipcPort";
const COOKIE_KEY = "acr-cookies";
const CONFIG_SECTION = "agenticCodeReviewerWebview";
const EXTENSION_ID = "agentic-code-reviewer-webview";

function getAcrDataDir(): string {
  const envDir = process.env.ACR_DATA_DIR?.trim();
  if (envDir) {
    if (envDir === "~") return os.homedir();
    if (envDir.startsWith("~/") || envDir.startsWith("~\\")) {
      return path.join(os.homedir(), envDir.slice(2));
    }
    return path.resolve(envDir);
  }
  return path.join(os.homedir(), ".claude", "agentic-code-reviewer");
}

const IPC_REGISTRY = path.join(getAcrDataDir(), "vscode-ipc.json");

function readIpcRegistry(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(IPC_REGISTRY, "utf-8"));
  } catch {
    return {};
  }
}

function writeIpcRegistry(registry: Record<string, number>): void {
  const dir = path.dirname(IPC_REGISTRY);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic tmp+rename so concurrent extension hosts never observe a torn file.
  // ponytail: last-writer-wins on concurrent updates; real locking only if
  // multi-window registration loss ever becomes a reported problem.
  const tmp = `${IPC_REGISTRY}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
  fs.renameSync(tmp, IPC_REGISTRY);
}

function registerIpcPort(workspacePath: string, port: number): void {
  const registry = readIpcRegistry();
  registry[workspacePath] = port;
  writeIpcRegistry(registry);
}

function unregisterIpcPort(workspacePath: string): void {
  const registry = readIpcRegistry();
  delete registry[workspacePath];
  writeIpcRegistry(registry);
}

function clearTerminalEnvironment(context: vscode.ExtensionContext): void {
  context.environmentVariableCollection.delete("ACR_BROWSER");
  context.environmentVariableCollection.delete("ACR_VSCODE_PORT");
  context.environmentVariableCollection.delete("PATH");
}

function applyTerminalEnvironment(context: vscode.ExtensionContext, port: number): void {
  clearTerminalEnvironment(context);

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const injectBrowser = config.get("injectBrowser", true) as boolean;
  if (!injectBrowser) return;

  const binDir = path.join(context.extensionPath, "bin");
  const routerPath = path.join(binDir, "open-in-vscode");
  context.environmentVariableCollection.replace("ACR_BROWSER", routerPath);
  context.environmentVariableCollection.replace("ACR_VSCODE_PORT", String(port));
  context.environmentVariableCollection.prepend("PATH", binDir + path.delimiter);
}

function closeProxy(proxy: CookieProxy): void {
  try {
    proxy.server.close();
  } catch {
    // Best-effort cleanup.
  }
}

const log = vscode.window.createOutputChannel("Agentic Code Reviewer", { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const panelManager = new PanelManager();
  panelManager.setExtensionPath(context.extensionPath);
  const activeProxies = new Set<CookieProxy>();

  const openInPanel = async (url: string) => {
    log.info(`[open] received url: ${url}`);

    const proxy = await createCookieProxy({
      loadCookies: () => {
        const cookies = context.globalState.get<string>(COOKIE_KEY) ?? "";
        log.info(`[load] ${cookies.length} chars`);
        return cookies;
      },
      onSaveCookies: (cookies) => {
        log.info(`[save] ${cookies.length} chars`);
        void context.globalState.update(COOKIE_KEY, cookies);
      },
      onClose: () => {
        log.info("[close] received close signal from Agentic Code Reviewer");
      },
    });
    activeProxies.add(proxy);

    const panel = await panelManager.open(proxy.rewriteUrl(url));
    setActiveProxyPort(proxy.port);
    proxy.events.on("close", () => panel.dispose());

    panel.onDidDispose(() => {
      closeProxy(proxy);
      activeProxies.delete(proxy);
      if (activeProxies.size === 0) {
        setActiveProxyPort(null);
      }
    });

    vscode.window.showInformationMessage("Agentic Code Reviewer panel opened");
  };

  const lastPort = context.workspaceState.get<number>(IPC_PORT_KEY);
  const { server, port } = await createIpcServer((url) => {
    openInPanel(url).catch((err) => {
      log.error(`[open] failed: ${err}`);
      vscode.window.showErrorMessage(`Agentic Code Reviewer: ${err}`);
    });
  }, lastPort);
  context.workspaceState.update(IPC_PORT_KEY, port);
  context.subscriptions.push({ dispose: () => server.close() });

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  if (workspacePath) {
    registerIpcPort(workspacePath, port);
    context.subscriptions.push({ dispose: () => unregisterIpcPort(workspacePath) });
  }

  applyTerminalEnvironment(context, port);

  const openCommand = vscode.commands.registerCommand(
    `${EXTENSION_ID}.openUrl`,
    async () => {
      const url = await vscode.window.showInputBox({
        prompt: "Enter the Agentic Code Reviewer URL to open",
        placeHolder: "http://127.0.0.1:7788",
      });
      if (url) {
        openInPanel(url).catch((err) => {
          log.error(`[open] failed: ${err}`);
          vscode.window.showErrorMessage(`Agentic Code Reviewer: ${err}`);
        });
      }
    },
  );
  context.subscriptions.push(openCommand);

  const resetCommand = vscode.commands.registerCommand(
    `${EXTENSION_ID}.resetSettings`,
    async () => {
      const confirmed = await vscode.window.showWarningMessage(
        "Reset Agentic Code Reviewer extension settings and close active review panels?",
        { modal: true },
        "Reset",
      );
      if (confirmed !== "Reset") return;

      await context.globalState.update(COOKIE_KEY, undefined);
      await context.workspaceState.update(IPC_PORT_KEY, undefined);
      clearTerminalEnvironment(context);

      panelManager.closeAll();
      for (const proxy of [...activeProxies]) {
        closeProxy(proxy);
      }
      activeProxies.clear();
      resetEditorAnnotationState();
      setActiveProxyPort(null);

      applyTerminalEnvironment(context, port);
      vscode.window.showInformationMessage("Agentic Code Reviewer extension settings reset.");
    },
  );
  context.subscriptions.push(resetCommand);

  registerEditorAnnotationCommand(context, log);
}

export function deactivate(): void {}
