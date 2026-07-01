import type { EditorAnnotation } from '@acr/shared';

export type { EditorAnnotation };

export interface EditorAnnotationHandler {
  handle: (req: Request, url: URL) => Promise<Response | null>;
}

export function createEditorAnnotationHandler(): EditorAnnotationHandler {
  const annotations: EditorAnnotation[] = [];

  return {
    async handle(req: Request, url: URL): Promise<Response | null> {
      if (url.pathname === '/api/editor-annotations' && req.method === 'GET') {
        return Response.json({ annotations });
      }

      if (url.pathname === '/api/editor-annotation' && req.method === 'POST') {
        try {
          const body = (await req.json()) as {
            filePath?: string;
            selectedText?: string;
            lineStart?: number;
            lineEnd?: number;
            comment?: string;
          };

          if (!body.filePath || !body.selectedText || !body.lineStart || !body.lineEnd) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
          }
          if (
            typeof body.filePath !== 'string' ||
            body.filePath.startsWith('/') ||
            /^[a-zA-Z]:[\\/]/.test(body.filePath) ||
            body.filePath.split(/[\\/]/).includes('..')
          ) {
            return Response.json({ error: 'filePath must be a repo-relative path' }, { status: 400 });
          }
          if (
            !Number.isInteger(body.lineStart) || !Number.isInteger(body.lineEnd) ||
            body.lineStart < 1 || body.lineEnd < body.lineStart
          ) {
            return Response.json({ error: 'lineStart/lineEnd must be positive integers with lineStart <= lineEnd' }, { status: 400 });
          }

          const annotation: EditorAnnotation = {
            id: crypto.randomUUID(),
            filePath: body.filePath,
            selectedText: body.selectedText,
            lineStart: body.lineStart,
            lineEnd: body.lineEnd,
            comment: body.comment,
            createdAt: Date.now(),
          };

          annotations.push(annotation);
          // ponytail: FIFO cap keeps the in-memory list bounded
          if (annotations.length > 500) annotations.splice(0, annotations.length - 500);
          return Response.json({ id: annotation.id });
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }
      }

      if (url.pathname === '/api/editor-annotation' && req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) {
          return Response.json({ error: 'Missing id parameter' }, { status: 400 });
        }
        const idx = annotations.findIndex((a) => a.id === id);
        if (idx !== -1) annotations.splice(idx, 1);
        return Response.json({ ok: true });
      }

      return null;
    },
  };
}
