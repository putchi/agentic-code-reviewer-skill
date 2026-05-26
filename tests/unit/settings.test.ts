import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLUGIN_ROOT } from '../../packages/server/src/config';
import { loadSettings, saveSettings } from '../../packages/server/src/settings';

const REAL_SETTINGS_FILE = resolve(PLUGIN_ROOT, 'settings.json');
const DEFAULT_FX = '/tmp/claude-code-review-unknown.json';

function cleanSettings() {
  if (existsSync(REAL_SETTINGS_FILE)) unlinkSync(REAL_SETTINGS_FILE);
}

describe('loadSettings', () => {
  beforeEach(cleanSettings);
  afterEach(cleanSettings);

  test('returns defaults when file does not exist', () => {
    const s = loadSettings();
    expect(s.autoCloseMs).toBe(0);
    expect(s.chatModel).toBe('claude-sonnet-4-6');
    expect(s.firstRunDone).toBe(false);
  });

  test('merges file values with defaults (missing keys filled in)', () => {
    writeFileSync(REAL_SETTINGS_FILE, JSON.stringify({ chatModel: 'claude-opus-4-7' }));
    const s = loadSettings();
    expect(s.chatModel).toBe('claude-opus-4-7');
    expect(s.autoCloseMs).toBe(0);
    expect(s.firstRunDone).toBe(false);
  });

  test('returns defaults when settings file has invalid JSON', () => {
    writeFileSync(REAL_SETTINGS_FILE, 'NOT_VALID_JSON');
    const s = loadSettings();
    expect(s.autoCloseMs).toBe(0);
    expect(s.chatModel).toBe('claude-sonnet-4-6');
  });
});

describe('saveSettings', () => {
  beforeEach(cleanSettings);
  afterEach(cleanSettings);

  test('persists only changed key; others remain at default', () => {
    saveSettings({ chatModel: 'claude-opus-4-7' });
    const s = loadSettings();
    expect(s.chatModel).toBe('claude-opus-4-7');
    expect(s.autoCloseMs).toBe(0);
    expect(s.firstRunDone).toBe(false);
  });

  test('returns updated settings', () => {
    const result = saveSettings({ firstRunDone: true });
    expect(result.firstRunDone).toBe(true);
  });

  test('firstRunDone persists across load/save cycle', () => {
    saveSettings({ firstRunDone: true });
    expect(loadSettings().firstRunDone).toBe(true);
  });
});

describe('settings response shape', () => {
  beforeEach(() => {
    cleanSettings();
    copyFileSync('tests/fixtures/sample-review.json', DEFAULT_FX);
  });
  afterEach(() => {
    cleanSettings();
    try { unlinkSync(DEFAULT_FX); } catch {}
  });

  test('loadSettings returns object with all required keys', () => {
    const s = loadSettings();
    expect('autoCloseMs' in s).toBe(true);
    expect('chatModel' in s).toBe(true);
    expect('firstRunDone' in s).toBe(true);
  });

  test('saveSettings response includes updated chatModel', () => {
    const result = saveSettings({ chatModel: 'claude-haiku-4-5-20251001' });
    expect(result.chatModel).toBe('claude-haiku-4-5-20251001');
    expect(loadSettings().chatModel).toBe('claude-haiku-4-5-20251001');
  });
});
