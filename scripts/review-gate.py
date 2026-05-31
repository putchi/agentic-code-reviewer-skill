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
from typing import Any, Callable, TextIO

try:
    from orchestrator import AGENTS as EXPECTED_AGENTS
    from orchestrator import EXCLUDES
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
UI_READY_STATUSES = {"awaiting_decisions", "synthesis_failed", "decisions_saved", "decisions_ready", "no_changes"}
FINAL_ROUTE_ACTIONS = {"implement", "done"}
DEFAULT_GATE_STATUS_INTERVAL_SECONDS = 10.0


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
        if status in UI_READY_STATUSES or (run_dir / "READY").exists():
            return run
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
    reason = "\n".join([
        "Agentic Code Reviewer final decisions require host-agent follow-up.",
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
        "",
        f"Implement only findings marked `{action_label('ask_claude_to_implement')}` or `{action_label('accept_fix')}`.",
        "Do not implement ignored/dismissed findings.",
        f"Handle `{action_label('ask_claude_to_explain')}` and `{action_label('create_follow_up_task')}` exactly as the resume instructions specify.",
    ])
    print(json.dumps({
        "decision": "block",
        "reason": reason,
        "systemMessage": system_message,
    }))


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
        "Agentic Code Reviewer Stop hook could not start or complete the review automatically.",
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


def parse_hook_event(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def hook_cwd(event: dict[str, Any], fallback: Path) -> Path:
    cwd = event.get("cwd")
    if isinstance(cwd, str) and cwd.strip():
        return Path(cwd).expanduser().resolve()
    return fallback.resolve()


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


def run_gate(
    raw_input: str,
    plugin_root: Path,
    cwd: Path,
    max_seconds: float,
    poll_interval: float,
    status_interval: float = DEFAULT_GATE_STATUS_INTERVAL_SECONDS,
) -> int:
    if os.environ.get("ACR_REVIEW_SUBPROCESS") == "1":
        return 0

    event = parse_hook_event(raw_input)
    plan_mode = hook_event_is_plan_mode(event)
    cwd = hook_cwd(event, cwd)
    session_id = str(event.get("session_id") or "unknown")

    repo = git_root(cwd)
    if not repo:
        return 0

    diff = current_review_diff(repo)
    if not diff.strip():
        return 0

    cleanup_stale_sentinels()
    session_done = done_file(session_id)
    if session_done.exists():
        return 0

    current_hash = diff_sha256(diff)
    deadline = time.time() + max_seconds

    try:
        run_dir = newest_matching_run(repo, current_hash)
        if run_dir is None:
            run_dir = launch_review(plugin_root, repo)
        heartbeat = GateHeartbeat(status_interval)
        heartbeat.maybe_emit(run_dir, force=True)
        wait_for_ui_or_terminal(run_dir, deadline, poll_interval, heartbeat)
        outcome, decisions = wait_for_final_decision(run_dir, deadline, poll_interval, heartbeat)
    except GateError as exc:
        emit_launch_failure(repo, plugin_root, str(exc))
        return 0

    touch(session_done)
    write_json(run_dir / "review-gate.json", {
        "session_id": session_id,
        "outcome": outcome,
        "plan_mode": plan_mode,
        "handled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    if outcome == "block":
        emit_block(repo, run_dir, plugin_root, decisions)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plugin-root", default=os.environ.get("CLAUDE_PLUGIN_ROOT"))
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--max-seconds", type=float, default=float(os.environ.get("ACR_GATE_MAX_SECONDS", "345600")))
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


if __name__ == "__main__":
    raise SystemExit(main())
