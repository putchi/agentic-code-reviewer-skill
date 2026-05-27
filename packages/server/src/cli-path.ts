// Resolves the path to the claude CLI for use in compiled binaries.
// In dev (non-compiled) mode, returns null — the SDK finds claude on PATH.
// In compiled mode, embeds the platform binary and extracts it via extractFromBunfs.

let _resolved: string | null | undefined = undefined;

export async function resolveCLIPath(): Promise<string | null> {
  if (_resolved !== undefined) return _resolved;

  // If CLAUDE_CODE_EXECPATH is set, the SDK will pick it up automatically — no need to pass explicitly.
  if (process.env.CLAUDE_CODE_EXECPATH) {
    _resolved = null;
    return null;
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

    if (binPath && binPath.startsWith('/$bunfs')) {
      const { extractFromBunfs } = await import('@anthropic-ai/claude-agent-sdk/extract' as any);
      _resolved = extractFromBunfs(binPath) as string;
      return _resolved;
    }
  } catch {
    // Not in compiled mode or platform package not available — fall through
  }

  _resolved = null;
  return null;
}
