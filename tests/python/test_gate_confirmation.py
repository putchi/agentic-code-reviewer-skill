"""
Unit tests for the Stop-hook confirmation state machine in review-gate.py:
response classification, marker lifecycle, and one-time response claims.
"""

import importlib.util
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent

spec = importlib.util.spec_from_file_location("review_gate", REPO_ROOT / "scripts" / "review-gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class TestClassifyConfirmationResponse(unittest.TestCase):
    def test_affirmatives(self):
        for prompt in ["yes", "y", "YES", " Yes ", '"yes"', "y, go ahead", "yes please"]:
            self.assertEqual(gate.classify_confirmation_response(prompt), "yes", prompt)

    def test_negatives(self):
        for prompt in ["no", "n", "skip", "No thanks", "skip this one"]:
            self.assertEqual(gate.classify_confirmation_response(prompt), "no", prompt)

    def test_unrelated_messages_are_none(self):
        for prompt in [None, "", "fix the login bug", "yesterday's diff", "nope-adjacent", "not now"]:
            self.assertIsNone(gate.classify_confirmation_response(prompt), repr(prompt))

    def test_yes_prefix_of_longer_word_is_not_yes(self):
        # "yesterday" must not read as yes; "no" inside "note" must not read as no
        self.assertIsNone(gate.classify_confirmation_response("yesterday"))
        self.assertIsNone(gate.classify_confirmation_response("note this down"))


class TestConfirmationMarkerLifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self.tmp.name)
        self.repo = Path("/some/repo")
        self.session = "sess-1"
        self.diff = "diff --git a/x b/x\n+1\n"
        self.sha = gate.diff_sha256(self.diff)

    def tearDown(self):
        self.tmp.cleanup()

    def test_write_then_load_roundtrip(self):
        gate.write_confirmation_marker(self.repo, self.session, self.sha, self.diff, tmp_dir=self.tmp_dir)
        entry = gate.load_confirmation_marker(self.repo, self.session, tmp_dir=self.tmp_dir)
        self.assertIsNotNone(entry)
        _, marker = entry
        self.assertEqual(marker["diff_sha256"], self.sha)
        self.assertEqual(marker["repo"], str(self.repo))

    def test_marker_for_other_session_not_returned(self):
        gate.write_confirmation_marker(self.repo, self.session, self.sha, self.diff, tmp_dir=self.tmp_dir)
        self.assertIsNone(gate.load_confirmation_marker(self.repo, "other-session", tmp_dir=self.tmp_dir))

    def test_expired_marker_is_discarded(self):
        path = gate.write_confirmation_marker(self.repo, self.session, self.sha, self.diff, tmp_dir=self.tmp_dir)
        marker = gate.read_json(path)
        marker["expires_at"] = "2000-01-01T00:00:00Z"
        gate.write_json(path, marker)
        self.assertIsNone(gate.load_confirmation_marker(self.repo, self.session, tmp_dir=self.tmp_dir))
        self.assertFalse(path.exists(), "expired marker should be deleted")


class TestClaimConfirmationResponse(unittest.TestCase):
    def test_claim_is_one_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Route the claim markers into the temp dir by monkeypatching the path helper
            original = gate.confirmation_response_marker_path
            gate.confirmation_response_marker_path = (
                lambda repo, session_id, sha, key, tmp_dir=Path(tmp): original(repo, session_id, sha, key, Path(tmp))
            )
            try:
                repo, session, sha = Path("/some/repo"), "sess-1", "a" * 64
                first = gate.claim_confirmation_response(repo, session, sha, "yes")
                second = gate.claim_confirmation_response(repo, session, sha, "yes")
                self.assertTrue(first, "first claim must succeed")
                self.assertFalse(second, "second claim of same response must fail (no double-fire)")
                # A different response key is an independent claim
                self.assertTrue(gate.claim_confirmation_response(repo, session, sha, "no"))
            finally:
                gate.confirmation_response_marker_path = original


if __name__ == "__main__":
    unittest.main()
