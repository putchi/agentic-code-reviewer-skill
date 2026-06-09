#!/usr/bin/env python3
from __future__ import annotations
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class InstallCleanupTest(unittest.TestCase):
    def write_file(self, path: Path, text: str, executable: bool = False) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        if executable:
            path.chmod(path.stat().st_mode | stat.S_IXUSR)

    def make_source_tree(self, root: Path) -> Path:
        source = root / "source"
        source.mkdir()
        shutil.copy2(ROOT / "install.sh", source / "install.sh")
        (source / "install.sh").chmod(0o755)

        self.write_file(source / ".claude-plugin" / "plugin.json", '{"version":"9.9.9"}\n')
        self.write_file(source / "commands" / "code-review.md", "---\ndescription: code review\n---\n")
        self.write_file(source / "commands" / "review-last.md", "---\ndescription: review last\n---\nInvoke review-last.\n")
        self.write_file(
            source / "commands" / "agentic-code-reviewer-last.md",
            "---\ndescription: \"Deprecated alias for /review-last\"\ndisable-model-invocation: true\n---\nInvoke the review-last skill and follow it exactly.\nsource-copy-marker\n",
        )
        self.write_file(source / "skills" / "agentic-code-reviewer" / "SKILL.md", "---\nname: agentic-code-reviewer\n---\n")
        self.write_file(source / "skills" / "review-last" / "SKILL.md", "---\nname: review-last\n---\n")
        self.write_file(
            source / "skills" / "agentic-code-reviewer-last" / "SKILL.md",
            "---\nname: agentic-code-reviewer:last\ndescription: \"Deprecated alias for review-last; open the last saved code review in the browser\"\n---\n\n# Open Last Review Alias\n\nThis compatibility alias preserves the legacy invocation. Follow the `review-last` skill exactly.\nsource-copy-marker\n",
        )
        self.write_file(source / "agents" / "semantic-analyzer.md", "agent\n")
        self.write_file(source / "references" / "platform-tools.md", "refs\n")
        self.write_file(source / "server" / "review-server.js", "console.log('server');\n")
        self.write_file(source / "hooks" / "hooks.json", "{}\n")
        self.write_file(source / "hooks" / "code-review-gate.sh", "#!/usr/bin/env bash\n", executable=True)
        self.write_file(source / "hooks" / "check-update.sh", "#!/usr/bin/env bash\n", executable=True)
        self.write_file(source / "dist" / "review-server", "#!/usr/bin/env bash\nexit 0\n", executable=True)
        (source / "scripts").mkdir(parents=True)
        shutil.copy2(ROOT / "scripts" / "codex-install-config.py", source / "scripts" / "codex-install-config.py")
        return source

    def assert_review_last_surface(self, tree: Path) -> None:
        self.assertTrue((tree / "commands" / "review-last.md").is_file())
        self.assertTrue((tree / "skills" / "review-last" / "SKILL.md").is_file())
        legacy_command = tree / "commands" / "agentic-code-reviewer-last.md"
        legacy_skill = tree / "skills" / "agentic-code-reviewer-last" / "SKILL.md"
        self.assertTrue(legacy_command.is_file())
        self.assertTrue(legacy_skill.is_file())
        self.assertIn("Deprecated alias", legacy_command.read_text(encoding="utf-8"))
        self.assertIn("review-last skill", legacy_command.read_text(encoding="utf-8"))
        self.assertIn("source-copy-marker", legacy_command.read_text(encoding="utf-8"))
        self.assertIn("Deprecated alias", legacy_skill.read_text(encoding="utf-8"))
        self.assertIn("Follow the `review-last` skill exactly.", legacy_skill.read_text(encoding="utf-8"))
        self.assertIn("source-copy-marker", legacy_skill.read_text(encoding="utf-8"))

    def assert_source_tree_was_not_cleaned(self, tree: Path) -> None:
        self.assertTrue((tree / "commands" / "agentic-code-reviewer-last.md").is_file())
        self.assertTrue((tree / "skills" / "agentic-code-reviewer-last" / "SKILL.md").is_file())
        self.assertIn(
            "source-copy-marker",
            (tree / "skills" / "agentic-code-reviewer-last" / "SKILL.md").read_text(encoding="utf-8"),
        )

    def test_codex_install_preserves_checked_in_review_last_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_source_tree(root)
            home = root / "home"
            fake_bin = root / "bin"
            self.write_file(fake_bin / "codex", "#!/usr/bin/env bash\nexit 0\n", executable=True)
            env = os.environ.copy()
            env["HOME"] = str(home)
            env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"

            subprocess.run(
                ["bash", str(source / "install.sh"), "--platform", "codex", "--force"],
                cwd=str(source),
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )

            self.assert_source_tree_was_not_cleaned(source)
            self.assert_review_last_surface(home / ".codex" / "skills" / "agentic-code-reviewer")

    def test_claude_install_preserves_checked_in_review_last_aliases_in_marketplace_and_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_source_tree(root)
            home = root / "home"
            env = os.environ.copy()
            env["HOME"] = str(home)

            subprocess.run(
                ["bash", str(source / "install.sh"), "--platform", "claude", "--force"],
                cwd=str(source),
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )

            marketplace = home / ".claude" / "plugins" / "marketplaces" / "agentic-code-reviewer-skill"
            cache = home / ".claude" / "plugins" / "cache" / "agentic-code-reviewer-skill" / "agentic-code-reviewer" / "9.9.9"
            self.assert_source_tree_was_not_cleaned(source)
            self.assert_review_last_surface(marketplace)
            self.assert_review_last_surface(cache)


if __name__ == "__main__":
    unittest.main()
