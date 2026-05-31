#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("review_resume", ROOT / "scripts" / "review-resume.py")
review_resume = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(review_resume)


class ReviewResumeTest(unittest.TestCase):
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
