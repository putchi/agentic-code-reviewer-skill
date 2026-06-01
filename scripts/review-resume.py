#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import shlex
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

VALID_ACTIONS = {
    "accept_fix",
    "ignore",
    "create_follow_up_task",
    "ask_claude_to_explain",
    "ask_claude_to_implement",
}

ACTION_LABELS = {
    "ask_claude_to_implement": "ask host agent to implement",
    "accept_fix": "accept fix",
    "ask_claude_to_explain": "ask host agent to explain",
    "create_follow_up_task": "create follow-up task",
    "ignore": "ignore",
}

IMPLEMENTATION_ACTIONS = {
    "accept_fix",
    "ask_claude_to_implement",
}
NON_CODE_FOLLOW_UP_ACTIONS = {
    "ask_claude_to_explain",
    "create_follow_up_task",
}
POST_RESUME_MARKER_TTL_SECONDS = 86400
POST_RESUME_MARKER_PREFIX = "claude-code-review-post-resume-"


def action_label(action: str) -> str:
    return ACTION_LABELS.get(action, action)


def utc_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_json_sha256(value: dict) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def repo_marker_key(repo: Path) -> str:
    return hashlib.sha256(str(repo).encode("utf-8")).hexdigest()


def safe_marker_run_id(run_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", run_id.strip())
    return safe or hashlib.sha256(run_id.encode("utf-8")).hexdigest()


def legacy_post_resume_marker_path(repo: Path, tmp_dir: Path = Path("/tmp")) -> Path:
    return tmp_dir / f"{POST_RESUME_MARKER_PREFIX}{repo_marker_key(repo)}.json"


def post_resume_marker_path(repo: Path, run_id: str, tmp_dir: Path = Path("/tmp")) -> Path:
    return tmp_dir / f"{POST_RESUME_MARKER_PREFIX}{repo_marker_key(repo)}-{safe_marker_run_id(run_id)}.json"


def load_optional_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def load_original_diff_sha256(run_dir: Path) -> str | None:
    run = load_optional_json(run_dir / "run.json")
    value = run.get("diff_sha256") if run else None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


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


def load_original_diff_paths(run_dir: Path) -> list[str]:
    try:
        return diff_file_paths((run_dir / "diff.txt").read_text(encoding="utf-8"))
    except Exception:
        return []


def decision_actions(decisions: dict) -> set[str]:
    findings = decisions.get("findings")
    if not isinstance(findings, dict):
        return set()
    actions: set[str] = set()
    for decision in findings.values():
        if isinstance(decision, dict) and isinstance(decision.get("action"), str):
            actions.add(decision["action"])
    return actions


def marker_suppression_mode(decisions: dict) -> str | None:
    actions = decision_actions(decisions)
    if actions & IMPLEMENTATION_ACTIONS:
        return "implementation"
    if actions & NON_CODE_FOLLOW_UP_ACTIONS:
        return "same_diff"
    return None


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def write_post_resume_marker(
    repo: Path,
    run_dir: Path,
    decisions: dict,
    now: datetime | None = None,
    tmp_dir: Path = Path("/tmp"),
) -> Path | None:
    original_diff_sha = load_original_diff_sha256(run_dir)
    if not original_diff_sha:
        return None
    suppression_mode = marker_suppression_mode(decisions)
    if not suppression_mode:
        return None

    created_at = now or datetime.now(timezone.utc)
    expires_at = created_at + timedelta(seconds=POST_RESUME_MARKER_TTL_SECONDS)
    marker = {
        "schema_version": 1,
        "repo": str(repo),
        "run_id": run_dir.name,
        "original_diff_sha256": original_diff_sha,
        "original_diff_paths": load_original_diff_paths(run_dir),
        "decisions_sha256": canonical_json_sha256(decisions),
        "suppression_mode": suppression_mode,
        "created_at": utc_timestamp(created_at),
        "expires_at": utc_timestamp(expires_at),
    }
    marker_path = post_resume_marker_path(repo, run_dir.name, tmp_dir)
    write_json(marker_path, marker)
    try:
        legacy_post_resume_marker_path(repo, tmp_dir).unlink()
    except Exception:
        pass
    return marker_path


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Missing required file: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}")


def find_run_dir(repo: Path, run_id: str) -> Path:
    direct = repo / ".claude" / "review-runs" / run_id
    if direct.exists():
        return direct
    matches = list((repo / ".claude" / "review-runs").glob(f"{run_id}*"))
    if len(matches) == 1:
        return matches[0]
    raise SystemExit(f"Run not found: {run_id}")


def finding_by_id(synthesis: dict) -> dict[str, dict]:
    return {
        str(f.get("id")): f
        for f in synthesis.get("deduped_findings", [])
        if isinstance(f, dict) and f.get("id")
    }


def validate_decisions(decisions: dict) -> None:
    findings = decisions.get("findings")
    if not isinstance(findings, dict):
        raise SystemExit("decisions.json must contain a findings object")
    for finding_id, decision in findings.items():
        if not isinstance(decision, dict):
            raise SystemExit(f"Decision for {finding_id} must be an object")
        action = decision.get("action")
        if action not in VALID_ACTIONS:
            raise SystemExit(f"Decision for {finding_id} has invalid action: {action}")


def _validate_resume_artifact(artifact: dict | None) -> bool:
    """Strictly validate resume-artifact.json before using the fast path.

    Checks the required fields and that every entry in findings_by_action
    is a list of dicts with at least a string 'id' — the minimum contract
    that the printing loop below relies on.
    """
    if not isinstance(artifact, dict):
        return False
    if not isinstance(artifact.get("run_id"), str) or not artifact["run_id"]:
        return False
    if not isinstance(artifact.get("decided_at"), str) or not artifact["decided_at"]:
        return False
    fba = artifact.get("findings_by_action")
    if not isinstance(fba, dict):
        return False
    for action, entries in fba.items():
        if not isinstance(action, str):
            return False
        if not isinstance(entries, list):
            return False
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    run_dir = find_run_dir(repo, args.run_id.strip())
    # Fast path: use resume-artifact.json when available and valid
    artifact_path = run_dir / "resume-artifact.json"
    artifact = load_optional_json(artifact_path)
    if _validate_resume_artifact(artifact):
        findings_by_action = artifact["findings_by_action"]

        # Build action counts from the artifact for the summary header
        ordered_actions = [
            "ask_claude_to_implement",
            "accept_fix",
            "ask_claude_to_explain",
            "create_follow_up_task",
            "ignore",
        ]

        # Write the post-resume marker — load decisions.json for marker data
        decisions_for_marker = load_optional_json(run_dir / "decisions.json")
        if decisions_for_marker:
            write_post_resume_marker(repo, run_dir, decisions_for_marker)

        print("## Review Decision")
        print(f"Run: {artifact.get('run_id', run_dir.name)}")
        print(f"Decided at: {artifact.get('decided_at', 'unknown')}")
        has_impl = False
        for action in ordered_actions:
            entries = findings_by_action.get(action) or []
            if not isinstance(entries, list):
                entries = []
            if entries:
                ids = [str(e.get("id", "")) for e in entries if isinstance(e, dict)]
                print(f"{action_label(action)} ({len(ids)}): {', '.join(ids)}")
            if action in ("ask_claude_to_implement", "accept_fix") and entries:
                has_impl = True
        if not has_impl:
            print("No findings are selected for implementation.")
        if artifact.get("global_comment"):
            print(f"Note: {artifact['global_comment']}")
        print()

        print("## Resume Instructions")
        print("- Implement only findings marked `ask host agent to implement` or `accept fix`.")
        print("- Do not implement findings marked `ignore`.")
        print("- For `ask host agent to explain`, answer the user's question in chat without editing code unless the user explicitly asks.")
        print("- For `create follow-up task`, write a concise follow-up task description in the final response; do not silently edit code for it.")
        print("- Apply `line_annotations` and `global_comment` as additional user guidance.")
        print()

        for action in ordered_actions:
            entries = findings_by_action.get(action) or []
            if not isinstance(entries, list):
                entries = []
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                finding_id = str(entry.get("id", ""))
                print(f"### {finding_id} — {action_label(action)}")
                loc = entry.get("location") or f"{entry.get('file', '')}:{entry.get('line', '')}"
                if loc and loc != ":":
                    print(f"Location: {loc}")
                if entry.get("finding"):
                    print(f"Finding: {entry['finding']}")
                if entry.get("reasoning"):
                    print(f"Reasoning: {entry['reasoning']}")
                if entry.get("evidence"):
                    print(f"Evidence: {entry['evidence']}")
                if entry.get("comment"):
                    print(f"User comment: {entry['comment']}")
                print()

        annotations = artifact.get("line_annotations") or {}
        if annotations:
            print("## Line Annotations")
            for key, annotation in annotations.items():
                if isinstance(annotation, dict):
                    print(f"- {key}: [{annotation.get('type')}] {annotation.get('text')}")
        return 0

    # Fallback: load decisions.json + synthesis.json separately
    synthesis_path = run_dir / "synthesis.json"
    decisions_path = run_dir / "decisions.json"
    if not decisions_path.exists():
        print(f"decisions.json is not present for run {run_dir.name}.")
        print(f"UI run dir: {run_dir}")
        print("Relaunch UI:")
        print(f"node \"${{CLAUDE_PLUGIN_ROOT}}/server/review-server.js\" --run-dir \"{run_dir}\" --session \"{run_dir.name}\" --save-dir \"{repo / 'docs' / 'code-reviews'}\"")
        return 1

    synthesis = load_json(synthesis_path)
    decisions = load_json(decisions_path)
    validate_decisions(decisions)
    write_post_resume_marker(repo, run_dir, decisions)
    by_id = finding_by_id(synthesis)

    buckets: dict[str, list[str]] = {action: [] for action in sorted(VALID_ACTIONS)}
    for finding_id, decision in decisions["findings"].items():
        buckets[decision["action"]].append(finding_id)

    print("## Review Decision")
    print(f"Run: {run_dir.name}")
    print(f"Decided at: {decisions.get('decided_at', 'unknown')}")
    for action in [
        "ask_claude_to_implement",
        "accept_fix",
        "ask_claude_to_explain",
        "create_follow_up_task",
        "ignore",
    ]:
        ids = buckets[action]
        if ids:
            print(f"{action_label(action)} ({len(ids)}): {', '.join(ids)}")
    if not buckets["ask_claude_to_implement"] and not buckets["accept_fix"]:
        print("No findings are selected for implementation.")
    if decisions.get("global_comment"):
        print(f"Note: {decisions['global_comment']}")
    print()

    print("## Resume Instructions")
    print("- Implement only findings marked `ask host agent to implement` or `accept fix`.")
    print("- Do not implement findings marked `ignore`.")
    print("- For `ask host agent to explain`, answer the user's question in chat without editing code unless the user explicitly asks.")
    print("- For `create follow-up task`, write a concise follow-up task description in the final response; do not silently edit code for it.")
    print("- Apply `line_annotations` and `global_comment` as additional user guidance.")
    print()

    for finding_id, decision in decisions["findings"].items():
        finding = by_id.get(finding_id, {})
        print(f"### {finding_id} — {action_label(decision['action'])}")
        loc = finding.get("location") or f"{finding.get('file', '')}:{finding.get('line', '')}"
        if loc:
            print(f"Location: {loc}")
        if finding.get("finding"):
            print(f"Finding: {finding['finding']}")
        if finding.get("reasoning"):
            print(f"Reasoning: {finding['reasoning']}")
        if finding.get("evidence"):
            print(f"Evidence: {finding['evidence']}")
        if decision.get("comment"):
            print(f"User comment: {decision['comment']}")
        print()

    annotations = decisions.get("line_annotations") or {}
    if annotations:
        print("## Line Annotations")
        for key, annotation in annotations.items():
            print(f"- {key}: [{annotation.get('type')}] {annotation.get('text')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
