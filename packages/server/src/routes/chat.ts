import { chatSessions, createChatSession, buildChatSystemPrompt } from '../chat-sessions';
import { readFindings } from '../findings';

export function handleChatSession(payload: { model?: string }): Response {
  return Response.json({ sessionId: createChatSession(payload.model || 'claude-sonnet-4-6') });
}
export function handleChatAbort(payload: { sessionId?: string }): Response {
  const s = payload.sessionId ? chatSessions.get(payload.sessionId) : undefined;
  if (s?.proc) { try { s.proc.kill(); } catch {} s.proc = null; }
  return Response.json({ ok: true });
}
export function handleChatQuery(payload: { sessionId?: string; prompt?: string; currentFile?: string }): Response {
  const session = payload.sessionId ? chatSessions.get(payload.sessionId) : undefined;
  if (!session) return Response.json({ error: 'session not found' }, { status: 404 });

  const userPrompt = payload.prompt || '';
  let fullPrompt: string;
  if (session.firstQuery) {
    session.firstQuery = false;
    fullPrompt = buildChatSystemPrompt(readFindings(), payload.currentFile) + '\n\n---\n\nUser question:\n' + userPrompt;
  } else { fullPrompt = userPrompt; }

  const proc = Bun.spawn(
    ['claude', '--output-format', 'stream-json', '--model', session.model, '--print', '-p', fullPrompt],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
  );
  session.proc = proc;

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const emit = (obj: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const emitRaw = (s: string) => ctrl.enqueue(enc.encode(s));
      const reader = proc.stdout!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            try {
              const obj: any = JSON.parse(t);
              if (obj.type === 'assistant' && obj.message?.content) {
                for (const block of obj.message.content) {
                  if (block.type === 'text') emit({ type: 'text_delta', delta: block.text });
                }
              } else if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
                emit({ type: 'text_delta', delta: obj.delta.text });
              }
            } catch { emit({ type: 'text_delta', delta: line + '\n' }); }
          }
        }
        if (buf.trim()) {
          try {
            const obj: any = JSON.parse(buf);
            if (obj.type === 'assistant' && obj.message?.content) {
              for (const block of obj.message.content) if (block.type === 'text') emit({ type: 'text_delta', delta: block.text });
            }
          } catch { emit({ type: 'text_delta', delta: buf }); }
        }
        emitRaw('data: [DONE]\n\n');
      } catch (e: any) {
        emit({ type: 'error', message: e?.message || String(e) });
        emitRaw('data: [DONE]\n\n');
      } finally { session.proc = null; ctrl.close(); }
    },
    cancel() { try { proc.kill(); } catch {} session.proc = null; },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
