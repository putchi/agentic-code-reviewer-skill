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
  process.env.ACR_PLATFORM = 'claude';
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
    delete process.env.ACR_PLATFORM;
    settingsDir = '';
  });

  test('returns defaults when file does not exist', () => {
    const s = loadSettings();
    expect(s.autoCloseMs).toBe(0);
    expect(s.provider).toBe('claude');
    expect(s.chatModel).toBe('sonnet');
    expect(s.chatModelLabel).toBe('Claude Sonnet');
    expect(s.firstRunDone).toBe(false);
  });

  test('migrates legacy chatModel values to read-only runtime metadata', () => {
    writeSettings({ chatModel: 'claude-opus-4-7' });
    const s = loadSettings();
    expect(s.chatModel).toBe('sonnet');
    expect(s.autoCloseMs).toBe(0);
    expect(s.firstRunDone).toBe(false);
  });

  test('returns defaults when settings file has invalid JSON', () => {
    writeSettings('NOT_VALID_JSON');
    const s = loadSettings();
    expect(s.autoCloseMs).toBe(0);
    expect(s.chatModel).toBe('sonnet');
  });
});

describe('saveSettings', () => {
  beforeEach(cleanSettings);
  afterEach(() => {
    if (settingsDir) rmSync(settingsDir, { recursive: true, force: true });
    delete process.env.ACR_SETTINGS_DIR;
    delete process.env.ACR_PLATFORM;
    settingsDir = '';
  });

  test('persists only changed key; others remain at default', () => {
    saveSettings({ autoCloseMs: 5000 });
    const s = loadSettings();
    expect(s.chatModel).toBe('sonnet');
    expect(s.autoCloseMs).toBe(5000);
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
    delete process.env.ACR_PLATFORM;
    settingsDir = '';
    try { unlinkSync(DEFAULT_FX); } catch {}
  });

  test('loadSettings returns object with all required keys', () => {
    const s = loadSettings();
    expect('autoCloseMs' in s).toBe(true);
    expect('chatModel' in s).toBe(true);
    expect('chatModelLabel' in s).toBe(true);
    expect('platform' in s).toBe(true);
    expect('provider' in s).toBe(true);
    expect('providerLabel' in s).toBe(true);
    expect('modelRole' in s).toBe(true);
    expect('firstRunDone' in s).toBe(true);
  });

  test('saveSettings ignores readonly chatModel patches', () => {
    const result = saveSettings({ chatModel: 'claude-haiku-4-5-20251001' });
    expect(result.chatModel).toBe('sonnet');
    expect(loadSettings().chatModel).toBe('sonnet');
  });
});
