import { portArg } from './config';
import { serveClient } from './serve-client';
import { handleReview } from './routes/review';
import { handleVersionCheck } from './routes/version';
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
    return new Response('Not found', { status: 404 });
  },
});
console.log(`Review server listening at http://${server.hostname}:${server.port}`);
