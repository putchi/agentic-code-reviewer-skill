import { chatSessions, createChatSession, buildChatSystemPrompt } from '../chat-sessions';
import { readFindings } from '../findings';

// Resolve claude CLI path once at boot; null means not available.
let claudePath: string | null = null;
try {
  const result = Bun.spawnSync(['which', 'claude'], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode === 0) claudePath = new TextDecoder().decode(result.stdout).trim();
} catch {}

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

  const enc = new TextEncoder();
  const errorStream = (msg: string) => new Response(
    new ReadableStream({ start(ctrl) { ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\ndata: [DONE]\n\n`)); ctrl.close(); } }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
  );

  if (!claudePath) return errorStream('claude CLI not found — install Claude Code CLI to use Ask AI');

  const userPrompt = payload.prompt || '';
  let fullPrompt: string;
  if (session.firstQuery) {
    session.firstQuery = false;
    fullPrompt = buildChatSystemPrompt(readFindings(), payload.currentFile) + '\n\n---\n\nUser question:\n' + userPrompt;
  } else {
    fullPrompt = userPrompt;
  }

  // Use --output-format text for plain streaming output — no JSON parsing needed,
  // no hook interference, no session context bleed. --dangerously-skip-permissions
  // prevents stop/pre-tool hooks from injecting synthetic messages.
  const proc = Bun.spawn(
    [claudePath, '--output-format', 'text', '--model', session.model, '--print',
     '--dangerously-skip-permissions', '-p', fullPrompt],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', env: { ...process.env } }
  );
  session.proc = proc;

  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (obj: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const emitRaw = (s: string) => ctrl.enqueue(enc.encode(s));

      const reader = proc.stdout!.getReader();
      const dec = new TextDecoder();
      let emittedAny = false;

      // Drain stderr in parallel
      const stderrDone = (async () => {
        const r = proc.stderr!.getReader();
        const d = new TextDecoder();
        let buf = '';
        try { while (true) { const { value, done } = await r.read(); if (done) break; buf += d.decode(value, { stream: true }); } }
        catch {}
        return buf.trim();
      })();

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = dec.decode(value, { stream: true });
          if (text) { emit({ type: 'text_delta', delta: text }); emittedAny = true; }
        }

        const exitCode = await proc.exited;
        const stderr = await stderrDone;

        if (!emittedAny) {
          if (stderr) emit({ type: 'error', message: stderr });
          else if (exitCode !== 0) emit({ type: 'error', message: `claude exited with code ${exitCode}` });
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
