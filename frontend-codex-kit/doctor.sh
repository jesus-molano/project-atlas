#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/kit-common.sh
source "$SCRIPT_DIR/lib/kit-common.sh"

usage() {
  cat <<'EOF'
Read-only Project Atlas installation checks for Linux.

Usage: bash ./frontend-codex-kit/doctor.sh [options]

Options:
  --atlas-root <path>          Stable Project Atlas clone
  --codex-skills-root <path>   Codex skill installation root
  --codex-config-path <path>   Codex config.toml to inspect
  --skip-mcp-smoke             Skip the live stdio core-profile smoke
  -h, --help                   Show this help
EOF
}

require_option_value() {
  local option="$1"
  local remaining="$2"
  local value="${3:-}"
  if (( remaining < 2 )) || [[ -z "$value" || "$value" == -* ]]; then
    atlas_die "Missing value for $option."
    exit 2
  fi
}

write_check() {
  local passed="$1"
  local name="$2"
  local detail="$3"
  local fix="$4"
  if [[ "$passed" == "true" ]]; then
    printf '[PASS] %s - %s\n' "$name" "$detail"
    return 0
  fi
  doctor_failures=$((doctor_failures + 1))
  printf '[FAIL] %s - %s\n' "$name" "$detail"
  if [[ -n "$fix" ]]; then
    printf '       Fix: %s\n' "$fix"
  fi
}

if [[ "$(uname -s)" != "Linux" ]]; then
  atlas_die "This native doctor supports Linux. On Windows use doctor.ps1."
  exit 1
fi

atlas_root=""
codex_skills_root="$HOME/.agents/skills"
codex_config_path=""
skip_mcp_smoke="false"

while (( $# > 0 )); do
  case "$1" in
    --atlas-root)
      require_option_value "$1" "$#" "${2:-}"
      atlas_root="$2"
      shift 2
      ;;
    --codex-skills-root)
      require_option_value "$1" "$#" "${2:-}"
      codex_skills_root="$2"
      shift 2
      ;;
    --codex-config-path)
      require_option_value "$1" "$#" "${2:-}"
      codex_config_path="$2"
      shift 2
      ;;
    --skip-mcp-smoke)
      skip_mcp_smoke="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      atlas_die "Unknown option: $1"
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "$atlas_root" ]]; then
  atlas_root="$(atlas_absolute_path "$atlas_root")"
else
  atlas_root="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
fi
codex_skills_root="$(atlas_absolute_path "$codex_skills_root")"
if [[ -n "$codex_config_path" ]]; then
  codex_config_path="$(atlas_absolute_path "$codex_config_path")"
else
  codex_root="${CODEX_HOME:-$HOME/.codex}"
  codex_config_path="$(atlas_absolute_path "$codex_root/config.toml")"
fi

package_json="$atlas_root/package.json"
mcp_entry="$atlas_root/packages/mcp/dist/index.js"
cli_entry="$atlas_root/packages/cli/dist/index.js"
config_helper="$atlas_root/frontend-codex-kit/register-codex-mcp.mjs"
smoke_script="$atlas_root/frontend-codex-kit/smoke-core-mcp.mjs"
fingerprint_helper="$atlas_root/frontend-codex-kit/skill-content-fingerprint.mjs"
printf -v installer_path_quoted '%q' \
  "$atlas_root/frontend-codex-kit/install.sh"
installer_command="bash $installer_path_quoted --agent codex"
doctor_failures=0

printf 'Project Atlas doctor (read-only)\n'
printf '  Atlas:  %s\n' "$atlas_root"
printf '  Config: %s\n\n' "$codex_config_path"

if [[ -f "$package_json" ]]; then
  write_check true "Atlas clone" "package.json at the selected root" ""
else
  write_check false "Atlas clone" \
    "package.json is missing at the selected root" \
    "Pass --atlas-root with the stable Project Atlas clone."
fi

git_command="$(command -v git 2>/dev/null || true)"
git_detail=""
if [[ -n "$git_command" ]] \
  && git_detail="$("$git_command" --version 2>&1 | head -n 1)"; then
  write_check true "Git" "$git_detail" ""
else
  write_check false "Git" "${git_detail:-command not found or unusable}" \
    "On Arch/CachyOS run: sudo pacman -Syu --needed git"
fi

node=""
node_resolution_error=""
if resolved_node="$(atlas_resolve_stable_node 2>&1)"; then
  node="$resolved_node"
else
  node_resolution_error="$resolved_node"
fi
node_version=""
node_major=0
if [[ -n "$node" ]]; then
  node_version="$("$node" --version 2>/dev/null | head -n 1 || true)"
  if [[ "$node_version" =~ ^v?([0-9]+)\. ]]; then
    node_major="${BASH_REMATCH[1]}"
  fi
fi
if [[ -n "$node" && "$node_major" -ge 24 ]]; then
  write_check true "Node.js" "$node_version at $node" ""
else
  node_detail="${node_resolution_error:-${node_version:-command not found}}"
  write_check false "Node.js" "$node_detail" \
    "On Arch/CachyOS install nodejs-lts-krypton (or nodejs >=24)."
fi

pnpm_command="$(command -v pnpm 2>/dev/null || true)"
pnpm_version=""
pnpm_major=0
if [[ -n "$pnpm_command" && -d "$atlas_root" ]]; then
  pnpm_version="$(
    cd -- "$atlas_root" \
      && pnpm_config_pm_on_fail=ignore \
        "$pnpm_command" --version 2>/dev/null \
      | head -n 1 \
      || true
  )"
  if [[ "$pnpm_version" =~ ^([0-9]+)\. ]]; then
    pnpm_major="${BASH_REMATCH[1]}"
  fi
fi
if [[ -n "$pnpm_command" && "$pnpm_major" -eq 11 ]]; then
  write_check true "pnpm" "$pnpm_version" ""
else
  write_check false "pnpm" "${pnpm_version:-command not found}" \
    "On Arch/CachyOS run: sudo pacman -Syu --needed pnpm"
fi

if [[ -f "$mcp_entry" ]]; then
  write_check true "MCP build" "$mcp_entry" ""
else
  write_check false "MCP build" "$mcp_entry" \
    "Run $installer_command without --skip-build."
fi
if [[ -f "$cli_entry" ]]; then
  write_check true "CLI build" "$cli_entry" ""
else
  write_check false "CLI build" "$cli_entry" \
    "Run $installer_command without --skip-build."
fi

if [[ "$skip_mcp_smoke" == "false" ]]; then
  smoke_passed="false"
  smoke_detail="Node.js, the smoke script, or the MCP build is unavailable"
  if [[ -n "$node" && -f "$smoke_script" && -f "$mcp_entry" ]]; then
    if smoke_output="$("$node" "$smoke_script" "$mcp_entry" 2>&1)"; then
      smoke_detail="$smoke_output"
      if [[ "$smoke_output" == *"Core MCP smoke passed"* ]]; then
        smoke_passed="true"
      fi
    else
      smoke_detail="$smoke_output"
    fi
  fi
  write_check "$smoke_passed" "Core MCP runtime" "$smoke_detail" \
    "Run pnpm build:packages, then rerun doctor.sh."
fi

for skill_name in frontend-task reuse-first visual-direction; do
  source_root="$atlas_root/skills/$skill_name"
  source_manifest="$source_root/SKILL.md"
  installed_root="$codex_skills_root/$skill_name"
  installed_manifest="$installed_root/SKILL.md"
  installed_metadata="$installed_root/agents/openai.yaml"
  installed="false"
  source_available="false"
  matches_source="false"
  link_target=""
  inspection_error=""

  [[ -f "$source_manifest" ]] && source_available="true"
  [[ -f "$installed_manifest" ]] && installed="true"
  if [[ "$installed" == "true" && "$source_available" == "true" ]]; then
    if link_target="$(atlas_resolve_link_target "$installed_root" 2>/dev/null)"; then
      expected_target="$(realpath -- "$source_root")"
      if atlas_path_equal "$link_target" "$expected_target"; then
        matches_source="true"
      fi
    elif [[ -d "$installed_root" && -f "$fingerprint_helper" && -n "$node" ]]; then
      if ! source_fingerprint="$(
        atlas_skill_fingerprint "$node" "$fingerprint_helper" "$source_root" 2>&1
      )"; then
        inspection_error="$source_fingerprint"
      elif ! target_fingerprint="$(
        atlas_skill_fingerprint "$node" "$fingerprint_helper" "$installed_root" 2>&1
      )"; then
        inspection_error="$target_fingerprint"
      else
        if [[ "$source_fingerprint" == "$target_fingerprint" ]]; then
          matches_source="true"
        fi
      fi
    else
      inspection_error="Node.js or the fingerprint helper is unavailable"
    fi
  fi

  if [[ -n "$inspection_error" ]]; then
    skill_detail="inspection failed: $inspection_error"
  elif [[ "$source_available" == "false" ]]; then
    skill_detail="source skill is missing from the selected clone at $source_root"
  elif [[ "$installed" == "false" ]]; then
    skill_detail="missing at $installed_root"
  elif [[ -n "$link_target" && "$matches_source" == "false" ]]; then
    skill_detail="link points to $link_target instead of this clone at $source_root"
  elif [[ "$matches_source" == "false" ]]; then
    skill_detail="installed copy has stale references, scripts, metadata, or manifest"
  else
    skill_detail="installed and current"
  fi
  write_check "$matches_source" "Skill $skill_name" "$skill_detail" \
    "Move a conflicting destination if present, then run $installer_command."

  if [[ -f "$installed_metadata" ]] && grep -Eq \
    '^[[:space:]]*allow_implicit_invocation:[[:space:]]*false[[:space:]]*$' \
    "$installed_metadata"; then
    explicit_only="true"
    policy_detail="explicit-only"
  else
    explicit_only="false"
    policy_detail="missing explicit-only metadata"
  fi
  write_check "$explicit_only" "Skill policy $skill_name" "$policy_detail" \
    "Run $installer_command from the current Atlas clone."
done

config_ready="false"
config_detail="config or helper unavailable"
if [[
  -n "$node"
  && -f "$codex_config_path"
  && -f "$config_helper"
  && -f "$mcp_entry"
]]; then
  if config_output="$(
    "$node" "$config_helper" \
      --config "$codex_config_path" \
      --node "$node" \
      --entry "$mcp_entry" \
      --dry-run 2>&1
  )"; then
    if [[ "$config_output" == *"Already configured"* ]]; then
      config_ready="true"
      config_detail="component-atlas points to this clone with --profile core"
    else
      config_detail=$'the expected component-atlas core section is not active:\n'"$config_output"
    fi
  else
    config_detail=$'the managed section conflicts with the expected command or arguments:\n'"$config_output"
  fi
fi
write_check "$config_ready" "Codex MCP config" "$config_detail" \
  "Review $codex_config_path, then run $installer_command; append --force-mcp-config only after confirming replacement is intentional."

printf '\n'
if (( doctor_failures > 0 )); then
  printf 'Doctor found %d failed check(s). No files were changed.\n' \
    "$doctor_failures"
  exit 1
fi

printf 'All checks passed. Restart Codex and open a new task if installation changed.\n'
