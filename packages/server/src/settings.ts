import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { PLUGIN_ROOT, detectPlatform } from './config';
import { buildRuntimeMetadata, type RuntimeMetadata } from './runtime';

interface PersistedSettings {
  autoCloseMs: number;
  firstRunDone: boolean;
}

export interface Settings extends RuntimeMetadata {
  autoCloseMs: number;
  firstRunDone: boolean;
}

const DEFAULTS: PersistedSettings = {
  autoCloseMs: 0,
  firstRunDone: false,
};

const SETTINGS_FILENAME = 'settings.json';

export function resolveSettingsFile(): string {
  if (process.env.ACR_SETTINGS_FILE) return resolve(process.env.ACR_SETTINGS_FILE);
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const dir = process.env.ACR_SETTINGS_DIR || resolve(home, '.claude', 'agentic-code-reviewer');
  return resolve(dir, SETTINGS_FILENAME);
}

export function resolveLegacySettingsFile(): string {
  return resolve(PLUGIN_ROOT, SETTINGS_FILENAME);
}

function hasExplicitSettingsPath(): boolean {
  return Boolean(process.env.ACR_SETTINGS_FILE || process.env.ACR_SETTINGS_DIR);
}

function hydrateSettings(settings: Partial<PersistedSettings> | null): Settings {
  return {
    ...DEFAULTS,
    ...(settings || {}),
    ...buildRuntimeMetadata({ explicitPlatform: detectPlatform(), pluginRoot: PLUGIN_ROOT, modelRole: 'balanced' }),
  };
}

function readSettingsFile(path: string): PersistedSettings | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<PersistedSettings> & { chatModel?: string };
  return {
    autoCloseMs: typeof parsed.autoCloseMs === 'number' ? parsed.autoCloseMs : DEFAULTS.autoCloseMs,
    firstRunDone: typeof parsed.firstRunDone === 'boolean' ? parsed.firstRunDone : DEFAULTS.firstRunDone,
  };
}

function toPersistedSettings(settings: Partial<Settings>): PersistedSettings {
  return {
    autoCloseMs: typeof settings.autoCloseMs === 'number' ? settings.autoCloseMs : DEFAULTS.autoCloseMs,
    firstRunDone: typeof settings.firstRunDone === 'boolean' ? settings.firstRunDone : DEFAULTS.firstRunDone,
  };
}

function writeSettingsFile(path: string, settings: PersistedSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  renameSync(tmp, path);
}

export function loadSettings(): Settings {
  try {
    const settingsFile = resolveSettingsFile();
    const persisted = readSettingsFile(settingsFile);
    if (persisted) return hydrateSettings(persisted);

    if (!hasExplicitSettingsPath()) {
      const legacySettingsFile = resolveLegacySettingsFile();
      if (legacySettingsFile !== settingsFile) {
        const legacy = readSettingsFile(legacySettingsFile);
        if (legacy) {
          try {
            writeSettingsFile(settingsFile, legacy);
          } catch {
            // Loading legacy settings is still better than forcing first-run again.
          }
          return hydrateSettings(legacy);
        }
      }
    }
  } catch {
    // Fall through to defaults when persisted settings are unreadable.
  }
  return hydrateSettings(DEFAULTS);
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = loadSettings();
  const updated = toPersistedSettings({ ...current, ...patch });
  try {
    writeSettingsFile(resolveSettingsFile(), updated);
  } catch (e: any) {
    throw new Error(`Failed to save settings to ${resolveSettingsFile()}: ${e.message}`);
  }
  return hydrateSettings(updated);
}

export function resetSettings(): Settings {
  const current = loadSettings();
  const updated: PersistedSettings = {
    ...DEFAULTS,
    firstRunDone: current.firstRunDone,
  };
  try {
    writeSettingsFile(resolveSettingsFile(), updated);
  } catch (e: any) {
    throw new Error(`Failed to reset settings at ${resolveSettingsFile()}: ${e.message}`);
  }
  return hydrateSettings(updated);
}
