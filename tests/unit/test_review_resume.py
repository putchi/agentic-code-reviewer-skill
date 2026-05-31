#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("review_resume", ROOT / "scripts" / "review-resume.py")
review_resume = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(review_resume)


class ReviewResumeTest(unittest.TestCase):
    def test_write_post_resume_marker_records_run_diff_and_decisions_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            run_id = "20260531T125900Z-marker"
            run_dir = repo / ".claude" / "review-runs" / run_id
            run_dir.mkdir(parents=True)
            (run_dir / "run.json").write_text(json.dumps({
                "run_id": run_id,
                "repo": str(repo),
                "diff_sha256": "original-diff-sha",
            }), encoding="utf-8")
            (run_dir / "diff.txt").write_text(
                "diff --git a/scripts/review-gate.py b/scripts/review-gate.py\n",
                encoding="utf-8",
            )
            decisions = {
                "run_id": run_id,
                "findings": {
                    "f1": {"action": "ask_claude_to_implement"},
                    "f2": {"action": "ignore"},
                },
            }

            marker_path = review_resume.write_post_resume_marker(
                repo,
                run_dir,
                decisions,
                now=datetime(2026, 5, 31, 12, 59, tzinfo=timezone.utc),
                tmp_dir=marker_tmp,
            )

            self.assertEqual(marker_path, review_resume.post_resume_marker_path(repo, run_id, marker_tmp))
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
            self.assertEqual(marker["repo"], str(repo))
            self.assertEqual(marker["run_id"], run_id)
            self.assertEqual(marker["original_diff_sha256"], "original-diff-sha")
            self.assertEqual(marker["original_diff_paths"], ["scripts/review-gate.py"])
            self.assertEqual(marker["decisions_sha256"], review_resume.canonical_json_sha256(decisions))
            self.assertEqual(marker["suppression_mode"], "implementation")
            self.assertEqual(marker["created_at"], "2026-05-31T12:59:00Z")
            self.assertEqual(marker["expires_at"], "2026-06-01T12:59:00Z")

    def test_write_post_resume_marker_skips_ignore_only_decisions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            run_id = "20260531T130000Z-ignore"
            run_dir = repo / ".claude" / "review-runs" / run_id
            run_dir.mkdir(parents=True)
            (run_dir / "run.json").write_text(json.dumps({
                "run_id": run_id,
                "repo": str(repo),
                "diff_sha256": "original-diff-sha",
            }), encoding="utf-8")
            decisions = {
                "run_id": run_id,
                "findings": {"f1": {"action": "ignore"}},
            }

            marker_path = review_resume.write_post_resume_marker(repo, run_dir, decisions, tmp_dir=marker_tmp)

            self.assertIsNone(marker_path)
            self.assertEqual(list(marker_tmp.glob("*.json")), [])

    def test_write_post_resume_marker_scopes_non_code_follow_up_to_same_diff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            run_id = "20260531T130100Z-explain"
            run_dir = repo / ".claude" / "review-runs" / run_id
            run_dir.mkdir(parents=True)
            (run_dir / "run.json").write_text(json.dumps({
                "run_id": run_id,
                "repo": str(repo),
                "diff_sha256": "original-diff-sha",
            }), encoding="utf-8")
            decisions = {
                "run_id": run_id,
                "findings": {"f1": {"action": "ask_claude_to_explain"}},
            }

            marker_path = review_resume.write_post_resume_marker(repo, run_dir, decisions, tmp_dir=marker_tmp)

            marker = json.loads(marker_path.read_text(encoding="utf-8"))
            self.assertEqual(marker["suppression_mode"], "same_diff")

    def test_post_resume_marker_path_is_run_scoped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = (Path(tmp) / "repo").resolve()
            marker_tmp = Path(tmp) / "tmp"

            first = review_resume.post_resume_marker_path(repo, "20260531T130200Z-first", marker_tmp)
            second = review_resume.post_resume_marker_path(repo, "20260531T130201Z-second", marker_tmp)

            self.assertNotEqual(first, second)
            self.assertEqual(first.parent, marker_tmp)
            self.assertEqual(second.parent, marker_tmp)

    def test_resume_output_uses_readable_labels_for_persisted_action_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            run_id = "20260531T130000Z-readable-labels"
            run_dir = repo / ".claude" / "review-runs" / run_id
            run_dir.mkdir(parents=True)
            (run_dir / "synthesis.json").write_text(json.dumps({
                "deduped_findings": [
                    {"id": "implement", "location": "src/app.ts:10", "finding": "Implement finding"},
                    {"id": "accept", "location": "src/app.ts:20", "finding": "Accept finding"},
                    {"id": "explain", "location": "src/app.ts:30", "finding": "Explain finding"},
                    {"id": "follow-up", "location": "src/app.ts:40", "finding": "Follow-up finding"},
                    {"id": "ignored", "location": "src/app.ts:50", "finding": "Ignored finding"},
                ],
            }), encoding="utf-8")
            decisions = {
                "run_id": run_id,
                "decided_at": "2026-05-31T13:00:00Z",
                "findings": {
                    "implement": {"action": "ask_claude_to_implement"},
                    "accept": {"action": "accept_fix"},
                    "explain": {"action": "ask_claude_to_explain"},
                    "follow-up": {"action": "create_follow_up_task"},
                    "ignored": {"action": "ignore"},
                },
            }
            (run_dir / "decisions.json").write_text(json.dumps(decisions), encoding="utf-8")

            stdout = io.StringIO()
            original_argv = sys.argv
            try:
                sys.argv = ["review-resume.py", "--repo", str(repo), "--run-id", run_id]
                with contextlib.redirect_stdout(stdout):
                    result = review_resume.main()
            finally:
                sys.argv = original_argv

            output = stdout.getvalue()
            self.assertEqual(result, 0)
            self.assertEqual(decisions["findings"]["implement"]["action"], "ask_claude_to_implement")
            self.assertIn("ask host agent to implement (1): implement", output)
            self.assertIn("accept fix (1): accept", output)
            self.assertIn("ask host agent to explain (1): explain", output)
            self.assertIn("create follow-up task (1): follow-up", output)
            self.assertIn("### implement — ask host agent to implement", output)
            self.assertIn("### ignored — ignore", output)
            self.assertNotIn("ask_claude_to_", output)
            self.assertNotIn("accept_fix", output)
            self.assertNotIn("create_follow_up_task", output)


if __name__ == "__main__":
    unittest.main()
