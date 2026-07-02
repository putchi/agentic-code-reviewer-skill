#!/usr/bin/env bash
set -euo pipefail

ORIGINAL_ARGS=("$@")

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
else
  ROOT_DIR="$(pwd)"
fi

# --- UI helpers ------------------------------------------------------------
# Colors/spinner degrade to plain text when stderr is not a terminal (CI, logs).
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  UI_TTY=1
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'
else
  UI_TTY=0
  C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""; C_RESET=""
fi

ui_header() { printf "\n%s%s%s\n" "$C_BOLD" "$1" "$C_RESET"; }
ui_step()   { printf "  %s✓%s %s\n" "$C_GREEN" "$C_RESET" "$1"; }
ui_info()   { printf "  %s•%s %s\n" "$C_DIM" "$C_RESET" "$1"; }
ui_warn()   { printf "  %s!%s %s\n" "$C_YELLOW" "$C_RESET" "$1" >&2; }
ui_path()   { printf "    %s%s%s\n" "$C_DIM" "$1" "$C_RESET"; }

# Run a command behind an animated spinner; prints ✓ on success, ✗ + output on failure.
ui_run() {
  local label="$1"; shift
  if [ "$UI_TTY" != "1" ]; then
    "$@"
    ui_step "$label"
    return 0
  fi
  local out rc=0
  out="$(mktemp)"
  ( "$@" ) >"$out" 2>&1 &
  local pid=$!
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏') i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  %s%s%s %s" "$C_CYAN" "${frames[i % 10]}" "$C_RESET" "$label" >&2
    i=$((i + 1))
    sleep 0.08
  done
  wait "$pid" || rc=$?
  if [ "$rc" = "0" ]; then
    printf "\r  %s✓%s %s\n" "$C_GREEN" "$C_RESET" "$label" >&2
  else
    printf "\r  %s✗%s %s\n" "$C_RED" "$C_RESET" "$label" >&2
    cat "$out" >&2
  fi
  rm -f "$out"
  return "$rc"
}

# Download url to dest with a modern progress bar (━━━╸─── 62% · 24.1 MB).
# Falls back to a byte counter when the server doesn't send Content-Length,
# and to silent curl when not on a terminal.
ui_download() {
  local url="$1" dest="$2" label="$3"
  if [ "$UI_TTY" != "1" ]; then
    curl -fsSL "$url" -o "$dest" 2>/dev/null
    return $?
  fi

  local total
  total="$(curl -fsIL "$url" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="content-length:"{n=$2} END{print n+0}')"
  [ -n "$total" ] || total=0

  curl -fsSL "$url" -o "$dest" 2>/dev/null &
  local pid=$! width=28 rc=0

  while kill -0 "$pid" 2>/dev/null; do
    local cur=0
    if [ -f "$dest" ]; then
      cur="$(stat -f%z "$dest" 2>/dev/null || stat -c%s "$dest" 2>/dev/null || echo 0)"
    fi
    local mb
    mb="$(awk -v b="$cur" 'BEGIN{printf "%.1f", b/1048576}')"
    if [ "$total" -gt 0 ]; then
      local filled=$((cur * width / total)) pct=$((cur * 100 / total)) bar="" i=0
      while [ $i -lt $filled ]; do bar="${bar}━"; i=$((i + 1)); done
      printf "\r  %s↓%s %s %s%s%s%s%s%s %d%% · %s MB\033[K" \
        "$C_CYAN" "$C_RESET" "$label" \
        "$C_CYAN" "$bar" "$C_RESET" \
        "$C_DIM" "$(printf '%*s' $((width - filled)) '' | sed 's/ /─/g')" "$C_RESET" \
        "$pct" "$mb" >&2
    else
      printf "\r  %s↓%s %s %s%s MB%s\033[K" "$C_CYAN" "$C_RESET" "$label" "$C_DIM" "$mb" "$C_RESET" >&2
    fi
    sleep 0.1
  done
  wait "$pid" || rc=$?

  if [ "$rc" = "0" ]; then
    printf "\r  %s✓%s %s\033[K\n" "$C_GREEN" "$C_RESET" "$label" >&2
  else
    printf "\r  %s✗%s %s\033[K\n" "$C_RED" "$C_RESET" "$label" >&2
  fi
  return "$rc"
}
# ---------------------------------------------------------------------------

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

  ui_header "Agentic Code Reviewer"
  if ! ui_download "$archive_url" "$tmp_dir/source.tar.gz" "Source (${repo}@${ref})"; then
    echo "Error: could not download ${archive_url}" >&2
    exit 1
  fi
  tar -xzf "$tmp_dir/source.tar.gz" -C "$tmp_dir" --strip-components=1
  rm -f "$tmp_dir/source.tar.gz"

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
  ./install.sh --platform both --force
  curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash -s -- --platform claude
  curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash -s -- --platform both --force

Platforms:
  claude  Install as a Claude Code plugin with hooks enabled
  codex   Install to ~/.codex/skills/agentic-code-reviewer and register review hooks
  both    Install the Claude Code plugin and the Codex skill

Flags:
  -y, --yes, --force   Skip all "Replace existing install?" prompts and overwrite
                       any existing Claude Code plugin and/or Codex skill in place.
                       Recommended for the curl one-liner and CI runs.
EOF
}

PLATFORM=""
FORCE=0

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
    -y|--yes|--force)
      FORCE=1
      shift
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

download_server_binary() {
  local target_dir="$1"
  local local_binary="$ROOT_DIR/dist/review-server"
  local plugin_json="$target_dir/.claude-plugin/plugin.json"
  local tag

  if [ -x "$local_binary" ]; then
    mkdir -p "$target_dir/dist"
    cp "$local_binary" "$target_dir/dist/review-server"
    chmod +x "$target_dir/dist/review-server"
    ui_step "Server binary installed (local build)"
    return 0
  fi

  if [ -f "$plugin_json" ]; then
    tag="v$(json_value "$plugin_json" version 2>/dev/null || true)"
  fi
  if [ -z "${tag:-}" ] || [ "$tag" = "v" ]; then
    tag="latest"
  fi

  local platform
  case "$(uname -s)" in
    Darwin)
      case "$(uname -m)" in
        arm64) platform="darwin-arm64" ;;
        *)     platform="darwin-x64" ;;
      esac ;;
    Linux)
      case "$(uname -m)" in
        arm64|aarch64) platform="linux-arm64" ;;
        *)             platform="linux-x64" ;;
      esac ;;
    *)
      ui_warn "Unsupported platform — server binary not downloaded. Run 'bun install && bun run build && bun run compile' manually."
      return 0 ;;
  esac

  local binary_name="review-server-${platform}"
  local base_url="https://github.com/putchi/agentic-code-reviewer-skill/releases/download/${tag}"

  mkdir -p "$target_dir/dist"
  if ui_download "${base_url}/${binary_name}" "$target_dir/dist/review-server" "Server binary (${platform}, ${tag})"; then
    chmod +x "$target_dir/dist/review-server"
  else
    ui_warn "Could not download server binary (release ${tag} may not exist yet). Run 'bun install && bun run build && bun run compile' manually."
  fi
}

verify_review_last_surface() {
  local target_dir="$1"
  local problems=0

  if [ ! -f "$target_dir/commands/agentic-code-reviewer-last.md" ]; then
    echo "Error: legacy /agentic-code-reviewer-last alias missing from install tree: $target_dir/commands/agentic-code-reviewer-last.md" >&2
    problems=1
  fi
  if [ ! -f "$target_dir/skills/agentic-code-reviewer-last/SKILL.md" ]; then
    echo "Error: legacy agentic-code-reviewer:last skill alias missing from install tree: $target_dir/skills/agentic-code-reviewer-last/SKILL.md" >&2
    problems=1
  fi
  if [ ! -f "$target_dir/commands/review-last.md" ]; then
    echo "Error: /review-last command missing from install tree: $target_dir/commands/review-last.md" >&2
    problems=1
  fi
  if [ ! -f "$target_dir/skills/review-last/SKILL.md" ]; then
    echo "Error: review-last skill missing from install tree: $target_dir/skills/review-last/SKILL.md" >&2
    problems=1
  fi

  if [ "$problems" = "1" ]; then
    exit 1
  fi
}

codex_is_installed() {
  [ -d "$HOME/.codex" ] || command -v codex >/dev/null 2>&1
}

register_codex_review_hooks() {
  local hooks_file="$HOME/.codex/hooks.json"
  local config_file="$HOME/.codex/config.toml"

  if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required to configure Codex hooks." >&2
    exit 1
  fi

  mkdir -p "$HOME/.codex"
  python3 "$ROOT_DIR/scripts/codex-install-config.py" \
    --hooks-file "$hooks_file" \
    --config-file "$config_file" >/dev/null

  ui_step "Codex review hooks registered"
  ui_path "$hooks_file"
  ui_step "Codex hooks feature enabled"
  ui_path "$config_file"
  ui_info "If Codex asks for hook trust, review/approve it with /hooks."
}

install_codex_skill() {
  local on_decline="${1:-cancel}"
  local target_dir="$HOME/.codex/skills/agentic-code-reviewer"

  local skill_md="$ROOT_DIR/skills/agentic-code-reviewer/SKILL.md"
  local agents_dir="$ROOT_DIR/agents"
  local refs_dir="$ROOT_DIR/references"
  local server_dir="$ROOT_DIR/server"
  local scripts_dir="$ROOT_DIR/scripts"

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
  if [ ! -d "$server_dir" ]; then
    echo "Error: server directory not found: $server_dir" >&2
    exit 1
  fi
  if [ ! -d "$scripts_dir" ]; then
    echo "Error: scripts directory not found: $scripts_dir" >&2
    exit 1
  fi

  ui_header "Codex skill"

  if [ -e "$target_dir" ]; then
    if [ "$FORCE" = "1" ]; then
      ui_info "Overwriting existing install (--force)"
    else
      if ! read_prompt CONFIRM "Replace existing install at $target_dir? [y/N] "; then
        echo "Install cancelled."
        exit 0
      fi
      case "$CONFIRM" in
        y|Y|yes|YES) ;;
        *)
          if [ "$on_decline" = "skip" ]; then
            ui_info "Skipped Codex install"
            ui_path "$target_dir"
            return 0
          fi
          echo "Install cancelled."
          exit 0
          ;;
      esac
    fi
  fi

  ui_run "Skill files copied" copy_repo_tree "$target_dir"
  verify_review_last_surface "$target_dir"
  chmod +x "$target_dir/scripts/"*.sh "$target_dir/scripts/"*.py 2>/dev/null || true
  download_server_binary "$target_dir"
  register_codex_review_hooks

  ui_step "${C_BOLD}Codex skill installed${C_RESET}"
  ui_path "$target_dir"
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

  if [ "$FORCE" = "1" ]; then
    rm -rf "$legacy_dir"
    echo "Removed legacy manual Claude plugin (--force):"
    echo "  $legacy_dir"
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

  ui_header "Claude Code plugin"

  if [ -e "$marketplace_dir" ] || [ -e "$cache_dir" ]; then
    if [ "$FORCE" = "1" ]; then
      ui_info "Overwriting existing install (--force)"
    else
      if ! read_prompt CONFIRM "Replace existing Claude plugin install for Agentic Code Reviewer? [y/N] "; then
        echo "Install cancelled."
        exit 0
      fi
      case "$CONFIRM" in
        y|Y|yes|YES) ;;
        *)
          if [ "$on_decline" = "skip" ]; then
            ui_info "Skipped Claude Code plugin install"
            ui_path "$marketplace_dir"
            return 0
          fi
          echo "Install cancelled."
          exit 0
          ;;
      esac
    fi
  fi

  ui_run "Plugin files copied (v${plugin_version})" copy_repo_tree "$marketplace_dir"
  verify_review_last_surface "$marketplace_dir"

  # Remove stale versioned cache dirs so old manifests don't cause validation errors on reload.
  local cache_plugin_root="$plugin_root/cache/agentic-code-reviewer-skill/agentic-code-reviewer"
  if [ -d "$cache_plugin_root" ]; then
    find "$cache_plugin_root" -mindepth 1 -maxdepth 1 -type d ! -name "$plugin_version" -exec rm -rf {} +
  fi

  ui_run "Plugin cache updated" copy_repo_tree "$cache_dir"
  verify_review_last_surface "$cache_dir"

  download_server_binary "$marketplace_dir"
  download_server_binary "$cache_dir"

  chmod +x "$marketplace_dir/hooks/code-review-gate.sh" "$marketplace_dir/hooks/check-update.sh" 2>/dev/null || true
  chmod +x "$cache_dir/hooks/code-review-gate.sh" "$cache_dir/hooks/check-update.sh" 2>/dev/null || true
  chmod +x "$marketplace_dir/scripts/"*.sh "$marketplace_dir/scripts/"*.py 2>/dev/null || true
  chmod +x "$cache_dir/scripts/"*.sh "$cache_dir/scripts/"*.py 2>/dev/null || true

  update_claude_plugin_settings "$settings_file" "$known_marketplaces_file" "$marketplace_dir"
  remove_legacy_claude_skill

  ui_step "${C_BOLD}Claude Code plugin installed${C_RESET}"
  ui_path "$cache_dir"
  ui_info "Run /reload-plugins in active Claude Code sessions."
}

if [ "${AGENTIC_REVIEWER_BOOTSTRAPPED:-}" != "1" ]; then
  ui_header "Agentic Code Reviewer"
fi

if [ -z "$PLATFORM" ]; then
  if ! codex_is_installed; then
    ui_info "Codex not detected — installing for Claude Code only."
    PLATFORM="claude"
  elif [ "$FORCE" = "1" ]; then
    ui_info "Codex detected; --force set without --platform → installing for both."
    PLATFORM="both"
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
      ui_info "Codex not detected — skipping Codex install, installing Claude Code only."
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

printf "\n%s✔ Done.%s\n" "${C_GREEN}${C_BOLD}" "$C_RESET"
