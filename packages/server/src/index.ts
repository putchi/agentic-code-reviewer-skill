import { portArg } from './config';
import { serveClient } from './serve-client';
const server = Bun.serve({
  port: portArg || 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return serveClient();
    return new Response('Not found', { status: 404 });
  },
});
console.log(`Review server listening at http://${server.hostname}:${server.port}`);
