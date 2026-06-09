import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function getPythonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.py'))
    .map((f) => join(dir, f));
}

function checkPythonFiles(label: string, files: string[]) {
  describe(label, () => {
    for (const scriptPath of files) {
      const name = scriptPath.split('/').pop()!;

      test(`${name}: has "from __future__ import annotations" on line 2`, () => {
        const content = require('node:fs').readFileSync(scriptPath, 'utf8');
        const lines = content.split('\n');
        expect(lines[0]).toBe('#!/usr/bin/env python3');
        expect(lines[1]).toBe('from __future__ import annotations');
      });

      test(`${name}: parses without syntax errors`, () => {
        const result = spawnSync(
          'python3',
          ['-c', `import ast; ast.parse(open(${JSON.stringify(scriptPath)}).read())`],
          { encoding: 'utf8' },
        );
        expect(result.status).toBe(0);
      });
    }
  });
}

checkPythonFiles('Python script compatibility', getPythonFiles(join(ROOT, 'scripts')));
checkPythonFiles('Python test compatibility', getPythonFiles(join(ROOT, 'tests/unit')));
