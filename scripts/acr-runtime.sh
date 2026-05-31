#!/usr/bin/env bash

acr_normalize_platform() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    claude|claude-code|claudecode) printf 'claude' ;;
    codex|openai|openai-codex) printf 'codex' ;;
    *) printf '' ;;
  esac
}

acr_detect_platform() {
  local plugin_root="${1:-}"
  local explicit="${2:-}"
  local detected
  detected="$(acr_normalize_platform "${ACR_PLATFORM:-}")"
  if [ -n "$detected" ]; then printf '%s' "$detected"; return 0; fi

  detected="$(acr_normalize_platform "$explicit")"
  if [ -n "$detected" ]; then printf '%s' "$detected"; return 0; fi

  if [ -n "${CLAUDE_SESSION_ID:-}" ]; then printf 'claude'; return 0; fi
  if [ -n "${CODEX_THREAD_ID:-}" ]; then printf 'codex'; return 0; fi

  case "$plugin_root" in
    */.codex/skills/*) printf 'codex'; return 0 ;;
    */.claude/plugins/*|*/.claude/*) printf 'claude'; return 0 ;;
  esac

  printf ''
}

acr_detect_provider() {
  local plugin_root="${1:-}"
  local explicit_platform="${2:-}"
  local override
  override="$(acr_normalize_platform "${ACR_REVIEW_PROVIDER:-}")"
  if [ -n "$override" ]; then printf '%s' "$override"; return 0; fi

  local platform
  platform="$(acr_detect_platform "$plugin_root" "$explicit_platform")"
  if [ "$platform" = "codex" ]; then printf 'codex'; return 0; fi
  printf 'claude'
}

acr_model_for_role() {
  local provider="$1"
  local role="$2"
  local override=""
  case "$role" in
    balanced) override="${ACR_MODEL_BALANCED:-}" ;;
    fast) override="${ACR_MODEL_FAST:-}" ;;
    judge) override="${ACR_MODEL_JUDGE:-}" ;;
  esac
  if [ -n "$override" ]; then printf '%s' "$override"; return 0; fi

  if [ "$provider" = "codex" ]; then
    case "$role" in
      fast) printf 'gpt-5.4-mini' ;;
      judge) printf 'gpt-5.5' ;;
      *) printf 'gpt-5.4' ;;
    esac
  else
    case "$role" in
      fast) printf 'haiku' ;;
      judge) printf 'opus' ;;
      *) printf 'sonnet' ;;
    esac
  fi
}

acr_codex_reasoning_for_role() {
  local role="$1"
  local override=""
  case "$role" in
    balanced) override="${ACR_CODEX_REASONING_BALANCED:-}" ;;
    fast) override="${ACR_CODEX_REASONING_FAST:-}" ;;
    judge) override="${ACR_CODEX_REASONING_JUDGE:-}" ;;
  esac
  case "$override" in
    minimal|low|medium|high|xhigh) printf '%s' "$override"; return 0 ;;
  esac
  case "$role" in
    fast) printf 'low' ;;
    judge) printf 'high' ;;
    *) printf 'medium' ;;
  esac
}

acr_validate_provider() {
  local provider="$1"
  case "$provider" in
    claude)
      if ! command -v "${ACR_CLAUDE_BIN:-claude}" >/dev/null 2>&1; then
        echo "ERROR: claude CLI with --print support is required for Claude review runtime." >&2
        return 1
      fi
      ;;
    codex)
      if ! command -v "${ACR_CODEX_BIN:-codex}" >/dev/null 2>&1; then
        echo "ERROR: codex CLI is required for Codex review runtime." >&2
        return 1
      fi
      ;;
    *)
      echo "ERROR: unsupported review provider: ${provider}" >&2
      return 1
      ;;
  esac
}

acr_build_subprocess_command() {
  local role="$1"
  local output_file="${2:-}"
  ACR_SUBPROCESS_PROVIDER="$(acr_detect_provider "${PLUGIN_ROOT:-}" "${ACR_PLATFORM:-}")"
  ACR_SUBPROCESS_MODEL="$(acr_model_for_role "$ACR_SUBPROCESS_PROVIDER" "$role")"
  ACR_SUBPROCESS_STDOUT="$output_file"
  ACR_SUBPROCESS_CMD=()

  if [ "$ACR_SUBPROCESS_PROVIDER" = "codex" ]; then
    ACR_SUBPROCESS_REASONING="$(acr_codex_reasoning_for_role "$role")"
    ACR_SUBPROCESS_STDOUT="${output_file}.events.jsonl"
    ACR_SUBPROCESS_CMD=(
      "${ACR_CODEX_BIN:-codex}" exec
      --json
      --model "$ACR_SUBPROCESS_MODEL"
      --config "model_reasoning_effort=${ACR_SUBPROCESS_REASONING}"
      --sandbox read-only
      --output-last-message "$output_file"
      -
    )
  else
    ACR_SUBPROCESS_REASONING=""
    ACR_SUBPROCESS_CMD=(
      "${ACR_CLAUDE_BIN:-claude}"
      --disable-slash-commands
      --tools ""
      --print
      --output-format json
      --model "$ACR_SUBPROCESS_MODEL"
    )
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --print-command)
      shift
      role="${1:-balanced}"
      output_file="${2:-/tmp/acr-output.json}"
      acr_build_subprocess_command "$role" "$output_file"
      printf 'provider=%s\n' "$ACR_SUBPROCESS_PROVIDER"
      printf 'model=%s\n' "$ACR_SUBPROCESS_MODEL"
      if [ -n "${ACR_SUBPROCESS_REASONING:-}" ]; then printf 'reasoning=%s\n' "$ACR_SUBPROCESS_REASONING"; fi
      printf 'stdout=%s\n' "$ACR_SUBPROCESS_STDOUT"
      printf 'argv:'
      for arg in "${ACR_SUBPROCESS_CMD[@]}"; do printf '\n%s' "$arg"; done
      printf '\n'
      ;;
    *)
      echo "Usage: acr-runtime.sh --print-command ROLE OUTPUT_FILE" >&2
      exit 2
      ;;
  esac
fi
