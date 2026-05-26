#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
// Prefer the compiled binary in dist/; fall back to bun source for dev
const bin = path.resolve(__dirname, '../dist/review-server');
const src = path.resolve(__dirname, '../packages/server/src/index.ts');
let result;
if (fs.existsSync(bin)) {
  result = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit' });
} else {
  result = spawnSync('bun', [src, ...process.argv.slice(2)], { stdio: 'inherit' });
}
process.exit(result.status == null ? 1 : result.status);
