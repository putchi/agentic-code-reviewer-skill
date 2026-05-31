#!/usr/bin/env python3
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("review_gate", ROOT / "scripts" / "review-gate.py")
review_gate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(review_gate)


class ReviewGateTest(unittest.TestCase):
    def test_classifies_actionable_decisions_as_block(self) -> None:
        decisions = {
            "findings": {
                "f1": {"action": "ignore"},
                "f2": {"action": "ask_claude_to_implement"},
            }
        }
        self.assertTrue(review_gate.has_actionable_decisions(decisions))
        self.assertEqual(review_gate.classify_final_decision(decisions), "block")

    def test_classifies_all_ignore_or_empty_as_allow(self) -> None:
        self.assertFalse(review_gate.has_actionable_decisions({"findings": {"f1": {"action": "ignore"}}}))
        self.assertEqual(review_gate.classify_final_decision({"findings": {"f1": {"action": "ignore"}}}), "allow")
        self.assertEqual(review_gate.classify_final_decision({"findings": {}}), "allow")
        self.assertEqual(review_gate.classify_final_decision(None), "allow")

    def test_newest_matching_run_uses_diff_hash_and_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp).resolve()
            runs = repo / ".claude" / "review-runs"
            stale = runs / "20260101T000000Z-stale"
            old = runs / "20260101T000001Z-old"
            new = runs / "20260101T000002Z-new"
            other_repo = runs / "20260101T000003Z-other"
            for path in (stale, old, new, other_repo):
                path.mkdir(parents=True)

            (stale / "run.json").write_text(json.dumps({
                "repo": str(repo),
                "diff_sha256": "different",
            }), encoding="utf-8")
            (old / "run.json").write_text(json.dumps({
                "repo": str(repo),
                "diff_sha256": "match",
            }), encoding="utf-8")
            (new / "run.json").write_text(json.dumps({
                "repo": str(repo),
                "diff_sha256": "match",
            }), encoding="utf-8")
            (other_repo / "run.json").write_text(json.dumps({
                "repo": "/tmp/not-this-repo",
                "diff_sha256": "match",
            }), encoding="utf-8")

            self.assertEqual(review_gate.newest_matching_run(repo, "match"), new)
            self.assertIsNone(review_gate.newest_matching_run(repo, "missing"))

    def test_codex_hook_event_uses_event_cwd(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            event_cwd = root / "repo"
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            event_cwd.mkdir()
            plugin_root.mkdir()
            seen: list[Path] = []
            original_git_root = review_gate.git_root
            try:
                def fake_git_root(cwd: Path) -> None:
                    seen.append(cwd)
                    return None

                review_gate.git_root = fake_git_root
                result = review_gate.run_gate(
                    json.dumps({
                        "hook_event_name": "Stop",
                        "session_id": "codex-session-cwd-test",
                        "cwd": str(event_cwd),
                    }),
                    plugin_root,
                    fallback_cwd,
                    0.1,
                    0.01,
                )
            finally:
                review_gate.git_root = original_git_root

            self.assertEqual(result, 0)
            self.assertEqual(seen, [event_cwd.resolve()])

    def test_claude_hook_event_uses_process_cwd_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "repo"
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            plugin_root.mkdir()
            seen: list[Path] = []
            original_git_root = review_gate.git_root
            try:
                def fake_git_root(cwd: Path) -> None:
                    seen.append(cwd)
                    return None

                review_gate.git_root = fake_git_root
                result = review_gate.run_gate(
                    json.dumps({"session_id": "claude-session-cwd-test"}),
                    plugin_root,
                    fallback_cwd,
                    0.1,
                    0.01,
                )
            finally:
                review_gate.git_root = original_git_root

            self.assertEqual(result, 0)
            self.assertEqual(seen, [fallback_cwd.resolve()])


if __name__ == "__main__":
    unittest.main()
