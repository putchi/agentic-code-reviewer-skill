#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("codex_install_config", ROOT / "scripts" / "codex-install-config.py")
codex_install_config = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(codex_install_config)


class CodexInstallConfigTest(unittest.TestCase):
    def test_empty_files_get_stop_hook_and_hooks_feature(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hooks_file = root / "hooks.json"
            config_file = root / "config.toml"
            hooks_file.write_text("", encoding="utf-8")

            result = codex_install_config.configure_codex_hooks(hooks_file, config_file)

            self.assertTrue(result["hook_added"])
            data = json.loads(hooks_file.read_text(encoding="utf-8"))
            stop_hooks = data["hooks"]["Stop"]
            self.assertEqual(
                stop_hooks[0]["hooks"][0]["command"],
                '/bin/bash "$HOME/.codex/skills/agentic-code-reviewer/hooks/code-review-gate.sh"',
            )
            self.assertEqual(
                stop_hooks[0]["hooks"][0]["timeout"],
                codex_install_config.DEFAULT_HOOK_TIMEOUT_SECONDS,
            )
            self.assertIn("[features]\nhooks = true\n", config_file.read_text(encoding="utf-8"))

    def test_existing_stop_hooks_are_preserved_and_rerun_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hooks_file = root / "hooks.json"
            config_file = root / "config.toml"
            hooks_file.write_text(json.dumps({
                "hooks": {
                    "Stop": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "/usr/local/bin/existing-hook",
                                    "timeout": 10,
                                }
                            ]
                        }
                    ],
                    "UserPromptSubmit": [
                        {"hooks": [{"type": "command", "command": "echo prompt"}]}
                    ],
                }
            }), encoding="utf-8")
            config_file.write_text("[features]\nhooks = true\nmulti_agent = true\n", encoding="utf-8")

            first = codex_install_config.configure_codex_hooks(hooks_file, config_file)
            second = codex_install_config.configure_codex_hooks(hooks_file, config_file)

            self.assertTrue(first["hook_added"])
            self.assertFalse(second["hook_added"])
            data = json.loads(hooks_file.read_text(encoding="utf-8"))
            commands = codex_install_config.stop_hook_commands(data)
            self.assertEqual(commands.count(codex_install_config.DEFAULT_HOOK_COMMAND), 1)
            self.assertIn("/usr/local/bin/existing-hook", commands)
            self.assertIn("UserPromptSubmit", data["hooks"])

    def test_existing_acr_stop_hook_timeout_is_updated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hooks_file = root / "hooks.json"
            config_file = root / "config.toml"
            hooks_file.write_text(json.dumps({
                "hooks": {
                    "Stop": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": codex_install_config.DEFAULT_HOOK_COMMAND,
                                    "timeout": 345600,
                                }
                            ]
                        }
                    ],
                }
            }), encoding="utf-8")
            config_file.write_text("[features]\nhooks = true\n", encoding="utf-8")

            result = codex_install_config.configure_codex_hooks(hooks_file, config_file)

            self.assertTrue(result["hook_added"])
            data = json.loads(hooks_file.read_text(encoding="utf-8"))
            self.assertEqual(
                data["hooks"]["Stop"][0]["hooks"][0]["timeout"],
                codex_install_config.DEFAULT_HOOK_TIMEOUT_SECONDS,
            )

    def test_legacy_acr_stop_hook_command_is_upgraded_in_place(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hooks_file = root / "hooks.json"
            config_file = root / "config.toml"
            legacy_command = 'bash "$HOME/.codex/skills/agentic-code-reviewer/hooks/code-review-gate.sh"'
            hooks_file.write_text(json.dumps({
                "hooks": {
                    "Stop": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": legacy_command,
                                    "timeout": 345600,
                                }
                            ]
                        }
                    ],
                }
            }), encoding="utf-8")
            config_file.write_text("[features]\nhooks = true\n", encoding="utf-8")

            result = codex_install_config.configure_codex_hooks(hooks_file, config_file)

            self.assertTrue(result["hook_added"])
            data = json.loads(hooks_file.read_text(encoding="utf-8"))
            commands = codex_install_config.stop_hook_commands(data)
            self.assertEqual(commands, [codex_install_config.DEFAULT_HOOK_COMMAND])
            self.assertEqual(
                data["hooks"]["Stop"][0]["hooks"][0]["timeout"],
                codex_install_config.DEFAULT_HOOK_TIMEOUT_SECONDS,
            )

    def test_duplicate_legacy_acr_stop_hook_is_removed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hooks_file = root / "hooks.json"
            config_file = root / "config.toml"
            hooks_file.write_text(json.dumps({
                "hooks": {
                    "Stop": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": codex_install_config.DEFAULT_HOOK_COMMAND,
                                    "timeout": codex_install_config.DEFAULT_HOOK_TIMEOUT_SECONDS,
                                }
                            ]
                        },
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": 'bash "$HOME/.codex/skills/agentic-code-reviewer/hooks/code-review-gate.sh"',
                                    "timeout": codex_install_config.DEFAULT_HOOK_TIMEOUT_SECONDS,
                                }
                            ]
                        },
                    ],
                }
            }), encoding="utf-8")
            config_file.write_text("[features]\nhooks = true\n", encoding="utf-8")

            result = codex_install_config.configure_codex_hooks(hooks_file, config_file)

            self.assertTrue(result["hook_added"])
            data = json.loads(hooks_file.read_text(encoding="utf-8"))
            commands = codex_install_config.stop_hook_commands(data)
            self.assertEqual(commands.count(codex_install_config.DEFAULT_HOOK_COMMAND), 1)

    def test_features_hooks_false_is_changed_without_dropping_other_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hooks_file = root / "hooks.json"
            config_file = root / "config.toml"
            hooks_file.write_text("{}", encoding="utf-8")
            config_file.write_text(
                "[features]\n"
                "hooks = false # user disabled before install\n"
                "multi_agent = true\n"
                "\n"
                "[projects.\"/repo\"]\n"
                "trust_level = \"trusted\"\n",
                encoding="utf-8",
            )

            codex_install_config.configure_codex_hooks(hooks_file, config_file)

            config = config_file.read_text(encoding="utf-8")
            self.assertIn("hooks = true # user disabled before install", config)
            self.assertIn("multi_agent = true", config)
            self.assertIn("[projects.\"/repo\"]", config)
            self.assertIn("trust_level = \"trusted\"", config)

    def test_missing_features_table_is_appended(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hooks_file = root / "hooks.json"
            config_file = root / "config.toml"
            hooks_file.write_text("{}", encoding="utf-8")
            config_file.write_text("[projects.\"/repo\"]\ntrust_level = \"trusted\"\n", encoding="utf-8")

            codex_install_config.configure_codex_hooks(hooks_file, config_file)

            config = config_file.read_text(encoding="utf-8")
            self.assertIn("[projects.\"/repo\"]\ntrust_level = \"trusted\"\n", config)
            self.assertTrue(config.rstrip().endswith("[features]\nhooks = true"))

    def test_features_table_at_eof_without_newline_gets_valid_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hooks_file = root / "hooks.json"
            config_file = root / "config.toml"
            hooks_file.write_text("{}", encoding="utf-8")
            config_file.write_text("[features]", encoding="utf-8")

            codex_install_config.configure_codex_hooks(hooks_file, config_file)

            self.assertEqual(config_file.read_text(encoding="utf-8"), "[features]\nhooks = true\n")


if __name__ == "__main__":
    unittest.main()
