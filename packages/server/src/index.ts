import { portArg } from './config';
import { serveClient } from './serve-client';
import { handleReview } from './routes/review';
import { handleVersionCheck } from './routes/version';
import { handleChatSession, handleChatQuery, handleChatAbort } from './routes/chat';
import { handleImplement, handleSave, handleDone } from './routes/decisions';
import { resetIdle } from './timeout';
import { openBrowser } from './browser';

const onIdle = () => { console.log('Idle timeout — closing server.'); server.stop(); process.exit(0); };

const server = Bun.serve({
  port: portArg || 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    resetIdle(onIdle);
    const url = new URL(req.url);
    if (req.method === 'GET') {
      if (url.pathname === '/')                   return serveClient();
      if (url.pathname === '/api/review')         return handleReview();
      if (url.pathname === '/api/version-check')  return await handleVersionCheck();
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

const url = `http://${server.hostname}:${server.port}`;
console.log(`Review server listening at ${url}`);
resetIdle(onIdle);
openBrowser(url);
