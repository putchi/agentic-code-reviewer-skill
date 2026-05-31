#!/usr/bin/env python3
import argparse
import json
import sys
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


def action_label(action: str) -> str:
    return ACTION_LABELS.get(action, action)


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    run_dir = find_run_dir(repo, args.run_id.strip())
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
