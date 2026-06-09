#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("orchestrator", ROOT / "scripts" / "orchestrator.py")
orchestrator = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules["orchestrator"] = orchestrator  # required so @dataclass can resolve the module
SPEC.loader.exec_module(orchestrator)


class OrchestratorTest(unittest.TestCase):
    def test_launch_ui_passes_configured_port_and_checks_ipv4_bind_address(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "repo"
            run_dir = repo / ".claude" / "review-runs" / "20260531T180000Z-ui"
            plugin_root = root / "plugin"
            repo.mkdir(parents=True)
            run_dir.mkdir(parents=True)
            plugin_root.mkdir()

            args = SimpleNamespace(
                repo=str(repo),
                run_id=run_dir.name,
                run_dir=str(run_dir),
                plugin_root=str(plugin_root),
                pr=None,
                platform="codex",
                provider="codex",
                review_timeout=1,
                synthesis_timeout=1,
            )
            subject = orchestrator.Orchestrator(args)
            captured: dict[str, object] = {}

            class FakeProcess:
                pid = 12345
                returncode = None

                def poll(self) -> None:
                    return None

                def kill(self) -> None:
                    captured["killed"] = True

            def fake_popen(cmd, **kwargs):
                captured["cmd"] = cmd
                captured["kwargs"] = kwargs
                return FakeProcess()

            class FakeResponse:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb) -> None:
                    return None

                def read(self) -> bytes:
                    return json.dumps({"runId": run_dir.name}).encode("utf-8")

            def fake_urlopen(url: str, timeout: int):
                captured["url"] = url
                captured["timeout"] = timeout
                return FakeResponse()

            original_popen = orchestrator.subprocess.Popen
            original_urlopen = orchestrator.urllib.request.urlopen
            original_port = os.environ.get("ACR_UI_PORT")
            try:
                orchestrator.subprocess.Popen = fake_popen
                orchestrator.urllib.request.urlopen = fake_urlopen
                os.environ["ACR_UI_PORT"] = "8899"

                subject.launch_ui()
            finally:
                orchestrator.subprocess.Popen = original_popen
                orchestrator.urllib.request.urlopen = original_urlopen
                if original_port is None:
                    os.environ.pop("ACR_UI_PORT", None)
                else:
                    os.environ["ACR_UI_PORT"] = original_port

            cmd = captured["cmd"]
            self.assertIsInstance(cmd, list)
            self.assertIn("--port", cmd)
            self.assertEqual(cmd[cmd.index("--port") + 1], "8899")
            self.assertEqual(captured["url"], "http://127.0.0.1:8899/api/review")
            self.assertEqual(captured["timeout"], 1)
            self.assertTrue((run_dir / "READY").exists())
            run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
            self.assertEqual(run["ui_port"], 8899)

    def test_launch_ui_lets_server_bind_dynamic_port_and_reads_port_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "repo"
            run_dir = repo / ".claude" / "review-runs" / "20260531T180002Z-ui"
            plugin_root = root / "plugin"
            repo.mkdir(parents=True)
            run_dir.mkdir(parents=True)
            plugin_root.mkdir()

            args = SimpleNamespace(
                repo=str(repo),
                run_id=run_dir.name,
                run_dir=str(run_dir),
                plugin_root=str(plugin_root),
                pr=None,
                platform="codex",
                provider="codex",
                review_timeout=1,
                synthesis_timeout=1,
            )
            subject = orchestrator.Orchestrator(args)
            captured: dict[str, object] = {}

            class FakeProcess:
                pid = 12347
                returncode = None

                def poll(self) -> None:
                    return None

                def kill(self) -> None:
                    captured["killed"] = True

            def fake_popen(cmd, **kwargs):
                captured["cmd"] = cmd
                captured["kwargs"] = kwargs
                (run_dir / "ui-port").write_text("8877\n", encoding="utf-8")
                return FakeProcess()

            class FakeResponse:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb) -> None:
                    return None

                def read(self) -> bytes:
                    return json.dumps({"runId": run_dir.name}).encode("utf-8")

            def fake_urlopen(url: str, timeout: int):
                captured["url"] = url
                captured["timeout"] = timeout
                return FakeResponse()

            original_popen = orchestrator.subprocess.Popen
            original_urlopen = orchestrator.urllib.request.urlopen
            original_port = os.environ.get("ACR_UI_PORT")
            try:
                orchestrator.subprocess.Popen = fake_popen
                orchestrator.urllib.request.urlopen = fake_urlopen
                os.environ.pop("ACR_UI_PORT", None)

                subject.launch_ui()
            finally:
                orchestrator.subprocess.Popen = original_popen
                orchestrator.urllib.request.urlopen = original_urlopen
                if original_port is None:
                    os.environ.pop("ACR_UI_PORT", None)
                else:
                    os.environ["ACR_UI_PORT"] = original_port

            cmd = captured["cmd"]
            self.assertIsInstance(cmd, list)
            self.assertIn("--port", cmd)
            self.assertEqual(cmd[cmd.index("--port") + 1], "0")
            self.assertEqual(captured["url"], "http://127.0.0.1:8877/api/review")
            self.assertTrue((run_dir / "READY").exists())
            run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
            self.assertEqual(run["ui_port"], 8877)

    def test_launch_ui_rejects_readiness_response_for_different_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "repo"
            run_dir = repo / ".claude" / "review-runs" / "20260531T180001Z-ui"
            plugin_root = root / "plugin"
            repo.mkdir(parents=True)
            run_dir.mkdir(parents=True)
            plugin_root.mkdir()

            args = SimpleNamespace(
                repo=str(repo),
                run_id=run_dir.name,
                run_dir=str(run_dir),
                plugin_root=str(plugin_root),
                pr=None,
                platform="codex",
                provider="codex",
                review_timeout=1,
                synthesis_timeout=1,
            )
            subject = orchestrator.Orchestrator(args)

            class FakeProcess:
                pid = 12346
                returncode = 48

                def poll(self) -> int:
                    return self.returncode

                def kill(self) -> None:
                    raise AssertionError("process should already be exited")

            def fake_popen(cmd, **kwargs):
                return FakeProcess()

            class FakeResponse:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb) -> None:
                    return None

                def read(self) -> bytes:
                    return json.dumps({"runId": "20260531T000000Z-old-ui"}).encode("utf-8")

            def fake_urlopen(url: str, timeout: int):
                return FakeResponse()

            original_popen = orchestrator.subprocess.Popen
            original_urlopen = orchestrator.urllib.request.urlopen
            original_port = os.environ.get("ACR_UI_PORT")
            try:
                orchestrator.subprocess.Popen = fake_popen
                orchestrator.urllib.request.urlopen = fake_urlopen
                os.environ["ACR_UI_PORT"] = "8898"

                with self.assertRaisesRegex(RuntimeError, "readiness probe"):
                    subject.launch_ui()
            finally:
                orchestrator.subprocess.Popen = original_popen
                orchestrator.urllib.request.urlopen = original_urlopen
                if original_port is None:
                    os.environ.pop("ACR_UI_PORT", None)
                else:
                    os.environ["ACR_UI_PORT"] = original_port

            self.assertFalse((run_dir / "READY").exists())
            self.assertIn("runId='20260531T000000Z-old-ui'", (run_dir / "ui.error").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
