import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

const SETTINGS_FILE = resolve(PLUGIN_ROOT, 'settings.json');

export function loadSettings(): Settings {
  if (!existsSync(SETTINGS_FILE)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = loadSettings();
  const updated = { ...current, ...patch };
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
  } catch (e: any) {
    throw new Error(`Failed to save settings to ${SETTINGS_FILE}: ${e.message}`);
  }
  return updated;
}
