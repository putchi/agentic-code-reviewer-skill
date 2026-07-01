#!/usr/bin/env python3
from __future__ import annotations
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


def diff_file_set(diff_text: str) -> set[str]:
    """Extract changed file paths from a unified diff."""
    files: set[str] = set()
    for line in diff_text.splitlines():
        if line.startswith("+++ b/") or line.startswith("--- a/"):
            files.add(line[6:].strip())
        elif line.startswith("diff --git "):
            match = re.match(r"diff --git a/(.+?) b/(.+)$", line)
            if match:
                files.update(match.groups())
    files.discard("/dev/null")
    return files


def normalize_finding(
    finding: dict,
    agent: str,
    index: int,
    diff_files: set[str] | None = None,
    errors: list[str] | None = None,
    warnings: list[str] | None = None,
) -> dict:
    """Normalize one reviewer finding.

    Strict checks (missing confidence, non-positive line, empty file/evidence,
    file not in diff) append to `errors` so the caller can fail validation and
    trigger the orchestrator retry loop. Soft coercions append to `warnings`.
    """
    label = f"finding {index + 1}"
    raw_severity = str(finding.get("severity", "HIGH")).upper()
    severity = raw_severity if raw_severity in {"CRITICAL", "HIGH"} else "HIGH"
    if severity != raw_severity and warnings is not None:
        warnings.append(f"{label}: severity {raw_severity!r} coerced to HIGH")

    file = str(finding.get("file", "")).strip()
    if not file and errors is not None:
        errors.append(f"{label}: missing file path")
    if file and diff_files and file not in diff_files and errors is not None:
        errors.append(f"{label}: file {file!r} does not appear in the reviewed diff")

    try:
        line = int(finding.get("line") or 0)
    except (TypeError, ValueError):
        line = 0
    if line <= 0 and errors is not None:
        errors.append(f"{label}: line must be a positive integer (got {finding.get('line')!r})")

    evidence = str(finding.get("evidence", ""))
    if not evidence.strip() and errors is not None:
        errors.append(f"{label}: evidence must quote the exact diff lines demonstrating the issue")

    raw_confidence = finding.get("confidence")
    if raw_confidence is None:
        confidence = 0
        if errors is not None:
            errors.append(f"{label}: missing confidence (integer 0-100 required)")
    else:
        try:
            confidence = max(0, min(100, int(raw_confidence)))
        except (TypeError, ValueError):
            confidence = 0
            if errors is not None:
                errors.append(f"{label}: confidence must be an integer 0-100 (got {raw_confidence!r})")

    return {
        "id": str(finding.get("id") or f"{agent}-{index + 1}"),
        "severity": severity,
        "file": file,
        "line": line,
        "location": str(finding.get("location") or f"{file}:{line}"),
        "finding": str(finding.get("finding", "")),
        "reasoning": str(finding.get("reasoning", "")),
        "evidence": evidence,
        "confidence": confidence,
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

    diff_files: set[str] | None = None
    diff_file = getattr(args, "diff_file", None)
    if diff_file:
        try:
            diff_files = diff_file_set(Path(diff_file).read_text(encoding="utf-8", errors="replace"))
        except Exception:
            diff_files = None  # missing diff file must not fail validation

    finding_errors: list[str] = []
    finding_warnings: list[str] = []
    value = {
        "run_id": args.run_id,
        "agent": args.agent,
        "status": str(parsed.get("status") or "complete"),
        "started_at": str(parsed.get("started_at") or args.started_at),
        "completed_at": str(parsed.get("completed_at") or args.completed_at),
        "error": parsed.get("error", None),
        "findings": [
            normalize_finding(f, args.agent, i, diff_files, finding_errors, finding_warnings)
            for i, f in enumerate(findings)
            if isinstance(f, dict)
        ],
    }
    schema_error: str | None = None
    if value["agent"] not in AGENTS or value["status"] not in {"complete", "failed"}:
        schema_error = f"reviewer result failed schema validation: agent={value['agent']!r}, status={value['status']!r}"
    elif finding_errors:
        schema_error = "reviewer findings failed validation:\n" + "\n".join(finding_errors)
    if schema_error:
        value["status"] = "failed"
        value["error"] = value.get("error") or schema_error
        value["findings"] = []
    write_atomic(Path(args.out_file), value)
    if finding_warnings:
        Path(args.out_file + ".validation-warnings.txt").write_text("\n".join(finding_warnings) + "\n", encoding="utf-8")
    if schema_error:
        Path(args.out_file + ".validation-error.txt").write_text(schema_error + "\n", encoding="utf-8")
        return 2
    # Success: remove any stale validation sidecar left by a failed prior attempt
    try:
        Path(args.out_file + ".validation-error.txt").unlink()
    except FileNotFoundError:
        pass
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


def _text_similarity(a: str, b: str) -> float:
    """Return word-overlap Jaccard similarity between two finding texts (0.0–1.0)."""
    STOPWORDS = {"the", "a", "an", "is", "in", "of", "to", "and", "or", "not", "this", "that", "it", "be", "for", "on", "at"}
    wa = {w for w in re.split(r"\W+", a.lower()) if len(w) > 2 and w not in STOPWORDS}
    wb = {w for w in re.split(r"\W+", b.lower()) if len(w) > 2 and w not in STOPWORDS}
    if not wa and not wb:
        return 1.0
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _dedup_findings(findings: list[dict]) -> tuple[list[dict], list[dict]]:
    """Deduplicate findings that share the same root cause.

    Pass 1 — exact text: merges findings on the same file with identical (normalised)
    finding text across any number of source agents.

    Pass 2 — proximity: merges findings on the same file whose lines are within
    ±LINE_WINDOW *and* whose finding texts are at least SIMILARITY_THRESHOLD similar.
    Pure line-proximity without textual agreement does NOT merge, so an unrelated
    'null check' at line 42 and 'SQL injection' at line 44 are kept separate.

    IDs are NOT reassigned — callers that need sequential ids must do so themselves.
    Returns (deduped_findings, drop_records).
    """
    LINE_WINDOW = 5
    SIMILARITY_THRESHOLD = 0.35
    drops: list[dict] = []

    # Pass 1: group by (file, normalised finding text) — merges exact/near-exact text dupes
    text_groups: dict[tuple[str, str], list[dict]] = {}
    for f in findings:
        key = (f.get("file", ""), f.get("finding", "").strip().lower())
        text_groups.setdefault(key, []).append(f)

    merged_by_text: list[dict] = []
    for (file, _norm_text), group in text_groups.items():
        if len(group) == 1:
            merged_by_text.append(group[0])
            continue
        best_idx = max(range(len(group)), key=lambda i: len(str(group[i].get("reasoning", ""))) + len(str(group[i].get("evidence", ""))))
        base = dict(group[best_idx])
        all_agents: set[str] = set()
        for g in group:
            all_agents.update(g.get("source_agents") or [])
        base["source_agents"] = sorted(all_agents)
        severity_order = {"CRITICAL": 2, "HIGH": 1, "NOTE": 0}
        best_sev = max((g.get("severity", "NOTE") for g in group), key=lambda s: severity_order.get(s, 0))
        base["severity"] = best_sev
        merged_by_text.append(base)
        for i, g in enumerate(group):
            if i != best_idx:
                drops.append({
                    "id": str(g.get("id", "")),
                    "reason": f"merged into {base.get('id', '?')} — duplicate finding text on {file}",
                })

    # Pass 2: proximity merge — same file, nearby lines, AND similar text
    by_file: dict[str, list[dict]] = {}
    for f in merged_by_text:
        by_file.setdefault(f.get("file", ""), []).append(f)

    deduped: list[dict] = []
    for file, file_findings in by_file.items():
        file_findings = sorted(file_findings, key=lambda x: int(x.get("line") or 0))
        merged_file: list[dict] = []
        for finding in file_findings:
            line = int(finding.get("line") or 0)
            absorbed = False
            if line > 0:
                finding_text = finding.get("finding", "")
                for existing in merged_file:
                    existing_line = int(existing.get("line") or 0)
                    if existing_line > 0 and abs(line - existing_line) <= LINE_WINDOW:
                        sim = _text_similarity(finding_text, existing.get("finding", ""))
                        if sim < SIMILARITY_THRESHOLD:
                            continue  # nearby but unrelated — keep both
                        all_agents = set(existing.get("source_agents") or [])
                        all_agents.update(finding.get("source_agents") or [])
                        existing["source_agents"] = sorted(all_agents)
                        severity_order = {"CRITICAL": 2, "HIGH": 1, "NOTE": 0}
                        if severity_order.get(finding.get("severity", "NOTE"), 0) > severity_order.get(existing.get("severity", "NOTE"), 0):
                            existing["severity"] = finding["severity"]
                        if len(str(finding.get("reasoning", ""))) + len(str(finding.get("evidence", ""))) > \
                           len(str(existing.get("reasoning", ""))) + len(str(existing.get("evidence", ""))):
                            existing["reasoning"] = finding.get("reasoning", existing.get("reasoning", ""))
                            existing["evidence"] = finding.get("evidence", existing.get("evidence", ""))
                        drops.append({
                            "id": str(finding.get("id", "")),
                            "reason": f"merged into {existing.get('id', '?')} — same file {file}, lines {existing_line}±{LINE_WINDOW} overlap, similarity {sim:.2f}",
                        })
                        absorbed = True
                        break
            if not absorbed:
                merged_file.append(dict(finding))
        deduped.extend(merged_file)

    return deduped, drops


def normalize_synthesis(args: argparse.Namespace) -> int:
    raw = Path(args.raw_file).read_text(encoding="utf-8", errors="replace")
    text = extract_text(raw)
    parsed = extract_json_object(text)
    findings = parsed.get("deduped_findings", [])
    if not isinstance(findings, list):
        findings = []
    normalized = [normalize_synthesis_finding(f, i) for i, f in enumerate(findings) if isinstance(f, dict)]
    # Apply dedup pass as a safety net
    deduped, extra_drops = _dedup_findings(normalized)
    existing_drops = parsed.get("dropped_findings_with_reason") if isinstance(parsed.get("dropped_findings_with_reason"), list) else []
    all_drops = list(existing_drops) + extra_drops
    value = {
        "run_id": args.run_id,
        "two_sentence_verdict": str(parsed.get("two_sentence_verdict") or ""),
        "deduped_findings": deduped,
        "dropped_findings_with_reason": all_drops,
        "contradictions_resolved": parsed.get("contradictions_resolved") if isinstance(parsed.get("contradictions_resolved"), list) else [],
        "severity_rationale": parsed.get("severity_rationale") if isinstance(parsed.get("severity_rationale"), dict) else {},
        "recommended_next_actions": parsed.get("recommended_next_actions") if isinstance(parsed.get("recommended_next_actions"), list) else [],
        "source_agent_result_files": args.agent_files,
    }
    if not value["two_sentence_verdict"]:
        _synthesis_validation_failure(args.out_file, "synthesis missing two_sentence_verdict")
    critical_count = sum(1 for f in deduped if f.get("severity") == "CRITICAL")
    verdict_lower = value["two_sentence_verdict"].lower()
    ship_ready_phrases = ("ship as-is", "ship as is", "ready to ship", "fit to ship as-is")
    if critical_count > 0 and any(p in verdict_lower for p in ship_ready_phrases):
        _synthesis_validation_failure(
            args.out_file,
            f"verdict says ship-ready but {critical_count} CRITICAL finding(s) were retained — "
            "the verdict must call for a fix or rework when CRITICAL findings exist",
        )
    write_atomic(Path(args.out_file), value)
    return 0


def _synthesis_validation_failure(out_file: str, message: str) -> None:
    """Record a synthesis validation error where the orchestrator retry can find it, then raise."""
    try:
        Path(out_file + ".validation-error.txt").write_text(message + "\n", encoding="utf-8")
    except Exception:
        pass
    raise ValueError(message)


def aggregate_reviewer_findings(out_file: str, agent_files: list[str]) -> list[dict]:
    run_root = Path(out_file).parent
    raw_findings: list[dict] = []
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
            finding = normalize_synthesis_finding(raw, len(raw_findings))
            if not finding["finding"]:
                continue
            source_agents = finding.get("source_agents") or []
            if agent and agent not in source_agents:
                source_agents.append(agent)
            finding["source_agents"] = source_agents
            finding["id"] = f"f{len(raw_findings) + 1}"
            raw_findings.append(finding)
    deduped, _drops = _dedup_findings(raw_findings)
    # Reassign sequential IDs now that dedup may have removed entries
    for i, f in enumerate(deduped):
        f["id"] = f"f{i + 1}"
    return deduped


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
    reviewer.add_argument("--diff-file", default=None)
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
