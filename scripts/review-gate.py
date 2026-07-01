#!/usr/bin/env python3
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TextIO

try:
    from orchestrator import AGENTS as EXPECTED_AGENTS
    from orchestrator import EXCLUDES
    from orchestrator import load_acrignore_excludes
except Exception:
    EXPECTED_AGENTS = [
        "semantic-analyzer",
        "security-scanner",
        "architecture-reviewer",
        "test-coverage-analyzer",
        "senior-dev-reviewer",
    ]
    EXCLUDES = [
        ":(exclude)*.lock", ":(exclude)*.lockb", ":(exclude)package-lock.json", ":(exclude)yarn.lock", ":(exclude)pnpm-lock.yaml",
        ":(exclude)Cargo.lock", ":(exclude)poetry.lock", ":(exclude)Pipfile.lock", ":(exclude)composer.lock", ":(exclude)Gemfile.lock",
        ":(exclude)*.min.js", ":(exclude)*.min.css", ":(exclude)*.map",
        ":(exclude)*.png", ":(exclude)*.jpg", ":(exclude)*.jpeg", ":(exclude)*.gif", ":(exclude)*.svg", ":(exclude)*.webp", ":(exclude)*.ico",
        ":(exclude)*.pdf", ":(exclude)*.zip", ":(exclude)*.tar", ":(exclude)*.gz",
        ":(exclude)dist/", ":(exclude)build/", ":(exclude)node_modules/", ":(exclude).next/", ":(exclude).nuxt/", ":(exclude)target/", ":(exclude)__pycache__/",
    ]

    def load_acrignore_excludes(repo: "Path") -> list:  # type: ignore[misc]
        return []

ACTIONABLE_ACTIONS = {
    "accept_fix",
    "ask_claude_to_implement",
    "ask_claude_to_explain",
    "create_follow_up_task",
}
ACTION_LABELS = {
    "ask_claude_to_implement": "ask host agent to implement",
    "accept_fix": "accept fix",
    "ask_claude_to_explain": "ask host agent to explain",
    "create_follow_up_task": "create follow-up task",
    "ignore": "ignore",
}
UI_READY_STATUSES = {"awaiting_decisions", "synthesis_failed", "decisions_saved", "decisions_ready", "no_changes", "diff_too_small", "no_findings"}
NOTHING_TO_DECIDE_STATUSES = {"no_changes", "diff_too_small", "no_findings"}
FINAL_ROUTE_ACTIONS = {"implement", "done"}
DEFAULT_GATE_STATUS_INTERVAL_SECONDS = 10.0
DEFAULT_GATE_MAX_SECONDS = 180.0
HOOK_REVIEW_TIMEOUT_SECONDS = "120"
HOOK_SYNTHESIS_TIMEOUT_SECONDS = "45"
POST_RESUME_MARKER_PREFIX = "claude-code-review-post-resume-"
PROMPT_MARKER_PREFIX = "claude-code-review-prompt-"
CONFIRMATION_MARKER_PREFIX = "claude-code-review-confirm-"
CONFIRMATION_RESPONSE_MARKER_PREFIX = "claude-code-review-confirm-response-"
CONFIRMATION_MARKER_TTL_SECONDS = 86400
POST_RESUME_SKIP_FILE = "review-gate-post-resume-skip.json"
STALE_REVIEW_FILE = "review-gate-stale.json"
PROJECT_CONFIG_FILE = ".acr.json"
DISABLE_STOP_HOOK_KEY = "disableStopHook"
STOP_HOOK_MODE_KEY = "stopHookMode"
DEFAULT_STOP_HOOK_MODE = "prompt"
STOP_HOOK_MODES = {"prompt", "auto", "disabled"}
SETTINGS_FILENAME = "settings.json"


class GateError(RuntimeError):
    pass


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def parse_json_object(text: str) -> dict[str, Any] | None:
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def read_committed_project_config(repo: Path) -> dict[str, Any] | None:
    try:
        result = run_capture(
            ["git", "show", f"HEAD:{PROJECT_CONFIG_FILE}"],
            repo,
            check=False,
            timeout=10,
        )
        if result.returncode == 0:
            parsed = parse_json_object(result.stdout)
            if parsed is not None:
                return parsed
    except Exception:
        pass

    # Fall back to working-tree file so a new/gitignored .acr.json takes effect
    # without requiring a commit first.
    try:
        return parse_json_object((repo / PROJECT_CONFIG_FILE).read_text(encoding="utf-8"))
    except Exception:
        return None


def project_config_disables_stop_hook(repo: Path) -> bool:
    config = read_committed_project_config(repo)
    return config is not None and config.get(DISABLE_STOP_HOOK_KEY) is True


def normalize_stop_hook_mode(value: Any) -> str | None:
    return value if isinstance(value, str) and value in STOP_HOOK_MODES else None


def project_config_stop_hook_mode(config: dict[str, Any] | None) -> str | None:
    if not config:
        return None
    return normalize_stop_hook_mode(config.get(STOP_HOOK_MODE_KEY))


def resolve_settings_paths(plugin_root: Path) -> list[Path]:
    if os.environ.get("ACR_SETTINGS_FILE"):
        return [Path(os.environ["ACR_SETTINGS_FILE"]).expanduser()]
    if os.environ.get("ACR_SETTINGS_DIR"):
        return [Path(os.environ["ACR_SETTINGS_DIR"]).expanduser() / SETTINGS_FILENAME]

    home = Path(os.environ.get("HOME") or os.environ.get("USERPROFILE") or "/tmp").expanduser()
    candidates = [
        home / ".claude" / "agentic-code-reviewer" / SETTINGS_FILENAME,
        plugin_root / SETTINGS_FILENAME,
    ]
    unique: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = str(path)
        if key not in seen:
            unique.append(path)
            seen.add(key)
    return unique


def read_global_stop_hook_mode(plugin_root: Path) -> str | None:
    for path in resolve_settings_paths(plugin_root):
        data = read_json(path)
        mode = normalize_stop_hook_mode(data.get(STOP_HOOK_MODE_KEY)) if data else None
        if mode:
            return mode
    return None


def resolve_stop_hook_mode(plugin_root: Path, project_config: dict[str, Any] | None) -> str:
    env_mode = normalize_stop_hook_mode(os.environ.get("ACR_STOP_HOOK_MODE"))
    if env_mode:
        return env_mode
    global_mode = read_global_stop_hook_mode(plugin_root)
    if global_mode:
        return global_mode
    project_mode = project_config_stop_hook_mode(project_config)
    if project_mode:
        return project_mode
    return DEFAULT_STOP_HOOK_MODE


SKIP_COUNTS_FILENAME = "skip-counts.json"
SKIP_TIP_THRESHOLD = 3


def skip_counts_path(plugin_root: Path) -> Path:
    settings_paths = resolve_settings_paths(plugin_root)
    return settings_paths[0].parent / SKIP_COUNTS_FILENAME


def read_skip_count(plugin_root: Path, repo: Path) -> int:
    data = read_json(skip_counts_path(plugin_root)) or {}
    value = data.get(str(repo))
    return value if isinstance(value, int) and value > 0 else 0


def update_skip_count(plugin_root: Path, repo: Path, *, skipped: bool) -> int:
    """Increment (on no/skip) or reset (on yes) the per-repo consecutive skip counter."""
    path = skip_counts_path(plugin_root)
    data = read_json(path) or {}
    if not isinstance(data, dict):
        data = {}
    count = 0 if not skipped else read_skip_count(plugin_root, repo) + 1
    data[str(repo)] = count
    try:
        write_json(path, data)
    except Exception:
        pass  # the counter is a UX hint only; never fail the gate over it
    return count


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()


def cleanup_stale_sentinels(tmp_dir: Path = Path("/tmp")) -> None:
    cutoff = time.time() - 86400
    for pattern in (
        "claude-code-review-*.blocked",
        "claude-code-review-*.done",
        f"{PROMPT_MARKER_PREFIX}*.json",
        f"{CONFIRMATION_MARKER_PREFIX}*.json",
        f"{CONFIRMATION_RESPONSE_MARKER_PREFIX}*.json",
    ):
        for path in tmp_dir.glob(pattern):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except Exception:
                pass


def run_capture(args: list[str], cwd: Path, env: dict[str, str] | None = None, check: bool = True, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd),
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
        timeout=timeout,
    )


def git_root(cwd: Path) -> Path | None:
    try:
        result = run_capture(["git", "rev-parse", "--show-toplevel"], cwd, check=True, timeout=10)
        root = result.stdout.strip()
        return Path(root).resolve() if root else None
    except Exception:
        return None


def current_review_diff(repo: Path) -> str:
    extra_excludes = load_acrignore_excludes(repo)
    head_cmd = ["git", "diff", "--text", "HEAD", "--", ".", *EXCLUDES, *extra_excludes]
    diff = run_capture(head_cmd, repo, check=False, timeout=60).stdout
    if diff.strip():
        return diff
    return run_capture(["git", "diff", "--text", "--", ".", *EXCLUDES, *extra_excludes], repo, check=False, timeout=60).stdout


def diff_sha256(diff: str) -> str:
    return hashlib.sha256(diff.encode("utf-8")).hexdigest()


def canonical_json_sha256(value: dict[str, Any]) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def repo_marker_key(repo: Path) -> str:
    return hashlib.sha256(str(repo).encode("utf-8")).hexdigest()


def safe_marker_run_id(run_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", run_id.strip())
    return safe or hashlib.sha256(run_id.encode("utf-8")).hexdigest()


def safe_session_id(session_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", session_id.strip())
    return safe or "unknown"


def post_resume_marker_path(repo: Path, run_id: str, tmp_dir: Path = Path("/tmp")) -> Path:
    return tmp_dir / f"{POST_RESUME_MARKER_PREFIX}{repo_marker_key(repo)}-{safe_marker_run_id(run_id)}.json"


def confirmation_marker_path(repo: Path, session_id: str, tmp_dir: Path = Path("/tmp")) -> Path:
    return tmp_dir / f"{CONFIRMATION_MARKER_PREFIX}{repo_marker_key(repo)}-{safe_session_id(session_id)}.json"


def write_confirmation_marker(repo: Path, session_id: str, current_diff_sha: str, current_diff: str, tmp_dir: Path = Path("/tmp")) -> Path:
    created_at = time.time()
    marker_path = confirmation_marker_path(repo, session_id, tmp_dir)
    write_json(marker_path, {
        "schema_version": 1,
        "repo": str(repo),
        "session_id": session_id,
        "diff_sha256": current_diff_sha,
        "diff_paths": diff_file_paths(current_diff),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(created_at)),
        "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(created_at + CONFIRMATION_MARKER_TTL_SECONDS)),
    })
    return marker_path


def load_confirmation_marker(repo: Path, session_id: str, tmp_dir: Path = Path("/tmp")) -> tuple[Path, dict[str, Any]] | None:
    marker_path = confirmation_marker_path(repo, session_id, tmp_dir)
    marker = read_json(marker_path)
    if not marker:
        return None
    if marker.get("repo") != str(repo) or marker.get("session_id") != session_id:
        unlink_quietly(marker_path)
        return None
    expires_at = parse_utc_timestamp(marker.get("expires_at"))
    if expires_at is not None and expires_at <= time.time():
        unlink_quietly(marker_path)
        return None
    return marker_path, marker


def confirmation_marker_matches_diff(repo: Path, session_id: str, current_diff_sha: str) -> bool:
    marker_entry = load_confirmation_marker(repo, session_id)
    if not marker_entry:
        return False
    marker_path, marker = marker_entry
    if marker.get("diff_sha256") == current_diff_sha:
        return True
    unlink_quietly(marker_path)
    return False


def confirmation_response_marker_path(
    repo: Path,
    session_id: str,
    current_diff_sha: str,
    response_key: str,
    tmp_dir: Path = Path("/tmp"),
) -> Path:
    response_sha = hashlib.sha256(response_key.encode("utf-8")).hexdigest()
    return tmp_dir / (
        f"{CONFIRMATION_RESPONSE_MARKER_PREFIX}"
        f"{repo_marker_key(repo)}-{safe_session_id(session_id)}-"
        f"{current_diff_sha[:16]}-{response_sha}.json"
    )


def claim_confirmation_response(repo: Path, session_id: str, current_diff_sha: str, response_key: str) -> bool:
    marker_path = confirmation_response_marker_path(repo, session_id, current_diff_sha, response_key)
    try:
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        with marker_path.open("x", encoding="utf-8") as handle:
            json.dump({
                "schema_version": 1,
                "repo": str(repo),
                "session_id": session_id,
                "diff_sha256": current_diff_sha,
                "response_key_sha256": hashlib.sha256(response_key.encode("utf-8")).hexdigest(),
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }, handle, indent=2, sort_keys=True)
            handle.write("\n")
        return True
    except FileExistsError:
        return False
    except Exception as exc:
        # Failing to persist the claim marker must not look like a successful
        # claim: processing the response anyway could double-consume a yes/no.
        print(f"review-gate: could not write confirmation-response marker: {exc}", file=sys.stderr)
        return False


def post_resume_marker_paths(repo: Path, tmp_dir: Path = Path("/tmp")) -> list[Path]:
    pattern = f"{POST_RESUME_MARKER_PREFIX}{repo_marker_key(repo)}-*.json"
    paths = list(tmp_dir.glob(pattern))

    def marker_sort_key(path: Path) -> tuple[float, str]:
        try:
            mtime = path.stat().st_mtime
        except Exception:
            mtime = 0
        return (mtime, path.name)

    return sorted(paths, key=marker_sort_key, reverse=True)


def parse_utc_timestamp(value: Any) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def unlink_quietly(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except Exception:
        pass


def diff_token_path(token: str) -> str | None:
    if token == "/dev/null":
        return None
    if token.startswith("a/") or token.startswith("b/"):
        return token[2:]
    return None


def diff_file_paths(diff: str) -> list[str]:
    paths: set[str] = set()
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            try:
                parts = shlex.split(line)
            except ValueError:
                parts = line.split()
            for token in parts[2:4]:
                path = diff_token_path(token)
                if path:
                    paths.add(path)
            continue
        if line.startswith("--- ") or line.startswith("+++ "):
            token = line[4:].split("\t", 1)[0].strip()
            path = diff_token_path(token)
            if path:
                paths.add(path)
    return sorted(paths)


def marker_original_paths(marker: dict[str, Any]) -> set[str]:
    paths = marker.get("original_diff_paths")
    if not isinstance(paths, list):
        return set()
    return {str(path) for path in paths if isinstance(path, str) and path.strip()}


def marker_allows_current_diff(marker: dict[str, Any], current_diff_sha: str, current_diff: str) -> bool:
    original_diff_sha = marker.get("original_diff_sha256")
    if current_diff_sha == original_diff_sha:
        return True
    if marker.get("suppression_mode") != "implementation":
        return False
    original_paths = marker_original_paths(marker)
    current_paths = set(diff_file_paths(current_diff))
    return bool(original_paths and current_paths and current_paths.issubset(original_paths))


def consume_post_resume_marker_path(
    marker_path: Path,
    repo: Path,
    current_diff_sha: str,
    current_diff: str,
    session_id: str,
    now: float | None = None,
) -> Path | None:
    marker = read_json(marker_path)
    if not marker:
        return None

    def reject() -> None:
        unlink_quietly(marker_path)

    if marker.get("repo") != str(repo):
        reject()
        return None

    run_id = marker.get("run_id")
    original_diff_sha = marker.get("original_diff_sha256")
    decisions_sha = marker.get("decisions_sha256")
    if not isinstance(run_id, str) or not run_id.strip():
        reject()
        return None
    if not isinstance(original_diff_sha, str) or not original_diff_sha.strip():
        reject()
        return None
    if not isinstance(decisions_sha, str) or not decisions_sha.strip():
        reject()
        return None

    expires_at = parse_utc_timestamp(marker.get("expires_at"))
    if expires_at is None or expires_at <= (time.time() if now is None else now):
        reject()
        return None

    run_dir = repo / ".claude" / "review-runs" / run_id.strip()
    run = read_json(run_json_path(run_dir))
    if not run or run.get("diff_sha256") != original_diff_sha:
        reject()
        return None

    decisions = load_decisions(run_dir)
    if not decisions or canonical_json_sha256(decisions) != decisions_sha:
        reject()
        return None

    if marker.get("suppression_mode") not in {"implementation", "same_diff"}:
        reject()
        return None
    if not marker_allows_current_diff(marker, current_diff_sha, current_diff):
        reject()
        return None

    write_json(run_dir / POST_RESUME_SKIP_FILE, {
        "session_id": session_id,
        "outcome": "allow",
        "reason": "post_resume_marker",
        "run_id": run_dir.name,
        "original_diff_sha256": original_diff_sha,
        "original_diff_paths": sorted(marker_original_paths(marker)),
        "current_diff_sha256": current_diff_sha,
        "current_diff_paths": diff_file_paths(current_diff),
        "decisions_sha256": decisions_sha,
        "suppression_mode": marker.get("suppression_mode"),
        "handled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "marker_created_at": marker.get("created_at"),
        "marker_expires_at": marker.get("expires_at"),
    })
    unlink_quietly(marker_path)
    return run_dir


def consume_post_resume_marker(
    repo: Path,
    current_diff_sha: str,
    current_diff: str,
    session_id: str,
    tmp_dir: Path = Path("/tmp"),
    now: float | None = None,
) -> Path | None:
    for marker_path in post_resume_marker_paths(repo, tmp_dir):
        run_dir = consume_post_resume_marker_path(
            marker_path,
            repo,
            current_diff_sha,
            current_diff,
            session_id,
            now,
        )
        if run_dir:
            return run_dir
    return None


def run_json_path(run_dir: Path) -> Path:
    return run_dir / "run.json"


def decision_file(run_id: str) -> Path:
    return Path(f"/tmp/claude-code-review-{run_id}.decision")


def done_file(session_id: str) -> Path:
    return Path(f"/tmp/claude-code-review-{session_id}.done")


def session_done_matches(path: Path, repo: Path, current_diff_sha: str) -> bool:
    data = read_json(path)
    if not data:
        return False
    return data.get("repo") == str(repo) and data.get("diff_sha256") == current_diff_sha


def mark_session_done(path: Path, repo: Path, session_id: str, current_diff_sha: str, reason: str) -> None:
    write_json(path, {
        "repo": str(repo),
        "session_id": session_id,
        "diff_sha256": current_diff_sha,
        "reason": reason,
        "handled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def load_route_action(run_id: str) -> str | None:
    data = read_json(decision_file(run_id))
    action = data.get("action") if data else None
    return str(action) if action else None


def load_decisions(run_dir: Path) -> dict[str, Any] | None:
    return read_json(run_dir / "decisions.json")


def action_label(action: str) -> str:
    return ACTION_LABELS.get(action, action)


def agent_names_for_run(run: dict[str, Any]) -> list[str]:
    agents = run.get("agents")
    if isinstance(agents, list):
        names = [str(agent) for agent in agents if isinstance(agent, str) and agent.strip()]
        if names:
            return names
    return list(EXPECTED_AGENTS)


def gate_status_summary(run_dir: Path, waiting_for_ui_decision: bool = False) -> dict[str, Any]:
    run = read_json(run_json_path(run_dir)) or {}
    agents = agent_names_for_run(run)
    active: list[str] = []
    completed = 0
    failed = 0
    raw_findings = 0

    for agent in agents:
        data = read_json(run_dir / "agents" / f"{agent}.json")
        status = str(data.get("status") or "") if data else ""
        findings = data.get("findings") if data else None
        if isinstance(findings, list):
            raw_findings += len(findings)
        if status == "complete":
            completed += 1
        elif status == "failed":
            failed += 1
        elif str(run.get("status") or "") == "reviewers_running":
            active.append(agent)

    return {
        "run_id": str(run.get("run_id") or run_dir.name),
        "phase": str(run.get("status") or "starting"),
        "active_reviewers": active,
        "completed": completed,
        "failed": failed,
        "raw_findings": raw_findings,
        "waiting_for_ui_decision": waiting_for_ui_decision,
    }


def format_gate_status(summary: dict[str, Any]) -> str:
    active = summary.get("active_reviewers")
    if isinstance(active, list) and active:
        active_value = ",".join(str(agent) for agent in active)
    else:
        active_value = "none"
    waiting = "yes" if summary.get("waiting_for_ui_decision") else "no"
    return (
        "agentic-code-reviewer: "
        f"run={summary.get('run_id')} "
        f"phase={summary.get('phase')} "
        f"active_reviewers={active_value} "
        f"completed={summary.get('completed')} "
        f"failed={summary.get('failed')} "
        f"raw_findings={summary.get('raw_findings')} "
        f"waiting_for_ui_decision={waiting}"
    )


class GateHeartbeat:
    def __init__(
        self,
        interval_seconds: float,
        stream: TextIO | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.interval_seconds = interval_seconds
        self.stream = stream if stream is not None else sys.stderr
        self.clock = clock
        self.last_emit = 0.0

    def maybe_emit(
        self,
        run_dir: Path,
        waiting_for_ui_decision: bool = False,
        force: bool = False,
    ) -> None:
        if self.interval_seconds <= 0:
            return
        now = float(self.clock())
        if not force and self.last_emit and now - self.last_emit < self.interval_seconds:
            return
        self.last_emit = now
        print(format_gate_status(gate_status_summary(run_dir, waiting_for_ui_decision)), file=self.stream, flush=True)


def has_actionable_decisions(decisions: dict[str, Any] | None) -> bool:
    if not decisions:
        return False
    findings = decisions.get("findings")
    if not isinstance(findings, dict):
        return False
    for decision in findings.values():
        if isinstance(decision, dict) and decision.get("action") in ACTIONABLE_ACTIONS:
            return True
    return False


def classify_final_decision(decisions: dict[str, Any] | None) -> str:
    return "block" if has_actionable_decisions(decisions) else "allow"


def newest_matching_run(repo: Path, expected_diff_sha: str) -> Path | None:
    runs_root = repo / ".claude" / "review-runs"
    if not runs_root.exists():
        return None
    candidates: list[tuple[float, Path]] = []
    for path in runs_root.glob("*/run.json"):
        data = read_json(path)
        if not data:
            continue
        if data.get("repo") != str(repo):
            continue
        if data.get("diff_sha256") != expected_diff_sha:
            continue
        try:
            mtime = path.stat().st_mtime
        except Exception:
            mtime = 0
        candidates.append((mtime, path.parent))
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item[0], item[1].name))[1]


def parse_run_id(output: str) -> str | None:
    match = re.search(r"^Review\s+(\S+)\s+started\.", output, re.MULTILINE)
    return match.group(1) if match else None


def launch_review(plugin_root: Path, repo: Path, fast_hook: bool = False, disable_auto_resume: bool = True) -> Path:
    env = os.environ.copy()
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["ACR_STATUS_POLL"] = "0"
    if disable_auto_resume:
        env["ACR_DISABLE_AUTO_RESUME"] = "1"
    if fast_hook:
        env["ACR_HOOK_FAST"] = "1"
        env.setdefault("ACR_REVIEW_TIMEOUT_SECONDS", HOOK_REVIEW_TIMEOUT_SECONDS)
        env.setdefault("ACR_SYNTHESIS_TIMEOUT_SECONDS", HOOK_SYNTHESIS_TIMEOUT_SECONDS)
        env.setdefault("ACR_REVIEWER_MAX_RETRIES", "0")
    cmd = ["bash", str(plugin_root / "scripts" / "orchestrator.sh"), "--repo", str(repo)]
    try:
        result = run_capture(cmd, repo, env=env, check=True, timeout=60)
    except subprocess.CalledProcessError as exc:
        output = "\n".join(part for part in [exc.stdout, exc.stderr] if part)
        raise GateError(f"Failed to launch agentic review:\n{output.strip()}")
    run_id = parse_run_id(result.stdout)
    if not run_id:
        raise GateError(f"Could not parse review run id from orchestrator output:\n{result.stdout.strip()}")
    return repo / ".claude" / "review-runs" / run_id


def wait_for_ui_or_terminal(
    run_dir: Path,
    deadline: float,
    poll_interval: float,
    heartbeat: GateHeartbeat | None = None,
) -> dict[str, Any]:
    last_run: dict[str, Any] = {}
    while time.time() < deadline:
        run = read_json(run_json_path(run_dir)) or {}
        if run:
            last_run = run
        if heartbeat:
            heartbeat.maybe_emit(run_dir)
        status = str(run.get("status") or "")
        if status in UI_READY_STATUSES:
            return run
        if (run_dir / "READY").exists():
            return read_json(run_json_path(run_dir)) or run
        time.sleep(poll_interval)
    raise GateError(f"Timed out waiting for review UI: {run_dir}")


def wait_for_final_decision(
    run_dir: Path,
    deadline: float,
    poll_interval: float,
    heartbeat: GateHeartbeat | None = None,
) -> tuple[str, dict[str, Any] | None]:
    run_id = run_dir.name
    while time.time() < deadline:
        run = read_json(run_json_path(run_dir)) or {}
        if heartbeat:
            heartbeat.maybe_emit(run_dir, waiting_for_ui_decision=True)
        status = str(run.get("status") or "")
        if status in NOTHING_TO_DECIDE_STATUSES:
            return "allow", None

        decisions = load_decisions(run_dir)
        route_action = load_route_action(run_id)
        if decisions and route_action in FINAL_ROUTE_ACTIONS:
            return classify_final_decision(decisions), decisions
        if decisions and route_action not in {None, "save"}:
            return classify_final_decision(decisions), decisions
        if decisions and not route_action and status == "decisions_ready":
            return classify_final_decision(decisions), decisions

        time.sleep(poll_interval)
    raise GateError(f"Timed out waiting for review UI action: {run_dir}")


def emit_block(repo: Path, run_dir: Path, plugin_root: Path, decisions: dict[str, Any] | None) -> None:
    resume_script = plugin_root / "scripts" / "review-resume.sh"
    run_id = run_dir.name
    resume_cmd = f"bash {shlex.quote(str(resume_script))} --repo {shlex.quote(str(repo))} --run-id {shlex.quote(run_id)}"
    artifact_path = run_dir / "resume-artifact.json"
    action_count = 0
    if decisions and isinstance(decisions.get("findings"), dict):
        action_count = sum(
            1
            for decision in decisions["findings"].values()
            if isinstance(decision, dict) and decision.get("action") in ACTIONABLE_ACTIONS
        )
    reason = "\n".join([
        f"ACR review complete: {action_count} review decision(s) require host-agent follow-up.",
        "",
        "Run this exact command now:",
        resume_cmd,
        "",
        f"Script: {resume_script}",
        f"Repo: {repo}",
        f"Run ID: {run_id}",
        "",
        f"Implement only findings marked `{action_label('ask_claude_to_implement')}` or `{action_label('accept_fix')}`.",
        f"For findings marked `{action_label('ask_claude_to_explain')}`, explain the requested issue or decision to the user.",
        f"For findings marked `{action_label('create_follow_up_task')}`, report the follow-up task details instead of implementing code.",
        "Report completion after the requested implementation, explanation, or follow-up work is done.",
    ])
    system_message = "\n".join([
        "IMPORTANT: Agentic Code Reviewer final decisions require host-agent follow-up.",
        f"{action_count} review decision(s) require follow-up.",
        f"Script: {resume_script}",
        f"Repo: {repo}",
        f"Run ID: {run_id}",
        "",
        "Run this exact command now:",
        resume_cmd,
        f"Alternatively, read the structured artifact at `{artifact_path}` for machine-parseable decisions (if it exists).",
        "",
        f"Implement only findings marked `{action_label('ask_claude_to_implement')}` or `{action_label('accept_fix')}`.",
        "Do not implement ignored/dismissed findings.",
        f"Handle `{action_label('ask_claude_to_explain')}` and `{action_label('create_follow_up_task')}` exactly as the resume instructions specify.",
    ])
    print(json.dumps({
        "decision": "block",
        "reason": reason,
        "resume_artifact_path": str(artifact_path),
        "systemMessage": system_message,
    }))


def emit_stop_reason(message: str) -> None:
    print(json.dumps({
        "continue": False,
        "stopReason": message,
    }))


def emit_prompt(repo: Path, plugin_root: Path, session_id: str, current_diff_sha: str, current_diff: str) -> None:
    write_confirmation_marker(repo, session_id, current_diff_sha, current_diff)
    paths = diff_file_paths(current_diff)
    path_lines = [f"- {path}" for path in paths[:8]]
    if len(paths) > 8:
        path_lines.append(f"- and {len(paths) - 8} more")
    lines = [
        "Agentic Code Reviewer is waiting for your confirmation.",
        "",
        "Reviewable code changes were detected.",
        *(["", "Changed paths:", *path_lines] if path_lines else []),
        "",
        "Reply yes/y to run the review, or no/n/skip to skip this diff.",
    ]
    skip_count = read_skip_count(plugin_root, repo)
    if skip_count >= SKIP_TIP_THRESHOLD:
        lines.extend([
            "",
            f"Tip: you've skipped the last {skip_count} review prompts here. "
            "Run /acr-config to pause the review gate for this repo while you work.",
        ])
    emit_stop_reason("\n".join(lines))


def emit_launch_failure(repo: Path | None, plugin_root: Path, message: str) -> None:
    script = plugin_root / "scripts" / "orchestrator.sh"
    resume_script = plugin_root / "scripts" / "review-resume.sh"
    repo_part = f" --repo {shlex.quote(str(repo))}" if repo else ""
    cmd = f"bash {shlex.quote(str(script))}{repo_part}"
    resume_repo_part = f" --repo {shlex.quote(str(repo))}" if repo else " --repo REPO_PATH"
    resume_cmd = f"bash {shlex.quote(str(resume_script))}{resume_repo_part} --run-id RUN_ID_FROM_REVIEW_OUTPUT"
    details = [f"Script: {script}", f"Resume Script: {resume_script}"]
    if repo:
        details.append(f"Repo: {repo}")
    reason = "\n".join([
        "ACR error: stop hook could not start or complete the review.",
        "",
        "Run this exact command to start the review UI:",
        cmd,
        "",
        *details,
        "",
        "After the user completes final UI decisions, continue from the saved review decisions.",
        "Use the `Review <run-id> started.` value from the launcher output as RUN_ID_FROM_REVIEW_OUTPUT.",
        "If decisions require follow-up, run this command and follow its output:",
        resume_cmd,
        f"Implement only findings marked `{action_label('ask_claude_to_implement')}` or `{action_label('accept_fix')}`.",
        "Do not implement ignored/dismissed findings.",
        f"Handle `{action_label('ask_claude_to_explain')}` and `{action_label('create_follow_up_task')}` exactly as the resume instructions specify.",
        "",
        "Failure detail:",
        message,
    ])
    print(json.dumps({
        "decision": "block",
        "reason": reason,
        "systemMessage": "\n".join([
            "IMPORTANT: Code was modified, but the Agentic Code Reviewer Stop hook could not start the review UI automatically.",
            *details,
            "",
            "Details:",
            message,
        ]),
    }))


def mark_stale_review(run_dir: Path, session_id: str, original_diff_sha: str, latest_diff_sha: str, latest_diff: str) -> None:
    write_json(run_dir / STALE_REVIEW_FILE, {
        "session_id": session_id,
        "outcome": "allow",
        "reason": "diff_changed_during_review",
        "original_diff_sha256": original_diff_sha,
        "latest_diff_sha256": latest_diff_sha,
        "latest_diff_paths": diff_file_paths(latest_diff),
        "handled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def parse_hook_event(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def hook_payload(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload")
    return payload if isinstance(payload, dict) else {}


def hook_event_name(event: dict[str, Any]) -> str:
    for container in (event, hook_payload(event)):
        for key in ("hook_event_name", "hookEventName", "event", "event_name", "eventName"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def hook_session_id(event: dict[str, Any]) -> str:
    for container in (event, hook_payload(event)):
        value = container.get("session_id") or container.get("sessionId")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "unknown"


def hook_cwd(event: dict[str, Any], fallback: Path) -> Path:
    for container in (event, hook_payload(event)):
        cwd = container.get("cwd")
        if isinstance(cwd, str) and cwd.strip():
            return Path(cwd).expanduser().resolve()
    return fallback.resolve()


def hook_user_prompt(event: dict[str, Any]) -> str | None:
    for container in (event, hook_payload(event)):
        for key in ("prompt", "user_prompt", "userPrompt", "message", "text", "input"):
            value = container.get(key)
            if isinstance(value, str):
                return value
    return None


def is_user_prompt_submit_event(event: dict[str, Any]) -> bool:
    name = re.sub(r"[^a-z]+", "", hook_event_name(event).lower())
    return name == "userpromptsubmit" or (not name and hook_user_prompt(event) is not None)


def classify_confirmation_response(prompt: str | None) -> str | None:
    if prompt is None:
        return None
    normalized = prompt.strip().lower()
    normalized = normalized.strip("\"'` \t\r\n")
    match = re.match(r"^(yes|y|no|n|skip)(?:\b|[^a-z0-9_]|$)", normalized)
    if not match:
        return None
    value = match.group(1)
    return "yes" if value in {"yes", "y"} else "no"


def is_plan_value(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() == "plan"


def collaboration_mode_is_plan(container: dict[str, Any]) -> bool:
    if is_plan_value(container.get("collaboration_mode_kind")):
        return True
    mode = container.get("collaboration_mode")
    if is_plan_value(mode):
        return True
    if isinstance(mode, dict):
        return is_plan_value(mode.get("mode")) or is_plan_value(mode.get("kind"))
    return False


def direct_hook_plan_mode(event: dict[str, Any]) -> bool:
    if collaboration_mode_is_plan(event):
        return True
    payload = event.get("payload")
    if isinstance(payload, dict) and collaboration_mode_is_plan(payload):
        return True
    for key in ("task_started", "turn_context"):
        value = event.get(key)
        if not isinstance(value, dict):
            continue
        if collaboration_mode_is_plan(value):
            return True
        payload = value.get("payload")
        if isinstance(payload, dict) and collaboration_mode_is_plan(payload):
            return True
    return False


def hook_turn_id(event: dict[str, Any]) -> str | None:
    for container in (event, event.get("payload")):
        if not isinstance(container, dict):
            continue
        for key in ("turn_id", "turnId"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def transcript_record_type(record: dict[str, Any]) -> str:
    payload = record.get("payload")
    if isinstance(payload, dict) and isinstance(payload.get("type"), str):
        return payload["type"]
    value = record.get("type")
    return value if isinstance(value, str) else ""


def transcript_record_payload(record: dict[str, Any]) -> dict[str, Any]:
    payload = record.get("payload")
    return payload if isinstance(payload, dict) else {}


def transcript_record_turn_id(record: dict[str, Any], payload: dict[str, Any]) -> str | None:
    for container in (payload, record):
        for key in ("turn_id", "turnId"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def transcript_has_plan_mode_marker(transcript_path: Path, turn_id: str) -> bool:
    try:
        with transcript_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                if not isinstance(record, dict):
                    continue
                payload = transcript_record_payload(record)
                if transcript_record_turn_id(record, payload) != turn_id:
                    continue
                record_type = transcript_record_type(record)
                if record_type == "task_started" and is_plan_value(payload.get("collaboration_mode_kind")):
                    return True
                if record_type == "turn_context" and collaboration_mode_is_plan(payload):
                    return True
    except Exception:
        return False
    return False


def hook_event_is_plan_mode(event: dict[str, Any]) -> bool:
    if direct_hook_plan_mode(event):
        return True

    transcript_path = event.get("transcript_path") or event.get("transcriptPath")
    if not isinstance(transcript_path, str) or not transcript_path.strip():
        return False

    turn_id = hook_turn_id(event)
    if not turn_id:
        return False

    return transcript_has_plan_mode_marker(Path(transcript_path).expanduser(), turn_id)


def allow_stop() -> int:
    # A Stop hook allows the stop by emitting no `decision`. The schema accepts
    # decision "approve" | "block" only; "allow" fails validation.
    return 0


def handle_user_prompt_submit(raw_input: str, plugin_root: Path, cwd: Path) -> int:
    event = parse_hook_event(raw_input)
    cwd = hook_cwd(event, cwd)
    session_id = hook_session_id(event)
    repo = git_root(cwd)
    if not repo:
        return allow_stop()

    marker_entry = load_confirmation_marker(repo, session_id)
    if not marker_entry:
        return allow_stop()
    marker_path, marker = marker_entry

    project_config = read_committed_project_config(repo)
    if project_config is not None and project_config.get(DISABLE_STOP_HOOK_KEY) is True:
        unlink_quietly(marker_path)
        return allow_stop()

    diff = current_review_diff(repo)
    if not diff.strip():
        unlink_quietly(marker_path)
        emit_stop_reason("Agentic Code Reviewer was not started because there are no current reviewable changes.")
        return 0

    current_hash = diff_sha256(diff)
    if marker.get("diff_sha256") != current_hash:
        unlink_quietly(marker_path)
        emit_stop_reason(
            "The reviewable diff changed since Agentic Code Reviewer asked for confirmation. "
            "Stop again when you are ready to review the latest diff."
        )
        return 0

    user_prompt = hook_user_prompt(event)
    response = classify_confirmation_response(user_prompt)
    if response == "no":
        if not claim_confirmation_response(repo, session_id, current_hash, "no"):
            return allow_stop()
        unlink_quietly(marker_path)
        mark_session_done(done_file(session_id), repo, session_id, current_hash, "prompt_declined")
        skip_count = update_skip_count(plugin_root, repo, skipped=True)
        message = "Agentic Code Reviewer skipped for this diff."
        if skip_count >= SKIP_TIP_THRESHOLD:
            message += (
                f"\n\nTip: that's {skip_count} skips in a row for this repo. "
                "Run /acr-config to pause the review gate while you work."
            )
        emit_stop_reason(message)
        return 0

    if response != "yes":
        prompt_sha = hashlib.sha256((user_prompt or "").encode("utf-8")).hexdigest()
        if not claim_confirmation_response(repo, session_id, current_hash, f"pending:{prompt_sha}"):
            return allow_stop()
        unlink_quietly(marker_path)
        mark_session_done(done_file(session_id), repo, session_id, current_hash, "prompt_ignored")
        return allow_stop()

    if not claim_confirmation_response(repo, session_id, current_hash, "yes"):
        return allow_stop()

    update_skip_count(plugin_root, repo, skipped=False)

    try:
        run_dir = launch_review(plugin_root, repo, fast_hook=False, disable_auto_resume=False)
    except GateError as exc:
        unlink_quietly(marker_path)
        emit_stop_reason(f"Agentic Code Reviewer could not start the review.\n\n{exc}")
        return 0

    unlink_quietly(marker_path)
    emit_stop_reason("\n".join([
        "Agentic Code Reviewer started for the current diff.",
        "",
        f"Run ID: {run_dir.name}",
        f"Status: .claude/review-runs/{run_dir.name}/run.json",
        f"Resume after decisions: /review-resume {run_dir.name}",
    ]))
    return 0


def run_gate(
    raw_input: str,
    plugin_root: Path,
    cwd: Path,
    max_seconds: float,
    poll_interval: float,
    status_interval: float = DEFAULT_GATE_STATUS_INTERVAL_SECONDS,
) -> int:
    if os.environ.get("ACR_REVIEW_SUBPROCESS") == "1":
        return allow_stop()

    event = parse_hook_event(raw_input)
    if is_user_prompt_submit_event(event):
        return handle_user_prompt_submit(raw_input, plugin_root, cwd)

    plan_mode = hook_event_is_plan_mode(event)
    if plan_mode:
        return allow_stop()

    cwd = hook_cwd(event, cwd)
    session_id = hook_session_id(event)

    repo = git_root(cwd)
    if not repo:
        return allow_stop()
    project_config = read_committed_project_config(repo)
    if project_config is not None and project_config.get(DISABLE_STOP_HOOK_KEY) is True:
        return allow_stop()

    diff = current_review_diff(repo)
    if not diff.strip():
        return allow_stop()

    cleanup_stale_sentinels()
    current_hash = diff_sha256(diff)
    session_done = done_file(session_id)
    if session_done_matches(session_done, repo, current_hash):
        return allow_stop()

    if consume_post_resume_marker(repo, current_hash, diff, session_id):
        mark_session_done(session_done, repo, session_id, current_hash, "post_resume_marker")
        return allow_stop()

    stop_hook_mode = resolve_stop_hook_mode(plugin_root, project_config)
    if stop_hook_mode == "disabled":
        return allow_stop()
    if stop_hook_mode == "prompt":
        if confirmation_marker_matches_diff(repo, session_id, current_hash):
            return allow_stop()
        emit_prompt(repo, plugin_root, session_id, current_hash, diff)
        return allow_stop()

    deadline = time.time() + max_seconds

    try:
        run_dir = newest_matching_run(repo, current_hash)
        if run_dir is None:
            run_dir = launch_review(plugin_root, repo, fast_hook=True)
        heartbeat = GateHeartbeat(status_interval)
        heartbeat.maybe_emit(run_dir, force=True)
        wait_for_ui_or_terminal(run_dir, deadline, poll_interval, heartbeat)
        outcome, decisions = wait_for_final_decision(run_dir, deadline, poll_interval, heartbeat)
    except GateError as exc:
        emit_launch_failure(repo, plugin_root, str(exc))
        return 0  # emit_launch_failure already printed a block JSON object

    latest_diff = current_review_diff(repo)
    latest_hash = diff_sha256(latest_diff)
    if latest_hash != current_hash:
        mark_stale_review(run_dir, session_id, current_hash, latest_hash, latest_diff)
        return allow_stop()

    mark_session_done(session_done, repo, session_id, current_hash, "review_gate")
    write_json(run_dir / "review-gate.json", {
        "session_id": session_id,
        "outcome": outcome,
        "stop_hook_mode": stop_hook_mode,
        "plan_mode": plan_mode,
        "diff_sha256": current_hash,
        "handled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    if outcome == "block":
        emit_block(repo, run_dir, plugin_root, decisions)
    else:
        allow_stop()
    return 0


def main() -> int:
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--plugin-root", default=os.environ.get("CLAUDE_PLUGIN_ROOT"))
        parser.add_argument("--cwd", default=os.getcwd())
        parser.add_argument("--max-seconds", type=float, default=float(os.environ.get("ACR_GATE_MAX_SECONDS", str(DEFAULT_GATE_MAX_SECONDS))))
        parser.add_argument("--poll-interval", type=float, default=float(os.environ.get("ACR_GATE_POLL_INTERVAL_SECONDS", "1")))
        parser.add_argument(
            "--status-interval",
            type=float,
            default=float(os.environ.get("ACR_GATE_STATUS_INTERVAL_SECONDS", str(DEFAULT_GATE_STATUS_INTERVAL_SECONDS))),
        )
        args = parser.parse_args()
        plugin_root = Path(args.plugin_root or Path(__file__).resolve().parents[1]).resolve()
        raw_input = sys.stdin.read()
        return run_gate(raw_input, plugin_root, Path(args.cwd).resolve(), args.max_seconds, args.poll_interval, args.status_interval)
    except Exception as e:
        print(f"acr review-gate unexpected error: {e}", file=sys.stderr)
        return allow_stop()


if __name__ == "__main__":
    raise SystemExit(main())
