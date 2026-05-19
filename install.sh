#!/usr/bin/env bash
set -euo pipefail

ORIGINAL_ARGS=("$@")

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
else
  ROOT_DIR="$(pwd)"
fi

read_prompt() {
  local var_name="$1"
  local prompt="$2"

  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf "%s" "$prompt" > /dev/tty
    IFS= read -r "$var_name" < /dev/tty
  else
    printf "%s" "$prompt" >&2
    IFS= read -r "$var_name"
  fi
}

bootstrap_from_remote() {
  if [ "${AGENTIC_REVIEWER_BOOTSTRAPPED:-}" = "1" ]; then
    echo "Error: source skill not found after downloading Agentic Code Reviewer." >&2
    exit 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required for remote installation." >&2
    exit 1
  fi

  if ! command -v tar >/dev/null 2>&1; then
    echo "Error: tar is required for remote installation." >&2
    exit 1
  fi

  local repo="${AGENTIC_REVIEWER_REPO:-putchi/agentic-code-reviewer-skill}"
  local ref="${AGENTIC_REVIEWER_REF:-main}"
  local archive_url="${AGENTIC_REVIEWER_ARCHIVE_URL:-https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}}"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  AGENTIC_REVIEWER_TMP_DIR="$tmp_dir"

  cleanup() {
    rm -rf "$AGENTIC_REVIEWER_TMP_DIR"
  }
  trap cleanup EXIT

  echo "Downloading Agentic Code Reviewer from ${repo}@${ref}..."
  curl -fsSL "$archive_url" | tar -xz -C "$tmp_dir" --strip-components=1

  if [ ${#ORIGINAL_ARGS[@]} -gt 0 ]; then
    AGENTIC_REVIEWER_BOOTSTRAPPED=1 bash "$tmp_dir/install.sh" "${ORIGINAL_ARGS[@]}"
  else
    AGENTIC_REVIEWER_BOOTSTRAPPED=1 bash "$tmp_dir/install.sh"
  fi
  exit $?
}

print_usage() {
  cat <<'EOF'
Usage:
  ./install.sh
  ./install.sh --platform claude
  ./install.sh --platform codex
  ./install.sh --platform both
  curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash -s -- --platform claude
  curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash -s -- --platform both

Platforms:
  claude  Install as a Claude Code plugin with hooks enabled
  codex   Install to ~/.codex/skills/agentic-code-reviewer
  both    Install the Claude Code plugin and the Codex skill
EOF
}

PLATFORM=""

while [ $# -gt 0 ]; do
  case "$1" in
    --platform)
      if [ $# -lt 2 ]; then
        echo "Error: --platform requires claude, codex, or both." >&2
        exit 1
      fi
      PLATFORM="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$ROOT_DIR/skills" ]; then
  bootstrap_from_remote
fi

json_value() {
  local file="$1"
  local key="$2"
  python3 - "$file" "$key" <<'PY'
import json
import sys

path, key = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding="utf-8") as f:
        value = json.load(f).get(key, "")
except Exception:
    value = ""
print(value)
PY
}

copy_repo_tree() {
  local target_dir="$1"
  local source_real
  local target_real=""

  source_real="$(cd "$ROOT_DIR" && pwd -P)"
  if [ -d "$target_dir" ]; then
    target_real="$(cd "$target_dir" && pwd -P)"
  fi

  if [ "$source_real" = "$target_real" ]; then
    return 0
  fi

  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  (
    cd "$ROOT_DIR"
    tar -cf - --exclude .git --exclude .DS_Store .
  ) | (
    cd "$target_dir"
    tar -xf -
  )
}

codex_is_installed() {
  [ -d "$HOME/.codex" ] || command -v codex >/dev/null 2>&1
}

install_codex_skill() {
  local on_decline="${1:-cancel}"
  local target_dir="$HOME/.codex/skills/agentic-code-reviewer"

  local skill_md="$ROOT_DIR/skills/agentic-code-reviewer/SKILL.md"
  local agents_dir="$ROOT_DIR/agents"
  local refs_dir="$ROOT_DIR/references"

  if [ ! -f "$skill_md" ]; then
    echo "Error: source skill not found: $skill_md" >&2
    exit 1
  fi
  if [ ! -d "$agents_dir" ]; then
    echo "Error: agents directory not found: $agents_dir" >&2
    exit 1
  fi
  if [ ! -d "$refs_dir" ]; then
    echo "Error: references directory not found: $refs_dir" >&2
    exit 1
  fi

  if [ -e "$target_dir" ]; then
    if ! read_prompt CONFIRM "Replace existing install at $target_dir? [y/N] "; then
      echo "Install cancelled."
      exit 0
    fi
    case "$CONFIRM" in
      y|Y|yes|YES) ;;
      *)
        if [ "$on_decline" = "skip" ]; then
          echo "Skipped Agentic Code Reviewer for codex:"
          echo "  $target_dir"
          return 0
        fi
        echo "Install cancelled."
        exit 0
        ;;
    esac
    rm -rf "$target_dir"
  fi

  mkdir -p "$target_dir"
  cp "$skill_md" "$target_dir/SKILL.md"
  cp -R "$agents_dir" "$target_dir/agents"
  cp -R "$refs_dir" "$target_dir/references"

  echo "Installed Agentic Code Reviewer for codex:"
  echo "  $target_dir"
}

update_claude_plugin_settings() {
  local settings_file="$1"
  local known_marketplaces_file="$2"
  local marketplace_dir="$3"
  local repo="${AGENTIC_REVIEWER_REPO:-putchi/agentic-code-reviewer-skill}"

  python3 - "$settings_file" "$known_marketplaces_file" "$marketplace_dir" "$repo" <<'PY'
import datetime
import json
import os
import sys

settings_file, known_file, marketplace_dir, repo = sys.argv[1:5]

def load_json(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)

settings = load_json(settings_file)
enabled = settings.setdefault("enabledPlugins", {})
enabled["agentic-code-reviewer@agentic-code-reviewer-skill"] = True
extra = settings.setdefault("extraKnownMarketplaces", {})
extra["agentic-code-reviewer-skill"] = {
    "source": {
        "source": "github",
        "repo": repo,
    }
}
write_json(settings_file, settings)

known = load_json(known_file)
known["agentic-code-reviewer-skill"] = {
    "source": {
        "source": "github",
        "repo": repo,
    },
    "installLocation": marketplace_dir,
    "lastUpdated": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
}
write_json(known_file, known)
PY
}

remove_legacy_claude_skill() {
  local legacy_dir="$HOME/.claude/plugins/agentic-code-reviewer"

  if [ ! -e "$legacy_dir" ]; then
    return 0
  fi

  if ! read_prompt CONFIRM "Remove legacy manual Claude plugin install at $legacy_dir? [y/N] "; then
    echo "Legacy manual Claude plugin left in place:"
    echo "  $legacy_dir"
    return 0
  fi

  case "$CONFIRM" in
    y|Y|yes|YES)
      rm -rf "$legacy_dir"
      echo "Removed legacy manual Claude plugin:"
      echo "  $legacy_dir"
      ;;
    *)
      echo "Legacy manual Claude plugin left in place:"
      echo "  $legacy_dir"
      ;;
  esac
}

install_claude_plugin() {
  local on_decline="${1:-cancel}"
  local plugin_json="$ROOT_DIR/.claude-plugin/plugin.json"
  local source_skill_dir="$ROOT_DIR/skills/agentic-code-reviewer"
  local hooks_file="$ROOT_DIR/hooks/hooks.json"

  if [ ! -f "$plugin_json" ]; then
    echo "Error: Claude plugin manifest not found: $plugin_json" >&2
    exit 1
  fi
  if [ ! -d "$source_skill_dir" ]; then
    echo "Error: Claude plugin skill not found: $source_skill_dir" >&2
    exit 1
  fi
  if [ ! -f "$hooks_file" ]; then
    echo "Error: Claude plugin hooks not found: $hooks_file" >&2
    exit 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required to install the Claude plugin metadata." >&2
    exit 1
  fi

  local plugin_version
  plugin_version="$(json_value "$plugin_json" version)"
  if [ -z "$plugin_version" ]; then
    echo "Error: could not read version from $plugin_json" >&2
    exit 1
  fi

  local claude_dir="$HOME/.claude"
  local plugin_root="$claude_dir/plugins"
  local marketplace_dir="$plugin_root/marketplaces/agentic-code-reviewer-skill"
  local cache_dir="$plugin_root/cache/agentic-code-reviewer-skill/agentic-code-reviewer/$plugin_version"
  local settings_file="$claude_dir/settings.json"
  local known_marketplaces_file="$plugin_root/known_marketplaces.json"

  if [ -e "$marketplace_dir" ] || [ -e "$cache_dir" ]; then
    if ! read_prompt CONFIRM "Replace existing Claude plugin install for Agentic Code Reviewer? [y/N] "; then
      echo "Install cancelled."
      exit 0
    fi
    case "$CONFIRM" in
      y|Y|yes|YES) ;;
      *)
        if [ "$on_decline" = "skip" ]; then
          echo "Skipped Agentic Code Reviewer for claude:"
          echo "  $marketplace_dir"
          return 0
        fi
        echo "Install cancelled."
        exit 0
        ;;
    esac
  fi

  copy_repo_tree "$marketplace_dir"
  copy_repo_tree "$cache_dir"

  chmod +x "$marketplace_dir/hooks/code-review-gate.sh" "$marketplace_dir/hooks/check-update.sh" 2>/dev/null || true
  chmod +x "$cache_dir/hooks/code-review-gate.sh" "$cache_dir/hooks/check-update.sh" 2>/dev/null || true

  update_claude_plugin_settings "$settings_file" "$known_marketplaces_file" "$marketplace_dir"
  remove_legacy_claude_skill

  echo "Installed Agentic Code Reviewer for claude as a Claude Code plugin:"
  echo "  $cache_dir"
  echo "Run /reload-plugins in active Claude Code sessions."
}

if [ -z "$PLATFORM" ]; then
  if ! codex_is_installed; then
    echo "Codex not detected — installing for Claude Code only."
    PLATFORM="claude"
  else
    echo "Install Agentic Code Reviewer for:"
    echo "  1) Claude Code plugin (hooks enabled)  [default]"
    echo "  2) Codex (~/.codex/skills/agentic-code-reviewer)"
    echo "  3) Both"
    if ! read_prompt CHOICE "Choose 1, 2, or 3 [1]: "; then
      echo "Error: --platform claude, --platform codex, or --platform both is required when no terminal is available." >&2
      exit 1
    fi
    case "$CHOICE" in
      1|"") PLATFORM="claude" ;;
      2) PLATFORM="codex" ;;
      3) PLATFORM="both" ;;
      *)
        echo "Error: choose 1, 2, or 3." >&2
        exit 1
        ;;
    esac
  fi
fi

case "$PLATFORM" in
  claude)
    install_claude_plugin
    ;;
  codex)
    if ! codex_is_installed; then
      echo "Error: Codex not detected. Install Codex first or use --platform claude." >&2
      exit 1
    fi
    install_codex_skill
    ;;
  both)
    if ! codex_is_installed; then
      echo "Codex not detected — skipping Codex install, installing Claude Code only."
      install_claude_plugin
    else
      install_claude_plugin skip
      install_codex_skill skip
    fi
    ;;
  *)
    echo "Error: platform must be claude, codex, or both." >&2
    exit 1
    ;;
esac
