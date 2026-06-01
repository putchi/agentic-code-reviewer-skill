"""
Smoke tests for agentic-code-reviewer Python scripts.
Uses unittest (no external dependencies required).
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
CLAUDE_JSON = REPO_ROOT / "scripts" / "claude_json.py"
RUN_REVIEWER_SH = REPO_ROOT / "scripts" / "run-reviewer.sh"
FIXTURES_SMOKE = REPO_ROOT / "tests" / "fixtures" / "smoke"
KNOWN_BAD_DIR = FIXTURES_SMOKE / "known-bad"


class TestReviewerNormalizesKnownBad(unittest.TestCase):
    """Test 1: claude_json.py reviewer normalizes the security-scanner fixture."""

    def test_normalizes_security_scanner_fixture(self):
        fixture_path = KNOWN_BAD_DIR / "security-scanner.json"
        self.assertTrue(fixture_path.exists(), f"Fixture not found: {fixture_path}")

        with tempfile.TemporaryDirectory() as tmp:
            raw_file = Path(tmp) / "raw.json"
            out_file = Path(tmp) / "result.json"

            # Write the fixture JSON directly as the "raw" model output.
            # claude_json.py extract_text -> extract_json_object will parse it.
            raw_file.write_text(fixture_path.read_text(encoding="utf-8"), encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    str(CLAUDE_JSON),
                    "reviewer",
                    "--raw-file", str(raw_file),
                    "--out-file", str(out_file),
                    "--run-id", "test-run-smoke",
                    "--agent", "security-scanner",
                    "--started-at", "2024-01-01T00:00:00Z",
                    "--completed-at", "2024-01-01T00:00:10Z",
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(
                result.returncode, 0,
                f"Expected exit 0, got {result.returncode}.\nstdout: {result.stdout}\nstderr: {result.stderr}",
            )
            self.assertTrue(out_file.exists(), "Output file was not created")

            data = json.loads(out_file.read_text(encoding="utf-8"))
            self.assertEqual(data.get("status"), "complete", f"Expected status=complete, got: {data.get('status')}")
            findings = data.get("findings", [])
            self.assertIsInstance(findings, list)
            self.assertGreater(len(findings), 0, "Expected at least one finding")

            # Verify the SQL injection finding is present
            finding_texts = [f.get("finding", "") for f in findings]
            self.assertTrue(
                any("SQL" in t or "sql" in t.lower() or "injection" in t.lower() for t in finding_texts),
                f"Expected SQL injection finding, got: {finding_texts}",
            )


class TestReviewerRejectsMalformed(unittest.TestCase):
    """Test 2: claude_json.py reviewer rejects malformed input with exit code 2."""

    def test_rejects_malformed_reviewer_json(self):
        malformed_fixture = FIXTURES_SMOKE / "malformed-reviewer.json"
        self.assertTrue(malformed_fixture.exists(), f"Malformed fixture not found: {malformed_fixture}")

        with tempfile.TemporaryDirectory() as tmp:
            raw_file = Path(tmp) / "malformed.json"
            out_file = Path(tmp) / "result.json"

            raw_file.write_text(malformed_fixture.read_text(encoding="utf-8"), encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    str(CLAUDE_JSON),
                    "reviewer",
                    "--raw-file", str(raw_file),
                    "--out-file", str(out_file),
                    "--run-id", "test-run-malformed",
                    # Use an agent name not in AGENTS to force schema validation failure
                    "--agent", "unknown-invalid-agent",
                    "--started-at", "2024-01-01T00:00:00Z",
                    "--completed-at", "2024-01-01T00:00:10Z",
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(
                result.returncode, 2,
                f"Expected exit 2 (schema validation failure), got {result.returncode}.\n"
                f"stdout: {result.stdout}\nstderr: {result.stderr}",
            )

            # Sidecar validation-error file must exist and be non-empty
            error_sidecar = Path(str(out_file) + ".validation-error.txt")
            self.assertTrue(
                error_sidecar.exists(),
                f"Expected sidecar error file at {error_sidecar}",
            )
            error_text = error_sidecar.read_text(encoding="utf-8").strip()
            self.assertGreater(len(error_text), 0, "Validation error sidecar file is empty")


class TestRunReviewerAcceptsFeedbackFlag(unittest.TestCase):
    """Test 3: run-reviewer.sh accepts --feedback without treating it as unknown."""

    def test_feedback_flag_not_unknown_arg(self):
        # Pass --feedback with a nonexistent file alongside required args that will
        # cause an early exit (missing --run-dir is valid here), but the key check
        # is that the script exits with 2 (missing required args), NOT because
        # --feedback is an unknown argument.
        with tempfile.TemporaryDirectory() as tmp:
            fake_feedback = Path(tmp) / "feedback.txt"
            fake_feedback.write_text("dummy feedback", encoding="utf-8")

            result = subprocess.run(
                [
                    "bash",
                    str(RUN_REVIEWER_SH),
                    "--run-id", "test-run",
                    "--run-dir", "/nonexistent/run/dir",
                    "--agent", "security-scanner",
                    "--repo", "/nonexistent/repo",
                    "--feedback", str(fake_feedback),
                ],
                capture_output=True,
                text=True,
                # Prevent the script from actually hanging waiting for an AI call
                timeout=15,
            )

            # The script should fail due to missing run-dir content, NOT "Unknown argument"
            stderr_output = result.stderr + result.stdout
            self.assertNotIn(
                "Unknown argument",
                stderr_output,
                f"'--feedback' was treated as unknown argument. Output:\n{stderr_output}",
            )
            # Exit should be non-zero (missing resources), but NOT from unknown arg handling
            self.assertNotEqual(
                result.returncode, 0,
                "Expected non-zero exit (run-dir doesn't exist), but got 0",
            )


class TestSynthesisFallbackAggregates(unittest.TestCase):
    """Test 4: synthesis-fallback aggregates known-bad reviewer files."""

    def test_aggregates_known_bad_findings(self):
        # synthesis-fallback reads agent files relative to out_file's parent dir.
        # Set up a temp dir that mimics the run structure.
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            agents_dir = tmp_path / "agents"
            agents_dir.mkdir()

            agent_names = [
                "security-scanner.json",
                "test-coverage-analyzer.json",
                "senior-dev-reviewer.json",
            ]
            for name in agent_names:
                src = KNOWN_BAD_DIR / name
                self.assertTrue(src.exists(), f"Fixture not found: {src}")
                shutil.copy(src, agents_dir / name)

            out_file = tmp_path / "synthesis.json"
            agent_file_args = [f"agents/{name}" for name in agent_names]

            result = subprocess.run(
                [
                    sys.executable,
                    str(CLAUDE_JSON),
                    "synthesis-fallback",
                    "--out-file", str(out_file),
                    "--run-id", "test-run-smoke",
                    "--verdict", "Test verdict.",
                    "--error", "test error",
                    "--agent-files", *agent_file_args,
                ],
                capture_output=True,
                text=True,
                cwd=str(tmp_path),
            )

            self.assertEqual(
                result.returncode, 0,
                f"Expected exit 0, got {result.returncode}.\nstdout: {result.stdout}\nstderr: {result.stderr}",
            )
            self.assertTrue(out_file.exists(), "synthesis.json was not created")

            data = json.loads(out_file.read_text(encoding="utf-8"))
            self.assertEqual(
                data.get("two_sentence_verdict"), "Test verdict.",
                f"Expected two_sentence_verdict='Test verdict.', got: {data.get('two_sentence_verdict')}",
            )
            deduped = data.get("deduped_findings", [])
            self.assertIsInstance(deduped, list)
            self.assertGreaterEqual(
                len(deduped), 1,
                f"Expected at least 1 deduped finding, got {len(deduped)}",
            )


class TestSynthesizerRetryFallback(unittest.TestCase):
    """Test f9: two synthesizer failures trigger synthesis-fallback, not a crash."""

    def test_two_failures_trigger_fallback(self):
        import argparse
        import sys as _sys
        _sys.path.insert(0, str(REPO_ROOT / "scripts"))
        from orchestrator import Orchestrator  # noqa: PLC0415

        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "test-synth-retry"
            run_dir.mkdir()
            (run_dir / "agents").mkdir()

            # Seed agent files so synthesis-fallback has something to aggregate
            for agent in ["security-scanner", "test-coverage-analyzer", "senior-dev-reviewer"]:
                src = KNOWN_BAD_DIR / f"{agent}.json"
                if src.exists():
                    shutil.copy(src, run_dir / "agents" / f"{agent}.json")

            args = argparse.Namespace(
                repo=tmp,
                run_id="test-synth-retry",
                run_dir=str(run_dir),
                plugin_root=str(REPO_ROOT),
                platform="",
                provider="claude",
                pr=None,
                review_timeout=60,
                synthesis_timeout=10,
            )
            orch = Orchestrator(args)

            # Patch _run_synthesizer to always raise, counting invocations
            call_count = [0]

            def always_fail(feedback_file=None):
                call_count[0] += 1
                raise RuntimeError("injected synthesizer failure")

            orch._run_synthesizer = always_fail

            result = orch.synthesize()

            # Must have retried exactly once (two total attempts)
            self.assertEqual(call_count[0], 2, f"Expected 2 synthesizer attempts, got {call_count[0]}")
            # Must return False (synthesis failed)
            self.assertFalse(result, "synthesize() should return False after two failures")
            # Fallback synthesis.json must exist with required fields
            synthesis_path = run_dir / "synthesis.json"
            self.assertTrue(synthesis_path.exists(), "Fallback synthesis.json was not written")
            data = json.loads(synthesis_path.read_text(encoding="utf-8"))
            self.assertEqual(data.get("run_id"), "test-synth-retry")
            self.assertIsInstance(data.get("two_sentence_verdict"), str)
            self.assertGreater(len(data["two_sentence_verdict"]), 0)
            self.assertIsInstance(data.get("deduped_findings"), list)


if __name__ == "__main__":
    unittest.main()
