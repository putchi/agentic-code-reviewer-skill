export type RuntimePlatform = 'claude' | 'codex' | '';
export type ReviewProvider = 'claude' | 'codex';
export type ModelRole = 'balanced' | 'fast' | 'judge';
export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface RuntimeMetadata {
  platform: RuntimePlatform;
  provider: ReviewProvider;
  providerLabel: string;
  chatModel: string;
  chatModelLabel: string;
  modelRole: ModelRole;
}

interface RuntimeDetectionOptions {
  explicitPlatform?: string | null;
  pluginRoot?: string | null;
  env?: Record<string, string | undefined>;
}

const DEFAULT_CLAUDE_MODELS: Record<ModelRole, string> = {
  balanced: 'sonnet',
  fast: 'haiku',
  judge: 'opus',
};

const DEFAULT_CODEX_MODELS: Record<ModelRole, string> = {
  balanced: 'gpt-5.4',
  fast: 'gpt-5.4-mini',
  judge: 'gpt-5.5',
};

const DEFAULT_CODEX_REASONING: Record<ModelRole, CodexReasoningEffort> = {
  balanced: 'medium',
  fast: 'low',
  judge: 'high',
};

export function normalizeRuntimePlatform(value?: string | null): RuntimePlatform {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'claude-code' || normalized === 'claudecode') return 'claude';
  if (normalized === 'codex' || normalized === 'openai' || normalized === 'openai-codex') return 'codex';
  return '';
}

export function normalizeReviewProvider(value?: string | null): ReviewProvider | null {
  const normalized = normalizeRuntimePlatform(value);
  return normalized === 'claude' || normalized === 'codex' ? normalized : null;
}

export function resolveRuntimePlatform(options: RuntimeDetectionOptions = {}): RuntimePlatform {
  const env = options.env ?? process.env;
  const envPlatform = normalizeRuntimePlatform(env.ACR_PLATFORM);
  if (envPlatform) return envPlatform;

  const cliPlatform = normalizeRuntimePlatform(options.explicitPlatform);
  if (cliPlatform) return cliPlatform;

  if (env.CLAUDE_SESSION_ID) return 'claude';
  if (env.CODEX_THREAD_ID) return 'codex';

  const root = options.pluginRoot || '';
  if (root.includes('/.codex/skills/')) return 'codex';
  if (root.includes('/.claude/plugins/') || root.includes('/.claude/')) return 'claude';

  return '';
}

export function resolveReviewProvider(platform: RuntimePlatform, env: Record<string, string | undefined> = process.env): ReviewProvider {
  const override = normalizeReviewProvider(env.ACR_REVIEW_PROVIDER);
  if (override) return override;
  return platform === 'codex' ? 'codex' : 'claude';
}

export function resolveModelForRole(provider: ReviewProvider, role: ModelRole, env: Record<string, string | undefined> = process.env): string {
  const overrideKey = role === 'balanced'
    ? 'ACR_MODEL_BALANCED'
    : role === 'fast'
      ? 'ACR_MODEL_FAST'
      : 'ACR_MODEL_JUDGE';
  const override = env[overrideKey]?.trim();
  if (override) return override;
  return provider === 'codex' ? DEFAULT_CODEX_MODELS[role] : DEFAULT_CLAUDE_MODELS[role];
}

export function resolveCodexReasoningForRole(role: ModelRole, env: Record<string, string | undefined> = process.env): CodexReasoningEffort {
  const overrideKey = role === 'balanced'
    ? 'ACR_CODEX_REASONING_BALANCED'
    : role === 'fast'
      ? 'ACR_CODEX_REASONING_FAST'
      : 'ACR_CODEX_REASONING_JUDGE';
  const override = env[overrideKey]?.trim().toLowerCase();
  if (override === 'minimal' || override === 'low' || override === 'medium' || override === 'high' || override === 'xhigh') {
    return override;
  }
  return DEFAULT_CODEX_REASONING[role];
}

export function providerLabel(provider: ReviewProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

export function formatModelLabel(provider: ReviewProvider, model: string): string {
  const lower = model.toLowerCase();
  if (provider === 'claude') {
    if (lower === 'sonnet' || lower.includes('sonnet')) return 'Claude Sonnet';
    if (lower === 'haiku' || lower.includes('haiku')) return 'Claude Haiku';
    if (lower === 'opus' || lower.includes('opus')) return 'Claude Opus';
    return model.startsWith('claude') ? model : `Claude ${model}`;
  }
  return model
    .replace(/^gpt-/, 'GPT-')
    .replace(/-mini$/i, ' Mini')
    .replace(/-codex/i, ' Codex')
    .replace(/-spark/i, ' Spark');
}

export function buildRuntimeMetadata(options: RuntimeDetectionOptions & { modelRole?: ModelRole } = {}): RuntimeMetadata {
  const env = options.env ?? process.env;
  const platform = resolveRuntimePlatform(options);
  const provider = resolveReviewProvider(platform, env);
  const modelRole = options.modelRole ?? 'balanced';
  const chatModel = resolveModelForRole(provider, modelRole, env);
  return {
    platform,
    provider,
    providerLabel: providerLabel(provider),
    chatModel,
    chatModelLabel: formatModelLabel(provider, chatModel),
    modelRole,
  };
}
