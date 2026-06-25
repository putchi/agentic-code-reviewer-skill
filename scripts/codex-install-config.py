#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
import os
import re
from pathlib import Path
from typing import Any


DEFAULT_HOOK_COMMAND = '/bin/bash "$HOME/.codex/skills/agentic-code-reviewer/hooks/code-review-gate.sh"'
DEFAULT_HOOK_TIMEOUT_SECONDS = 210
LEGACY_HOOK_COMMANDS = {
    'bash "$HOME/.codex/skills/agentic-code-reviewer/hooks/code-review-gate.sh"',
    "bash $HOME/.codex/skills/agentic-code-reviewer/hooks/code-review-gate.sh",
}
AGENTIC_REVIEW_HOOK_COMMANDS = {DEFAULT_HOOK_COMMAND, *LEGACY_HOOK_COMMANDS}


def load_hooks_json(path: Path) -> dict[str, Any]:
    if not path.exists() or not path.read_text(encoding="utf-8").strip():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def stop_hook_commands(data: dict[str, Any]) -> list[str]:
    hooks = data.get("hooks")
    if not isinstance(hooks, dict):
        return []
    stop = hooks.get("Stop")
    if not isinstance(stop, list):
        return []
    commands: list[str] = []
    for entry in stop:
        if not isinstance(entry, dict):
            continue
        for hook in entry.get("hooks", []):
            if isinstance(hook, dict) and hook.get("type") == "command":
                command = hook.get("command")
                if isinstance(command, str):
                    commands.append(command)
    return commands


def is_agentic_review_stop_hook(command: Any) -> bool:
    return isinstance(command, str) and command in AGENTIC_REVIEW_HOOK_COMMANDS


def merge_codex_stop_hook(data: dict[str, Any], command: str = DEFAULT_HOOK_COMMAND) -> bool:
    hooks = data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("hooks.json field 'hooks' must be an object")
    stop = hooks.setdefault("Stop", [])
    if not isinstance(stop, list):
        raise ValueError("hooks.json field 'hooks.Stop' must be an array")

    changed = False
    found = False
    next_stop: list[Any] = []
    for entry in stop:
        if not isinstance(entry, dict):
            next_stop.append(entry)
            continue
        entry_hooks = entry.get("hooks", [])
        if not isinstance(entry_hooks, list):
            next_stop.append(entry)
            continue

        next_hooks: list[Any] = []
        for hook in entry_hooks:
            if not isinstance(hook, dict) or hook.get("type") != "command":
                next_hooks.append(hook)
                continue
            if not is_agentic_review_stop_hook(hook.get("command")):
                next_hooks.append(hook)
                continue
            if found:
                changed = True
                continue
            found = True
            if hook.get("command") != command:
                hook["command"] = command
                changed = True
            if hook.get("timeout") != DEFAULT_HOOK_TIMEOUT_SECONDS:
                hook["timeout"] = DEFAULT_HOOK_TIMEOUT_SECONDS
                changed = True
            next_hooks.append(hook)

        if len(next_hooks) != len(entry_hooks):
            changed = True
        if next_hooks or set(entry.keys()) != {"hooks"}:
            entry["hooks"] = next_hooks
            next_stop.append(entry)
        else:
            changed = True
    if found:
        if next_stop != stop:
            hooks["Stop"] = next_stop
            changed = True
        return changed

    stop.append({
        "hooks": [
            {
                "type": "command",
                "command": command,
                "timeout": DEFAULT_HOOK_TIMEOUT_SECONDS,
            }
        ]
    })
    return True


FEATURES_HEADER_RE = re.compile(r"^\s*\[features\]\s*(?:#.*)?$")
TABLE_HEADER_RE = re.compile(r"^\s*\[[^\]]+\]\s*(?:#.*)?$")
HOOKS_ASSIGN_RE = re.compile(r"^(\s*)hooks\s*=\s*[^#\n]*(\s+#.*)?$")


def ensure_codex_hooks_feature(config_text: str) -> tuple[str, bool]:
    if not config_text.strip():
        return "[features]\nhooks = true\n", True

    lines = config_text.splitlines(keepends=True)
    features_start: int | None = None
    features_end = len(lines)

    for index, line in enumerate(lines):
        if FEATURES_HEADER_RE.match(line.rstrip("\r\n")):
            features_start = index
            for end_index in range(index + 1, len(lines)):
                candidate = lines[end_index].rstrip("\r\n")
                if TABLE_HEADER_RE.match(candidate):
                    features_end = end_index
                    break
            break

    if features_start is None:
        prefix = "" if config_text.endswith("\n") else "\n"
        separator = "\n" if config_text.strip() else ""
        return f"{config_text}{prefix}{separator}[features]\nhooks = true\n", True

    for index in range(features_start + 1, features_end):
        raw = lines[index]
        line = raw.rstrip("\r\n")
        match = HOOKS_ASSIGN_RE.match(line)
        if not match:
            continue
        replacement = f"{match.group(1)}hooks = true{match.group(2) or ''}"
        newline = "\n" if raw.endswith("\n") else ""
        if raw.endswith("\r\n"):
            newline = "\r\n"
        next_line = replacement + newline
        if next_line == raw:
            return config_text, False
        lines[index] = next_line
        return "".join(lines), True

    if not lines[features_start].endswith(("\n", "\r")):
        lines[features_start] = lines[features_start] + "\n"
    insert_at = features_start + 1
    lines.insert(insert_at, "hooks = true\n")
    return "".join(lines), True


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def configure_codex_hooks(hooks_file: Path, config_file: Path, command: str = DEFAULT_HOOK_COMMAND) -> dict[str, bool]:
    hooks_data = load_hooks_json(hooks_file)
    hook_added = merge_codex_stop_hook(hooks_data, command)
    if hook_added or not hooks_file.exists():
        write_json_atomic(hooks_file, hooks_data)

    current_config = config_file.read_text(encoding="utf-8") if config_file.exists() else ""
    next_config, config_changed = ensure_codex_hooks_feature(current_config)
    if config_changed or not config_file.exists():
        write_text_atomic(config_file, next_config)

    return {
        "hook_added": hook_added,
        "config_changed": config_changed,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hooks-file", required=True)
    parser.add_argument("--config-file", required=True)
    parser.add_argument("--command", default=DEFAULT_HOOK_COMMAND)
    args = parser.parse_args()

    result = configure_codex_hooks(Path(args.hooks_file), Path(args.config_file), args.command)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
