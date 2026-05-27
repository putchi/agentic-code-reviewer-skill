import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, copyFileSync, mkdtempSync, rmSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadSettings, resolveSettingsFile, saveSettings } from '../../packages/server/src/settings';

const DEFAULT_FX = '/tmp/claude-code-review-unknown.json';
let settingsDir = '';

function cleanSettings() {
  if (settingsDir) rmSync(settingsDir, { recursive: true, force: true });
  settingsDir = mkdtempSync(resolve(tmpdir(), 'acr-settings-test-'));
  process.env.ACR_SETTINGS_DIR = settingsDir;
}

function settingsFile() {
  return resolveSettingsFile();
}

function writeSettings(data: unknown) {
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(settingsFile(), typeof data === 'string' ? data : JSON.stringify(data));
}

describe('loadSettings', () => {
  beforeEach(cleanSettings);
  afterEach(() => {
    if (settingsDir) rmSync(settingsDir, { recursive: true, force: true });
    delete process.env.ACR_SETTINGS_DIR;
    settingsDir = '';
  });

  test('returns defaults when file does not exist', () => {
    const s = loadSettings();
    expect(s.autoCloseMs).toBe(0);
    expect(s.chatModel).toBe('claude-sonnet-4-6');
    expect(s.firstRunDone).toBe(false);
  });

  test('merges file values with defaults (missing keys filled in)', () => {
    writeSettings({ chatModel: 'claude-opus-4-7' });
    const s = loadSettings();
    expect(s.chatModel).toBe('claude-opus-4-7');
    expect(s.autoCloseMs).toBe(0);
    expect(s.firstRunDone).toBe(false);
  });

  test('returns defaults when settings file has invalid JSON', () => {
    writeSettings('NOT_VALID_JSON');
    const s = loadSettings();
    expect(s.autoCloseMs).toBe(0);
    expect(s.chatModel).toBe('claude-sonnet-4-6');
  });
});

describe('saveSettings', () => {
  beforeEach(cleanSettings);
  afterEach(() => {
    if (settingsDir) rmSync(settingsDir, { recursive: true, force: true });
    delete process.env.ACR_SETTINGS_DIR;
    settingsDir = '';
  });

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
    if (settingsDir) rmSync(settingsDir, { recursive: true, force: true });
    delete process.env.ACR_SETTINGS_DIR;
    settingsDir = '';
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
