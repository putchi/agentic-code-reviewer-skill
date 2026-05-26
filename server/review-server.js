#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const entry = path.resolve(__dirname, '../packages/server/src/index.ts');
const result = spawnSync('bun', [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status == null ? 1 : result.status);
