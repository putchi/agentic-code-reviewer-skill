import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

// Resolves the path to the claude CLI for use in compiled binaries.
// Prefer explicit configuration, then an embedded SDK binary, then a normal
// claude executable on PATH. Passing an explicit path avoids the SDK's optional
// native-package lookup failing in installs that omitted optional deps.

let _resolved: string | null | undefined = undefined;

function executable(path: string): string | null {
  try {
    accessSync(path, constants.X_OK);
    return path;
  } catch {
    return null;
  }
}

function resolveFromPath(command: string): string | null {
  if (!command) return null;
  if (isAbsolute(command) || command.includes('/')) return executable(command);

  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const found = executable(join(dir, command + ext));
      if (found) return found;
    }
  }
  return null;
}

export async function resolveCLIPath(): Promise<string | null> {
  if (_resolved !== undefined) return _resolved;

  const explicit = process.env.ACR_CLAUDE_BIN || process.env.CLAUDE_CODE_EXECPATH;
  if (explicit) {
    _resolved = resolveFromPath(explicit) || explicit;
    return _resolved;
  }

  // In compiled binary mode, $bunfs paths are virtual — extract the embedded binary.
  // We try each platform package and catch if the import fails (wrong platform build).
  try {
    const platform = process.platform;
    const arch = process.arch;

    let binPath: string | null = null;

    if (platform === 'darwin' && arch === 'arm64') {
      const mod = await import('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude' as any);
      binPath = mod.default ?? mod;
    } else if (platform === 'darwin' && arch === 'x64') {
      const mod = await import('@anthropic-ai/claude-agent-sdk-darwin-x64/claude' as any);
      binPath = mod.default ?? mod;
    } else if (platform === 'linux') {
      const mod = await import('@anthropic-ai/claude-agent-sdk-linux-x64/claude' as any);
      binPath = mod.default ?? mod;
    }

    if (binPath) {
      if (binPath.startsWith('/$bunfs')) {
        const { extractFromBunfs } = await import('@anthropic-ai/claude-agent-sdk/extract' as any);
        _resolved = extractFromBunfs(binPath) as string;
        return _resolved;
      }
      const found = executable(binPath);
      if (found) {
        _resolved = found;
        return _resolved;
      }
    }
  } catch {
    // Not in compiled mode or platform package not available — fall through
  }

  _resolved = resolveFromPath('claude');
  return _resolved;
}
