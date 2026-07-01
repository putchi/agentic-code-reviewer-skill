"""
Unit tests for the strict finding-validation rules in claude_json.py
(evidence/confidence/line/file requirements, diff cross-check, verdict
consistency) and the review-gate skip counter.
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
CLAUDE_JSON = REPO_ROOT / "scripts" / "claude_json.py"

sys.path.insert(0, str(REPO_ROOT / "scripts"))
claude_json = __import__("claude_json")

DIFF = """diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,4 @@
+const x = 1;
"""


def good_finding(**overrides):
    finding = {
        "id": "semantic-analyzer-1",
        "severity": "HIGH",
        "file": "src/example.ts",
        "line": 1,
        "finding": "t",
        "reasoning": "r",
        "evidence": "const x = 1;",
        "confidence": 85,
    }
    finding.update(overrides)
    return finding


class TestDiffFileSet(unittest.TestCase):
    def test_extracts_paths(self):
        self.assertEqual(claude_json.diff_file_set(DIFF), {"src/example.ts"})

    def test_ignores_dev_null(self):
        diff = "--- a/x.py\n+++ /dev/null\n"
        self.assertNotIn("/dev/null", claude_json.diff_file_set(diff))


class TestNormalizeFindingValidation(unittest.TestCase):
    def check(self, finding, diff_files=None):
        errors, warnings = [], []
        normalized = claude_json.normalize_finding(finding, "semantic-analyzer", 0, diff_files, errors, warnings)
        return normalized, errors, warnings

    def test_valid_finding_produces_no_errors(self):
        _, errors, warnings = self.check(good_finding(), {"src/example.ts"})
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_missing_confidence_is_error(self):
        f = good_finding()
        del f["confidence"]
        _, errors, _ = self.check(f)
        self.assertTrue(any("confidence" in e for e in errors))

    def test_confidence_clamped(self):
        normalized, errors, _ = self.check(good_finding(confidence=150))
        self.assertEqual(normalized["confidence"], 100)
        self.assertEqual(errors, [])

    def test_zero_line_is_error(self):
        _, errors, _ = self.check(good_finding(line=0))
        self.assertTrue(any("line" in e for e in errors))

    def test_empty_evidence_is_error(self):
        _, errors, _ = self.check(good_finding(evidence="  "))
        self.assertTrue(any("evidence" in e for e in errors))

    def test_empty_file_is_error(self):
        _, errors, _ = self.check(good_finding(file=""))
        self.assertTrue(any("file" in e for e in errors))

    def test_file_not_in_diff_is_error(self):
        _, errors, _ = self.check(good_finding(file="other.ts"), {"src/example.ts"})
        self.assertTrue(any("does not appear" in e for e in errors))

    def test_unknown_severity_coerced_with_warning(self):
        normalized, errors, warnings = self.check(good_finding(severity="MEDIUM"))
        self.assertEqual(normalized["severity"], "HIGH")
        self.assertEqual(errors, [])
        self.assertTrue(any("coerced" in w for w in warnings))


class TestReviewerCLIValidation(unittest.TestCase):
    def run_reviewer(self, payload, diff_text=DIFF):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            raw = tmp_path / "raw.json"
            out = tmp_path / "out.json"
            diff = tmp_path / "diff.txt"
            raw.write_text(json.dumps(payload), encoding="utf-8")
            diff.write_text(diff_text, encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, str(CLAUDE_JSON), "reviewer",
                 "--raw-file", str(raw), "--out-file", str(out),
                 "--run-id", "run1", "--agent", "semantic-analyzer",
                 "--started-at", "s", "--completed-at", "c",
                 "--diff-file", str(diff)],
                capture_output=True, text=True,
            )
            sidecar = out.with_name(out.name + ".validation-error.txt")
            result = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
            sidecar_text = sidecar.read_text(encoding="utf-8") if sidecar.exists() else None
            return proc.returncode, result, sidecar_text

    def test_valid_result_passes(self):
        rc, result, sidecar = self.run_reviewer({"status": "complete", "findings": [good_finding()]})
        self.assertEqual(rc, 0)
        self.assertEqual(result["status"], "complete")
        self.assertIsNone(sidecar)

    def test_missing_confidence_fails_with_sidecar(self):
        f = good_finding()
        del f["confidence"]
        rc, result, sidecar = self.run_reviewer({"status": "complete", "findings": [f]})
        self.assertEqual(rc, 2)
        self.assertEqual(result["status"], "failed")
        self.assertIn("confidence", sidecar)

    def test_file_outside_diff_fails(self):
        rc, result, sidecar = self.run_reviewer({"status": "complete", "findings": [good_finding(file="nope.ts")]})
        self.assertEqual(rc, 2)
        self.assertIn("does not appear", sidecar)

    def test_empty_findings_still_valid(self):
        rc, result, sidecar = self.run_reviewer({"status": "complete", "findings": []})
        self.assertEqual(rc, 0)
        self.assertEqual(result["findings"], [])
        self.assertIsNone(sidecar)


class TestSynthesisVerdictConsistency(unittest.TestCase):
    def run_synthesis(self, payload):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            raw = tmp_path / "raw.json"
            out = tmp_path / "synthesis.json"
            sidecar = tmp_path / "synthesis.json.validation-error.txt"
            raw.write_text(json.dumps(payload), encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, str(CLAUDE_JSON), "synthesis",
                 "--raw-file", str(raw), "--out-file", str(out), "--run-id", "run1"],
                capture_output=True, text=True,
            )
            # Capture state before the temp dir is deleted
            sidecar_text = sidecar.read_text(encoding="utf-8") if sidecar.exists() else None
            return proc.returncode, out.exists(), sidecar_text

    def test_ship_ready_with_critical_fails(self):
        rc, out_exists, sidecar_text = self.run_synthesis({
            "two_sentence_verdict": "This diff is fit to ship as-is. Nothing to fix.",
            "deduped_findings": [{
                "id": "f1", "severity": "CRITICAL", "file": "a.ts", "line": 1,
                "finding": "t", "reasoning": "r", "evidence": "e", "source_agents": [],
            }],
        })
        self.assertEqual(rc, 1)
        self.assertFalse(out_exists)
        self.assertIn("CRITICAL", sidecar_text or "")

    def test_consistent_verdict_passes(self):
        rc, out_exists, sidecar_text = self.run_synthesis({
            "two_sentence_verdict": "Needs rework before shipping. Fix the CRITICAL issue in a.ts first.",
            "deduped_findings": [{
                "id": "f1", "severity": "CRITICAL", "file": "a.ts", "line": 1,
                "finding": "t", "reasoning": "r", "evidence": "e", "source_agents": [],
            }],
        })
        self.assertEqual(rc, 0)
        self.assertTrue(out_exists)
        self.assertIsNone(sidecar_text)


class TestSkipCounter(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(REPO_ROOT / "scripts"))
        # review-gate.py has a dash; import via importlib
        import importlib.util
        spec = importlib.util.spec_from_file_location("review_gate", REPO_ROOT / "scripts" / "review-gate.py")
        self.gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.gate)

    def test_increment_and_reset(self):
        import os
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ACR_SETTINGS_DIR"] = tmp
            try:
                repo = Path("/some/repo")
                plugin_root = REPO_ROOT
                self.assertEqual(self.gate.read_skip_count(plugin_root, repo), 0)
                self.assertEqual(self.gate.update_skip_count(plugin_root, repo, skipped=True), 1)
                self.assertEqual(self.gate.update_skip_count(plugin_root, repo, skipped=True), 2)
                self.assertEqual(self.gate.read_skip_count(plugin_root, repo), 2)
                self.assertEqual(self.gate.update_skip_count(plugin_root, repo, skipped=False), 0)
                self.assertEqual(self.gate.read_skip_count(plugin_root, repo), 0)
            finally:
                del os.environ["ACR_SETTINGS_DIR"]


if __name__ == "__main__":
    unittest.main()
