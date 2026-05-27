import { describe, expect, test } from 'bun:test';
import { parseDiff } from '../../packages/client/src/lib/diff';

describe('parseDiff', () => {
  test('skips git metadata and parses normal hunks', () => {
    const rows = parseDiff([
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' context',
      '-old',
      '+new',
      '+next',
    ].join('\n'));

    expect(rows.map(r => r.type)).toEqual(['hunk', 'ctx', 'del', 'add', 'add']);
    expect(rows[1].oldLine).toBe(1);
    expect(rows[1].newLine).toBe(1);
    expect(rows[2].oldLine).toBe(2);
    expect(rows[3].newLine).toBe(2);
  });

  test('parses new files without rendering headers as additions', () => {
    const rows = parseDiff([
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n'));

    expect(rows).toHaveLength(3);
    expect(rows[0].type).toBe('hunk');
    expect(rows[1]).toMatchObject({ type: 'add', text: 'one', newLine: 1 });
    expect(rows[2]).toMatchObject({ type: 'add', text: 'two', newLine: 2 });
  });

  test('parses deleted files without rendering headers as deletions', () => {
    const rows = parseDiff([
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      'index 1111111..0000000',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n'));

    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ type: 'del', text: 'one', oldLine: 1 });
    expect(rows[2]).toMatchObject({ type: 'del', text: 'two', oldLine: 2 });
  });

  test('metadata-only diff headers produce no rendered rows', () => {
    const rows = parseDiff([
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
    ].join('\n'));

    expect(rows).toEqual([]);
  });
});
