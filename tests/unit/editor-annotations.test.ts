import { describe, expect, test } from 'bun:test';
import { createEditorAnnotationHandler } from '../../packages/server/src/editor-annotations';

describe('editor annotation handler', () => {
  test('creates, lists, and deletes runtime annotations', async () => {
    const handler = createEditorAnnotationHandler();

    const empty = await handler.handle(
      new Request('http://localhost/api/editor-annotations'),
      new URL('http://localhost/api/editor-annotations'),
    );
    expect(await empty!.json()).toEqual({ annotations: [] });

    const created = await handler.handle(
      new Request('http://localhost/api/editor-annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: 'src/a.ts',
          selectedText: 'const a = 1;',
          lineStart: 3,
          lineEnd: 4,
          comment: 'Check this',
        }),
      }),
      new URL('http://localhost/api/editor-annotation'),
    );
    const { id } = await created!.json() as { id: string };
    expect(typeof id).toBe('string');

    const listed = await handler.handle(
      new Request('http://localhost/api/editor-annotations'),
      new URL('http://localhost/api/editor-annotations'),
    );
    const listedBody = await listed!.json() as { annotations: Array<{ id: string; filePath: string }> };
    expect(listedBody.annotations).toHaveLength(1);
    expect(listedBody.annotations[0].id).toBe(id);
    expect(listedBody.annotations[0].filePath).toBe('src/a.ts');

    const deleted = await handler.handle(
      new Request(`http://localhost/api/editor-annotation?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
      new URL(`http://localhost/api/editor-annotation?id=${encodeURIComponent(id)}`),
    );
    expect(await deleted!.json()).toEqual({ ok: true });

    const afterDelete = await handler.handle(
      new Request('http://localhost/api/editor-annotations'),
      new URL('http://localhost/api/editor-annotations'),
    );
    expect(await afterDelete!.json()).toEqual({ annotations: [] });
  });

  test('rejects invalid create payloads', async () => {
    const handler = createEditorAnnotationHandler();
    const response = await handler.handle(
      new Request('http://localhost/api/editor-annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'src/a.ts' }),
      }),
      new URL('http://localhost/api/editor-annotation'),
    );

    expect(response!.status).toBe(400);
  });
});

describe('editor annotation validation', () => {
  const post = (handler: ReturnType<typeof createEditorAnnotationHandler>, body: unknown) =>
    handler.handle(
      new Request('http://localhost/api/editor-annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      new URL('http://localhost/api/editor-annotation'),
    );

  const base = { filePath: 'src/a.ts', selectedText: 'x', lineStart: 1, lineEnd: 2 };

  test('rejects absolute file paths', async () => {
    const handler = createEditorAnnotationHandler();
    const res = await post(handler, { ...base, filePath: '/etc/passwd' });
    expect(res!.status).toBe(400);
  });

  test('rejects windows drive paths', async () => {
    const handler = createEditorAnnotationHandler();
    const res = await post(handler, { ...base, filePath: 'C:\\secret.txt' });
    expect(res!.status).toBe(400);
  });

  test('rejects parent traversal', async () => {
    const handler = createEditorAnnotationHandler();
    const res = await post(handler, { ...base, filePath: '../outside.ts' });
    expect(res!.status).toBe(400);
  });

  test('rejects inverted line ranges', async () => {
    const handler = createEditorAnnotationHandler();
    const res = await post(handler, { ...base, lineStart: 10, lineEnd: 3 });
    expect(res!.status).toBe(400);
  });

  test('rejects non-integer line numbers', async () => {
    const handler = createEditorAnnotationHandler();
    const res = await post(handler, { ...base, lineStart: 1.5, lineEnd: 3 });
    expect(res!.status).toBe(400);
  });
});
