#!/usr/bin/env node
'use strict';

// Captures screenshots of the review UI using Playwright.
// Usage: node scripts/capture-screenshots.js

const { spawnSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const SAMPLE_JSON = '/tmp/acr-screenshot-sample.json';
const SETTINGS_JSON = '/tmp/acr-screenshot-settings.json';
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const SERVER_ENTRY = path.join(__dirname, '..', 'packages', 'server', 'src', 'index.ts');
const BUN_BIN = process.env.BUN_BIN || (fs.existsSync('/opt/homebrew/bin/bun') ? '/opt/homebrew/bin/bun' : 'bun');

const finding1 = {
  id: "f1",
  severity: "HIGH",
  file: "src/auth.js",
  location: "src/auth.js:42",
  line: 42,
  dimensions: ["security"],
  finding: "User input passed to SQL query without sanitization — SQL injection risk",
  reasoning: "Line 42 builds a query string directly from req.body.username without parameterization",
  evidence: "const query = 'SELECT * FROM users WHERE name=' + req.body.username"
};

const finding2 = {
  id: "f2",
  severity: "NOTE",
  file: "src/utils.js",
  location: "src/utils.js:15",
  line: 15,
  dimensions: ["testing"],
  finding: "No unit tests for the new parseDate helper function",
  reasoning: "parseDate is called from 3 places but has no test coverage"
};

const sampleData = {
  verdict: "Two issues found: one HIGH severity SQL injection risk and one NOTE about missing test coverage. The overall structure of the changes is clean.",
  branch: "feature/example",
  sessionId: "screenshot-session",
  runId: "screenshot-session",
  timestamp: new Date().toISOString(),
  resumeCommand: "/review-resume screenshot-session",
  summary: "Review complete. Address the SQL injection before merge.",
  findings: [finding1, finding2],
  reviewerResults: [
    { agent: "semantic-analyzer", status: "complete", findings: [] },
    { agent: "security-scanner", status: "complete", findings: [finding1] },
    { agent: "architecture-reviewer", status: "complete", findings: [] },
    { agent: "test-coverage-analyzer", status: "complete", findings: [finding2] },
    { agent: "senior-dev-reviewer", status: "complete", findings: [] }
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
fs.writeFileSync(SETTINGS_JSON, JSON.stringify({
  autoCloseMs: 0,
  chatModel: "claude-sonnet-4-6",
  firstRunDone: true
}, null, 2));
console.log('Sample data written to', SAMPLE_JSON);

// Start the review server on a fixed port
const serverProc = spawn(BUN_BIN, [
  SERVER_ENTRY,
  '--findings-file', SAMPLE_JSON,
  '--session', 'screenshot'
], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: Object.assign({}, process.env, {
    ACR_NO_OPEN: '1',
    ACR_SETTINGS_FILE: SETTINGS_JSON
  })
});

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
    "  await page.addInitScript(() => { localStorage.clear(); });",
    "  await page.goto('" + url + "');",
    "  await page.waitForSelector('.finding', { timeout: 8000 });",
    "  await page.waitForSelector('.dim--open', { timeout: 8000 }).catch(() => {});",
    "  await page.waitForTimeout(400);",
    "  await page.screenshot({ path: '" + outDir + "/results-view.png' });",
    "  console.log('Screenshot 0: results-view.png');",
    "  await page.click('.finding');",
    "  await page.click('.finding .checkbox');",
    "  await page.waitForSelector('.diff-view table, .diff-view .diff-table', { timeout: 8000 }).catch(() => {});",
    "  await page.click('.rp [role=tab]:has-text(\"Comments\")');",
    "  await page.fill('.cmt__textarea', 'Prioritize this fix before merge.');",
    "  await page.waitForTimeout(500);",
    "  await page.screenshot({ path: '" + outDir + "/review-ui.png' });",
    "  console.log('Screenshot 1: review-ui.png');",
    "  await page.click('.finding button:has-text(\"Open diff\")');",
    "  await page.waitForSelector('.annotation-toolstrip', { timeout: 8000 });",
    "  await page.waitForSelector('.diff-view tr[data-line-right], .diff-view tr[data-line-left]', { timeout: 8000 });",
    "  await page.click('.annotation-toolstrip button:has-text(\"Pinpoint\")');",
    "  await page.click('.annotation-toolstrip button:has-text(\"Comment\")');",
    "  await page.click('.diff-view tr[data-line-right], .diff-view tr[data-line-left]');",
    "  await page.waitForSelector('.comment-popover, .popover, textarea', { timeout: 3000 }).catch(() => {});",
    "  await page.waitForTimeout(400);",
    "  await page.screenshot({ path: '" + outDir + "/annotation.png' });",
    "  console.log('Screenshot 2: annotation.png');",
    "  await page.keyboard.press('Escape').catch(() => {});",
    "  await page.click('.rp [role=tab]:has-text(\"Ask AI\")');",
    "  await page.fill('.chat textarea', 'What is the impact of the SQL injection on line 42?');",
    "  await page.waitForTimeout(400);",
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

  // Install Playwright into a temp dir when it is not already present, then run the capture script.
  const tmpModules = '/tmp/acr-pw-modules';
  const playwrightModule = path.join(tmpModules, 'node_modules', 'playwright');
  if (!fs.existsSync(playwrightModule)) {
    var installResult = spawnSync('npm', ['install', '--prefix', tmpModules, 'playwright'], {
      stdio: 'inherit',
      timeout: 120000
    });
    if (installResult.status !== 0) {
      console.error('playwright install failed');
      serverProc.kill();
      process.exit(1);
    }
  }

  var browserInstall = spawnSync(
    path.join(tmpModules, 'node_modules', '.bin', 'playwright'),
    ['install', 'chromium'],
    { stdio: 'inherit', timeout: 120000 }
  );
  if (browserInstall.status !== 0) {
    console.error('chromium browser install failed');
    serverProc.kill();
    process.exit(1);
  }

  // Run the capture script with the temp node_modules on NODE_PATH
  var captureResult = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    timeout: 60000,
    env: Object.assign({}, process.env, { NODE_PATH: path.join(tmpModules, 'node_modules') })
  });

  if (captureResult.status !== 0) {
    console.error('Screenshot capture failed');
  } else {
    console.log('\nScreenshots written to docs/screenshots/');
  }

  serverProc.kill();
  process.exit(captureResult.status || 0);
}, 0);
