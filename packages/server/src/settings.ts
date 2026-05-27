import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { PLUGIN_ROOT } from './config';

export interface Settings {
  autoCloseMs: number;
  chatModel: string;
  firstRunDone: boolean;
}

const DEFAULTS: Settings = {
  autoCloseMs: 0,
  chatModel: 'claude-sonnet-4-6',
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

function readSettingsFile(path: string): Settings | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<Settings>;
  return { ...DEFAULTS, ...parsed };
}

function writeSettingsFile(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  renameSync(tmp, path);
}

export function loadSettings(): Settings {
  try {
    const settingsFile = resolveSettingsFile();
    const persisted = readSettingsFile(settingsFile);
    if (persisted) return persisted;

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
          return legacy;
        }
      }
    }
  } catch {
    // Fall through to defaults when persisted settings are unreadable.
  }
  return { ...DEFAULTS };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = loadSettings();
  const updated = { ...current, ...patch };
  try {
    writeSettingsFile(resolveSettingsFile(), updated);
  } catch (e: any) {
    throw new Error(`Failed to save settings to ${resolveSettingsFile()}: ${e.message}`);
  }
  return updated;
}
