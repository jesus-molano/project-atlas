#!/usr/bin/env bash

# Shared helpers for the native Linux installer and read-only doctor.

atlas_log() {
  printf '[frontend-codex-kit] %s\n' "$*"
}

atlas_die() {
  printf '[frontend-codex-kit] ERROR: %s\n' "$*" >&2
}

atlas_absolute_path() {
  realpath -m -- "$1"
}

atlas_require_command() {
  local name="$1"
  local guidance="$2"
  local executable
  executable="$(command -v -- "$name" 2>/dev/null || true)"
  if [[ -z "$executable" ]]; then
    atlas_die "$name is required. $guidance"
    return 1
  fi
  printf '%s\n' "$executable"
}

atlas_test_node_executable() {
  local candidate="$1"
  local version
  [[ -n "$candidate" && -x "$candidate" ]] || return 1
  version="$("$candidate" --version 2>/dev/null | head -n 1)" || return 1
  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]
}

atlas_resolve_stable_node() {
  local node_command
  local candidate
  local active_version

  node_command="$(command -v node 2>/dev/null || true)"
  if [[ -z "$node_command" ]]; then
    atlas_die "node is required. Install Node.js 24 or newer."
    return 1
  fi

  if command -v fnm >/dev/null 2>&1; then
    active_version="$(fnm current 2>/dev/null | head -n 1 || true)"
    if [[ -n "$active_version" ]]; then
      while IFS= read -r candidate; do
        if [[
          -n "$candidate"
          && "$candidate" != *'/fnm_multishells/'*
        ]] && atlas_test_node_executable "$candidate"; then
          atlas_absolute_path "$candidate"
          return 0
        fi
      done < <(
        fnm exec --using "$active_version" node -p 'process.execPath' 2>/dev/null \
          || true
      )
    fi
  fi

  candidate="$("$node_command" -p 'process.execPath' 2>/dev/null | head -n 1)" \
    || true
  if [[ -z "$candidate" ]]; then
    candidate="$node_command"
  fi
  candidate="$(atlas_absolute_path "$candidate")"
  if [[ "$candidate" == *'/fnm_multishells/'* ]]; then
    atlas_die "Node resolves to an ephemeral fnm multishell path ($candidate). Activate an installed fnm version, then rerun."
    return 1
  fi
  if ! atlas_test_node_executable "$candidate"; then
    atlas_die "The resolved Node executable is not usable: $candidate"
    return 1
  fi
  printf '%s\n' "$candidate"
}

atlas_path_equal() {
  [[ -n "${1:-}" && -n "${2:-}" && "$1" == "$2" ]]
}

atlas_resolve_link_target() {
  local target="$1"
  local candidate
  candidate="$(readlink -- "$target" 2>/dev/null)" || return 1
  if [[ "$candidate" == /* ]]; then
    realpath -m -- "$candidate"
  else
    realpath -m -- "$(dirname -- "$target")/$candidate"
  fi
}

atlas_skill_fingerprint() {
  local node="$1"
  local helper="$2"
  local root="$3"
  "$node" "$helper" "$root"
}

atlas_print_command() {
  local argument
  printf '  '
  printf '%q' "$1"
  shift
  for argument in "$@"; do
    printf ' %q' "$argument"
  done
  printf '\n'
}

atlas_run() {
  local dry_run="$1"
  local description="$2"
  shift 2
  if [[ "$dry_run" == "true" ]]; then
    atlas_log "DRY RUN: $description"
    atlas_print_command "$@"
    return 0
  fi
  atlas_log "$description"
  if "$@"; then
    return 0
  else
    local status=$?
    atlas_die "$description failed with exit code $status."
    return "$status"
  fi
}

atlas_validate_choice() {
  local label="$1"
  local value="$2"
  shift 2
  local allowed
  for allowed in "$@"; do
    [[ "$value" == "$allowed" ]] && return 0
  done
  atlas_die "$label must be one of: $*. Found: $value"
  return 1
}
