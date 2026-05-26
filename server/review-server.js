#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Parse CLI args
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}

const sessionId = arg('--session') || 'unknown';
const findingsFile = arg('--findings-file') || `/tmp/claude-code-review-${sessionId}.json`;
const saveDir = arg('--save-dir') || path.join(process.cwd(), 'docs', 'code-reviews');
const port = parseInt(arg('--port') || '0', 10);

const decisionFile = `/tmp/claude-code-review-${sessionId}.decision`;

// Plugin root: the dir containing this server file is server/, so its parent
// holds .claude-plugin/plugin.json with the installed version.
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const MARKETPLACE_URL = 'https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/.claude-plugin/marketplace.json';
const INSTALL_BASE = 'curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash';

// Platform detection: explicit --platform wins; otherwise infer from install path.
// Claude Code cache lives under ~/.claude/plugins/cache/... ; Codex under ~/.codex/skills/...
function detectPlatform() {
  const explicit = arg('--platform');
  if (explicit) return explicit;
  if (PLUGIN_ROOT.includes('/.claude/plugins/')) return 'claude';
  if (PLUGIN_ROOT.includes('/.codex/skills/')) return 'codex';
  return '';
}

function buildInstallCommand() {
  const platform = detectPlatform();
  return platform ? `${INSTALL_BASE} -s -- --platform ${platform}` : INSTALL_BASE;
}

function getInstalledVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version || '';
  } catch (_) {
    return '';
  }
}

function fetchLatestVersion(cb) {
  const https = require('https');
  let done = false;
  function finish(v) { if (!done) { done = true; cb(v); } }

  const req = https.get(MARKETPLACE_URL, { timeout: 5000 }, function(res) {
    if (res.statusCode !== 200) { res.resume(); return finish(''); }
    let data = '';
    res.on('data', function(c) { data += c; });
    res.on('end', function() {
      try { finish(JSON.parse(data).plugins[0].version || ''); }
      catch (_) { finish(''); }
    });
  });
  req.on('error', function() { finish(''); });
  req.on('timeout', function() { req.destroy(); finish(''); });
}

function compareSemver(a, b) {
  const pa = String(a).split('.').map(function(n) { return parseInt(n, 10) || 0; });
  const pb = String(b).split('.').map(function(n) { return parseInt(n, 10) || 0; });
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

// Idle timeout: 30 minutes
let idleTimer;
function resetIdle(server) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('Idle timeout — closing server.');
    server.close(() => process.exit(0));
  }, 30 * 60 * 1000);
}

function openBrowser(url) {
  // url is constructed from hardcoded host/port — not user input
  const platform = process.platform;
  let cmd, cmdArgs;
  if (platform === 'darwin') { cmd = 'open'; cmdArgs = [url]; }
  else if (platform === 'win32') { cmd = 'cmd'; cmdArgs = ['/c', 'start', '', url]; }
  else { cmd = 'xdg-open'; cmdArgs = [url]; }
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
}

function readFindings() {
  try {
    return JSON.parse(fs.readFileSync(findingsFile, 'utf8'));
  } catch (_) {
    return { verdict: '', findings: [], files: [], summary: '', timestamp: new Date().toISOString(), branch: '', sessionId };
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveMarkdown(data) {
  ensureDir(saveDir);
  const date = new Date().toISOString().slice(0, 10);
  const branch = (data.branch || 'unknown').replace(/[^a-z0-9_-]/gi, '-');
  const filename = `${date}-${branch}.md`;
  const filepath = path.join(saveDir, filename);

  const severityGroups = { CRITICAL: [], HIGH: [], NOTE: [] };
  for (const f of (data.findings || [])) {
    const sev = (f.severity || 'NOTE').toUpperCase();
    if (severityGroups[sev]) severityGroups[sev].push(f);
    else severityGroups.NOTE.push(f);
  }

  const decision = data._decision || {};
  const selectedIds = new Set(decision.selectedIds || []);
  const comments = decision.comments || {};
  const globalComment = decision.globalComment || '';

  let md = `# Code Review — ${date} (branch: ${data.branch || 'unknown'})\n\n`;
  md += `**Verdict:** ${data.verdict || '_No verdict_'}\n\n`;
  if (globalComment) md += `> **Your notes:** ${globalComment}\n\n`;

  for (const [sev, findings] of Object.entries(severityGroups)) {
    md += `## ${sev}\n\n`;
    if (!findings.length) { md += '_None._\n\n'; continue; }
    for (const f of findings) {
      const status = selectedIds.has(f.id) ? '☑ selected for implementation' : '☐ not selected';
      md += `- **${f.location || f.file}** — ${f.finding}\n`;
      if (f.reasoning) md += `  - Reasoning: ${f.reasoning}\n`;
      if (f.evidence) md += `  - Evidence: \`${f.evidence}\`\n`;
      if (f.dimensions && f.dimensions.length) md += `  - Dimensions: ${f.dimensions.join(', ')}\n`;
      md += `  - Status: ${status}\n`;
      if (comments[f.id]) md += `  - Your comment: "${comments[f.id]}"\n`;
      md += '\n';
    }
  }

  md += `## Summary\n\n${data.summary || ''}\n\n`;
  md += `---\n_Generated by agentic-code-reviewer v1.1.0_\n`;

  fs.writeFileSync(filepath, md, 'utf8');
  return filepath;
}

// HTML is served as a static string — all dynamic content injected via fetch/JSON,
// never via server-side string interpolation into HTML.
const HTML = getHTML();

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agentic Code Review</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #1e1e2e; --bg2: #181825; --bg3: #11111b;
  --surface: #313244; --surface2: #45475a;
  --text: #cdd6f4; --text-dim: #6c7086; --text-muted: #a6adc8;
  --accent: #89b4fa; --green: #a6e3a1; --red: #f38ba8;
  --purple: #cba6f7; --critical: #f38ba8; --high: #fab387; --note: #89b4fa;
  --border: #45475a; --radius: 6px;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #eff1f5; --bg2: #e6e9ef; --bg3: #dce0e8;
    --surface: #ccd0da; --surface2: #bcc0cc;
    --text: #4c4f69; --text-dim: #9ca0b0; --text-muted: #6c6f85;
    --accent: #1e66f5; --green: #40a02b; --red: #d20f39;
    --purple: #8839ef; --critical: #d20f39; --high: #fe640b; --note: #1e66f5;
    --border: #bcc0cc;
  }
}
html, body { height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; background: var(--bg3); color: var(--text); }
.app { display: flex; flex-direction: column; height: 100vh; }
.header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 10px 16px; display: flex; align-items: flex-start; gap: 16px; flex-shrink: 0; }
.header-title { font-size: 15px; font-weight: 600; color: var(--accent); white-space: nowrap; }
.header-meta { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
.verdict-block { flex: 1; min-width: 0; }
.verdict-label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin-bottom: 3px; }
.verdict-text { color: var(--text-muted); font-size: 13px; line-height: 1.4; }
.filter-bar { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 6px 16px; display: flex; gap: 6px; flex-shrink: 0; }
.chip { padding: 3px 10px; border-radius: 12px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 12px; transition: all .15s; }
.chip:hover { border-color: var(--accent); color: var(--accent); }
.chip.active { background: var(--accent); border-color: var(--accent); color: var(--bg3); font-weight: 600; }
.chip.crit { --accent: var(--critical); }
.chip.high { --accent: var(--high); }
.chip.note { --accent: var(--note); }
.panels { display: flex; flex: 1; overflow: hidden; }
.left-panel { width: 260px; min-width: 200px; background: var(--bg2); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
.tabs { display: flex; border-bottom: 1px solid var(--border); }
.tab { flex: 1; padding: 8px; text-align: center; cursor: pointer; font-size: 12px; color: var(--text-dim); border-bottom: 2px solid transparent; transition: all .15s; }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.panel-scroll { flex: 1; overflow-y: auto; padding: 8px; }
.finding-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: var(--radius); cursor: pointer; border: 1px solid transparent; margin-bottom: 4px; transition: all .15s; }
.finding-item:hover { background: var(--surface); }
.finding-item.active { background: var(--surface); border-color: var(--accent); }
.finding-item.filtered { display: none; }
.finding-cb { flex-shrink: 0; margin-top: 2px; width: 15px; height: 15px; cursor: pointer; accent-color: var(--accent); }
.finding-body { flex: 1; min-width: 0; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
.badge-CRITICAL { background: var(--critical); color: var(--bg3); }
.badge-HIGH { background: var(--high); color: var(--bg3); }
.badge-NOTE { background: var(--note); color: var(--bg3); }
.finding-location { font-size: 11px; color: var(--text-dim); font-family: monospace; margin-bottom: 2px; }
.finding-text { font-size: 12px; color: var(--text); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-item { padding: 7px 8px; border-radius: var(--radius); cursor: pointer; display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.file-item:hover { background: var(--surface); }
.file-item.active { background: var(--surface); color: var(--accent); }
.file-name { flex: 1; font-size: 12px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-count { background: var(--surface2); color: var(--text-dim); font-size: 11px; padding: 1px 5px; border-radius: 10px; }
.center-panel { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
.diff-header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 8px 12px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.diff-filename { font-family: monospace; font-size: 12px; color: var(--text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-nav { display: flex; gap: 6px; }
.btn-sm { padding: 3px 10px; border-radius: var(--radius); border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 12px; }
.btn-sm:hover { border-color: var(--accent); color: var(--accent); }
.toggle-view { padding: 3px 10px; border-radius: var(--radius); border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 11px; }
.diff-view { flex: 1; overflow: auto; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; line-height: 1.6; }
.diff-table { width: 100%; border-collapse: collapse; }
.diff-table td { padding: 0 8px; white-space: pre; vertical-align: top; }
.diff-line-num { color: var(--text-dim); text-align: right; user-select: none; width: 45px; border-right: 1px solid var(--border); padding-right: 8px; }
.diff-gutter { width: 16px; text-align: center; user-select: none; }
.diff-line-add { background: rgba(166,227,161,.08); color: var(--green); }
.diff-line-del { background: rgba(243,139,168,.08); color: var(--red); }
.diff-line-ctx { color: var(--text); }
.diff-line-hunk { color: var(--purple); background: rgba(203,166,247,.05); }
.diff-flagged { background: rgba(250,179,135,.12) !important; }
.diff-flagged-critical { background: rgba(243,139,168,.15) !important; }
.gutter-dot { font-size: 10px; }
.gutter-dot-CRITICAL { color: var(--critical); }
.gutter-dot-HIGH { color: var(--high); }
.gutter-dot-NOTE { color: var(--note); }
.empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: 14px; }
.right-panel { width: 300px; min-width: 240px; background: var(--bg2); border-left: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
.right-section { padding: 10px 12px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.comments-scroll { flex: 1; overflow-y: auto; padding: 8px; }
.comment-card { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; margin-bottom: 8px; }
.comment-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.comment-location { font-family: monospace; font-size: 11px; color: var(--text-dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.finding-detail { font-size: 12px; color: var(--text-muted); margin-bottom: 6px; line-height: 1.4; }
.evidence-block { background: var(--bg2); border-left: 2px solid var(--surface2); padding: 4px 8px; font-family: monospace; font-size: 11px; color: var(--text-dim); margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.comment-input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; padding: 6px 8px; resize: vertical; min-height: 50px; font-family: inherit; }
.comment-input:focus { outline: none; border-color: var(--accent); }
.global-comment-area { padding: 10px 12px; border-top: 1px solid var(--border); flex-shrink: 0; }
.global-comment-label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin-bottom: 6px; }
.global-textarea { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; padding: 6px 8px; resize: vertical; min-height: 70px; font-family: inherit; }
.global-textarea:focus { outline: none; border-color: var(--accent); }
.action-bar { background: var(--bg2); border-top: 1px solid var(--border); padding: 10px 16px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.sel-controls { display: flex; gap: 6px; }
.action-spacer { flex: 1; }
.btn { padding: 7px 16px; border-radius: var(--radius); border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 13px; font-weight: 500; transition: all .15s; }
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--bg3); font-weight: 600; }
.btn-primary:hover { opacity: .9; }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.status-msg { font-size: 12px; color: var(--green); margin-left: 8px; }
@media (max-width: 900px) {
  .panels { flex-direction: column; }
  .left-panel { width: 100%; height: 200px; border-right: none; border-bottom: 1px solid var(--border); }
  .right-panel { width: 100%; height: 220px; border-left: none; border-top: 1px solid var(--border); }
}

/* Update toast */
.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  max-width: 360px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  padding: 12px 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  z-index: 9999;
  font-size: 12px;
  display: none;
  animation: toast-in .25s ease-out;
}
.toast.visible { display: block; }
@keyframes toast-in { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.toast-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.toast-title { font-weight: 600; color: var(--accent); flex: 1; }
.toast-close { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
.toast-close:hover { color: var(--text); }
.toast-body { color: var(--text-muted); line-height: 1.4; margin-bottom: 8px; }
.toast-cmd-row { display: flex; gap: 6px; align-items: stretch; }
.toast-cmd {
  flex: 1;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: var(--text);
  overflow-x: auto;
  white-space: nowrap;
  user-select: all;
}
.toast-copy {
  background: var(--accent);
  color: var(--bg3);
  border: none;
  border-radius: 4px;
  padding: 0 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.toast-copy:hover { opacity: .9; }
.toast-copy.copied { background: var(--green); }
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <div>
      <div class="header-title">Agentic Code Review</div>
      <div class="header-meta" id="meta">Loading...</div>
    </div>
    <div class="verdict-block">
      <div class="verdict-label">Verdict</div>
      <div class="verdict-text" id="verdict">Loading...</div>
    </div>
  </div>
  <div class="filter-bar">
    <button class="chip active" data-filter="ALL">All</button>
    <button class="chip crit" data-filter="CRITICAL">CRITICAL: <span id="cnt-critical">0</span></button>
    <button class="chip high" data-filter="HIGH">HIGH: <span id="cnt-high">0</span></button>
    <button class="chip note" data-filter="NOTE">NOTE: <span id="cnt-note">0</span></button>
  </div>
  <div class="panels">
    <div class="left-panel">
      <div class="tabs">
        <div class="tab active" data-tab="findings">Findings</div>
        <div class="tab" data-tab="files">Files</div>
      </div>
      <div class="panel-scroll" id="tab-findings"></div>
      <div class="panel-scroll" id="tab-files" style="display:none"></div>
    </div>
    <div class="center-panel">
      <div class="diff-header">
        <span class="diff-filename" id="diff-filename">No file selected</span>
        <div class="diff-nav">
          <button class="btn-sm" id="btn-prev">&#9664; prev</button>
          <button class="btn-sm" id="btn-next">next &#9654;</button>
        </div>
        <button class="toggle-view" id="btn-toggle-view">unified</button>
      </div>
      <div class="diff-view" id="diff-view">
        <div class="empty-state">Select a finding or file to view diff</div>
      </div>
    </div>
    <div class="right-panel">
      <div class="right-section">Comments (<span id="comment-count">0</span>)</div>
      <div class="comments-scroll" id="comments-scroll"></div>
      <div class="global-comment-area">
        <div class="global-comment-label">Global Notes</div>
        <textarea class="global-textarea" id="global-comment" placeholder="Overall notes for Claude..."></textarea>
      </div>
    </div>
  </div>
  <div class="action-bar">
    <div class="sel-controls">
      <button class="btn" id="btn-select-all">Select All</button>
      <button class="btn" id="btn-deselect-all">Deselect All</button>
    </div>
    <div class="action-spacer"></div>
    <span class="status-msg" id="status-msg"></span>
    <button class="btn btn-primary" id="btn-implement" disabled>Implement Selected (0)</button>
    <button class="btn" id="btn-save">Save</button>
    <button class="btn" id="btn-done">Done</button>
  </div>
</div>

<div class="toast" id="update-toast" role="status" aria-live="polite">
  <div class="toast-header">
    <span class="toast-title" id="toast-title">Update available</span>
    <button class="toast-close" id="toast-close" aria-label="Dismiss">&times;</button>
  </div>
  <div class="toast-body" id="toast-body"></div>
  <div class="toast-cmd-row">
    <code class="toast-cmd" id="toast-cmd"></code>
    <button class="toast-copy" id="toast-copy">Copy</button>
  </div>
</div>
<script>
var reviewData = null;
var activeFilter = 'ALL';
var activeFindingId = null;
var activeFile = null;
var splitView = false;
var findingIdx = -1;
var LOCAL_KEY = 'acr-comments';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch (_) { return {}; }
}
function saveLocal(data) { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); }

async function init() {
  var res = await fetch('/api/review');
  reviewData = await res.json();
  render();
}

function t(text) {
  return document.createTextNode(text);
}
function el(tag, cls, children) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (children) children.forEach(function(c) { if (c) e.appendChild(c); });
  return e;
}

function render() {
  var d = reviewData;
  var metaParts = [];
  if (d.branch) metaParts.push('branch: ' + d.branch);
  if (d.timestamp) metaParts.push(d.timestamp.slice(0, 10));
  if (d.sessionId) metaParts.push('[' + d.sessionId.slice(0, 8) + ']');
  document.getElementById('meta').textContent = metaParts.join('  ·  ');
  document.getElementById('verdict').textContent = d.verdict || '—';

  var counts = { CRITICAL: 0, HIGH: 0, NOTE: 0 };
  (d.findings || []).forEach(function(f) { counts[f.severity] = (counts[f.severity] || 0) + 1; });
  document.getElementById('cnt-critical').textContent = counts.CRITICAL;
  document.getElementById('cnt-high').textContent = counts.HIGH;
  document.getElementById('cnt-note').textContent = counts.NOTE;

  renderFindings(); renderFiles(); renderComments(); updateImplementBtn();
}

function makeBadge(severity) {
  var b = document.createElement('span');
  b.className = 'badge badge-' + severity;
  b.textContent = severity;
  return b;
}

function renderFindings() {
  var container = document.getElementById('tab-findings');
  var saved = loadLocal();
  while (container.firstChild) container.removeChild(container.firstChild);

  (reviewData.findings || []).forEach(function(f) {
    var checked = saved['_checked_' + f.id] !== undefined ? saved['_checked_' + f.id] : (f.severity === 'CRITICAL');
    var isFiltered = activeFilter !== 'ALL' && f.severity !== activeFilter;

    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'finding-cb'; cb.checked = checked; cb.dataset.id = f.id;
    cb.addEventListener('change', function(e) {
      e.stopPropagation();
      var lc = loadLocal(); lc['_checked_' + f.id] = cb.checked; saveLocal(lc);
      updateImplementBtn(); renderComments();
    });

    var loc = el('div', 'finding-location'); loc.textContent = f.location || f.file || '';
    var txt = el('div', 'finding-text'); txt.textContent = f.finding || '';
    var body = el('div', 'finding-body', [makeBadge(f.severity), loc, txt]);
    var div = el('div', 'finding-item' + (isFiltered ? ' filtered' : '') + (activeFindingId === f.id ? ' active' : ''), [cb, body]);
    div.dataset.id = f.id;
    div.addEventListener('click', function(e) {
      if (e.target.classList.contains('finding-cb')) return;
      setActiveFinding(f.id);
    });
    container.appendChild(div);
  });
  updateImplementBtn();
}

function renderFiles() {
  var container = document.getElementById('tab-files');
  while (container.firstChild) container.removeChild(container.firstChild);
  var fileCounts = {};
  (reviewData.findings || []).forEach(function(f) { fileCounts[f.file || ''] = (fileCounts[f.file || ''] || 0) + 1; });
  (reviewData.files || []).forEach(function(fileObj) {
    var name = el('span', 'file-name'); name.textContent = fileObj.path;
    var cnt = el('span', 'file-count'); cnt.textContent = fileCounts[fileObj.path] || 0;
    var div = el('div', 'file-item' + (activeFile === fileObj.path ? ' active' : ''), [name, cnt]);
    div.addEventListener('click', function() { setActiveFile(fileObj.path); });
    container.appendChild(div);
  });
}

function renderComments() {
  var saved = loadLocal();
  var container = document.getElementById('comments-scroll');
  while (container.firstChild) container.removeChild(container.firstChild);
  var checked = (reviewData.findings || []).filter(function(f) {
    return saved['_checked_' + f.id] !== false && (saved['_checked_' + f.id] === true || f.severity === 'CRITICAL');
  });
  document.getElementById('comment-count').textContent = checked.length;

  checked.forEach(function(f) {
    var comment = saved['_comment_' + f.id] || '';
    var loc = el('span', 'comment-location'); loc.textContent = f.location || f.file || '';
    var header = el('div', 'comment-card-header', [makeBadge(f.severity), loc]);
    var detail = el('div', 'finding-detail'); detail.textContent = f.finding || '';
    var cardChildren = [header, detail];
    if (f.evidence) {
      var ev = el('div', 'evidence-block'); ev.textContent = f.evidence;
      cardChildren.push(ev);
    }
    var ta = document.createElement('textarea');
    ta.className = 'comment-input'; ta.placeholder = 'Add your note for Claude...';
    ta.dataset.id = f.id; ta.value = comment;
    ta.addEventListener('input', function() {
      var lc = loadLocal(); lc['_comment_' + f.id] = ta.value; saveLocal(lc);
    });
    cardChildren.push(ta);
    container.appendChild(el('div', 'comment-card', cardChildren));
  });

  document.getElementById('global-comment').value = saved['_global'] || '';
}

document.getElementById('global-comment').addEventListener('input', function() {
  var lc = loadLocal(); lc['_global'] = this.value; saveLocal(lc);
});

function setActiveFinding(id) {
  activeFindingId = id;
  var findings = reviewData.findings || [];
  var f = findings.find(function(f) { return f.id === id; });
  if (!f) return;
  activeFile = f.file;
  findingIdx = findings.findIndex(function(f) { return f.id === id; });
  renderFindings(); renderFiles(); renderDiff(f.file, f.line);
  var ta = document.querySelector('.comment-input[data-id="' + id + '"]');
  if (ta) ta.closest('.comment-card').scrollIntoView({ block: 'nearest' });
}

function setActiveFile(filePath) {
  activeFile = filePath; activeFindingId = null;
  renderFiles(); renderDiff(filePath, null);
}

function parseDiff(raw) {
  if (!raw) return [];
  var lines = raw.split('\\n'), result = [], leftLine = 0, rightLine = 0;
  lines.forEach(function(line) {
    if (line.startsWith('@@')) {
      var m = line.match(/@@ -(\\d+)(?:,\\d+)? \\+(\\d+)/);
      if (m) { leftLine = parseInt(m[1]); rightLine = parseInt(m[2]); }
      result.push({ type: 'hunk', text: line, left: null, right: null });
    } else if (line.startsWith('-')) {
      result.push({ type: 'del', text: line.slice(1), left: leftLine++, right: null });
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', text: line.slice(1), left: null, right: rightLine++ });
    } else {
      result.push({ type: 'ctx', text: line.length > 0 ? line.slice(1) : '', left: leftLine++, right: rightLine++ });
    }
  });
  return result;
}

function makeCell(tag, cls, text) {
  var td = document.createElement(tag);
  if (cls) td.className = cls;
  if (text !== undefined && text !== null) td.textContent = String(text);
  return td;
}

function renderDiff(filePath, highlightLine) {
  document.getElementById('diff-filename').textContent = filePath || 'No file selected';
  var diffView = document.getElementById('diff-view');
  while (diffView.firstChild) diffView.removeChild(diffView.firstChild);

  var fileObj = (reviewData.files || []).find(function(f) { return f.path === filePath; });
  if (!fileObj) {
    diffView.appendChild(el('div', 'empty-state', [t('No diff available for this file')]));
    return;
  }

  var lines = parseDiff(fileObj.diff);
  var table = document.createElement('table');
  table.className = 'diff-table';
  var tbody = document.createElement('tbody');
  var highlightRow = null;

  var order = { CRITICAL: 0, HIGH: 1, NOTE: 2 };
  lines.forEach(function(ln) {
    var isHighlight = (ln.right && ln.right === highlightLine) || (ln.left && ln.left === highlightLine);
    var findings = (reviewData.findings || []).filter(function(f) {
      return f.file === filePath && (ln.right ? f.line === ln.right : (ln.left ? f.line === ln.left : false));
    });
    var topSev = null;
    if (findings.length) {
      topSev = findings.reduce(function(a, b) { return order[a.severity] <= order[b.severity] ? a : b; }).severity;
    }

    var rowCls = 'diff-line-' + (ln.type === 'add' ? 'add' : ln.type === 'del' ? 'del' : ln.type === 'hunk' ? 'hunk' : 'ctx');
    if (topSev) rowCls += topSev === 'CRITICAL' ? ' diff-flagged-critical' : ' diff-flagged';
    var tr = document.createElement('tr');
    tr.className = rowCls;
    if (isHighlight) highlightRow = tr;

    var gutterDot = null;
    if (topSev) {
      gutterDot = document.createElement('span');
      gutterDot.className = 'gutter-dot gutter-dot-' + topSev;
      gutterDot.textContent = '•';
    }
    var gutterTd = document.createElement('td');
    gutterTd.className = 'diff-gutter';
    if (gutterDot) gutterTd.appendChild(gutterDot);

    if (splitView) {
      tr.appendChild(makeCell('td', 'diff-line-num', ln.left || ''));
      tr.appendChild(makeCell('td', null, ln.type === 'del' ? ln.text : ln.type === 'ctx' ? ln.text : ''));
      tr.appendChild(makeCell('td', 'diff-line-num', ln.right || ''));
      tr.appendChild(gutterTd);
      tr.appendChild(makeCell('td', null, ln.type !== 'del' ? ln.text : ''));
    } else {
      tr.appendChild(makeCell('td', 'diff-line-num', ln.right || ln.left || ''));
      tr.appendChild(gutterTd);
      tr.appendChild(makeCell('td', null, ln.text));
    }
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  diffView.appendChild(table);
  if (highlightRow) highlightRow.scrollIntoView({ block: 'center' });
}

function updateImplementBtn() {
  var saved = loadLocal();
  var selected = (reviewData ? reviewData.findings || [] : []).filter(function(f) {
    return saved['_checked_' + f.id] !== false && (saved['_checked_' + f.id] === true || f.severity === 'CRITICAL');
  });
  var btn = document.getElementById('btn-implement');
  btn.textContent = 'Implement Selected (' + selected.length + ')';
  btn.disabled = selected.length === 0;
}

function getDecisionPayload(action) {
  var saved = loadLocal();
  var findings = reviewData ? reviewData.findings || [] : [];
  var selectedIds = findings.filter(function(f) {
    return saved['_checked_' + f.id] !== false && (saved['_checked_' + f.id] === true || f.severity === 'CRITICAL');
  }).map(function(f) { return f.id; });
  var comments = {};
  findings.forEach(function(f) { if (saved['_comment_' + f.id]) comments[f.id] = saved['_comment_' + f.id]; });
  return { action: action, selectedIds: selectedIds, comments: comments, globalComment: saved['_global'] || '' };
}

async function postAction(action) {
  var res = await fetch('/api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(getDecisionPayload(action))
  });
  return res.json();
}

document.getElementById('btn-implement').addEventListener('click', async function() {
  var btn = document.getElementById('btn-implement');
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    var r = await postAction('implement');
    document.getElementById('status-msg').textContent = r.ok ? 'Sent to Claude for implementation.' : 'Error: ' + r.error;
  } catch (e) { document.getElementById('status-msg').textContent = 'Error: ' + e.message; }
});

document.getElementById('btn-save').addEventListener('click', async function() {
  try {
    var r = await postAction('save');
    document.getElementById('status-msg').textContent = r.path ? 'Saved to ' + r.path : 'Error: ' + r.error;
  } catch (e) { document.getElementById('status-msg').textContent = 'Error: ' + e.message; }
});

document.getElementById('btn-done').addEventListener('click', async function() {
  await postAction('done');
  document.getElementById('status-msg').textContent = 'Done.';
});

document.getElementById('btn-select-all').addEventListener('click', function() {
  var lc = loadLocal();
  (reviewData ? reviewData.findings || [] : []).forEach(function(f) { lc['_checked_' + f.id] = true; });
  saveLocal(lc); renderFindings(); renderComments();
});

document.getElementById('btn-deselect-all').addEventListener('click', function() {
  var lc = loadLocal();
  (reviewData ? reviewData.findings || [] : []).forEach(function(f) { lc['_checked_' + f.id] = false; });
  saveLocal(lc); renderFindings(); renderComments();
});

document.querySelectorAll('.chip').forEach(function(chip) {
  chip.addEventListener('click', function() {
    document.querySelectorAll('.chip').forEach(function(c) { c.classList.remove('active'); });
    chip.classList.add('active'); activeFilter = chip.dataset.filter; renderFindings();
  });
});

document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('tab-findings').style.display = tab.dataset.tab === 'findings' ? '' : 'none';
    document.getElementById('tab-files').style.display = tab.dataset.tab === 'files' ? '' : 'none';
  });
});

document.getElementById('btn-toggle-view').addEventListener('click', function() {
  splitView = !splitView;
  document.getElementById('btn-toggle-view').textContent = splitView ? 'split' : 'unified';
  localStorage.setItem('acr-split', splitView ? '1' : '');
  if (activeFile) {
    var f = activeFindingId ? (reviewData.findings || []).find(function(f) { return f.id === activeFindingId; }) : null;
    renderDiff(activeFile, f ? f.line : null);
  }
});
if (localStorage.getItem('acr-split')) { splitView = true; document.getElementById('btn-toggle-view').textContent = 'split'; }

document.getElementById('btn-prev').addEventListener('click', function() {
  var findings = reviewData ? reviewData.findings || [] : [];
  if (!findings.length) return;
  findingIdx = Math.max(0, findingIdx - 1);
  setActiveFinding(findings[findingIdx].id);
});
document.getElementById('btn-next').addEventListener('click', function() {
  var findings = reviewData ? reviewData.findings || [] : [];
  if (!findings.length) return;
  findingIdx = Math.min(findings.length - 1, findingIdx + 1);
  setActiveFinding(findings[findingIdx].id);
});

document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  var findings = reviewData ? reviewData.findings || [] : [];
  if (e.key === 'j') {
    findingIdx = Math.min(findings.length - 1, findingIdx + 1);
    if (findings[findingIdx]) setActiveFinding(findings[findingIdx].id);
  } else if (e.key === 'k') {
    findingIdx = Math.max(0, findingIdx - 1);
    if (findings[findingIdx]) setActiveFinding(findings[findingIdx].id);
  } else if (e.key === ' ' && activeFindingId) {
    e.preventDefault();
    var cb = document.querySelector('.finding-cb[data-id="' + activeFindingId + '"]');
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  } else if (e.key === 'Enter' && activeFindingId) {
    var f = findings.find(function(f) { return f.id === activeFindingId; });
    if (f) renderDiff(f.file, f.line);
  }
});

init();

// Update notification toast — checks GitHub once on load.
// Dismissal is sticky per-version so the toast doesn't nag.
async function checkForUpdate() {
  try {
    var res = await fetch('/api/version-check');
    var info = await res.json();
    if (!info.updateAvailable) return;

    var dismissedKey = 'acr-toast-dismissed-' + info.latest;
    if (localStorage.getItem(dismissedKey)) return;

    document.getElementById('toast-title').textContent = 'Update available: v' + info.latest;
    document.getElementById('toast-body').textContent =
      'You have v' + info.installed + ' installed. Run this to update:';
    document.getElementById('toast-cmd').textContent = info.installCommand;
    document.getElementById('update-toast').classList.add('visible');

    document.getElementById('toast-copy').addEventListener('click', async function() {
      var btn = this;
      try {
        await navigator.clipboard.writeText(info.installCommand);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      } catch (_) {
        // Fallback: select the text so user can Cmd/Ctrl-C
        var range = document.createRange();
        range.selectNodeContents(document.getElementById('toast-cmd'));
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });

    document.getElementById('toast-close').addEventListener('click', function() {
      localStorage.setItem(dismissedKey, '1');
      document.getElementById('update-toast').classList.remove('visible');
    });
  } catch (_) {
    // Silently fail — update check is best-effort.
  }
}
checkForUpdate();
</script>
</body>
</html>`;
}

const server = http.createServer(function(req, res) {
  resetIdle(server);
  var url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/review') {
    var data = readFindings();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/version-check') {
    var installed = getInstalledVersion();
    fetchLatestVersion(function(latest) {
      var updateAvailable = installed && latest && compareSemver(latest, installed) > 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        installed: installed,
        latest: latest,
        updateAvailable: updateAvailable,
        platform: detectPlatform(),
        installCommand: buildInstallCommand()
      }));
    });
    return;
  }

  if (req.method === 'POST') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      var payload = {};
      try { payload = JSON.parse(body); } catch (_) {}

      if (url.pathname === '/api/implement') {
        try {
          fs.writeFileSync(decisionFile, JSON.stringify(Object.assign({ action: 'implement' }, payload)), 'utf8');
          try { var rd = readFindings(); rd._decision = payload; saveMarkdown(rd); } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
        setTimeout(function() { server.close(function() { process.exit(0); }); }, 500);
        return;
      }

      if (url.pathname === '/api/save') {
        try {
          var rd2 = readFindings(); rd2._decision = payload;
          var savedPath = saveMarkdown(rd2);
          fs.writeFileSync(decisionFile, JSON.stringify(Object.assign({ action: 'save' }, payload)), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: savedPath }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }

      if (url.pathname === '/api/done') {
        fs.writeFileSync(decisionFile, JSON.stringify(Object.assign({ action: 'done' }, payload)), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        setTimeout(function() { server.close(function() { process.exit(0); }); }, 300);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, '127.0.0.1', function() {
  var addr = server.address();
  var url = 'http://127.0.0.1:' + addr.port;
  console.log('Review server listening at ' + url);
  resetIdle(server);
  openBrowser(url);
});
