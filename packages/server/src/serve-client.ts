let html: string | null = null;

export function serveClient(clientHtml: string): Response {
  html ??= clientHtml;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
