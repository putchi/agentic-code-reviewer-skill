#!/usr/bin/env python3
import argparse
import datetime as _dt
import json
import re
import sys
from pathlib import Path

AGENTS = {
    "semantic-analyzer",
    "security-scanner",
    "architecture-reviewer",
    "test-coverage-analyzer",
    "senior-dev-reviewer",
}


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def write_atomic(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def extract_text_from_obj(obj: object) -> list[str]:
    pieces: list[str] = []
    if isinstance(obj, str):
        return [obj]
    if not isinstance(obj, dict):
        return pieces

    for key in ("result", "text", "output", "delta"):
        value = obj.get(key)
        if isinstance(value, str):
            pieces.append(value)

    content = obj.get("content")
    if isinstance(content, str):
        pieces.append(content)
    elif isinstance(content, list):
        for item in content:
            pieces.extend(extract_text_from_obj(item))

    message = obj.get("message")
    if isinstance(message, dict):
        pieces.extend(extract_text_from_obj(message))
    elif isinstance(message, str):
        pieces.append(message)

    item = obj.get("item")
    if isinstance(item, dict) and item.get("type") == "agent_message":
        text = item.get("text")
        if isinstance(text, str):
            pieces.append(text)

    return pieces


def extract_jsonl_text(raw: str) -> str:
    pieces: list[str] = []
    last_agent_message = ""
    parsed_any = False
    for line in raw.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except Exception:
            continue
        parsed_any = True
        if isinstance(parsed, dict):
            item = parsed.get("item")
            if isinstance(item, dict) and item.get("type") == "agent_message" and isinstance(item.get("text"), str):
                last_agent_message = item["text"]
                continue
        pieces.extend(extract_text_from_obj(parsed))

    if last_agent_message:
        return last_agent_message
    return "\n".join(pieces) if parsed_any and pieces else raw


def extract_text(raw: str) -> str:
    try:
        parsed = json.loads(raw)
    except Exception:
        return extract_jsonl_text(raw)

    if isinstance(parsed, str):
        return parsed
    if not isinstance(parsed, dict):
        return raw
    pieces = extract_text_from_obj(parsed)
    return "\n".join(pieces) if pieces else raw


def extract_json_object(text: str) -> dict:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object found in model output")
    parsed = json.loads(stripped[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("top-level JSON value is not an object")
    return parsed


def normalize_finding(finding: dict, agent: str, index: int) -> dict:
    severity = str(finding.get("severity", "HIGH")).upper()
    if severity not in {"CRITICAL", "HIGH"}:
        severity = "HIGH"
    file = str(finding.get("file", ""))
    line = int(finding.get("line") or 0)
    return {
        "id": str(finding.get("id") or f"{agent}-{index + 1}"),
        "severity": severity,
        "file": file,
        "line": line,
        "location": str(finding.get("location") or f"{file}:{line}"),
        "finding": str(finding.get("finding", "")),
        "reasoning": str(finding.get("reasoning", "")),
        "evidence": str(finding.get("evidence", "")),
        "confidence": int(finding.get("confidence") or 80),
    }


def reviewer_failure(args: argparse.Namespace) -> int:
    write_atomic(Path(args.out_file), {
        "run_id": args.run_id,
        "agent": args.agent,
        "status": "failed",
        "started_at": args.started_at,
        "completed_at": args.completed_at,
        "error": args.error,
        "findings": [],
    })
    return 0


def normalize_reviewer(args: argparse.Namespace) -> int:
    raw = Path(args.raw_file).read_text(encoding="utf-8", errors="replace")
    text = extract_text(raw)
    try:
        parsed = extract_json_object(text)
    except Exception:
        if text.strip().lower().startswith("no "):
            parsed = {"status": "complete", "findings": []}
        else:
            write_atomic(Path(args.out_file), {
                "run_id": args.run_id,
                "agent": args.agent,
                "status": "failed",
                "started_at": args.started_at,
                "completed_at": args.completed_at,
                "error": "invalid reviewer JSON",
                "findings": [],
            })
            return 1

    findings = parsed.get("findings", [])
    if not isinstance(findings, list):
        findings = []

    value = {
        "run_id": args.run_id,
        "agent": args.agent,
        "status": str(parsed.get("status") or "complete"),
        "started_at": str(parsed.get("started_at") or args.started_at),
        "completed_at": str(parsed.get("completed_at") or args.completed_at),
        "error": parsed.get("error", None),
        "findings": [normalize_finding(f, args.agent, i) for i, f in enumerate(findings) if isinstance(f, dict)],
    }
    schema_error: str | None = None
    if value["agent"] not in AGENTS or value["status"] not in {"complete", "failed"}:
        schema_error = f"reviewer result failed schema validation: agent={value['agent']!r}, status={value['status']!r}"
        value["status"] = "failed"
        value["error"] = value.get("error") or schema_error
        value["findings"] = []
    write_atomic(Path(args.out_file), value)
    if schema_error:
        Path(args.out_file + ".validation-error.txt").write_text(schema_error + "\n", encoding="utf-8")
        return 2
    return 0 if value["status"] == "complete" else 1


def normalize_synthesis_finding(finding: dict, index: int) -> dict:
    severity = str(finding.get("severity", "NOTE")).upper()
    if severity not in {"CRITICAL", "HIGH", "NOTE"}:
        severity = "NOTE"
    file = str(finding.get("file", ""))
    line = int(finding.get("line") or 0)
    source_agents = finding.get("source_agents") or finding.get("dimensions") or []
    if not isinstance(source_agents, list):
        source_agents = [str(source_agents)]
    return {
        "id": str(finding.get("id") or f"f{index + 1}"),
        "severity": severity,
        "file": file,
        "line": line,
        "location": str(finding.get("location") or f"{file}:{line}"),
        "finding": str(finding.get("finding", "")),
        "reasoning": str(finding.get("reasoning", "")),
        "evidence": str(finding.get("evidence", "")),
        "source_agents": [str(a) for a in source_agents],
    }


def normalize_synthesis(args: argparse.Namespace) -> int:
    raw = Path(args.raw_file).read_text(encoding="utf-8", errors="replace")
    text = extract_text(raw)
    parsed = extract_json_object(text)
    findings = parsed.get("deduped_findings", [])
    if not isinstance(findings, list):
        findings = []
    value = {
        "run_id": args.run_id,
        "two_sentence_verdict": str(parsed.get("two_sentence_verdict") or ""),
        "deduped_findings": [normalize_synthesis_finding(f, i) for i, f in enumerate(findings) if isinstance(f, dict)],
        "dropped_findings_with_reason": parsed.get("dropped_findings_with_reason") if isinstance(parsed.get("dropped_findings_with_reason"), list) else [],
        "contradictions_resolved": parsed.get("contradictions_resolved") if isinstance(parsed.get("contradictions_resolved"), list) else [],
        "severity_rationale": parsed.get("severity_rationale") if isinstance(parsed.get("severity_rationale"), dict) else {},
        "recommended_next_actions": parsed.get("recommended_next_actions") if isinstance(parsed.get("recommended_next_actions"), list) else [],
        "source_agent_result_files": args.agent_files,
    }
    if not value["two_sentence_verdict"]:
        raise ValueError("synthesis missing two_sentence_verdict")
    write_atomic(Path(args.out_file), value)
    return 0


def aggregate_reviewer_findings(out_file: str, agent_files: list[str]) -> list[dict]:
    run_root = Path(out_file).parent
    merged: dict[tuple[str, int, str], dict] = {}
    for rel in agent_files:
        path = run_root / rel
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict) or not isinstance(data.get("findings"), list):
            continue
        agent = str(data.get("agent") or Path(rel).stem)
        for raw in data["findings"]:
            if not isinstance(raw, dict):
                continue
            finding = normalize_synthesis_finding(raw, len(merged))
            if not finding["finding"]:
                continue
            source_agents = finding.get("source_agents") or []
            if agent and agent not in source_agents:
                source_agents.append(agent)
            finding["source_agents"] = source_agents
            key = (finding["file"], finding["line"], finding["finding"].strip().lower())
            if key in merged:
                existing_agents = set(merged[key].get("source_agents") or [])
                existing_agents.update(source_agents)
                merged[key]["source_agents"] = sorted(existing_agents)
                if merged[key]["severity"] != "CRITICAL" and finding["severity"] == "CRITICAL":
                    merged[key]["severity"] = "CRITICAL"
                continue
            finding["id"] = f"f{len(merged) + 1}"
            merged[key] = finding
    return list(merged.values())


def synthesis_fallback(args: argparse.Namespace) -> int:
    findings = aggregate_reviewer_findings(args.out_file, args.agent_files)
    next_actions = ["Inspect orchestrator.log and reviewer outputs before acting on this run."]
    if findings:
        next_actions.insert(0, "Review the raw reviewer findings; the synthesis model did not produce valid JSON.")
    write_atomic(Path(args.out_file), {
        "run_id": args.run_id,
        "two_sentence_verdict": args.verdict,
        "deduped_findings": findings,
        "dropped_findings_with_reason": [{"reason": args.error}],
        "contradictions_resolved": [],
        "severity_rationale": {},
        "recommended_next_actions": next_actions,
        "source_agent_result_files": args.agent_files,
    })
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    failed = sub.add_parser("reviewer-failure")
    failed.add_argument("--out-file", required=True)
    failed.add_argument("--run-id", required=True)
    failed.add_argument("--agent", required=True)
    failed.add_argument("--started-at", required=True)
    failed.add_argument("--completed-at", required=True)
    failed.add_argument("--error", required=True)
    failed.set_defaults(func=reviewer_failure)

    reviewer = sub.add_parser("reviewer")
    reviewer.add_argument("--raw-file", required=True)
    reviewer.add_argument("--out-file", required=True)
    reviewer.add_argument("--run-id", required=True)
    reviewer.add_argument("--agent", required=True)
    reviewer.add_argument("--started-at", required=True)
    reviewer.add_argument("--completed-at", required=True)
    reviewer.set_defaults(func=normalize_reviewer)

    synthesis = sub.add_parser("synthesis")
    synthesis.add_argument("--raw-file", required=True)
    synthesis.add_argument("--out-file", required=True)
    synthesis.add_argument("--run-id", required=True)
    synthesis.add_argument("--agent-files", nargs="*", default=[])
    synthesis.set_defaults(func=normalize_synthesis)

    fallback = sub.add_parser("synthesis-fallback")
    fallback.add_argument("--out-file", required=True)
    fallback.add_argument("--run-id", required=True)
    fallback.add_argument("--verdict", required=True)
    fallback.add_argument("--error", required=True)
    fallback.add_argument("--agent-files", nargs="*", default=[])
    fallback.set_defaults(func=synthesis_fallback)

    args = parser.parse_args()
    try:
      return args.func(args)
    except Exception as exc:
      print(f"claude_json.py: {exc}", file=sys.stderr)
      return 1


if __name__ == "__main__":
    raise SystemExit(main())
