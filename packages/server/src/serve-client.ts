export function serveClient(clientHtml: string): Response {
  return new Response(clientHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
