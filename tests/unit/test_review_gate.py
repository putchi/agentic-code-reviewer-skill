#!/usr/bin/env python3
from __future__ import annotations
import contextlib
import importlib.util
import io
import json
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("review_gate", ROOT / "scripts" / "review-gate.py")
review_gate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(review_gate)


class ReviewGateTest(unittest.TestCase):
    @contextlib.contextmanager
    def stop_hook_mode(self, mode: str):
        original = review_gate.os.environ.get("ACR_STOP_HOOK_MODE")
        try:
            review_gate.os.environ["ACR_STOP_HOOK_MODE"] = mode
            yield
        finally:
            if original is None:
                review_gate.os.environ.pop("ACR_STOP_HOOK_MODE", None)
            else:
                review_gate.os.environ["ACR_STOP_HOOK_MODE"] = original

    @contextlib.contextmanager
    def settings_dir(self, path: Path):
        original = review_gate.os.environ.get("ACR_SETTINGS_DIR")
        try:
            review_gate.os.environ["ACR_SETTINGS_DIR"] = str(path)
            yield
        finally:
            if original is None:
                review_gate.os.environ.pop("ACR_SETTINGS_DIR", None)
            else:
                review_gate.os.environ["ACR_SETTINGS_DIR"] = original

    def write_run(self, run_dir: Path, status: str, run_id: str | None = None) -> None:
        (run_dir / "run.json").write_text(json.dumps({
            "run_id": run_id or run_dir.name,
            "status": status,
            "agents": review_gate.EXPECTED_AGENTS,
        }), encoding="utf-8")

    def write_agent(self, run_dir: Path, agent: str, status: str, finding_count: int = 0) -> None:
        agents_dir = run_dir / "agents"
        agents_dir.mkdir(exist_ok=True)
        (agents_dir / f"{agent}.json").write_text(json.dumps({
            "run_id": run_dir.name,
            "agent": agent,
            "status": status,
            "findings": [{"id": f"{agent}-{idx}"} for idx in range(finding_count)],
        }), encoding="utf-8")

    def capture_json_stdout(self, fn, *args):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            fn(*args)
        return json.loads(stdout.getvalue())

    def write_review_run(
        self,
        repo: Path,
        run_id: str,
        diff_sha: str,
        decisions: dict,
        status: str = "decisions_ready",
        diff_text: str | None = None,
    ) -> Path:
        run_dir = repo / ".claude" / "review-runs" / run_id
        run_dir.mkdir(parents=True)
        (run_dir / "run.json").write_text(json.dumps({
            "run_id": run_id,
            "repo": str(repo),
            "status": status,
            "diff_sha256": diff_sha,
            "agents": review_gate.EXPECTED_AGENTS,
        }), encoding="utf-8")
        (run_dir / "decisions.json").write_text(json.dumps(decisions), encoding="utf-8")
        (run_dir / "diff.txt").write_text(
            diff_text or "diff --git a/src/app.py b/src/app.py\n",
            encoding="utf-8",
        )
        return run_dir

    def write_post_resume_marker(
        self,
        repo: Path,
        run_dir: Path,
        decisions: dict,
        tmp_dir: Path,
        expires_at: str = "2030-01-01T00:00:00Z",
        decisions_sha: str | None = None,
        original_diff_sha: str | None = None,
        original_paths: list[str] | None = None,
        suppression_mode: str = "implementation",
    ) -> Path:
        run = review_gate.read_json(run_dir / "run.json") or {}
        marker = {
            "schema_version": 1,
            "repo": str(repo),
            "run_id": run_dir.name,
            "original_diff_sha256": original_diff_sha or str(run.get("diff_sha256")),
            "original_diff_paths": original_paths or ["src/app.py"],
            "decisions_sha256": decisions_sha or review_gate.canonical_json_sha256(decisions),
            "suppression_mode": suppression_mode,
            "created_at": "2026-05-31T00:00:00Z",
            "expires_at": expires_at,
        }
        marker_path = review_gate.post_resume_marker_path(repo, run_dir.name, tmp_dir)
        review_gate.write_json(marker_path, marker)
        return marker_path

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

    def test_emit_block_reason_contains_complete_resume_instructions(self) -> None:
        with tempfile.TemporaryDirectory(prefix="acr long path ") as tmp:
            root = Path(tmp)
            repo = root / "repo with spaces and a long name for wrapping"
            plugin_root = root / "plugin root with spaces"
            run_id = "20260531T120000Z-review-run"
            run_dir = repo / ".claude" / "review-runs" / run_id
            decisions = {
                "findings": {
                    "implement": {"action": "ask_claude_to_implement"},
                    "accept": {"action": "accept_fix"},
                    "explain": {"action": "ask_claude_to_explain"},
                    "follow-up": {"action": "create_follow_up_task"},
                    "ignore": {"action": "ignore"},
                },
            }

            payload = self.capture_json_stdout(review_gate.emit_block, repo, run_dir, plugin_root, decisions)
            resume_script = plugin_root / "scripts" / "review-resume.sh"
            expected_cmd = (
                f"bash {shlex.quote(str(resume_script))} "
                f"--repo {shlex.quote(str(repo))} "
                f"--run-id {shlex.quote(run_id)}"
            )

            self.assertEqual(payload["decision"], "block")
            reason = payload["reason"]
            self.assertTrue(reason.startswith("ACR review complete:"), reason[:80])
            self.assertIn(expected_cmd, reason)
            self.assertIn(f"Script: {resume_script}", reason)
            self.assertIn(f"Repo: {repo}", reason)
            self.assertIn(f"Run ID: {run_id}", reason)
            self.assertIn("ask host agent to implement", reason)
            self.assertIn("accept fix", reason)
            self.assertIn("ask host agent to explain", reason)
            self.assertIn("create follow-up task", reason)
            self.assertNotIn("ask_claude_to_", reason)
            self.assertNotIn("accept_fix", reason)
            self.assertNotIn("create_follow_up_task", reason)
            self.assertNotIn("After the command prints the saved review instructions", reason)
            self.assertNotIn("Do not implement ignored/dismissed findings.", reason)

            system_message = payload["systemMessage"]
            self.assertIn("IMPORTANT:", system_message)
            self.assertIn("4 review decision(s) require follow-up.", system_message)
            self.assertIn(f"Script: {resume_script}", system_message)
            self.assertIn(f"Repo: {repo}", system_message)
            self.assertIn(f"Run ID: {run_id}", system_message)
            self.assertIn("Run this exact command now:", system_message)
            self.assertIn(expected_cmd, system_message)
            self.assertIn("Implement only findings", system_message)
            self.assertIn("Do not implement ignored/dismissed findings.", system_message)
            self.assertIn("ask host agent to implement", system_message)
            self.assertIn("accept fix", system_message)
            self.assertIn("ask host agent to explain", system_message)
            self.assertIn("create follow-up task", system_message)
            self.assertNotIn("ask_claude_to_", system_message)
            self.assertNotIn("accept_fix", system_message)
            self.assertNotIn("create_follow_up_task", system_message)

    def test_emit_prompt_stops_turn_with_user_confirmation_text(self) -> None:
        with tempfile.TemporaryDirectory(prefix="acr prompt ") as tmp:
            root = Path(tmp)
            repo = root / "repo with spaces"
            plugin_root = root / "plugin root with spaces"
            session_id = "session-with-changes"
            diff_sha = "abc123"
            diff_text = "diff --git a/src/app.py b/src/app.py\n"
            marker_path = review_gate.confirmation_marker_path(repo, session_id)

            try:
                payload = self.capture_json_stdout(
                    review_gate.emit_prompt,
                    repo,
                    plugin_root,
                    session_id,
                    diff_sha,
                    diff_text,
                )

                self.assertEqual(payload["continue"], False)
                reason = payload["stopReason"]
                self.assertTrue(reason.startswith("Agentic Code Reviewer is waiting for your confirmation."), reason[:80])
                self.assertIn("Reviewable code changes were detected.", reason)
                self.assertIn("Reply yes/y to run the review, or no/n/skip to skip this diff.", reason)
                self.assertNotIn("Default is no.", reason)
                self.assertNotIn(str(repo), reason)
                self.assertNotIn("Prompt marker", reason)
                self.assertTrue(marker_path.exists())
            finally:
                try:
                    marker_path.unlink()
                except FileNotFoundError:
                    pass

    def test_emit_launch_failure_reason_contains_manual_recovery_instructions(self) -> None:
        with tempfile.TemporaryDirectory(prefix="acr launch failure ") as tmp:
            root = Path(tmp)
            repo = root / "repo with spaces"
            plugin_root = root / "plugin root with spaces"
            message = "Failed to launch agentic review: provider unavailable"

            payload = self.capture_json_stdout(review_gate.emit_launch_failure, repo, plugin_root, message)
            script = plugin_root / "scripts" / "orchestrator.sh"
            resume_script = plugin_root / "scripts" / "review-resume.sh"
            expected_cmd = f"bash {shlex.quote(str(script))} --repo {shlex.quote(str(repo))}"
            expected_resume_cmd = (
                f"bash {shlex.quote(str(resume_script))} "
                f"--repo {shlex.quote(str(repo))} "
                "--run-id RUN_ID_FROM_REVIEW_OUTPUT"
            )

            self.assertEqual(payload["decision"], "block")
            reason = payload["reason"]
            self.assertTrue(reason.startswith("ACR error:"), reason[:80])
            self.assertIn(expected_cmd, reason)
            self.assertIn(expected_resume_cmd, reason)
            self.assertIn(f"Script: {script}", reason)
            self.assertIn(f"Resume Script: {resume_script}", reason)
            self.assertIn(f"Repo: {repo}", reason)
            self.assertIn("ask host agent to implement", reason)
            self.assertIn("accept fix", reason)
            self.assertIn("ask host agent to explain", reason)
            self.assertIn("create follow-up task", reason)
            self.assertNotIn("ask_claude_to_", reason)
            self.assertNotIn("accept_fix", reason)
            self.assertNotIn("create_follow_up_task", reason)
            self.assertIn(message, reason)

            system_message = payload["systemMessage"]
            self.assertIn("IMPORTANT:", system_message)
            self.assertIn(f"Script: {script}", system_message)
            self.assertIn(f"Resume Script: {resume_script}", system_message)
            self.assertIn(f"Repo: {repo}", system_message)
            self.assertIn("Details:", system_message)
            self.assertIn(message, system_message)
            self.assertNotIn("Run this exact command", system_message)
            self.assertNotIn("Implement only findings", system_message)

    def test_formats_heartbeat_for_review_phases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "20260531T100000Z-heartbeat"
            run_dir.mkdir()
            first_agent = review_gate.EXPECTED_AGENTS[0]
            second_agent = review_gate.EXPECTED_AGENTS[1]

            cases = [
                ("reviewer-running", "reviewers_running", {}, False, [
                    "phase=reviewers_running",
                    f"active_reviewers={','.join(review_gate.EXPECTED_AGENTS)}",
                    "completed=0",
                    "failed=0",
                    "raw_findings=0",
                    "waiting_for_ui_decision=no",
                ]),
                ("partial-complete", "reviewers_running", {first_agent: ("complete", 2)}, False, [
                    "phase=reviewers_running",
                    "completed=1",
                    "failed=0",
                    "raw_findings=2",
                ]),
                ("failed-reviewer", "reviewers_running", {first_agent: ("failed", 0)}, False, [
                    "phase=reviewers_running",
                    "completed=0",
                    "failed=1",
                    "raw_findings=0",
                ]),
                ("synthesizing", "synthesizing", {
                    first_agent: ("complete", 1),
                    second_agent: ("failed", 0),
                }, False, [
                    "phase=synthesizing",
                    "active_reviewers=none",
                    "completed=1",
                    "failed=1",
                    "raw_findings=1",
                ]),
                ("ui-ready", "awaiting_decisions", {first_agent: ("complete", 1)}, False, [
                    "phase=awaiting_decisions",
                    "active_reviewers=none",
                    "waiting_for_ui_decision=no",
                ]),
                ("decision-wait", "awaiting_decisions", {first_agent: ("complete", 1)}, True, [
                    "phase=awaiting_decisions",
                    "waiting_for_ui_decision=yes",
                ]),
            ]

            for name, status, agents, waiting, expected_parts in cases:
                with self.subTest(name=name):
                    for child in run_dir.glob("agents/*.json"):
                        child.unlink()
                    self.write_run(run_dir, status)
                    for agent, (agent_status, finding_count) in agents.items():
                        self.write_agent(run_dir, agent, agent_status, finding_count)
                    line = review_gate.format_gate_status(review_gate.gate_status_summary(run_dir, waiting))
                    self.assertIn(f"run={run_dir.name}", line)
                    for part in expected_parts:
                        self.assertIn(part, line)

    def test_heartbeat_writes_to_stderr_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "20260531T100001Z-stderr"
            run_dir.mkdir()
            self.write_run(run_dir, "reviewers_running")
            stdout = io.StringIO()
            stderr = io.StringIO()

            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                heartbeat = review_gate.GateHeartbeat(1)
                heartbeat.maybe_emit(run_dir, force=True)

            self.assertEqual(stdout.getvalue(), "")
            self.assertIn("agentic-code-reviewer:", stderr.getvalue())

    def test_heartbeat_can_be_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "20260531T100002Z-disabled"
            run_dir.mkdir()
            self.write_run(run_dir, "reviewers_running")
            stderr = io.StringIO()

            heartbeat = review_gate.GateHeartbeat(0, stream=stderr)
            heartbeat.maybe_emit(run_dir, force=True)

            self.assertEqual(stderr.getvalue(), "")

    def test_wait_for_ui_emits_progress_for_slow_fake_review(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "20260531T100003Z-slow"
            run_dir.mkdir()
            self.write_run(run_dir, "reviewers_running")
            stderr = io.StringIO()
            heartbeat = review_gate.GateHeartbeat(0.01, stream=stderr)

            def complete_review() -> None:
                time.sleep(0.03)
                self.write_agent(run_dir, review_gate.EXPECTED_AGENTS[0], "complete", 1)
                time.sleep(0.03)
                self.write_run(run_dir, "awaiting_decisions")
                (run_dir / "READY").touch()

            thread = threading.Thread(target=complete_review)
            thread.start()
            try:
                result = review_gate.wait_for_ui_or_terminal(run_dir, time.time() + 1, 0.01, heartbeat)
            finally:
                thread.join()

            self.assertEqual(result.get("status"), "awaiting_decisions")
            progress = stderr.getvalue()
            self.assertIn("phase=reviewers_running", progress)
            self.assertIn("raw_findings=1", progress)

    def test_wait_for_final_decision_emits_progress_without_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "20260531T100004Z-final"
            run_dir.mkdir()
            self.write_run(run_dir, "awaiting_decisions")
            decision_path = review_gate.decision_file(run_dir.name)
            stderr = io.StringIO()
            stdout = io.StringIO()
            heartbeat = review_gate.GateHeartbeat(0.01, stream=stderr)

            def save_decision() -> None:
                time.sleep(0.03)
                (run_dir / "decisions.json").write_text(json.dumps({
                    "findings": {"f1": {"action": "ignore"}},
                }), encoding="utf-8")
                decision_path.write_text(json.dumps({"action": "done"}), encoding="utf-8")

            thread = threading.Thread(target=save_decision)
            thread.start()
            try:
                with contextlib.redirect_stdout(stdout):
                    outcome, decisions = review_gate.wait_for_final_decision(
                        run_dir,
                        time.time() + 1,
                        0.01,
                        heartbeat,
                    )
            finally:
                thread.join()
                try:
                    decision_path.unlink()
                except FileNotFoundError:
                    pass

            self.assertEqual(outcome, "allow")
            self.assertIsNotNone(decisions)
            self.assertEqual(stdout.getvalue(), "")
            self.assertIn("waiting_for_ui_decision=yes", stderr.getvalue())

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

    def test_project_config_disable_stop_hook_requires_boolean_true(self) -> None:
        cases = [
            ("missing", 128, "", False),
            ("true", 0, json.dumps({"disableStopHook": True}), True),
            ("false", 0, json.dumps({"disableStopHook": False}), False),
            ("string-true", 0, json.dumps({"disableStopHook": "true"}), False),
            ("number-one", 0, json.dumps({"disableStopHook": 1}), False),
            ("malformed", 0, "{", False),
            ("non-object", 0, json.dumps(["disableStopHook", True]), False),
        ]
        for name, returncode, stdout, expected in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                repo = Path(tmp)
                original_run_capture = review_gate.run_capture
                try:
                    def fake_run_capture(args, cwd, **kwargs):
                        self.assertEqual(args, ["git", "show", "HEAD:.acr.json"])
                        self.assertEqual(cwd, repo)
                        self.assertFalse(kwargs.get("check"))
                        return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr="")

                    review_gate.run_capture = fake_run_capture
                    self.assertEqual(review_gate.project_config_disables_stop_hook(repo), expected)
                finally:
                    review_gate.run_capture = original_run_capture

    def test_disable_stop_hook_project_config_exits_before_diff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            repo.mkdir()
            plugin_root.mkdir()

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_launch_review = review_gate.launch_review
            original_read_committed_project_config = review_gate.read_committed_project_config
            try:
                def fake_git_root(cwd: Path) -> Path:
                    self.assertEqual(cwd, repo)
                    return repo

                def fake_read_committed_project_config(repo_arg: Path) -> dict:
                    self.assertEqual(repo_arg, repo)
                    return {"disableStopHook": True}

                def fake_current_review_diff(repo_arg: Path) -> str:
                    self.fail("current_review_diff should not be called when .acr.json disables the Stop hook")

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("launch_review should not be called when .acr.json disables the Stop hook")

                review_gate.git_root = fake_git_root
                review_gate.read_committed_project_config = fake_read_committed_project_config
                review_gate.current_review_diff = fake_current_review_diff
                review_gate.launch_review = fake_launch_review

                stdout = io.StringIO()
                with self.stop_hook_mode("auto"), contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({"session_id": "disabled-stop-hook-test", "cwd": str(repo)}),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.launch_review = original_launch_review
                review_gate.read_committed_project_config = original_read_committed_project_config

            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), '')

    def test_missing_committed_project_config_continues_to_diff_check(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            repo.mkdir()
            plugin_root.mkdir()
            # No .acr.json (or empty config) — gate should proceed to diff check

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_cleanup = review_gate.cleanup_stale_sentinels
            original_launch_review = review_gate.launch_review
            try:
                seen_diff_repos: list[Path] = []

                def fake_git_root(cwd: Path) -> Path:
                    self.assertEqual(cwd, repo)
                    return repo

                def fake_current_review_diff(repo_arg: Path) -> str:
                    seen_diff_repos.append(repo_arg)
                    return ""

                def fake_cleanup(*args, **kwargs) -> None:
                    self.fail("cleanup_stale_sentinels should not be called when there is no diff")

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("launch_review should not be called when there is no diff")

                review_gate.git_root = fake_git_root
                review_gate.current_review_diff = fake_current_review_diff
                review_gate.cleanup_stale_sentinels = fake_cleanup
                review_gate.launch_review = fake_launch_review

                stdout = io.StringIO()
                with self.stop_hook_mode("auto"), contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({"session_id": "missing-config-test", "cwd": str(repo)}),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.cleanup_stale_sentinels = original_cleanup
                review_gate.launch_review = original_launch_review

            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), '')
            self.assertEqual(seen_diff_repos, [repo])

    def test_missing_global_stop_hook_mode_defaults_to_prompt_for_existing_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root = root / "plugin"
            settings_dir = root / "settings"
            plugin_root.mkdir()
            settings_dir.mkdir()
            (settings_dir / "settings.json").write_text(
                json.dumps({"autoCloseMs": 0, "firstRunDone": True}),
                encoding="utf-8",
            )

            with self.settings_dir(settings_dir):
                mode = review_gate.resolve_stop_hook_mode(plugin_root, None)

            self.assertEqual(mode, "prompt")

    def test_stop_hook_mode_env_override_wins_over_settings_and_repo_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root = root / "plugin"
            settings_dir = root / "settings"
            plugin_root.mkdir()
            settings_dir.mkdir()
            (settings_dir / "settings.json").write_text(
                json.dumps({"stopHookMode": "disabled"}),
                encoding="utf-8",
            )

            with self.settings_dir(settings_dir), self.stop_hook_mode("auto"):
                mode = review_gate.resolve_stop_hook_mode(plugin_root, {"stopHookMode": "prompt"})

            self.assertEqual(mode, "auto")

    def test_prompt_mode_blocks_once_then_allows_same_diff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            settings_dir = root / "settings"
            fallback_cwd.mkdir()
            repo.mkdir()
            plugin_root.mkdir()
            settings_dir.mkdir()
            diff = "diff --git a/file b/file\n+changed\n"
            diff_sha = review_gate.diff_sha256(diff)
            session_id = "prompt-mode-test"
            marker = review_gate.confirmation_marker_path(repo, session_id)
            session_done = review_gate.done_file(session_id)
            for path in (marker, session_done):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_launch_review = review_gate.launch_review
            try:
                def fake_git_root(cwd: Path) -> Path:
                    return repo

                def fake_current_review_diff(repo_arg: Path) -> str:
                    self.assertEqual(repo_arg, repo)
                    return diff

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("prompt mode must not launch a review")

                review_gate.git_root = fake_git_root
                review_gate.current_review_diff = fake_current_review_diff
                review_gate.launch_review = fake_launch_review

                with self.settings_dir(settings_dir):
                    stdout = io.StringIO()
                    with contextlib.redirect_stdout(stdout):
                        result = review_gate.run_gate(
                            json.dumps({"session_id": session_id, "cwd": str(repo)}),
                            plugin_root,
                            fallback_cwd,
                            1,
                            0.01,
                            0,
                        )
                    self.assertEqual(result, 0)
                    payload = json.loads(stdout.getvalue())
                    self.assertEqual(payload["continue"], False)
                    self.assertIn("Agentic Code Reviewer is waiting for your confirmation.", payload["stopReason"])
                    self.assertIn("Reply yes/y to run the review, or no/n/skip to skip this diff.", payload["stopReason"])
                    self.assertTrue(marker.exists())

                    stdout = io.StringIO()
                    with contextlib.redirect_stdout(stdout):
                        result = review_gate.run_gate(
                            json.dumps({
                                "hook_event_name": "UserPromptSubmit",
                                "session_id": session_id,
                                "cwd": str(repo),
                                "prompt": "no",
                            }),
                            plugin_root,
                            fallback_cwd,
                            1,
                            0.01,
                            0,
                        )
                    self.assertEqual(result, 0)
                    payload = json.loads(stdout.getvalue())
                    self.assertEqual(payload["continue"], False)
                    self.assertIn("skipped for this diff", payload["stopReason"])
                    self.assertFalse(marker.exists())
                    self.assertEqual((review_gate.read_json(session_done) or {}).get("diff_sha256"), diff_sha)
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.launch_review = original_launch_review
                for path in (marker, session_done):
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass

    def test_user_prompt_submit_yes_launches_confirmed_review(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            repo.mkdir()
            plugin_root.mkdir()
            diff = "diff --git a/file b/file\n+changed\n"
            diff_sha = review_gate.diff_sha256(diff)
            session_id = "prompt-yes-test"
            marker = review_gate.confirmation_marker_path(repo, session_id)
            session_done = review_gate.done_file(session_id)
            for path in (marker, session_done):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
            review_gate.write_confirmation_marker(repo, session_id, diff_sha, diff)

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_launch_review = review_gate.launch_review
            try:
                review_gate.git_root = lambda cwd: repo
                review_gate.current_review_diff = lambda repo_arg: diff

                launch_calls = []

                def fake_launch_review(*args, **kwargs) -> Path:
                    launch_calls.append((args, kwargs))
                    run_dir = repo / ".claude" / "review-runs" / "20260628T120000Z-confirmed"
                    run_dir.mkdir(parents=True)
                    return run_dir

                review_gate.launch_review = fake_launch_review

                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({
                            "hook_event_name": "UserPromptSubmit",
                            "session_id": session_id,
                            "cwd": str(repo),
                            "prompt": "yes",
                        }),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )

                self.assertEqual(result, 0)
                payload = json.loads(stdout.getvalue())
                self.assertEqual(payload["continue"], False)
                self.assertIn("Agentic Code Reviewer started", payload["stopReason"])
                self.assertIn("20260628T120000Z-confirmed", payload["stopReason"])
                self.assertFalse(marker.exists())
                self.assertFalse(session_done.exists())
                self.assertEqual(len(launch_calls), 1)
                self.assertEqual(launch_calls[0][1].get("fast_hook"), False)
                self.assertEqual(launch_calls[0][1].get("disable_auto_resume"), False)
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.launch_review = original_launch_review
                for path in (marker, session_done):
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass

    def test_confirmation_response_treats_skip_as_no(self) -> None:
        self.assertEqual(review_gate.classify_confirmation_response("skip it for now"), "no")
        self.assertEqual(review_gate.classify_confirmation_response("Skip"), "no")

    def test_disabled_stop_hook_mode_exits_without_launching_review(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            repo.mkdir()
            plugin_root.mkdir()

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_launch_review = review_gate.launch_review
            try:
                review_gate.git_root = lambda cwd: repo
                review_gate.current_review_diff = lambda repo_arg: "diff --git a/file b/file\n+changed\n"

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("disabled mode must not launch a review")

                review_gate.launch_review = fake_launch_review
                stdout = io.StringIO()
                with self.stop_hook_mode("disabled"), contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({"session_id": "disabled-mode-test", "cwd": str(repo)}),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.launch_review = original_launch_review

            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), "")

    def test_auto_mode_marks_stale_run_and_allows_when_diff_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            repo.mkdir()
            plugin_root.mkdir()
            first_diff = "diff --git a/file b/file\n+before\n"
            second_diff = "diff --git a/file b/file\n+after\n"
            first_sha = review_gate.diff_sha256(first_diff)
            decisions = {"findings": {"f1": {"action": "ask_claude_to_implement"}}}
            run_dir = self.write_review_run(repo, "20260625T100000Z-stale", first_sha, decisions)

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_newest_matching_run = review_gate.newest_matching_run
            original_launch_review = review_gate.launch_review
            try:
                diffs = [first_diff, second_diff]
                review_gate.git_root = lambda cwd: repo

                def fake_current_review_diff(repo_arg: Path) -> str:
                    self.assertEqual(repo_arg, repo)
                    return diffs.pop(0)

                def fake_newest_matching_run(repo_arg: Path, expected_diff_sha: str) -> Path:
                    self.assertEqual(expected_diff_sha, first_sha)
                    return run_dir

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("matching run should be reused")

                review_gate.current_review_diff = fake_current_review_diff
                review_gate.newest_matching_run = fake_newest_matching_run
                review_gate.launch_review = fake_launch_review
                stdout = io.StringIO()
                with self.stop_hook_mode("auto"), contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({"session_id": "stale-run-test", "cwd": str(repo)}),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.newest_matching_run = original_newest_matching_run
                review_gate.launch_review = original_launch_review

            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), "")
            stale = review_gate.read_json(run_dir / review_gate.STALE_REVIEW_FILE)
            self.assertEqual((stale or {}).get("reason"), "diff_changed_during_review")

    def test_launch_review_fast_hook_sets_review_budget_env(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            repo.mkdir()
            plugin_root.mkdir()
            original_run_capture = review_gate.run_capture
            try:
                def fake_run_capture(args, cwd, env=None, **kwargs):
                    self.assertEqual(cwd, repo)
                    self.assertIsNotNone(env)
                    assert env is not None
                    self.assertEqual(env.get("ACR_HOOK_FAST"), "1")
                    self.assertEqual(env.get("ACR_REVIEW_TIMEOUT_SECONDS"), review_gate.HOOK_REVIEW_TIMEOUT_SECONDS)
                    self.assertEqual(env.get("ACR_SYNTHESIS_TIMEOUT_SECONDS"), review_gate.HOOK_SYNTHESIS_TIMEOUT_SECONDS)
                    self.assertEqual(env.get("ACR_REVIEWER_MAX_RETRIES"), "0")
                    return subprocess.CompletedProcess(args, 0, stdout="Review 20260625T110000Z-fast started.\n", stderr="")

                review_gate.run_capture = fake_run_capture
                run_dir = review_gate.launch_review(plugin_root, repo, fast_hook=True)
            finally:
                review_gate.run_capture = original_run_capture

            self.assertEqual(run_dir, repo / ".claude" / "review-runs" / "20260625T110000Z-fast")

    def test_gate_error_emits_exactly_one_json_object(self) -> None:
        """Regression: GateError path must emit exactly one JSON object.
        emit_launch_failure() already prints a block decision; run_gate must not
        also call allow_stop() afterwards (which would produce two JSON objects)."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            repo.mkdir()
            plugin_root.mkdir()

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_cleanup = review_gate.cleanup_stale_sentinels
            original_newest_run = review_gate.newest_matching_run
            original_launch_review = review_gate.launch_review
            try:
                def fake_git_root(cwd: Path) -> Path:
                    return repo

                def fake_current_review_diff(repo_arg: Path) -> str:
                    return "diff --git a/x.py b/x.py\n+foo"

                def fake_cleanup(*args, **kwargs) -> None:
                    pass

                def fake_newest_run(repo_arg: Path, diff_sha: str):
                    return None

                def fake_launch_review(*args, **kwargs):
                    raise review_gate.GateError("simulated launch failure")

                review_gate.git_root = fake_git_root
                review_gate.current_review_diff = fake_current_review_diff
                review_gate.cleanup_stale_sentinels = fake_cleanup
                review_gate.newest_matching_run = fake_newest_run
                review_gate.launch_review = fake_launch_review

                stdout = io.StringIO()
                with self.stop_hook_mode("auto"), contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({"session_id": "gate-error-test", "cwd": str(repo)}),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.cleanup_stale_sentinels = original_cleanup
                review_gate.newest_matching_run = original_newest_run
                review_gate.launch_review = original_launch_review

            self.assertEqual(result, 0)
            output = stdout.getvalue().strip()
            # Must be exactly one valid JSON object — not two
            parsed = json.loads(output)
            self.assertIn(parsed.get("decision"), {"block", "approve"})
            # Specifically it must be a block (launch failure) — not allow
            self.assertEqual(parsed.get("decision"), "block")

    def test_valid_post_resume_marker_allows_once_and_consumes_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            decisions = {"findings": {"f1": {"action": "ask_claude_to_implement"}}}
            run_dir = self.write_review_run(repo, "20260531T140000Z-resume", "original-diff", decisions)
            marker_path = self.write_post_resume_marker(repo, run_dir, decisions, marker_tmp)

            consumed = review_gate.consume_post_resume_marker(
                repo,
                "fix-diff",
                "diff --git a/src/app.py b/src/app.py\n",
                "post-resume-session",
                tmp_dir=marker_tmp,
                now=review_gate.parse_utc_timestamp("2026-05-31T00:00:01Z"),
            )

            self.assertEqual(consumed, run_dir)
            self.assertFalse(marker_path.exists())
            skip = review_gate.read_json(run_dir / review_gate.POST_RESUME_SKIP_FILE)
            self.assertIsNotNone(skip)
            self.assertEqual(skip["reason"], "post_resume_marker")
            self.assertEqual(skip["current_diff_sha256"], "fix-diff")
            self.assertEqual(skip["original_diff_sha256"], "original-diff")

            self.assertIsNone(review_gate.consume_post_resume_marker(
                repo,
                "another-diff",
                "diff --git a/src/app.py b/src/app.py\n",
                "later-session",
                tmp_dir=marker_tmp,
            ))

    def test_expired_post_resume_marker_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            decisions = {"findings": {"f1": {"action": "accept_fix"}}}
            run_dir = self.write_review_run(repo, "20260531T140001Z-expired", "original-diff", decisions)
            marker_path = self.write_post_resume_marker(
                repo,
                run_dir,
                decisions,
                marker_tmp,
                expires_at="2026-05-30T00:00:00Z",
            )

            consumed = review_gate.consume_post_resume_marker(
                repo,
                "fix-diff",
                "diff --git a/src/app.py b/src/app.py\n",
                "expired-session",
                tmp_dir=marker_tmp,
                now=review_gate.parse_utc_timestamp("2026-05-31T00:00:00Z"),
            )

            self.assertIsNone(consumed)
            self.assertFalse(marker_path.exists())
            self.assertFalse((run_dir / review_gate.POST_RESUME_SKIP_FILE).exists())

    def test_decisions_hash_mismatch_post_resume_marker_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            decisions = {"findings": {"f1": {"action": "ask_claude_to_explain"}}}
            run_dir = self.write_review_run(repo, "20260531T140002Z-mismatch", "original-diff", decisions)
            marker_path = self.write_post_resume_marker(
                repo,
                run_dir,
                decisions,
                marker_tmp,
                decisions_sha="not-the-current-decisions",
            )

            consumed = review_gate.consume_post_resume_marker(
                repo,
                "fix-diff",
                "diff --git a/src/app.py b/src/app.py\n",
                "mismatch-session",
                tmp_dir=marker_tmp,
            )

            self.assertIsNone(consumed)
            self.assertFalse(marker_path.exists())
            self.assertFalse((run_dir / review_gate.POST_RESUME_SKIP_FILE).exists())

    def test_post_resume_marker_rejects_disjoint_current_diff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            decisions = {"findings": {"f1": {"action": "ask_claude_to_implement"}}}
            run_dir = self.write_review_run(repo, "20260531T140003Z-disjoint", "original-diff", decisions)
            marker_path = self.write_post_resume_marker(repo, run_dir, decisions, marker_tmp)

            consumed = review_gate.consume_post_resume_marker(
                repo,
                "unrelated-diff",
                "diff --git a/docs/readme.md b/docs/readme.md\n",
                "disjoint-session",
                tmp_dir=marker_tmp,
            )

            self.assertIsNone(consumed)
            self.assertFalse(marker_path.exists())
            self.assertFalse((run_dir / review_gate.POST_RESUME_SKIP_FILE).exists())

    def test_post_resume_marker_rejects_current_diff_with_extra_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            decisions = {"findings": {"f1": {"action": "ask_claude_to_implement"}}}
            run_dir = self.write_review_run(repo, "20260531T140005Z-extra-paths", "original-diff", decisions)
            marker_path = self.write_post_resume_marker(repo, run_dir, decisions, marker_tmp)

            consumed = review_gate.consume_post_resume_marker(
                repo,
                "implementation-plus-extra-diff",
                "\n".join([
                    "diff --git a/src/app.py b/src/app.py",
                    "diff --git a/docs/readme.md b/docs/readme.md",
                    "",
                ]),
                "extra-paths-session",
                tmp_dir=marker_tmp,
            )

            self.assertIsNone(consumed)
            self.assertFalse(marker_path.exists())
            self.assertFalse((run_dir / review_gate.POST_RESUME_SKIP_FILE).exists())

    def test_non_code_post_resume_marker_only_allows_same_diff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = (root / "repo").resolve()
            marker_tmp = root / "tmp"
            decisions = {"findings": {"f1": {"action": "ask_claude_to_explain"}}}
            run_dir = self.write_review_run(repo, "20260531T140004Z-same-only", "original-diff", decisions)
            changed_marker = self.write_post_resume_marker(
                repo,
                run_dir,
                decisions,
                marker_tmp,
                suppression_mode="same_diff",
            )
            changed = review_gate.consume_post_resume_marker(
                repo,
                "changed-diff",
                "diff --git a/src/app.py b/src/app.py\n",
                "changed-session",
                tmp_dir=marker_tmp,
            )
            self.assertIsNone(changed)
            self.assertFalse(changed_marker.exists())

            same_marker = self.write_post_resume_marker(
                repo,
                run_dir,
                decisions,
                marker_tmp,
                suppression_mode="same_diff",
            )
            same = review_gate.consume_post_resume_marker(
                repo,
                "original-diff",
                "diff --git a/src/app.py b/src/app.py\n",
                "same-session",
                tmp_dir=marker_tmp,
            )
            self.assertEqual(same, run_dir)
            self.assertFalse(same_marker.exists())

    def test_same_diff_actionable_decisions_require_resume_marker_to_allow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            repo = (root / "repo").resolve()
            plugin_root = root / "plugin"
            marker_tmp = root / "tmp"
            fallback_cwd.mkdir()
            repo.mkdir()
            plugin_root.mkdir()

            diff = "diff --git a/file b/file\n"
            diff_sha = review_gate.diff_sha256(diff)
            decisions = {"findings": {"f1": {"action": "ask_claude_to_implement"}}}
            run_dir = self.write_review_run(repo, "20260531T140003Z-same-diff", diff_sha, decisions)

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_newest_matching_run = review_gate.newest_matching_run
            original_launch_review = review_gate.launch_review
            original_marker_paths = review_gate.post_resume_marker_paths
            try:
                def fake_git_root(cwd: Path) -> Path:
                    return repo

                def fake_current_review_diff(repo_arg: Path) -> str:
                    self.assertEqual(repo_arg, repo)
                    return diff

                def fake_newest_matching_run(repo_arg: Path, expected_diff_sha: str) -> Path:
                    self.assertEqual(repo_arg, repo)
                    self.assertEqual(expected_diff_sha, diff_sha)
                    return run_dir

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("launch_review should not be called when a matching run exists")

                def fake_marker_paths(repo_arg: Path, tmp_dir: Path = Path("/tmp")) -> list[Path]:
                    self.assertEqual(repo_arg, repo)
                    return sorted(marker_tmp.glob("*.json"))

                review_gate.git_root = fake_git_root
                review_gate.current_review_diff = fake_current_review_diff
                review_gate.newest_matching_run = fake_newest_matching_run
                review_gate.launch_review = fake_launch_review
                review_gate.post_resume_marker_paths = fake_marker_paths

                without_marker_session = "same-diff-without-marker"
                without_done = review_gate.done_file(without_marker_session)
                try:
                    without_done.unlink()
                except FileNotFoundError:
                    pass
                stdout = io.StringIO()
                with self.stop_hook_mode("auto"), contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({"session_id": without_marker_session, "cwd": str(repo)}),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
                self.assertEqual(result, 0)
                payload = json.loads(stdout.getvalue())
                self.assertEqual(payload["decision"], "block")
                try:
                    without_done.unlink()
                except FileNotFoundError:
                    pass

                marker_path = self.write_post_resume_marker(repo, run_dir, decisions, marker_tmp)
                with_marker_session = "same-diff-with-marker"
                with_done = review_gate.done_file(with_marker_session)
                try:
                    with_done.unlink()
                except FileNotFoundError:
                    pass
                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({"session_id": with_marker_session, "cwd": str(repo)}),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
                self.assertEqual(result, 0)
                self.assertEqual(stdout.getvalue(), '')
                self.assertTrue(with_done.exists())
                self.assertFalse(marker_path.exists())
                self.assertEqual(
                    (review_gate.read_json(run_dir / review_gate.POST_RESUME_SKIP_FILE) or {}).get("reason"),
                    "post_resume_marker",
                )
                try:
                    with_done.unlink()
                except FileNotFoundError:
                    pass

                later_session = "same-diff-after-consumed-marker"
                later_done = review_gate.done_file(later_session)
                try:
                    later_done.unlink()
                except FileNotFoundError:
                    pass
                stdout = io.StringIO()
                with self.stop_hook_mode("auto"), contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({"session_id": later_session, "cwd": str(repo)}),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
                self.assertEqual(result, 0)
                payload = json.loads(stdout.getvalue())
                self.assertEqual(payload["decision"], "block")
                try:
                    later_done.unlink()
                except FileNotFoundError:
                    pass
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.newest_matching_run = original_newest_matching_run
                review_gate.launch_review = original_launch_review
                review_gate.post_resume_marker_paths = original_marker_paths

    def test_direct_plan_mode_hook_without_diff_exits_without_launch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            event_cwd = root / "repo"
            plugin_root = root / "plugin"
            fallback_cwd.mkdir()
            event_cwd.mkdir()
            plugin_root.mkdir()
            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_cleanup = review_gate.cleanup_stale_sentinels
            original_launch_review = review_gate.launch_review
            try:
                def fake_git_root(cwd: Path) -> Path:
                    self.assertEqual(cwd, event_cwd.resolve())
                    return event_cwd.resolve()

                def fake_current_review_diff(repo: Path) -> str:
                    self.assertEqual(repo, event_cwd.resolve())
                    return ""

                def fake_cleanup(*args, **kwargs) -> None:
                    self.fail("cleanup_stale_sentinels should not be called when there is no diff")

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("launch_review should not be called when there is no diff")

                review_gate.git_root = fake_git_root
                review_gate.current_review_diff = fake_current_review_diff
                review_gate.cleanup_stale_sentinels = fake_cleanup
                review_gate.launch_review = fake_launch_review
                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({
                            "hook_event_name": "Stop",
                            "session_id": "direct-plan-mode-test",
                            "cwd": str(event_cwd),
                            "collaboration_mode": {"mode": "plan"},
                        }),
                        plugin_root,
                        fallback_cwd,
                        0.1,
                        0.01,
                    )
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.cleanup_stale_sentinels = original_cleanup
                review_gate.launch_review = original_launch_review

            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), '')

    def test_codex_transcript_plan_mode_hook_without_diff_exits_without_launch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            event_cwd = root / "repo"
            plugin_root = root / "plugin"
            transcript = root / "transcript.jsonl"
            turn_id = "019e7f34-30f7-74f0-8202-31fd774edc28"
            fallback_cwd.mkdir()
            event_cwd.mkdir()
            plugin_root.mkdir()
            transcript.write_text(
                "\n".join([
                    json.dumps({
                        "type": "event_msg",
                        "payload": {
                            "type": "task_started",
                            "turn_id": turn_id,
                            "collaboration_mode_kind": "plan",
                        },
                    }),
                    json.dumps({
                        "type": "turn_context",
                        "payload": {
                            "turn_id": turn_id,
                            "collaboration_mode": {"mode": "plan"},
                        },
                    }),
                ]) + "\n",
                encoding="utf-8",
            )
            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_cleanup = review_gate.cleanup_stale_sentinels
            original_launch_review = review_gate.launch_review
            try:
                def fake_git_root(cwd: Path) -> Path:
                    self.assertEqual(cwd, event_cwd.resolve())
                    return event_cwd.resolve()

                def fake_current_review_diff(repo: Path) -> str:
                    self.assertEqual(repo, event_cwd.resolve())
                    return ""

                def fake_cleanup(*args, **kwargs) -> None:
                    self.fail("cleanup_stale_sentinels should not be called when there is no diff")

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("launch_review should not be called when there is no diff")

                review_gate.git_root = fake_git_root
                review_gate.current_review_diff = fake_current_review_diff
                review_gate.cleanup_stale_sentinels = fake_cleanup
                review_gate.launch_review = fake_launch_review
                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({
                            "hook_event_name": "Stop",
                            "session_id": "codex-transcript-plan-mode-test",
                            "cwd": str(event_cwd),
                            "transcript_path": str(transcript),
                            "turn_id": turn_id,
                        }),
                        plugin_root,
                        fallback_cwd,
                        0.1,
                        0.01,
                    )
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.cleanup_stale_sentinels = original_cleanup
                review_gate.launch_review = original_launch_review

            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), '')

    def test_plan_mode_hook_with_diff_continues_to_review_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            event_cwd = root / "repo"
            plugin_root = root / "plugin"
            run_dir = event_cwd / ".claude" / "review-runs" / "20260531T123456Z-plan-diff"
            fallback_cwd.mkdir()
            event_cwd.mkdir()
            plugin_root.mkdir()
            run_dir.mkdir(parents=True)
            self.write_run(run_dir, "decisions_ready")
            (run_dir / "decisions.json").write_text(json.dumps({
                "findings": {"f1": {"action": "ignore"}},
            }), encoding="utf-8")
            session_id = "plan-mode-diff-test"
            session_done = review_gate.done_file(session_id)
            try:
                session_done.unlink()
            except FileNotFoundError:
                pass

            original_git_root = review_gate.git_root
            original_current_review_diff = review_gate.current_review_diff
            original_newest_matching_run = review_gate.newest_matching_run
            original_launch_review = review_gate.launch_review
            try:
                seen_matching: list[tuple[Path, str]] = []

                def fake_git_root(cwd: Path) -> Path:
                    self.assertEqual(cwd, event_cwd.resolve())
                    return event_cwd.resolve()

                def fake_current_review_diff(repo: Path) -> str:
                    self.assertEqual(repo, event_cwd.resolve())
                    return "diff --git a/file b/file\n"

                def fake_newest_matching_run(repo: Path, expected_diff_sha: str) -> Path:
                    seen_matching.append((repo, expected_diff_sha))
                    return run_dir

                def fake_launch_review(*args, **kwargs) -> None:
                    self.fail("launch_review should not be called when a matching run exists")

                review_gate.git_root = fake_git_root
                review_gate.current_review_diff = fake_current_review_diff
                review_gate.newest_matching_run = fake_newest_matching_run
                review_gate.launch_review = fake_launch_review
                stdout = io.StringIO()
                with self.stop_hook_mode("auto"), contextlib.redirect_stdout(stdout):
                    result = review_gate.run_gate(
                        json.dumps({
                            "hook_event_name": "Stop",
                            "session_id": session_id,
                            "cwd": str(event_cwd),
                            "collaboration_mode": {"mode": "plan"},
                        }),
                        plugin_root,
                        fallback_cwd,
                        1,
                        0.01,
                        0,
                    )
            finally:
                review_gate.git_root = original_git_root
                review_gate.current_review_diff = original_current_review_diff
                review_gate.newest_matching_run = original_newest_matching_run
                review_gate.launch_review = original_launch_review
                try:
                    session_done.unlink()
                except FileNotFoundError:
                    pass

            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), '')
            self.assertEqual(len(seen_matching), 1)

    def test_non_plan_transcript_hook_continues_to_repo_detection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fallback_cwd = root / "fallback"
            event_cwd = root / "repo"
            plugin_root = root / "plugin"
            transcript = root / "transcript.jsonl"
            turn_id = "current-turn"
            fallback_cwd.mkdir()
            event_cwd.mkdir()
            plugin_root.mkdir()
            transcript.write_text(
                json.dumps({
                    "type": "turn_context",
                    "payload": {
                        "turn_id": turn_id,
                        "collaboration_mode": {"mode": "default"},
                    },
                }) + "\n",
                encoding="utf-8",
            )
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
                        "session_id": "codex-transcript-default-mode-test",
                        "cwd": str(event_cwd),
                        "transcript_path": str(transcript),
                        "turn_id": turn_id,
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


    def test_main_guard_allows_stop_on_pre_argparse_exception(self) -> None:
        """Regression: env-var conversion failures before run_gate() must still allow the stop.
        ACR_GATE_MAX_SECONDS=bad causes float() to raise ValueError before the try/except
        would have fired in the old code. allow_stop() now emits nothing (empty stdout)."""
        original = review_gate.os.environ.get("ACR_GATE_MAX_SECONDS")
        original_stdin = sys.stdin
        try:
            review_gate.os.environ["ACR_GATE_MAX_SECONDS"] = "bad"
            sys.stdin = io.StringIO("{}")
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                result = review_gate.main()
        finally:
            if original is None:
                review_gate.os.environ.pop("ACR_GATE_MAX_SECONDS", None)
            else:
                review_gate.os.environ["ACR_GATE_MAX_SECONDS"] = original
            sys.stdin = original_stdin

        self.assertEqual(result, 0)
        self.assertEqual(stdout.getvalue(), '')


if __name__ == "__main__":
    unittest.main()
