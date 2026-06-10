import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { chatSessions, createChatSession, type ChatSession } from '../chat-sessions';
import { readFindings } from '../findings';
import { buildChatSystemPrompt } from '../chat-context';
import { resolveCLIPath, resolveCodexCLIPath } from '../cli-path';

export function handleChatSession(payload: { model?: string; currentFile?: string }): Response {
  const reviewData = readFindings();
  const sessionId = createChatSession(payload.model, reviewData, payload.currentFile);
  const session = chatSessions.get(sessionId)!;
  return Response.json({
    sessionId,
    provider: session.provider,
    providerLabel: session.providerLabel,
    model: session.model,
    modelLabel: session.modelLabel,
  });
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
      let closed = false;
      const keepalive = setInterval(() => {
        if (!closed) ctrl.enqueue(enc.encode(': keepalive\n\n'));
      }, 15_000);
      try {
        if (session.provider === 'codex') {
          await streamCodexChat(session, effectivePrompt, abort, emit);
        } else {
          await streamClaudeChat(session, effectivePrompt, abort, emit);
        }
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      } catch (e: any) {
        if (!abort.signal.aborted) {
          emit({ type: 'error', message: e?.message ?? String(e) });
        }
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      } finally {
        closed = true;
        clearInterval(keepalive);
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

async function streamClaudeChat(
  session: ChatSession,
  effectivePrompt: string,
  abort: AbortController,
  emit: (obj: unknown) => void,
) {
  const cliPath = await resolveCLIPath();
  const queryStream = sdkQuery({
    prompt: effectivePrompt,
    options: {
      model: session.model,
      maxTurns: 3,
      cwd: process.cwd(),
      abortController: abort,
      ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
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
}

let CodexClass: any = null;

async function getCodexClass() {
  if (process.env.ACR_DISABLE_CODEX_SDK === '1') {
    throw new Error('Codex Ask AI unavailable: @openai/codex-sdk is disabled by ACR_DISABLE_CODEX_SDK.');
  }
  if (!CodexClass) {
    try {
      const mod = await import('@openai/codex-sdk' as any);
      CodexClass = mod.default ?? mod.Codex;
    } catch {
      throw new Error('Codex Ask AI unavailable: install @openai/codex-sdk with the server package.');
    }
  }
  if (!CodexClass) {
    throw new Error('Codex Ask AI unavailable: @openai/codex-sdk did not export a Codex client.');
  }
  return CodexClass;
}

async function streamCodexChat(
  session: ChatSession,
  effectivePrompt: string,
  abort: AbortController,
  emit: (obj: unknown) => void,
) {
  const Codex = await getCodexClass();
  const codexPath = resolveCodexCLIPath();
  if (!codexPath) {
    throw new Error('Codex Ask AI unavailable: codex CLI was not found on PATH.');
  }

  const state = session.providerState || (session.providerState = {});
  if (!state.codexInstance) {
    state.codexInstance = new Codex({ codexPathOverride: codexPath });
  }
  if (!state.codexThread) {
    if (session.resolvedSessionId) {
      state.codexThread = (state.codexInstance as any).resumeThread(session.resolvedSessionId, {
        model: session.model,
        workingDirectory: process.cwd(),
        sandboxMode: 'read-only',
        ...(session.codexReasoningEffort ? { modelReasoningEffort: session.codexReasoningEffort } : {}),
      });
    } else {
      state.codexThread = (state.codexInstance as any).startThread({
        model: session.model,
        workingDirectory: process.cwd(),
        sandboxMode: 'read-only',
        ...(session.codexReasoningEffort ? { modelReasoningEffort: session.codexReasoningEffort } : {}),
      });
    }
  }

  const streamed = await (state.codexThread as any).runStreamed(effectivePrompt, { signal: abort.signal });
  const offsets = (state.codexOffsets as Map<string, number> | undefined) || new Map<string, number>();
  state.codexOffsets = offsets;
  let failed = false;

  for await (const event of streamed.events) {
    const eventType = event?.type;
    if (!session.resolvedSessionId && eventType === 'thread.started' && typeof event.thread_id === 'string') {
      session.resolvedSessionId = event.thread_id;
    }
    if (eventType === 'turn.failed') {
      failed = true;
      emit({ type: 'error', message: event.error?.message || 'Codex turn failed' });
      continue;
    }
    if (eventType === 'error') {
      failed = true;
      emit({ type: 'error', message: event.message || 'Codex error' });
      continue;
    }
    if (eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') {
      const item = event.item || {};
      if (item.type === 'agent_message') {
        const itemId = item.id || 'agent_message';
        const text = typeof item.text === 'string' ? item.text : '';
        if (eventType === 'item.started') {
          offsets.set(itemId, 0);
          continue;
        }
        const previous = offsets.get(itemId) ?? 0;
        if (text.length > previous) {
          emit({ type: 'text_delta', delta: text.slice(previous) });
          offsets.set(itemId, text.length);
        }
        if (eventType === 'item.completed') offsets.delete(itemId);
      }
    }
  }

  emit({ type: 'result', success: !failed });
}
