import { portArg, runDir } from './config';
import { serveClient } from './serve-client';
// @ts-ignore — Bun resolves this at compile time; TS doesn't know the attribute
import clientHtml from '../../client/dist/index.html' with { type: 'text' };
import { handleReview } from './routes/review';
import { handleVersionCheck } from './routes/version';
import { handleChatSession, handleChatQuery, handleChatAbort } from './routes/chat';
import { handleImplement, handleSave, handleDone } from './routes/decisions';
import { resetIdle } from './timeout';
import { openBrowser } from './browser';
import { loadSettings, resetSettings, saveSettings } from './settings';
import { createEditorAnnotationHandler } from './editor-annotations';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLUGIN_ROOT } from './config';

const selectedPort = portArg > 0 ? portArg : 0;
const editorAnnotationHandler = createEditorAnnotationHandler();

const onIdle = () => { console.log('Idle timeout — closing server.'); server.stop(); process.exit(0); };

const server = Bun.serve({
  port: selectedPort,
  hostname: '127.0.0.1',
  idleTimeout: 120,
  async fetch(req) {
    resetIdle(onIdle);
    const url = new URL(req.url);
    const editorAnnotationResponse = await editorAnnotationHandler.handle(req, url);
    if (editorAnnotationResponse) return editorAnnotationResponse;
    if (req.method === 'GET') {
      if (url.pathname === '/')                   return serveClient(clientHtml as unknown as string);
      if (url.pathname === '/api/review')         return handleReview();
      if (url.pathname === '/api/version-check')  return await handleVersionCheck();
      if (url.pathname === '/api/settings')        return Response.json(loadSettings());
      if (url.pathname === '/api/version') {
        const candidates = [
          resolve(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'),
          resolve(process.cwd(), '.claude-plugin', 'plugin.json'),
        ];
        let version = 'unknown';
        for (const pf of candidates) {
          if (existsSync(pf)) { version = JSON.parse(readFileSync(pf, 'utf8')).version ?? 'unknown'; break; }
        }
        return Response.json({ version });
      }
    }
    if (req.method === 'POST') {
      const payload = await req.json().catch(() => ({}));
      if (url.pathname === '/api/settings/reset') return Response.json(resetSettings());
      if (url.pathname === '/api/settings')       return Response.json(saveSettings(payload));
      if (url.pathname === '/api/chat/session') return handleChatSession(payload);
      if (url.pathname === '/api/chat/query')   return await handleChatQuery(payload);
      if (url.pathname === '/api/chat/abort')   return handleChatAbort(payload);
      if (url.pathname === '/api/implement')    return await handleImplement(payload);
      if (url.pathname === '/api/save')         return await handleSave(payload);
      if (url.pathname === '/api/done')         return await handleDone(payload);
    }
    return new Response('Not found', { status: 404 });
  },
});

const url = `http://${server.hostname}:${server.port}`;
if (runDir) {
  try {
    writeFileSync(resolve(runDir, 'ui-port'), `${server.port}\n`, 'utf8');
  } catch (error) {
    console.error(`Could not write UI port file: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`Review server listening at ${url}`);
resetIdle(onIdle);
openBrowser(url);
