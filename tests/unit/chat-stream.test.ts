import { describe, expect, test } from 'bun:test';
import { readChatEventStream } from '../../packages/client/src/lib/chatStream';

function withTimeout<T>(promise: Promise<T>, ms = 100): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out waiting for chat stream')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

describe('readChatEventStream', () => {
  test('returns on DONE without waiting for the stream to close', async () => {
    const encoder = new TextEncoder();
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"text_delta","delta":"hi"}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      },
      cancel() {
        canceled = true;
      },
    });
    const events: unknown[] = [];

    await withTimeout(readChatEventStream(stream.getReader(), event => events.push(event)));

    expect(events).toEqual([{ type: 'text_delta', delta: 'hi' }]);
    expect(canceled).toBe(true);
  });

  test('handles normal stream closure', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"text_delta","delta":"he'));
        controller.enqueue(encoder.encode('llo"}\n\n'));
        controller.close();
      },
    });
    const events: unknown[] = [];

    await withTimeout(readChatEventStream(stream.getReader(), event => events.push(event)));

    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }]);
  });
});
