export interface ChatStreamEvent {
  type?: string;
  delta?: string;
  message?: string;
  [key: string]: unknown;
}

export async function readChatEventStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = async (line: string): Promise<boolean> => {
    if (!line.startsWith('data: ')) return false;
    const data = line.slice(6).trim();
    if (data === '[DONE]') {
      try { await reader.cancel(); } catch {}
      return true;
    }
    try {
      onEvent(JSON.parse(data));
    } catch {
      // Surface malformed server events instead of silently dropping them
      console.warn('[ACR] malformed chat stream event:', data);
      onEvent({ type: 'error', message: 'Received a malformed event from the server.' });
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer) await handleLine(buffer);
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (await handleLine(line)) return;
    }
  }
}
