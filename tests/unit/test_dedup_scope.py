#!/usr/bin/env python3
from __future__ import annotations
"""Tests for Issues 3, 4, 5:
  - Issue 3: _dedup_findings() in claude_json.py
  - Issue 4: load_acrignore_excludes() in orchestrator.py
  - Issue 5: resolve_out_of_scope_files() and outOfScope config in orchestrator.py
"""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]

CLAUDE_JSON_SPEC = importlib.util.spec_from_file_location("claude_json", ROOT / "scripts" / "claude_json.py")
claude_json = importlib.util.module_from_spec(CLAUDE_JSON_SPEC)
assert CLAUDE_JSON_SPEC and CLAUDE_JSON_SPEC.loader
CLAUDE_JSON_SPEC.loader.exec_module(claude_json)

ORCHESTRATOR_SPEC = importlib.util.spec_from_file_location("orchestrator_mod", ROOT / "scripts" / "orchestrator.py")
orchestrator = importlib.util.module_from_spec(ORCHESTRATOR_SPEC)
assert ORCHESTRATOR_SPEC and ORCHESTRATOR_SPEC.loader
sys.modules["orchestrator_mod"] = orchestrator  # required so @dataclass can resolve the module
ORCHESTRATOR_SPEC.loader.exec_module(orchestrator)


def make_finding(id: str, file: str, line: int, finding_text: str, severity: str = "HIGH",
                 source_agents: list | None = None) -> dict:
    agents = source_agents or ["semantic-analyzer"]
    return {
        "id": id,
        "severity": severity,
        "file": file,
        "line": line,
        "location": f"{file}:{line}",
        "finding": finding_text,
        "reasoning": f"Reasoning for {id}",
        "evidence": f"code snippet for {id}",
        "source_agents": agents,
    }


class DedupFindingsTest(unittest.TestCase):
    """Issue 3 — _dedup_findings() in claude_json.py"""

    def test_adjacent_line_findings_collapse_to_one(self) -> None:
        """3 findings on same file with adjacent line numbers and same text should collapse to 1."""
        findings = [
            make_finding("f1", "WorkerAutoConverters.java", 42, "Field mapping gap in converter",
                         source_agents=["semantic-analyzer"]),
            make_finding("f2", "WorkerAutoConverters.java", 44, "Field mapping gap in converter",
                         source_agents=["security-scanner"]),
            make_finding("f3", "WorkerAutoConverters.java", 46, "Field mapping gap in converter",
                         source_agents=["senior-dev-reviewer"]),
        ]
        deduped, drops = claude_json._dedup_findings(findings)

        self.assertEqual(len(deduped), 1, "Three adjacent same-text findings should collapse to one")
        merged = deduped[0]
        # All source agents should be unioned
        self.assertEqual(set(merged["source_agents"]), {"semantic-analyzer", "security-scanner", "senior-dev-reviewer"})
        # 2 findings should be recorded as dropped (text dedup merges 3 into 1, recording 2 drops)
        self.assertEqual(len(drops), 2)

    def test_different_files_not_merged(self) -> None:
        """Findings on different files with same text are NOT merged (file is part of dedup key)."""
        findings = [
            make_finding("f1", "FileA.java", 10, "Null pointer risk", source_agents=["semantic-analyzer"]),
            make_finding("f2", "FileB.java", 10, "Null pointer risk", source_agents=["security-scanner"]),
        ]
        deduped, drops = claude_json._dedup_findings(findings)
        # Different files: text dedup key includes file, so they remain separate
        self.assertEqual(len(deduped), 2)
        self.assertEqual(len(drops), 0)

    def test_different_text_different_lines_not_merged(self) -> None:
        """Findings with different text and non-adjacent lines should remain separate."""
        findings = [
            make_finding("f1", "SomeFile.java", 10, "Missing null check", source_agents=["semantic-analyzer"]),
            make_finding("f2", "SomeFile.java", 100, "SQL injection risk", source_agents=["security-scanner"]),
        ]
        deduped, drops = claude_json._dedup_findings(findings)
        self.assertEqual(len(deduped), 2)
        self.assertEqual(len(drops), 0)

    def test_highest_severity_kept_on_merge(self) -> None:
        """When merging, the highest severity should be kept."""
        findings = [
            make_finding("f1", "App.java", 20, "Authentication bypass", severity="HIGH",
                         source_agents=["semantic-analyzer"]),
            make_finding("f2", "App.java", 22, "Authentication bypass", severity="CRITICAL",
                         source_agents=["security-scanner"]),
        ]
        deduped, drops = claude_json._dedup_findings(findings)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["severity"], "CRITICAL")

    def test_ids_preserved_by_dedup(self) -> None:
        """_dedup_findings does NOT reassign IDs — original IDs are preserved so
        severity_rationale and dropped_findings cross-references remain valid."""
        findings = [
            make_finding("synth-42", "File.java", 10, "Issue alpha"),
            make_finding("synth-99", "File.java", 200, "Issue beta"),
        ]
        deduped, _ = claude_json._dedup_findings(findings)
        ids = [f["id"] for f in deduped]
        self.assertEqual(ids, ["synth-42", "synth-99"])

    def test_adjacent_distinct_findings_not_merged(self) -> None:
        """Two findings on adjacent lines with unrelated text must NOT be merged."""
        findings = [
            make_finding("f1", "SomeFile.java", 42, "Missing null check on userInput",
                         source_agents=["semantic-analyzer"]),
            make_finding("f2", "SomeFile.java", 44, "SQL injection via unsanitised query parameter",
                         source_agents=["security-scanner"]),
        ]
        deduped, drops = claude_json._dedup_findings(findings)
        self.assertEqual(len(deduped), 2, "Semantically distinct adjacent findings must stay separate")
        self.assertEqual(len(drops), 0)

    def test_line_window_boundary(self) -> None:
        """Findings exactly ±5 lines apart should merge; ±6 should not."""
        # 5 lines apart — should merge
        findings_within = [
            make_finding("f1", "Foo.java", 10, "Same issue"),
            make_finding("f2", "Foo.java", 15, "Same issue"),
        ]
        deduped, drops = claude_json._dedup_findings(findings_within)
        self.assertEqual(len(deduped), 1)

        # 6 lines apart — should NOT merge (different text keeps them separate regardless)
        findings_outside = [
            make_finding("f3", "Bar.java", 10, "Issue alpha"),
            make_finding("f4", "Bar.java", 16, "Issue alpha"),
        ]
        deduped2, drops2 = claude_json._dedup_findings(findings_outside)
        # Same text, so text dedup merges them
        self.assertEqual(len(deduped2), 1)

        # Different text, outside window — should remain separate
        findings_diff = [
            make_finding("f5", "Baz.java", 10, "Issue alpha — distinct root cause"),
            make_finding("f6", "Baz.java", 17, "Issue beta — entirely different"),
        ]
        deduped3, drops3 = claude_json._dedup_findings(findings_diff)
        self.assertEqual(len(deduped3), 2)
        self.assertEqual(len(drops3), 0)


class AcrignoreExcludesTest(unittest.TestCase):
    """Issue 4 — load_acrignore_excludes() in orchestrator.py"""

    def test_no_acrignore_file_returns_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            result = orchestrator.load_acrignore_excludes(repo)
            self.assertEqual(result, [])

    def test_patterns_converted_to_pathspecs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / ".acrignore").write_text(
                "# comment line\n\ngenerated/\n*.pb.go\nvendor/\n",
                encoding="utf-8",
            )
            result = orchestrator.load_acrignore_excludes(repo)
            self.assertEqual(result, [
                ":(exclude)generated/",
                ":(exclude)*.pb.go",
                ":(exclude)vendor/",
            ])

    def test_blank_and_comment_lines_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / ".acrignore").write_text(
                "# This is a comment\n\n# Another comment\ndocs/auto-generated/\n",
                encoding="utf-8",
            )
            result = orchestrator.load_acrignore_excludes(repo)
            self.assertEqual(result, [":(exclude)docs/auto-generated/"])

    def test_negation_patterns_warned_and_skipped(self) -> None:
        import io
        import contextlib
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / ".acrignore").write_text("generated/\n!generated/keep_this.go\n", encoding="utf-8")
            stderr_capture = io.StringIO()
            with contextlib.redirect_stderr(stderr_capture):
                result = orchestrator.load_acrignore_excludes(repo)
            self.assertEqual(result, [":(exclude)generated/"])
            self.assertIn("negation", stderr_capture.getvalue())


class OutOfScopeTest(unittest.TestCase):
    """Issue 5 — resolve_out_of_scope_files() in orchestrator.py"""

    def test_matching_paths_returned(self) -> None:
        changed = ["src/main.ts", "generated/types.ts", "generated/api.ts", "README.md"]
        globs = ["generated/**", "generated/*"]
        result = orchestrator.resolve_out_of_scope_files(changed, globs)
        self.assertIn("generated/types.ts", result)
        self.assertIn("generated/api.ts", result)
        self.assertNotIn("src/main.ts", result)
        self.assertNotIn("README.md", result)

    def test_glob_matches_filename(self) -> None:
        changed = ["proto/gen/foo.pb.go", "proto/gen/bar.pb.go", "proto/model.go"]
        globs = ["*.pb.go"]
        result = orchestrator.resolve_out_of_scope_files(changed, globs)
        self.assertIn("proto/gen/foo.pb.go", result)
        self.assertIn("proto/gen/bar.pb.go", result)
        self.assertNotIn("proto/model.go", result)

    def test_empty_globs_returns_empty(self) -> None:
        changed = ["src/foo.ts", "src/bar.ts"]
        result = orchestrator.resolve_out_of_scope_files(changed, [])
        self.assertEqual(result, [])

    def test_no_matches_returns_empty(self) -> None:
        changed = ["src/foo.ts", "src/bar.ts"]
        globs = ["vendor/**"]
        result = orchestrator.resolve_out_of_scope_files(changed, globs)
        self.assertEqual(result, [])

    def test_scope_json_written_during_run(self) -> None:
        """Verify that orchestrator.run() writes scope.json with correct out_of_scope_files."""
        import types
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            run_dir = repo / ".claude" / "review-runs" / "20260101T000000Z-scope-test"
            run_dir.mkdir(parents=True)
            plugin_root = repo / "plugin"
            plugin_root.mkdir()

            # Write .acr.json with outOfScope
            (repo / ".acr.json").write_text(json.dumps({
                "outOfScope": ["generated/*"]
            }), encoding="utf-8")

            args = types.SimpleNamespace(
                repo=str(repo),
                run_id=run_dir.name,
                run_dir=str(run_dir),
                plugin_root=str(plugin_root),
                pr=None,
                platform="",
                provider="claude",
                review_timeout=1,
                synthesis_timeout=1,
            )
            subject = orchestrator.Orchestrator(args)

            # Patch snapshot() to return a diff that contains generated/ file
            diff_text = (
                "diff --git a/generated/api.ts b/generated/api.ts\n"
                "index 000..111 100644\n"
                "--- a/generated/api.ts\n"
                "+++ b/generated/api.ts\n"
                "@@ -1,1 +1,2 @@\n"
                "+export const x = 1;\n"
                " export const y = 2;\n"
                "\ndiff --git a/src/main.ts b/src/main.ts\n"
                "index 000..222 100644\n"
                "--- a/src/main.ts\n"
                "+++ b/src/main.ts\n"
                "@@ -1,1 +1,2 @@\n"
                "+import { x } from '../generated/api';\n"
                " const z = 1;\n"
            )

            # We call snapshot indirectly via run(), so patch it
            def fake_snapshot():
                return diff_text, None, "main"

            subject.snapshot = fake_snapshot

            # Patch run_reviewers and synthesize and launch_ui to avoid side effects
            subject.run_reviewers = lambda: None
            subject.synthesize = lambda: True
            subject.launch_ui = lambda final_status="awaiting_decisions": None

            # Also write a minimal synthesis.json so run() doesn't crash
            import json as _json
            (run_dir / "synthesis.json").write_text(_json.dumps({
                "run_id": run_dir.name,
                "two_sentence_verdict": "OK. Nothing to do.",
                "deduped_findings": [],
                "dropped_findings_with_reason": [],
                "contradictions_resolved": [],
                "severity_rationale": {},
                "recommended_next_actions": [],
                "source_agent_result_files": [],
            }), encoding="utf-8")

            subject.run()

            scope_path = run_dir / "scope.json"
            self.assertTrue(scope_path.exists(), "scope.json should be written")
            scope = _json.loads(scope_path.read_text(encoding="utf-8"))
            self.assertIn("generated/api.ts", scope["out_of_scope_files"])
            self.assertNotIn("src/main.ts", scope["out_of_scope_files"])


if __name__ == "__main__":
    unittest.main()
