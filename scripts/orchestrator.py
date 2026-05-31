#!/usr/bin/env python3
import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

AGENTS = [
    "semantic-analyzer",
    "security-scanner",
    "architecture-reviewer",
    "test-coverage-analyzer",
    "senior-dev-reviewer",
]

EXCLUDES = [
    ":(exclude)*.lock", ":(exclude)*.lockb", ":(exclude)package-lock.json", ":(exclude)yarn.lock", ":(exclude)pnpm-lock.yaml",
    ":(exclude)Cargo.lock", ":(exclude)poetry.lock", ":(exclude)Pipfile.lock", ":(exclude)composer.lock", ":(exclude)Gemfile.lock",
    ":(exclude)*.min.js", ":(exclude)*.min.css", ":(exclude)*.map",
    ":(exclude)*.png", ":(exclude)*.jpg", ":(exclude)*.jpeg", ":(exclude)*.gif", ":(exclude)*.svg", ":(exclude)*.webp", ":(exclude)*.ico",
    ":(exclude)*.pdf", ":(exclude)*.zip", ":(exclude)*.tar", ":(exclude)*.gz",
    ":(exclude)dist/", ":(exclude)build/", ":(exclude)node_modules/", ":(exclude).next/", ":(exclude).nuxt/", ":(exclude)target/", ":(exclude)__pycache__/",
]


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def run(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=str(cwd), text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


def split_diff_files(diff: str) -> list[dict]:
    files: list[dict] = []
    chunks: list[list[str]] = []
    current: list[str] = []
    for line in diff.splitlines():
        if line.startswith("diff --git ") and current:
            chunks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        chunks.append(current)
    for chunk_lines in chunks:
        header = chunk_lines[0] if chunk_lines else ""
        if not header.startswith("diff --git "):
            continue
        parts = header.split(" ")
        if len(parts) < 4 or not parts[3].startswith("b/"):
            continue
        path = parts[3][2:]
        add = sum(1 for line in chunk_lines if line.startswith("+") and not line.startswith("+++"))
        delete = sum(1 for line in chunk_lines if line.startswith("-") and not line.startswith("---"))
        files.append({"path": path, "diff": "\n".join(chunk_lines), "add": add, "del": delete})
    return files


def diff_sha256(diff: str) -> str:
    return hashlib.sha256(diff.encode("utf-8")).hexdigest()


class Orchestrator:
    def __init__(self, args: argparse.Namespace) -> None:
        self.repo = Path(args.repo).resolve()
        self.run_id = args.run_id
        self.run_dir = Path(args.run_dir).resolve()
        self.plugin_root = Path(args.plugin_root).resolve()
        self.pr = args.pr
        self.platform = args.platform or os.environ.get("ACR_PLATFORM", "")
        self.provider = args.provider or os.environ.get("ACR_REVIEW_PROVIDER", "claude")
        self.review_timeout = args.review_timeout
        self.synthesis_timeout = args.synthesis_timeout
        self.run_file = self.run_dir / "run.json"
        self.log_prefix = f"[{self.run_id}]"

    def update_run(self, status: str, **extra: object) -> None:
        current: dict = {}
        if self.run_file.exists():
            try:
                current = json.loads(self.run_file.read_text(encoding="utf-8"))
            except Exception:
                current = {}
        current.update({
            "run_id": self.run_id,
            "repo": str(self.repo),
            "run_dir": str(self.run_dir),
            "status": status,
            "platform": self.platform,
            "provider": self.provider,
            "updated_at": utc_now(),
        })
        current.update(extra)
        write_json(self.run_file, current)

    def snapshot(self) -> tuple[str, dict | None, str]:
        self.update_run("snapshotting")
        branch = ""
        pr_meta: dict | None = None
        if self.pr:
            pr_number = self.pr.rstrip("/").split("/")[-1]
            meta = run(["gh", "pr", "view", pr_number, "--json", "number,title,author,headRefName,baseRefName,url"], self.repo)
            diff = run(["gh", "pr", "diff", pr_number], self.repo).stdout
            pr_meta = json.loads(meta.stdout)
            branch = str(pr_meta.get("headRefName") or "")
        else:
            try:
                branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], self.repo).stdout.strip()
            except Exception:
                branch = ""
            cmd = ["git", "diff", "--text", "HEAD", "--", ".", *EXCLUDES]
            diff = run(cmd, self.repo).stdout
            if not diff.strip():
                diff = run(["git", "diff", "--text", "--", ".", *EXCLUDES], self.repo).stdout
        return diff, pr_meta, branch

    def validate_reviewer(self, agent: str) -> bool:
        path = self.run_dir / "agents" / f"{agent}.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return (
                data.get("run_id") == self.run_id
                and data.get("agent") == agent
                and data.get("status") in {"complete", "failed"}
                and isinstance(data.get("findings"), list)
            )
        except Exception:
            return False

    def failed_reviewer(self, agent: str, error: str) -> None:
        write_json(self.run_dir / "agents" / f"{agent}.json", {
            "run_id": self.run_id,
            "agent": agent,
            "status": "failed",
            "started_at": utc_now(),
            "completed_at": utc_now(),
            "error": error,
            "findings": [],
        })

    def run_reviewers(self) -> None:
        self.update_run("reviewers_running", agents=AGENTS)
        procs: dict[str, subprocess.Popen[bytes]] = {}
        script = self.plugin_root / "scripts" / "run-reviewer.sh"
        for agent in AGENTS:
            log = open(self.run_dir / "agents" / f"{agent}.log", "ab")
            procs[agent] = subprocess.Popen([
                "bash", str(script),
                "--run-id", self.run_id,
                "--run-dir", str(self.run_dir),
                "--agent", agent,
                "--repo", str(self.repo),
                "--plugin-root", str(self.plugin_root),
            ], cwd=str(self.repo), stdout=log, stderr=subprocess.STDOUT)

        deadline = time.time() + self.review_timeout
        while procs:
            for agent, proc in list(procs.items()):
                if proc.poll() is not None:
                    if not self.validate_reviewer(agent):
                        self.failed_reviewer(agent, f"reviewer exited {proc.returncode} without valid result JSON")
                    del procs[agent]
            if procs and time.time() > deadline:
                for agent, proc in procs.items():
                    proc.kill()
                    self.failed_reviewer(agent, "reviewer timed out")
                break
            time.sleep(0.5)
        self.update_run("reviewers_complete")

    def synthesize(self) -> bool:
        self.update_run("synthesizing")
        script = self.plugin_root / "scripts" / "run-synthesizer.sh"
        try:
            proc = subprocess.run([
                "bash", str(script),
                "--run-id", self.run_id,
                "--run-dir", str(self.run_dir),
                "--repo", str(self.repo),
                "--plugin-root", str(self.plugin_root),
            ], cwd=str(self.repo), timeout=self.synthesis_timeout)
            if proc.returncode != 0:
                raise RuntimeError(f"synthesizer exited {proc.returncode}")
            data = json.loads((self.run_dir / "synthesis.json").read_text(encoding="utf-8"))
            if data.get("run_id") != self.run_id or not isinstance(data.get("deduped_findings"), list):
                raise RuntimeError("synthesis failed schema validation")
            self.update_run("synthesis_complete")
            return True
        except Exception as exc:
            agent_files = [f"agents/{agent}.json" for agent in AGENTS]
            subprocess.run([
                "python3", str(self.plugin_root / "scripts" / "claude_json.py"),
                "synthesis-fallback",
                "--out-file", str(self.run_dir / "synthesis.json"),
                "--run-id", self.run_id,
                "--verdict", "Review synthesis failed. Inspect the run log before making decisions from this run.",
                "--error", str(exc),
                "--agent-files", *agent_files,
            ], check=False)
            self.update_run("synthesis_failed", error=str(exc))
            return False

    def launch_ui(self, final_status: str = "awaiting_decisions") -> None:
        self.update_run("launching_ui")
        binary = self.plugin_root / "dist" / "review-server"
        if binary.exists():
            cmd = [str(binary)]
        else:
            cmd = ["node", str(self.plugin_root / "server" / "review-server.js")]
        cmd.extend([
            "--run-dir", str(self.run_dir),
            "--session", self.run_id,
            "--platform", self.platform,
            "--save-dir", str(self.repo / "docs" / "code-reviews"),
        ])
        log = open(self.run_dir / "ui.log", "ab")
        env = os.environ.copy()
        env["CLAUDE_PLUGIN_ROOT"] = str(self.plugin_root)
        if self.platform:
            env["ACR_PLATFORM"] = self.platform
        if self.provider:
            env["ACR_REVIEW_PROVIDER"] = self.provider
        proc = subprocess.Popen(cmd, cwd=str(self.repo), stdout=log, stderr=subprocess.STDOUT, env=env)
        (self.run_dir / "ui.pid").write_text(str(proc.pid) + "\n", encoding="utf-8")
        (self.run_dir / "READY").write_text(utc_now() + "\n", encoding="utf-8")
        self.update_run(final_status, ui_pid=proc.pid, resume_command=f"/review-resume {self.run_id}")

    def run(self) -> int:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        (self.run_dir / "agents").mkdir(exist_ok=True)
        (self.run_dir / "prompts").mkdir(exist_ok=True)
        self.update_run("started", started_at=utc_now())
        diff, pr_meta, branch = self.snapshot()
        diff_hash = diff_sha256(diff)
        self.update_run("snapshotting", diff_sha256=diff_hash)
        files = split_diff_files(diff)
        (self.run_dir / "diff.txt").write_text(diff, encoding="utf-8")
        write_json(self.run_dir / "context.json", {
            "run_id": self.run_id,
            "repo": str(self.repo),
            "branch": branch,
            "timestamp": utc_now(),
            "diff_sha256": diff_hash,
            "pr": pr_meta,
            "files": files,
        })
        if not diff.strip():
            write_json(self.run_dir / "synthesis.json", {
                "run_id": self.run_id,
                "two_sentence_verdict": "No reviewable changes were found. There is nothing to decide for this run.",
                "deduped_findings": [],
                "dropped_findings_with_reason": [],
                "contradictions_resolved": [],
                "severity_rationale": {},
                "recommended_next_actions": [],
                "source_agent_result_files": [],
            })
            (self.run_dir / "READY").write_text(utc_now() + "\n", encoding="utf-8")
            self.update_run("no_changes")
            return 0
        self.run_reviewers()
        synthesis_ok = self.synthesize()
        self.launch_ui("awaiting_decisions" if synthesis_ok else "synthesis_failed")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--plugin-root", required=True)
    parser.add_argument("--platform", default="")
    parser.add_argument("--provider", default="")
    parser.add_argument("--pr")
    parser.add_argument("--review-timeout", type=int, default=int(os.environ.get("ACR_REVIEW_TIMEOUT_SECONDS", "900")))
    parser.add_argument("--synthesis-timeout", type=int, default=int(os.environ.get("ACR_SYNTHESIS_TIMEOUT_SECONDS", "600")))
    args = parser.parse_args()
    return Orchestrator(args).run()


if __name__ == "__main__":
    raise SystemExit(main())
