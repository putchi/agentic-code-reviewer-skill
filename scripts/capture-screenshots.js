#!/usr/bin/env node
'use strict';

// Captures screenshots of the review UI using Playwright (zero-install via npx).
// Usage: node scripts/capture-screenshots.js

const { spawnSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const SAMPLE_JSON = '/tmp/acr-screenshot-sample.json';
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const SERVER_SCRIPT = path.join(__dirname, '..', 'server', 'review-server.js');

const sampleData = {
  verdict: "Two issues found: one HIGH severity SQL injection risk and one NOTE about missing test coverage. The overall structure of the changes is clean.",
  branch: "feature/example",
  sessionId: "screenshot-session",
  timestamp: new Date().toISOString(),
  summary: "Review complete. Address the SQL injection before merge.",
  findings: [
    {
      id: "f1",
      severity: "HIGH",
      file: "src/auth.js",
      location: "src/auth.js:42",
      line: 42,
      finding: "User input passed to SQL query without sanitization — SQL injection risk",
      reasoning: "Line 42 builds a query string directly from req.body.username without parameterization",
      evidence: "const query = 'SELECT * FROM users WHERE name=' + req.body.username"
    },
    {
      id: "f2",
      severity: "NOTE",
      file: "src/utils.js",
      location: "src/utils.js:15",
      line: 15,
      finding: "No unit tests for the new parseDate helper function",
      reasoning: "parseDate is called from 3 places but has no test coverage"
    }
  ],
  files: [
    {
      path: "src/auth.js",
      diff: "@@ -40,6 +40,8 @@\n function authenticate(req, res) {\n+  var username = req.body.username;\n+  var query = 'SELECT * FROM users WHERE name=' + username;\n   db.query(query, function(err, rows) {\n     if (err) throw err;\n     res.json(rows);\n   });\n }"
    },
    {
      path: "src/utils.js",
      diff: "@@ -12,4 +12,10 @@\n // Utility helpers\n+function parseDate(str) {\n+  var parts = str.split('-');\n+  return new Date(parts[0], parts[1]-1, parts[2]);\n+}\n+\n+module.exports = { parseDate };\n "
    }
  ]
};

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.writeFileSync(SAMPLE_JSON, JSON.stringify(sampleData, null, 2));
console.log('Sample data written to', SAMPLE_JSON);

// Start the review server on a fixed port
const serverProc = spawn(process.execPath, [
  SERVER_SCRIPT,
  '--findings-file', SAMPLE_JSON,
  '--session', 'screenshot',
  '--port', '7891'
], { stdio: ['ignore', 'pipe', 'pipe'] });

let serverUrl = null;

serverProc.stdout.on('data', function(d) {
  const line = d.toString();
  process.stdout.write('[server] ' + line);
  const m = line.match(/listening at (http:\/\/\S+)/);
  if (m) serverUrl = m[1];
});
serverProc.stderr.on('data', function(d) {
  process.stderr.write('[server err] ' + d.toString());
});

function waitForServer(cb, attempts) {
  if (!serverUrl) {
    if ((attempts || 0) > 30) { cb(new Error('Server did not start')); return; }
    setTimeout(function() { waitForServer(cb, (attempts || 0) + 1); }, 200);
    return;
  }
  http.get(serverUrl + '/api/review', function(res) {
    if (res.statusCode === 200) { res.resume(); cb(null); }
    else { res.resume(); setTimeout(function() { waitForServer(cb, (attempts || 0) + 1); }, 200); }
  }).on('error', function() {
    setTimeout(function() { waitForServer(cb, (attempts || 0) + 1); }, 200);
  });
}

const playwrightCaptureScript = function(url, outDir) {
  return [
    "const { chromium } = require('playwright');",
    "(async () => {",
    "  const browser = await chromium.launch();",
    "  const page = await browser.newPage();",
    "  await page.setViewportSize({ width: 1440, height: 900 });",
    "  await page.goto('" + url + "');",
    "  await page.waitForSelector('#tab-findings .finding-item', { timeout: 8000 });",
    "  await page.waitForTimeout(500);",
    "  await page.screenshot({ path: '" + outDir + "/review-ui.png' });",
    "  console.log('Screenshot 1: review-ui.png');",
    "  await page.click('#tab-findings .finding-item');",
    "  await page.waitForTimeout(400);",
    "  await page.click('#ts-comment');",
    "  await page.waitForTimeout(200);",
    "  await page.screenshot({ path: '" + outDir + "/annotation.png' });",
    "  console.log('Screenshot 2: annotation.png');",
    "  await page.fill('#chat-input', 'What is the impact of the SQL injection on line 42?');",
    "  await page.waitForTimeout(200);",
    "  await page.screenshot({ path: '" + outDir + "/chat-panel.png' });",
    "  console.log('Screenshot 3: chat-panel.png');",
    "  await browser.close();",
    "})();"
  ].join('\n');
};

waitForServer(function(err) {
  if (err) { console.error(err); serverProc.kill(); process.exit(1); }
  console.log('Server ready at', serverUrl);

  const scriptPath = '/tmp/acr-pw-capture.js';
  fs.writeFileSync(scriptPath, playwrightCaptureScript(serverUrl, SCREENSHOTS_DIR));

  // Install chromium
  var installResult = spawnSync('npx', ['--yes', 'playwright', 'install', 'chromium'], {
    stdio: 'inherit',
    timeout: 120000
  });
  if (installResult.status !== 0) {
    console.error('playwright install failed');
    serverProc.kill();
    process.exit(1);
  }

  // Run the capture script
  var captureResult = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    timeout: 60000,
    env: Object.assign({}, process.env)
  });

  if (captureResult.status !== 0) {
    console.error('Screenshot capture failed');
  } else {
    console.log('\nScreenshots written to docs/screenshots/');
  }

  serverProc.kill();
  process.exit(captureResult.status || 0);
}, 0);
