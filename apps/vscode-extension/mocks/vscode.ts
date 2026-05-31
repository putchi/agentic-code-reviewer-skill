export interface UriHandler {
  handleUri(uri: Uri): ProviderResult<void>;
}

export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

export interface ExtensionContext {
  subscriptions: { dispose(): void }[];
  extensionPath: string;
  environmentVariableCollection: {
    replace(variable: string, value: string): void;
    append(variable: string, value: string): void;
    prepend(variable: string, value: string): void;
    delete(variable: string): void;
  };
  globalState: Memento;
  workspaceState: Memento;
}

export interface Memento {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export class Uri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
  fsPath: string;

  constructor(
    scheme: string,
    authority: string,
    pathValue: string,
    query: string,
    fragment: string,
  ) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = pathValue;
    this.query = query;
    this.fragment = fragment;
    this.fsPath = pathValue;
  }

  static file(fsPath: string): Uri {
    return new Uri("file", "", fsPath, "", "");
  }

  static parse(value: string): Uri {
    const parsed = new URL(value);
    return new Uri(
      parsed.protocol.replace(":", ""),
      parsed.host,
      parsed.pathname,
      parsed.search.replace("?", ""),
      parsed.hash.replace("#", ""),
    );
  }

  toString(): string {
    let result = `${this.scheme}://${this.authority}${this.path}`;
    if (this.query) result += `?${this.query}`;
    if (this.fragment) result += `#${this.fragment}`;
    return result;
  }
}

const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
    commandHandlers.set(id, handler);
    return {
      dispose() {
        commandHandlers.delete(id);
      },
    };
  },
  async executeCommand(command: string, ...args: unknown[]) {
    return commandHandlers.get(command)?.(...args);
  },
};

export interface WebviewPanel {
  webview: { html: string };
  iconPath?: Uri;
  reveal(viewColumn?: number): void;
  dispose(): void;
  onDidDispose(listener: () => void): { dispose(): void };
}

export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
};

let nextWarningResponse: string | undefined;

export const window = {
  registerUriHandler(_handler: unknown) {
    return { dispose() {} };
  },
  async showInformationMessage(_message: string) {
    return undefined;
  },
  async showWarningMessage(_message: string, _options?: unknown, ...items: string[]) {
    if (nextWarningResponse !== undefined) {
      const response = nextWarningResponse;
      nextWarningResponse = undefined;
      return response;
    }
    return items[0];
  },
  __setNextWarningResponse(response: string | undefined) {
    nextWarningResponse = response;
  },
  async showInputBox(_options?: unknown) {
    return undefined;
  },
  async showErrorMessage(_message: string) {
    return undefined;
  },
  createOutputChannel(_name: string, _options?: unknown) {
    return { info() {}, warn() {}, error() {}, debug() {}, appendLine() {}, dispose() {} };
  },
  createWebviewPanel(
    _viewType: string,
    _title: string,
    _showOptions: number,
    _options?: { enableScripts?: boolean },
  ): WebviewPanel {
    let disposeListener: (() => void) | null = null;
    return {
      webview: { html: "" },
      reveal() {},
      dispose() {
        disposeListener?.();
      },
      onDidDispose(listener: () => void) {
        disposeListener = listener;
        return { dispose() {} };
      },
    };
  },
  createTextEditorDecorationType(_options: unknown) {
    return { dispose() {} };
  },
  get activeTextEditor() {
    return undefined;
  },
  get visibleTextEditors(): TextEditor[] {
    return [];
  },
  onDidChangeActiveTextEditor(_listener: unknown) {
    return { dispose() {} };
  },
};

export const env = {
  async asExternalUri(uri: Uri): Promise<Uri> {
    return uri;
  },
};

export const comments = {
  createCommentController(_id: string, _label: string) {
    return {
      options: {},
      dispose() {},
      createCommentThread(_uri: Uri, _range: unknown, _comments: unknown[]) {
        return {
          uri: _uri,
          range: _range,
          comments: _comments,
          collapsibleState: 0,
          canReply: true,
          contextValue: "",
          dispose() {},
        };
      },
    };
  },
};

export class CodeAction {
  command?: { command: string; title: string };
  constructor(public title: string, public kind: unknown) {}
}

export const languages = {
  registerCodeActionsProvider(_selector: unknown, _provider: unknown, _metadata?: unknown) {
    return { dispose() {} };
  },
};

export class Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
  isEmpty: boolean;
  constructor(startLine: number | { line: number; character: number }, startChar?: number | { line: number; character: number }, endLine?: number, endChar?: number) {
    if (typeof startLine === "object") {
      this.start = startLine;
      this.end = startChar as { line: number; character: number };
    } else {
      this.start = { line: startLine, character: startChar as number };
      this.end = { line: endLine!, character: endChar! };
    }
    this.isEmpty = this.start.line === this.end.line && this.start.character === this.end.character;
  }
  isEqual(other: Range) {
    return this.start.line === other.start.line && this.start.character === other.start.character &&
      this.end.line === other.end.line && this.end.character === other.end.character;
  }
}

export interface TextEditor {
  document: { uri: Uri };
  setDecorations(decorationType: unknown, ranges: Range[]): void;
}

export interface CommentThread {
  uri: Uri;
  range?: Range;
  comments: Comment[];
  canReply: boolean;
  contextValue: string;
  dispose(): void;
}

export interface CommentReply {
  thread: CommentThread;
  text: string;
}

export interface Comment {
  body: string;
  mode: number;
  author: { name: string };
}

export const CommentMode = { Preview: 1, Editing: 0 };
export const CommentThreadCollapsibleState = { Collapsed: 0, Expanded: 1 };
export const CodeActionKind = {
  RefactorInline: { value: "refactor.inline" },
};
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };

export const workspace = {
  workspaceFolders: undefined as { uri: Uri }[] | undefined,
  getConfiguration(_section?: string) {
    return {
      get(_key: string, defaultValue?: unknown) {
        return defaultValue;
      },
    };
  },
  asRelativePath(uri: Uri, _includeWorkspaceFolder?: boolean) {
    return uri.fsPath.replace(/^\/workspace\//, "");
  },
  async openTextDocument(_uri: Uri) {
    return {
      getText(_range: unknown) {
        return "selected text";
      },
    };
  },
};

class MockEnvironmentVariableCollection {
  private vars = new Map<string, string>();

  replace(variable: string, value: string) {
    this.vars.set(variable, value);
  }

  append(variable: string, value: string) {
    this.vars.set(variable, (this.vars.get(variable) || "") + value);
  }

  prepend(variable: string, value: string) {
    this.vars.set(variable, value + (this.vars.get(variable) || ""));
  }

  delete(variable: string) {
    this.vars.delete(variable);
  }

  get(variable: string) {
    return this.vars.get(variable);
  }

  clear() {
    this.vars.clear();
  }

  [Symbol.iterator]() {
    return this.vars.entries();
  }
}

function createMemento(initial?: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return (store.has(key) ? store.get(key) : defaultValue) as T | undefined;
    },
    update(key: string, value: unknown): Promise<void> {
      if (value === undefined) store.delete(key);
      else store.set(key, value);
      return Promise.resolve();
    },
    _store: store,
  };
}

export function createMockExtensionContext(
  extensionPath = "/mock/extension/path",
  options?: {
    globalState?: Record<string, unknown>;
    workspaceState?: Record<string, unknown>;
  },
) {
  return {
    subscriptions: [] as { dispose: () => void }[],
    extensionPath,
    environmentVariableCollection: new MockEnvironmentVariableCollection(),
    globalState: createMemento(options?.globalState),
    workspaceState: createMemento(options?.workspaceState),
  };
}
