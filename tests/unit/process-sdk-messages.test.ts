import { describe, test, expect } from 'bun:test';
import { processSDKMessages } from '../../packages/server/src/routes/chat';

async function* makeStream(...msgs: unknown[]) {
  for (const m of msgs) yield m;
}

describe('processSDKMessages', () => {
  test('emits text_delta from stream_event messages', async () => {
    const emitted: unknown[] = [];
    const session = { resolvedSessionId: null as string | null };
    await processSDKMessages(
      makeStream({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'hello' } } }),
      session,
      e => emitted.push(e),
    );
    expect(emitted).toEqual([{ type: 'text_delta', delta: 'hello' }]);
  });

  test('emits text_delta from assistant messages', async () => {
    const emitted: unknown[] = [];
    const session = { resolvedSessionId: null as string | null };
    await processSDKMessages(
      makeStream({ type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } }),
      session,
      e => emitted.push(e),
    );
    expect(emitted).toEqual([{ type: 'text_delta', delta: 'world' }]);
  });

  test('stops processing after result and does not emit subsequent events', async () => {
    const emitted: unknown[] = [];
    const session = { resolvedSessionId: null as string | null };
    await processSDKMessages(
      makeStream(
        { type: 'stream_event', event: { delta: { type: 'text_delta', text: 'hi' } } },
        { type: 'result', subtype: 'success', session_id: 'sess-1' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'SHOULD NOT APPEAR' }] } },
      ),
      session,
      e => emitted.push(e),
    );
    const types = emitted.map((e: any) => e.type);
    expect(types).toContain('result');
    // text_delta from the stream_event BEFORE result is expected
    expect(types).toContain('text_delta');
    // assistant event AFTER result must not be processed
    const texts = JSON.stringify(emitted);
    expect(texts).not.toContain('SHOULD NOT APPEAR');
  });

  test('saves session_id from result event', async () => {
    const session = { resolvedSessionId: null as string | null };
    await processSDKMessages(
      makeStream({ type: 'result', subtype: 'success', session_id: 'abc-123' }),
      session,
      () => {},
    );
    expect(session.resolvedSessionId).toBe('abc-123');
  });

  test('does not overwrite an existing resolvedSessionId', async () => {
    const session = { resolvedSessionId: 'original' };
    await processSDKMessages(
      makeStream({ type: 'result', subtype: 'success', session_id: 'new-id' }),
      session,
      () => {},
    );
    expect(session.resolvedSessionId).toBe('original');
  });

  test('emits error event for messages with error field', async () => {
    const emitted: unknown[] = [];
    const session = { resolvedSessionId: null as string | null };
    await processSDKMessages(
      makeStream({ error: 'something went wrong' }),
      session,
      e => emitted.push(e),
    );
    expect(emitted).toEqual([{ type: 'error', message: 'something went wrong' }]);
  });
});
