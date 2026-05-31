#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import json
import shlex
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
            self.assertEqual(stdout.getvalue(), "")

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
            self.assertEqual(stdout.getvalue(), "")

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
                with contextlib.redirect_stdout(stdout):
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
            self.assertEqual(stdout.getvalue(), "")
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


if __name__ == "__main__":
    unittest.main()
