import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
const DIST_HTML = resolve(import.meta.dir, '../../client/dist/index.html');
let cached: string | null = null;
export function serveClient(): Response {
  if (!existsSync(DIST_HTML)) {
    return new Response('UI not built. Run: bun install && bun run build',
      { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
  cached ??= readFileSync(DIST_HTML, 'utf8');
  return new Response(cached, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
