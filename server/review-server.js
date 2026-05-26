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

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const MARKETPLACE_URL = 'https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/.claude-plugin/marketplace.json';
const INSTALL_BASE = 'curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash';

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

// In-memory chat session manager
var chatSessions = new Map();
var chatSessionCounter = 0;

function createChatSession(model) {
  var id = 'chat-' + (++chatSessionCounter) + '-' + Date.now();
  chatSessions.set(id, { id: id, model: model || 'claude-sonnet-4-6', firstQuery: true, proc: null });
  return id;
}

function buildChatSystemPrompt(reviewData, currentFile) {
  var lines = [];
  lines.push('You are a code review assistant. The user is reviewing a git diff and has questions.');
  lines.push('Answer concisely based on the diff and findings below.');
  lines.push('');
  lines.push('## Verdict');
  lines.push(reviewData.verdict || '(no verdict)');
  lines.push('');
  lines.push('## Findings');
  var findings = (reviewData.findings || []).slice(0, 10);
  findings.forEach(function(f) {
    lines.push('[' + (f.severity || 'NOTE') + '] ' + (f.file || '') + ':' + (f.line || '') + ' — ' + (f.finding || ''));
  });
  if (currentFile) {
    lines.push('');
    lines.push('## Current File');
    lines.push(currentFile);
  }
  lines.push('');
  lines.push('## Full Diff');
  lines.push('```diff');
  var diffParts = [];
  (reviewData.files || []).forEach(function(f) {
    if (f.diff) diffParts.push('--- ' + f.path + '\n' + f.diff);
  });
  var fullDiff = diffParts.join('\n\n');
  if (fullDiff.length > 40000) fullDiff = fullDiff.slice(0, 40000) + '\n...(truncated)';
  lines.push(fullDiff);
  lines.push('```');
  return lines.join('\n');
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

function saveMarkdown(data, lineAnnotations) {
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

  // Line annotations section
  var annots = lineAnnotations || {};
  var annotKeys = Object.keys(annots);
  if (annotKeys.length > 0) {
    md += `## Line Annotations\n\n`;
    annotKeys.forEach(function(key) {
      var a = annots[key];
      md += `- **${a.file}** lines ${a.lineStart}–${a.lineEnd} (${a.side}): [${a.type}] ${a.text}\n`;
    });
    md += '\n';
  }

  md += `---\n_Generated by agentic-code-reviewer v1.1.1_\n`;

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
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
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
.settings-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 18px; padding: 0 4px; line-height: 1; flex-shrink: 0; align-self: center; }
.settings-btn:hover { color: var(--text); }
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

/* Annotation Toolstrip */
.annotation-toolstrip {
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  padding: 5px 12px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex-shrink: 0;
}
.toolstrip-group {
  display: flex;
  gap: 1px;
  margin-right: 4px;
}
.toolstrip-btn {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  font-weight: 400;
  padding: 3px 7px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: color 120ms ease-out, background 120ms ease-out;
}
.toolstrip-btn .ts-label { display: none; }
.toolstrip-btn:hover .ts-label,
.toolstrip-btn.active .ts-label { display: inline; }
.toolstrip-btn:hover {
  color: var(--text);
  background: var(--surface);
}
.toolstrip-btn:active { transform: scale(0.97); }
.toolstrip-btn.active {
  font-weight: 500;
  color: var(--text);
  background: var(--surface);
}
.toolstrip-help {
  position: absolute;
  right: 12px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
  text-decoration: underline dotted;
}
.toolstrip-help:hover { color: var(--accent); }

.diff-view { flex: 1; overflow: auto; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; line-height: 1.6; }
.diff-table { width: 100%; border-collapse: collapse; }
.diff-table td { padding: 0 8px; white-space: pre; vertical-align: top; }
.diff-line-num { color: var(--text-dim); text-align: right; user-select: none; width: 45px; border-right: 1px solid var(--border); padding-right: 8px; }
.diff-gutter { width: 24px; text-align: center; user-select: none; }
.diff-line-add { background: rgba(166,227,161,.08); color: var(--green); }
.diff-line-del { background: rgba(243,139,168,.08); color: var(--red); }
.diff-line-ctx { color: var(--text); }
.diff-line-hunk { color: var(--purple); background: rgba(203,166,247,.05); }
.diff-flagged { background: rgba(250,179,135,.12) !important; }
.diff-flagged-critical { background: rgba(243,139,168,.15) !important; }
.gutter-dot { font-size: 10px; cursor: default; }
.gutter-dot-CRITICAL { color: var(--critical); }
.gutter-dot-HIGH { color: var(--high); }
.gutter-dot-NOTE { color: var(--note); }
.gutter-dot-ANNOTATION { color: var(--purple); cursor: pointer; }
.gutter-dot-LABEL { color: var(--green); cursor: pointer; }
.line-selected td { background: rgba(137,180,250,.12) !important; outline: 1px solid rgba(137,180,250,.3); }
.diff-view.pinpoint-mode tr:hover td { outline: 2px dashed var(--accent); cursor: crosshair; }
.empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: 14px; }
.right-panel { width: 300px; min-width: 240px; background: var(--bg2); border-left: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; }
.right-section { padding: 10px 12px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.comments-scroll { overflow-y: auto; padding: 8px; }
.comment-card { background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; margin-bottom: 8px; }
.comment-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.comment-location { font-family: monospace; font-size: 11px; color: var(--text-dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.finding-detail { font-size: 12px; color: var(--text-muted); margin-bottom: 6px; line-height: 1.4; }
.evidence-block { background: var(--bg2); border-left: 2px solid var(--surface2); padding: 4px 8px; font-family: monospace; font-size: 11px; color: var(--text-dim); margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.comment-input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; padding: 6px 8px; resize: vertical; min-height: 50px; font-family: inherit; }
.comment-input:focus { outline: none; border-color: var(--accent); }
.global-comment-area { padding: 10px 12px; border-top: 1px solid var(--border); flex-shrink: 0; }
.global-comment-label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin-bottom: 6px; }
.global-textarea { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; padding: 6px 8px; resize: vertical; min-height: 60px; font-family: inherit; }
.global-textarea:focus { outline: none; border-color: var(--accent); }

/* Chat panel */
.chat-section { flex: 1; min-height: 180px; display: flex; flex-direction: column; border-top: 1px solid var(--border); overflow: hidden; }
.chat-header { display: flex; align-items: center; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.chat-model-label { margin-left: 4px; font-size: 10px; color: var(--accent); text-transform: none; letter-spacing: 0; }
.chat-messages { flex: 1; overflow-y: auto; padding: 8px; font-size: 12px; }
.chat-empty { color: var(--text-dim); font-size: 12px; padding: 8px 0; }
.chat-q { color: var(--text-muted); margin-bottom: 4px; padding: 6px 8px; background: var(--surface); border-radius: var(--radius); }
.chat-a { color: var(--text); margin-bottom: 10px; padding: 6px 8px; border-left: 2px solid var(--accent); line-height: 1.5; white-space: pre-wrap; }
.chat-cursor::after { content: '▋'; animation: blink .7s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }
.chat-input-area { padding: 8px; border-top: 1px solid var(--border); display: flex; gap: 6px; flex-shrink: 0; }
.chat-textarea { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; padding: 6px 8px; resize: none; font-family: inherit; }
.chat-textarea:focus { outline: none; border-color: var(--accent); }
.chat-send { padding: 6px 12px; font-size: 12px; }

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

/* Mini toolbar */
#mini-toolbar {
  position: fixed;
  z-index: 200;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 8px;
  display: none;
  gap: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,.4);
}
#mini-toolbar.visible { display: flex; }
.mini-btn {
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  border-radius: 12px;
  white-space: nowrap;
}
.mini-btn:hover { background: var(--surface); color: var(--text); }
.mini-btn-cancel { color: var(--red); }

/* Comment popover */
#comment-popover {
  position: fixed;
  z-index: 300;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  width: 320px;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
  display: none;
}
#comment-popover.visible { display: block; }
.popover-header { font-size: 11px; color: var(--text-dim); font-family: monospace; margin-bottom: 8px; }
.popover-textarea { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; padding: 6px 8px; resize: vertical; min-height: 70px; font-family: inherit; }
.popover-textarea:focus { outline: none; border-color: var(--accent); }
.popover-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.popover-btn { padding: 5px 12px; border-radius: var(--radius); border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-size: 12px; }
.popover-btn:hover { border-color: var(--accent); color: var(--accent); }
.popover-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--bg3); font-weight: 600; }
.popover-btn-primary:hover { opacity: .9; }
.popover-btn-close { border: none; background: none; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 2px 6px; }

/* Quick label picker */
#quick-label-picker {
  position: fixed;
  z-index: 300;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
  display: none;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
}
#quick-label-picker.visible { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.label-btn {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}
.label-btn:hover { background: var(--surface); border-color: var(--accent); }

/* Help modal */
#help-modal {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.6);
  display: none; align-items: center; justify-content: center;
}
#help-modal.visible { display: flex; }
.help-dialog {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,.6);
}
.help-header { padding: 14px 16px; font-weight: 600; font-size: 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.help-close { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 18px; line-height: 1; }
.help-tabs { display: flex; border-bottom: 1px solid var(--border); }
.help-tab { flex: 1; padding: 8px; font-size: 12px; text-align: center; cursor: pointer; color: var(--text-dim); border-bottom: 2px solid transparent; background: none; border-left: none; border-right: none; border-top: none; }
.help-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.help-body { flex: 1; overflow-y: auto; padding: 16px; font-size: 13px; line-height: 1.6; color: var(--text-muted); }
.help-body h3 { font-size: 13px; color: var(--text); margin: 10px 0 4px; }
.help-body p { margin-bottom: 8px; }

/* Settings popover */
#settings-popover {
  position: absolute;
  top: 42px;
  right: 16px;
  z-index: 500;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 240px;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
  display: none;
}
#settings-popover.visible { display: block; }
.settings-header { padding: 10px 12px; font-weight: 600; font-size: 13px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.settings-close { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 16px; line-height: 1; }
.settings-body { padding: 12px; }
.settings-label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); margin-bottom: 6px; }
.settings-select { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; padding: 5px 8px; }
.settings-select:focus { outline: none; border-color: var(--accent); }

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
    <button class="settings-btn" id="btn-settings" title="Settings">&#9881;</button>
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
      <div class="annotation-toolstrip" id="annotation-toolstrip">
        <div class="toolstrip-group">
          <button class="toolstrip-btn active" id="ts-select" title="Drag to select text">
            <i class="fa-solid fa-mouse-pointer ts-icon"></i><span class="ts-label"> Select</span>
          </button>
          <button class="toolstrip-btn" id="ts-pinpoint" title="Pinpoint: click to target a line">
            <i class="fa-solid fa-crosshairs ts-icon"></i><span class="ts-label"> Pinpoint</span>
          </button>
        </div>
        <div class="toolstrip-group">
          <button class="toolstrip-btn active" id="ts-markup" title="Markup: select then choose action">
            <i class="fa-solid fa-pen ts-icon"></i><span class="ts-label"> Markup</span>
          </button>
          <button class="toolstrip-btn" id="ts-comment" title="Select then comment immediately">
            <i class="fa-solid fa-comment ts-icon"></i><span class="ts-label"> Comment</span>
          </button>
          <button class="toolstrip-btn" id="ts-redline" title="Redline: select to mark for deletion">
            <i class="fa-solid fa-ban ts-icon"></i><span class="ts-label"> Redline</span>
          </button>
          <button class="toolstrip-btn" id="ts-label" title="Label: select then apply a quick label">
            <i class="fa-solid fa-tag ts-icon"></i><span class="ts-label"> Label</span>
          </button>
        </div>
        <span class="toolstrip-help" id="ts-help">how does this work?</span>
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
      <div class="chat-section" id="chat-section">
        <div class="chat-header">
          &#10024; Chat <span class="chat-model-label" id="chat-model-label">· Sonnet 4.6</span>
        </div>
        <div class="chat-messages" id="chat-messages">
          <div class="chat-empty">Ask Claude about this diff...</div>
        </div>
        <div class="chat-input-area">
          <textarea class="chat-textarea" id="chat-input" placeholder="Ask about this diff..." rows="2"></textarea>
          <button class="btn btn-primary chat-send" id="btn-chat-send">Send</button>
        </div>
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

<!-- Mini toolbar (appears above selection in Markup mode) -->
<div id="mini-toolbar">
  <button class="mini-btn" id="mini-comment">&#128172; Comment</button>
  <button class="mini-btn" id="mini-askai">&#10024; Ask AI</button>
  <button class="mini-btn" id="mini-copy">&#128203; Copy</button>
  <button class="mini-btn" id="mini-redline">&#128683; Redline</button>
  <button class="mini-btn mini-btn-cancel" id="mini-cancel">&#10005;</button>
</div>

<!-- Comment popover -->
<div id="comment-popover">
  <div class="popover-header" id="popover-header"></div>
  <textarea class="popover-textarea" id="popover-textarea" placeholder="type your annotation..."></textarea>
  <div class="popover-actions">
    <button class="popover-btn popover-btn-close" id="popover-close">&#10005;</button>
    <button class="popover-btn" id="popover-askai">Ask AI</button>
    <button class="popover-btn popover-btn-primary" id="popover-save">Save</button>
  </div>
</div>

<!-- Quick label picker -->
<div id="quick-label-picker">
  <button class="label-btn" data-label="Clarify this" data-emoji="&#10067;">&#10067; Clarify this</button>
  <button class="label-btn" data-label="Verify this" data-emoji="&#128269;">&#128269; Verify this</button>
  <button class="label-btn" data-label="Consider alternatives" data-emoji="&#128260;">&#128260; Alternatives</button>
  <button class="label-btn" data-label="Needs tests" data-emoji="&#129514;">&#129514; Needs tests</button>
  <button class="label-btn" data-label="Looks good" data-emoji="&#128077;">&#128077; Looks good</button>
  <button class="label-btn" data-label="Out of scope" data-emoji="&#128683;">&#128683; Out of scope</button>
</div>

<!-- Help modal -->
<div id="help-modal">
  <div class="help-dialog">
    <div class="help-header">
      Annotation Modes
      <button class="help-close" id="help-close">&#10005;</button>
    </div>
    <div class="help-tabs">
      <button class="help-tab active" data-htab="modes">Modes</button>
      <button class="help-tab" data-htab="persistence">What happens</button>
    </div>
    <div class="help-body" id="help-body-modes">
      <h3>&#8286; Select + &#9998; Markup (default)</h3>
      <p>Drag to select lines, then a floating toolbar appears. Choose Comment, Ask AI, Copy, or Redline from the toolbar. Keyboard shortcut: press any character while the toolbar is visible to open the comment popover with that character as the first letter.</p>
      <h3>&#8286; Select + &#128172; Comment</h3>
      <p>Drag to select lines and the comment popover opens immediately — no toolbar step needed.</p>
      <h3>&#8286; Select + &#128683; Redline</h3>
      <p>Drag to select lines and a deletion annotation is created immediately without any dialog. Use this to quickly flag lines for removal.</p>
      <h3>&#8286; Select + &#9889; Label</h3>
      <p>Drag to select lines and an emoji label picker appears. Choose a label to attach (Clarify, Verify, Alternatives, Needs Tests, Looks Good, Out of Scope).</p>
      <h3>&#8853; Pinpoint mode</h3>
      <p>Move your mouse over the diff to highlight individual lines (dashed outline). Click a line to target it exactly. Works with all action modes above.</p>
    </div>
    <div class="help-body" id="help-body-persistence" style="display:none">
      <h3>Where annotations go</h3>
      <p>Annotations are saved to <code>localStorage</code> so they survive page refreshes. A colored dot appears in the diff gutter: <span style="color:var(--purple)">●</span> for comments/redlines and <span style="color:var(--green)">●</span> for labels. Click a dot to re-edit.</p>
      <h3>Included in Save &amp; Implement</h3>
      <p>When you click <strong>Save</strong> or <strong>Implement Selected</strong>, all line annotations are included in the payload and in the saved markdown under a "Line Annotations" section.</p>
      <h3>Ask AI integration</h3>
      <p>Use "Ask AI" in a comment to pre-fill the chat with the selected code as context. The chat streams responses from Claude directly.</p>
    </div>
  </div>
</div>

<!-- Settings popover -->
<div id="settings-popover">
  <div class="settings-header">
    Settings
    <button class="settings-close" id="settings-close">&#10005;</button>
  </div>
  <div class="settings-body">
    <div class="settings-label">Chat model</div>
    <select class="settings-select" id="settings-model">
      <option value="claude-sonnet-4-6">Sonnet 4.6 (default)</option>
      <option value="claude-opus-4-7">Opus 4.7</option>
      <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
    </select>
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
var ANNOT_KEY = 'acr-line-annotations';
var MODEL_KEY = 'acr-chat-model';

// Annotation state
var inputMethod = 'drag';   // 'drag' | 'pinpoint'
var editorMode = 'markup';  // 'markup' | 'comment' | 'redline' | 'quickLabel'
var currentSelection = null; // { file, lineStart, lineEnd, side, selectedText, anchorTr }

// Chat state
var chatSessionId = null;
var chatMessageCount = 0;
var chatAbortController = null;

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch (_) { return {}; }
}
function saveLocal(data) { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); }

function loadAnnotations() {
  try { return JSON.parse(localStorage.getItem(ANNOT_KEY) || '{}'); } catch (_) { return {}; }
}
function saveAnnotations(data) { localStorage.setItem(ANNOT_KEY, JSON.stringify(data)); }

function annotKey(file, lineStart, lineEnd, side) {
  return file + '|' + lineStart + '|' + lineEnd + '|' + side;
}

async function init() {
  var res = await fetch('/api/review');
  reviewData = await res.json();
  render();

  // Restore settings
  var savedModel = localStorage.getItem(MODEL_KEY) || 'claude-sonnet-4-6';
  document.getElementById('settings-model').value = savedModel;
  updateChatModelLabel(savedModel);
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
  var annotations = loadAnnotations();

  lines.forEach(function(ln) {
    var isHighlight = (ln.right && ln.right === highlightLine) || (ln.left && ln.left === highlightLine);
    var findings = (reviewData.findings || []).filter(function(f) {
      return f.file === filePath && (ln.right ? f.line === ln.right : (ln.left ? f.line === ln.left : false));
    });
    var topSev = null;
    if (findings.length) {
      topSev = findings.reduce(function(a, b) { return order[a.severity] <= order[b.severity] ? a : b; }).severity;
    }

    // Check for user annotations on this line
    var lineNum = ln.right || ln.left;
    var side = ln.right ? 'new' : 'old';
    var lineAnnot = null;
    if (lineNum) {
      // Find any annotation that overlaps this line
      Object.keys(annotations).forEach(function(k) {
        var a = annotations[k];
        if (a.file === filePath && a.side === side && lineNum >= a.lineStart && lineNum <= a.lineEnd) {
          lineAnnot = a;
        }
      });
    }

    var rowCls = 'diff-line-' + (ln.type === 'add' ? 'add' : ln.type === 'del' ? 'del' : ln.type === 'hunk' ? 'hunk' : 'ctx');
    if (topSev) rowCls += topSev === 'CRITICAL' ? ' diff-flagged-critical' : ' diff-flagged';
    var tr = document.createElement('tr');
    tr.className = rowCls;
    if (ln.right) { tr.dataset.lineRight = ln.right; tr.dataset.side = 'new'; }
    if (ln.left) { tr.dataset.lineLeft = ln.left; tr.dataset.side = tr.dataset.side || 'old'; }
    tr.dataset.file = filePath || '';
    if (isHighlight) highlightRow = tr;

    var gutterTd = document.createElement('td');
    gutterTd.className = 'diff-gutter';

    if (topSev) {
      var dot = document.createElement('span');
      dot.className = 'gutter-dot gutter-dot-' + topSev;
      dot.textContent = '•';
      gutterTd.appendChild(dot);
    }

    if (lineAnnot) {
      var annotDot = document.createElement('span');
      annotDot.className = 'gutter-dot gutter-dot-' + (lineAnnot.type === 'LABEL' ? 'LABEL' : 'ANNOTATION');
      annotDot.textContent = '●';
      annotDot.title = lineAnnot.text;
      (function(a) {
        annotDot.addEventListener('click', function(e) {
          e.stopPropagation();
          openCommentPopover({
            file: a.file, lineStart: a.lineStart, lineEnd: a.lineEnd,
            side: a.side, selectedText: a.linesText || '', anchorTr: tr
          }, a.text);
        });
      })(lineAnnot);
      gutterTd.appendChild(annotDot);
    }

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

  // Set up diff interaction
  setupDiffInteraction(diffView, filePath);
}

// ─── Annotation toolstrip ───────────────────────────────────────────────────

document.getElementById('ts-select').addEventListener('click', function() {
  inputMethod = 'drag';
  document.getElementById('ts-select').classList.add('active');
  document.getElementById('ts-pinpoint').classList.remove('active');
  document.getElementById('diff-view').classList.remove('pinpoint-mode');
});
document.getElementById('ts-pinpoint').addEventListener('click', function() {
  inputMethod = 'pinpoint';
  document.getElementById('ts-pinpoint').classList.add('active');
  document.getElementById('ts-select').classList.remove('active');
  document.getElementById('diff-view').classList.add('pinpoint-mode');
});

var actionBtns = ['ts-markup','ts-comment','ts-redline','ts-label'];
var modeMap = { 'ts-markup': 'markup', 'ts-comment': 'comment', 'ts-redline': 'redline', 'ts-label': 'quickLabel' };
actionBtns.forEach(function(id) {
  document.getElementById(id).addEventListener('click', function() {
    actionBtns.forEach(function(bid) { document.getElementById(bid).classList.remove('active'); });
    document.getElementById(id).classList.add('active');
    editorMode = modeMap[id];
  });
});

document.getElementById('ts-help').addEventListener('click', function() {
  document.getElementById('help-modal').classList.add('visible');
});
document.getElementById('help-close').addEventListener('click', function() {
  document.getElementById('help-modal').classList.remove('visible');
});
document.getElementById('help-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('visible');
});
document.querySelectorAll('.help-tab').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.help-tab').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('help-body-modes').style.display = btn.dataset.htab === 'modes' ? '' : 'none';
    document.getElementById('help-body-persistence').style.display = btn.dataset.htab === 'persistence' ? '' : 'none';
  });
});

// ─── Diff interaction ────────────────────────────────────────────────────────

function setupDiffInteraction(diffView, filePath) {
  // Pinpoint mode: highlight on hover, capture on click
  diffView.addEventListener('mousemove', function(e) {
    if (inputMethod !== 'pinpoint') return;
    var tr = e.target.closest('tr');
    if (!tr) return;
  });

  diffView.addEventListener('click', function(e) {
    if (inputMethod !== 'pinpoint') return;
    var tr = e.target.closest('tr');
    if (!tr || !tr.dataset.file) return;
    var lineNum = parseInt(tr.dataset.lineRight || tr.dataset.lineLeft || '0');
    if (!lineNum) return;
    var side = tr.dataset.side || 'new';
    var sel = { file: filePath, lineStart: lineNum, lineEnd: lineNum, side: side, selectedText: tr.textContent.trim(), anchorTr: tr };
    clearLineSelection();
    tr.classList.add('line-selected');
    handleDiffSelection(sel);
  });

  // Drag / Select mode: capture on mouseup
  diffView.addEventListener('mouseup', function(e) {
    if (inputMethod !== 'drag') return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    var selectedText = sel.toString().trim();
    if (!selectedText) return;

    // Walk up from anchor node to find TR
    var anchorNode = sel.anchorNode;
    var focusNode = sel.focusNode;
    var anchorTr = anchorNode ? anchorNode.parentElement : null;
    while (anchorTr && anchorTr.tagName !== 'TR') anchorTr = anchorTr.parentElement;
    var focusTr = focusNode ? focusNode.parentElement : null;
    while (focusTr && focusTr.tagName !== 'TR') focusTr = focusTr.parentElement;

    if (!anchorTr || !focusTr) return;

    var lineA = parseInt(anchorTr.dataset.lineRight || anchorTr.dataset.lineLeft || '0');
    var lineB = parseInt(focusTr.dataset.lineRight || focusTr.dataset.lineLeft || '0');
    if (!lineA && !lineB) return;

    var lineStart = Math.min(lineA || lineB, lineB || lineA);
    var lineEnd = Math.max(lineA || lineB, lineB || lineA);
    var side = anchorTr.dataset.side || 'new';

    // Highlight selected rows
    clearLineSelection();
    var trs = diffView.querySelectorAll('tr');
    trs.forEach(function(tr) {
      var ln = parseInt(tr.dataset.lineRight || tr.dataset.lineLeft || '0');
      if (ln >= lineStart && ln <= lineEnd && tr.dataset.side === side) {
        tr.classList.add('line-selected');
      }
    });

    var selObj = { file: filePath, lineStart: lineStart, lineEnd: lineEnd, side: side, selectedText: selectedText, anchorTr: anchorTr };
    handleDiffSelection(selObj);
  });
}

function clearLineSelection() {
  document.querySelectorAll('.line-selected').forEach(function(tr) {
    tr.classList.remove('line-selected');
  });
  currentSelection = null;
}

function handleDiffSelection(sel) {
  currentSelection = sel;
  if (editorMode === 'markup') {
    showMiniToolbar(sel);
  } else if (editorMode === 'comment') {
    openCommentPopover(sel, '');
  } else if (editorMode === 'redline') {
    saveAnnotationDirect(sel, 'REDLINE', '~~redline~~');
    clearLineSelection();
  } else if (editorMode === 'quickLabel') {
    showQuickLabelPicker(sel);
  }
}

// ─── Mini toolbar ────────────────────────────────────────────────────────────

function showMiniToolbar(sel) {
  var toolbar = document.getElementById('mini-toolbar');
  if (!sel.anchorTr) { toolbar.classList.remove('visible'); return; }
  var rect = sel.anchorTr.getBoundingClientRect();
  toolbar.style.top = (rect.top - 44 + window.scrollY) + 'px';
  toolbar.style.left = (rect.left + rect.width / 2 - 120) + 'px';
  toolbar.classList.add('visible');
}

document.getElementById('mini-comment').addEventListener('click', function() {
  hideMiniToolbar();
  if (currentSelection) openCommentPopover(currentSelection, '');
});
document.getElementById('mini-askai').addEventListener('click', function() {
  hideMiniToolbar();
  if (currentSelection) {
    openCommentPopover(currentSelection, '', true);
  }
});
document.getElementById('mini-copy').addEventListener('click', function() {
  if (currentSelection && currentSelection.selectedText) {
    navigator.clipboard.writeText(currentSelection.selectedText).then(function() {
      var btn = document.getElementById('mini-copy');
      btn.textContent = '✓ Copied';
      setTimeout(function() { btn.textContent = '📋 Copy'; }, 1500);
    }).catch(function() {});
  }
});
document.getElementById('mini-redline').addEventListener('click', function() {
  hideMiniToolbar();
  if (currentSelection) {
    saveAnnotationDirect(currentSelection, 'REDLINE', '~~redline~~');
    clearLineSelection();
  }
});
document.getElementById('mini-cancel').addEventListener('click', function() {
  hideMiniToolbar();
  clearLineSelection();
});

function hideMiniToolbar() {
  document.getElementById('mini-toolbar').classList.remove('visible');
}

// Keyboard shortcuts while mini toolbar visible
document.addEventListener('keydown', function(e) {
  var toolbar = document.getElementById('mini-toolbar');
  if (!toolbar.classList.contains('visible')) return;
  if (e.key === 'Escape') {
    hideMiniToolbar(); clearLineSelection();
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    hideMiniToolbar();
    if (currentSelection) openCommentPopover(currentSelection, e.key);
  }
});

// ─── Comment popover ─────────────────────────────────────────────────────────

var commentPopoverAutoSubmit = false;

function openCommentPopover(sel, initialText, autoAskAI) {
  currentSelection = sel;
  commentPopoverAutoSubmit = !!autoAskAI;
  var header = document.getElementById('popover-header');
  var lineRange = sel.lineStart === sel.lineEnd ? 'line ' + sel.lineStart : 'lines ' + sel.lineStart + '–' + sel.lineEnd;
  header.textContent = sel.file + ' · ' + lineRange + ' (' + sel.side + ')';

  var ta = document.getElementById('popover-textarea');
  ta.value = initialText || '';

  // Load existing annotation if any
  var existing = loadAnnotations()[annotKey(sel.file, sel.lineStart, sel.lineEnd, sel.side)];
  if (existing) ta.value = existing.text || initialText || '';

  var popover = document.getElementById('comment-popover');
  // Position near top-right of viewport with some margin
  var x = window.innerWidth - 340;
  var y = sel.anchorTr ? sel.anchorTr.getBoundingClientRect().top : 120;
  y = Math.max(60, Math.min(y, window.innerHeight - 180));
  popover.style.top = y + 'px';
  popover.style.left = x + 'px';
  popover.classList.add('visible');
  ta.focus();
  if (initialText) { ta.selectionStart = ta.selectionEnd = ta.value.length; }

  if (autoAskAI) {
    setTimeout(function() { submitPopoverAskAI(); }, 100);
  }
}

function closeCommentPopover() {
  document.getElementById('comment-popover').classList.remove('visible');
  commentPopoverAutoSubmit = false;
}

function submitPopoverSave() {
  var ta = document.getElementById('popover-textarea');
  var text = ta.value.trim();
  if (!text && !commentPopoverAutoSubmit) return;
  if (currentSelection) {
    var annots = loadAnnotations();
    var k = annotKey(currentSelection.file, currentSelection.lineStart, currentSelection.lineEnd, currentSelection.side);
    annots[k] = {
      file: currentSelection.file, lineStart: currentSelection.lineStart, lineEnd: currentSelection.lineEnd,
      side: currentSelection.side, text: text, linesText: currentSelection.selectedText || '', type: 'COMMENT'
    };
    saveAnnotations(annots);
    if (activeFile) renderDiff(activeFile, activeFindingId ? (reviewData.findings || []).find(function(f) { return f.id === activeFindingId; }) && (reviewData.findings || []).find(function(f) { return f.id === activeFindingId; }).line : null);
  }
  closeCommentPopover();
  clearLineSelection();
}

function submitPopoverAskAI() {
  var ta = document.getElementById('popover-textarea');
  var commentText = ta.value.trim() || 'What does this change do?';
  if (currentSelection) {
    var lineRange = currentSelection.lineStart === currentSelection.lineEnd ? 'line ' + currentSelection.lineStart : 'lines ' + currentSelection.lineStart + '–' + currentSelection.lineEnd;
    var fence = '\`\`\`';
    var prompt = 'Re: ' + currentSelection.file + ' ' + lineRange + '\\n' + fence + '\\n' + (currentSelection.selectedText || '') + '\\n' + fence + '\\n\\n' + commentText;
    // Save the annotation first
    if (ta.value.trim()) {
      var annots = loadAnnotations();
      var k = annotKey(currentSelection.file, currentSelection.lineStart, currentSelection.lineEnd, currentSelection.side);
      annots[k] = {
        file: currentSelection.file, lineStart: currentSelection.lineStart, lineEnd: currentSelection.lineEnd,
        side: currentSelection.side, text: ta.value.trim(), linesText: currentSelection.selectedText || '', type: 'COMMENT'
      };
      saveAnnotations(annots);
    }
    closeCommentPopover();
    clearLineSelection();
    // Pre-fill chat and send
    document.getElementById('chat-input').value = prompt;
    sendChatMessage(prompt);
    document.getElementById('chat-section').scrollIntoView({ block: 'nearest' });
  }
}

document.getElementById('popover-save').addEventListener('click', submitPopoverSave);
document.getElementById('popover-askai').addEventListener('click', submitPopoverAskAI);
document.getElementById('popover-close').addEventListener('click', closeCommentPopover);
document.getElementById('popover-textarea').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault(); submitPopoverSave();
  } else if (e.key === 'Escape') {
    closeCommentPopover();
  }
});

// ─── Quick label picker ───────────────────────────────────────────────────────

function showQuickLabelPicker(sel) {
  var picker = document.getElementById('quick-label-picker');
  var x = window.innerWidth - 240;
  var y = sel.anchorTr ? sel.anchorTr.getBoundingClientRect().top : 120;
  y = Math.max(60, Math.min(y, window.innerHeight - 200));
  picker.style.top = y + 'px';
  picker.style.left = x + 'px';
  picker.classList.add('visible');
}

function hideQuickLabelPicker() {
  document.getElementById('quick-label-picker').classList.remove('visible');
}

document.querySelectorAll('.label-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (!currentSelection) { hideQuickLabelPicker(); return; }
    var labelText = btn.dataset.emoji + ' ' + btn.dataset.label;
    saveAnnotationDirect(currentSelection, 'LABEL', labelText);
    hideQuickLabelPicker();
    clearLineSelection();
  });
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    hideQuickLabelPicker();
    closeCommentPopover();
    document.getElementById('help-modal').classList.remove('visible');
    document.getElementById('settings-popover').classList.remove('visible');
  }
});

function saveAnnotationDirect(sel, type, text) {
  var annots = loadAnnotations();
  var k = annotKey(sel.file, sel.lineStart, sel.lineEnd, sel.side);
  annots[k] = {
    file: sel.file, lineStart: sel.lineStart, lineEnd: sel.lineEnd,
    side: sel.side, text: text, linesText: sel.selectedText || '', type: type
  };
  saveAnnotations(annots);
  if (activeFile) {
    var hl = activeFindingId ? ((reviewData.findings || []).find(function(f) { return f.id === activeFindingId; }) || {}).line : null;
    renderDiff(activeFile, hl);
  }
}

// ─── Settings popover ────────────────────────────────────────────────────────

document.getElementById('btn-settings').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('settings-popover').classList.toggle('visible');
});
document.getElementById('settings-close').addEventListener('click', function() {
  document.getElementById('settings-popover').classList.remove('visible');
});
document.getElementById('settings-model').addEventListener('change', function() {
  var model = this.value;
  localStorage.setItem(MODEL_KEY, model);
  // Reset chat session so next message uses new model
  chatSessionId = null;
  updateChatModelLabel(model);
});
document.addEventListener('click', function(e) {
  var popover = document.getElementById('settings-popover');
  if (popover.classList.contains('visible') && !popover.contains(e.target) && e.target.id !== 'btn-settings') {
    popover.classList.remove('visible');
  }
});

function updateChatModelLabel(model) {
  var labels = {
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-opus-4-7': 'Opus 4.7',
    'claude-haiku-4-5-20251001': 'Haiku 4.5'
  };
  document.getElementById('chat-model-label').textContent = '· ' + (labels[model] || model);
}

// ─── Chat panel ──────────────────────────────────────────────────────────────

async function ensureChatSession() {
  if (chatSessionId) return chatSessionId;
  var model = localStorage.getItem(MODEL_KEY) || 'claude-sonnet-4-6';
  var res = await fetch('/api/chat/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model })
  });
  var data = await res.json();
  chatSessionId = data.sessionId;
  return chatSessionId;
}

async function sendChatMessage(text) {
  if (!text) {
    text = document.getElementById('chat-input').value.trim();
    if (!text) return;
  }
  document.getElementById('chat-input').value = '';
  document.getElementById('btn-chat-send').disabled = true;

  // Remove empty placeholder
  var msgs = document.getElementById('chat-messages');
  var empty = msgs.querySelector('.chat-empty');
  if (empty) msgs.removeChild(empty);

  var n = ++chatMessageCount;

  var qDiv = document.createElement('div');
  qDiv.className = 'chat-q';
  qDiv.textContent = 'You: ' + text;
  msgs.appendChild(qDiv);

  var aDiv = document.createElement('div');
  aDiv.className = 'chat-a chat-cursor';
  aDiv.id = 'chat-a-' + n;
  msgs.appendChild(aDiv);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    var sid = await ensureChatSession();
    var res = await fetch('/api/chat/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, prompt: text, currentFile: activeFile || '' })
    });

    if (!res.ok) {
      aDiv.classList.remove('chat-cursor');
      aDiv.textContent = 'Error: ' + res.status;
      document.getElementById('btn-chat-send').disabled = false;
      return;
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\\n');
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith('data: ')) continue;
        var payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          var obj = JSON.parse(payload);
          if (obj.type === 'text_delta') {
            aDiv.textContent += obj.delta;
            msgs.scrollTop = msgs.scrollHeight;
          } else if (obj.type === 'error') {
            aDiv.textContent += '\\n[Error: ' + obj.message + ']';
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    aDiv.textContent = 'Error: ' + err.message;
  }

  aDiv.classList.remove('chat-cursor');
  document.getElementById('btn-chat-send').disabled = false;
  msgs.scrollTop = msgs.scrollHeight;
}

document.getElementById('btn-chat-send').addEventListener('click', function() { sendChatMessage(); });
document.getElementById('chat-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// ─── Existing UI wiring ──────────────────────────────────────────────────────

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
  var lineAnnotations = loadAnnotations();
  return { action: action, selectedIds: selectedIds, comments: comments, globalComment: saved['_global'] || '', lineAnnotations: lineAnnotations };
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
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (document.getElementById('mini-toolbar').classList.contains('visible')) return;
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

// Update notification toast
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
  } catch (_) {}
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

      // Chat: create session
      if (url.pathname === '/api/chat/session') {
        var model = payload.model || 'claude-sonnet-4-6';
        var sid = createChatSession(model);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId: sid }));
        return;
      }

      // Chat: abort
      if (url.pathname === '/api/chat/abort') {
        var session = chatSessions.get(payload.sessionId);
        if (session && session.proc) {
          try { session.proc.kill(); } catch (_) {}
          session.proc = null;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Chat: query (SSE streaming)
      if (url.pathname === '/api/chat/query') {
        var chatSession = chatSessions.get(payload.sessionId);
        if (!chatSession) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'session not found' }));
          return;
        }

        var currentFile = payload.currentFile || '';
        var userPrompt = payload.prompt || '';
        var reviewData = readFindings();

        var fullPrompt;
        if (chatSession.firstQuery) {
          chatSession.firstQuery = false;
          var systemPrompt = buildChatSystemPrompt(reviewData, currentFile);
          fullPrompt = systemPrompt + '\n\n---\n\nUser question:\n' + userPrompt;
        } else {
          fullPrompt = userPrompt;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        var proc = spawn('claude', [
          '--output-format', 'stream-json',
          '--model', chatSession.model,
          '--print',
          '-p', fullPrompt
        ], { cwd: process.cwd() });

        chatSession.proc = proc;

        var lineBuffer = '';
        proc.stdout.on('data', function(chunk) {
          lineBuffer += chunk.toString();
          var lines = lineBuffer.split('\n');
          lineBuffer = lines.pop();
          lines.forEach(function(line) {
            if (!line.trim()) return;
            try {
              var obj = JSON.parse(line);
              // Handle stream-json format: look for assistant message content
              if (obj.type === 'assistant' && obj.message && obj.message.content) {
                obj.message.content.forEach(function(block) {
                  if (block.type === 'text') {
                    res.write('data: ' + JSON.stringify({ type: 'text_delta', delta: block.text }) + '\n\n');
                  }
                });
              } else if (obj.type === 'content_block_delta' && obj.delta && obj.delta.type === 'text_delta') {
                res.write('data: ' + JSON.stringify({ type: 'text_delta', delta: obj.delta.text }) + '\n\n');
              }
            } catch (_) {
              // Plain text line — emit directly
              if (line.trim()) {
                res.write('data: ' + JSON.stringify({ type: 'text_delta', delta: line + '\n' }) + '\n\n');
              }
            }
          });
        });

        proc.stderr.on('data', function(chunk) {
          var errText = chunk.toString();
          console.error('claude stderr:', errText);
        });

        proc.on('close', function(code) {
          chatSession.proc = null;
          if (lineBuffer.trim()) {
            try {
              var obj = JSON.parse(lineBuffer);
              if (obj.type === 'assistant' && obj.message && obj.message.content) {
                obj.message.content.forEach(function(block) {
                  if (block.type === 'text') {
                    res.write('data: ' + JSON.stringify({ type: 'text_delta', delta: block.text }) + '\n\n');
                  }
                });
              }
            } catch (_) {
              if (lineBuffer.trim()) {
                res.write('data: ' + JSON.stringify({ type: 'text_delta', delta: lineBuffer }) + '\n\n');
              }
            }
          }
          res.write('data: [DONE]\n\n');
          res.end();
        });

        proc.on('error', function(err) {
          res.write('data: ' + JSON.stringify({ type: 'error', message: err.message }) + '\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        });

        req.on('close', function() {
          if (chatSession.proc) {
            try { chatSession.proc.kill(); } catch (_) {}
            chatSession.proc = null;
          }
        });
        return;
      }

      if (url.pathname === '/api/implement') {
        try {
          fs.writeFileSync(decisionFile, JSON.stringify(Object.assign({ action: 'implement' }, payload)), 'utf8');
          try {
            var rd = readFindings();
            rd._decision = payload;
            saveMarkdown(rd, payload.lineAnnotations);
          } catch (_) {}
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
          var rd2 = readFindings();
          rd2._decision = payload;
          var savedPath = saveMarkdown(rd2, payload.lineAnnotations);
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
