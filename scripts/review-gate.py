#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

try:
    from orchestrator import EXCLUDES
except Exception:
    EXCLUDES = [
        ":(exclude)*.lock", ":(exclude)*.lockb", ":(exclude)package-lock.json", ":(exclude)yarn.lock", ":(exclude)pnpm-lock.yaml",
        ":(exclude)Cargo.lock", ":(exclude)poetry.lock", ":(exclude)Pipfile.lock", ":(exclude)composer.lock", ":(exclude)Gemfile.lock",
        ":(exclude)*.min.js", ":(exclude)*.min.css", ":(exclude)*.map",
        ":(exclude)*.png", ":(exclude)*.jpg", ":(exclude)*.jpeg", ":(exclude)*.gif", ":(exclude)*.svg", ":(exclude)*.webp", ":(exclude)*.ico",
        ":(exclude)*.pdf", ":(exclude)*.zip", ":(exclude)*.tar", ":(exclude)*.gz",
        ":(exclude)dist/", ":(exclude)build/", ":(exclude)node_modules/", ":(exclude).next/", ":(exclude).nuxt/", ":(exclude)target/", ":(exclude)__pycache__/",
    ]

ACTIONABLE_ACTIONS = {
    "accept_fix",
    "ask_claude_to_implement",
    "ask_claude_to_explain",
    "create_follow_up_task",
}
UI_READY_STATUSES = {"awaiting_decisions", "synthesis_failed", "decisions_saved", "decisions_ready", "no_changes"}
FINAL_ROUTE_ACTIONS = {"implement", "done"}


class GateError(RuntimeError):
    pass


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


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
    for pattern in ("claude-code-review-*.blocked", "claude-code-review-*.done"):
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
    head_cmd = ["git", "diff", "--text", "HEAD", "--", ".", *EXCLUDES]
    diff = run_capture(head_cmd, repo, check=False, timeout=60).stdout
    if diff.strip():
        return diff
    return run_capture(["git", "diff", "--text", "--", ".", *EXCLUDES], repo, check=False, timeout=60).stdout


def diff_sha256(diff: str) -> str:
    return hashlib.sha256(diff.encode("utf-8")).hexdigest()


def run_json_path(run_dir: Path) -> Path:
    return run_dir / "run.json"


def decision_file(run_id: str) -> Path:
    return Path(f"/tmp/claude-code-review-{run_id}.decision")


def done_file(session_id: str) -> Path:
    return Path(f"/tmp/claude-code-review-{session_id}.done")


def load_route_action(run_id: str) -> str | None:
    data = read_json(decision_file(run_id))
    action = data.get("action") if data else None
    return str(action) if action else None


def load_decisions(run_dir: Path) -> dict[str, Any] | None:
    return read_json(run_dir / "decisions.json")


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


def launch_review(plugin_root: Path, repo: Path) -> Path:
    env = os.environ.copy()
    env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
    env["ACR_STATUS_POLL"] = "0"
    env["ACR_DISABLE_AUTO_RESUME"] = "1"
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


def wait_for_ui_or_terminal(run_dir: Path, deadline: float, poll_interval: float) -> dict[str, Any]:
    last_run: dict[str, Any] = {}
    while time.time() < deadline:
        run = read_json(run_json_path(run_dir)) or {}
        if run:
            last_run = run
        status = str(run.get("status") or "")
        if status in UI_READY_STATUSES or (run_dir / "READY").exists():
            return run
        time.sleep(poll_interval)
    raise GateError(f"Timed out waiting for review UI: {run_dir}")


def wait_for_final_decision(run_dir: Path, deadline: float, poll_interval: float) -> tuple[str, dict[str, Any] | None]:
    run_id = run_dir.name
    while time.time() < deadline:
        run = read_json(run_json_path(run_dir)) or {}
        status = str(run.get("status") or "")
        if status == "no_changes":
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
    action_count = 0
    if decisions and isinstance(decisions.get("findings"), dict):
        action_count = sum(
            1
            for decision in decisions["findings"].values()
            if isinstance(decision, dict) and decision.get("action") in ACTIONABLE_ACTIONS
        )
    system_message = "\n".join([
        "IMPORTANT: The Agentic Code Reviewer UI was closed after the user saved final decisions.",
        f"{action_count} review decision(s) require follow-up.",
        "",
        "Run this command now and read its output:",
        resume_cmd,
        "",
        "Then follow the printed instructions exactly.",
        "Implement only findings marked for implementation or accepted fix.",
        "Do not implement ignored/dismissed findings.",
        "For explanation or follow-up-task decisions, respond exactly as the resume instructions say.",
    ])
    print(json.dumps({
        "decision": "block",
        "reason": "Agentic code review decisions require follow-up.",
        "systemMessage": system_message,
    }))


def emit_launch_failure(repo: Path | None, plugin_root: Path, message: str) -> None:
    repo_part = f" --repo {shlex.quote(str(repo))}" if repo else ""
    cmd = f"bash {shlex.quote(str(plugin_root / 'scripts' / 'orchestrator.sh'))}{repo_part}"
    print(json.dumps({
        "decision": "block",
        "reason": "Agentic code review could not start automatically.",
        "systemMessage": "\n".join([
            "IMPORTANT: Code was modified, but the Agentic Code Reviewer hook could not start the review UI automatically.",
            "",
            message,
            "",
            "Run this command manually, complete the UI decisions, then resume:",
            cmd,
        ]),
    }))


def parse_hook_event(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def run_gate(raw_input: str, plugin_root: Path, cwd: Path, max_seconds: float, poll_interval: float) -> int:
    if os.environ.get("ACR_REVIEW_SUBPROCESS") == "1":
        return 0

    cleanup_stale_sentinels()
    event = parse_hook_event(raw_input)
    session_id = str(event.get("session_id") or "unknown")
    session_done = done_file(session_id)
    if session_done.exists():
        return 0

    repo = git_root(cwd)
    if not repo:
        return 0

    diff = current_review_diff(repo)
    if not diff.strip():
        return 0
    current_hash = diff_sha256(diff)
    deadline = time.time() + max_seconds

    try:
        run_dir = newest_matching_run(repo, current_hash)
        if run_dir is None:
            run_dir = launch_review(plugin_root, repo)
        wait_for_ui_or_terminal(run_dir, deadline, poll_interval)
        outcome, decisions = wait_for_final_decision(run_dir, deadline, poll_interval)
    except GateError as exc:
        emit_launch_failure(repo, plugin_root, str(exc))
        return 0

    touch(session_done)
    write_json(run_dir / "review-gate.json", {
        "session_id": session_id,
        "outcome": outcome,
        "handled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    if outcome == "block":
        emit_block(repo, run_dir, plugin_root, decisions)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plugin-root", default=os.environ.get("CLAUDE_PLUGIN_ROOT"))
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--max-seconds", type=float, default=float(os.environ.get("ACR_GATE_MAX_SECONDS", "345000")))
    parser.add_argument("--poll-interval", type=float, default=float(os.environ.get("ACR_GATE_POLL_INTERVAL_SECONDS", "1")))
    args = parser.parse_args()

    plugin_root = Path(args.plugin_root or Path(__file__).resolve().parents[1]).resolve()
    raw_input = sys.stdin.read()
    return run_gate(raw_input, plugin_root, Path(args.cwd).resolve(), args.max_seconds, args.poll_interval)


if __name__ == "__main__":
    raise SystemExit(main())
