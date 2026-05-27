import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { chatSessions, createChatSession } from '../chat-sessions';
import { readFindings } from '../findings';
import { buildChatSystemPrompt } from '../chat-context';

export function handleChatSession(payload: { model?: string; currentFile?: string }): Response {
  const reviewData = readFindings();
  return Response.json({ sessionId: createChatSession(payload.model || 'claude-sonnet-4-6', reviewData, payload.currentFile) });
}

export function handleChatAbort(payload: { sessionId?: string }): Response {
  const s = payload.sessionId ? chatSessions.get(payload.sessionId) : undefined;
  if (s?.abortController) { s.abortController.abort(); s.abortController = null; }
  return Response.json({ ok: true });
}

export async function handleChatQuery(payload: { sessionId?: string; prompt?: string; currentFile?: string }): Promise<Response> {
  const session = payload.sessionId ? chatSessions.get(payload.sessionId) : undefined;
  if (!session) return Response.json({ error: 'session not found' }, { status: 404 });

  const enc = new TextEncoder();
  const abort = new AbortController();
  session.abortController = abort;

  const userPrompt = payload.prompt || '';
  let effectivePrompt: string;
  if (!session.firstQuerySent) {
    session.firstQuerySent = true;
    const reviewData = readFindings();
    const sysPrompt = session.systemPrompt || buildChatSystemPrompt(reviewData, payload.currentFile);
    effectivePrompt = sysPrompt + '\n\n---\n\nUser question:\n' + userPrompt;
  } else {
    effectivePrompt = userPrompt;
  }

  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (obj: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const queryStream = sdkQuery({
          prompt: effectivePrompt,
          options: {
            model: session.model,
            maxTurns: 1,
            allowedTools: [],
            cwd: process.cwd(),
            abortController: abort,
            ...(session.resolvedSessionId ? { resume: session.resolvedSessionId } : {}),
          },
        });

        for await (const msg of queryStream) {
          if (msg.type === 'result') {
            if ((msg as any).session_id && !session.resolvedSessionId) {
              session.resolvedSessionId = (msg as any).session_id as string;
            }
            emit({ type: 'result', success: (msg as any).subtype === 'success' });
          } else if (msg.type === 'assistant') {
            const content = (msg as any).message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  emit({ type: 'text_delta', delta: block.text });
                }
              }
            }
          } else if ((msg as any).type === 'stream_event') {
            const delta = (msg as any).event?.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              emit({ type: 'text_delta', delta: delta.text });
            }
          } else if ((msg as any).error) {
            emit({ type: 'error', message: (msg as any).error ?? String(msg) });
          }
        }
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      } catch (e: any) {
        if (!abort.signal.aborted) {
          emit({ type: 'error', message: e?.message ?? String(e) });
        }
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      } finally {
        session.abortController = null;
        ctrl.close();
      }
    },
    cancel() { abort.abort(); session.abortController = null; },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
