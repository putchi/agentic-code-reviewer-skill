import { portArg } from './config';
import { serveClient } from './serve-client';
import { handleReview } from './routes/review';
import { handleVersionCheck } from './routes/version';
import { handleImplement, handleSave, handleDone } from './routes/decisions';
import { handleChatSession, handleChatQuery, handleChatAbort } from './routes/chat';
const server = Bun.serve({
  port: portArg || 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      if (url.pathname === '/') return serveClient();
      if (url.pathname === '/api/review') return handleReview();
      if (url.pathname === '/api/version-check') return await handleVersionCheck();
    }
    if (req.method === 'POST') {
      const payload = await req.json().catch(() => ({}));
      if (url.pathname === '/api/chat/session') return handleChatSession(payload);
      if (url.pathname === '/api/chat/query')   return handleChatQuery(payload);
      if (url.pathname === '/api/chat/abort')   return handleChatAbort(payload);
      if (url.pathname === '/api/implement')    return await handleImplement(payload);
      if (url.pathname === '/api/save')         return await handleSave(payload);
      if (url.pathname === '/api/done')         return await handleDone(payload);
    }
    return new Response('Not found', { status: 404 });
  },
});
console.log(`Review server listening at http://${server.hostname}:${server.port}`);
