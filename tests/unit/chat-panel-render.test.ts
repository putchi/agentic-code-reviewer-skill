import { describe, test, expect } from 'bun:test';
import { isMarkdownRole } from '../../packages/client/src/components/RightPanel/ChatPanel';

describe('ChatPanel rendering role selection', () => {
  test('AI messages use markdown rendering', () => {
    expect(isMarkdownRole('ai')).toBe(true);
  });

  test('error messages use markdown rendering', () => {
    expect(isMarkdownRole('error')).toBe(true);
  });

  test('user messages use plain text rendering', () => {
    expect(isMarkdownRole('user')).toBe(false);
  });
});
