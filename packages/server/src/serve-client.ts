import { resolve, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

function findDistHtml(): string {
  // In a compiled binary, import.meta.dir is /$bunfs/root (virtual); use dirname(process.execPath)
  // In dev (bun src/index.ts), import.meta.dir is packages/server/src/
  const execDir = dirname(process.execPath);
  const candidates = [
    // Production: binary is in dist/, client html is in dist/
    resolve(execDir, 'index.html'),
    // Dev: bun run from packages/server/src/, client is at packages/client/dist/
    resolve(import.meta.dir, '../../client/dist/index.html'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[1]; // fallback for error message
}

const DIST_HTML = findDistHtml();
let cached: string | null = null;

export function serveClient(): Response {
  if (!existsSync(DIST_HTML)) {
    return new Response('UI not built. Run: bun install && bun run build',
      { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
  cached ??= readFileSync(DIST_HTML, 'utf8');
  return new Response(cached, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
